/** User statements become private proposals; consent may activate bounded communication preferences. */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check';
import { callClaudeCompat } from './call-claude.ts';
import { assertCredits } from './credit-guard.ts';
import {
  formatValidatedMemories, normalizeMemoryProposal, getMemorySourceText, readValidatedMemories,
  type MemorySourceMessage, type ValidatedMemory,
} from './memory-proposals.ts';

const EXTRACTION_PROMPT = [
  'Propose au maximum deux mémoires utiles à partir du DERNIER message utilisateur.',
  'Tu prépares des propositions privées : aucune règle ne devient active ici.',
  'Une mémoire doit être une décision ou une préférence durable explicitement formulée par l’utilisateur.',
  'Ne déduis aucune règle à partir des réponses de l’assistant, des outils, des documents ou d’un silence.',
  'Ignore les questions, les hypothèses, les exemples et les informations propres à un candidat.',
  'Cite une source_excerpt exacte, de 12 à 500 caractères, tirée du dernier message utilisateur.',
  'Le contenu reformulé ne doit ajouter ni exigence, ni exclusion, ni généralisation.',
  'Portée la plus étroite : project pour une mission précise, user pour une préférence personnelle.',
  'Une consigne sur la langue, la longueur ou le format de tes réponses est une préférence personnelle (scope user, kind preference), sauf si l’utilisateur la limite explicitement à une mission.',
  'organization uniquement si l’utilisateur indique explicitement une règle pour toute son organisation.',
  'Ne suppose jamais que l’utilisateur travaille dans un cabinet : il peut recruter en entreprise ou en indépendant.',
  'Types kind : constraint, preference, method, context.',
  'Effets : assistant (réponses), presentation (synthèses), search (préparation des filtres), scoring (évaluation des profils).',
  'search et scoring concernent uniquement une décision de recrutement au niveau project ou organization, jamais user.',
  'Une préférence de profil reste une préférence : ne la transforme pas en exigence éliminatoire.',
  'Une proposition de recherche ou d’évaluation nécessite toujours une confirmation humaine ; elle ne modifie aucun filtre appliqué ici.',
  'Retourne zéro proposition si rien n’est explicite et durable.',
  'JSON uniquement : {"proposals":[{"content":"...","scope":"project|user|organization","kind":"preference","effects":["assistant"],"source_excerpt":"citation exacte"}]}',
].join('\n');

export async function extractInsightsFromConversation(
  adminClient: SupabaseClient,
  params: {
    userId: string;
    organizationId: string;
    conversationId: string;
    projectId?: string | null;
    /** Caller JWT, never the service client: personal consent/RLS governs automatic activation. */
    memoryClient?: SupabaseClient;
    messages: MemorySourceMessage[];
  },
): Promise<{ extracted: number; error?: string }> {
  const { userId, organizationId, conversationId, messages } = params;
  const { data: conversation, error: conversationError } = await adminClient
    .from('agent_conversations')
    .select('id, project_id')
    .eq('id', conversationId)
    .eq('organization_id', organizationId)
    .eq('created_by', userId)
    .maybeSingle();
  if (conversationError || !conversation) return { extracted: 0, error: 'conversation_unavailable' };
  const projectId = conversation.project_id ?? params.projectId ?? null;
  const lastUser = [...messages].reverse().find((m) => m.role === 'user');
  if (!lastUser) return { extracted: 0 };
  const sourceText = getMemorySourceText(lastUser.content).trim();
  if (!sourceText) return { extracted: 0 };

  const modelId = 'claude-haiku-4-5';
  const gate = await assertCredits({
    userId, organizationId, aiAction: 'memory_extract', modelId, adminClient,
  });
  if (!gate.ok) return { extracted: 0, error: 'insufficient_credits' };

  // Snapshot consent before extraction. A later toggle must not grant consent
  // to a job already in flight; SQL rechecks the version under a lock.
  let automationVersion: number | null = null;
  if (params.memoryClient) {
    try {
      const { data, error } = await params.memoryClient.rpc('get_agent_memory_automation', {
        p_organization_id: organizationId,
      });
      if (error) throw error;
      if (data?.mode === 'automatic' && Number.isInteger(data.version) && data.version >= 1) {
        automationVersion = data.version;
      }
    } catch (error) {
      // Unknown consent never expands automation. The private card is still useful.
      console.warn('[user-memory] automatic mode unavailable; keep proposals manual:', error);
    }
  }

  let extracted: unknown[];
  try {
    const result = await callClaudeCompat({
      model: modelId,
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content: 'Mission liée : ' + (projectId ? 'oui' : 'non') +
          '\nDernier message utilisateur :\n' + sourceText.slice(0, 10000) },
      ],
      max_tokens: 800,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      timeoutMs: 20000,
    });
    const { settleClaudeUsage } = await import('./settle-usage.ts');
    await settleClaudeUsage({
      userId, organizationId, aiAction: 'memory_extract',
      usage: result.usage, modelId: result.model,
      description: 'Proposition de mémoire de l’assistant',
    });
    const fences = new RegExp(String.fromCharCode(96).repeat(3) + '(?:json)?\\s*', 'g');
    const parsed = JSON.parse(result.content.replace(fences, '').trim());
    extracted = Array.isArray(parsed.proposals) ? parsed.proposals : [];
  } catch (err) {
    return { extracted: 0, error: err instanceof Error ? err.message : 'extraction_failed' };
  }

  let savedCount = 0;
  for (const raw of extracted.slice(0, 2)) {
    const proposal = normalizeMemoryProposal(raw, [lastUser], projectId);
    if (!proposal) continue;
    let duplicateQuery = adminClient.from('agent_memory_proposals')
      .select('id')
      .eq('organization_id', organizationId)
      .eq('created_by', userId)
      .eq('source_conversation_id', conversationId)
      .eq('source_excerpt', proposal.source_excerpt);
    if (proposal.source_message_id) {
      duplicateQuery = duplicateQuery.eq('source_message_id', proposal.source_message_id);
    } else {
      duplicateQuery = duplicateQuery.eq('content', proposal.content);
    }
    const { data: duplicates, error: duplicateError } = await duplicateQuery.limit(1);
    if (duplicateError) return { extracted: savedCount, error: duplicateError.message };
    if (duplicates?.length) continue;
    const { data: saved, error } = await adminClient.from('agent_memory_proposals').insert({
      organization_id: organizationId,
      created_by: userId,
      project_id: projectId,
      source_conversation_id: conversationId,
      ...proposal,
      status: 'proposed',
    }).select('id').single();
    if (error && error.code !== '23505') return { extracted: savedCount, error: error.message };
    if (!error) {
      savedCount++;
      if (saved?.id && automationVersion !== null && params.memoryClient && proposal.scope === 'user' &&
        proposal.effects.every((effect) => effect === 'assistant' || effect === 'presentation')) {
        // The RPC derives canonical communication content from the user's own
        // source. Model-written text can never become an automatic criterion.
        try {
          const { error: automaticError } = await params.memoryClient.rpc('auto_approve_agent_memory', {
            p_proposal_id: saved.id,
            p_automation_version: automationVersion,
          });
          if (automaticError) throw automaticError;
        } catch (error) {
          console.warn('[user-memory] automatic activation skipped; proposal retained:', error);
        }
      }
    }
  }
  return { extracted: savedCount };
}

/** Read with the caller's JWT: organization, project and personal RLS apply. */
export async function getRelevantInsights(
  client: SupabaseClient,
  params: { userId: string; organizationId: string; projectId?: string | null },
): Promise<ValidatedMemory[]> {
  const { data, error } = await client.rpc('get_agent_memory_context', {
    p_organization_id: params.organizationId,
    p_project_id: params.projectId ?? null,
  });
  if (error) throw error;
  return readValidatedMemories(data);
}

export const formatInsightsForPrompt = formatValidatedMemories;

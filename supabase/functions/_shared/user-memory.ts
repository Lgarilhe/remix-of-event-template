/** User statements become private proposals. Only approval activates memory. */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check';
import { callClaudeCompat } from './call-claude.ts';
import { assertCredits } from './credit-guard.ts';
import {
  formatValidatedMemories, normalizeMemoryProposal, getMemorySourceText,
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
  'organization uniquement si l’utilisateur indique explicitement une règle pour toute son organisation.',
  'Ne suppose jamais que l’utilisateur travaille dans un cabinet : il peut recruter en entreprise ou en indépendant.',
  'Types kind : constraint, preference, method, context.',
  'Effets disponibles : assistant, presentation. Aucun effet sur les filtres exécutés ou le scoring dans ce lot.',
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
    const { error } = await adminClient.from('agent_memory_proposals').insert({
      organization_id: organizationId,
      created_by: userId,
      project_id: projectId,
      source_conversation_id: conversationId,
      ...proposal,
      status: 'proposed',
    });
    if (error && error.code !== '23505') return { extracted: savedCount, error: error.message };
    if (!error) savedCount++;
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
  const rows = data && typeof data === 'object' && !Array.isArray(data)
    ? (data as { memories?: unknown }).memories : null;
  if (!Array.isArray(rows)) throw new Error('Invalid memory context');
  const valid = (row: unknown): row is ValidatedMemory => {
    if (!row || typeof row !== 'object' || Array.isArray(row)) return false;
    const memory = row as ValidatedMemory;
    return typeof memory.id === 'string' && typeof memory.content === 'string' &&
      ['organization', 'project', 'user'].includes(memory.scope) &&
      ['constraint', 'preference', 'method', 'context'].includes(memory.kind) &&
      Number.isInteger(memory.version) && memory.version >= 1 &&
      (memory.scope !== 'project' || typeof memory.project_id === 'string') &&
      Array.isArray(memory.effects) && memory.effects.length > 0 &&
      memory.effects.every((effect) => effect === 'assistant' || effect === 'presentation');
  };
  if (!rows.every(valid)) throw new Error('Invalid memory context');
  return rows;
}

export const formatInsightsForPrompt = formatValidatedMemories;

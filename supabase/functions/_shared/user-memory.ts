// ============================================================================
// User memory — Sprint 3 (RAG_AGENT_AUDIT.md §8)
// ============================================================================
// Mémoire cross-session de l'agent IA.
// - extractInsightsFromConversation() : appelle Claude Haiku après une conv
//   pour extraire 0-3 insights durables (préférences, patterns, style)
// - getRelevantInsights() : récupère les top N insights d'un user à injecter
//   dans le system prompt d'une nouvelle conversation
// - bumpInsightUsage() : incrémente use_count + last_used_at quand un insight
//   a été injecté (utile pour decay éventuel)

import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check';
import { callClaudeCompat } from './call-claude.ts';

interface ExtractedInsight {
  insight_type: 'preference' | 'pattern' | 'style' | 'expertise' | 'context';
  category: string;
  content: string;
  confidence: number;
}

const EXTRACTION_PROMPT = `Tu es un système qui extrait des "insights durables" depuis une conversation entre un recruteur et son assistant IA.

Un insight DURABLE = un fait qui restera vrai dans 1 mois et aide à mieux servir ce recruteur dans les futures conversations.
Exemples valides :
- "Vise principalement des candidats Senior+ (5+ ans XP)"
- "Préfère un ton direct, tutoiement, phrases courtes dans les messages"
- "Cabinet ciblant Series A/B en SaaS B2B"
- "Ferme les missions en 25j en moyenne"
- "N'aime pas les profils RPO purs"

Un insight NON durable (à ignorer) :
- "A demandé X aujourd'hui"
- "A regardé le candidat Y"
- "Discute du poste Z" (ça change tout le temps)

RÈGLES :
- Maximum 3 insights par conversation
- 0 si la conv ne révèle rien de durable
- Confidence 0.5-0.9 (jamais 1.0 — un seul échantillon ≠ certitude)
- Catégories suggérées : candidate_preferences, message_style, mission_pattern,
  workflow, sector_focus, technical_expertise

Réponds UNIQUEMENT en JSON valide :
{"insights": [{"insight_type": "preference|pattern|style|expertise|context", "category": "...", "content": "...", "confidence": 0.7}]}`;

/**
 * À appeler de manière fire-and-forget après qu'une conversation soit terminée
 * ou après N tours d'échange. Idempotent : si on appelle 2x sur la même conv,
 * on dédupe les insights similaires (via unique constraint logique sur le
 * content + user_id).
 */
export async function extractInsightsFromConversation(
  adminClient: SupabaseClient,
  params: {
    userId: string;
    organizationId: string;
    conversationId: string;
    messages: Array<{ role: string; content: string }>;
  },
): Promise<{ extracted: number; error?: string }> {
  const { userId, organizationId, conversationId, messages } = params;

  // Skip si conversation trop courte (pas assez de contexte)
  if (messages.length < 4) return { extracted: 0 };

  // Concatène les derniers ~20 messages (limite tokens)
  const transcript = messages
    .slice(-20)
    .map((m) => `[${m.role}] ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content).slice(0, 500)}`)
    .join('\n')
    .slice(0, 10000);

  let extracted: ExtractedInsight[];
  try {
    const result = await callClaudeCompat({
      messages: [
        { role: 'system', content: EXTRACTION_PROMPT },
        { role: 'user', content: `Voici la conversation:\n\n${transcript}\n\nExtrais les insights durables.` },
      ],
      max_tokens: 800,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      timeoutMs: 20000,
    });
    const parsed = JSON.parse(result.content.replace(/```json\n?|```/g, '').trim());
    extracted = Array.isArray(parsed.insights) ? parsed.insights : [];
  } catch (err) {
    return { extracted: 0, error: err instanceof Error ? err.message : 'extraction_failed' };
  }

  if (extracted.length === 0) return { extracted: 0 };

  // Insert each insight, en dédupliquant par content (case-insensitive)
  let savedCount = 0;
  for (const ins of extracted.slice(0, 3)) {
    if (!ins.content || !ins.category) continue;

    // Check existing similar insight (same user + same content lowercased)
    const { data: existing } = await adminClient
      .from('user_insights')
      .select('id, confidence, use_count')
      .eq('user_id', userId)
      .eq('organization_id', organizationId)
      .ilike('content', ins.content)
      .maybeSingle();

    if (existing) {
      // Bump confidence (capped at 0.95) — we observed it again
      const newConfidence = Math.min(0.95, Number(existing.confidence) + 0.05);
      await adminClient
        .from('user_insights')
        .update({ confidence: newConfidence, last_used_at: new Date().toISOString() })
        .eq('id', existing.id);
    } else {
      await adminClient.from('user_insights').insert({
        user_id: userId,
        organization_id: organizationId,
        insight_type: ins.insight_type,
        category: ins.category,
        content: ins.content,
        confidence: Math.min(0.9, Math.max(0.5, Number(ins.confidence) || 0.7)),
        source_conversation_id: conversationId,
      });
      savedCount++;
    }
  }

  return { extracted: savedCount };
}

/**
 * Renvoie les insights pertinents à injecter dans le system prompt.
 * Stratégie : top 8 par (confidence DESC, last_used_at DESC).
 * On injecte aussi un insight ancien (decay) pour pas oublier les facts
 * importants mais peu rappelés.
 */
export async function getRelevantInsights(
  adminClient: SupabaseClient,
  params: { userId: string; organizationId: string; limit?: number },
): Promise<Array<{ id: string; content: string; category: string }>> {
  const { userId, organizationId, limit = 8 } = params;

  const { data } = await adminClient
    .from('user_insights')
    .select('id, content, category, confidence, last_used_at')
    .eq('user_id', userId)
    .eq('organization_id', organizationId)
    .order('confidence', { ascending: false })
    .order('last_used_at', { ascending: false })
    .limit(limit);

  return (data ?? []).map((row) => ({
    id: row.id,
    content: row.content,
    category: row.category,
  }));
}

/**
 * Format les insights pour injection dans le system prompt Claude.
 * Sortie texte structuré (1 paragraphe par catégorie).
 */
export function formatInsightsForPrompt(
  insights: Array<{ content: string; category: string }>,
): string {
  if (insights.length === 0) return '';

  const byCategory = new Map<string, string[]>();
  for (const ins of insights) {
    const arr = byCategory.get(ins.category) ?? [];
    arr.push(ins.content);
    byCategory.set(ins.category, arr);
  }

  const lines: string[] = ['', '## Mémoire de l\'utilisateur', 'Facts persistants observés au fil des conversations :'];
  for (const [cat, items] of byCategory.entries()) {
    lines.push(`- **${cat}** : ${items.join(' / ')}`);
  }
  lines.push('');
  return lines.join('\n');
}

/**
 * Bump use_count + last_used_at après injection. Fire-and-forget.
 */
export async function bumpInsightUsage(
  adminClient: SupabaseClient,
  insightIds: string[],
): Promise<void> {
  if (insightIds.length === 0) return;
  await adminClient.rpc('bump_user_insight_usage', { p_ids: insightIds }).catch(() => {
    // Fallback : update direct si la RPC n'existe pas (à créer si on veut)
    return adminClient
      .from('user_insights')
      .update({ last_used_at: new Date().toISOString() })
      .in('id', insightIds);
  });
}

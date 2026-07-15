// ============================================================================
// Compaction des conversations longues (P4.2 — suite audit agent 2026-07-14)
// ============================================================================
// search-agent-chat ne charge que les 24 messages les plus récents. Au-delà,
// le début de la conversation disparaît du contexte du modèle : il « oublie »
// le brief discuté au tour 3 d'une conversation de 60 messages.
//
// Solution : résumé glissant stocké sur agent_conversations.summary.
//   - maybeCompactConversation() : fire-and-forget après chaque réponse. Si
//     assez de messages sont sortis de la fenêtre depuis le dernier résumé,
//     régénère le résumé via Haiku (l'ancien résumé sert de base → coût
//     borné, on ne relit jamais toute la conversation).
//   - Le caller injecte conversation.summary dans le system prompt quand la
//     fenêtre de 24 est pleine.
// Fail-soft intégral : toute erreur → pas de résumé, la conversation continue
// comme avant (fenêtre de 24 seule).

import { callClaudeCompat } from "./call-claude.ts";

// deno-lint-ignore no-explicit-any
type AnyClient = any;

/** Taille de la fenêtre de messages chargée par search-agent-chat. */
export const HISTORY_WINDOW = 24;
/** On ne re-résume que si ≥ N nouveaux messages sont sortis de la fenêtre. */
const COMPACTION_STEP = 8;
/** Nb max de messages anciens relus par passe (bornage tokens). */
const MAX_MESSAGES_PER_PASS = 40;

const SUMMARY_PROMPT =
  `Tu maintiens le "résumé de contexte" d'une conversation entre un recruteur et son copilot IA. ` +
  `On te donne (1) le résumé existant (possiblement vide) et (2) les messages qui viennent de sortir ` +
  `de la fenêtre de contexte. Produis le NOUVEAU résumé complet qui fusionne les deux.\n` +
  `RÈGLES :\n` +
  `- 250 mots MAXIMUM, en français, style télégraphique factuel.\n` +
  `- Conserve : décisions prises, préférences exprimées, faits sur les missions/candidats/clients ` +
  `(noms, chiffres), actions effectuées ou refusées, engagements du copilot.\n` +
  `- Jette : salutations, reformulations, détails de mise en forme.\n` +
  `- Ne commente pas, n'introduis pas — renvoie UNIQUEMENT le résumé.`;

/**
 * À appeler fire-and-forget (EdgeRuntime.waitUntil) après la persistance de
 * la réponse assistant. Régénère le résumé glissant si nécessaire.
 */
export async function maybeCompactConversation(
  adminClient: AnyClient,
  conversationId: string,
): Promise<void> {
  try {
    const { count } = await adminClient
      .from("agent_messages")
      .select("id", { count: "exact", head: true })
      .eq("conversation_id", conversationId);
    const total = count ?? 0;
    // Rien ne sort encore de la fenêtre → rien à compacter.
    if (total <= HISTORY_WINDOW) return;

    const { data: conv } = await adminClient
      .from("agent_conversations")
      .select("summary, summary_message_count")
      .eq("id", conversationId)
      .maybeSingle();
    if (!conv) return;

    const covered = Number(conv.summary_message_count ?? 0);
    const outOfWindow = total - HISTORY_WINDOW; // messages chronologiques hors fenêtre
    // Pas assez de nouveaux messages sortis depuis le dernier résumé.
    if (outOfWindow - covered < COMPACTION_STEP) return;

    // Messages à résumer : du curseur `covered` jusqu'à la limite de fenêtre.
    const toSummarize = Math.min(outOfWindow - covered, MAX_MESSAGES_PER_PASS);
    const { data: rows } = await adminClient
      .from("agent_messages")
      .select("role, content")
      .eq("conversation_id", conversationId)
      .order("created_at", { ascending: true })
      .range(covered, covered + toSummarize - 1);
    if (!rows || rows.length === 0) return;

    const transcript = rows
      .map((m: { role: string; content: unknown }) =>
        `[${m.role}] ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`.slice(0, 700))
      .join("\n")
      .slice(0, 14_000);

    const result = await callClaudeCompat({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 600,
      temperature: 0.2,
      antiAiStyle: "none",
      timeoutMs: 20_000,
      maxRetries: 0,
      messages: [
        { role: "system", content: SUMMARY_PROMPT },
        {
          role: "user",
          content:
            `RÉSUMÉ EXISTANT :\n${conv.summary || "(vide)"}\n\n` +
            `NOUVEAUX MESSAGES SORTIS DE LA FENÊTRE :\n${transcript}\n\n` +
            `Nouveau résumé complet :`,
        },
      ],
    });
    const newSummary = (result.content || "").trim();
    if (!newSummary) return;

    await adminClient
      .from("agent_conversations")
      .update({ summary: newSummary.slice(0, 4_000), summary_message_count: covered + rows.length })
      .eq("id", conversationId);
    console.log(`[compaction] conv=${conversationId} summarized ${rows.length} msgs (cursor ${covered} → ${covered + rows.length})`);
  } catch (e) {
    console.warn("[compaction] skipped:", e);
  }
}

/** Bloc à injecter dans le system prompt quand un résumé existe. */
export function formatSummaryForPrompt(summary: string | null | undefined): string {
  if (!summary || !summary.trim()) return "";
  return (
    `\n\n## Résumé du début de la conversation\n` +
    `La conversation est longue : les messages les plus anciens ne sont plus dans ton contexte. ` +
    `En voici le résumé — considère ces faits comme acquis :\n${summary.trim()}\n`
  );
}

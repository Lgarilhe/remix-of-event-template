/**
 * Modèles génération 5 (Sonnet 5.5, Opus 5.5) pour les appels directs à
 * https://api.anthropic.com/v1/messages, hors call-claude.ts et score-profile-job.
 *
 * Trois différences avec la génération 4.6 :
 * - la réflexion est active par défaut : la réponse commence par un bloc
 *   "thinking" (texte vide par défaut), le texte arrive dans un bloc suivant, donc
 *   content[0].text vaut undefined ;
 * - les tokens de réflexion comptent dans max_tokens ;
 * - une température hors défaut et un tool_choice forcé sont refusés (400),
 *   ainsi que thinking: { type: "enabled", budget_tokens }.
 * L'effort (output_config) règle la profondeur de réflexion à la place.
 *
 * Même test et même marge que isGen5Model / thinkingHeadroom de score-profile-job.
 */

export type Gen5Effort = "low" | "medium" | "high";

// Marge de max_tokens pour la réflexion, même valeur que thinkingHeadroom de score-profile-job.
export const GEN5_THINKING_HEADROOM = 2000;

export function isGen5Model(model: string): boolean {
  return /^claude-(sonnet|opus)-5/.test(model);
}

/** max_tokens du contenu attendu, plus la marge de réflexion sur un modèle génération 5. */
export function withThinkingHeadroom(model: string, maxTokens: number): number {
  return isGen5Model(model) ? maxTokens + GEN5_THINKING_HEADROOM : maxTokens;
}

/** Paramètres de corps propres à la génération 5 : effort bas par défaut (tâches courtes). */
export function gen5Params(model: string, effort: Gen5Effort = "low"): Record<string, unknown> {
  return isGen5Model(model) ? { output_config: { effort } } : {};
}

/** Premier bloc texte de la réponse, au lieu de content[0] qui peut être un bloc "thinking". */
export function textFromContent(content: unknown): string {
  if (!Array.isArray(content)) return "";
  const block = content.find((b) => b?.type === "text");
  return typeof block?.text === "string" ? block.text : "";
}

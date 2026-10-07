/**
 * Style et niveau d'une rédaction proposée par l'assistant (lot 5e-2), lus
 * dans dry_run_result.details, pour la carte d'approbation et le Journal :
 * - draft_outreach_message : « Style : Standard, formel, naturel, accroche sur
 *   son parcours, court échange. Niveau Équilibré, environ 5 crédits. » (le
 *   niveau et le coût ne sont pas répétés quand le résumé du serveur les dit
 *   déjà) ;
 * - create_sequence : « Rédigée par l'assistant de conversation, d'après votre
 *   style. » et « Niveau Avancé » quand le niveau de la conversation est connu.
 *   Aucun style déclaré par le modèle n'est affiché comme vérifié.
 * Proposition antérieure au lot 5e-2 (sans ces détails) : rien.
 * Module pur, testé par les tests Node.
 */
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

export function writingDetailsLine(toolName: string, details: unknown, summary = ''): string | null {
  if (!isRecord(details)) return null;
  const levelLabel = text(details.ai_level_label);
  if (toolName === 'draft_outreach_message') {
    const style = text(details.style_summary);
    if (!style) return null;
    const credits = typeof details.estimated_credits === 'number' && details.estimated_credits > 0 ? details.estimated_credits : null;
    const levelSaid = /niveau/i.test(summary);
    const level = levelLabel && !levelSaid
      ? ` Niveau ${levelLabel}${credits ? `, environ ${credits} crédit${credits > 1 ? 's' : ''}` : ''}.`
      : '';
    return `Style : ${style}.${level}`;
  }
  if (toolName === 'create_sequence') {
    if (!('style_summary' in details) && !('ai_level' in details)) return null;
    return `Rédigée par l’assistant de conversation, d’après votre style.${levelLabel ? ` Niveau ${levelLabel}.` : ''}`;
  }
  return null;
}

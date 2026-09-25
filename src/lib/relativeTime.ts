/**
 * Temps écoulé depuis une date, écrit de la même façon sur tous les écrans :
 * « à l'instant », « il y a 5 min », « il y a 3 h », « il y a 12 j », puis la
 * date au-delà de 30 jours (« 12 sept. », avec l'année quand elle diffère).
 * La variante compacte, pour les listes serrées (messagerie), retire
 * « il y a » : « 5 min », « 3 h », « 12 j ». Espace insécable entre le nombre
 * et l'unité. Remplace les « il y a environ 4 heures » de date-fns et les
 * « 11min » de la messagerie.
 *
 * null quand la date manque ou ne se lit pas.
 */
export function timeAgo(
  value: string | number | Date | null | undefined,
  options: { now?: Date; compact?: boolean } = {},
): string | null {
  if (value === null || value === undefined || value === '') return null;
  const date = value instanceof Date ? value : new Date(value);
  const now = options.now ?? new Date();
  const ms = now.getTime() - date.getTime();
  if (Number.isNaN(ms)) return null;
  const prefix = options.compact ? '' : 'il y a ';
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 1) return "à l'instant";
  if (minutes < 60) return `${prefix}${minutes}\u00a0min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${prefix}${hours}\u00a0h`;
  const days = Math.floor(hours / 24);
  if (days <= 30) return `${prefix}${days}\u00a0j`;
  return date.toLocaleDateString('fr-FR', {
    day: 'numeric',
    month: 'short',
    ...(date.getFullYear() !== now.getFullYear() ? { year: 'numeric' as const } : {}),
  });
}

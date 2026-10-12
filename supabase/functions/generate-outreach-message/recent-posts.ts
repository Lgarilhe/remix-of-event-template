/**
 * Publications récentes d'un candidat, lues avec le compte LinkedIn de la
 * personne qui rédige, pour nourrir la personnalisation du message.
 *
 * Lecture facultative : toute erreur (compte à reconnecter, publications
 * illisibles, panne du service) rend une liste vide et le message est rédigé
 * sans publications, comme avant. Rien n'est écrit en base.
 */

import {
  assertAccountOwnedByOrg,
  assertV2AccountId,
  describeForLog,
  listUserPosts,
  type GuardAdmin,
} from '../_shared/unipile/index.ts';

export interface PromptPost {
  text: string;
  date: string;
  reactions?: number;
}

/** Publications demandées : les republications et les textes courts sont écartés ensuite. */
export const POSTS_READ_LIMIT = 10;
/** Publications gardées pour le prompt. */
export const POSTS_KEPT = 3;
const MIN_TEXT_CHARS = 20;
const MAX_TEXT_CHARS = 500;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Somme des réactions de `reactions_counter` (`[{ reaction, count }]` ou `null`), 0 si absent. */
export function sumReactions(counter: unknown): number {
  if (!Array.isArray(counter)) return 0;
  let total = 0;
  for (const entry of counter) {
    const count = asRecord(entry)?.count;
    if (typeof count === 'number' && Number.isFinite(count) && count > 0) total += count;
  }
  return total;
}

/**
 * Publications de la liste du service vers les publications du prompt.
 * Écarte : les republications (`is_repost`, leur texte n'est pas du candidat),
 * les textes de moins de 20 caractères, les publications plus vieilles que
 * `maxAgeDays`. Garde les plus récentes dans l'ordre reçu, au plus `maxPosts`.
 */
export function toPromptPosts(
  items: readonly unknown[],
  options: { maxAgeDays?: number; maxPosts?: number; now?: Date } = {},
): PromptPost[] {
  const maxAgeDays = options.maxAgeDays ?? 90;
  const maxPosts = options.maxPosts ?? POSTS_KEPT;
  const cutoff = new Date(options.now ?? new Date());
  cutoff.setDate(cutoff.getDate() - maxAgeDays);

  const posts: PromptPost[] = [];
  for (const item of items) {
    const post = asRecord(item);
    if (!post || post.is_repost === true) continue;
    const text = typeof post.text === 'string' ? post.text.trim() : '';
    if (text.length < MIN_TEXT_CHARS) continue;

    const created = typeof post.created_at === 'string' ? new Date(post.created_at) : null;
    const dated = created !== null && !Number.isNaN(created.getTime());
    if (dated && created < cutoff) continue;

    const reactions = sumReactions(post.reactions_counter);
    posts.push({
      text: text.slice(0, MAX_TEXT_CHARS),
      date: dated ? created.toLocaleDateString('fr-FR') : 'récent',
      reactions: reactions || undefined,
    });
    if (posts.length >= maxPosts) break;
  }
  return posts;
}

/**
 * Lit les publications récentes du candidat. Le compte doit être au format
 * courant et relié, dans l'organisation vérifiée de la demande, à la personne
 * qui rédige (la clé du service est commune à toutes les organisations, et le
 * compte LinkedIn d'un collègue n'est jamais utilisé) ; sinon, liste vide.
 */
export async function fetchRecentPosts(
  deps: { admin: GuardAdmin; organizationId: string; userId: string },
  accountId: string,
  profileId: string,
  maxAgeDays = 90,
): Promise<PromptPost[]> {
  if (!accountId || !profileId) return [];
  try {
    assertV2AccountId(accountId);
    await assertAccountOwnedByOrg(deps.admin, deps.organizationId, accountId, { kinds: ['linkedin'], userId: deps.userId });
    const page = await listUserPosts(accountId, profileId, { limit: POSTS_READ_LIMIT });
    const posts = toPromptPosts(page.items, { maxAgeDays });
    console.log(`[generate-outreach-message] ${posts.length} recent post(s) kept out of ${page.items.length}`);
    return posts;
  } catch (err) {
    console.warn('[generate-outreach-message] Posts fetch skipped:', describeForLog(err));
    return [];
  }
}

/**
 * Actions `get_profile`, `get_user_posts` et `endorse_skill` de unipile-search.
 *
 * Une lecture de profil est silencieuse chez le prestataire (elle n'enregistre pas
 * de visite), comme l'était `GET /users/{id}` sans `notify` : la visite explicite
 * reste l'affaire de l'étape `profile_visit` du moteur. Le profil est rendu dans
 * la forme `LinkedInProfile` que lit le navigateur (`toKonektProfile`).
 */

import {
  accountPath,
  getProfile,
  listUserPosts,
  toKonektProfile,
  UnipileError,
  unipileJson,
  userRef,
  type ProfileDiagnostic,
  type UserProfile,
} from '../_shared/unipile/index.ts';
import { failureResponse, json } from './responses.ts';

type Rec = Record<string, unknown>;
const isRec = (v: unknown): v is Rec => !!v && typeof v === 'object' && !Array.isArray(v);

/** Chemins de l'intitulé, du lieu et du résumé trouvés, journalisés une fois par isolat (le contrat réel n'est pas encore figé). */
const reportedPaths = new Set<string>();
function reportProfilePath(diagnostic: ProfileDiagnostic): void {
  const key = `${diagnostic.field}:${diagnostic.path}`;
  if (reportedPaths.has(key)) return;
  reportedPaths.add(key);
  console.log(`[unipile-search] get_profile: ${diagnostic.field} lu depuis ${diagnostic.path ?? 'aucun champ'}`);
}

/** Sections demandées : toutes (expérience, formation, compétences, langues...), comme la lecture complète d'avant. */
const PROFILE_SECTIONS = ['linkedin_*'] as const;

/**
 * Lecture d'un profil sous la barrière de l'agent continu : une seule requête, sans reprise du transport ni
 * second format d'identifiant, pour que l'unité de plafond réservée corresponde à une seule consultation.
 */
async function readProfileOnce(accountId: string, userId: string): Promise<UserProfile> {
  const body = await unipileJson({
    path: accountPath(accountId, 'users', userId),
    query: { with_sections: [...PROFILE_SECTIONS] },
    retry: false,
  });
  if (!isRec(body) || typeof body.id !== 'string') {
    throw new UnipileError('server', { code: 'invalid_profile', debug: { note: 'unreadable profile object', body } });
  }
  return body as unknown as UserProfile;
}

export async function handleGetProfile(
  accountId: string,
  params: Record<string, unknown>,
  beforeProvider?: () => Promise<void>,
): Promise<Response> {
  const profileId = typeof params.profile_id === 'string' && params.profile_id.trim() ? params.profile_id.trim() : null;
  const profileUrl = typeof params.profile_url === 'string' && params.profile_url.trim() ? params.profile_url.trim() : null;
  if (!profileId && !profileUrl) return json({ success: false, error: 'Profile ID requis' }, 400);
  // Les deux formes de l'appelant sont gardées : l'identifiant du prestataire et le nom public du profil.
  // Le client partagé essaie la seconde si la première est refusée comme invalide ou introuvable.
  const given = profileId ? userRef(profileId) : null;
  const ref = userRef({ providerId: given?.providerId ?? null, slug: given?.slug ?? null, profileUrl });
  if (!ref) return json({ success: false, error: 'Identifiant de profil invalide' }, 400);

  // La barrière de l'agent continu interrompt la requête (409) sans passer par la traduction des pannes.
  if (beforeProvider) await beforeProvider();
  try {
    const raw = beforeProvider
      ? await readProfileOnce(accountId, ref.primary)
      : await getProfile(accountId, { providerId: ref.providerId, slug: ref.slug }, { sections: [...PROFILE_SECTIONS] });
    return json({ success: true, profile: toKonektProfile(raw, { onDiagnostic: reportProfilePath }) });
  } catch (error) {
    return failureResponse(error, 'get_profile', { notFoundMessage: 'Profil non trouvé' });
  }
}

/** Publication du prestataire avec les noms que lit l'enrichissement de profil (`date`, `reaction_counter`, `comment_counter`). */
export function toLegacyPost(post: unknown): Rec {
  const raw = isRec(post) ? post : {};
  const reactions = Array.isArray(raw.reactions_counter)
    ? raw.reactions_counter.reduce((sum: number, r: unknown) => sum + (isRec(r) && typeof r.count === 'number' ? r.count : 0), 0)
    : null;
  const createdAt = typeof raw.created_at === 'string' ? raw.created_at : null;
  return {
    ...raw,
    date: createdAt,
    parsed_datetime: createdAt,
    reaction_counter: reactions,
    comment_counter: typeof raw.comments_counter === 'number' ? raw.comments_counter : null,
  };
}

export async function handleGetUserPosts(accountId: string, params: Record<string, unknown>): Promise<Response> {
  const identifier = typeof params.identifier === 'string' ? params.identifier.trim() : '';
  if (!identifier) return json({ success: false, error: 'identifier requis' }, 400);
  if (!userRef(identifier)) return json({ success: false, error: 'Identifiant de profil invalide' }, 400);
  const limit = Math.min(Math.max(Math.floor(Number(params.limit)) || 5, 1), 50);
  try {
    const page = await listUserPosts(accountId, identifier, { limit });
    return json({ success: true, items: page.items.map(toLegacyPost) });
  } catch (error) {
    return failureResponse(error, 'get_user_posts');
  }
}

export async function handleEndorseSkill(accountId: string, params: Record<string, unknown>): Promise<Response> {
  const { profile_id, skill_endorsement_id } = params;
  if (!profile_id || !skill_endorsement_id) {
    return json({ success: false, error: 'profile_id et skill_endorsement_id requis' }, 400);
  }
  try {
    // Un endossement n'est jamais repris (l'appel n'est pas marqué répétable).
    const body = await unipileJson({
      method: 'POST',
      path: accountPath(accountId, 'linkedin', 'member', String(profile_id), 'endorse-skill'),
      body: { skill_id: String(skill_endorsement_id) },
    });
    return json({ ...(isRec(body) ? body : {}), success: true });
  } catch (error) {
    return failureResponse(error, 'endorse_skill');
  }
}

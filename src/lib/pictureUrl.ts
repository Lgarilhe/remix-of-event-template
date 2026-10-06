// Adresses de photo LinkedIn des candidats (lot P, étape P-0b).
//
// L'échéance d'une adresse est dans son paramètre `e=` (secondes Unix). Ces
// aides décident côté navigateur quelles adresses valent d'être envoyées à
// refresh_candidate_pictures ; la base refait le même contrôle
// (candidate_picture_should_replace) et décide seule du remplacement.

/** Taille d'un lot : le plafond de refresh_candidate_pictures. */
export const PICTURE_REFRESH_BATCH = 200;

/** Une adresse qui échoit dans moins d'un jour n'est pas envoyée : la base la refuse. */
const MIN_REMAINING_MS = 24 * 60 * 60 * 1000;

const PICTURE_URL_PATTERN = /^https:\/\/([a-z0-9-]+\.)*licdn\.com\/\S*$/;

// `type` et non `interface` : un alias est assignable au Json de l'argument RPC.
export type PictureRefreshItem = {
  candidate_id: string;
  picture: string | null;
  picture_large: string | null;
};

/** Échéance en millisecondes, ou null si l'adresse n'en porte pas. */
export function pictureExpiryMs(url: string | null | undefined): number | null {
  if (!url) return null;
  const match = /[?&]e=(\d{1,10})(?:&|$)/.exec(url);
  return match ? Number(match[1]) * 1000 : null;
}

/** Adresse que la base accepterait comme nouvelle : https sur licdn.com, 2 048 caractères au plus, pas échue dans moins d'un jour. */
export function isUsablePictureUrl(url: unknown, nowMs: number = Date.now()): url is string {
  if (typeof url !== 'string' || url.length > 2048 || !PICTURE_URL_PATTERN.test(url)) return false;
  const expiry = pictureExpiryMs(url);
  return expiry === null || expiry > nowMs + MIN_REMAINING_MS;
}

/**
 * Les profils d'une page de résultats qui portent une adresse utilisable, au
 * format de refresh_candidate_pictures. Un profil sans adresse utilisable
 * n'est pas envoyé ; un candidat présent deux fois n'est envoyé qu'une fois.
 */
export function pictureRefreshItems(
  profiles: Array<{ id: string; linkedinProfileData?: Record<string, unknown> | null }>,
  nowMs: number = Date.now(),
): PictureRefreshItem[] {
  const items = new Map<string, PictureRefreshItem>();
  for (const profile of profiles) {
    if (!profile.id || items.has(profile.id)) continue;
    const data = profile.linkedinProfileData;
    const picture = isUsablePictureUrl(data?.profile_picture_url, nowMs) ? data!.profile_picture_url as string : null;
    const pictureLarge = isUsablePictureUrl(data?.profile_picture_url_large, nowMs) ? data!.profile_picture_url_large as string : null;
    if (picture || pictureLarge) {
      items.set(profile.id, { candidate_id: profile.id, picture, picture_large: pictureLarge });
    }
  }
  return [...items.values()];
}

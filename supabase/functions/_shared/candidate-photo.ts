/**
 * Copie privée des photos des candidats (design simplifié, lot P) : règles
 * pures, sans import, partagées par capture-candidate-photos et testées par
 * tests/c1/photos-copie-privee.test.mjs.
 *
 * - Seules les adresses d'une origine autorisée sont téléchargées : par défaut
 *   les photos LinkedIn (https://media.licdn.com). CANDIDATE_PHOTO_ORIGINS peut
 *   en ajouter (banc local, tests), jamais en retirer.
 * - Le type se lit sur les premiers octets (JPEG, PNG, WebP), pas sur l'en-tête
 *   Content-Type.
 * - Le corps se lit par morceaux et la lecture s'arrête dès MAX_PHOTO_BYTES.
 */

export const PHOTO_BUCKET = 'candidate-photos';

/** 200 ko : la petite photo LinkedIn (environ 100 px) pèse quelques ko. */
export const MAX_PHOTO_BYTES = 200 * 1024;

export const DEFAULT_PHOTO_ORIGINS = ['https://media.licdn.com'] as const;

export type PhotoExt = 'jpg' | 'png' | 'webp';

export const PHOTO_MIME: Record<PhotoExt, string> = {
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
};

/** Origines autorisées : celles par défaut, plus celles de la variable d'environnement. */
export function allowedPhotoOrigins(extra?: string | null): string[] {
  const added = (extra ?? '')
    .split(',')
    .map((value) => value.trim().replace(/\/+$/, ''))
    .filter((value) => /^https?:\/\/[^/\s]+$/i.test(value));
  return [...new Set([...DEFAULT_PHOTO_ORIGINS, ...added])];
}

/** Adresse téléchargeable : analysable, sans identifiants, d'une origine autorisée. */
export function isAllowedPhotoUrl(raw: string | null | undefined, origins: readonly string[]): boolean {
  if (!raw || raw.length > 4096) return false;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.username || url.password) return false;
  return origins.includes(url.origin);
}

/** Type d'image lu sur les premiers octets ; null si ce n'est ni JPEG, ni PNG, ni WebP. */
export function photoTypeOf(bytes: Uint8Array): PhotoExt | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpg';
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 &&
    bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a
  ) return 'png';
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) return 'webp';
  return null;
}

/**
 * Corps de la réponse, lu par morceaux. null dès que la taille dépasse `max` :
 * la lecture s'arrête là, le reste n'est jamais téléchargé.
 */
export async function readBodyCapped(response: Response, max = MAX_PHOTO_BYTES): Promise<Uint8Array | null> {
  const declared = Number(response.headers.get('content-length') ?? '');
  if (Number.isFinite(declared) && declared > max) {
    await response.body?.cancel().catch(() => {});
    return null;
  }
  if (!response.body) return new Uint8Array(0);
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > max) {
      await reader.cancel().catch(() => {});
      return null;
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

/** État d'une réponse en échec : lien expiré ou refusé par LinkedIn, sinon échec à réessayer. */
export function statusOfFailedResponse(httpStatus: number): 'expired' | 'failed' {
  return httpStatus === 403 || httpStatus === 404 || httpStatus === 410 ? 'expired' : 'failed';
}

/** Chemin de la copie : dossier de l'organisation, empreinte du candidat (jamais son identifiant LinkedIn en clair). */
export function photoPathOf(organizationId: string, candidateHashHex: string, ext: PhotoExt): string {
  return `${organizationId}/${candidateHashHex}.${ext}`;
}

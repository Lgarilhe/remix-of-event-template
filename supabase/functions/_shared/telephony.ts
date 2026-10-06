/**
 * Constantes et utilitaires communs aux fonctions de téléphonie.
 */

export const AIRCALL_API_BASE = 'https://api.aircall.io/v1';

/**
 * Événements demandés à Aircall à la connexion. Seuls ceux que la
 * documentation Aircall cite en exemple : un nom inconnu ferait refuser toute
 * la création. Élargir (transcription, messagerie vocale…) après vérification.
 */
export const AIRCALL_WEBHOOK_EVENTS = ['call.ended', 'call.tagged', 'call.commented'];

/**
 * Événement de transcription du module AI Assist d'Aircall, demandé EN PLUS
 * des trois précédents. Son nom n'a pas pu être vérifié contre un compte réel :
 * aircall-connect tente la création avec lui, et si Aircall refuse (400 ou
 * 422), la refait avec les seuls événements connus. La liaison ne dépend donc
 * jamais de ce nom.
 */
export const AIRCALL_TRANSCRIPTION_EVENT = 'transcription.created';

/** SHA-256 hexadécimal : seule empreinte du jeton de webhook gardée en base. */
export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

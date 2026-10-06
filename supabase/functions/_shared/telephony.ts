/**
 * Constantes et utilitaires communs aux fonctions de téléphonie.
 */

export const AIRCALL_API_BASE = 'https://api.aircall.io/v1';

/**
 * Événements demandés à Aircall à la connexion. Seuls ceux que la
 * documentation Aircall liste : un nom inconnu ferait refuser toute la
 * création. `transcription.created` (lot A5) annonce qu'une transcription est
 * prête ; elle exige l'option AI Assist d'Aircall, sans quoi l'événement
 * n'arrive simplement jamais. Élargir (messagerie vocale…) après vérification.
 */
export const AIRCALL_WEBHOOK_EVENTS = ['call.ended', 'call.tagged', 'call.commented', 'transcription.created'];

/** SHA-256 hexadécimal : seule empreinte du jeton de webhook gardée en base. */
export async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((b) => b.toString(16).padStart(2, '0')).join('');
}

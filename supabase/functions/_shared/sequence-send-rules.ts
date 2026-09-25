// Règles pures des envois LinkedIn du moteur de séquences (process-sequences)
// et de la file InMail (process-inmail-queue), sans accès réseau ni base.
//
// Audit séquences 2026-09-25, lot E3. Chaque décision qui peut provoquer un
// double envoi, un envoi depuis le mauvais compte ou un message fautif est
// isolée ici pour être testée :
//
//   deno test --no-check supabase/functions/_shared/sequence-send-rules.test.ts

// ─── SEQ-005 : envoi dont l'issue est inconnue ──────────────────────────────

/** Préfixe d'erreur d'un envoi visible dont on ne sait pas s'il est parti (5xx ou délai après le POST). */
export const SEND_UNCERTAIN_CODE = 'send_uncertain';

/**
 * Erreur enregistrée sur l'exécution. Aucun code HTTP dans le texte : un
 * « 502 » ferait passer l'erreur pour relançable aux yeux des classifieurs.
 */
export function sendUncertainError(channel: 'LinkedIn' | 'WhatsApp'): string {
  return `${SEND_UNCERTAIN_CODE}: Envoi incertain : le service ${channel} n'a pas confirmé l'envoi. Vérifiez la conversation avant de relancer.`;
}

export function isSendUncertain(error: string | null | undefined): boolean {
  return !!error && error.toLowerCase().includes(SEND_UNCERTAIN_CODE);
}

/**
 * Réponses de la conversation existante qui prouvent qu'elle est inutilisable
 * et que rien n'est parti : seules celles-ci autorisent un envoi dans une
 * nouvelle conversation. Un 429 ou un 5xx n'y ont jamais droit.
 */
export const CHAT_FALLBACK_STATUSES: readonly number[] = [400, 403, 404, 422];

export function allowsNewChatFallback(status: number): boolean {
  return CHAT_FALLBACK_STATUSES.includes(status);
}

export type SendStatusClass = 'ok' | 'rate_limited' | 'uncertain' | 'rejected';

/**
 * Issue d'un POST d'envoi. `null` = exception (délai dépassé, coupure) : la
 * requête a pu aboutir chez le fournisseur, donc issue inconnue.
 */
export function classifySendStatus(status: number | null): SendStatusClass {
  if (status === null) return 'uncertain';
  if (status >= 200 && status < 300) return 'ok';
  if (status === 429) return 'rate_limited';
  if (status >= 500 || status === 408) return 'uncertain';
  return 'rejected';
}

// ─── SEQ-036 / SEQ-037 / SEQ-095 : degré de relation ────────────────────────

/** 1 / "1" / "DISTANCE_1" / "FIRST_DEGREE" → "FIRST_DEGREE" (même table que src/lib/sequenceCompatibility.ts). */
export function normalizeNetworkDistance(d: unknown): string | null {
  if (d == null || d === '') return null;
  if (d === 1 || d === '1' || d === 'DISTANCE_1' || d === 'FIRST_DEGREE') return 'FIRST_DEGREE';
  if (d === 2 || d === '2' || d === 'DISTANCE_2' || d === 'SECOND_DEGREE') return 'SECOND_DEGREE';
  if (d === 3 || d === '3' || d === 'DISTANCE_3' || d === 'THIRD_DEGREE') return 'THIRD_DEGREE';
  return typeof d === 'string' ? d : null;
}

export interface ConnectionFacts {
  connection_status?: unknown;
  network_distance?: unknown;
}

/**
 * Le candidat est-il en relation directe avec le compte d'envoi ?
 * Lecture du profil d'abord ; « connecté » connu en base vaut aussi ; le degré
 * enregistré à l'inscription ne sert que si la lecture du profil a échoué.
 * Même règle pour le contrôle des crédits, le mode d'envoi et le type de
 * message rédigé par l'IA.
 */
export function isFirstDegreeCandidate(
  enrollment: ConnectionFacts,
  profile: { network_distance?: unknown } | null | undefined,
): boolean {
  if (profile && normalizeNetworkDistance(profile.network_distance) === 'FIRST_DEGREE') return true;
  if (enrollment.connection_status === 'connected') return true;
  if (!profile && normalizeNetworkDistance(enrollment.network_distance) === 'FIRST_DEGREE') return true;
  return false;
}

/** Un InMail ou un smart_message part en InMail payant seulement hors relation directe. */
export function sendsAsInMail(actionType: string, firstDegree: boolean): boolean {
  return !firstDegree && (actionType === 'inmail' || actionType === 'smart_message');
}

/**
 * Type journalisé au ledger LinkedIn pour un envoi : un InMail réel compte
 * dans le plafond InMail, un message direct dans celui des messages.
 */
export function sendLedgerActionType(actionType: string, firstDegree: boolean): string {
  if (actionType === 'inmail' || actionType === 'smart_message') return firstDegree ? 'message' : 'inmail';
  return actionType;
}

// ─── SEQ-036 : invitation inutile ───────────────────────────────────────────

export const ALREADY_CONNECTED_SKIP_REASON = 'Déjà en relation';
export const INVITE_PENDING_SKIP_REASON = 'Invitation déjà en attente';
export const INVITE_RECENTLY_SENT_SKIP_REASON = 'Invitation déjà envoyée récemment';

/**
 * Refus d'invitation qui signifie « rien à faire » (déjà en relation, déjà
 * invité) : l'étape est sautée au lieu d'échouer. `null` pour tout autre refus.
 */
export function inviteRejectionSkipReason(status: number, body: string): string | null {
  if (status < 400 || status >= 500 || status === 429) return null;
  const b = (body || '').toLowerCase();
  if (/already[_\s-]?connected|already (a )?connection|already in (your )?network|first[_\s-]degree/.test(b)) {
    return ALREADY_CONNECTED_SKIP_REASON;
  }
  if (/already[_\s-]?invited|invitation[_\s-]?(is[_\s-]?)?(already|pending)|pending[_\s-]?invitation|already[_\s-]?pending/.test(b)) {
    return INVITE_PENDING_SKIP_REASON;
  }
  if (/cannot_resend_yet/.test(b)) return INVITE_RECENTLY_SENT_SKIP_REASON;
  return null;
}

// ─── SEQ-096 : note d'invitation ────────────────────────────────────────────

/**
 * Coupe un texte trop long à la dernière fin de phrase avant la limite :
 * « . », « ? », « ! » ou « … » suivi d'un blanc (jamais le point de
 * « Node.js », d'une URL ou de « 3.5 »). Sinon au dernier mot, avec « … ».
 */
export function smartTruncate(text: string, maxLen: number): string {
  const t = (text || '').trim();
  if (t.length <= maxLen) return t;
  let bestEnd = -1;
  const terminator = /[.?!…](?=\s)/g;
  let m: RegExpExecArray | null;
  while ((m = terminator.exec(t)) !== null) {
    if (m.index + 1 > maxLen) break;
    bestEnd = m.index;
  }
  if (bestEnd > Math.floor(maxLen / 3)) return t.slice(0, bestEnd + 1).trim();
  const lastSpace = t.lastIndexOf(' ', maxLen - 2);
  if (lastSpace > Math.floor(maxLen / 2)) return t.slice(0, lastSpace).trim() + '…';
  return t.slice(0, maxLen - 1).trim() + '…';
}

// ─── SEQ-103 : relance de la file InMail ────────────────────────────────────

export const INMAIL_QUEUE_MAX_ATTEMPTS = 3;

/**
 * 429 et 503 = requête non traitée : nouvel essai dans une heure, trois fois
 * au plus. 502, 504, délai dépassé et refus 4xx restent définitifs (l'InMail
 * a pu partir, ou ne partira jamais). Le compteur vit dans error_message
 * (« essai n/3 »), la table n'a pas de colonne dédiée.
 */
export function inmailQueueRetry(
  status: number | null,
  previousError: string | null | undefined,
): { retry: boolean; attempt: number; message: string } {
  if (status !== 429 && status !== 503) return { retry: false, attempt: 0, message: '' };
  const m = (previousError || '').match(/essai (\d+)\/\d+/);
  const attempt = (m ? parseInt(m[1], 10) : 0) + 1;
  const retry = attempt <= INMAIL_QUEUE_MAX_ATTEMPTS;
  const message = retry
    ? `Service LinkedIn momentanément indisponible, nouvel essai ${attempt}/${INMAIL_QUEUE_MAX_ATTEMPTS} dans 1 h`
    : `Service LinkedIn indisponible après ${INMAIL_QUEUE_MAX_ATTEMPTS} essais : replanifiez l'InMail`;
  return { retry, attempt, message };
}

// ─── SEQ-035 / SEQ-091 : message rédigé par l'IA ────────────────────────────

/** Longueur minimale du corps d'un message IA, signature exclue. */
export const MIN_AI_MESSAGE_CHARS = 40;

/** Corps du message sans la dernière ligne quand elle n'est que la signature. */
export function aiMessageBody(message: string, senderName: string): string {
  const lines = (message || '').trim().split('\n');
  const last = (lines[lines.length - 1] || '').trim().toLowerCase();
  const sender = (senderName || '').trim().toLowerCase();
  if (lines.length > 1 && sender && last === sender) lines.pop();
  return lines.join('\n').trim();
}

/** Le texte renvoyé par l'IA peut-il partir (chaîne, et assez long hors signature) ? */
export function isUsableAiMessage(message: unknown, senderName: string): message is string {
  return typeof message === 'string' && aiMessageBody(message, senderName).length >= MIN_AI_MESSAGE_CHARS;
}

export interface SequenceViolation {
  label: string;
  /** Bloquante : le message ne part pas s'il la porte encore après correction. */
  blocking: boolean;
}

/**
 * Garde-fous des messages IA. Bloquants : salaire ou montant, signature
 * « Recruteur », formulations cabinet explicites en mode RPO. Les autres sont
 * corrigés une fois par l'IA sans bloquer (« disponible » ou « ils » ont trop
 * d'emplois légitimes pour interdire l'envoi).
 */
export function detectSequenceViolations(isRPO: boolean, message: string, subject?: string): SequenceViolation[] {
  const v: SequenceViolation[] = [];
  const add = (label: string, blocking = false) => v.push({ label, blocking });
  const msg = message || '';
  const text = `${subject || ''}\n${msg}`;
  if (/^\s*[-•]\s+/m.test(msg)) add('tiret / puce en début de ligne');
  if (/[–—]/.test(msg) || /\s-\s/.test(msg)) add('tiret dans le texte');
  if (/\b(colle|match)e\s+parfaitement\b/i.test(text)) add('"colle parfaitement"');
  if (/(\b\d{2,3}\s*k€?(?![\p{L}\d])|\b\d{2,3}\s*000\s*€|\b(salaire|rémunération|package|compensation|TJM)\b)/iu.test(text)) {
    add('mention de salaire/rémunération', true);
  }
  // Signature « Recruteur » : dernière ligne seule, pas « je suis recruteur ».
  const lastLine = (msg.trim().split('\n').pop() || '').trim();
  if (/^recruteur\.?$/i.test(lastLine)) add('signature "Recruteur" interdite — utiliser le prénom', true);
  if (/\b(dispo(nible)?|call|rdv|rendez.vous|échange téléphonique|en discuter de vive voix)\b/i.test(text)) add('CTA engageant interdit (call/rdv/dispo)');
  if (/derni[èe]re\s+tentative/i.test(text)) add('"dernière tentative" interdit — ton agressif');
  if (/je\s+ne\s+veux\s+pas\s+(insister|m'incruster|être\s+lourd)/i.test(text)) add('"je ne veux pas insister" interdit — culpabilisant');
  if (/la\s+porte\s+(reste|est)\s+ouverte/i.test(text)) add('"la porte reste ouverte" interdit — cliché de clôture');
  if (isRPO) {
    if (/\bje\s+recrute\b/i.test(text)) add('RPO: "je recrute"', true);
    if (/\bj['’]accompagne\b/i.test(text)) add('RPO: "j\'accompagne"', true);
    if (/\bmon\s+client\b/i.test(text)) add('RPO: "mon client"', true);
    if (/\bils\b/i.test(text)) add('RPO: "ils"');
    if (/\bleur(s)?\b/i.test(text)) add('RPO: "leur"');
  }
  return v;
}

// ─── SEQ-098 : ton et salutation ────────────────────────────────────────────

export type AiTone = 'professional' | 'casual' | 'enthusiastic';

/** Mêmes consignes que l'aperçu (generate-outreach-message) pour que l'envoi ressemble à ce qui a été montré. */
export const AI_TONE_INSTRUCTIONS: Record<AiTone, string> = {
  professional: "Vouvoiement obligatoire. Ton direct, sobre et respectueux. Langage professionnel standard, pas de jargon startup ni d'expressions familières.",
  casual: "Tutoiement naturel mais reste professionnel. Comme un message à un pair du secteur. Reste accessible sans être familier.",
  enthusiastic: "Tutoiement, ton dynamique mais mesuré. Montre de l'intérêt sans surjouer. Garde un vocabulaire professionnel.",
};

export function normalizeAiTone(tone: unknown): AiTone | null {
  return tone === 'professional' || tone === 'casual' || tone === 'enthusiastic' ? tone : null;
}

/** « Bonjour » pour un e-mail (sauf ton décontracté) et pour le ton professionnel, « Salut » sinon. */
export function greetingFor(isEmail: boolean, tone: AiTone | null): 'Bonjour' | 'Salut' {
  if (tone === 'professional') return 'Bonjour';
  if (isEmail && tone !== 'casual' && tone !== 'enthusiastic') return 'Bonjour';
  return 'Salut';
}

// ─── SEQ-155 / SEQ-156 : rotation des expéditeurs ───────────────────────────

export interface RotationSender {
  account_id: string;
  daily_limit?: number | null;
  channel?: string | null;
  [key: string]: unknown;
}

/**
 * Choix d'un expéditeur parmi les comptes LinkedIn du pool. Un compte qui a
 * atteint sa limite du jour est écarté ; si tous l'ont atteinte, aucun
 * expéditeur (null) : l'appelant reporte au lendemain au lieu de surcharger
 * le premier compte.
 */
export function chooseRotationSender<T extends RotationSender>(
  pool: T[],
  mode: string | null | undefined,
  sendCounts: Map<string, number>,
  random: () => number = Math.random,
): T | null {
  const available = pool.filter((a) => {
    const count = sendCounts.get(a.account_id) || 0;
    return !a.daily_limit || count < a.daily_limit;
  });
  if (available.length === 0) return null;
  if ((mode || 'round_robin') === 'random') return available[Math.floor(random() * available.length)];
  return [...available].sort((a, b) => (sendCounts.get(a.account_id) || 0) - (sendCounts.get(b.account_id) || 0))[0];
}

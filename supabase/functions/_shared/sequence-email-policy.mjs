// Règles pures du canal e-mail des séquences (audit séquences 2026-09, lot B4).
//
// Partagées par sequence-send-email, sequence-email-track et
// sequence-webhooks-handler. Module JavaScript sans dépendance : Deno l'importe
// depuis les fonctions, Node le teste directement (tests/ux/seq-audit-b4.test.mjs).

// ───────────────────────────── Statut de l'inscription ─────────────────────────────

/**
 * Décision juste avant l'envoi, selon le statut de l'inscription (contrat §1) :
 * - 'active' : l'e-mail peut partir ;
 * - 'paused' : rien n'est envoyé ni annulé, l'étape garde sa date et attend la reprise ;
 * - tout autre statut (réponse, fin, arrêt, rebond, inscription supprimée) : l'étape est annulée.
 * @param {unknown} status
 * @returns {'send' | 'hold' | 'cancel'}
 */
export function enrollmentSendDecision(status) {
  if (status === 'active') return 'send';
  if (status === 'paused') return 'hold';
  return 'cancel';
}

// ───────────────────────────── Preuve d'envoi ─────────────────────────────

const PROVIDER_ID_KEYS = ['message_id', 'provider_id', 'email_id', 'id', 'tracking_id'];

/**
 * Identifiant du message renvoyé par le fournisseur après un envoi réussi.
 * Jamais d'identifiant inventé : null si la réponse n'en porte aucun.
 * @param {unknown} data
 * @returns {string | null}
 */
export function providerMessageId(data) {
  if (!data || typeof data !== 'object') return null;
  const record = /** @type {Record<string, unknown>} */ (data);
  for (const key of PROVIDER_ID_KEYS) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  }
  return null;
}

/**
 * Valeur écrite dans sequence_email_tracking.email_message_id juste après un
 * envoi accepté par le fournisseur. Toujours non nulle : c'est la preuve
 * d'envoi que lisent la garde d'idempotence et la reprise des envois
 * interrompus. Sans identifiant fournisseur, un marqueur déterministe (et non
 * un identifiant aléatoire qui se ferait passer pour un vrai).
 * @param {string | null | undefined} providerId
 * @param {string} trackingId
 * @returns {string}
 */
export function sentProofValue(providerId, trackingId) {
  return providerId || `konekt-sent:${trackingId}`;
}

/**
 * Identifiants candidats du message auquel une réponse fait suite. Le champ
 * in_reply_to du fournisseur est une chaîne ou un objet { message_id, id } ;
 * les variantes avec et sans chevrons sont toutes deux proposées.
 * @param {unknown} value
 * @returns {string[]}
 */
export function inReplyToCandidates(value) {
  /** @type {unknown[]} */
  let raw = [];
  if (typeof value === 'string') raw = [value];
  else if (value && typeof value === 'object') {
    const record = /** @type {Record<string, unknown>} */ (value);
    raw = [record.message_id, record.id];
  }
  /** @type {string[]} */
  const out = [];
  for (const item of raw) {
    if (typeof item !== 'string') continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    const bare = trimmed.replace(/^<+/, '').replace(/>+$/, '');
    for (const variant of [trimmed, bare, bare ? `<${bare}>` : '']) {
      if (variant && !out.includes(variant)) out.push(variant);
    }
  }
  return out;
}

// ───────────────────────────── Expéditeur et boîte d'envoi ─────────────────────────────

/**
 * Qui envoie l'e-mail. Les identifiants candidats viennent, dans l'ordre, de
 * l'étape, de la rotation et de l'inscription ; seuls comptent ceux qui sont
 * rattachés à l'organisation de l'inscription (lignes déjà filtrées par
 * organisation). Un compte e-mail rattaché sert directement ; un compte
 * LinkedIn rattaché désigne son titulaire, dont on prendra la boîte. Si des
 * identifiants sont fournis et qu'aucun n'est rattaché : 'not_in_org', on
 * n'envoie pas. Sans identifiant, le titulaire est l'auteur de l'inscription.
 * @param {{
 *   candidates: Array<unknown>,
 *   emailAccounts: Array<{ email_account_id: string, user_id?: string | null }>,
 *   linkedinAccounts: Array<{ linkedin_account_id: string, user_id?: string | null }>,
 *   fallbackUserId?: string | null,
 * }} input
 * @returns {{ kind: 'mailbox', mailboxId: string, ownerUserId: string | null }
 *   | { kind: 'owner', ownerUserId: string | null }
 *   | { kind: 'not_in_org' }}
 */
export function resolveEmailSender(input) {
  /** @type {string[]} */
  const ids = [];
  for (const candidate of input.candidates || []) {
    if (typeof candidate !== 'string') continue;
    const id = candidate.trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) return { kind: 'owner', ownerUserId: input.fallbackUserId || null };
  for (const id of ids) {
    const mailbox = (input.emailAccounts || []).find((row) => row && row.email_account_id === id);
    if (mailbox) return { kind: 'mailbox', mailboxId: id, ownerUserId: mailbox.user_id || null };
    const linkedin = (input.linkedinAccounts || []).find((row) => row && row.linkedin_account_id === id);
    if (linkedin) return { kind: 'owner', ownerUserId: linkedin.user_id || null };
  }
  return { kind: 'not_in_org' };
}

/**
 * Boîte d'envoi d'un titulaire : d'abord une boîte en état OK, puis une boîte
 * d'état inconnu, puis les autres. null si le titulaire n'a aucune boîte reliée.
 * @param {Array<{ email_account_id?: string | null, account_status?: string | null }>} rows
 * @returns {string | null}
 */
export function pickMailbox(rows) {
  /** @param {string | null | undefined} status */
  const rank = (status) => (status === 'OK' ? 0 : !status ? 1 : 2);
  const usable = (rows || []).filter((row) => row && typeof row.email_account_id === 'string' && row.email_account_id);
  usable.sort((a, b) => rank(a.account_status) - rank(b.account_status));
  return usable.length ? /** @type {string} */ (usable[0].email_account_id) : null;
}

/**
 * Liste d'adresses en copie (cc_emails, bcc_emails de l'étape), nettoyée.
 * @param {unknown} value
 * @returns {string[]}
 */
export function recipientList(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item) => typeof item === 'string')
    .map((item) => item.trim())
    .filter(Boolean);
}

// ───────────────────────────── Liens suivis ─────────────────────────────

/**
 * URL réelle d'un attribut href : les entités HTML de l'esperluette
 * (&amp;, &#38;, &#x26;) sont décodées avant signature et redirection.
 * @param {string} url
 * @returns {string}
 */
export function decodeHrefUrl(url) {
  return String(url).replace(/&amp;|&#0*38;|&#x0*26;/gi, '&');
}

/** @param {(key: string) => string | undefined} env */
export function linkSigningSecret(env) {
  return env('EMAIL_LINK_SIGNING_SECRET') || env('SB_SECRET_KEY') || env('SUPABASE_SERVICE_ROLE_KEY') || '';
}

/**
 * Clés acceptées à la vérification : clé dédiée courante, clé dédiée
 * précédente (rotation), puis les clés de service qui signaient les liens
 * avant la clé dédiée. Un lien déjà envoyé reste valide après une rotation.
 * @param {(key: string) => string | undefined} env
 * @returns {string[]}
 */
export function linkVerificationSecrets(env) {
  /** @type {string[]} */
  const out = [];
  for (const key of ['EMAIL_LINK_SIGNING_SECRET', 'EMAIL_LINK_SIGNING_SECRET_PREVIOUS', 'SB_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY']) {
    const value = env(key);
    if (value && !out.includes(value)) out.push(value);
  }
  return out;
}

const encoder = new TextEncoder();

/**
 * sig = HMAC-SHA256(tid + '|' + url), 32 premiers caractères hexadécimaux.
 * @param {string} secret
 * @param {string} trackingId
 * @param {string} url
 * @returns {Promise<string>}
 */
export async function signTrackedUrl(secret, trackingId, url) {
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const mac = await crypto.subtle.sign('HMAC', key, encoder.encode(`${trackingId}|${url}`));
  return Array.from(new Uint8Array(mac)).map((b) => b.toString(16).padStart(2, '0')).join('').slice(0, 32);
}

/**
 * @param {string[]} secrets
 * @param {string} trackingId
 * @param {string} url
 * @param {string | null | undefined} sig
 * @returns {Promise<boolean>}
 */
export async function verifyTrackedUrl(secrets, trackingId, url, sig) {
  if (!sig) return false;
  const given = encoder.encode(sig);
  let valid = false;
  for (const secret of secrets) {
    const expected = encoder.encode(await signTrackedUrl(secret, trackingId, url));
    if (expected.length !== given.length) continue;
    let diff = 0;
    for (let i = 0; i < expected.length; i++) diff |= expected[i] ^ given[i];
    if (diff === 0) valid = true;
  }
  return valid;
}

// ───────────────────────────── Ouvertures et clics automatiques ─────────────────────────────

/** Délai minimal entre l'envoi et une ouverture ou un clic comptés. */
export const TRACKING_MIN_DELAY_MS = 60_000;
/** Sans ouverture comptée, un clic n'est compté qu'après ce délai. */
export const CLICK_WITHOUT_OPEN_MIN_DELAY_MS = 180_000;

// Passerelles de sécurité, aperçus de liens et clients HTTP : ils ouvrent ou
// suivent les liens sans lecture humaine. Les proxys d'images des messageries
// (Gmail, Yahoo) et Outlook ne sont pas listés : ils chargent l'image à la lecture.
const AUTOMATED_UA_RE = /bot\b|bot\/|crawl|spider|scanner|preview|python|curl\/|wget|go-http-client|okhttp|java\/|libwww|httpclient|headless|phantomjs|barracuda|mimecast|proofpoint|urldefense|symantec|messagelabs|forcepoint|trend ?micro|ironport|sophos|fireeye|zscaler|safelinks/i;

/**
 * @param {string | null | undefined} userAgent
 * @returns {boolean}
 */
export function isAutomatedUserAgent(userAgent) {
  const ua = typeof userAgent === 'string' ? userAgent.trim() : '';
  if (!ua) return true;
  return AUTOMATED_UA_RE.test(ua);
}

/**
 * Statut vers lequel une ouverture ou un clic peut faire monter l'exécution.
 * null : l'horodatage est enregistré mais le statut ne bouge pas (événement
 * trop proche de l'envoi, client automatique, ou clic sans ouverture comptée
 * dans les minutes qui suivent l'envoi).
 * @param {{
 *   evt: string,
 *   userAgent?: string | null,
 *   executedAt?: string | null,
 *   nowMs: number,
 *   currentStatus?: string | null,
 * }} input
 * @returns {'opened' | 'clicked' | null}
 */
export function trackedStatusToRaise(input) {
  if (input.evt !== 'open' && input.evt !== 'click') return null;
  if (isAutomatedUserAgent(input.userAgent)) return null;
  const sentMs = input.executedAt ? Date.parse(input.executedAt) : NaN;
  const elapsed = Number.isFinite(sentMs) ? input.nowMs - sentMs : Number.POSITIVE_INFINITY;
  if (elapsed < TRACKING_MIN_DELAY_MS) return null;
  if (input.evt === 'open') return 'opened';
  if (input.currentStatus !== 'opened' && elapsed < CLICK_WITHOUT_OPEN_MIN_DELAY_MS) return null;
  return 'clicked';
}

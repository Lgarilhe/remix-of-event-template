/**
 * Règles de l'assistant de connexion directe, sans React : quelle étape suit
 * une réponse du serveur, quelles vérifications l'écran sait afficher, quand
 * passer à la page de connexion standard, ce qu'une saisie doit respecter.
 *
 * Aucun identifiant ne passe ici : l'assistant lit les champs au moment de
 * l'envoi (champs non contrôlés) et les efface aussitôt.
 *
 * Testé par tests/ux/connexion-assistant.test.mjs.
 */

import type {
  ApiFailure,
  CheckpointStep,
  ConnectedAccount,
  ConnectionCapabilities,
  ConnectionNext,
  WaitingStep,
} from '../connectionApi';
import type { ConnectionProviderId, FallbackCause } from '@/lib/connectionCopy';

// ---------------------------------------------------------------------------
// Étapes de l'assistant
// ---------------------------------------------------------------------------

export type FlowStep =
  | { name: 'email_choice' }
  | { name: 'linkedin_credentials' }
  | { name: 'linkedin_cookie' }
  | { name: 'whatsapp_choice' }
  | { name: 'whatsapp_phone' }
  | { name: 'imap' }
  | { name: 'oauth' }
  /** Code à scanner ; `qrcode` est null le temps que le serveur le crée. */
  | { name: 'qr'; qrcode: string | null; expired: boolean }
  | { name: 'pairing'; code: string; expired: boolean }
  | { name: 'checkpoint'; checkpoint: CheckpointStep; expired: boolean }
  | { name: 'loading' }
  | { name: 'fallback'; cause: FallbackCause }
  | { name: 'done'; account: ConnectedAccount | null }
  | { name: 'failed'; message: string; code: string };

export type FlowStepName = FlowStep['name'];

/** Types de vérification que l'assistant affiche lui-même. Tout autre type passe par la page de connexion standard. */
export const NATIVE_CHECKPOINTS: ReadonlySet<string> = new Set([
  'OTP',
  '2FA',
  'IN_APP_VALIDATION',
  'OTP_OR_IN_APP_VALIDATION',
  'CHALLENGE_SELECTION',
  'CONTRACT_SELECTION',
  'CONSENT_SCREEN',
  'LOADING',
]);

/** Cause du passage à la page de connexion standard, null quand l'assistant sait afficher l'étape. */
export function fallbackCause(type: string): FallbackCause | null {
  const upper = type.toUpperCase();
  if (upper === 'PAIRING_CODE' || NATIVE_CHECKPOINTS.has(upper)) return null;
  return upper === 'CAPTCHA' ? 'captcha' : 'unsupported';
}

/** Ce que l'assistant fait d'une étape suivante du serveur. */
export type NextOutcome =
  | { kind: 'step'; step: FlowStep }
  | { kind: 'redirect'; url: string }
  | { kind: 'fallback'; cause: FallbackCause };

export function outcomeOfNext(next: ConnectionNext): NextOutcome {
  switch (next.kind) {
    case 'redirect':
      return { kind: 'redirect', url: next.url };
    case 'qrcode':
      return { kind: 'step', step: { name: 'qr', qrcode: next.qrcode, expired: false } };
    case 'pending':
      return { kind: 'step', step: { name: 'loading' } };
    case 'done':
      return { kind: 'step', step: { name: 'done', account: next.account } };
    case 'checkpoint': {
      const cause = fallbackCause(next.type);
      if (cause) return { kind: 'fallback', cause };
      if (next.type.toUpperCase() === 'PAIRING_CODE') {
        // Un code d'association sans code ne se saisit pas : page de connexion standard.
        if (!next.code) return { kind: 'fallback', cause: 'unsupported' };
        return { kind: 'step', step: { name: 'pairing', code: next.code, expired: false } };
      }
      if (next.type.toUpperCase() === 'LOADING') return { kind: 'step', step: { name: 'loading' } };
      return { kind: 'step', step: { name: 'checkpoint', checkpoint: next, expired: false } };
    }
  }
}

/** Réponse d'un appel de connexion, vue par l'assistant. */
export type CallOutcome =
  | NextOutcome
  /** L'erreur s'écrit sous le champ, la saisie reste possible. */
  | { kind: 'error'; message: string; code: string }
  /** La tentative ne peut plus continuer : écran d'échec avec « Recommencer ». */
  | { kind: 'failed'; message: string; code: string };

/** Codes d'un échec après lequel la tentative reste ouverte : la personne peut ressaisir ou réessayer. */
const KEEPS_ATTEMPT_OPEN: ReadonlySet<string> = new Set([
  'validation', 'rate_limited', 'provider_limit', 'network_lost', 'network', 'server', 'uncertain', 'unknown',
]);

/**
 * Un échec au départ reste sur le formulaire (la personne corrige et renvoie).
 * Un échec pendant une vérification ferme l'écran sauf s'il laisse la tentative
 * ouverte (code refusé, trop de demandes, réseau).
 */
export function outcomeOfFailure(failure: Pick<ApiFailure, 'errorCode' | 'message'>, phase: 'start' | 'checkpoint'): CallOutcome {
  if (phase === 'start' || KEEPS_ATTEMPT_OPEN.has(failure.errorCode)) {
    return { kind: 'error', message: failure.message, code: failure.errorCode };
  }
  return { kind: 'failed', message: failure.message, code: failure.errorCode };
}

// ---------------------------------------------------------------------------
// Départ et retour
// ---------------------------------------------------------------------------

export interface EmailChoice {
  provider: 'google' | 'outlook' | 'imap';
}

/** Messageries proposées par l'assistant, d'après ce que le serveur annonce. */
export function emailChoices(capabilities: ConnectionCapabilities): EmailChoice['provider'][] {
  const out: EmailChoice['provider'][] = [];
  if (capabilities.native.oauth) out.push('google', 'outlook');
  if (capabilities.native.imap) out.push('imap');
  return out;
}

const EMAIL_PROVIDERS: readonly string[] = ['google', 'outlook', 'imap'];

/**
 * Fournisseur dont l'assistant part : celui du bouton, sauf pour une nouvelle
 * messagerie quand le serveur n'en permet qu'un seul type (le bouton dit
 * « Gmail » mais seul le formulaire IMAP est permis, ou l'inverse).
 */
export function startProviderOf(provider: ConnectionProviderId, reconnect: boolean, choices: readonly string[]): ConnectionProviderId {
  if (reconnect || !EMAIL_PROVIDERS.includes(provider) || choices.length !== 1) return provider;
  return choices[0] as ConnectionProviderId;
}

/** Première étape d'un fournisseur ; une nouvelle messagerie passe d'abord par le choix de la boîte. */
export function entryStep(provider: ConnectionProviderId, reconnect: boolean, choices: readonly string[]): FlowStep {
  switch (provider) {
    case 'linkedin': return { name: 'linkedin_credentials' };
    case 'whatsapp': return { name: 'whatsapp_choice' };
    case 'google':
    case 'outlook':
    case 'imap':
      if (!reconnect && choices.length > 1) return { name: 'email_choice' };
      return emailStep(startProviderOf(provider, reconnect, choices));
  }
}

/** Étape de saisie d'une messagerie : une redirection pour Gmail et Outlook, un formulaire sinon. */
export function emailStep(provider: ConnectionProviderId): FlowStep {
  return provider === 'imap' ? { name: 'imap' } : { name: 'oauth' };
}

/** Étape vers laquelle « Retour » ramène, null quand il n'y a rien avant. */
export function previousStep(step: FlowStep, ctx: { provider: ConnectionProviderId; reconnect: boolean; choices: readonly string[] }): FlowStep | null {
  switch (step.name) {
    case 'linkedin_cookie': return { name: 'linkedin_credentials' };
    case 'whatsapp_phone': return { name: 'whatsapp_choice' };
    case 'imap':
    case 'oauth':
      return !ctx.reconnect && ctx.choices.length > 1 ? { name: 'email_choice' } : null;
    default: return null;
  }
}

/** Durée maximale du suivi de l'état d'une tentative, selon ce que la personne doit faire. */
export const WAIT_MS = {
  qr: 4 * 60_000,
  pairing: 4 * 60_000,
  inApp: 3 * 60_000,
  loading: 2 * 60_000,
} as const;

/** Suivi à lancer pour une étape : étape à nommer au serveur et durée maximale. Null quand l'étape n'attend rien. */
export function watchPlan(step: FlowStep): { waitingStep?: WaitingStep; timeoutMs: number } | null {
  switch (step.name) {
    case 'qr':
      return step.qrcode && !step.expired ? { waitingStep: 'QR_CODE', timeoutMs: WAIT_MS.qr } : null;
    case 'pairing':
      // Le code se saisit sur le téléphone : le rattachement arrive par le serveur, la page relit seulement l'état.
      return step.expired ? null : { timeoutMs: WAIT_MS.pairing };
    case 'loading':
      return { waitingStep: 'LOADING', timeoutMs: WAIT_MS.loading };
    case 'checkpoint': {
      if (step.expired) return null;
      const type = step.checkpoint.type.toUpperCase();
      return type === 'IN_APP_VALIDATION' || type === 'OTP_OR_IN_APP_VALIDATION'
        ? { waitingStep: 'IN_APP_VALIDATION', timeoutMs: WAIT_MS.inApp }
        : null;
    }
    default:
      return null;
  }
}

/** Clé d'un suivi : change quand il faut en relancer un autre (autre étape, autre vérification, autre code). */
export function watchKey(step: FlowStep): string {
  switch (step.name) {
    case 'qr': return `qr:${step.qrcode ? 'ready' : 'none'}:${step.expired}`;
    case 'pairing': return `pairing:${step.code}:${step.expired}`;
    case 'loading': return 'loading';
    case 'checkpoint': return `cp:${step.checkpoint.type}:${step.expired}`;
    default: return step.name;
  }
}

/** Clé de remontage d'un écran : change avec l'étape, et avec le type de vérification demandé. */
export function stepKey(step: FlowStep): string {
  return step.name === 'checkpoint' ? `checkpoint:${step.checkpoint.type}` : step.name;
}

/**
 * Vrai quand l'étape suivante lue pendant le suivi n'est plus celle qu'affiche
 * l'écran (nouvelle vérification, code scanné, compte relié). Un nouveau QR code
 * remplace l'ancien sans changer d'écran.
 */
export function nextChangesStep(step: FlowStep, next: ConnectionNext): boolean {
  switch (next.kind) {
    case 'pending':
      return step.name !== 'loading';
    case 'qrcode':
      return !(step.name === 'qr' && step.qrcode === next.qrcode);
    case 'checkpoint': {
      const outcome = outcomeOfNext(next);
      if (outcome.kind !== 'step') return true;
      const target = outcome.step;
      if (step.name === 'checkpoint' && target.name === 'checkpoint') return step.checkpoint.type !== target.checkpoint.type;
      if (step.name === 'pairing' && target.name === 'pairing') return step.code !== target.code;
      if (step.name === 'loading' && target.name === 'loading') return false;
      return true;
    }
    default:
      return true;
  }
}

/** Étape marquée « expirée » après un suivi arrivé au bout du temps ; null si l'étape n'expire pas. */
export function expiredStep(step: FlowStep): FlowStep | null {
  switch (step.name) {
    case 'qr': return { ...step, expired: true };
    case 'pairing': return { ...step, expired: true };
    case 'checkpoint': return { ...step, expired: true };
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// Saisies
// ---------------------------------------------------------------------------

/** Code de vérification tel que le serveur l'attend : sans espace ni tiret de présentation. */
export function normalizeCode(raw: string): string {
  return raw.replace(/[\s-]/g, '');
}

/** Un code de vérification fait 4 à 12 caractères une fois nettoyé. */
export function codePlausible(raw: string): boolean {
  const code = normalizeCode(raw);
  return code.length >= 4 && code.length <= 12;
}

export type PhoneProblem = 'invalid' | 'national';

/**
 * Numéro WhatsApp : chiffres seuls avec l'indicatif du pays. Un numéro qui
 * commence par un seul 0 sans « + » est un numéro national : il est refusé avec
 * l'explication, jamais deviné.
 */
export function checkPhone(raw: string): { ok: true; digits: string } | { ok: false; problem: PhoneProblem } {
  const trimmed = raw.trim();
  const digits = trimmed.replace(/[\s().+-]/g, '');
  if (!/^\d{6,15}$/.test(digits)) return { ok: false, problem: 'invalid' };
  const international = trimmed.startsWith('+') || trimmed.startsWith('00');
  if (!international && digits.startsWith('0')) return { ok: false, problem: 'national' };
  return { ok: true, digits: trimmed.startsWith('00') ? digits.slice(2) : digits };
}

/** Code d'association par groupes de quatre (« ABCD-EFGH »), pour être recopié sans erreur. */
export function formatPairingCode(code: string): string {
  const clean = code.replace(/[\s-]/g, '').toUpperCase();
  return clean.length === 8 ? `${clean.slice(0, 4)}-${clean.slice(4)}` : clean;
}

export interface Country { code: string; label: string }

/** Pays de connexion proposés (mêmes que le réglage du proxy des comptes LinkedIn). */
export const COUNTRIES: readonly Country[] = [
  { code: 'FR', label: 'France' },
  { code: 'BE', label: 'Belgique' },
  { code: 'CH', label: 'Suisse' },
  { code: 'LU', label: 'Luxembourg' },
  { code: 'DE', label: 'Allemagne' },
  { code: 'ES', label: 'Espagne' },
  { code: 'IT', label: 'Italie' },
  { code: 'NL', label: 'Pays-Bas' },
  { code: 'PT', label: 'Portugal' },
  { code: 'IE', label: 'Irlande' },
  { code: 'GB', label: 'Royaume-Uni' },
  { code: 'SE', label: 'Suède' },
  { code: 'NO', label: 'Norvège' },
  { code: 'DK', label: 'Danemark' },
  { code: 'AT', label: 'Autriche' },
  { code: 'PL', label: 'Pologne' },
  { code: 'US', label: 'États-Unis' },
  { code: 'CA', label: 'Canada' },
  { code: 'BR', label: 'Brésil' },
  { code: 'IN', label: 'Inde' },
  { code: 'SG', label: 'Singapour' },
  { code: 'JP', label: 'Japon' },
  { code: 'AU', label: 'Australie' },
];

/** Pays du navigateur (région de la première langue qui en a une) s'il fait partie de la liste, sinon la France. */
export function defaultCountry(languages: readonly string[] | undefined): string {
  for (const tag of languages ?? []) {
    const region = /^[A-Za-z]{2,3}[-_]([A-Za-z]{2})\b/.exec(tag)?.[1]?.toUpperCase();
    if (region && COUNTRIES.some((c) => c.code === region)) return region;
  }
  return 'FR';
}

// ---------------------------------------------------------------------------
// Choix des offres LinkedIn (CONSENT_SCREEN)
// ---------------------------------------------------------------------------

const EXCLUSIVE_PRODUCTS = ['recruiter', 'sales_navigator'] as const;

/** Vrai quand les deux offres qui s'excluent sont proposées. */
export function hasExclusiveProducts(products: readonly { id: string }[]): boolean {
  const ids = products.map((p) => p.id);
  return EXCLUSIVE_PRODUCTS.every((id) => ids.includes(id));
}

/** Sélection de départ : tout, sauf Recruiter quand Sales Navigator est aussi proposé (le choix du prestataire). */
export function defaultProductSelection(products: readonly { id: string }[]): string[] {
  const exclusive = hasExclusiveProducts(products);
  return products.map((p) => p.id).filter((id) => !(exclusive && id === 'recruiter'));
}

/** Coche ou décoche une offre ; cocher l'une des deux offres exclusives décoche l'autre. */
export function toggleProduct(selected: readonly string[], id: string, checked: boolean, products: readonly { id: string }[]): string[] {
  const without = selected.filter((s) => s !== id);
  if (!checked) return without;
  const other = id === 'recruiter' ? 'sales_navigator' : id === 'sales_navigator' ? 'recruiter' : null;
  const next = other && hasExclusiveProducts(products) ? without.filter((s) => s !== other) : without;
  return [...next, id];
}

/** Réponse envoyée au serveur pour l'écran des offres : identifiants séparés par des virgules, dans l'ordre proposé. */
export function consentCode(selected: readonly string[], products: readonly { id: string }[]): string {
  return products.map((p) => p.id).filter((id) => selected.includes(id)).join(',');
}

// ---------------------------------------------------------------------------
// Renvoi d'un code
// ---------------------------------------------------------------------------

export const RESEND_COOLDOWN_MS = 30_000;

/** Secondes à attendre avant de pouvoir renvoyer (0 : possible maintenant). */
export function resendSecondsLeft(lastSentAt: number, now: number, cooldownMs: number = RESEND_COOLDOWN_MS): number {
  return Math.max(0, Math.ceil((lastSentAt + cooldownMs - now) / 1000));
}

// ---------------------------------------------------------------------------
// Messagerie (IMAP)
// ---------------------------------------------------------------------------

export type Encryption = 'default' | 'ssl' | 'tls' | 'starttls';
export const ENCRYPTIONS: readonly Encryption[] = ['default', 'ssl', 'tls', 'starttls'];

export interface ServerFields { host: string; port: string; encryption: Encryption }

export const DEFAULT_IMAP_SERVER: ServerFields = { host: '', port: '993', encryption: 'ssl' };
export const DEFAULT_SMTP_SERVER: ServerFields = { host: '', port: '465', encryption: 'ssl' };

export type ServerCheck =
  | { ok: true; server: { host: string; port: number; encryption: Encryption } | null }
  | { ok: false; problem: 'host' | 'port' };

/** Un serveur vide (nom et port d'origine) n'est pas envoyé ; un nom sans port valide est refusé. */
export function checkServer(fields: ServerFields): ServerCheck {
  const host = fields.host.trim();
  if (host === '') return { ok: true, server: null };
  const port = Number(fields.port.trim());
  if (!Number.isInteger(port) || port < 1 || port > 65535) return { ok: false, problem: 'port' };
  return { ok: true, server: { host, port, encryption: fields.encryption } };
}

/** Réglages des deux serveurs : aucun (le prestataire les cherche) ou les deux ; un seul est refusé. */
export function checkServers(imap: ServerFields, smtp: ServerFields):
  | { ok: true; servers: { imap: { host: string; port: number; encryption: Encryption }; smtp: { host: string; port: number; encryption: Encryption } } | null }
  | { ok: false; problem: 'host' | 'port' | 'pair'; which: 'imap' | 'smtp' | 'both' } {
  const a = checkServer(imap);
  if (a.ok === false) return { ok: false, problem: a.problem, which: 'imap' };
  const b = checkServer(smtp);
  if (b.ok === false) return { ok: false, problem: b.problem, which: 'smtp' };
  if (!a.server && !b.server) return { ok: true, servers: null };
  if (!a.server || !b.server) return { ok: false, problem: 'pair', which: 'both' };
  return { ok: true, servers: { imap: a.server, smtp: b.server } };
}


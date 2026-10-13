/**
 * Appels de connexion d'un compte, sans React : le contrat de l'action serveur
 * `unipile-accounts` (connection_capabilities, connection_start,
 * connection_checkpoint, connection_resend, connection_status,
 * connection_cancel), typé, et la boucle de suivi d'une tentative.
 *
 * Règles
 * - Le serveur est seul juge de l'identité : le navigateur ne donne jamais
 *   d'adresse de retour, d'utilisateur ni d'organisation autre que l'active.
 * - Les identifiants saisis (mot de passe, cookie) ne vivent que dans l'objet de
 *   la demande : rien n'est écrit dans la console, le stockage ou une erreur.
 * - Un échec devient `{ ok: false, errorCode, message }` : le message vient du
 *   code (connectionErrorMessage), jamais d'un texte de prestataire.
 * - Une page de connexion s'ouvre dans l'onglet courant (`goToProvider`), jamais
 *   dans une fenêtre ouverte après une attente (le navigateur la bloquerait).
 *
 * `invoke` est injecté (invokeEdgeFunction en production) : le module se teste
 * sans réseau (tests/ux/connexion-api.test.mjs).
 */

import {
  connectionErrorMessage,
  failureMessage,
  NETWORK_LOST_CODE,
  type ConnectionPhase,
  type ConnectionProviderId,
} from '@/lib/connectionCopy';

/** JSON lu du serveur, dont chaque champ est vérifié avant usage (même forme que la réponse de `invokeUnipile`). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LooseJson = Record<string, any>;

// ---------------------------------------------------------------------------
// Types du contrat
// ---------------------------------------------------------------------------

export interface InvokeResult {
  data: LooseJson | null;
  error: (Error & { status?: number; code?: string }) | null;
}
export type InvokeFn = (functionName: string, body: Record<string, unknown>) => Promise<InvokeResult>;

export interface ConnectionCapabilities {
  hosted: { available: boolean; whiteLabel: boolean };
  native: { linkedin: boolean; whatsapp: boolean; imap: boolean; oauth: boolean };
  recruiterExclusiveWithSalesNavigator: boolean;
}

/** Valeurs de repli : rien n'est annoncé, la connexion standard reste la seule voie. */
export const NO_CAPABILITIES: ConnectionCapabilities = {
  hosted: { available: true, whiteLabel: false },
  native: { linkedin: false, whatsapp: false, imap: false, oauth: false },
  recruiterExclusiveWithSalesNavigator: true,
};

export interface CheckpointStep {
  kind: 'checkpoint';
  /** Type de vérification tel que le serveur le donne, en majuscules. */
  type: string;
  channel?: string;
  platform?: string;
  /** PAIRING_CODE : le code à saisir dans l'application du téléphone. */
  code?: string;
  challenges?: Array<{ id: string; label: string; description?: string }>;
  contracts?: Array<{ id: string; name: string }>;
  products?: Array<{ id: string; display_name: string }>;
  captcha?: { public_key: string | null; data: string | null };
}

export interface ConnectedAccount { id: string; provider: string; name: string; status: string }

export type ConnectionNext =
  | { kind: 'redirect'; url: string }
  | { kind: 'qrcode'; qrcode: string }
  | CheckpointStep
  | { kind: 'pending' }
  | { kind: 'done'; account: ConnectedAccount };

/** Corps de connection_start (noms du contrat, sans transformation). */
export interface StartConnectionInput {
  provider: ConnectionProviderId;
  mode?: 'hosted' | 'native';
  reconnect_account_id?: string;
  country?: string;
  locale?: string;
  timezone?: string;
  /** Où la personne reprend après la page de connexion ; le serveur le garde avec la tentative. */
  return_to?: 'onboarding';
  linkedin?: {
    products?: string[];
    method?: 'credentials' | 'cookie';
    username?: string;
    password?: string;
    access_token?: string;
    premium_access_token?: string;
    user_agent?: string;
  };
  whatsapp?: { method?: 'qr' | 'pairing'; phone_number?: string };
  imap?: {
    user: string;
    password: string;
    imap?: { host: string; port: number; encryption?: string };
    smtp?: { host: string; port: number; encryption?: string };
  };
}

export interface CheckpointInput {
  attemptId: string;
  /** Code saisi, ou identifiant du contrat choisi, ou offres cochées : selon le type d'étape. */
  code?: string;
  /** Méthode de vérification choisie (CHALLENGE_SELECTION). */
  challenge?: string;
  /** Étape sans saisie que la page affiche (QR_CODE, IN_APP_VALIDATION, LOADING) : le serveur la sonde. */
  waitingStep?: WaitingStep;
}

export type WaitingStep = 'QR_CODE' | 'IN_APP_VALIDATION' | 'LOADING';
export type AttemptStatus = 'pending' | 'completed' | 'failed' | 'expired' | 'cancelled';

export interface AttemptStatusView {
  status: AttemptStatus;
  provider: ConnectionProviderId | null;
  mode: 'hosted' | 'native' | null;
  account: { id: string; name: string; status: string } | null;
  next: ConnectionNext | null;
  /** Présents quand la tentative a échoué ou expiré. */
  errorCode: string | null;
  errorMessage: string | null;
  /** Destination gardée par le serveur avec la tentative (lancée depuis l'installation), sinon null. */
  returnTo: 'onboarding' | null;
}

export type ApiFailure = { ok: false; errorCode: string; message: string };
export type ApiOk<T> = { ok: true } & T;
/** Succès ou échec. Les appelants testent `result.ok === false` : le projet n'est pas en mode strict, où le test de vérité ne réduit pas l'union. */
export type ApiResult<T> = ApiOk<T> | ApiFailure;

const ACTION_FUNCTION = 'unipile-accounts';
const ATTEMPT_STATUSES: readonly AttemptStatus[] = ['pending', 'completed', 'failed', 'expired', 'cancelled'];
const PROVIDERS: readonly string[] = ['linkedin', 'whatsapp', 'google', 'outlook', 'imap'];

// ---------------------------------------------------------------------------
// Lecture des réponses
// ---------------------------------------------------------------------------

function record(value: unknown): LooseJson {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as LooseJson) : {};
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value !== '' ? value : undefined;
}

/** True pour une adresse https sans identifiants : la seule qu'un navigateur suit. */
export function isHttpsUrl(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password;
  } catch {
    return false;
  }
}

/** Étape suivante d'après la réponse du serveur ; `null` si la forme est inconnue. */
export function parseNext(raw: unknown): ConnectionNext | null {
  const r = record(raw);
  switch (r.kind) {
    case 'redirect':
      return isHttpsUrl(r.url) ? { kind: 'redirect', url: r.url } : null;
    case 'qrcode':
      return text(r.qrcode) ? { kind: 'qrcode', qrcode: r.qrcode } : null;
    case 'pending':
      return { kind: 'pending' };
    case 'done': {
      const a = record(r.account);
      if (!text(a.id)) return null;
      return {
        kind: 'done',
        account: {
          id: a.id,
          provider: text(a.provider) ?? '',
          name: text(a.name) ?? '',
          status: text(a.status) ?? 'OK',
        },
      };
    }
    case 'checkpoint': {
      const type = text(r.type);
      if (!type) return null;
      const step: CheckpointStep = { kind: 'checkpoint', type: type.toUpperCase() };
      if (text(r.channel)) step.channel = r.channel;
      if (text(r.platform)) step.platform = r.platform;
      if (text(r.code)) step.code = r.code;
      if (Array.isArray(r.challenges)) {
        step.challenges = r.challenges
          .filter((c: unknown) => text(record(c).id))
          .map((c: LooseJson) => ({
            id: c.id as string,
            label: text(c.label) ?? (c.id as string),
            ...(text(c.description) ? { description: c.description as string } : {}),
          }));
      }
      if (Array.isArray(r.contracts)) {
        step.contracts = r.contracts
          .filter((c: unknown) => text(record(c).id))
          .map((c: LooseJson) => ({ id: c.id as string, name: text(c.name) ?? (c.id as string) }));
      }
      if (Array.isArray(r.products)) {
        step.products = r.products
          .filter((p: unknown) => text(record(p).id))
          .map((p: LooseJson) => ({ id: p.id as string, display_name: text(p.display_name) ?? (p.id as string) }));
      }
      if (r.captcha && typeof r.captcha === 'object') {
        const c = record(r.captcha);
        step.captcha = { public_key: text(c.public_key) ?? null, data: text(c.data) ?? null };
      }
      return step;
    }
    default:
      return null;
  }
}

/** Code d'un échec : celui du serveur, sinon d'après le statut HTTP, sinon « réseau perdu ». */
export function failureCode(result: InvokeResult): string {
  const data = record(result.data);
  const fromBody = text(data.error_code);
  if (fromBody) return fromBody;
  const error = result.error;
  if (error?.code) return error.code;
  const status = error?.status;
  if (status === undefined) return NETWORK_LOST_CODE;
  if (status === 403) return 'forbidden';
  if (status === 404) return 'not_found';
  if (status === 429) return 'rate_limited';
  if (status >= 500) return 'server';
  return 'unknown';
}

function failure(result: InvokeResult, provider: ConnectionProviderId | undefined, phase: ConnectionPhase): ApiFailure {
  const code = failureCode(result);
  return { ok: false, errorCode: code, message: failureMessage(code, record(result.data).error, provider, phase) };
}

function succeeded(result: InvokeResult): boolean {
  return !result.error && record(result.data).success === true;
}

// ---------------------------------------------------------------------------
// Les six actions
// ---------------------------------------------------------------------------

export interface ConnectionApi {
  capabilities(): Promise<ApiResult<{ capabilities: ConnectionCapabilities }>>;
  start(input: StartConnectionInput): Promise<ApiResult<{ attemptId: string; mode: 'hosted' | 'native'; next: ConnectionNext }>>;
  checkpoint(input: CheckpointInput, provider?: ConnectionProviderId): Promise<ApiResult<{ next: ConnectionNext }>>;
  resend(input: { attemptId: string; challenge?: string }, provider?: ConnectionProviderId): Promise<ApiResult<{ next: ConnectionNext | null }>>;
  status(attemptId: string, waitingStep?: WaitingStep): Promise<ApiResult<{ view: AttemptStatusView }>>;
  cancel(attemptId: string): Promise<ApiResult<unknown>>;
}

/**
 * Les appels de connexion sur une fonction d'appel donnée. `organizationId`
 * est transmis tel quel quand il est connu ; sinon l'appelant par défaut
 * (invokeEdgeFunction) ajoute l'organisation active.
 */
export function createConnectionApi(invoke: InvokeFn, organizationId?: string | null): ConnectionApi {
  const call = (action: string, body: Record<string, unknown> = {}) =>
    invoke(ACTION_FUNCTION, { action, ...(organizationId ? { organization_id: organizationId } : {}), ...body });

  return {
    async capabilities() {
      const result = await call('connection_capabilities');
      if (!succeeded(result)) return failure(result, undefined, 'start');
      const d = record(result.data);
      const native = record(d.native);
      const hosted = record(d.hosted);
      return {
        ok: true,
        capabilities: {
          hosted: { available: hosted.available !== false, whiteLabel: hosted.white_label === true },
          native: {
            linkedin: native.linkedin === true,
            whatsapp: native.whatsapp === true,
            imap: native.imap === true,
            oauth: native.oauth === true,
          },
          recruiterExclusiveWithSalesNavigator: record(d.products).recruiter_exclusive_with_sales_navigator !== false,
        },
      };
    },

    async start(input) {
      const result = await call('connection_start', { ...input });
      if (!succeeded(result)) return failure(result, input.provider, 'start');
      const d = record(result.data);
      const next = parseNext(d.next);
      const attemptId = text(d.attempt_id);
      if (!next || !attemptId) return { ok: false, errorCode: 'unknown', message: connectionErrorMessage('unknown', input.provider) };
      return { ok: true, attemptId, mode: d.mode === 'native' ? 'native' : 'hosted', next };
    },

    async checkpoint(input, provider) {
      const body: Record<string, unknown> = { attempt_id: input.attemptId };
      if (input.code !== undefined) body.code = input.code;
      if (input.challenge !== undefined) body.challenge = input.challenge;
      if (input.waitingStep) body.waiting_step = input.waitingStep;
      const result = await call('connection_checkpoint', body);
      if (!succeeded(result)) return failure(result, provider, 'checkpoint');
      const next = parseNext(record(result.data).next);
      if (!next) return { ok: false, errorCode: 'unknown', message: connectionErrorMessage('unknown', provider, 'checkpoint') };
      return { ok: true, next };
    },

    async resend(input, provider) {
      const result = await call('connection_resend', {
        attempt_id: input.attemptId,
        ...(input.challenge ? { challenge: input.challenge } : {}),
      });
      if (!succeeded(result)) return failure(result, provider, 'checkpoint');
      return { ok: true, next: parseNext(record(result.data).next) };
    },

    async status(attemptId, waitingStep) {
      const result = await call('connection_status', {
        attempt_id: attemptId,
        ...(waitingStep ? { waiting_step: waitingStep } : {}),
      });
      if (!succeeded(result)) return failure(result, undefined, 'status');
      const d = record(result.data);
      const status = ATTEMPT_STATUSES.find((s) => s === d.status);
      if (!status) return { ok: false, errorCode: 'unknown', message: connectionErrorMessage('unknown') };
      const provider = PROVIDERS.includes(d.provider) ? (d.provider as ConnectionProviderId) : null;
      const account = record(d.account);
      const errorCode = text(d.error_code) ?? null;
      return {
        ok: true,
        view: {
          status,
          provider,
          mode: d.mode === 'native' ? 'native' : d.mode === 'hosted' ? 'hosted' : null,
          account: text(account.id)
            ? { id: account.id as string, name: text(account.name) ?? '', status: text(account.status) ?? 'OK' }
            : null,
          next: parseNext(d.next),
          errorCode,
          errorMessage: status === 'failed' || status === 'expired'
            ? failureMessage(errorCode, d.error, provider ?? 'linkedin', 'status')
            : null,
          returnTo: d.return_to === 'onboarding' ? 'onboarding' : null,
        },
      };
    },

    async cancel(attemptId) {
      const result = await call('connection_cancel', { attempt_id: attemptId });
      if (!succeeded(result)) return failure(result, undefined, 'status');
      return { ok: true };
    },
  };
}

// ---------------------------------------------------------------------------
// Suivi d'une tentative
// ---------------------------------------------------------------------------

export type PollResult =
  | { kind: 'settled'; view: AttemptStatusView }
  | { kind: 'timeout'; view: AttemptStatusView | null }
  | { kind: 'aborted' }
  | { kind: 'error'; failure: ApiFailure };

export interface PollOptions {
  status: ConnectionApi['status'];
  attemptId: string;
  waitingStep?: WaitingStep;
  /** Arrête le suivi (démontage de l'écran, annulation). */
  signal?: AbortSignal;
  /** Appelé à chaque lecture réussie, y compris tant que la tentative est en cours. */
  onUpdate?: (view: AttemptStatusView) => void;
  /** Durée maximale du suivi, en ms. */
  timeoutMs?: number;
  /** Lectures ratées de suite tolérées avant d'abandonner. */
  maxConsecutiveFailures?: number;
  /** Attente entre deux lectures (remplaçable en test). */
  sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
  now?: () => number;
}

export const POLL_TIMEOUT_MS = 45_000;

/** Délai avant la lecture suivante : 2 s au début, puis 4 s. */
export function pollDelay(readIndex: number): number {
  return readIndex < 10 ? 2000 : 4000;
}

function defaultSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Lit l'état d'une tentative jusqu'à ce qu'elle ne soit plus « en cours »
 * (réussie, échouée, expirée, annulée), que le temps soit écoulé ou que le suivi
 * soit arrêté. Une lecture ratée est retentée ; trop de suite : abandon avec
 * l'échec.
 */
export async function pollAttempt(options: PollOptions): Promise<PollResult> {
  const sleep = options.sleep ?? defaultSleep;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? POLL_TIMEOUT_MS;
  const maxFailures = options.maxConsecutiveFailures ?? 3;
  const startedAt = now();
  let last: AttemptStatusView | null = null;
  let failures = 0;
  let reads = 0;

  while (!options.signal?.aborted) {
    const result = await options.status(options.attemptId, options.waitingStep);
    if (options.signal?.aborted) break;
    if (result.ok === false) {
      // Tentative introuvable ou refusée : inutile de retenter.
      if (result.errorCode === 'attempt_not_found' || result.errorCode === 'forbidden') return { kind: 'error', failure: result };
      failures += 1;
      if (failures >= maxFailures) return { kind: 'error', failure: result };
    } else {
      failures = 0;
      last = result.view;
      options.onUpdate?.(result.view);
      if (result.view.status !== 'pending') return { kind: 'settled', view: result.view };
    }
    const wait = pollDelay(reads);
    reads += 1;
    if (now() - startedAt + wait > timeoutMs) return { kind: 'timeout', view: last };
    await sleep(wait, options.signal);
  }
  return { kind: 'aborted' };
}

// ---------------------------------------------------------------------------
// Aides du navigateur
// ---------------------------------------------------------------------------

/**
 * Envoie l'onglet courant vers une page de connexion. Même onglet : une fenêtre
 * ouverte après une attente réseau serait bloquée. Refuse toute adresse qui
 * n'est pas en https.
 */
export function goToProvider(url: string, navigate: (url: string) => void = (u) => window.location.assign(u)): boolean {
  if (!isHttpsUrl(url)) return false;
  navigate(url);
  return true;
}

/** Agent utilisateur du navigateur, requis par la connexion par cookie (c'est celui qui détient la session). */
export function browserUserAgent(): string | undefined {
  if (typeof navigator === 'undefined') return undefined;
  const ua = navigator.userAgent;
  return typeof ua === 'string' && ua.length >= 20 ? ua : undefined;
}

/** Fuseau horaire du navigateur (nom IANA), transmis à la connexion pour les actions programmées. */
export function browserTimezone(): string | undefined {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === 'string' && zone !== '' ? zone : undefined;
  } catch {
    return undefined;
  }
}

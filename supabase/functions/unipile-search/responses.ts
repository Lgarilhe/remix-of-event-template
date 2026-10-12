/**
 * Réponses HTTP de unipile-search : en-têtes CORS, corps JSON et traduction des
 * erreurs du client partagé du prestataire en réponses Konekt.
 *
 * Règle de marque : aucun texte du prestataire n'atteint un utilisateur. Le
 * message d'une réponse vient de `userSafeMessage` ou d'un texte français écrit
 * ici ; le corps brut du prestataire reste dans les journaux du serveur
 * (`describeForLog`). `errorType` garde les valeurs que le navigateur lit déjà
 * (RATE_LIMIT, QUOTA, CONTENT_TOO_LARGE, ACCOUNT_NOT_LINKED) et en ajoute pour les
 * états de compte v2 (ACCOUNT_DISCONNECTED, ACCOUNT_DEGRADED).
 */

import { describeForLog, isUnipileError, userSafeMessage, type ErrorKind } from '../_shared/unipile/index.ts';

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
}

/** Erreur d'entrée client → réponse 4xx (jamais 500). */
export class UnipileInputError extends Error {
  status: number;
  constructor(message: string, status = 400, public code?: string) {
    super(message);
    this.status = status;
  }
}

/** Texte rendu quand une exception inattendue remonte : jamais le texte de l'exception. */
export const INTERNAL_ERROR_MESSAGE = 'Une erreur interne est survenue. Veuillez réessayer dans quelques instants.';

const RATE_LIMIT_MESSAGE = 'Limite LinkedIn atteinte. Espacez vos requêtes et réessayez plus tard.';
const TOO_LARGE_MESSAGE = 'La requête est trop volumineuse. Essayez de réduire les mots-clés ou les filtres.';

export interface Failure {
  status: number;
  errorType: string;
  error: string;
  retryAfter?: number;
}

export interface FailureOptions {
  /** Texte d'une demande refusée (kind validation), propre à l'action. */
  validationMessage?: string;
  /** Texte d'un élément introuvable, propre à l'action. */
  notFoundMessage?: string;
}

/** Vrai quand le refus du prestataire dit que le contenu est trop gros (code ou texte du corps). */
function isTooLarge(error: { debug: { code: string | null; body: unknown } }): boolean {
  const code = (error.debug.code ?? '').replace(/[_/.-]+/g, ' ');
  if (/content too large/.test(code)) return true;
  const body = error.debug.body;
  const text = typeof body === 'string' ? body : body && typeof body === 'object' ? JSON.stringify(body) : '';
  return /content[_ -]?too[_ -]?large/i.test(text);
}

/** Traduit un `ErrorKind` en statut HTTP, `errorType` et message français. */
export function failureOf(kind: ErrorKind, options: FailureOptions = {}, tooLarge = false): Failure {
  switch (kind) {
    case 'rate_limited':
    case 'provider_limit':
      return { status: 429, errorType: 'RATE_LIMIT', error: RATE_LIMIT_MESSAGE, retryAfter: 60 };
    case 'validation':
      return tooLarge
        ? { status: 400, errorType: 'CONTENT_TOO_LARGE', error: TOO_LARGE_MESSAGE }
        : { status: 400, errorType: 'INVALID_REQUEST', error: options.validationMessage ?? userSafeMessage('validation') };
    case 'account_disconnected':
      return { status: 502, errorType: 'ACCOUNT_DISCONNECTED', error: userSafeMessage(kind) };
    case 'account_degraded':
      return { status: 502, errorType: 'ACCOUNT_DEGRADED', error: userSafeMessage(kind) };
    case 'uncertain':
      return { status: 502, errorType: 'UNCERTAIN', error: userSafeMessage(kind) };
    case 'config':
      return { status: 500, errorType: 'NOT_CONFIGURED', error: userSafeMessage(kind) };
    case 'not_found':
      return { status: 502, errorType: 'NOT_FOUND', error: options.notFoundMessage ?? userSafeMessage(kind) };
    default:
      return { status: 502, errorType: 'PROVIDER_ERROR', error: userSafeMessage(kind) };
  }
}

/**
 * Statut et corps d'échec pour une exception de l'action `action`. Une erreur du
 * client partagé est traduite (le corps du prestataire va dans le journal du
 * serveur) ; toute autre exception est une erreur interne au texte neutre.
 */
export function failureParts(
  error: unknown,
  action: string,
  options: FailureOptions = {},
  extra: Record<string, unknown> = {},
): { status: number; body: Record<string, unknown> } {
  console.error(`[unipile-search] ${action}: ${describeForLog(error)}`);
  if (!isUnipileError(error)) {
    return { status: 500, body: { success: false, error: INTERNAL_ERROR_MESSAGE, errorType: 'INTERNAL', ...extra } };
  }
  const failure = failureOf(error.kind, options, error.kind === 'validation' && isTooLarge(error));
  return {
    status: failure.status,
    body: {
      success: false,
      error: failure.error,
      errorType: failure.errorType,
      ...(failure.retryAfter !== undefined ? { retryAfter: failure.retryAfter } : {}),
      ...extra,
    },
  };
}

/** Réponse HTTP d'échec (voir `failureParts`). */
export function failureResponse(error: unknown, action: string, options: FailureOptions = {}, extra: Record<string, unknown> = {}): Response {
  const { status, body } = failureParts(error, action, options, extra);
  return json(body, status);
}

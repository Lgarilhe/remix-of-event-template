/**
 * Erreurs d'authentification en français : ce qui s'est passé et quoi faire,
 * jamais le message brut du service (« Invalid login credentials »).
 * Le code de l'erreur est lu en premier, le texte anglais sert de repli.
 */

const WRONG_CREDENTIALS = 'E-mail ou mot de passe incorrect. Vérifiez votre saisie, puis réessayez.';
const NOT_CONFIRMED = "Votre adresse n'est pas encore confirmée : ouvrez le lien reçu par e-mail, puis connectez-vous.";
const ALREADY_REGISTERED = 'Un compte existe déjà avec cette adresse. Connectez-vous, ou réinitialisez votre mot de passe.';
const WEAK_PASSWORD = 'Ce mot de passe est trop facile à deviner : choisissez-en un plus long, avec des lettres et des chiffres.';
const SAME_PASSWORD = "Choisissez un mot de passe différent de l'ancien.";
const TOO_MANY = 'Trop de tentatives en peu de temps. Patientez une minute, puis réessayez.';
const INVALID_EMAIL = "Cette adresse e-mail n'est pas valide. Vérifiez-la, puis réessayez.";
const SIGNUP_CLOSED = 'Les inscriptions sont fermées pour le moment.';
const LINK_EXPIRED = 'Ce lien a expiré. Demandez-en un nouveau.';
const NETWORK = 'Le service de connexion ne répond pas. Vérifiez votre connexion internet, puis réessayez.';
const FALLBACK = 'Une erreur est survenue. Réessayez dans un instant.';

const BY_CODE: Record<string, string> = {
  invalid_credentials: WRONG_CREDENTIALS,
  email_not_confirmed: NOT_CONFIRMED,
  user_already_exists: ALREADY_REGISTERED,
  email_exists: ALREADY_REGISTERED,
  weak_password: WEAK_PASSWORD,
  same_password: SAME_PASSWORD,
  over_email_send_rate_limit: TOO_MANY,
  over_request_rate_limit: TOO_MANY,
  email_address_invalid: INVALID_EMAIL,
  signup_disabled: SIGNUP_CLOSED,
  email_provider_disabled: SIGNUP_CLOSED,
  otp_expired: LINK_EXPIRED,
  flow_state_expired: LINK_EXPIRED,
};

const BY_MESSAGE: [RegExp, string | ((match: RegExpMatchArray) => string)][] = [
  [/invalid login credentials/i, WRONG_CREDENTIALS],
  [/email not confirmed/i, NOT_CONFIRMED],
  [/already (registered|been registered|exists)/i, ALREADY_REGISTERED],
  [/password should be at least (\d+)/i, (m) => `Le mot de passe doit contenir au moins ${m[1]} caractères.`],
  [/different from the old password/i, SAME_PASSWORD],
  [/weak|pwned|known to be/i, WEAK_PASSWORD],
  [/rate limit|too many requests|only request this after/i, TOO_MANY],
  [/unable to validate email|invalid format|invalid email/i, INVALID_EMAIL],
  [/signups? not allowed|signup is disabled/i, SIGNUP_CLOSED],
  [/expired/i, LINK_EXPIRED],
  [/failed to fetch|fetch failed|networkerror|load failed|network request failed/i, NETWORK],
];

export function authErrorMessage(error: unknown): string {
  const err = (error ?? {}) as { code?: unknown; message?: unknown; name?: unknown; status?: unknown };
  const code = typeof err.code === 'string' ? err.code : '';
  if (code && BY_CODE[code]) return BY_CODE[code];
  if (err.name === 'AuthRetryableFetchError') return NETWORK;
  if (err.status === 429) return TOO_MANY;
  const message = typeof err.message === 'string' ? err.message : '';
  for (const [pattern, text] of BY_MESSAGE) {
    const match = message.match(pattern);
    if (match) return typeof text === 'function' ? text(match) : text;
  }
  return FALLBACK;
}

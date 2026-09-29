/**
 * Prénom proposé à l'ouverture de l'onboarding. L'inscription ne demande pas de
 * nom : sans réponse de l'utilisateur, les messages rédigés par l'IA seraient
 * signés du début de l'adresse e-mail (useSenderFirstName).
 */

const GENERIC_LOCAL_PARTS = new Set([
  'contact', 'info', 'infos', 'hello', 'bonjour', 'admin', 'office', 'team', 'equipe', 'recrutement',
  'rh', 'hr', 'jobs', 'job', 'careers', 'carrieres', 'support', 'sales', 'noreply', 'compta', 'direction',
]);

const NAME_PATTERN = /^[\p{L}][\p{L}'’-]{1,29}$/u;

function capitalize(word: string): string {
  return word.charAt(0).toLocaleUpperCase('fr-FR') + word.slice(1).toLocaleLowerCase('fr-FR');
}

function cleanToken(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  const token = raw.trim().split(/\s+/)[0] ?? '';
  return NAME_PATTERN.test(token) ? capitalize(token) : '';
}

/**
 * Métadonnées du compte d'abord (prénom, puis nom complet), puis le début de
 * l'adresse e-mail quand elle a la forme « prenom.nom@ ». Une adresse sans
 * séparateur (« lgarilhe@ ») ou générique (« contact@ ») ne donne rien : mieux
 * vaut un champ vide qu'un prénom inventé.
 */
export function guessFirstName(input: { metadata?: Record<string, unknown> | null; email?: string | null }): string {
  const meta = input.metadata ?? {};
  for (const key of ['first_name', 'given_name', 'full_name', 'name']) {
    const fromMeta = cleanToken(meta[key]);
    if (fromMeta) return fromMeta;
  }
  const local = (input.email ?? '').split('@')[0]?.toLowerCase() ?? '';
  const tokens = local.split(/[._+-]/).filter(Boolean);
  if (tokens.length < 2) return '';
  const first = tokens[0];
  if (GENERIC_LOCAL_PARTS.has(first) || /\d/.test(first)) return '';
  return cleanToken(first);
}

/** Prénom nettoyé pour l'enregistrer : espaces réduits, première lettre en capitale. */
export function normalizeFirstName(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, ' ');
  if (!cleaned) return '';
  return cleaned
    .split(' ')
    .map((part) => part.split('-').map(capitalize).join('-'))
    .join(' ');
}

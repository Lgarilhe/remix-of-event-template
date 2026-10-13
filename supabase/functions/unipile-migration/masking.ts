/**
 * Libellés masqués des comptes pour l'écran de bascule.
 *
 * L'écran doit permettre de reconnaître un compte sans jamais rendre une adresse
 * e-mail entière, un numéro de téléphone ou un nom complet. Règles :
 *  - adresse e-mail : première lettre, trois étoiles, domaine (« j***@acme.fr ») ;
 *  - numéro de téléphone : aucun chiffre (« numéro masqué ») ;
 *  - autre libellé (nom d'un compte) : première lettre de chaque mot suivie de trois étoiles ;
 *  - rien de lisible : null.
 * `idRef` ne rend que la fin d'un identifiant de compte, pour distinguer deux comptes
 * au libellé identique.
 *
 * Module pur.
 */

const EMAIL_RE = /^([^\s@])[^\s@]*@([^\s@]+\.[^\s@]+)$/;

function looksLikePhone(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return digits.length >= 6 && /^[+()\d\s.\-]+$/.test(value.trim());
}

/** Libellé masqué d'un compte, ou null quand il n'y a rien à montrer. */
export function maskLabel(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const value = raw.trim();
  if (value === '') return null;
  const email = EMAIL_RE.exec(value);
  if (email) return `${email[1].toLowerCase()}***@${email[2].toLowerCase()}`;
  if (value.includes('@')) return '***';
  if (looksLikePhone(value)) return 'numéro masqué';
  const words = value.split(/\s+/).filter(Boolean).slice(0, 4);
  return words.map((word) => `${Array.from(word)[0]}***`).join(' ');
}

/** Fin d'un identifiant de compte (quatre derniers caractères), précédée de « … ». */
export function idRef(id: unknown): string {
  if (typeof id !== 'string' || id === '') return '…';
  return `…${id.slice(-4)}`;
}

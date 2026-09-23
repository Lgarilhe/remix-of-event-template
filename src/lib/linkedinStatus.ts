/**
 * État du compte LinkedIn d'UN utilisateur. Source unique pour Paramètres
 * (MyLinkedInAccount), le tableau de bord et la barre latérale
 * (useDashboardConnections), l'alerte de déconnexion (LinkedInAccountsContext),
 * puis « À traiter » quand l'onglet existera.
 * Règle : liaison stricte par user_id (member_linkedin_accounts), jamais de
 * repli sur un autre compte de l'organisation.
 * Statuts rencontrés dans le code au 2026-09-23 :
 * - liste live (unipile-accounts, action list) : OK, CONNECTING, CREDENTIALS,
 *   ERROR, STOPPED, PERMISSIONS, et UNKNOWN pour un compte sans source ;
 * - member_linkedin_accounts.account_status : les mêmes, plus PAUSED (API v2)
 *   et DELETED (doc citée par le webhook) ;
 * - statuts d'événement (RECONNECTED, SYNC_SUCCESS, CREATION_SUCCESS),
 *   normalement ramenés à OK par le webhook : acceptés par sécurité ;
 * - lus par le front sans producteur connu : CONNECTED, DISCONNECTED,
 *   RATE_LIMITED, CAPTCHA.
 * Module pur, sans import : testé par tests/ux/linkedin-status.test.mjs.
 */
export type LinkedInHealth = 'connected' | 'connecting' | 'needs_reconnect' | 'unknown';
/** load_error : lecture ratée (liaisons, ou liste pour un utilisateur relié) sans donnée reçue à montrer. */
export type MyLinkedInState = 'loading' | 'load_error' | 'not_linked' | 'missing' | LinkedInHealth;

const CONNECTED = new Set(['OK', 'CONNECTED', 'RECONNECTED', 'SYNC_SUCCESS', 'CREATION_SUCCESS']);
const CONNECTING = new Set(['CONNECTING']);
const NEEDS_RECONNECT = new Set(['CREDENTIALS', 'ERROR', 'STOPPED', 'PERMISSIONS', 'DELETED', 'DISCONNECTED', 'CAPTCHA']);

/** UNKNOWN, PAUSED, RATE_LIMITED, vide ou valeur nouvelle : 'unknown', jamais une panne. */
export function classifyLinkedInStatus(raw: string | null | undefined): LinkedInHealth {
  const s = typeof raw === 'string' ? raw.trim().toUpperCase() : '';
  if (CONNECTED.has(s)) return 'connected';
  if (CONNECTING.has(s)) return 'connecting';
  if (NEEDS_RECONNECT.has(s)) return 'needs_reconnect';
  return 'unknown';
}

export interface LinkedInMappingLike { user_id: string; linkedin_account_id: string; account_status?: string | null }
export interface LinkedInAccountLike { id: string; status?: string | null }

export interface MyLinkedInStatus<M, A> {
  state: MyLinkedInState;
  mapping: M | null;
  account: A | null;
  /** Statut du compte listé, sinon celui enregistré sur la liaison. */
  rawStatus: string | null;
  isUsable: boolean;
  /** À reconnecter, ou compte disparu à dissocier. */
  needsAction: boolean;
}

export function resolveMyLinkedInStatus<M extends LinkedInMappingLike, A extends LinkedInAccountLike>(input: {
  userId: string | null | undefined;
  mappings: readonly M[];
  /** Liaisons lues avec succès (une requête désactivée ou en erreur ne compte pas). */
  mappingsLoaded: boolean;
  /** Lecture des liaisons en échec, aucune liaison reçue : erreur plutôt qu'un chargement sans fin. */
  mappingsFailed?: boolean;
  accounts: readonly A[];
  /** Liste reçue du serveur au moins une fois (un échec ne compte pas). */
  accountsLoaded: boolean;
  /** Dernière lecture de la liste en échec. Ignoré dès qu'une liste a été reçue (accountsLoaded). */
  accountsFailed?: boolean;
}): MyLinkedInStatus<M, A> {
  const { userId, mappings, mappingsLoaded, accounts, accountsLoaded } = input;
  const mapping = userId ? mappings.find((m) => m.user_id === userId) ?? null : null;
  const account = mapping ? accounts.find((a) => a.id === mapping.linkedin_account_id) ?? null : null;
  let state: MyLinkedInState;
  if (!userId) state = 'loading';
  else if (!mappingsLoaded) state = input.mappingsFailed ? 'load_error' : 'loading';
  else if (!mapping) state = 'not_linked';
  else if (account) state = classifyLinkedInStatus(account.status);
  else if (accountsLoaded) state = 'missing';
  else state = input.accountsFailed ? 'load_error' : 'loading';
  return {
    state, mapping, account,
    rawStatus: account?.status ?? mapping?.account_status ?? null,
    isUsable: state === 'connected',
    needsAction: state === 'needs_reconnect' || state === 'missing',
  };
}

/** Vers les 4 états des cartes du tableau de bord (ConnectionStatus). */
export function channelStatusOf(state: MyLinkedInState): 'connected' | 'error' | 'connecting' | 'disconnected' {
  switch (state) {
    case 'connected': return 'connected';
    case 'needs_reconnect':
    case 'missing': return 'error';
    case 'not_linked': return 'disconnected';
    default: return 'connecting'; // loading, load_error, connecting, unknown : ni panne du compte ni succès
  }
}

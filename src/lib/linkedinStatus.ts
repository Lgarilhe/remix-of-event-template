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
 *   RATE_LIMITED, CAPTCHA ;
 * - API v2 (statuts écrits par le webhook et la liste, voir le module de
 *   statuts du client partagé) : OK, CREDENTIALS, ERROR, DEGRADED, PARTIAL et
 *   LOCKED ; les statuts bruts du compte (running, errored, disconnected,
 *   degraded, partial) sont acceptés par sécurité.
 *
 * Six classes de santé, communes aux trois canaux (contrat de connexion, § 4) :
 * - connected (OK) ;
 * - limited (DEGRADED seul) : un produit en erreur, nouvelle tentative
 *   automatique, pas de bouton « Reconnecter ». PARTIAL (un produit demande une
 *   nouvelle authentification) n'en fait pas partie : le serveur le dit
 *   reconnectable et les envois restent arrêtés, donc needs_reconnect ;
 * - locked (LOCKED) : accès suspendu, se reconnecter n'y change rien ;
 * - needs_reconnect (CREDENTIALS, PARTIAL, ERROR et statuts proches) : « Reconnecter » ;
 * - syncing : compte relié dont la première synchronisation est en cours ;
 * - not_connected : aucun compte relié (état « not_linked » d'une carte).
 * connecting (CONNECTING) et unknown (valeur absente ou nouvelle, jamais une
 * panne) complètent la liste.
 * Module pur, sans import : testé par tests/ux/linkedin-status.test.mjs et
 * tests/ux/connexion-sante.test.mjs.
 */
export type ConnectionHealth =
  | 'connected'
  | 'syncing'
  | 'connecting'
  | 'limited'
  | 'locked'
  | 'needs_reconnect'
  | 'not_connected'
  | 'unknown';
/** Classe d'un compte qui existe : tout sauf « not_connected ». */
export type LinkedInHealth = Exclude<ConnectionHealth, 'not_connected'>;
/** load_error : lecture ratée (liaisons, ou liste pour un utilisateur relié) sans donnée reçue à montrer. */
export type MyLinkedInState = 'loading' | 'load_error' | 'not_linked' | 'missing' | LinkedInHealth;

const CONNECTED = new Set(['OK', 'CONNECTED', 'RECONNECTED', 'SYNC_SUCCESS', 'CREATION_SUCCESS', 'RUNNING']);
const CONNECTING = new Set(['CONNECTING']);
const LIMITED = new Set(['DEGRADED']);
const NEEDS_RECONNECT = new Set([
  'CREDENTIALS', 'PARTIAL', 'ERROR', 'STOPPED', 'PERMISSIONS', 'DELETED', 'DISCONNECTED', 'CAPTCHA', 'ERRORED',
]);
/** État de la première synchronisation (champ initial_sync_status de la liste) qui n'est pas terminé. */
const SYNC_IN_PROGRESS = new Set(['PENDING', 'RUNNING', 'SYNCING']);

export interface HealthInput {
  /** Statut Konekt (OK, CREDENTIALS...) ou statut brut du compte. */
  status: string | null | undefined;
  /** Accès suspendu (champ is_locked de la liste) : l'emporte sauf sur une session à renouveler. */
  isLocked?: boolean | null;
  /** Première synchronisation (initial_sync_status) : un compte actif qui synchronise passe en « syncing ». */
  sync?: string | null;
}

/**
 * Classe de santé d'un compte, pour un canal quelconque. Une valeur absente ou
 * nouvelle donne 'unknown', jamais une panne. Un compte à reconnecter le reste
 * même verrouillé (la reconnexion est le seul geste utile) ; un compte actif
 * verrouillé est 'locked' ; la synchronisation ne masque que l'état actif.
 */
export function classifyConnectionHealth(input: HealthInput): LinkedInHealth {
  const s = typeof input.status === 'string' ? input.status.trim().toUpperCase() : '';
  if (NEEDS_RECONNECT.has(s)) return 'needs_reconnect';
  if (s === 'LOCKED' || input.isLocked === true) return 'locked';
  if (LIMITED.has(s)) return 'limited';
  if (CONNECTING.has(s)) return 'connecting';
  if (CONNECTED.has(s)) {
    const sync = typeof input.sync === 'string' ? input.sync.trim().toUpperCase() : '';
    return SYNC_IN_PROGRESS.has(sync) ? 'syncing' : 'connected';
  }
  return 'unknown';
}

/** Statut seul, sans verrou ni synchronisation : ce que lisent les cartes et l'alerte de déconnexion. */
export function classifyLinkedInStatus(raw: string | null | undefined): LinkedInHealth {
  return classifyConnectionHealth({ status: raw });
}

/** Un compte qui peut envoyer : actif, ou actif et en première synchronisation. */
export function isHealthUsable(health: ConnectionHealth): boolean {
  return health === 'connected' || health === 'syncing';
}

/**
 * Alerte de déconnexion : à lever quand un compte qui servait (ou tournait au ralenti)
 * passe à « à reconnecter » ou « suspendu ». Une connexion limitée qui finit en
 * panne alerte aussi : sans cela, la personne ignore que les envois se sont arrêtés.
 * Un état inconnu ou en cours de connexion n'alerte jamais, ni un passage de
 * « à reconnecter » à « suspendu » (déjà signalé).
 */
export function disconnectionAlertFor(previous: ConnectionHealth, next: ConnectionHealth): 'needs_reconnect' | 'locked' | null {
  if (next !== 'needs_reconnect' && next !== 'locked') return null;
  return previous === 'connected' || previous === 'syncing' || previous === 'limited' ? next : null;
}

/** Classe de santé d'un état de carte (chargement et lecture ratée : 'unknown', compte disparu : à reconnecter). */
export function healthOfState(state: MyLinkedInState): ConnectionHealth {
  switch (state) {
    case 'not_linked': return 'not_connected';
    case 'missing': return 'needs_reconnect';
    case 'loading':
    case 'load_error': return 'unknown';
    default: return state;
  }
}

export interface LinkedInMappingLike { user_id: string; linkedin_account_id: string; account_status?: string | null }
export interface LinkedInAccountLike {
  id: string;
  status?: string | null;
  is_locked?: boolean | null;
  /** Première synchronisation (champ initial_sync_status de la liste) : un compte actif qui synchronise est « syncing ». */
  initial_sync_status?: string | null;
}

export interface MyLinkedInStatus<M, A> {
  state: MyLinkedInState;
  mapping: M | null;
  account: A | null;
  /** Statut du compte listé, sinon celui enregistré sur la liaison. */
  rawStatus: string | null;
  /** Actif (ou actif en première synchronisation) : le compte peut servir. */
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
  else if (account) state = classifyConnectionHealth({ status: account.status, isLocked: account.is_locked, sync: account.initial_sync_status });
  else if (accountsLoaded) state = 'missing';
  else state = input.accountsFailed ? 'load_error' : 'loading';
  return {
    state, mapping, account,
    rawStatus: account?.status ?? mapping?.account_status ?? null,
    isUsable: state === 'connected' || state === 'syncing',
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
    // loading, load_error, connecting, syncing, limited, locked, unknown : ni panne que
    // « Reconnecter » répare, ni succès. Limitée : reprise automatique ; verrouillée : le support.
    default: return 'connecting';
  }
}

/**
 * Panne du compte LinkedIn de l'utilisateur, pour « À traiter » (D41).
 * - liaisons non reçues (ou utilisateur inconnu) → null (inconnu) ;
 * - aucune liaison à moi → false ;
 * - liste des comptes reçue → needsAction (à reconnecter, ou compte disparu) ;
 * - sinon → statut enregistré sur la liaison (écrit par le webhook) : une
 *   panne de la liste des comptes ne rend pas le chiffre inconnu.
 */
export function myLinkedInNeedsAction(input: Parameters<typeof resolveMyLinkedInStatus>[0]): boolean | null {
  const { userId, mappings, mappingsLoaded, accountsLoaded } = input;
  if (!userId || !mappingsLoaded) return null;
  const mapping = mappings.find((m) => m.user_id === userId);
  if (!mapping) return false;
  if (accountsLoaded) return resolveMyLinkedInStatus(input).needsAction;
  return classifyLinkedInStatus(mapping.account_status) === 'needs_reconnect';
}

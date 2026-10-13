// Deno.serve used directly
import { createClient, SupabaseClient } from "npm:@supabase/supabase-js@2.75.1";
import {
  accountChannelOf,
  describeForLog,
  flattenEnvelope,
  getAccount,
  getChat,
  getMessage,
  getProfile,
  handlerNameOf,
  isCandidateReplyCandidate,
  isV2AccountId,
  mapAccountRemoved,
  mapAccountStatus,
  normalizeEmail,
  verifyWebhookRequest,
  webhookDedupKey,
  webhookFallbackDedupKey,
  type KonektAccountStatus,
} from "../_shared/unipile/index.ts";
import { ACCOUNT_DISCONNECTED_PAUSE_REASON, ACCOUNT_DISCONNECTED_SKIP_REASON } from "../_shared/linkedin-quotas.ts";
import { stopLinkedInAccountSending } from "../_shared/linkedin-sending-stop.ts";
import { resumeDate } from "../_shared/sequence-resume.ts";
import { inReplyToCandidates } from "../_shared/sequence-email-policy.mjs";
import {
  cancelScheduledInMails,
  candidateSlugs,
  closeSiblingEnrollments,
  closedContactEnd,
  lateReplyEnrollments,
  linkedInSlugOf,
  replySiblingScope,
  type ReplyAnchor,
} from "../_shared/candidate-reply-closure.ts";
import { candidateRef, recordInbound, recordOwnMessage, type CandidateRef } from "../_shared/candidate-stage-events.ts";
import { isCandidateErasedForOrg } from "../_shared/get-or-fetch-contact.ts";
import { captureCandidateActionIncomingBestEffort } from "../_shared/candidate-actions/incoming.ts";
import { claimForAttempt, insertClaimNotification, providerKind, statusAtClaim } from "../_shared/connection-claim.ts";

// Récepteur des événements du service de connexion (API v2). Aucun en-tête
// d'authentification n'est lisible côté fournisseur à la création d'un point de
// terminaison : la seule authentification est le paramètre `?v2_token=` de l'URL,
// vérifié en temps constant par verifyWebhookRequest (échec fermé : jamais de
// livraison acceptée sans jeton valide).
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

/** webhook_event_log.event_type d'une clé dont le traitement a échoué et que la purge n'a pas pu retirer. */
const FAILED_EVENT_MARKER = 'processing_failed';
/** Statuts d'une liaison déjà en panne : une nouvelle panne ne prévient pas une seconde fois (SEQ-208). */
const ALREADY_BROKEN_STATUSES = new Set(['CREDENTIALS', 'ERROR', 'PERMISSIONS', 'DELETED', 'DISCONNECTED']);
/**
 * Statuts qu'un verrouillage (LOCKED) ne remplace jamais : une panne à reconnecter (le membre doit d'abord
 * reconnecter, la liaison garde son statut et sa notification) et LOCKED lui-même (déjà verrouillé : ni
 * écriture ni seconde notification, une seule fois par passage).
 */
const NO_LOCK_NOTICE_STATUSES = new Set([...ALREADY_BROKEN_STATUSES, 'LOCKED']);
/** PARTIAL n'est pas annoncé de nouveau à une liaison déjà en panne à reconnecter ni déjà PARTIAL. */
const NO_PARTIAL_NOTICE_STATUSES = new Set([...ALREADY_BROKEN_STATUSES, 'PARTIAL']);
/** Filtre PostgREST (.or) : liaisons sans statut, ou dont le statut n'est pas dans la liste. */
const statusNotIn = (statuses: Iterable<string>) => `account_status.is.null,account_status.not.in.(${[...statuses].join(',')})`;
/** Liaisons qu'un verrouillage remplace : sans statut, OK, DEGRADED, PARTIAL ou un statut inconnu. */
const LOCK_REPLACES_FILTER = statusNotIn(NO_LOCK_NOTICE_STATUSES);
/** Délai de la relecture de l'état d'un compte chez le prestataire : au-delà, l'événement est traité sans elle. */
const REREAD_DEADLINE_MS = 8_000;
/** Essais d'un passage d'état sur une liaison que d'autres événements font changer au même moment. */
const MAX_TRANSITION_ATTEMPTS = 25;
/**
 * Phrase de la carte de connexion pour PARTIAL (src/lib/connectionCopy.ts, `authentication_partial`, canal
 * LinkedIn), reprise mot pour mot : le bandeau, la ligne d'À traiter et cette notification disent la même chose.
 * Garde : tests/ux/etat-compte-alertes.test.mjs compare les deux textes.
 */
const PARTIAL_CONNECTION_SENTENCE = 'Une partie de la connexion LinkedIn demande une nouvelle authentification. Reconnectez le compte pour reprendre les envois.';

/**
 * Échec passager d'un événement d'état (lecture ou écriture de base en échec, relecture du compte impossible,
 * conflit d'écriture qui ne se résout pas) : l'événement n'est PAS appliqué, il ne doit donc pas être acquitté.
 * Elle remonte jusqu'au catch de handleRequest, qui libère la ligne de dédoublonnage (ou la marque en échec) et
 * répond 500 : le prestataire rejoue l'événement, et le rejeu est traité.
 */
class TransientEventError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, { cause });
    this.name = 'TransientEventError';
  }
}

/** L'erreur d'un passage d'état, rendue transitoire (message neutre : il est renvoyé dans le corps du 500). */
function transientFailure(error: unknown): TransientEventError {
  if (error instanceof TransientEventError) return error;
  console.warn('[unipile-webhook] Account status event not applied, the provider will redeliver it:', describeForLog(error));
  return new TransientEventError('Account status event not applied (transient failure), retry', error);
}

/** Mots de statut du prestataire (spécification des comptes) : un autre mot ne dit rien sur l'état du compte. */
const KNOWN_PROVIDER_STATUS_WORDS = new Set(['running', 'disconnected', 'errored', 'degraded', 'partial']);

// Timeout wrapper for the internal function calls (analyse, indexation)
function fetchWithTimeout(url: string, options: RequestInit = {}, timeoutMs = 15000): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return fetch(url, { ...options, signal: controller.signal }).finally(() => clearTimeout(timer));
}

// Sanitize IDs before interpolating into PostgREST filter strings (.or(), .like())
// Prevents filter injection via special characters (commas, dots, parens)
function sanitizeFilterId(id: string): string {
  return id.replace(/[^a-zA-Z0-9_\-:]/g, '');
}

/**
 * Exécute une recherche d'enrollments deux fois : sur `account_id` (compte
 * d'enrôlement) puis sur `assigned_sender_id` (compte réellement utilisé en
 * rotation multi-sender), et fusionne sans doublon.
 *
 * Sans le second passage, une réponse ou une acceptation reçue sur le compte
 * qui a réellement envoyé n'était rattachée à aucun enrollment : relances
 * envoyées après la réponse du candidat, wait_connection bloqué jusqu'au
 * timeout (BUG-023). Deux requêtes plutôt qu'un `or` : les appelants combinent
 * déjà un `or` sur le profil, et deux `or` dans une même requête PostgREST se
 * lisent mal.
 *
 * Erreur du second passage (SEQ-013) : tant que la migration qui passe
 * assigned_sender_id en texte n'est pas en base, la colonne est un uuid et un
 * identifiant de compte y lève 22P02 à chaque appel. Aucune ligne ne peut
 * alors porter ce compte : l'erreur est journalisée et le résultat du premier
 * passage est gardé (la remonter mettrait 100 % des webhooks en 500). Toute
 * autre erreur est remontée : l'appelant répond 500 et le prestataire rejoue.
 */
const UUID_COLUMN_ERROR = '22P02';

async function findEnrollmentsBySenderAccount<T extends { id: string }>(
  runQuery: (column: 'account_id' | 'assigned_sender_id') => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<{ rows: T[]; error: unknown }> {
  const byAccount = await runQuery('account_id');
  if (byAccount.error) return { rows: [], error: byAccount.error };
  const bySender = await runQuery('assigned_sender_id');
  if (bySender.error) {
    if ((bySender.error as { code?: string } | null)?.code === UUID_COLUMN_ERROR) {
      console.warn('[unipile-webhook] assigned_sender_id lookup skipped (column still uuid, migration pending):', bySender.error);
      return { rows: byAccount.data ?? [], error: null };
    }
    return { rows: [], error: bySender.error };
  }

  const merged = new Map<string, T>();
  for (const row of [...(byAccount.data ?? []), ...(bySender.data ?? [])]) merged.set(row.id, row);
  return { rows: [...merged.values()], error: null };
}

/** Exécutions encore à venir, annulées à toute clôture d'inscription (jamais 'sending'). */
const PENDING_EXECUTION_STATUSES = ['scheduled', 'waiting_event', 'quota_blocked'];
/** Une réponse, un rebond ou une acceptation concernent aussi une inscription en pause. */
const OPEN_ENROLLMENT_STATUSES = ['active', 'paused'];

/**
 * Inscriptions déjà closes auxquelles un message du candidat se rattache
 * encore (terminée, ou déjà « répondu » par le moteur ou par un premier
 * passage de ce webhook) : leur statut ne change pas, elles désignent
 * l'organisation où tout s'arrête (SEQ-212, _shared/candidate-reply-closure.ts).
 */
const REPLY_CLOSED_ENROLLMENT_STATUSES = ['replied', 'completed'];

/** Mission (outreach_sequences.project_id) de chaque séquence, pour les liens des notifications. */
async function loadSequenceProjects(supabase: SupabaseClient, sequenceIds: string[]): Promise<Map<string, string>> {
  const projectBySequence = new Map<string, string>();
  const ids = [...new Set(sequenceIds.filter(Boolean))];
  if (ids.length === 0) return projectBySequence;
  const { data, error } = await supabase
    .from('outreach_sequences')
    .select('id, project_id')
    .in('id', ids);
  if (error) console.warn('[unipile-webhook] Could not load sequence missions:', error);
  for (const s of (data ?? []) as Array<{ id: string; project_id: string | null }>) {
    if (s.project_id) projectBySequence.set(s.id, s.project_id);
  }
  return projectBySequence;
}

/** metadata.source des alertes « relances non arrêtées après une réponse » (décision 10). */
const SIBLING_STOP_FAILED_SOURCE = 'reply_sibling_stop_failed';

/**
 * Décision 10 : après une réponse, l'arrêt des autres inscriptions ou des
 * InMails programmés du candidat a échoué. Le webhook répond toujours 500
 * (rejeu du prestataire) et le recruteur est prévenu, une seule fois par
 * événement et par organisation : si aucun rejeu n'aboutit, une relance
 * pourrait partir. Non bloquant.
 */
async function alertSiblingStopFailure(
  supabase: SupabaseClient,
  eventKey: string,
  alerts: Array<{
    organizationId: string;
    userIds: Array<string | null | undefined>;
    candidateName: string | null;
    sequenceId: string | null;
    enrollmentIds: string[];
    /** Identifiant du candidat au /pipeline, pour une alerte sans séquence (chemin LinkedIn). */
    candidateId?: string | null;
  }>,
): Promise<void> {
  for (const alert of alerts) {
    const userIds = [...new Set(alert.userIds.filter((u): u is string => !!u))];
    if (userIds.length === 0) continue;
    try {
      // Déjà prévenu par un passage précédent du même événement.
      const { data: existing, error: existingError } = await supabase
        .from('notifications')
        .select('id')
        .eq('organization_id', alert.organizationId)
        .in('user_id', userIds)
        .eq('metadata->>source', SIBLING_STOP_FAILED_SOURCE)
        .eq('metadata->>event_key', eventKey)
        .limit(1);
      if (existingError) console.warn('[unipile-webhook] sibling stop alert lookup failed:', existingError);
      else if ((existing ?? []).length > 0) continue;
      const projectId = alert.sequenceId
        ? (await loadSequenceProjects(supabase, [alert.sequenceId])).get(alert.sequenceId)
        : undefined;
      const { error } = await supabase.from('notifications').insert(userIds.map((userId) => ({
        user_id: userId,
        organization_id: alert.organizationId,
        type: 'action',
        title: 'Relances non arrêtées après une réponse',
        body: `${alert.candidateName || 'Le candidat'} a répondu, mais ses autres séquences ou InMails programmés n'ont pas pu être arrêtés. Un nouvel essai automatique est en cours : vérifiez ses inscriptions pour qu'aucune relance ne parte.`,
        // Lot 5h : sans mission, la page de la séquence au lieu de /missions. Sans
        // séquence (InMails seuls, y compris ceux d'une mission : la mission ne
        // vient que de la séquence) : la fiche du candidat (décision du
        // 07/10/2026), que l'écran Séquences ne montre pas.
        link: projectId
          ? `/missions/${projectId}?tab=outreach`
          : alert.sequenceId
            ? `/sequences/${alert.sequenceId}`
            : alert.candidateId ? `/pipeline?candidate=${encodeURIComponent(alert.candidateId)}` : '/pipeline',
        metadata: {
          source: SIBLING_STOP_FAILED_SOURCE,
          event_key: eventKey,
          enrollment_ids: alert.enrollmentIds,
          ...(alert.sequenceId ? { sequence_id: alert.sequenceId } : {}),
          profile_name: alert.candidateName,
          ...(projectId ? { project_id: projectId } : {}),
        },
      })));
      if (error) console.warn('[unipile-webhook] sibling stop alert failed:', error);
    } catch (e) {
      console.warn('[unipile-webhook] sibling stop alert failed:', e);
    }
  }
}

/**
 * Notification « Compte LinkedIn déconnecté » (statut déconnecté), « Problème de connexion LinkedIn »
 * (`problem: 'error'`, statut en erreur), « Connexion LinkedIn partielle » (`problem: 'partial'`, un produit
 * demande une nouvelle authentification : le membre doit reconnecter), « Compte LinkedIn restreint »
 * (`problem: 'locked'`, accès verrouillé : se reconnecter n'y change rien) ou compte supprimé (`removed`).
 */
function linkedinDisconnectedNotification(
  row: { user_id: string; organization_id: string; linkedin_account_name?: string | null },
  accountId: string,
  options: { removed?: boolean; problem?: 'error' | 'locked' | 'partial' } = {},
) {
  const label = `Votre compte LinkedIn${row.linkedin_account_name ? ` « ${row.linkedin_account_name} »` : ''}`;
  let title = 'Compte LinkedIn déconnecté';
  let body = `${label} n'est plus connecté. Reconnectez-le depuis Paramètres > Mon compte pour reprendre vos recherches et vos séquences.`;
  if (options.removed) {
    body = `${label} a été supprimé du service de connexion : les envois qui en partaient sont arrêtés. Reliez-le de nouveau depuis Paramètres > Mon compte pour reprendre vos recherches et vos séquences.`;
  } else if (options.problem === 'error') {
    title = 'Problème de connexion LinkedIn';
    body = `${label} rencontre un problème de connexion : les envois qui en partent sont en pause. Reconnectez-le depuis Paramètres > Mon compte pour reprendre vos recherches et vos séquences.`;
  } else if (options.problem === 'partial') {
    title = 'Connexion LinkedIn partielle';
    body = PARTIAL_CONNECTION_SENTENCE;
  } else if (options.problem === 'locked') {
    title = 'Compte LinkedIn restreint';
    body = `${label} est restreint par LinkedIn : les envois qui en partent sont en pause. Se reconnecter n'y change rien. Patientez, ou vérifiez l'état du compte directement sur LinkedIn : les envois reprendront d'eux-mêmes une fois la restriction levée.`;
  }
  // Schéma notifications : body + read_at (NULL = non lue), pas message/read.
  return {
    user_id: row.user_id,
    organization_id: row.organization_id,
    type: 'linkedin_disconnected',
    title,
    body,
    link: '/settings?tab=account',
    metadata: {
      linkedin_account_id: accountId,
      ...(options.problem === 'error' ? { account_status: 'ERROR' } : {}),
      ...(options.problem === 'partial' ? { account_status: 'PARTIAL' } : {}),
      ...(options.problem === 'locked' ? { account_status: 'LOCKED' } : {}),
    },
  };
}

/** Liaison LinkedIn que ce passage vient de faire changer d'état : celle dont le membre est prévenu. */
interface MovedLinkedAccountRow {
  user_id: string;
  organization_id: string;
  linkedin_account_name: string | null;
}

/** Liaison LinkedIn telle que la lit un passage d'état, avec son statut d'avant. */
interface LinkedAccountStateRow extends MovedLinkedAccountRow {
  id: string;
  account_status: string | null;
}

/** Genre de notification d'un passage d'état (OK et DEGRADED : aucune, état de carte seulement). */
type AccountNotice = 'locked' | 'partial' | 'disconnected' | 'error';
const NOTICE_BY_STATUS: Readonly<Record<string, AccountNotice>> = {
  LOCKED: 'locked',
  PARTIAL: 'partial',
  CREDENTIALS: 'disconnected',
  ERROR: 'error',
};

/** Statut Konekt à écrire sur une liaison LinkedIn, avec les champs écrits en même temps. */
interface StatusTarget {
  status: string;
  patch: Record<string, unknown>;
}

/**
 * Champs écrits avec un statut : date du constat, et le code neutre de la panne (jamais le texte du prestataire,
 * lisible par les membres de l'organisation), effacé au retour à OK.
 */
function statusPatch(status: string): Record<string, unknown> {
  return {
    account_status: status,
    last_checked_at: new Date().toISOString(),
    ...(status === 'OK' ? { failure_reason: null } : {}),
    ...(status === 'CREDENTIALS' ? { failure_reason: 'disconnected' } : {}),
    ...(status === 'ERROR' ? { failure_reason: 'error' } : {}),
  };
}

/**
 * Lignes lues dont le passage vers `status` mérite d'être annoncé au membre : PARTIAL pas à une liaison déjà en
 * panne à reconnecter ni déjà PARTIAL, une panne (CREDENTIALS, ERROR) pas à une liaison déjà en panne (SEQ-208).
 * OK, DEGRADED et LOCKED (annoncé par son écriture conditionnelle) : jamais ici.
 */
function announcedRows<T extends { account_status: string | null }>(status: string, rows: T[]): T[] {
  if (status === 'PARTIAL') return rows.filter((row) => !NO_PARTIAL_NOTICE_STATUSES.has(String(row.account_status ?? '').toUpperCase()));
  if (status !== 'CREDENTIALS' && status !== 'ERROR') return [];
  return rows.filter((row) => !ALREADY_BROKEN_STATUSES.has(String(row.account_status ?? '').toUpperCase()));
}

/**
 * Passage d'état atomique (compare-and-set) : l'écriture ne touche que les liaisons dont le statut d'AVANT
 * répond à `previousStatusFilter` (filtre .or), et rend les lignes qu'elle a vraiment changées. Le membre
 * n'est prévenu que pour ces lignes : deux livraisons simultanées d'événements distincts pour le même passage
 * (account.locked et account.status.running avec is_locked, par exemple) ne peuvent pas toutes deux le
 * changer, la seconde ne trouve plus de ligne à écrire. Aucune lecture du statut d'avant, donc aucune fenêtre
 * entre la lecture et l'écriture. Sert quand les statuts remplacés sont ceux qui sont annoncés (LOCKED, et le
 * déverrouillage qui ne relève que les liaisons LOCKED).
 */
async function moveLinkedInAccount(
  supabase: SupabaseClient,
  accountId: string,
  patch: Record<string, unknown>,
  previousStatusFilter: string,
): Promise<{ moved: MovedLinkedAccountRow[]; error: unknown }> {
  const { data, error } = await supabase
    .from('member_linkedin_accounts')
    .update(patch)
    .eq('linkedin_account_id', accountId)
    .or(previousStatusFilter)
    .select('user_id, organization_id, linkedin_account_name');
  return { moved: error ? [] : ((data ?? []) as MovedLinkedAccountRow[]), error };
}

/**
 * Prévient les membres dont le compte vient de passer LOCKED (envois en pause, aucun geste de reconnexion),
 * PARTIAL (un produit demande une nouvelle authentification), CREDENTIALS ou ERROR (à reconnecter). Au mieux :
 * un échec est journalisé et ne fait jamais échouer l'événement.
 */
async function notifyAccountState(
  supabase: SupabaseClient,
  accountId: string,
  rows: MovedLinkedAccountRow[],
  problem: AccountNotice,
): Promise<void> {
  if (rows.length === 0) return;
  try {
    const { error } = await supabase.from('notifications').insert(
      rows.map((row) => linkedinDisconnectedNotification(row, accountId, problem === 'disconnected' ? {} : { problem })),
    );
    if (error) console.warn(`[unipile-webhook] Could not create ${problem} notifications:`, error);
  } catch (e) {
    console.warn(`[unipile-webhook] Error creating ${problem} notifications:`, e);
  }
}

/**
 * Passage d'état des liaisons LinkedIn d'un compte quand le statut remplacé et le statut annoncé diffèrent
 * (un statut de panne remplace une autre panne sans nouvelle notification, PARTIAL remplace une panne sans
 * notification) : la ligne est lue, puis écrite SI SON STATUT EST ENCORE CELUI QUI A ÉTÉ LU (compare-and-set,
 * rendue par .select()). Une écriture qui ne trouve plus la ligne telle qu'elle l'a lue relit et décide de
 * nouveau : chaque événement a donc un seul point d'effet, au moment de son écriture réussie, et ne recouvre
 * jamais un événement plus récent. Le membre n'est prévenu que pour le passage que CETTE écriture a fait,
 * jamais d'après la lecture : des livraisons simultanées d'événements distincts ne le préviennent qu'une fois
 * par passage réel. `targetFor` rend l'état à écrire pour un statut d'avant, ou null pour laisser la ligne.
 * Une erreur n'est jamais levée mais rendue dans `error` : lecture ou écriture en échec, plafond d'essais atteint, ou
 * état à écrire impossible à décider (`targetFor` lève). Elle signifie « événement non appliqué en entier » : l'appelant
 * la rend transitoire (transientFailure) pour que le prestataire rejoue l'événement, jamais acquitté comme traité.
 */
export async function transitionLinkedInAccount(
  supabase: SupabaseClient,
  accountId: string,
  targetFor: (previous: string | null) => StatusTarget | null | Promise<StatusTarget | null>,
): Promise<{ finalStatuses: string[]; error: unknown }> {
  const finalStatuses: string[] = [];
  const handled = new Set<string>();
  const told = new Map<AccountNotice, MovedLinkedAccountRow[]>();
  let failure: unknown = null;
  let settled = false;
  for (let attempt = 0; attempt < MAX_TRANSITION_ATTEMPTS && !settled && !failure; attempt++) {
    const { data, error } = await supabase
      .from('member_linkedin_accounts')
      .select('id, user_id, organization_id, linkedin_account_name, account_status')
      .eq('linkedin_account_id', accountId);
    if (error) {
      failure = error;
      break;
    }
    settled = true;
    for (const row of (data ?? []) as LinkedAccountStateRow[]) {
      if (handled.has(row.id)) continue;
      let target: StatusTarget | null;
      try {
        target = await targetFor(row.account_status ?? null);
      } catch (e) {
        // Relecture du compte impossible (voir applyLinkedInStatus) : la liaison n'est pas touchée, l'événement est rejoué.
        failure = e;
        break;
      }
      if (!target) {
        handled.add(row.id);
        finalStatuses.push(String(row.account_status ?? ''));
        continue;
      }
      const write = supabase
        .from('member_linkedin_accounts')
        .update(target.patch)
        .eq('id', row.id)
        .eq('linkedin_account_id', accountId);
      const { data: changed, error: writeError } = await (row.account_status === null
        ? write.is('account_status', null)
        : write.eq('account_status', row.account_status)
      ).select('id');
      if (writeError) {
        failure = writeError;
        break;
      }
      if ((changed ?? []).length === 0) {
        settled = false;
        continue;
      }
      handled.add(row.id);
      finalStatuses.push(target.status);
      const notice = NOTICE_BY_STATUS[target.status];
      if (notice && announcedRows(target.status, [row]).length > 0) {
        told.set(notice, [...(told.get(notice) ?? []), row]);
      }
    }
  }
  if (!settled && !failure) failure = new Error('account status kept changing, event not applied');
  for (const [notice, rows] of told) await notifyAccountState(supabase, accountId, rows, notice);
  return { finalStatuses, error: failure };
}

/**
 * État que le prestataire rapporte maintenant pour un compte (statut et verrou ensemble, `statusAtClaim`),
 * relu à l'événement d'un déverrouillage ou d'un statut qui ne dit pas si le verrou est levé : aucun événement de
 * statut n'est émis quand seul le verrou change, donc ni l'événement ni la ligne enregistrée ne disent dans
 * quel état le compte revient. null quand la lecture échoue, dépasse son délai ou rend un compte sans statut
 * lisible : l'appelant n'écrit alors rien (un doute ne laisse rien partir) et fait rejouer l'événement.
 */
async function readReportedStatus(accountId: string): Promise<KonektAccountStatus | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const read = getAccount(accountId);
    read.catch(() => {}); // une lecture abandonnée à l'échéance ne doit pas remonter plus tard
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error('account state re-read deadline')), testing.rereadDeadlineMs);
    });
    const account = await Promise.race([read, deadline]);
    // Un compte sans statut lisible n'apprend rien : ce n'est pas un compte opérationnel.
    if (typeof account?.status !== 'string' || account.status.trim() === '') {
      console.warn('[unipile-webhook] Account state could not be re-read, the provider returned no status, the event is not applied and will be redelivered');
      return null;
    }
    return statusAtClaim(account);
  } catch (e) {
    console.warn('[unipile-webhook] Account state could not be re-read, the event is not applied and will be redelivered:', describeForLog(e));
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Vrai quand une liaison de ce compte (LinkedIn, e-mail ou WhatsApp) est enregistrée LOCKED. Lecture en échec : le
 * déverrouillage ne peut pas être décidé, l'erreur est transitoire (rien n'est écrit, l'événement est rejoué).
 */
async function hasLockedBinding(supabase: SupabaseClient, accountId: string): Promise<boolean> {
  const reads = await Promise.all([
    supabase.from('member_linkedin_accounts').select('account_status').eq('linkedin_account_id', accountId).eq('account_status', 'LOCKED'),
    supabase.from('member_email_accounts').select('account_status').eq('email_account_id', accountId).eq('account_status', 'LOCKED'),
    supabase.from('member_whatsapp_accounts').select('account_status').eq('whatsapp_account_id', accountId).eq('account_status', 'LOCKED'),
  ]);
  for (const { error } of reads) if (error) throw transientFailure(error);
  return reads.some(({ data }) => (data ?? []).length > 0);
}

/**
 * Applique aux liaisons LinkedIn d'un compte le statut qu'un événement rapporte, hors LOCKED (account.status.running,
 * degraded et partial sans verrou, account.status.disconnected et errored, account.add et account.reconnect sans
 * tentative de connexion) : un seul chemin, donc les mêmes règles partout. Une panne à reconnecter (CREDENTIALS,
 * ERROR) l'emporte sur le verrou, qui se règle en reconnectant. Les autres statuts ne disent pas toujours si le verrou
 * est levé : une liaison LOCKED prend alors l'état que le prestataire rapporte maintenant (relu), et reste LOCKED s'il
 * dit encore verrouillé. Relecture impossible : la liaison reste LOCKED (aucun envoi ne part sur un doute), rien n'est
 * écrit et l'erreur rendue est transitoire (l'appelant fait rejouer l'événement). `lockKnown` : l'événement porte
 * lui-même `is_locked` (vrai ou faux), il fait foi pour le verrou et aucune relecture n'a lieu.
 */
async function applyLinkedInStatus(
  supabase: SupabaseClient,
  accountId: string,
  status: string,
  lockKnown = false,
): Promise<{ finalStatuses: string[]; error: unknown }> {
  if (status === 'LOCKED') return { finalStatuses: [], error: new Error('LOCKED is written by its own conditional update') };
  const own: StatusTarget = { status, patch: statusPatch(status) };
  const rereadsLocked = !lockKnown && status !== 'CREDENTIALS' && status !== 'ERROR';
  let afterLock: Promise<StatusTarget | null> | undefined;
  return await transitionLinkedInAccount(supabase, accountId, (previous) => {
    if (!rereadsLocked || String(previous ?? '').toUpperCase() !== 'LOCKED') return own;
    afterLock ??= (async () => {
      const reported = await readReportedStatus(accountId);
      if (reported === null) throw new TransientEventError('Account state could not be re-read');
      return reported === 'LOCKED' ? null : { status: reported, patch: statusPatch(reported) };
    })();
    return afterLock;
  });
}

/**
 * Reprise des inscriptions mises en pause par process-sequences quand ce
 * compte était en CREDENTIALS / ERROR (pause_reason = account_disconnected) :
 * l'inscription repasse 'active' (pause_reason NULL) et l'exécution annulée à
 * la mise en pause est re-planifiée à max(date prévue, maintenant + 1 min)
 * (le processeur applique ensuite heures ouvrées et quotas). Compte d'enrôlement ou compte d'envoi en
 * rotation. Non bloquant : le rattachement du compte ne dépend pas de ce pas.
 *
 * Séquence désactivée (décision D1) : jamais de réactivation. L'inscription
 * reste en pause avec pause_reason 'sequence_inactive' : la réactivation de la
 * séquence la reprendra (resume_enrollments, qui contrôle le compte d'envoi
 * et réarme l'exécution annulée). Un update PostgREST ne filtre pas sur une
 * table jointe : lecture d'abord (avec la séquence), écritures par id ensuite.
 */
async function resumeEnrollmentsAfterReconnect(supabase: SupabaseClient, accountId: string | undefined) {
  if (!accountId) return;
  try {
    const nowIso = new Date().toISOString();
    const activeSequenceIds = new Set<string>();
    const inactiveSequenceIds = new Set<string>();
    const PAGE = 1000;
    for (const column of ['account_id', 'assigned_sender_id'] as const) {
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase
          .from('sequence_enrollments')
          .select('id, sequence:outreach_sequences(is_active)')
          .eq(column, accountId)
          .eq('status', 'paused')
          .eq('pause_reason', ACCOUNT_DISCONNECTED_PAUSE_REASON)
          .order('id')
          .range(from, from + PAGE - 1);
        if (error) {
          console.warn(`[unipile-webhook] account_connected: resume lookup by ${column} failed:`, error);
          break;
        }
        const rows = (data ?? []) as Array<{ id: string; sequence: { is_active: boolean | null } | Array<{ is_active: boolean | null }> | null }>;
        for (const row of rows) {
          const seq = Array.isArray(row.sequence) ? row.sequence[0] : row.sequence;
          // Séquence illisible : traitée comme désactivée (échec fermé).
          if (seq?.is_active === true) activeSequenceIds.add(row.id);
          else inactiveSequenceIds.add(row.id);
        }
        if (rows.length < PAGE) break;
      }
    }

    const resumedIds = new Set<string>();
    const activeIds = [...activeSequenceIds];
    for (let i = 0; i < activeIds.length; i += 100) {
      const { data, error } = await supabase
        .from('sequence_enrollments')
        .update({ status: 'active', pause_reason: null, updated_at: nowIso })
        .in('id', activeIds.slice(i, i + 100))
        .eq('status', 'paused')
        .eq('pause_reason', ACCOUNT_DISCONNECTED_PAUSE_REASON)
        .select('id');
      if (error) {
        console.warn('[unipile-webhook] account_connected: resume failed:', error);
        continue;
      }
      for (const row of (data ?? []) as Array<{ id: string }>) resumedIds.add(row.id);
    }

    let relabeled = 0;
    const inactiveIds = [...inactiveSequenceIds];
    for (let i = 0; i < inactiveIds.length; i += 100) {
      const { data, error } = await supabase
        .from('sequence_enrollments')
        .update({ pause_reason: 'sequence_inactive', updated_at: nowIso })
        .in('id', inactiveIds.slice(i, i + 100))
        .eq('status', 'paused')
        .eq('pause_reason', ACCOUNT_DISCONNECTED_PAUSE_REASON)
        .select('id');
      if (error) {
        console.warn('[unipile-webhook] account_connected: relabel to sequence_inactive failed:', error);
        continue;
      }
      relabeled += (data ?? []).length;
    }

    // Réarmement seulement pour les inscriptions réellement reprises, à
    // max(date prévue, maintenant + 1 min) : une relance prévue jeudi ne part
    // pas lundi à la reconnexion.
    const nowMs = Date.now();
    for (const enrollmentId of resumedIds) {
      const { data: cancelled } = await supabase
        .from('sequence_step_executions')
        .select('id, scheduled_at')
        .eq('enrollment_id', enrollmentId)
        .eq('status', 'cancelled')
        .eq('skip_reason', ACCOUNT_DISCONNECTED_SKIP_REASON)
        .order('step_order', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!cancelled?.id) continue;
      const { error: execError } = await supabase
        .from('sequence_step_executions')
        .update({ status: 'scheduled', skip_reason: null, scheduled_at: resumeDate(cancelled.scheduled_at, nowMs), updated_at: nowIso })
        .eq('id', cancelled.id)
        .eq('status', 'cancelled');
      if (execError) console.warn(`[unipile-webhook] account_connected: execution ${cancelled.id} not rescheduled:`, execError);
    }

    console.log(`[unipile-webhook] account_connected: ${resumedIds.size} enrollment(s) resumed, ${relabeled} left paused (sequence inactive) after reconnect of ${accountId}`);
  } catch (e) {
    console.warn('[unipile-webhook] account_connected: enrollment resume failed (non-blocking):', e);
  }
}

/**
 * Événement du service de connexion, aplati par flattenEnvelope puis nommé par
 * son handler (`event`, voir handlerNameOf). Seul `message.new` a été observé sur
 * une vraie livraison : les autres formes sont lues avec prudence, une clé absente
 * reste absente (jamais inventée).
 */
interface WebhookPayload {
  /** Nom du handler (alias du type v2). */
  event: string;
  /** Type v2 brut (`message.new`, `account.status.running`...). */
  v2_event: string;
  /** Identifiant d'événement `evt_...`, commun à toutes les tentatives de livraison. */
  event_id?: string;
  account_id: string;
  /** Fournisseur du compte (`linkedin`, `google`, `outlook`, `imap`, `whatsapp`...), en minuscules. */
  account_type?: string;
  data?: Record<string, unknown>;
  /** account.add / account.reconnect : `state` renvoyé, identifiant de la tentative de connexion. */
  state?: string;
  /** account.add / account.reconnect : ancien identifiant du compte migré, journalisé seulement. */
  v1_account_id?: string;
  /** account.add / account.reconnect : statut (`running`...) et verrouillage du compte, quand la charge est un `Account`. */
  provider_status?: string;
  is_locked?: boolean;
  /** account.status.running|degraded|partial : statut Konekt (OK, DEGRADED, PARTIAL ou LOCKED). */
  account_status?: string;
  /** account.initial_sync.* : completed ou failed. */
  sync_status?: string;
  // relation.new
  user_provider_id?: string;
  user_full_name?: string;
  user_public_identifier?: string;
  user_profile_url?: string;
  // message.new : identifiant du message (la conversation est dans data.chat)
  message_id?: string;
  // email.new
  email_id?: string;
  thread_id?: string;
  subject?: string;
  body?: string;
  body_plain?: string;
  /** Identifiant du message auquel le courriel répond (en-têtes In-Reply-To / References). */
  in_reply_to?: { message_id?: string; id?: string } | string;
  from_attendee?: { display_name?: string; identifier?: string };
  to_attendees?: Array<{ display_name?: string; identifier?: string }>;
  cc_attendees?: Array<{ display_name?: string; identifier?: string }>;
  bcc_attendees?: Array<{ display_name?: string; identifier?: string }>;
  date?: string;
  /** En-têtes du message (réponses automatiques). */
  headers?: Array<{ name?: string; value?: unknown }> | Record<string, unknown>;
}

interface SequenceEnrollment {
  id: string;
  sequence_id: string;
  profile_id: string;
  account_id: string;
  status: string;
  connection_status: string | null;
  // Présents avec select('*') : servent à la notification new_message et au
  // rattachement des identifiants LinkedIn (Recruiter / classique).
  organization_id?: string | null;
  profile_name?: string | null;
  profile_headline?: string | null;
  profile_url?: string | null;
  provider_id?: string | null;
  resolved_profile_id?: string | null;
  created_by?: string | null;
  job_id?: string | null;
  replied_at?: string | null;
  completed_at?: string | null;
  tracking_data?: Record<string, unknown> | null;
}

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/**
 * En-tête de l'ancienne génération : lu pour le DIAGNOSTIC d'un refus seulement
 * (un point de terminaison de l'ancienne génération encore actif envoie cet
 * en-tête et jamais de jeton), jamais pour authentifier.
 */
const LEGACY_AUTH_HEADER = 'unipile-auth';

/** Ce qu'un refus laisse dans le journal : des booléens et le type de contenu, jamais une valeur secrète. */
function describeRejectedDelivery(req: Request, reason: string): Record<string, unknown> {
  let hasToken = false;
  try {
    hasToken = Boolean(new URL(req.url).searchParams.get('v2_token'));
  } catch {
    hasToken = false;
  }
  return {
    reason,
    has_token: hasToken,
    legacy_header: req.headers.has(LEGACY_AUTH_HEADER),
    user_agent: (req.headers.get('user-agent') ?? '').slice(0, 80),
    content_type: req.headers.get('content-type') ?? null,
  };
}

/** Clés d'un objet JSON (jamais ses valeurs : le contenu d'un message ne se journalise pas). */
function structuralKeys(value: unknown): string[] {
  return value && typeof value === 'object' && !Array.isArray(value) ? Object.keys(value as Record<string, unknown>).slice(0, 20) : [];
}

/** Les événements de message ne concernent le parcours LinkedIn que pour un compte LinkedIn (ou sans fournisseur lisible). */
function isLinkedInProvider(provider: string | undefined): boolean {
  const value = (provider ?? '').trim().toLowerCase();
  return value === '' || value === 'linkedin' || value === 'mock';
}

/** Points d'injection des tests : le client de base de données et le délai de relecture d'un compte (index.test.ts). */
export const testing = {
  createDb: (url: string, key: string): SupabaseClient => createClient(url, key),
  rereadDeadlineMs: REREAD_DEADLINE_MS,
};

export async function handleRequest(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  // Hoistés pour être accessibles dans le catch (purge de la ligne de dédup
  // en cas d'échec réel — voir commentaire du catch).
  let dedupKeyForCleanup: string | null = null;
  let supabaseForCleanup: SupabaseClient | null = null;

  try {
    // Authentification d'abord, avant de lire le corps : le jeton `?v2_token=` est
    // la seule preuve admise. Sans jeton configuré, 503 (jamais 500, jamais accès
    // ouvert) ; jeton absent ou faux, 401. L'en-tête de l'ancienne génération et
    // les signatures d'appel de retour d'un lien d'authentification ne sont plus lus.
    const auth = await verifyWebhookRequest(req);
    if (!auth.ok) {
      if (auth.reason === 'not_configured') {
        console.error('[unipile-webhook] No delivery token configured (UNIPILE_V2_WEBHOOK_TOKEN): rejecting every delivery');
        return json({ error: 'Webhook not configured' }, auth.status);
      }
      console.error('[unipile-webhook] Invalid webhook authentication', describeRejectedDelivery(req, auth.reason));
      return json({ error: 'Unauthorized' }, auth.status);
    }

    let rawPayload: unknown;
    try {
      rawPayload = await req.json();
    } catch {
      return json({ error: 'Invalid JSON' }, 400);
    }

    // Enveloppe v2 { id: evt_…, type, account_id, payload: {…} } remise à plat ;
    // le type v2 brut reste dans `v2_event`, `event` porte le nom du handler.
    const flat = flattenEnvelope(rawPayload);
    if (!flat) {
      // Conformité LinkedIn : seulement les clés, jamais le contenu.
      console.warn('[unipile-webhook] Ignored: body is not a v2 event envelope, keys:', structuralKeys(rawPayload));
      return json({ ok: true, ignored: 'not_a_v2_envelope' });
    }
    const v2Event = String(flat.v2_event ?? '');
    const payload: WebhookPayload = {
      ...(flat as unknown as WebhookPayload),
      event: handlerNameOf(v2Event),
      v2_event: v2Event,
      account_id: typeof flat.account_id === 'string' ? flat.account_id : '',
    };

    // Conformité LinkedIn (warning #260513-007211) : ne JAMAIS logger le payload
    // brut — il peut contenir du contenu de messages, PII destinataires, et
    // potentiellement des identifiants de session. On loggue uniquement les
    // métadonnées structurelles de l'event.
    console.log('[unipile-webhook] event:', payload.event,
      'v2:', v2Event,
      'evt:', payload.event_id ?? null,
      'account:', payload.account_id,
      'chat:', ((payload.data as { chat?: { id?: unknown } } | undefined)?.chat?.id) ?? null,
      'msg:', payload.message_id ?? null,
      'profile:', payload.user_provider_id ?? null);

    // Un compte sans identifiant v2 n'est pas un compte du service (un identifiant
    // de l'ancienne génération est refusé à la frontière, jamais traduit ici).
    if (!isV2AccountId(payload.account_id)) {
      console.warn('[unipile-webhook] Ignored: event without a v2 account id, type:', v2Event);
      return json({ ok: true, ignored: 'invalid_account_id' });
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;
    const supabase = testing.createDb(supabaseUrl, supabaseServiceKey);

    // ─── Idempotency : dédoublonne les nouvelles livraisons d'un même événement ──
    // Clé = type v2 BRUT + identifiant d'événement evt_… (commun à toutes les
    // tentatives d'un même événement, et à son rejeu). Le type brut distingue
    // account.status.running, degraded et partial, qui partagent un handler.
    // Sans identifiant evt_ (livraison mal formée) : repli sur le compte, une
    // référence de la charge et la minute.
    const eventKey = (webhookDedupKey(flat) ?? webhookFallbackDedupKey(flat)).slice(0, 500);
    dedupKeyForCleanup = eventKey;
    supabaseForCleanup = supabase;

    try {
      const { data: isNew } = await supabase.rpc('record_webhook_event', {
        p_event_key: eventKey,
        p_provider: 'unipile',
        p_event_type: v2Event,
        p_account_id: payload.account_id || null,
      });
      if (isNew === false) {
        // Clé laissée par un traitement en échec dont la purge a échoué aussi
        // (marquée par le catch plus bas) : ce rejeu la reprend et traite
        // l'événement, au lieu de l'ignorer comme doublon (SEQ-040).
        const { data: reclaimed } = await supabase
          .from('webhook_event_log')
          .update({ event_type: v2Event, received_at: new Date().toISOString() })
          .eq('event_key', eventKey)
          .eq('event_type', FAILED_EVENT_MARKER)
          .select('event_key');
        if ((reclaimed ?? []).length === 0) {
          console.log('[unipile-webhook] Duplicate event ignored:', eventKey);
          return json({ ok: true, deduplicated: true });
        }
        console.warn('[unipile-webhook] Retrying event whose dedup purge had failed:', eventKey);
      }
    } catch (e) {
      // Si la dédup échoue (table absente, RPC indisponible), on continue
      // pour pas bloquer la prod. Les doublons restent possibles mais l'event
      // sera traité au moins une fois.
      console.warn('[unipile-webhook] Dedup check failed (non-blocking):', e);
    }

    const channel = accountChannelOf(payload.account_type);

    switch (payload.event) {
      case 'new_relation': {
        // A connection request was accepted
        await handleNewRelation(supabase, payload);
        break;
      }

      case 'new_message': {
        const captured = await captureCandidateActionIncomingBestEffort(supabase, payload as unknown as Record<string, unknown>, rawPayload);
        // WhatsApp has a personal binding and its own history. It must never
        // pass through the LinkedIn enrollment/stage handler.
        if (captured.channel !== 'whatsapp' && isLinkedInProvider(payload.account_type)) {
          await handleNewMessage(supabase, payload, eventKey);
        }
        break;
      }

      case 'mail_received': {
        const captured = await captureCandidateActionIncomingBestEffort(supabase, payload as unknown as Record<string, unknown>, rawPayload);
        // Un email a été reçu sur un compte connecté → vérifier si c'est une
        // réponse à une étape de séquence email pour stopper les suivantes.
        if (captured.audience !== 'team') await handleNewMail(supabase, payload, eventKey);
        break;
      }

      case 'account_connected': {
        await handleAccountConnected(supabase, payload);
        break;
      }

      // Compte supprimé chez le prestataire : ce n'est PAS une déconnexion
      // récupérable. Liaison retirée et envois arrêtés (mapAccountRemoved), comme
      // « Dissocier » ; reconnecter crée un nouveau compte.
      case 'account_removed': {
        await handleAccountRemoved(supabase, payload);
        break;
      }

      // account.status.running | degraded | partial : le statut vient du NOM de
      // l'événement (flattenEnvelope), avec le verrouillage du compte (LOCKED).
      // disconnected et errored ont leur handler plus bas.
      case 'account_status_updated': {
        const newStatus = payload.account_status;
        const accId = payload.account_id;
        if (!newStatus) {
          console.warn('[unipile-webhook] Status event without a readable status:', v2Event);
          break;
        }
        console.log('[unipile-webhook] Status updated:', accId, '->', newStatus);
        try {
          if (channel === 'whatsapp') {
            const whatsappUpdate = supabase.from('member_whatsapp_accounts')
              .update({ account_status: newStatus, updated_at: new Date().toISOString() })
              .eq('whatsapp_account_id', accId).neq('account_status', 'DELETED');
            // LOCKED : même règle que account.locked (ne remplace jamais une panne à reconnecter).
            const { error } = await (newStatus === 'LOCKED' ? whatsappUpdate.or(LOCK_REPLACES_FILTER) : whatsappUpdate);
            if (error) throw error;
          } else if (channel === 'email') {
            const emailUpdate = supabase
              .from('member_email_accounts')
              .update({ account_status: newStatus })
              .eq('email_account_id', accId);
            await (newStatus === 'LOCKED' ? emailUpdate.or(LOCK_REPLACES_FILTER) : emailUpdate);
          } else {
            // LOCKED, PARTIAL, CREDENTIALS et ERROR préviennent le membre : le passage d'état et son constat sont
            // une seule écriture conditionnelle au statut d'avant (compare-and-set), jamais une lecture suivie
            // d'une écriture sans condition, sinon des livraisons simultanées préviendraient chacune ou un
            // événement plus récent serait recouvert.
            // - LOCKED remplace OK, DEGRADED, PARTIAL, l'absence de statut et un statut inconnu, jamais une
            //   panne à reconnecter (CREDENTIALS, ERROR…) : même règle que account.locked.
            // - les autres statuts (applyLinkedInStatus) : PARTIAL est annoncé à qui n'était ni en panne à
            //   reconnecter ni déjà PARTIAL ; avec `is_locked` dans l'événement (vrai ou faux), l'événement fait
            //   foi pour le verrou ; sans lui, une liaison LOCKED prend l'état que le prestataire rapporte
            //   maintenant (relu), et reste LOCKED, événement rejoué (500), si la relecture est impossible.
            // DEGRADED arrête les envois sans mettre les inscriptions en pause ni prévenir (nouvelle tentative
            // automatique, état de carte seulement) : le moteur attend le retour à OK. LOCKED et PARTIAL les
            // arrêtent aussi sans pause, mais le membre en est prévenu.
            // Reconnexion par cookie ou par statut : les inscriptions mises en
            // pause pour compte déconnecté reprennent (idempotent).
            let finalStatuses: string[] = [];
            let linkedinError: unknown = null;
            if (newStatus === 'LOCKED') {
              const lockPatch = statusPatch(newStatus);
              const result = await moveLinkedInAccount(supabase, accId, lockPatch, LOCK_REPLACES_FILTER);
              linkedinError = result.error;
              await notifyAccountState(supabase, accId, result.moved, 'locked');
            } else {
              // `is_locked` dans l'événement (vrai ou faux) fait foi pour le verrou : aucune relecture.
              ({ finalStatuses, error: linkedinError } = await applyLinkedInStatus(supabase, accId, newStatus, typeof payload.is_locked === 'boolean'));
              // Lecture ou écriture en échec, conflit sans fin, relecture du compte impossible : l'événement n'est pas
              // appliqué, il est rejoué (500), jamais acquitté comme traité.
              if (linkedinError) throw transientFailure(linkedinError);
            }
            if (linkedinError) console.warn('[unipile-webhook] status_updated: linkedin status write failed:', linkedinError);
            // Les inscriptions ne reprennent que si le compte est vraiment revenu OK (une liaison qui reste
            // verrouillée ou qui prend un autre état à la relecture ne reprend rien).
            if (newStatus === 'OK' && finalStatuses.every((status) => status === 'OK')) {
              await resumeEnrollmentsAfterReconnect(supabase, accId);
            }
          }
        } catch (e) {
          if (e instanceof TransientEventError) throw e;
          console.warn('[unipile-webhook] status_updated handler failed:', e);
        }
        break;
      }

      case 'account_disconnected':
      case 'account_error': {
        const reason = payload.event === 'account_disconnected' ? 'disconnected' : 'error';
        // Conformité LinkedIn : extraire UNIQUEMENT le message d'erreur lisible
        // (pas tout le payload.data qui peut contenir des cookies/tokens).
        const rawData = (payload.data as Record<string, unknown> | undefined) || {};
        const rawRoot = payload as unknown as Record<string, unknown>;
        const reasonText = (
          [rawData.reason, rawData.message, rawData.error, rawRoot.reason, rawRoot.message, rawRoot.error]
            .find((value): value is string => typeof value === 'string' && value !== '')
          || reason
        ).slice(0, 500);
        // Texte du prestataire : journal du serveur seulement. La colonne failure_reason, lisible par
        // les membres de l'organisation, ne reçoit qu'un code neutre (jamais le libellé brut).
        console.warn(`[unipile-webhook] Account ${reason}:`, payload.account_id, 'reason:', reasonText);
        const brokenStatus = mapAccountStatus(reason === 'disconnected' ? 'disconnected' : 'errored');

        // Écriture du statut conditionnelle à celui d'AVANT (compare-and-set, applyLinkedInStatus) : le membre
        // n'est prévenu qu'au passage d'un compte en état de marche à la panne (SEQ-208), une fois par passage
        // réel même pour des livraisons simultanées, pas à chaque événement répété.
        try {
          const { error: linkedinError } = await applyLinkedInStatus(supabase, payload.account_id, brokenStatus);
          // Panne non enregistrée (lecture ou écriture en échec, conflit sans fin) : rejouée, jamais acquittée.
          if (linkedinError) throw transientFailure(linkedinError);
          await supabase
            .from('member_email_accounts')
            .update({ account_status: brokenStatus })
            .eq('email_account_id', payload.account_id);
          const { error: whatsappError } = await supabase.from('member_whatsapp_accounts')
            .update({ account_status: reason === 'disconnected' ? 'DISCONNECTED' : 'ERROR', updated_at: new Date().toISOString() })
            .eq('whatsapp_account_id', payload.account_id).neq('account_status', 'DELETED');
          if (whatsappError) throw whatsappError;
        } catch (e) {
          if (e instanceof TransientEventError) throw e;
          console.warn('[unipile-webhook] Could not update account status:', e);
        }
        break;
      }

      // Accès au compte verrouillé puis déverrouillé (drapeau is_locked,
      // indépendant du statut). LOCKED bloque les envois comme tout statut
      // différent de OK, sans pause des inscriptions ; le membre en est prévenu
      // une fois (se reconnecter n'y change rien, il doit patienter ou vérifier
      // son compte). Même règle que account.status.* avec is_locked : LOCKED
      // remplace OK, DEGRADED, PARTIAL, l'absence de statut et un statut inconnu
      // (et prévient), jamais CREDENTIALS ni ERROR (le membre doit d'abord
      // reconnecter : la liaison garde son statut et sa notification), et pas
      // une liaison déjà LOCKED. Écriture et constat du passage sont une seule
      // écriture conditionnelle (moveLinkedInAccount) : des livraisons
      // simultanées ne préviennent qu'une fois.
      // Le déverrouillage ne relève que LOCKED, mais ne sait pas en quel état :
      // le verrou a pu remplacer DEGRADED ou PARTIAL, et aucun événement de
      // statut n'est émis quand seul le verrou change. Les liaisons enregistrées sont
      // lues d'abord : sans liaison LOCKED (OK, PARTIAL, CREDENTIALS...), il n'y a rien à
      // relever, ni relecture chez le prestataire ni écriture. Sinon l'état est relu chez le
      // prestataire (readReportedStatus : statut et verrou ensemble) et c'est lui qui est
      // écrit, sur les trois canaux ; un retour en PARTIAL, en CREDENTIALS ou en ERROR
      // prévient comme l'événement de statut l'aurait fait. Compte encore verrouillé chez le
      // prestataire : rien ne change. Relecture impossible (erreur, délai, compte sans
      // statut) ou lecture des liaisons en échec : rien n'est écrit, les liaisons restent
      // LOCKED (aucun envoi ne part sur un doute) et l'événement est rejoué (500).
      case 'account_locked':
      case 'account_unlocked': {
        const locking = payload.event === 'account_locked';
        const accId = payload.account_id;
        let moved: MovedLinkedAccountRow[] = [];
        let notice: AccountNotice | undefined = 'locked';
        try {
          const now = new Date().toISOString();
          if (locking) {
            const [linkedin, email, whatsapp] = await Promise.all([
              moveLinkedInAccount(supabase, accId, { account_status: 'LOCKED', last_checked_at: now }, LOCK_REPLACES_FILTER),
              supabase.from('member_email_accounts')
                .update({ account_status: 'LOCKED' })
                .eq('email_account_id', accId).or(LOCK_REPLACES_FILTER),
              supabase.from('member_whatsapp_accounts')
                .update({ account_status: 'LOCKED', updated_at: now })
                .eq('whatsapp_account_id', accId).or(LOCK_REPLACES_FILTER),
            ]);
            moved = linkedin.moved;
            for (const { error } of [linkedin, email, whatsapp]) {
              if (error) console.warn(`[unipile-webhook] ${payload.event} update failed:`, (error as { message?: string }).message ?? error);
            }
          } else if (await hasLockedBinding(supabase, accId)) {
            const returnsTo = await readReportedStatus(accId);
            if (returnsTo === null) throw new TransientEventError('Account state could not be re-read after the unlock');
            notice = NOTICE_BY_STATUS[returnsTo];
            if (returnsTo !== 'LOCKED') {
              const [linkedin, email, whatsapp] = await Promise.all([
                supabase.from('member_linkedin_accounts')
                  .update(statusPatch(returnsTo))
                  .eq('linkedin_account_id', accId).eq('account_status', 'LOCKED')
                  .select('user_id, organization_id, linkedin_account_name'),
                supabase.from('member_email_accounts')
                  .update({ account_status: returnsTo })
                  .eq('email_account_id', accId).eq('account_status', 'LOCKED'),
                supabase.from('member_whatsapp_accounts')
                  .update({ account_status: returnsTo, updated_at: now })
                  .eq('whatsapp_account_id', accId).eq('account_status', 'LOCKED'),
              ]);
              moved = linkedin.error ? [] : ((linkedin.data ?? []) as MovedLinkedAccountRow[]);
              for (const { error } of [linkedin, email, whatsapp]) {
                if (error) console.warn(`[unipile-webhook] ${payload.event} update failed:`, error.message);
              }
            }
          }
        } catch (e) {
          if (e instanceof TransientEventError) throw e;
          console.warn(`[unipile-webhook] ${payload.event} handler failed:`, e);
        }
        // Seules les liaisons que l'écriture vient de faire changer d'état sont prévenues.
        if (notice) await notifyAccountState(supabase, accId, moved, notice);
        break;
      }

      // Reconnus et journalisés (webhook_event_log), sans action : accusé de
      // lecture, réaction à un message, synchronisation initiale d'un compte.
      // Aucune colonne de synchronisation n'existe encore : l'état n'est pas stocké.
      case 'message_read':
      case 'message_reaction':
      case 'account_sync_completed':
      case 'account_sync_failed': {
        console.log('[unipile-webhook] Recognised, no action:', v2Event, payload.sync_status ?? '');
        break;
      }

      default:
        // Type non traité (par exemple message.update, chat.update) : la ligne de
        // dédoublonnage ci-dessus le journalise, la livraison est acquittée en 200
        // pour que le fournisseur ne la rejoue pas.
        console.log('[unipile-webhook] Unseen event type, logged and acknowledged without action:', v2Event);
    }

    // Must respond with 200 within 30 seconds
    return json({ success: true });
  } catch (error) {
    console.error('[unipile-webhook] Error:', error);
    // Échec RÉEL de traitement (DB down, RPC en erreur…) → 500 pour exploiter
    // les retries du fournisseur au lieu de perdre l'event définitivement
    // (audit 2026-07, Delivery M11 : un blip DB de 30s pendant un
    // mail_received = réponse du candidat jamais enregistrée → on continuait
    // de le relancer). On purge d'abord la ligne de dédup, sinon le retry
    // serait ignoré comme doublon. Le client ne lève pas : un échec arrive
    // dans { error } (il passait inaperçu, et le rejeu répondait
    // « deduplicated »). Repli : la clé est marquée en échec, et le rejeu la
    // reprend (voir la dédup plus haut).
    if (dedupKeyForCleanup && supabaseForCleanup) {
      try {
        const { error: cleanupError } = await supabaseForCleanup
          .from('webhook_event_log')
          .delete()
          .eq('event_key', dedupKeyForCleanup);
        if (cleanupError) {
          console.error('[unipile-webhook] Dedup cleanup failed:', cleanupError);
          const { error: markError } = await supabaseForCleanup
            .from('webhook_event_log')
            .update({ event_type: FAILED_EVENT_MARKER })
            .eq('event_key', dedupKeyForCleanup);
          if (markError) {
            console.error('[unipile-webhook] Dedup key kept: the provider retry will be ignored as a duplicate:', markError);
          }
        }
      } catch (cleanupErr) {
        console.error('[unipile-webhook] Dedup cleanup failed:', cleanupErr);
      }
    }
    return json({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }, 500);
  }
}

Deno.serve(handleRequest);

/**
 * Statut Konekt qu'un account.add ou account.reconnect sans tentative rapporte, ou null quand il ne dit rien : statut
 * absent ou mot hors de la spécification du prestataire (« paused »...), sans verrou. Un verrou (`is_locked` vrai) est
 * toujours une information. Pour null, le statut enregistré est gardé : ni écriture ni notification.
 */
function informedStatus(account: Parameters<typeof statusAtClaim>[0]): KonektAccountStatus | null {
  const word = typeof account.status === 'string' ? account.status.trim().toLowerCase() : '';
  if (!KNOWN_PROVIDER_STATUS_WORDS.has(word) && account.is_locked !== true) return null;
  return statusAtClaim(account);
}

/**
 * account.add / account.reconnect. Le `state` du lien d'authentification est
 * l'identifiant d'une tentative de connexion (table connection_attempts) : c'est
 * la seule piste qui désigne le membre et l'organisation, jamais la charge ni le
 * nom du compte. Le rattachement est le code partagé _shared/connection-claim.ts
 * (le même que celui de la connexion native, donc un `account.add` qui suit un
 * rattachement déjà fait est un rejeu sans effet). Tentative inconnue, échue,
 * annulée ou d'un autre canal : rien n'est rattaché, le membre est prévenu quand
 * on le connaît. Erreur de base : levée (500, le fournisseur rejoue).
 */
async function handleAccountConnected(supabase: SupabaseClient, payload: WebhookPayload) {
  const accountId = payload.account_id;
  console.log('[unipile-webhook] Account connected:', accountId, 'event:', payload.v2_event,
    'provider:', payload.account_type ?? null, 'migrated_account:', Boolean(payload.v1_account_id));

  let account = {
    id: accountId,
    provider: (payload.account_type ?? '').toLowerCase(),
    name: typeof payload.data?.name === 'string' ? payload.data.name : null,
    status: payload.provider_status ?? null,
    is_locked: payload.is_locked ?? null,
  };
  let providerReadFailed = false;
  if (!providerKind(account.provider)) {
    // Fournisseur absent de l'enveloppe : relu sur le compte (l'événement est authentifié
    // par le jeton ; le compte n'est pas encore rattaché, il n'y a pas de garde de propriété).
    try {
      const fresh = await getAccount(accountId);
      account = {
        id: accountId,
        provider: String(fresh.provider ?? '').toLowerCase(),
        name: fresh.name ?? account.name,
        status: fresh.status ?? account.status,
        is_locked: fresh.is_locked ?? account.is_locked,
      };
    } catch (e) {
      providerReadFailed = true;
      console.warn('[unipile-webhook] Account provider could not be read:', describeForLog(e));
    }
  }

  const outcome = await claimForAttempt(supabase, { attemptId: payload.state, account });
  // Fournisseur introuvable (enveloppe sans fournisseur et relecture en échec) : le refus
  // « fournisseur différent » serait faux et définitif. Rien n'est décidé, le fournisseur rejoue.
  if (providerReadFailed && !providerKind(account.provider) && outcome.outcome === 'refused' && outcome.reason === 'provider_mismatch') {
    throw new Error('account provider unreadable');
  }
  // La reprise des inscriptions suit un compte réellement utilisable : rattaché, déjà
  // rattaché par cette tentative, ou reconnexion sans tentative dont l'état rapporté est OK.
  let resumeAllowed = false;
  switch (outcome.outcome) {
    case 'claimed':
      console.log('[unipile-webhook] Account linked for the member of the connection attempt, kind:', outcome.result.kind);
      resumeAllowed = true;
      break;
    case 'replayed':
      console.log('[unipile-webhook] Account already linked by this connection attempt: nothing to do');
      resumeAllowed = true;
      break;
    case 'failed':
      console.error('[unipile-webhook] Account could not be linked:', outcome.reason);
      await insertClaimNotification(supabase, {
        userId: outcome.attempt.user_id,
        organizationId: outcome.attempt.organization_id,
        notice: outcome.notice,
        accountId,
      });
      break;
    case 'refused':
      if (outcome.attempt && outcome.notice) {
        console.warn('[unipile-webhook] Account not linked, connection attempt refused:', outcome.reason);
        await insertClaimNotification(supabase, {
          userId: outcome.attempt.user_id,
          organizationId: outcome.attempt.organization_id,
          notice: outcome.notice,
          accountId,
        });
      } else {
        // Ni lien d'authentification de Konekt ni flux natif connu (par exemple une
        // reconnexion faite côté prestataire) : rien n'est rattaché ; l'état d'une liaison
        // LinkedIn déjà en place suit celui de l'événement (même table de correspondance que
        // le rattachement : LOCKED, DEGRADED et PARTIAL ne repassent jamais OK d'eux-mêmes),
        // avec les règles de account.status.* : LOCKED ne remplace jamais CREDENTIALS ni ERROR,
        // un passage en PARTIAL ou en LOCKED prévient une fois, des livraisons simultanées
        // aussi (écriture conditionnelle au statut d'avant).
        console.warn('[unipile-webhook] No connection attempt for this event, nothing to link:', outcome.reason);
        const reportedStatus = informedStatus(account);
        if (reportedStatus === null) {
          // Statut absent ou mot hors de la spécification du prestataire, sans verrou : aucune information sur l'état
          // du compte. Le statut enregistré est gardé, rien n'est écrit, personne n'est prévenu.
          console.warn('[unipile-webhook] Event without a usable status, the stored status is kept:', payload.v2_event);
        } else {
          try {
            let finalStatuses: string[] = [];
            let statusError: unknown = null;
            if (reportedStatus === 'LOCKED') {
              const result = await moveLinkedInAccount(supabase, accountId, statusPatch(reportedStatus), LOCK_REPLACES_FILTER);
              statusError = result.error;
              await notifyAccountState(supabase, accountId, result.moved, 'locked');
            } else {
              ({ finalStatuses, error: statusError } = await applyLinkedInStatus(supabase, accountId, reportedStatus, typeof account.is_locked === 'boolean'));
              // Lecture ou écriture en échec, conflit sans fin, relecture du compte impossible : rejoué (500).
              if (statusError) throw transientFailure(statusError);
            }
            if (statusError) throw statusError;
            resumeAllowed = reportedStatus === 'OK' && finalStatuses.every((status) => status === 'OK');
          } catch (e) {
            if (e instanceof TransientEventError) throw e;
            console.warn('[unipile-webhook] Could not update account status (no connection attempt):', e);
          }
        }
      }
      break;
    case 'error':
      // Rien n'est décidé : le fournisseur rejoue (le rattachement est idempotent).
      throw new Error(outcome.message);
  }

  // Lot P0-D : les inscriptions mises en pause à la déconnexion de ce
  // compte reprennent d'elles-mêmes (pause explicite, reprise automatique).
  // Jamais après un rattachement refusé ou en échec : la liaison n'a pas changé.
  if (resumeAllowed) await resumeEnrollmentsAfterReconnect(supabase, accountId);
}

/**
 * account.remove : le compte n'existe plus chez le prestataire. Ce n'est pas une
 * déconnexion récupérable (reconnecter crée un autre compte) : la liaison est
 * retirée et les envois du compte arrêtés (mapAccountRemoved), comme « Dissocier ».
 * LinkedIn : arrêt des envois PUIS retrait de la liaison, jamais l'inverse (un arrêt
 * en échec lève : 500, le fournisseur rejoue, la liaison reste). E-mail : liaison
 * retirée. WhatsApp : liaison gardée en DELETED (un ancien identifiant ne peut pas
 * être repris, comme « disconnect_whatsapp »). Idempotent.
 */
async function handleAccountRemoved(supabase: SupabaseClient, payload: WebhookPayload) {
  const accountId = payload.account_id;
  const removal = mapAccountRemoved();
  console.warn('[unipile-webhook] Account removed at the provider:', accountId);

  const { data: linkedRows, error: linkedError } = await supabase
    .from('member_linkedin_accounts')
    .select('id, user_id, organization_id, linkedin_account_name')
    .eq('linkedin_account_id', accountId);
  if (linkedError) throw linkedError;
  const rows = (linkedRows ?? []) as Array<{ id: string; user_id: string; organization_id: string; linkedin_account_name: string | null }>;

  // Chaque membre est prévenu juste après le retrait de SA liaison : si la suite lève (500, le
  // fournisseur rejoue), les liaisons déjà retirées ne seront plus relues et leur membre ne serait
  // jamais prévenu. Non bloquant.
  const notifyRemoved = async (row: (typeof rows)[number]) => {
    try {
      const { error: notifError } = await supabase
        .from('notifications')
        .insert([linkedinDisconnectedNotification(row, accountId, { removed: true })]);
      if (notifError) console.warn('[unipile-webhook] Could not create removal notification:', notifError);
    } catch (e) {
      console.warn('[unipile-webhook] Error creating removal notification:', e);
    }
  };

  for (const row of rows) {
    if (removal.stopSending) {
      await stopLinkedInAccountSending(supabase, { organizationId: row.organization_id, accountId });
    }
    if (removal.unlink) {
      const { error: removeError } = await supabase
        .from('member_linkedin_accounts')
        .delete()
        .eq('id', row.id)
        .eq('organization_id', row.organization_id);
      if (removeError) throw removeError;
    }
    await notifyRemoved(row);
  }

  if (removal.unlink) {
    const { error: emailError } = await supabase.from('member_email_accounts').delete().eq('email_account_id', accountId);
    if (emailError) throw emailError;
  }
  const { error: whatsappError } = await supabase.from('member_whatsapp_accounts')
    .update({ account_status: 'DELETED', updated_at: new Date().toISOString() })
    .eq('whatsapp_account_id', accountId).neq('account_status', 'DELETED');
  if (whatsappError) throw whatsappError;
}

async function handleNewRelation(supabase: SupabaseClient, payload: WebhookPayload) {
  const { account_id } = payload;

  // relation.new : l'identifiant de la personne (user_provider_id), son nom et son
  // identifiant public (slug) viennent de `user` (flattenEnvelope). Un identifiant
  // de la v2 peut différer de celui des inscriptions : le slug du profil sert de
  // second rattachement.
  const profileId = payload.user_provider_id;
  const userName = payload.user_full_name || '';
  const publicIdentifier = (payload.user_public_identifier || linkedInSlugOf(payload.user_profile_url) || '').toLowerCase();

  if (!profileId && !publicIdentifier) {
    // Conformité LinkedIn : ne pas logger le payload brut (PII possibles)
    console.log('[unipile-webhook] new_relation: No profile ID (event:', payload.v2_event, 'account:', payload.account_id, ')');
    return;
  }

  console.log(`[unipile-webhook] new_relation: Profile connected: ${profileId ?? '?'} (${userName}, slug: ${publicIdentifier})`);

  // Inscriptions de ce candidat sur ce compte, actives OU en pause (SEQ-012 :
  // une acceptation pendant une pause n'était jamais consignée). Plus de
  // filtre sur connection_status (SEQ-209 : NULL, valeur par défaut des
  // inscriptions de l'interface, était exclu) : les inscriptions déjà
  // 'connected' sont ignorées dans la boucle.
  // Match on profile_id OR resolved_profile_id to handle Recruiter IDs (AEM -> ACo)
  let enrollments: SequenceEnrollment[] = [];
  if (profileId) {
    const byId = await findEnrollmentsBySenderAccount<SequenceEnrollment>(
      (column) => supabase
        .from('sequence_enrollments')
        .select('*')
        .eq(column, account_id)
        .in('status', OPEN_ENROLLMENT_STATUSES)
        .or(`profile_id.eq.${sanitizeFilterId(profileId)},resolved_profile_id.eq.${sanitizeFilterId(profileId)},provider_id.eq.${sanitizeFilterId(profileId)}`),
    );
    // Lecture impossible : on lève, le catch global purge la dédup et répond
    // 500, le prestataire rejoue (SEQ-040).
    if (byId.error) throw byId.error;
    enrollments = byId.rows;
  }
  if (enrollments.length === 0 && publicIdentifier) {
    const escapedSlug = publicIdentifier.replace(/([%_\\])/g, '\\$1');
    const bySlug = await findEnrollmentsBySenderAccount<SequenceEnrollment>(
      (column) => supabase
        .from('sequence_enrollments')
        .select('*')
        .eq(column, account_id)
        .in('status', OPEN_ENROLLMENT_STATUSES)
        .ilike('profile_url', `%/in/${escapedSlug}%`),
    );
    if (bySlug.error) throw bySlug.error;
    // Slug exact (le motif ilike accepte « marie-martin-4b2a1 » pour « marie-martin »).
    enrollments = bySlug.rows.filter((e) => linkedInSlugOf(e.profile_url) === publicIdentifier);
    if (enrollments.length > 0) console.log('[unipile-webhook] new_relation: matched via profile slug');
  }

  const toUpdate = enrollments.filter((e) => e.connection_status !== 'connected');
  if (toUpdate.length === 0) {
    console.log('[unipile-webhook] No enrollment waiting for this connection');
    return;
  }

  console.log(`[unipile-webhook] Found ${toUpdate.length} enrollments to update`);

  const failures: unknown[] = [];
  for (const enrollment of toUpdate) {
    const isActive = enrollment.status === 'active';

    // 1. Étape d'attente réarmée (inscription active seulement ; une
    //    inscription en pause reprendra son attente à la reprise). Fait AVANT
    //    le passage à 'connected' : si la suite échoue, le rejeu retrouve
    //    l'inscription (pas encore 'connected') et termine le travail.
    if (isActive) {
      const { data: waitSteps, error: waitStepsError } = await supabase
        .from('sequence_step_executions')
        .select('id, step_id, step_order')
        .eq('enrollment_id', enrollment.id)
        .in('status', ['waiting_event', 'scheduled'])
        .order('step_order', { ascending: true })
        .limit(1);
      if (waitStepsError) {
        failures.push(waitStepsError);
        continue;
      }

      if (waitSteps && waitSteps.length > 0) {
        const waitStep = waitSteps[0];
        // Verify this is indeed a wait_connection step
        const { data: stepDef, error: stepDefError } = await supabase
          .from('sequence_steps')
          .select('action_type')
          .eq('id', waitStep.step_id)
          .maybeSingle();
        if (stepDefError) {
          failures.push(stepDefError);
          continue;
        }

        if (stepDef?.action_type === 'wait_connection') {
          // Re-arme l'étape d'attente et laisse process-sequences la franchir au
          // prochain cycle (moins d'une minute). Une seule logique de
          // progression, celle du moteur (BUG-024). Garde de statut (SEQ-190) :
          // une exécution réclamée ('sending') ou franchie entre-temps n'est
          // jamais ramenée à 'scheduled'.
          const { error: rearmError } = await supabase
            .from('sequence_step_executions')
            .update({ status: 'scheduled', scheduled_at: new Date().toISOString() })
            .eq('id', waitStep.id)
            .in('status', ['waiting_event', 'scheduled']);
          if (rearmError) {
            failures.push(rearmError);
            continue;
          }
          console.log(`[unipile-webhook] Re-armed wait_connection step for enrollment ${enrollment.id}`);
        }
      }
    }

    // 2. Connexion consignée (actives et en pause). last_check_at seulement
    //    pour une inscription active. Mise à jour conditionnée : un second
    //    événement pour la même acceptation (relation.new puis
    //    relation.request.accept) ne recompte pas l'invitation acceptée.
    const { data: changed, error: updateError } = await supabase
      .from('sequence_enrollments')
      .update({
        connection_status: 'connected',
        network_distance: 'FIRST_DEGREE',
        ...(isActive ? { last_check_at: new Date().toISOString() } : {}),
      })
      .eq('id', enrollment.id)
      .or('connection_status.is.null,connection_status.neq.connected')
      .select('id');

    if (updateError) {
      failures.push(updateError);
      continue;
    }
    if (!changed || changed.length === 0) continue;

    // Log analytics — RPC d'incrément atomique (l'ancien upsert REMETTAIT le
    // compteur à 1 à partir du 2e événement du jour, faussant toutes les stats)
    await supabase.rpc('increment_sequence_analytics', {
      p_sequence_id: enrollment.sequence_id,
      p_field: 'invites_accepted',
    });

    console.log('[unipile-webhook] Updated enrollment:', enrollment.id, 'to connected');
  }

  // Échec d'une écriture : les autres lignes sont traitées, puis on lève
  // pour que le prestataire rejoue l'événement (idempotent).
  if (failures.length > 0) {
    console.error(`[unipile-webhook] new_relation: ${failures.length} enrollment(s) not updated:`, failures[0]);
    throw failures[0];
  }
}

// Réponse envoyée hors de l'application (LinkedIn mobile par exemple) : la
// conversation est traitée, ses notifications new_message non lues passent en
// lues pour les utilisateurs liés à ce compte. Non bloquant.
// Limite connue : un envoi automatique de séquence dans la même conversation
// a le même effet. Il est rare après une réponse, puisque la réponse du
// candidat annule les étapes restantes.
async function markChatNotificationsRead(
  supabase: SupabaseClient,
  accountId: string | undefined,
  chatId: string | undefined,
): Promise<void> {
  if (!chatId || !accountId) return;
  try {
    const { data: accountUsers, error: usersError } = await supabase
      .from('member_linkedin_accounts')
      .select('user_id')
      .eq('linkedin_account_id', accountId);
    if (usersError) {
      console.warn('[unipile-webhook] Own message: linked users lookup failed:', usersError);
      return;
    }
    const userIds = [...new Set((accountUsers ?? []).map((u: { user_id: string }) => u.user_id))];
    if (userIds.length === 0) return;
    const { error: readError } = await supabase
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .in('user_id', userIds)
      .eq('type', 'new_message')
      .is('read_at', null)
      .eq('metadata->>chat_id', chatId);
    if (readError) console.warn('[unipile-webhook] Own message: marking notifications read failed:', readError);
  } catch (e) {
    console.warn('[unipile-webhook] Own message: marking notifications read failed:', e);
  }
}

const textOrNull = (value: unknown): string | null => (typeof value === 'string' ? value : null);

/**
 * Candidat d'une conversation à deux : `user`, l'autre participant, tel que le
 * rend GET /{compte}/chats/{chat}. Une conversation de groupe ou de canal : null,
 * pour ne jamais attribuer un message au mauvais candidat.
 */
function otherParticipantRef(chat: { type?: unknown; is_1to1?: unknown; user?: unknown; user_id?: unknown } | null): CandidateRef | null {
  if (!chat) return null;
  if (!(chat.type === '1to1' || chat.is_1to1 === true)) return null;
  const user = (chat.user && typeof chat.user === 'object' ? chat.user : {}) as {
    id?: unknown; public_identifier?: unknown; profile_url?: unknown; display_name?: unknown;
  };
  const ref = candidateRef({
    ids: [textOrNull(user.id), textOrNull(chat.user_id)],
    slug: textOrNull(user.public_identifier),
    profileUrl: textOrNull(user.profile_url),
    name: textOrNull(user.display_name),
  });
  return ref.ids.length > 0 || ref.slug ? ref : null;
}

/** Autre participant d'une conversation, lu auprès du prestataire ; null si illisible. */
async function fetchChatOtherParticipant(accountId: string, chatId: string): Promise<CandidateRef | null> {
  try {
    return otherParticipantRef(await getChat(accountId, chatId));
  } catch (e) {
    console.warn('[unipile-webhook] Own message: chat lookup failed:', describeForLog(e));
    return null;
  }
}

/**
 * Candidat effacé (RGPD, D5) dans cette organisation : son étape n'est plus
 * écrite, comme ses inscriptions ne changent plus. Lecture impossible : levée
 * (l'appelant décide : rejeu pour une réponse, rien pour un message propre).
 */
async function stageErasedFor(supabase: SupabaseClient, organizationId: string, candidate: CandidateRef): Promise<boolean> {
  return await isCandidateErasedForOrg(supabase, {
    organizationId,
    linkedinIds: candidate.ids,
    linkedinUrl: candidate.profile_url ?? (candidate.slug ? `https://www.linkedin.com/in/${candidate.slug}` : null),
  });
}

/**
 * Conversation ou candidat déjà lié à une mission de cette organisation sur
 * ce compte (mission_conversations). Sert au compte relié à plusieurs
 * organisations (état hérité, antérieur à prevent_linkedin_account_cross_tenant).
 * Lecture impossible : levée.
 */
async function missionLinkOnAccount(
  supabase: SupabaseClient,
  organizationId: string,
  accountId: string,
  chatId: string | null | undefined,
  candidateIds: string[],
): Promise<boolean> {
  const ids = candidateIds.map(sanitizeFilterId).filter(Boolean);
  const filters = [
    ...(chatId ? [`chat_id.eq.${sanitizeFilterId(chatId)}`] : []),
    ...(ids.length > 0 ? [`candidate_id.in.(${ids.join(',')})`, `candidate_ids.ov.{${ids.join(',')}}`] : []),
  ];
  if (filters.length === 0) return false;
  const { data, error } = await supabase
    .from('mission_conversations')
    .select('id')
    .eq('organization_id', organizationId)
    .eq('account_id', accountId)
    .or(filters.join(','))
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Message écrit depuis le compte du recruteur, dans Konekt ou hors Konekt
 * (plan 0b, décision 5 et section 4.2) : record_own_message dans chaque
 * organisation reliée au compte. Écho d'un envoi Konekt ou note d'invitation :
 * rien ; conversation déjà rattachée : « Contacté » pour un candidat Retenu
 * dans la mission de ce lien seulement ; sinon Retenu dans une seule mission :
 * « Contacté ». Candidat inconnu (format new_message) et conversation sans
 * lien : ses participants sont lus une fois, puis second appel. Compte relié
 * à plusieurs organisations : seules celles où la conversation ou le candidat
 * est déjà lié sur ce compte sont écrites (jamais U-I7), comme pour la
 * réponse. Non bloquant : aucune erreur ne remonte, le webhook répond 200.
 */
async function handleOwnMessage(
  supabase: SupabaseClient,
  accountId: string | undefined,
  chatId: string | undefined,
  messageId: string | null,
  otherParticipant: CandidateRef | null,
): Promise<void> {
  if (!accountId) return;
  try {
    const { data: rows, error } = await supabase
      .from('member_linkedin_accounts')
      .select('organization_id')
      .eq('linkedin_account_id', accountId);
    if (error) {
      console.warn('[unipile-webhook] Own message: linked organizations lookup failed:', error);
      return;
    }
    const orgIds = [...new Set(((rows ?? []) as Array<{ organization_id: string | null }>)
      .map((r) => r.organization_id)
      .filter((org): org is string => !!org))];
    // undefined : participants pas encore lus (une seule lecture pour toutes les organisations).
    let fetched: CandidateRef | null | undefined;
    const sharedAccount = orgIds.length > 1;
    for (const organizationId of orgIds) {
      const call = (candidate: CandidateRef | null) => recordOwnMessage(supabase, {
        organizationId, accountId, chatId: chatId ?? null, messageId, candidate,
      });
      // Candidat effacé (RGPD) dans cette organisation : rien n'est écrit.
      const erased = async (candidate: CandidateRef) => {
        try {
          return await stageErasedFor(supabase, organizationId, candidate);
        } catch (e) {
          console.warn('[unipile-webhook] Own message: erasure check failed, nothing recorded:', e);
          return true;
        }
      };
      if (sharedAccount) {
        try {
          let linked = await missionLinkOnAccount(supabase, organizationId, accountId, chatId, otherParticipant?.ids ?? []);
          if (!linked && !otherParticipant && chatId) {
            if (fetched === undefined) fetched = await fetchChatOtherParticipant(accountId, chatId);
            if (fetched) linked = await missionLinkOnAccount(supabase, organizationId, accountId, chatId, fetched.ids);
          }
          if (!linked) {
            console.log(`[unipile-webhook] Own message in org ${organizationId}: shared account, no link on it`);
            continue;
          }
        } catch (e) {
          console.warn('[unipile-webhook] Own message: conversation links unreadable, nothing recorded:', e);
          continue;
        }
      }
      if (otherParticipant && await erased(otherParticipant)) continue;
      let result = await call(otherParticipant);
      if (result.ok && result.data.result === 'no_candidate' && !otherParticipant && chatId) {
        if (fetched === undefined) fetched = await fetchChatOtherParticipant(accountId, chatId);
        if (fetched && !(await erased(fetched))) result = await call(fetched);
      }
      if (result.ok) console.log(`[unipile-webhook] Own message in org ${organizationId}: ${result.data.result}`);
      else console.error('[unipile-webhook] Own message: stage not recorded:', result.fn, result.kind, result.error);
    }
  } catch (e) {
    console.warn('[unipile-webhook] Own message: stage update failed (non-blocking):', e);
  }
}

async function handleNewMessage(supabase: SupabaseClient, payload: WebhookPayload, eventKey: string) {
  const { account_id, data } = payload;

  // message.new, aplati par flattenEnvelope : { data: { message: {...}, chat: {...} } }.
  // La v2 donne toujours is_sender (obligatoire dans l'objet Message) : plus aucune
  // lecture des participants de la conversation pour savoir qui écrit.
  const message = data?.message as {
    id?: string;
    sender_id?: string;
    sender?: { id?: string; name?: string };
    is_sender?: boolean;
    is_event?: boolean;
    is_hidden?: boolean;
    is_deleted?: boolean;
    message_type?: string | null;
    chat_id?: string;
  } | undefined;
  if (!message) {
    console.log('[unipile-webhook] handleNewMessage: Unrecognized payload format, keys:', Object.keys(payload));
    return;
  }
  const chat = data?.chat as { id?: string } | undefined;
  const chatId: string | undefined = message.chat_id || chat?.id;
  const senderId: string | undefined = message.sender?.id || message.sender_id;
  let isSenderSelf: boolean | undefined = message.is_sender === true ? true : message.is_sender === false ? false : undefined;
  // Identifiant du message (même source que la clé de dédoublonnage) : écho d'un envoi Konekt.
  const messageId: string | null = payload.message_id || message.id || null;

  // Ligne système (appel manqué, épinglage...), masquée ou supprimée : ni une
  // réponse du candidat, ni un message écrit depuis le compte du recruteur.
  if (message.is_event === true || message.is_hidden === true || message.is_deleted === true) {
    console.log('[unipile-webhook] Skipping - system, hidden or deleted message row');
    return;
  }

  // Message écrit depuis notre compte : traité avant toute lecture des membres, comme avant
  // (ce chemin est non bloquant : une lecture en échec n'y fait pas répondre 500, ce qui
  // purgerait la clé de dédoublonnage et ferait rejouer chaque écho d'un envoi).
  const handleSentByUs = async () => {
    await markChatNotificationsRead(supabase, account_id, chatId);
    // Candidat inconnu ici : celui de la conversation liée, sinon ses participants.
    await handleOwnMessage(supabase, account_id, chatId, messageId, null);
    console.log('[unipile-webhook] Skipping - this is our own sent message');
  };
  if (isSenderSelf === true) {
    await handleSentByUs();
    return;
  }

  // Membres reliés à ce compte (lus une fois : étape du candidat et notifications
  // plus bas). Compte non relié à Konekt : aucune lecture auprès du prestataire,
  // la clé du service étant commune à toutes les organisations.
  const { data: memberRows, error: membersReadError } = await supabase
    .from('member_linkedin_accounts')
    .select('user_id, organization_id')
    .eq('linkedin_account_id', account_id);
  // Lecture impossible : on lève (catch global → 500 → rejeu), comme les autres lectures.
  if (membersReadError) throw membersReadError;
  const linkedMembers = (memberRows ?? []) as Array<{ user_id: string; organization_id: string | null }>;

  // is_sender absent (charge mal formée) : le message est relu auprès du
  // prestataire. Expéditeur non vérifié = échec (500) et rejeu, jamais une
  // clôture à l'aveugle (décision 11).
  if (isSenderSelf === undefined && chatId && messageId && linkedMembers.length > 0) {
    let verificationUnavailable: unknown = null;
    try {
      const fresh = await getMessage(account_id, chatId, messageId);
      isSenderSelf = fresh.is_sender === true ? true : fresh.is_sender === false ? false : undefined;
    } catch (e) {
      console.warn('[unipile-webhook] Failed to verify sender by reading the message:', describeForLog(e));
      verificationUnavailable = e;
    }
    if (isSenderSelf === undefined && verificationUnavailable) {
      console.error('[unipile-webhook] Sender verification unavailable — event will be retried');
      throw verificationUnavailable instanceof Error
        ? verificationUnavailable
        : new Error('sender verification unavailable');
    }
  }

  // Message dont la relecture montre qu'il est de nous.
  if (isSenderSelf === true) {
    await handleSentByUs();
    return;
  }

  // Compte relié à aucune organisation de Konekt : il n'y a personne pour qui agir et rien à
  // relire (la clé du service est commune à toutes les organisations). Acquitté, jamais rejoué.
  if (isSenderSelf === undefined && linkedMembers.length === 0) {
    console.log('[unipile-webhook] new_message on an account linked to no organisation, sender not indicated: ignored');
    return;
  }

  if (isSenderSelf === undefined) {
    console.error('[unipile-webhook] new_message without sender indication nor fields to verify it — event will be retried');
    throw new Error('new_message sender not verifiable (no is_sender, chat or message id)');
  }

  // Invitation ou réponse d'InMail de cycle de vie (acceptation, refus) : pas une réponse écrite.
  if (!isCandidateReplyCandidate(message)) {
    console.log('[unipile-webhook] Skipping - lifecycle row (invitation or InMail status), not a written answer');
    return;
  }

  if (!senderId) {
    console.log('[unipile-webhook] No sender ID found in payload');
    return;
  }

  console.log('[unipile-webhook] Message from:', senderId, '| Chat:', chatId, '| Account:', account_id);

  // Inscriptions de ce candidat sur ce compte, actives OU en pause (SEQ-012 :
  // une réponse reçue pendant une pause était ignorée, et la reprise relançait
  // le candidat qui avait déjà répondu). Rattachement exact d'abord, puis repli
  // sur profile_url, puis identifiants alternatifs résolus auprès du
  // prestataire (SEQ-110 : InMail envoyé sur un identifiant Recruiter, réponse
  // reçue d'un identifiant classique).
  // LinkedIn IDs can come in different formats: "AEMAABl08fo...", "ACo...", "urn:li:member:..."
  let enrollments: SequenceEnrollment[] = [];
  const safeSenderId = sanitizeFilterId(senderId);

  const { rows: exactMatch, error: exactError } = await findEnrollmentsBySenderAccount<SequenceEnrollment>(
    (column) => supabase
      .from('sequence_enrollments')
      .select('*')
      .eq(column, account_id)
      .in('status', OPEN_ENROLLMENT_STATUSES)
      .or(`profile_id.eq.${safeSenderId},resolved_profile_id.eq.${safeSenderId},provider_id.eq.${safeSenderId}`),
  );
  // Lecture impossible : on lève (catch global → 500 → rejeu, SEQ-040).
  if (exactError) throw exactError;

  if (exactMatch && exactMatch.length > 0) {
    enrollments = exactMatch;
  } else {
    // Try matching by profile URL containing the sender ID (for cases where format differs)
    const { rows: urlMatch, error: urlError } = await findEnrollmentsBySenderAccount<SequenceEnrollment>(
      (column) => supabase
        .from('sequence_enrollments')
        .select('*')
        .eq(column, account_id)
        .in('status', OPEN_ENROLLMENT_STATUSES)
        .like('profile_url', `%${safeSenderId}%`),
    );
    if (urlError) throw urlError;
    if (urlMatch && urlMatch.length > 0) {
      enrollments = urlMatch;
      console.log('[unipile-webhook] Matched via profile_url fallback');
    }
  }

  // Identifiants alternatifs du candidat (résolus une seule fois, réutilisés
  // pour l'arrêt de ses autres inscriptions et la file InMail plus bas).
  // Best-effort : un échec n'empêche pas la suite, le contrôle avant envoi du
  // moteur reste le filet.
  let senderAltIds: string[] | null = null;
  let senderPublicIdentifier: string | null = null;
  const resolveSenderAltIds = async (): Promise<string[]> => {
    if (senderAltIds) return senderAltIds;
    senderAltIds = [];
    // Compte non relié à Konekt : rien à rattacher, aucune lecture de profil.
    if (linkedMembers.length === 0) return senderAltIds;
    try {
      const profile = await getProfile(account_id, senderId);
      const altIds = new Set<string>();
      if (typeof profile.id === 'string' && profile.id && profile.id !== senderId) altIds.add(profile.id);
      senderAltIds = [...altIds];
      if (typeof profile.public_identifier === 'string' && profile.public_identifier) {
        senderPublicIdentifier = profile.public_identifier.toLowerCase();
      }
      if (senderAltIds.length > 0) console.log(`[unipile-webhook] Resolved sender ${senderId} → alt IDs:`, senderAltIds);
    } catch (e) {
      console.warn('[unipile-webhook] Failed to resolve sender alternative IDs:', describeForLog(e));
    }
    return senderAltIds;
  };

  if (enrollments.length === 0) {
    const altIds = (await resolveSenderAltIds()).map(sanitizeFilterId).filter(Boolean);
    if (altIds.length > 0) {
      const list = altIds.join(',');
      const { rows: altMatch, error: altError } = await findEnrollmentsBySenderAccount<SequenceEnrollment>(
        (column) => supabase
          .from('sequence_enrollments')
          .select('*')
          .eq(column, account_id)
          .in('status', OPEN_ENROLLMENT_STATUSES)
          .or(`profile_id.in.(${list}),resolved_profile_id.in.(${list}),provider_id.in.(${list})`),
      );
      if (altError) throw altError;
      enrollments = altMatch;
    }
    const slug = senderPublicIdentifier as string | null;
    if (enrollments.length === 0 && slug) {
      const escapedSlug = slug.replace(/([%_\\])/g, '\\$1');
      const { rows: slugMatch, error: slugError } = await findEnrollmentsBySenderAccount<SequenceEnrollment>(
        (column) => supabase
          .from('sequence_enrollments')
          .select('*')
          .eq(column, account_id)
          .in('status', OPEN_ENROLLMENT_STATUSES)
          .ilike('profile_url', `%/in/${escapedSlug}%`),
      );
      if (slugError) throw slugError;
      // Slug exact (le motif ilike accepte « marie-martin-4b2a1 » pour « marie-martin »).
      enrollments = slugMatch.filter((e) => linkedInSlugOf(e.profile_url) === slug);
    }
    if (enrollments.length > 0) console.log('[unipile-webhook] Matched via resolved sender identifiers');
  }

  // Inscriptions réellement closes par CE traitement (réponse comptée une fois).
  const closedEnrollments: SequenceEnrollment[] = [];
  const failures: unknown[] = [];
  // Clôture « A répondu » depuis `fromStatuses` : inscription ouverte, ou
  // terminée (décision 8, plus bas ; sa date de fin est gardée).
  const recordReply = async (enrollment: SequenceEnrollment, fromStatuses: string[]) => {
    const nowIso = new Date().toISOString();
    // Clôture conditionnée au statut (SEQ-191) : si le moteur l'a déjà close,
    // aucune ligne ne change et la réponse n'est pas recomptée.
    const { data: changed, error: updateError } = await supabase
      .from('sequence_enrollments')
      .update({
        status: 'replied',
        replied_at: nowIso,
        updated_at: nowIso,
        pause_reason: null,
        // Identifiant classique mémorisé (SEQ-110) : les prochains
        // rattachements et le contrôle avant envoi le trouvent directement.
        ...(!enrollment.resolved_profile_id && enrollment.profile_id !== senderId ? { resolved_profile_id: senderId } : {}),
      })
      .eq('id', enrollment.id)
      .in('status', fromStatuses)
      .select('id');

    if (updateError) {
      failures.push(updateError);
      return;
    }

    // Cancel any pending step executions — TOUS les statuts pendants, pas
    // seulement 'scheduled' (audit 2026-07, Delivery M6). Fait aussi quand
    // l'inscription était déjà close (aucune ligne changée) : elle est alors
    // terminale et ne doit plus rien avoir en attente (rejeu idempotent).
    // Un échec est remonté (500, rejeu) sans sauter le compte de la réponse
    // de la clôture effective : le rejeu ne retrouve plus l'inscription parmi
    // les ouvertes, et les étapes restées en attente ne partent jamais
    // (contrôle avant envoi du moteur, SEQ-189).
    const { error: cancelError } = await supabase
      .from('sequence_step_executions')
      .update({
        status: 'cancelled',
        skip_reason: 'Reply detected via webhook',
        updated_at: nowIso,
      })
      .eq('enrollment_id', enrollment.id)
      .in('status', PENDING_EXECUTION_STATUSES);
    if (cancelError) failures.push(cancelError);

    if (!changed || changed.length === 0) return;
    closedEnrollments.push(enrollment);

    // Log analytics — incrément atomique (cf. increment_sequence_analytics)
    await supabase.rpc('increment_sequence_analytics', {
      p_sequence_id: enrollment.sequence_id,
      p_field: 'replies_received',
    });

    console.log('[unipile-webhook] Enrollment', enrollment.id, 'marked as replied');
    // Étape du candidat : plus bas, pour tout message du candidat (rejeu compris).
  };
  if (enrollments.length === 0) {
    console.log('[unipile-webhook] No open enrollments found for sender:', senderId);
  } else {
    // Extra validation: log the matched profiles to help debug false positives
    console.log(`[unipile-webhook] Found ${enrollments.length} enrollment(s) - marking as replied:`, 
      enrollments.map(e => ({ id: e.id, profile_id: e.profile_id })));
    for (const enrollment of enrollments) await recordReply(enrollment, OPEN_ENROLLMENT_STATUSES);
  }

  // Identifiants alternatifs résolus aussi quand le rattachement exact a
  // réussi : l'inscription du candidat sous son identifiant Recruiter, sur le
  // compte d'un collègue, fait partie de celles à arrêter plus bas (SEQ-212).
  const resolvedAltIds = await resolveSenderAltIds();

  // Aucune inscription ouverte : message reçu sur une inscription déjà close
  // de ce compte (terminée ; déjà « répondu » par le moteur, ou par un premier
  // passage dont l'arrêt des autres inscriptions a échoué, rejoué ici). Elle
  // rattache le candidat à son organisation pour l'arrêt plus bas. Déjà
  // « répondu » : rien ne change, la réponse n'est pas recomptée (SEQ-191).
  // Terminée : réponse à la dernière relance (décision 8, plus bas).
  let closedAnchors: SequenceEnrollment[] = [];
  if (enrollments.length === 0 && safeSenderId) {
    const idList = [safeSenderId, ...resolvedAltIds.map(sanitizeFilterId)].filter(Boolean).join(',');
    const byId = await findEnrollmentsBySenderAccount<SequenceEnrollment>(
      (column) => supabase
        .from('sequence_enrollments')
        .select('*')
        .eq(column, account_id)
        .in('status', REPLY_CLOSED_ENROLLMENT_STATUSES)
        .or(`profile_id.in.(${idList}),resolved_profile_id.in.(${idList}),provider_id.in.(${idList})`),
    );
    if (byId.error) throw byId.error;
    closedAnchors = byId.rows;
    if (closedAnchors.length === 0) {
      const byUrl = await findEnrollmentsBySenderAccount<SequenceEnrollment>(
        (column) => supabase
          .from('sequence_enrollments')
          .select('*')
          .eq(column, account_id)
          .in('status', REPLY_CLOSED_ENROLLMENT_STATUSES)
          .like('profile_url', `%${safeSenderId}%`),
      );
      if (byUrl.error) throw byUrl.error;
      closedAnchors = byUrl.rows;
    }
    const slug = senderPublicIdentifier as string | null;
    if (closedAnchors.length === 0 && slug) {
      const bySlug = await findEnrollmentsBySenderAccount<SequenceEnrollment>(
        (column) => supabase
          .from('sequence_enrollments')
          .select('*')
          .eq(column, account_id)
          .in('status', REPLY_CLOSED_ENROLLMENT_STATUSES)
          .ilike('profile_url', `%/in/${slug.replace(/([%_\\])/g, '\\$1')}%`),
      );
      if (bySlug.error) throw bySlug.error;
      closedAnchors = bySlug.rows.filter((e) => linkedInSlugOf(e.profile_url) === slug);
    }
    if (closedAnchors.length > 0) console.log(`[unipile-webhook] Message on ${closedAnchors.length} closed enrollment(s)`);
  }

  // Décision 8 : la plus récente inscription close de ce compte, si elle est
  // terminée, passe « A répondu » (réponse comptée),
  // comme « Marquer comme répondu ». Clôture conditionnée à 'completed'.
  for (const enrollment of lateReplyEnrollments(closedAnchors)) await recordReply(enrollment, ['completed']);

  // Also update inmail_queue entries for this sender (for ATS tracking).
  // Limité au compte qui reçoit la réponse (SEQ-111) : un InMail du même
  // candidat envoyé par un autre compte, ou une autre organisation, n'est pas
  // une réponse à celui-là. Les InMails déjà « répondu » sont relus aussi : ils
  // rattachent le candidat à son organisation (rejeu). Lecture impossible :
  // levée (500, rejeu) ; marquage non bloquant.
  // Identifiant exact et identifiants alternatifs lus ensemble : InMails
  // envoyés sur un identifiant AEM…, réponses reçues d'un ACo… (ou l'inverse),
  // et un ancien InMail « répondu » sur l'un ne masque pas un InMail « envoyé »
  // sur l'autre (SEQ-110, SEQ-212).
  type InMailMatch = { id: string; recipient_profile_id: string; organization_id: string | null; status: string; updated_at: string };
  const { data: inmailRows, error: inmailLookupError } = await supabase
    .from('inmail_queue')
    .select('id, recipient_profile_id, organization_id, status, updated_at')
    .eq('account_id', account_id)
    .in('status', ['sent', 'replied'])
    .in('recipient_profile_id', [senderId, ...resolvedAltIds]);
  if (inmailLookupError) {
    console.warn('[unipile-webhook] inmail lookup failed:', inmailLookupError);
    failures.push(inmailLookupError);
  }
  const inmailMatches = inmailRows as InMailMatch[] | null;

  const sentInmails = (inmailMatches ?? []).filter((m) => m.status === 'sent');
  if (sentInmails.length > 0) {
    console.log(`[unipile-webhook] Marking ${sentInmails.length} inmail_queue entries as replied`);
    const inmailIds = sentInmails.map(m => m.id);
    const { error: inmailUpdateError } = await supabase
      .from('inmail_queue')
      .update({
        status: 'replied',
        updated_at: new Date().toISOString(),
      })
      .in('id', inmailIds)
      .eq('status', 'sent');
    if (inmailUpdateError) console.warn('[unipile-webhook] inmail replied update failed:', inmailUpdateError);
  }

  // Même candidat ailleurs dans l'organisation (SEQ-212) : autres inscriptions
  // arrêtées, InMails pas encore partis annulés. Organisations : celles des
  // inscriptions et des InMails de ce compte auxquels le message se rattache,
  // jamais une organisation sans contact avec lui (compte relié à plusieurs
  // organisations, SEQ-006). Portée bornée quand le contact était déjà clos
  // (replySiblingScope, contrat §8).
  const anchorsByOrg = new Map<string, ReplyAnchor[]>();
  const addAnchor = (orgId: string | null | undefined, anchor: ReplyAnchor) => {
    if (orgId) anchorsByOrg.set(orgId, [...(anchorsByOrg.get(orgId) ?? []), anchor]);
  };
  for (const e of enrollments) addAnchor(e.organization_id, { live: true });
  // Fin du contact clos : date de fin gardée par une inscription terminée puis
  // « répondu » (décision 8), aussi au rejeu (closedContactEnd).
  for (const e of closedAnchors) addAnchor(e.organization_id, { live: false, endedAt: closedContactEnd(e) });
  for (const m of inmailMatches ?? []) addAnchor(m.organization_id, m.status === 'sent' ? { live: true } : { live: false, endedAt: m.updated_at });

  const anchorRows = [...enrollments, ...closedAnchors];
  const candidate = {
    ids: [
      senderId, ...resolvedAltIds,
      ...anchorRows.flatMap((e) => [e.profile_id, e.provider_id, e.resolved_profile_id]),
      ...(inmailMatches ?? []).map((m) => m.recipient_profile_id),
    ],
    slugs: [senderPublicIdentifier, ...anchorRows.map((e) => e.profile_url)],
  };
  const handledIds = new Set(anchorRows.map((e) => e.id));
  // Organisations où l'arrêt a échoué : le recruteur est prévenu (décision 10).
  const stopFailedOrgs = new Set<string>();
  for (const [orgId, anchors] of anchorsByOrg) {
    const scope = replySiblingScope(anchors);
    try {
      await closeSiblingEnrollments(supabase, orgId, candidate, handledIds, scope);
    } catch (siblingError) {
      failures.push(siblingError);
      stopFailedOrgs.add(orgId);
    }
    try {
      await cancelScheduledInMails(supabase, { organizationId: orgId }, candidate.ids, scope);
    } catch (inmailError) {
      failures.push(inmailError);
      stopFailedOrgs.add(orgId);
    }
  }
  // Le compte qui vient de recevoir le message du candidat ne lui envoie pas
  // ensuite l'InMail qu'il avait programmé, même sans autre contact connu.
  let accountInMailsFailed = false;
  try {
    await cancelScheduledInMails(supabase, { accountId: account_id }, candidate.ids);
  } catch (inmailError) {
    failures.push(inmailError);
    accountInMailsFailed = true;
  }

  // Étape du candidat (plan 0b, section 3) : pour tout message confirmé du
  // candidat, avec ou sans inscription, record_candidate_inbound dans chaque
  // organisation du compte et de ses contacts rattachés. Seule la mission
  // résolue change (conversation, profil, inscription, lignes contactées :
  // décision 3). Décision 9 : erreur transitoire → rejeu (500), levé après les
  // notifications ; refus métier ou fonction absente → journal seul. Le rejeu
  // refait l'appel sans effet.
  const stageCandidate = candidateRef({ ids: candidate.ids, slug: candidateSlugs(candidate.slugs)[0] ?? null });
  const stageOrgIds = [...new Set([...linkedMembers.map((m) => m.organization_id), ...anchorsByOrg.keys()]
    .filter((org): org is string => !!org))];
  const missionByOrg = new Map<string, string>();
  const stageFailures: Error[] = [];
  // Compte relié à plusieurs organisations (état hérité, antérieur à
  // prevent_linkedin_account_cross_tenant) : une organisation sans contact
  // rattaché sur ce compte (inscription, InMail) n'est écrite que si la
  // conversation ou le candidat y est déjà lié à une mission sur ce compte.
  // Sinon ses lignes contactées depuis un autre compte ne deviennent pas la
  // cible d'une réponse reçue ici.
  const sharedAccount = new Set(linkedMembers.map((m) => m.organization_id).filter(Boolean)).size > 1;
  const linkedOnAccount = (orgId: string): Promise<boolean> =>
    missionLinkOnAccount(supabase, orgId, account_id, chatId, stageCandidate.ids);
  for (const orgId of stageOrgIds) {
    if (sharedAccount && !anchorsByOrg.has(orgId)) {
      try {
        if (!(await linkedOnAccount(orgId))) {
          console.log(`[unipile-webhook] Reply stage skipped in org ${orgId}: shared account, no contact on it`);
          continue;
        }
      } catch (e) {
        console.error('[unipile-webhook] Reply stage: conversation links unreadable:', e);
        stageFailures.push(e instanceof Error ? e : new Error(String(e)));
        continue;
      }
    }
    // Candidat effacé (RGPD) dans cette organisation : aucune étape (D5).
    // Registre illisible : rejeu, comme une erreur transitoire.
    try {
      if (await stageErasedFor(supabase, orgId, stageCandidate)) {
        console.log(`[unipile-webhook] Reply stage skipped in org ${orgId}: candidate erased`);
        continue;
      }
    } catch (e) {
      console.error('[unipile-webhook] Reply stage: erasure check failed:', e);
      stageFailures.push(e instanceof Error ? e : new Error(String(e)));
      continue;
    }
    const inbound = await recordInbound(supabase, {
      organizationId: orgId,
      accountId: account_id,
      candidate: stageCandidate,
      chatId: chatId ?? null,
      enrollmentIds: anchorRows.filter((e) => e.organization_id === orgId).map((e) => e.id),
    });
    if (inbound.ok) {
      if (inbound.data.project_id) missionByOrg.set(orgId, inbound.data.project_id);
      console.log(`[unipile-webhook] Reply stage in org ${orgId}:`,
        inbound.data.project_id ?? ('reason' in inbound.data ? inbound.data.reason : null));
      continue;
    }
    console.error('[unipile-webhook] Reply stage not recorded:', inbound.fn, inbound.kind, inbound.error);
    if (inbound.kind === 'transient') stageFailures.push(new Error(`${inbound.fn}: ${inbound.error.message}`));
  }

  if (failures.length > 0) {
    console.error(`[unipile-webhook] new_message: ${failures.length} write(s) failed:`, failures[0]);
    if (stopFailedOrgs.size > 0 || accountInMailsFailed) {
      // Destinataires : membres reliés au compte qui a reçu la réponse et
      // auteurs des inscriptions auxquelles elle se rattache, par organisation.
      const { data: accountMembers, error: membersError } = await supabase
        .from('member_linkedin_accounts')
        .select('user_id, organization_id')
        .eq('linkedin_account_id', account_id);
      if (membersError) console.warn('[unipile-webhook] sibling stop alert: linked members lookup failed:', membersError);
      const members = (accountMembers ?? []) as Array<{ user_id: string; organization_id: string | null }>;
      if (accountInMailsFailed) for (const m of members) if (m.organization_id) stopFailedOrgs.add(m.organization_id);
      const alerts = [];
      for (const orgId of stopFailedOrgs) {
        const orgRows = anchorRows.filter((e) => e.organization_id === orgId);
        let candidateId = (inmailMatches ?? []).find((m) => m.organization_id === orgId)?.recipient_profile_id;
        // Un InMail seulement programmé peut porter un identifiant Recruiter
        // différent de l'expéditeur. Résoudre sa fiche pour l'alerte seulement :
        // il ne doit pas devenir une preuve de contact envoyé dans les ancres.
        if (orgRows.length === 0 && !candidateId && resolvedAltIds.length > 0) {
          try {
            const { data: pendingInMails, error: pendingError } = await supabase
              .from('inmail_queue')
              .select('recipient_profile_id')
              .eq('organization_id', orgId)
              .eq('account_id', account_id)
              .in('status', ['pending', 'scheduled'])
              .in('recipient_profile_id', [senderId, ...resolvedAltIds])
              .limit(1);
            if (pendingError) console.warn('[unipile-webhook] sibling stop alert: candidate lookup failed:', pendingError);
            else candidateId = pendingInMails?.[0]?.recipient_profile_id;
          } catch (e) {
            console.warn('[unipile-webhook] sibling stop alert: candidate lookup failed:', e);
          }
        }
        alerts.push({
          organizationId: orgId,
          userIds: [...members.filter((m) => m.organization_id === orgId).map((m) => m.user_id), ...orgRows.map((e) => e.created_by)],
          candidateName: orgRows[0]?.profile_name || message.sender?.name || null,
          sequenceId: orgRows[0]?.sequence_id ?? null,
          enrollmentIds: orgRows.map((e) => e.id),
          // Sans séquence : l'identifiant de l'InMail au /pipeline, sinon l'expéditeur.
          candidateId: candidateId ?? senderId ?? null,
        });
      }
      await alertSiblingStopFailure(supabase, eventKey, alerts);
    }
    throw failures[0];
  }

  // ── Create notification for new message ──
  // Find the user(s) linked to this LinkedIn account
  const senderName = message.sender?.name
    || senderId || 'Quelqu\'un';
  // Membres reliés au compte : lus plus haut (étape du candidat).

  // Candidat déjà sorti de la séquence (a déjà répondu, séquence terminée) :
  // aucune inscription ouverte, mais c'est bien un candidat. Lecture seule,
  // pour la notification uniquement : aucun statut n'est modifié. Les
  // inscriptions en pause ne sont plus ici : elles sont closes plus haut.
  let notifEnrollments: SequenceEnrollment[] = enrollments;
  if (notifEnrollments.length === 0 && linkedMembers && linkedMembers.length > 0) {
    const past = await findEnrollmentsBySenderAccount<SequenceEnrollment>(
      (column) => supabase
        .from('sequence_enrollments')
        .select('*')
        .eq(column, account_id)
        .in('status', ['replied', 'completed'])
        .or(`profile_id.eq.${safeSenderId},resolved_profile_id.eq.${safeSenderId}`)
        .order('updated_at', { ascending: false })
        .limit(5),
    );
    if (past.error) console.warn('[unipile-webhook] Past enrollments lookup failed:', past.error);
    notifEnrollments = past.rows ?? [];
    // Même repli que la recherche active : identifiant présent seulement dans profile_url.
    if (notifEnrollments.length === 0 && !past.error) {
      const pastByUrl = await findEnrollmentsBySenderAccount<SequenceEnrollment>(
        (column) => supabase
          .from('sequence_enrollments')
          .select('*')
          .eq(column, account_id)
          .in('status', ['replied', 'completed'])
          .like('profile_url', `%${safeSenderId}%`)
          .order('updated_at', { ascending: false })
          .limit(5),
      );
      if (pastByUrl.error) console.warn('[unipile-webhook] Past enrollments lookup (url) failed:', pastByUrl.error);
      notifEnrollments = pastByUrl.rows ?? [];
    }
  }

  // Mission des séquences concernées : outreach_sequences.project_id (clé
  // étrangère vers sourcing_projects), nul pour une séquence globale.
  // enrollment.job_id n'est pas utilisé : il vaut tantôt sourcing_projects.id,
  // tantôt sourcing_projects.job_id.
  const projectBySequence = new Map<string, string>();
  if (linkedMembers && linkedMembers.length > 0 && notifEnrollments.length > 0) {
    const sequenceIds = [...new Set(notifEnrollments.map(e => e.sequence_id).filter(Boolean))];
    const { data: sequences, error: sequencesError } = await supabase
      .from('outreach_sequences')
      .select('id, project_id')
      .in('id', sequenceIds);
    if (sequencesError) console.warn('[unipile-webhook] Could not load sequence missions:', sequencesError);
    for (const s of (sequences ?? []) as Array<{ id: string; project_id: string | null }>) {
      if (s.project_id) projectBySequence.set(s.id, s.project_id);
    }
  }

  // Rejeu après une écriture de l'étape en échec transitoire (levée plus bas,
  // après les notifications) : la notification du premier passage n'est pas
  // doublée. Lecture impossible : notification envoyée (doublon plutôt qu'oubli).
  const alreadyNotified = new Set<string>();
  if (linkedMembers.length > 0) {
    const { data: notified, error: notifiedError } = await supabase
      .from('notifications')
      .select('user_id, organization_id')
      .eq('type', 'new_message')
      .eq('metadata->>event_key', eventKey)
      .in('user_id', [...new Set(linkedMembers.map((m) => m.user_id))]);
    if (notifiedError) console.warn('[unipile-webhook] Replayed notification lookup failed:', notifiedError);
    for (const n of (notified ?? []) as Array<{ user_id: string; organization_id: string | null }>) {
      alreadyNotified.add(`${n.user_id}:${n.organization_id}`);
    }
  }

  if (linkedMembers && linkedMembers.length > 0) {
    for (const member of linkedMembers) {
      if (alreadyNotified.has(`${member.user_id}:${member.organization_id}`)) continue;
      // Inscriptions de l'org du destinataire uniquement (même compte LinkedIn
      // rattaché à plusieurs orgs), comme pour job_candidate_status plus haut.
      const memberEnrollments = notifEnrollments.filter(e => !e.organization_id || e.organization_id === member.organization_id);
      const primary = memberEnrollments[0];
      const candidateName = primary?.profile_name || senderName;
      // Mission de la séquence, sinon celle résolue pour l'étape (décision 17).
      const projectId = (primary ? projectBySequence.get(primary.sequence_id) : undefined)
        ?? (member.organization_id ? missionByOrg.get(member.organization_id) : undefined);
      const metadata: Record<string, unknown> = {
        ...(chatId ? { chat_id: chatId } : {}),
        is_candidate: !!primary,
        ...(primary ? {
          enrollment_id: primary.id,
          enrollment_ids: memberEnrollments.map(e => e.id),
          sequence_id: primary.sequence_id,
          profile_name: primary.profile_name ?? null,
          profile_headline: primary.profile_headline ?? null,
        } : {}),
        ...(projectId ? { project_id: projectId } : {}),
        event_key: eventKey,
      };
      await supabase
        .from('notifications')
        .insert({
          user_id: member.user_id,
          organization_id: member.organization_id,
          type: 'new_message',
          title: `Nouveau message de ${candidateName}`,
          body: chatId ? `Vous avez reçu un nouveau message LinkedIn` : null,
          // /outreach est une route legacy (redirigée vers /sequences depuis le lot 5h, query perdue).
          link: chatId ? `/inbox?chatId=${encodeURIComponent(chatId)}` : '/inbox',
          metadata,
        });
    }
    console.log(`[unipile-webhook] Created notifications for ${linkedMembers.length} user(s)`);
  } else {
    // Fallback: notify all org members who have access
    // Find org via any member_linkedin_accounts with this account
    const { data: anyMapping } = await supabase
      .from('member_linkedin_accounts')
      .select('organization_id')
      .eq('linkedin_account_id', account_id)
      .limit(1);
    
    if (!anyMapping || anyMapping.length === 0) {
      // Last resort: find org members from organization_members and notify admins/owners
      console.log('[unipile-webhook] No member mapping found for account:', account_id);
    }
  }

  // Analyse et indexation : une fois par événement, au premier passage qui
  // atteint les notifications, même si l'étape du candidat doit être rejouée
  // (un échec persistant de l'étape ne les perd pas). Au rejeu, la
  // notification existe déjà : pas de seconde analyse facturée. Sans membre
  // relié (rien pour repérer le rejeu) : au passage réussi seulement.
  const firstPass = linkedMembers.length > 0 ? alreadyNotified.size === 0 : stageFailures.length === 0;
  if (firstPass) {
    // ── Trigger auto-analysis for intent detection & status update ──
    if (chatId) {
      console.log(`[unipile-webhook] Triggering auto-analyze for chat: ${chatId}`);
      const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
      // Clé service-role (auto-analyze-message rejette la clé anon en 401) +
      // organization_id du compte (linkedMembers chargé ci-dessus) pour les créds
      // par org et l'imputation des crédits.
      const serviceKey = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'))!;
      const autoAnalyzeOrgId = linkedMembers?.[0]?.organization_id ?? null;
    
      // Fire-and-forget: don't await to keep webhook fast. Timeout 55 s :
      // auto-analyze attend désormais analyze-response (jusqu'à ~50 s).
      fetchWithTimeout(`${supabaseUrl}/functions/v1/auto-analyze-message`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${serviceKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          chat_id: chatId,
          account_id: account_id,
          sender_id: senderId,
          organization_id: autoAnalyzeOrgId,
          // Étape écrite dans chaque organisation admise : pas de rattrapage.
          stage_recorded: stageFailures.length === 0,
        }),
      }, 55000).then(res => {
        console.log(`[unipile-webhook] Auto-analyze triggered: ${res.status}`);
      }).catch(err => {
        console.error('[unipile-webhook] Auto-analyze trigger failed:', err);
      });
    }

    // ── Fire-and-forget RAG ingestion (conversation message) ──
    if (senderId && chatId) {
      const supabaseUrl = Deno.env.get('SUPABASE_URL');
      const serviceKey = (Deno.env.get('SB_SECRET_KEY') ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'));
      const orgId = linkedMembers?.[0]?.organization_id;
      if (supabaseUrl && serviceKey && orgId) {
        const senderName = message.sender?.name
          || senderId;
        await fetchWithTimeout(`${supabaseUrl}/functions/v1/ingest-context`, {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${serviceKey}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            organization_id: orgId,
            entity_type: 'candidate',
            entity_id: senderId,
            chunks: [{
              chunk_type: 'conversation',
              content: `Message reçu de ${senderName} (chat ${chatId})`,
              source_table: 'unipile_conversations',
              metadata: { chat_id: chatId, account_id: account_id, date: new Date().toISOString() },
            }],
          }),
        }).catch(err => console.warn('[unipile-webhook] RAG ingest failed (non-blocking):', err));
      }
    }
  }

  // Étape du candidat en échec transitoire (décision 9) : rejeu (500), après
  // les notifications, l'analyse et l'indexation.
  if (stageFailures.length > 0) {
    console.error(`[unipile-webhook] new_message: ${stageFailures.length} reply stage write(s) failed, event will be retried:`, stageFailures[0]);
    throw stageFailures[0];
  }
}

/** Valeur d'un en-tête du message (tableau {name, value} ou objet), si la charge utile les expose. */
function readMailHeader(payload: WebhookPayload, name: string): string | null {
  const headers = payload.headers;
  const wanted = name.toLowerCase();
  if (Array.isArray(headers)) {
    for (const header of headers) {
      if (header && typeof header.name === 'string' && header.name.toLowerCase() === wanted) {
        return header.value === undefined || header.value === null ? '' : String(header.value);
      }
    }
    return null;
  }
  if (headers && typeof headers === 'object') {
    for (const [key, value] of Object.entries(headers)) {
      if (key.toLowerCase() !== wanted) continue;
      if (Array.isArray(value)) return value.length > 0 ? String(value[0]) : '';
      return value === undefined || value === null ? '' : String(value);
    }
  }
  return null;
}

// Réponses automatiques (absence, répondeur) : ni une réponse du candidat, ni
// un rebond. SEQ-113 : le préfixe standard d'Outlook en anglais, « Automatic
// reply: », et ses équivalents allemand, espagnol, italien n'étaient pas
// reconnus : la séquence s'arrêtait et le candidat passait « Répondu ».
const AUTO_REPLY_SUBJECT_MARKERS = [
  'auto-reply', 'autoreply', 'auto reply', 'automatic reply', 'out of office',
  'absence du bureau', 'absent du bureau', 'réponse automatique',
  'automatische antwort', 'respuesta automática', 'risposta automatica',
];
const AUTOMATED_SENDER_PREFIXES = ['no-reply@', 'noreply@', 'do-not-reply@', 'donotreply@', 'mailer@'];

function isAutoReplyMail(payload: WebhookPayload, subjectLower: string, senderEmail: string): boolean {
  if (AUTO_REPLY_SUBJECT_MARKERS.some((marker) => subjectLower.includes(marker))) return true;
  if (AUTOMATED_SENDER_PREFIXES.some((prefix) => senderEmail.startsWith(prefix))) return true;
  // En-têtes normalisés (RFC 3834) quand la charge utile les fournit.
  const autoSubmitted = readMailHeader(payload, 'auto-submitted');
  if (autoSubmitted !== null && autoSubmitted.trim().toLowerCase() !== 'no') return true;
  if (readMailHeader(payload, 'x-autoreply') !== null) return true;
  if (readMailHeader(payload, 'x-autorespond') !== null) return true;
  return false;
}

/** Organisation(s) de la boîte mail qui reçoit (member_email_accounts). Lève en cas d'erreur de lecture. */
async function resolveMailboxOrganizations(supabase: SupabaseClient, accountId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('member_email_accounts')
    .select('organization_id')
    .eq('email_account_id', accountId);
  if (error) throw error;
  return [...new Set(((data ?? []) as Array<{ organization_id: string | null }>)
    .map((row) => row.organization_id)
    .filter((org): org is string => !!org))];
}

/**
 * Adresse(s) de la boîte qui reçoit (member_email_accounts), en minuscules, seulement celles
 * qui ressemblent à une adresse (une liaison créée avec un nom d'affichage n'en porte pas).
 * Lève en cas d'erreur de lecture.
 */
async function resolveMailboxAddresses(supabase: SupabaseClient, accountId: string): Promise<string[]> {
  const { data, error } = await supabase
    .from('member_email_accounts')
    .select('email_address')
    .eq('email_account_id', accountId);
  if (error) throw error;
  return [...new Set(((data ?? []) as Array<{ email_address: string | null }>)
    .map((row) => normalizeEmail(row.email_address))
    .filter((address): address is string => !!address))];
}

interface MailEnrollment {
  id: string;
  sequence_id: string;
  profile_id: string | null;
  provider_id: string | null;
  resolved_profile_id: string | null;
  account_id: string;
  email_used: string | null;
  organization_id: string | null;
  created_by: string | null;
  profile_name: string | null;
  profile_headline: string | null;
  profile_url: string | null;
  job_id: string | null;
  status: string;
}
const MAIL_ENROLLMENT_COLUMNS =
  'id, sequence_id, profile_id, provider_id, resolved_profile_id, account_id, email_used, organization_id, created_by, profile_name, profile_headline, profile_url, job_id, status';

/** Échappe les jokers SQL d'une adresse pour un ilike exact. */
const escapeLike = (value: string) => value.replace(/([%_\\])/g, '\\$1');

/**
 * Inscriptions ouvertes portant cette adresse. Portée : l'organisation de la
 * boîte qui reçoit (SEQ-039 : comparer au compte d'inscription, un compte
 * LinkedIn, ne rattachait jamais rien) ; repli sur le compte quand la boîte
 * n'est pas connue.
 */
async function findOpenEnrollmentsByEmail(
  supabase: SupabaseClient,
  accountId: string,
  mailboxOrgs: string[],
  email: string,
  statuses: string[] = OPEN_ENROLLMENT_STATUSES,
): Promise<MailEnrollment[]> {
  if (mailboxOrgs.length > 0) {
    const { data, error } = await supabase
      .from('sequence_enrollments')
      .select(MAIL_ENROLLMENT_COLUMNS)
      .in('organization_id', mailboxOrgs)
      .in('status', statuses)
      .ilike('email_used', escapeLike(email));
    if (error) throw error;
    return (data ?? []) as MailEnrollment[];
  }
  const { rows, error } = await findEnrollmentsBySenderAccount<MailEnrollment>(
    (column) => supabase
      .from('sequence_enrollments')
      .select(MAIL_ENROLLMENT_COLUMNS)
      .eq(column, accountId)
      .in('status', statuses)
      .ilike('email_used', escapeLike(email)),
  );
  if (error) throw error;
  return rows;
}

/**
 * Handler pour les emails reçus (événement email.new, handler `mail_received`).
 * Détecte si l'email entrant est une réponse à une étape de séquence email
 * et stoppe les étapes restantes de la séquence pour ce candidat.
 *
 * Stratégie de matching :
 *   1. Le message auquel il répond (in_reply_to) est retrouvé dans
 *      sequence_email_tracking : exécution, puis inscription. Indépendant du
 *      compte et de l'adresse (alias, réponse depuis une autre adresse).
 *   2. Sinon, l'adresse de l'expéditeur (from_attendee.identifier) est
 *      comparée à email_used, dans l'organisation de la boîte qui reçoit.
 *   3. Inscriptions actives OU en pause : clôture 'replied', étapes en
 *      attente annulées, réponse comptée une fois, étape « A répondu »
 *      dans la mission de l'inscription,
 *      recruteur prévenu, inscriptions du même candidat sur les autres
 *      comptes de l'organisation arrêtées.
 *
 * Une lecture ou une écriture en échec lève : le catch global purge la
 * dédup et répond 500, le prestataire rejoue (SEQ-040).
 */
async function handleNewMail(supabase: SupabaseClient, payload: WebhookPayload, eventKey: string) {
  const { account_id, from_attendee, to_attendees, subject, email_id } = payload;

  if (!account_id) {
    console.log('[unipile-webhook][mail] Missing account_id, skipping');
    return;
  }

  // Email de l'expéditeur (= candidat qui répond)
  // from_attendee est un objet { display_name, identifier } (flattenEnvelope le
  // construit depuis from[0] de l'e-mail v2) où identifier contient l'adresse email.
  const senderEmail = (from_attendee?.identifier || '').toLowerCase().trim();
  if (!senderEmail) {
    console.log('[unipile-webhook][mail] No sender email, skipping');
    return;
  }

  const subjectLower = (subject || '').toLowerCase();

  // Boîte reliée à aucune organisation de Konekt : il n'y a personne pour qui agir, et le
  // rattachement par in_reply_to (indépendant du compte) clorait des inscriptions d'une autre
  // organisation. Acquitté, jamais rejoué.
  const mailboxOrgs = await resolveMailboxOrganizations(supabase, account_id);
  if (mailboxOrgs.length === 0) {
    console.log('[unipile-webhook][mail] Skipping - mailbox linked to no organisation');
    return;
  }

  // Courrier écrit depuis la boîte elle-même : email.new n'indique pas de sens
  // (envoyé ou reçu), et un courrier envoyé qui répond à un message suivi serait
  // pris pour la réponse du candidat. Jamais une réponse. Liaison sans adresse lisible
  // (nom d'affichage) : l'adresse du compte, relue chez le prestataire, la remplace.
  let mailboxAddresses = await resolveMailboxAddresses(supabase, account_id);
  if (mailboxAddresses.length === 0) {
    try {
      const own = normalizeEmail((await getAccount(account_id)).name);
      if (own) mailboxAddresses = [own];
    } catch (e) {
      console.warn('[unipile-webhook][mail] Mailbox address could not be read:', describeForLog(e));
    }
  }
  if (mailboxAddresses.includes(senderEmail)) {
    console.log('[unipile-webhook][mail] Skipping - mail sent from the mailbox itself');
    return;
  }

  // === HARD BOUNCE ===
  // Un NDR (mailer-daemon/postmaster, ou sujet type "Undelivered"/"Delivery
  // Status Notification") signale une adresse morte : l'inscription est
  // arrêtée et l'adresse supprimée des envois (handleBounce).
  const isBounce =
    senderEmail.startsWith('mailer-daemon@') ||
    senderEmail.startsWith('postmaster@') ||
    /undeliverable|delivery status notification|delivery has failed|mail delivery (failed|subsystem)|returned mail|failure notice|delivery failure|delivery incomplete/i.test(subjectLower);

  if (isBounce) {
    await handleBounce(supabase, account_id, payload, senderEmail);
    return;
  }

  // Skip auto-replies (out-of-office, etc.) — ni réponse ni bounce.
  if (isAutoReplyMail(payload, subjectLower, senderEmail)) {
    console.log('[unipile-webhook][mail] Skipping auto-reply from', senderEmail);
    return;
  }

  // Un courrier envoyé depuis la boîte elle-même est écarté plus haut (adresse de
  // la boîte). Ici : au moins un destinataire est exigé.
  const recipientEmails = (to_attendees || [])
    .map(a => (a.identifier || '').toLowerCase().trim())
    .filter(Boolean);
  if (recipientEmails.length === 0) {
    console.log('[unipile-webhook][mail] No recipients, skipping');
    return;
  }

  console.log(
    `[unipile-webhook][mail] from=${senderEmail} to=${recipientEmails.join(',')} ` +
    `account=${account_id} email_id=${email_id || '?'} subject="${subjectLower.slice(0, 80)}"`,
  );

  // 1. Rattachement par le message d'origine (in_reply_to), normalisé par la
  //    règle partagée avec sequence-webhooks-handler (chaîne ou objet
  //    { message_id, id }, avec et sans chevrons). email_message_id contient
  //    l'identifiant renvoyé à l'envoi, ou le marqueur konekt-sent:<tracking_id>
  //    qui ne correspond à aucune réponse : le repli par adresse (2.) reste
  //    nécessaire.
  let enrollments: MailEnrollment[] = [];
  const repliedToIds = inReplyToCandidates(payload.in_reply_to);
  if (repliedToIds.length > 0) {
    const { data: tracked, error: trackedError } = await supabase
      .from('sequence_email_tracking')
      .select('execution_id')
      .in('email_message_id', repliedToIds);
    if (trackedError) throw trackedError;
    const executionIds = [...new Set(((tracked ?? []) as Array<{ execution_id: string | null }>)
      .map((t) => t.execution_id)
      .filter((id): id is string => !!id))];
    if (executionIds.length > 0) {
      const { data: executions, error: executionsError } = await supabase
        .from('sequence_step_executions')
        .select('enrollment_id')
        .in('id', executionIds);
      if (executionsError) throw executionsError;
      const enrollmentIds = [...new Set(((executions ?? []) as Array<{ enrollment_id: string | null }>)
        .map((e) => e.enrollment_id)
        .filter((id): id is string => !!id))];
      if (enrollmentIds.length > 0) {
        let byThread = supabase
          .from('sequence_enrollments')
          .select(MAIL_ENROLLMENT_COLUMNS)
          .in('id', enrollmentIds)
          .in('status', OPEN_ENROLLMENT_STATUSES);
        // Une boîte ne clôt que des inscriptions de son organisation.
        byThread = byThread.in('organization_id', mailboxOrgs);
        const { data: threadRows, error: threadError } = await byThread;
        if (threadError) throw threadError;
        enrollments = (threadRows ?? []) as MailEnrollment[];
        if (enrollments.length > 0) console.log('[unipile-webhook][mail] Matched via in_reply_to');
      }
    }
  }

  // 2. Repli : adresse de l'expéditeur, dans l'organisation de la boîte.
  if (enrollments.length === 0) {
    enrollments = await findOpenEnrollmentsByEmail(supabase, account_id, mailboxOrgs, senderEmail);
  }

  if (enrollments.length === 0) {
    console.log('[unipile-webhook][mail] No open enrollment matched for', senderEmail);
    return;
  }

  console.log(`[unipile-webhook][mail] Matched ${enrollments.length} enrollment(s)`);

  // 3. Clôture 'replied' (active ou en pause) + étapes en attente annulées.
  const failures: unknown[] = [];
  const closed: MailEnrollment[] = [];
  // Mission où l'étape du candidat a été écrite, pour la notification (décision 17).
  const missionByEnrollment = new Map<string, string>();
  for (const enrollment of enrollments) {
    const nowIso = new Date().toISOString();
    const { data: changed, error: updErr } = await supabase
      .from('sequence_enrollments')
      .update({
        status: 'replied',
        replied_at: nowIso,
        updated_at: nowIso,
        pause_reason: null,
      })
      .eq('id', enrollment.id)
      .in('status', OPEN_ENROLLMENT_STATUSES)
      .select('id');

    if (updErr) {
      failures.push(updErr);
      continue;
    }

    // Tous les statuts pendants, y compris quand l'inscription était déjà
    // close entre-temps (elle est alors terminale). Un échec est remonté
    // (500, rejeu) sans sauter le compte ni le pipeline de la clôture
    // effective, comme sur le canal LinkedIn.
    const { error: cancelError } = await supabase
      .from('sequence_step_executions')
      .update({
        status: 'cancelled',
        skip_reason: 'Email reply detected via webhook',
        updated_at: nowIso,
      })
      .eq('enrollment_id', enrollment.id)
      .in('status', PENDING_EXECUTION_STATUSES);
    if (cancelError) failures.push(cancelError);

    // Réponse comptée une seule fois (SEQ-191) : seulement si CE traitement a clos l'inscription.
    if (!changed || changed.length === 0) continue;
    closed.push(enrollment);

    // Incrément atomique (cf. increment_sequence_analytics)
    await supabase.rpc('increment_sequence_analytics', {
      p_sequence_id: enrollment.sequence_id,
      p_field: 'replies_received',
    });

    // Étape du candidat (plan 0b, décision 4) : réponse vue par l'inscription,
    // sans conversation, donc la mission de l'inscription d'abord ; une ligne
    // À trier ou Retenu ne passe « A répondu » que si un envoi Konekt y est
    // prouvé (décision 13). Le rejeu ne retrouve plus l'inscription close et
    // ne referait pas l'écriture : une erreur transitoire est retentée une
    // fois ici, puis journalisée sans 500 (résiduel, plan 0b section 11).
    // Refus métier ou fonction absente : journal seul.
    if (!enrollment.organization_id) {
      console.warn('[unipile-webhook][mail] Reply stage not recorded: enrollment without organization');
    } else {
      const recordMailReply = () => recordInbound(supabase, {
        organizationId: enrollment.organization_id as string,
        accountId: null,
        candidate: candidateRef({
          ids: [enrollment.profile_id, enrollment.provider_id, enrollment.resolved_profile_id],
          profileUrl: enrollment.profile_url,
        }),
        chatId: null,
        enrollmentIds: [enrollment.id],
        enrollmentFirst: true,
      });
      let inbound = await recordMailReply();
      if (!inbound.ok && inbound.kind === 'transient') inbound = await recordMailReply();
      if (inbound.ok) {
        if (inbound.data.project_id) missionByEnrollment.set(enrollment.id, inbound.data.project_id);
      } else {
        console.error('[unipile-webhook][mail] Reply stage not recorded:', inbound.fn, inbound.kind, inbound.error);
      }
    }

    console.log('[unipile-webhook][mail] Enrollment', enrollment.id, 'marked replied (email)');
  }

  // 4. Même candidat ailleurs dans l'organisation (SEQ-212) : autres
  //    inscriptions arrêtées, InMails pas encore partis annulés.
  const handledIds = new Set(enrollments.map((e) => e.id));
  const orgIds = [...new Set(enrollments.map((e) => e.organization_id).filter((o): o is string => !!o))];
  const stopFailedOrgs = new Set<string>();
  for (const orgId of orgIds) {
    const orgRows = enrollments.filter((e) => e.organization_id === orgId);
    const candidate = {
      ids: orgRows.flatMap((e) => [e.profile_id, e.provider_id, e.resolved_profile_id]),
      slugs: orgRows.map((e) => e.profile_url),
    };
    try {
      await closeSiblingEnrollments(supabase, orgId, candidate, handledIds);
    } catch (siblingError) {
      failures.push(siblingError);
      stopFailedOrgs.add(orgId);
    }
    try {
      await cancelScheduledInMails(supabase, { organizationId: orgId }, candidate.ids);
    } catch (inmailError) {
      failures.push(inmailError);
      stopFailedOrgs.add(orgId);
    }
  }
  // Décision 10 : arrêt en échec, le recruteur de l'inscription est prévenu (le 500 reste).
  if (stopFailedOrgs.size > 0) {
    await alertSiblingStopFailure(supabase, eventKey, [...stopFailedOrgs].map((orgId) => {
      const orgRows = enrollments.filter((e) => e.organization_id === orgId);
      return {
        organizationId: orgId,
        userIds: orgRows.map((e) => e.created_by),
        candidateName: orgRows[0]?.profile_name || from_attendee?.display_name || senderEmail,
        sequenceId: orgRows[0]?.sequence_id ?? null,
        enrollmentIds: orgRows.map((e) => e.id),
      };
    }));
  }

  // 5. Le recruteur est prévenu (SEQ-115). Lien vers la séquence de la
  //    mission, pas vers la messagerie LinkedIn (aucune conversation).
  //    Non bloquant.
  if (closed.length > 0) {
    try {
      const projectBySequence = await loadSequenceProjects(supabase, closed.map((e) => e.sequence_id));
      const byOwner = new Map<string, MailEnrollment[]>();
      for (const e of closed) {
        if (!e.created_by || !e.organization_id) continue;
        const key = `${e.created_by}:${e.organization_id}`;
        byOwner.set(key, [...(byOwner.get(key) ?? []), e]);
      }
      const notifications = [...byOwner.values()].map((rows) => {
        const primary = rows[0];
        const projectId = projectBySequence.get(primary.sequence_id) ?? missionByEnrollment.get(primary.id);
        const candidateName = primary.profile_name || from_attendee?.display_name || senderEmail;
        return {
          user_id: primary.created_by,
          organization_id: primary.organization_id,
          type: 'new_message',
          title: `Nouveau message de ${candidateName}`,
          body: 'Réponse reçue par e-mail : la séquence est arrêtée pour ce candidat, aucune relance ne partira.',
          // Lot 5h : sans mission, la page de la séquence au lieu de /missions.
          link: projectId ? `/missions/${projectId}?tab=outreach` : `/sequences/${primary.sequence_id}`,
          metadata: {
            is_candidate: true,
            channel: 'email',
            enrollment_id: primary.id,
            enrollment_ids: rows.map((r) => r.id),
            sequence_id: primary.sequence_id,
            profile_name: primary.profile_name ?? null,
            profile_headline: primary.profile_headline ?? null,
            ...(projectId ? { project_id: projectId } : {}),
            ...(email_id ? { email_id } : {}),
          },
        };
      });
      if (notifications.length > 0) {
        const { error: notifError } = await supabase.from('notifications').insert(notifications);
        if (notifError) console.warn('[unipile-webhook][mail] reply notifications failed:', notifError);
      }
    } catch (notifErr) {
      console.warn('[unipile-webhook][mail] reply notifications failed:', notifErr);
    }
  }

  if (failures.length > 0) {
    console.error(`[unipile-webhook][mail] ${failures.length} write(s) failed:`, failures[0]);
    throw failures[0];
  }
}

/**
 * Marque 'bounced' la dernière exécution e-mail envoyée de l'inscription
 * (SEQ-107 : aucun écrivain n'enregistrait ce statut). Non bloquant.
 */
async function markLastEmailExecutionBounced(supabase: SupabaseClient, enrollmentId: string): Promise<void> {
  try {
    const { data: executions, error } = await supabase
      .from('sequence_step_executions')
      .select('id, step_id, channel, executed_at')
      .eq('enrollment_id', enrollmentId)
      .in('status', ['sent', 'opened', 'clicked'])
      .order('executed_at', { ascending: false, nullsFirst: false })
      .limit(20);
    if (error) {
      console.warn('[unipile-webhook][bounce] executions lookup failed:', error);
      return;
    }
    const rows = (executions ?? []) as Array<{ id: string; step_id: string | null; channel: string | null }>;
    if (rows.length === 0) return;
    const stepIds = [...new Set(rows.map((r) => r.step_id).filter((id): id is string => !!id))];
    const emailSteps = new Set<string>();
    if (stepIds.length > 0) {
      const { data: steps, error: stepsError } = await supabase
        .from('sequence_steps')
        .select('id, action_type, step_channel')
        .in('id', stepIds);
      if (stepsError) {
        console.warn('[unipile-webhook][bounce] steps lookup failed:', stepsError);
        return;
      }
      for (const step of (steps ?? []) as Array<{ id: string; action_type: string | null; step_channel: string | null }>) {
        if (step.action_type === 'email' || step.step_channel === 'email') emailSteps.add(step.id);
      }
    }
    const lastEmail = rows.find((r) => r.channel === 'email' || (r.step_id && emailSteps.has(r.step_id)));
    if (!lastEmail) return;
    const { error: updateError } = await supabase
      .from('sequence_step_executions')
      .update({ status: 'bounced', updated_at: new Date().toISOString() })
      .eq('id', lastEmail.id)
      .in('status', ['sent', 'opened', 'clicked']);
    if (updateError) console.warn('[unipile-webhook][bounce] execution not marked bounced:', updateError);
  } catch (e) {
    console.warn('[unipile-webhook][bounce] execution not marked bounced:', e);
  }
}

/**
 * Traite un NDR (bounce email). L'adresse qui a bouncé n'est PAS l'expéditeur
 * (mailer-daemon), elle est dans le corps du NDR. On l'en extrait, puis — pour
 * chaque adresse qu'on a RÉELLEMENT séquencée (garde-fou anti faux-positif sur
 * un parsing bruité), dans l'organisation de la boîte qui reçoit — on l'ajoute
 * à suppressed_emails, on passe les inscriptions actives/en pause en
 * 'bounced', on marque la dernière exécution e-mail 'bounced', on annule
 * leurs étapes encore en attente et on prévient le recruteur.
 */
async function handleBounce(supabase: SupabaseClient, accountId: string, payload: WebhookPayload, senderEmail: string) {
  const bodyText = `${payload.subject || ''}\n${payload.body_plain || payload.body || ''}`;
  const ourAddresses = new Set(
    (payload.to_attendees || []).map(a => (a.identifier || '').toLowerCase().trim()).filter(Boolean),
  );
  const emailRegex = /[a-z0-9._%+\-]+@[a-z0-9.\-]+\.[a-z]{2,}/gi;
  const found = [...new Set((bodyText.match(emailRegex) || []).map(e => e.toLowerCase().trim()))];
  const candidates = found.filter(e =>
    !ourAddresses.has(e) &&
    e !== senderEmail &&
    !e.startsWith('mailer-daemon@') &&
    !e.startsWith('postmaster@') &&
    !e.startsWith('noreply@') &&
    !e.startsWith('no-reply@'),
  );

  if (candidates.length === 0) {
    console.log('[unipile-webhook][bounce] No candidate address extracted from NDR — skipping', { account: accountId });
    return;
  }

  const mailboxOrgs = await resolveMailboxOrganizations(supabase, accountId);
  const failures: unknown[] = [];
  const bouncedEnrollments: Array<MailEnrollment & { address: string }> = [];

  for (const addr of candidates) {
    // On ne suppress QUE les adresses qu'on a réellement séquencées — sinon
    // un NDR bruité pourrait blacklister une adresse au hasard.
    let enrs: MailEnrollment[];
    try {
      enrs = await findOpenEnrollmentsByEmail(
        supabase,
        accountId,
        mailboxOrgs,
        addr,
        ['active', 'paused', 'completed', 'replied', 'bounced', 'stopped', 'cancelled'],
      );
    } catch (enrErr) {
      failures.push(enrErr);
      continue;
    }
    if (enrs.length === 0) continue;

    // Hard bounce → ne plus jamais emailer cette adresse.
    const { error: supErr } = await supabase
      .from('suppressed_emails')
      .upsert({ email: addr, reason: 'bounce' }, { onConflict: 'email' });
    if (supErr) failures.push(supErr);

    for (const enr of enrs) {
      const nowIso = new Date().toISOString();
      if (enr.status === 'active' || enr.status === 'paused') {
        const { data: changed, error: bounceError } = await supabase
          .from('sequence_enrollments')
          .update({ status: 'bounced', pause_reason: null, updated_at: nowIso })
          .eq('id', enr.id)
          .in('status', OPEN_ENROLLMENT_STATUSES)
          .select('id');
        if (bounceError) {
          failures.push(bounceError);
          continue;
        }
        if (changed && changed.length > 0) {
          bouncedEnrollments.push({ ...enr, address: addr });
          await markLastEmailExecutionBounced(supabase, enr.id);
        }
      }
      // Annuler les étapes encore en attente pour ce candidat.
      const { error: cancelError } = await supabase
        .from('sequence_step_executions')
        .update({ status: 'cancelled', skip_reason: 'Email bounced (NDR)', updated_at: nowIso })
        .eq('enrollment_id', enr.id)
        .in('status', PENDING_EXECUTION_STATUSES);
      if (cancelError) failures.push(cancelError);
    }
    console.log(`[unipile-webhook][bounce] Suppressed ${addr} + checked ${enrs.length} enrollment(s) on account ${accountId}`);
  }

  // Le recruteur est prévenu (SEQ-115). Non bloquant.
  if (bouncedEnrollments.length > 0) {
    try {
      const projectBySequence = await loadSequenceProjects(supabase, bouncedEnrollments.map((e) => e.sequence_id));
      const notifications = bouncedEnrollments
        .filter((e) => e.created_by && e.organization_id)
        .map((e) => {
          const projectId = projectBySequence.get(e.sequence_id);
          const who = e.profile_name ? `de ${e.profile_name} ` : '';
          return {
            user_id: e.created_by,
            organization_id: e.organization_id,
            type: 'action',
            title: 'Adresse e-mail invalide, séquence arrêtée',
            body: `L'adresse ${e.address} ${who}est invalide : la séquence est arrêtée et plus aucun e-mail ne lui sera envoyé.`,
            // Lot 5h : sans mission, la page de la séquence au lieu de /missions.
            link: projectId ? `/missions/${projectId}?tab=outreach` : `/sequences/${e.sequence_id}`,
            metadata: {
              source: 'email_bounce',
              enrollment_id: e.id,
              sequence_id: e.sequence_id,
              profile_name: e.profile_name ?? null,
              ...(projectId ? { project_id: projectId } : {}),
            },
          };
        });
      if (notifications.length > 0) {
        const { error: notifError } = await supabase.from('notifications').insert(notifications);
        if (notifError) console.warn('[unipile-webhook][bounce] notifications failed:', notifError);
      }
    } catch (notifErr) {
      console.warn('[unipile-webhook][bounce] notifications failed:', notifErr);
    }
  }

  if (failures.length > 0) {
    console.error(`[unipile-webhook][bounce] ${failures.length} write(s) failed:`, failures[0]);
    throw failures[0];
  }
}

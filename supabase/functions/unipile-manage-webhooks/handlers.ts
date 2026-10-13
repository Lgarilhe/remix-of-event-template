/**
 * Actions de gestion du point de terminaison de notifications (list, register,
 * delete, list_deliveries, replay_event). Séparées de index.ts pour être jouées
 * sans authentification dans les tests ; l'authentification et le rôle
 * (propriétaire ou administrateur) sont dans index.ts, la porte des
 * administrateurs de la plateforme est ici (`runAction`).
 */
import {
  createEndpoint,
  deleteEndpoint,
  describeForLog,
  isReceiverEndpoint,
  listAllEndpoints,
  listDeliveries,
  patchEndpoint,
  planEndpointSync,
  RECEIVER_FUNCTION_PATH,
  receiverEndpointUrl,
  replayEvent,
  resolveWebhookToken,
  userSafeMessage,
  V2_TRIGGER_EVENTS,
} from "../_shared/unipile/index.ts";
import {
  boundedInt,
  endpointIdOfRow,
  eventIdOf,
  isPlatformAdminId,
  legacyItems,
  summarizeDelivery,
  summarizeEndpoint,
} from "./view.ts";

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS, DELETE',
};

const ENDPOINT_DESCRIPTION = 'Konekt, notifications en temps réel (messages, relations, comptes, e-mails)';

export const respond = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });

/** Adresse du récepteur de cette installation, sans jeton. */
export function receiverBaseUrl(): string {
  return `${(Deno.env.get('SUPABASE_URL') ?? '').replace(/\/+$/, '')}${RECEIVER_FUNCTION_PATH}`;
}

/**
 * list : les points de terminaison de NOTRE récepteur (jamais le jeton de l'URL,
 * jamais le secret), plus la lecture par familles que l'écran des Paramètres
 * affiche (`webhooks.items`). L'application du service de connexion est commune à
 * tous les espaces de travail : les points de terminaison d'autres récepteurs
 * (adresse, description, comptes ciblés) ne sont jamais rendus.
 */
export async function handleList(): Promise<Response> {
  const receiverUrl = receiverBaseUrl();
  const listed = await listAllEndpoints();
  const endpoints = listed.items
    .filter((endpoint) => isReceiverEndpoint(endpoint.url, receiverUrl))
    .map((endpoint) => summarizeEndpoint(endpoint, receiverUrl));
  return respond({
    success: true,
    webhooks: { items: legacyItems(listed.items, receiverUrl) },
    endpoints,
    truncated: listed.truncated,
  });
}

/**
 * register : idempotent. Un seul point de terminaison pour le récepteur, mis à
 * jour sur place (PATCH : même identifiant, aucune coupure de livraison) avec
 * les événements voulus, le jeton courant et l'état actif ; créé s'il n'existe
 * pas ; les doublons (autre point de terminaison de la même adresse, créé à la
 * main ou par un double appel) sont supprimés après la mise à jour. Le jeton de
 * livraison ne se relit pas : la mise à jour réécrit donc toujours l'URL, ce qui
 * répare aussi un point de terminaison sans jeton ou à jeton périmé.
 */
export async function handleRegister(): Promise<Response> {
  const token = await resolveWebhookToken();
  if (!token) {
    console.error('[unipile-manage-webhooks] No delivery token configured (UNIPILE_V2_WEBHOOK_TOKEN)');
    return respond({
      success: false,
      error: "La configuration des notifications en temps réel est incomplète. Contactez le support Konekt.",
      error_code: 'not_configured',
    });
  }
  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const receiverUrl = receiverBaseUrl();
  const targetUrl = receiverEndpointUrl(supabaseUrl, token);

  const listed = await listAllEndpoints();
  const plan = planEndpointSync(listed.items, receiverUrl, V2_TRIGGER_EVENTS);
  if (plan.keepId === null && listed.truncated) {
    // Liste incomplète et notre point de terminaison introuvable : en créer un risquerait un doublon.
    return respond({
      success: false,
      error: "La liste des notifications est trop longue pour être vérifiée. Contactez le support Konekt.",
      error_code: 'list_truncated',
    });
  }

  let id: string;
  let action: 'created' | 'updated';
  if (plan.keepId !== null) {
    const updated = await patchEndpoint(plan.keepId, {
      url: targetUrl,
      triggerEvents: V2_TRIGGER_EVENTS,
      enabled: true,
      description: ENDPOINT_DESCRIPTION,
    });
    id = updated.id;
    action = 'updated';
  } else {
    const created = await createEndpoint({ url: targetUrl, triggerEvents: V2_TRIGGER_EVENTS, description: ENDPOINT_DESCRIPTION });
    id = created.id;
    action = 'created';
  }

  // Doublons supprimés APRÈS la mise à jour du point de terminaison gardé.
  let deletedDuplicates = 0;
  let failedDuplicates = 0;
  for (const duplicateId of plan.deleteIds) {
    try {
      if (await deleteEndpoint(duplicateId)) deletedDuplicates++;
      else failedDuplicates++;
    } catch (error) {
      failedDuplicates++;
      console.error('[unipile-manage-webhooks] Duplicate endpoint not deleted:', duplicateId, describeForLog(error));
    }
  }

  return respond({
    success: true,
    action,
    id,
    webhook_url: receiverUrl,
    trigger_events: [...V2_TRIGGER_EVENTS],
    deleted_duplicates: deletedDuplicates,
    ...(failedDuplicates > 0 ? { duplicates_not_deleted: failedDuplicates } : {}),
  });
}

/**
 * delete : supprime un point de terminaison de NOTRE récepteur, jamais celui d'un autre
 * (l'application du service de connexion est commune). `webhook_id` est l'identifiant du
 * point de terminaison (`we_...`) ou celui d'une ligne de l'écran (`we_...:famille`) : dans les
 * deux cas c'est le point de terminaison entier qui disparaît, avec toutes ses familles.
 */
export async function handleDelete(body: Record<string, unknown>): Promise<Response> {
  const webhookId = endpointIdOfRow(body.webhook_id);
  if (!webhookId) {
    return respond({ success: false, error: 'Identifiant de notification invalide.', error_code: 'validation' }, 400);
  }
  const listed = await listAllEndpoints();
  const target = listed.items.find((endpoint) => endpoint.id === webhookId);
  if (!target) {
    return respond({ success: false, error: userSafeMessage('not_found'), error_code: 'not_found' }, 404);
  }
  if (!isReceiverEndpoint(target.url, receiverBaseUrl())) {
    return respond({ success: false, error: userSafeMessage('forbidden'), error_code: 'forbidden' }, 403);
  }
  const deleted = await deleteEndpoint(webhookId);
  return respond({ success: deleted, ...(deleted ? {} : { error: userSafeMessage('server'), error_code: 'server' }) });
}

/** Points de terminaison de NOTRE récepteur, du plus pertinent au moins pertinent (celui que `register` garde en premier). */
async function receiverEndpointIds(): Promise<{ ids: string[]; primary: string | null }> {
  const receiverUrl = receiverBaseUrl();
  const listed = await listAllEndpoints();
  const plan = planEndpointSync(listed.items, receiverUrl, V2_TRIGGER_EVENTS);
  const ours = listed.items.filter((endpoint) => isReceiverEndpoint(endpoint.url, receiverUrl)).map((endpoint) => endpoint.id);
  return { ids: ours, primary: plan.keepId };
}

const MAX_DELIVERIES_PER_PAGE = 50;
const ALREADY_RECEIVED = 'Konekt a déjà reçu cette notification. Il n’y a rien à rejouer.';
const NOT_QUEUED = 'Aucune notification active à rejouer.';
const DEFAULT_DELIVERIES_PER_PAGE = 20;

/**
 * list_deliveries (administrateurs de la plateforme) : tentatives de livraison
 * d'un point de terminaison de NOTRE récepteur, la plus récente d'abord. Sans
 * `endpoint_id`, le point de terminaison principal du récepteur. Forme fermée
 * (`summarizeDelivery`) : ni charge d'événement, ni corps de réponse, ni adresse
 * avec jeton. Pagination `offset` + `limit` ; `next_offset` est `null` à la fin.
 */
export async function handleListDeliveries(body: Record<string, unknown>): Promise<Response> {
  const limit = boundedInt(body.limit, 1, MAX_DELIVERIES_PER_PAGE, DEFAULT_DELIVERIES_PER_PAGE);
  const offset = boundedInt(body.offset, 0, 100_000, 0);
  if (limit === null || offset === null) {
    return respond({ success: false, error: 'Pagination invalide.', error_code: 'validation' }, 400);
  }
  let requested: string | null = null;
  if (body.endpoint_id !== undefined && body.endpoint_id !== null) {
    requested = endpointIdOfRow(body.endpoint_id);
    if (!requested) return respond({ success: false, error: 'Identifiant de notification invalide.', error_code: 'validation' }, 400);
  }
  const { ids, primary } = await receiverEndpointIds();
  if (requested && !ids.includes(requested)) {
    return respond({ success: false, error: userSafeMessage('not_found'), error_code: 'not_found' }, 404);
  }
  const endpointId = requested ?? primary;
  if (!endpointId) {
    return respond({ success: true, endpoint_id: null, deliveries: [], has_more: false, next_offset: null });
  }
  const page = await listDeliveries({ endpointId, offset, limit });
  const deliveries = page.items.map((item) => summarizeDelivery(item as unknown as Record<string, unknown>));
  const hasMore = page.hasMore === true;
  return respond({
    success: true,
    endpoint_id: endpointId,
    deliveries,
    has_more: hasMore,
    next_offset: hasMore ? offset + deliveries.length : null,
  });
}

/**
 * replay_event (administrateurs de la plateforme) : met en file une nouvelle
 * livraison d'un événement déjà reçu par NOTRE récepteur, vers ce seul point de
 * terminaison (jamais vers ceux d'un autre récepteur de l'application commune).
 * L'événement doit figurer dans le journal du point de terminaison (une tentative
 * rendue avec cet `event_id`, le filtre du fournisseur n'est pas cru sur parole) et
 * aucune de ses tentatives ne doit avoir reçu de réponse 2xx (409 `already_received`) :
 * la ligne de dédoublonnage du récepteur ne vit que 30 jours, au-delà un rejeu d'un
 * événement reçu serait retraité. Un événement dont le traitement a échoué répond 500
 * et le récepteur purge sa clé : il est repris. Le rejeu garde l'identifiant d'origine ;
 * la ligne de dédoublonnage n'est jamais supprimée ici. Si le fournisseur ne met rien
 * en file pour ce point de terminaison (inactif), la réponse est un échec
 * (`replay_not_queued`), jamais un succès.
 */
export async function handleReplayEvent(body: Record<string, unknown>, userId: string): Promise<Response> {
  const eventId = eventIdOf(body.event_id);
  if (!eventId) return respond({ success: false, error: "Identifiant d'événement invalide.", error_code: 'validation' }, 400);
  let requested: string | null = null;
  if (body.endpoint_id !== undefined && body.endpoint_id !== null) {
    requested = endpointIdOfRow(body.endpoint_id);
    if (!requested) return respond({ success: false, error: 'Identifiant de notification invalide.', error_code: 'validation' }, 400);
  }
  const { ids, primary } = await receiverEndpointIds();
  if (requested && !ids.includes(requested)) {
    return respond({ success: false, error: userSafeMessage('not_found'), error_code: 'not_found' }, 404);
  }
  const endpointId = requested ?? primary;
  if (!endpointId) return respond({ success: false, error: userSafeMessage('not_found'), error_code: 'not_found' }, 404);

  // Les tentatives de CET événement dans le journal de NOTRE point de terminaison, la plus récente d'abord.
  // Le filtre `event_id` est vérifié ici : un fournisseur qui l'ignorerait ne doit pas autoriser un rejeu.
  const attempts = await listDeliveries({ endpointId, eventId, limit: MAX_DELIVERIES_PER_PAGE });
  const own = attempts.items
    .map((item) => summarizeDelivery(item as unknown as Record<string, unknown>))
    .filter((attempt) => attempt.event_id === eventId);
  if (own.length === 0) {
    return respond({ success: false, error: userSafeMessage('not_found'), error_code: 'not_found' }, 404);
  }
  // Une réponse 2xx de notre récepteur : l'événement est reçu (un échec de traitement répond 500 et purge sa
  // clé). Le rejeu serait ignoré tant que la ligne de dédoublonnage vit (30 jours), puis retraité : on le refuse.
  if (own.some((attempt) => attempt.status === 'delivered')) {
    return respond({ success: false, error: ALREADY_RECEIVED, error_code: 'already_received' }, 409);
  }
  const queued = await replayEvent(eventId, endpointId);
  // Trace du rejeu (journal du serveur seulement) : événement, personne, nombre de points de terminaison.
  console.log('[unipile-manage-webhooks] replay_event', JSON.stringify({ event_id: eventId, user_id: userId, endpoints: queued.endpointIds.length }));
  // Le rejeu ne part que vers les points de terminaison actifs : s'il n'a rien mis en file, ce n'est pas un succès.
  if (!queued.endpointIds.includes(endpointId)) {
    return respond({ success: false, error: NOT_QUEUED, error_code: 'replay_not_queued' });
  }
  return respond({ success: true, queued: true, event_id: queued.eventId, endpoint_ids: queued.endpointIds });
}

const NOT_PLATFORM_ADMIN = 'Action réservée aux administrateurs de la plateforme.';

/**
 * Mutations historiques (register, delete) : réservées aux user ids du secret
 * KONEKT_PLATFORM_ADMIN_USER_IDS quand il est défini ; sans lui, le rôle
 * owner/admin de l'organisation (déjà vérifié) suffit (comportement historique,
 * SEC-031 recommande de poser le secret).
 */
export function platformAdminDenied(userId: string, raw: string | undefined = Deno.env.get('KONEKT_PLATFORM_ADMIN_USER_IDS')): Response | null {
  const configured = (raw ?? '').split(',').some((s) => s.trim() !== '');
  if (!configured || isPlatformAdminId(userId, raw)) return null;
  return respond({ success: false, error: NOT_PLATFORM_ADMIN }, 403);
}

/**
 * Journal des livraisons et rejeu : strict, 403 pour tous quand le secret est
 * absent ou vide (échec fermé). Ces actions lisent et déclenchent des livraisons
 * de l'application entière, pas d'une organisation.
 */
export function strictPlatformAdminDenied(userId: string, raw: string | undefined = Deno.env.get('KONEKT_PLATFORM_ADMIN_USER_IDS')): Response | null {
  return isPlatformAdminId(userId, raw) ? null : respond({ success: false, error: NOT_PLATFORM_ADMIN, error_code: 'platform_admin_required' }, 403);
}

const ACTIONS = new Set(['list', 'register', 'delete', 'list_deliveries', 'replay_event']);

/**
 * Aiguillage après l'authentification et le contrôle du rôle owner/admin (index.ts) :
 * action inconnue, porte des administrateurs de la plateforme, puis le gestionnaire.
 */
export async function runAction(action: unknown, body: Record<string, unknown>, userId: string): Promise<Response> {
  if (typeof action !== 'string' || !ACTIONS.has(action)) {
    return respond({ success: false, error: 'Action inconnue.', error_code: 'unknown_action' }, 400);
  }
  // Les points de terminaison sont ceux de l'application, pas d'une organisation.
  if (action === 'register' || action === 'delete') {
    const denied = platformAdminDenied(userId);
    if (denied) return denied;
  } else if (action === 'list_deliveries' || action === 'replay_event') {
    const denied = strictPlatformAdminDenied(userId);
    if (denied) return denied;
  }
  switch (action) {
    case 'register':
      return await handleRegister();
    case 'delete':
      return await handleDelete(body);
    case 'list_deliveries':
      return await handleListDeliveries(body);
    case 'replay_event':
      return await handleReplayEvent(body, userId);
    default:
      return await handleList();
  }
}

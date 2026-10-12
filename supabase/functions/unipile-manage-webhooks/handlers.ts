/**
 * Actions de gestion du point de terminaison de notifications (list, register,
 * delete). Séparées de index.ts pour être jouées sans authentification dans les
 * tests ; l'autorisation (propriétaire ou administrateur, administrateurs de la
 * plateforme pour les mutations) est dans index.ts.
 */
import {
  createEndpoint,
  deleteEndpoint,
  describeForLog,
  isReceiverEndpoint,
  listAllEndpoints,
  patchEndpoint,
  planEndpointSync,
  RECEIVER_FUNCTION_PATH,
  receiverEndpointUrl,
  resolveWebhookToken,
  userSafeMessage,
  V2_TRIGGER_EVENTS,
} from "../_shared/unipile/index.ts";
import { endpointIdOfRow, legacyItems, summarizeEndpoint } from "./view.ts";

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

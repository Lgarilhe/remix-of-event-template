/**
 * Compatibilité : les helpers webhooks de l'API v2 vivent désormais dans
 * `_shared/unipile/webhooks.ts` (client partagé). Ce fichier ne garde que les
 * anciens noms exportés, avec le même comportement, pour que les importeurs
 * actuels (unipile-webhook, unipile-manage-webhooks) continuent de compiler.
 * Il est supprimé au nettoyage final ; ne pas ajouter de nouvel importeur.
 *
 * Correspondance des noms :
 *   V2_TRIGGER_EVENTS        -> V2_TRIGGER_EVENTS            (inchangé)
 *   deriveV2WebhookToken     -> deriveWebhookToken
 *   resolveV2WebhookToken    -> resolveWebhookToken
 *   flattenV2WebhookEnvelope -> flattenEnvelope
 *   resolveUnipileV2Credentials, isUnipileV2Configured, unipileV2Fetch,
 *   UNIPILE_V2_BASE_URL      -> transport historique ci-dessous (à remplacer par
 *                               le transport unique `unipile/http.ts`)
 *
 * L'aplatissement conserve le comportement d'origine pour message.new,
 * relation.new et account.add|reconnect. Il garde désormais from_attendee,
 * in_reply_to et thread_id pour email.new, et expose message.receipt.read,
 * message.reaction.new et account.initial_sync.* comme événements à part entière.
 */

import { UNIPILE_BASE_URL } from "./unipile/config.ts";

export {
  deriveWebhookToken as deriveV2WebhookToken,
  flattenEnvelope as flattenV2WebhookEnvelope,
  resolveWebhookToken as resolveV2WebhookToken,
  V2_TRIGGER_EVENTS,
} from "./unipile/webhooks.ts";

export const UNIPILE_V2_BASE_URL = UNIPILE_BASE_URL;

export interface UnipileV2Credentials {
  apiKey: string;
  baseUrl: string;
}

/** True si la clé v2 est configurée dans l'environnement des edge functions. */
export function isUnipileV2Configured(): boolean {
  return Boolean(Deno.env.get("UNIPILE_V2_API_KEY"));
}

/**
 * Résout les credentials v2 : env `UNIPILE_V2_API_KEY` uniquement (clé globale,
 * pas de clé par organisation). Null si la clé est absente.
 */
export function resolveUnipileV2Credentials(
  _organizationId?: string | null,
): UnipileV2Credentials | null {
  const apiKey = Deno.env.get("UNIPILE_V2_API_KEY");
  if (!apiKey) return null;
  return { apiKey, baseUrl: UNIPILE_V2_BASE_URL };
}

/**
 * Fetch v2 avec timeout (15s par défaut, passer 30s pour les endpoints lents
 * type recherche). `path` commence par `/` et est relatif à `/v2`
 * (ex : `/webhooks/endpoints/`).
 *
 * Transport historique, conservé le temps de la migration des importeurs :
 * les nouveaux appels passent par `unipile/http.ts` (en-têtes, nouvelles
 * tentatives bornées, issue « incertain » pour les envois).
 */
export function unipileV2Fetch(
  creds: UnipileV2Credentials,
  path: string,
  options: RequestInit = {},
  timeoutMs = 15000,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const headers = {
    "X-API-KEY": creds.apiKey,
    Accept: "application/json",
    ...(options.body && !(options.body instanceof FormData)
      ? { "Content-Type": "application/json" }
      : {}),
    ...(options.headers || {}),
  };
  return fetch(`${creds.baseUrl}${path}`, { ...options, headers, signal: controller.signal })
    .finally(() => clearTimeout(timer));
}

/**
 * Lecture des points de terminaison de notifications pour l'écran des
 * Paramètres (WebhookManager). Fonctions pures.
 *
 * L'écran attend une liste d'éléments `{ id, request_url, source }` avec les
 * sources `messaging`, `users` et `accounts` (une ligne par famille de
 * notifications), et se sert de `id` comme clé de ligne, d'état « en cours de
 * suppression » et d'argument de `delete`. Le fournisseur n'a plus qu'UN point de
 * terminaison pour tous les événements : chaque famille couverte par un point de
 * terminaison de notre récepteur donne une ligne. Une ligne a son propre `id`
 * (`we_...:famille`, l'identifiant du point de terminaison suivi de la famille ;
 * `endpoint_id` porte l'identifiant seul) : deux lignes ne partagent jamais une
 * clé. `delete` accepte cet `id` et supprime le point de terminaison entier, donc
 * toutes les familles. Les e-mails comptent avec les messages (réponses des
 * candidats) : il n'y a pas de quatrième ligne. Les URL rendues n'ont jamais leur
 * requête (elle porte le jeton de livraison).
 */

import { isReceiverEndpoint, redactWebhookUrl, V2_TRIGGER_EVENTS } from '../_shared/unipile/index.ts';

/** Famille de notifications (nom de l'écran) -> événements du fournisseur qui la couvrent. */
export const SOURCE_EVENTS: Readonly<Record<string, readonly string[]>> = {
  messaging: ['message.new', 'email.new'],
  users: ['relation.new'],
  accounts: ['account.status.running', 'account.status.disconnected', 'account.status.errored'],
};

/** Identifiant de ligne de l'écran : point de terminaison et famille. */
export const rowId = (endpointId: string, source: string): string => `${endpointId}:${source}`;

/** Identifiant de point de terminaison d'un argument de `delete` (`we_...` ou `we_...:famille`). */
export function endpointIdOfRow(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const match = /^(we_[A-Za-z0-9_-]+)(?::[a-z]+)?$/.exec(value);
  return match ? match[1] : null;
}

export interface EndpointLike {
  readonly id: string;
  readonly url: string;
  readonly enabled?: boolean;
  readonly trigger_events?: readonly string[];
  readonly description?: string | null;
  readonly account_ids?: readonly string[];
}

export interface LegacyItem {
  id: string;
  endpoint_id: string;
  request_url: string;
  source: string;
  events: string[];
}

/** Une ligne par famille couverte par un point de terminaison actif de notre récepteur. */
export function legacyItems(endpoints: readonly EndpointLike[], receiverUrl: string): LegacyItem[] {
  const items: LegacyItem[] = [];
  for (const endpoint of endpoints) {
    if (!isReceiverEndpoint(endpoint.url, receiverUrl) || endpoint.enabled === false) continue;
    const events = new Set(endpoint.trigger_events ?? []);
    for (const [source, wanted] of Object.entries(SOURCE_EVENTS)) {
      if (wanted.every((event) => events.has(event))) {
        items.push({ id: rowId(endpoint.id, source), endpoint_id: endpoint.id, request_url: redactWebhookUrl(endpoint.url), source, events: [...wanted] });
      }
    }
  }
  return items;
}

export interface EndpointSummary {
  id: string;
  url: string;
  enabled: boolean;
  is_receiver: boolean;
  trigger_events: string[];
  /** Événements que Konekt écoute et que ce point de terminaison ne porte pas. */
  missing_events: string[];
  description: string | null;
  account_ids: string[];
}

/** Forme rendue par `list` : jamais de jeton dans l'URL, jamais le secret du point de terminaison. */
export function summarizeEndpoint(endpoint: EndpointLike, receiverUrl: string): EndpointSummary {
  const events = [...(endpoint.trigger_events ?? [])];
  const receiver = isReceiverEndpoint(endpoint.url, receiverUrl);
  return {
    id: endpoint.id,
    url: redactWebhookUrl(endpoint.url),
    enabled: endpoint.enabled !== false,
    is_receiver: receiver,
    trigger_events: events,
    missing_events: receiver ? V2_TRIGGER_EVENTS.filter((event) => !events.includes(event)) : [],
    description: endpoint.description ?? null,
    account_ids: [...(endpoint.account_ids ?? [])],
  };
}

// ---------------------------------------------------------------------------
// Journal des livraisons (list_deliveries)
// ---------------------------------------------------------------------------

/** Issue d'une livraison, d'après le statut que NOTRE récepteur a répondu. */
export type DeliveryStatus = 'delivered' | 'failed' | 'no_response';

/** `delivered` : réponse 2xx ; `failed` : tout autre statut ; `no_response` : aucun statut enregistré. */
export function deliveryStatusOf(httpStatus: unknown): DeliveryStatus {
  if (typeof httpStatus !== 'number' || !Number.isFinite(httpStatus)) return 'no_response';
  return httpStatus >= 200 && httpStatus < 300 ? 'delivered' : 'failed';
}

export interface DeliverySummary {
  id: string;
  event_id: string;
  event_type: string;
  status: DeliveryStatus;
  http_status: number | null;
  created_at: string;
  /** Faux : cette tentative est une nouvelle tentative du prestataire (ou un rejeu). */
  first_attempt: boolean;
  latency_ms: number | null;
  response_time_ms: number | null;
}

const asString = (value: unknown): string => (typeof value === 'string' ? value : '');
const asNumberOrNull = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);

/**
 * Forme rendue par `list_deliveries` : liste fermée de champs. Ni la charge de
 * l'événement, ni le corps de la réponse de notre récepteur, ni l'adresse du
 * point de terminaison (elle porte le jeton de livraison) ne sortent d'ici.
 */
export function summarizeDelivery(delivery: Record<string, unknown>): DeliverySummary {
  return {
    id: asString(delivery.id),
    event_id: asString(delivery.event_id),
    event_type: asString(delivery.event_type),
    status: deliveryStatusOf(delivery.http_status),
    http_status: asNumberOrNull(delivery.http_status),
    created_at: asString(delivery.created_at),
    first_attempt: delivery.first_attempt !== false,
    latency_ms: asNumberOrNull(delivery.latency_ms),
    response_time_ms: asNumberOrNull(delivery.response_time_ms),
  };
}

/** Identifiant d'événement (`evt_...`) d'un argument de `replay_event`, sinon `null`. */
export function eventIdOf(value: unknown): string | null {
  return typeof value === 'string' && /^evt_[A-Za-z0-9_-]+$/.test(value) ? value : null;
}

/** Entier borné d'un argument de pagination ; `fallback` si absent, `null` si présent mais invalide (non entier, hors nombre, sous `min`). Au-dessus de `max`, la valeur est ramenée à `max` (pas de 400). */
export function boundedInt(value: unknown, min: number, max: number, fallback: number): number | null {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < min) return null;
  return Math.min(value, max);
}

/**
 * Administrateur de la plateforme d'après le secret KONEKT_PLATFORM_ADMIN_USER_IDS
 * (identifiants séparés par des virgules). Strict : un secret absent ou vide ne
 * donne le droit à personne (les actions du journal ne retombent jamais sur le seul
 * rôle owner/admin de l'organisation).
 */
export function isPlatformAdminId(userId: string, raw: string | undefined | null): boolean {
  const allow = (raw ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  return allow.length > 0 && allow.includes(userId);
}

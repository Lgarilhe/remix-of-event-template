/**
 * Client centralisé pour l'API Unipile v2 (BETA).
 *
 * Différences structurelles majeures vs v1 (source : spec OpenAPI v2 officiel,
 * SDK @unipile/sdk 2.21.0) :
 *  - Base URL globale unique `https://api.unipile.com` — plus de DSN par tenant
 *    (`apiXX.unipile.com:PORT`). La notion de DSN disparaît entièrement.
 *  - `account_id` passe dans le path : `/v2/{account_id}/...` au lieu de
 *    `?account_id=...`.
 *  - Auth inchangée : header `X-API-KEY`, mais avec une clé émise par le
 *    Dashboard V2 (Organization → Application → API keys). La clé v1 ne
 *    fonctionne PAS sur la v2 et réciproquement.
 *  - Webhooks : gestion via `/v2/webhooks/endpoints/` avec un tableau
 *    `trigger_events` unifié (plus de notion de `source`). Les événements sont
 *    renommés (voir V2_TRIGGER_EVENTS et unipile-webhook/index.ts).
 *
 * Migration progressive (strangler) : la v1 reste le chemin par défaut tant que
 * `UNIPILE_V2_API_KEY` n'est pas configuré dans les secrets Supabase. Voir
 * AUDITS/UNIPILE_V2_MIGRATION_PLAN.md pour le plan fichier par fichier.
 */

export const UNIPILE_V2_BASE_URL = "https://api.unipile.com/v2";

export interface UnipileV2Credentials {
  apiKey: string;
  baseUrl: string;
}

/** True si la clé v2 est configurée dans l'environnement des edge functions. */
export function isUnipileV2Configured(): boolean {
  return Boolean(Deno.env.get("UNIPILE_V2_API_KEY"));
}

/**
 * Résout les credentials v2.
 *
 * Pour l'instant : env `UNIPILE_V2_API_KEY` uniquement. Le support per-org
 * (colonne `unipile_v2_api_key` sur organization_integrations, comme
 * resolveUnipileCredentials v1) viendra avec une migration SQL dédiée quand une
 * org cliente aura son propre compte v2 — le paramètre organizationId est déjà
 * dans la signature pour ne pas casser les call sites à ce moment-là.
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
 * (ex : `/accounts/`, `/{account_id}/linkedin/search/people`).
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

/**
 * Événements v2 auxquels Konekt s'abonne (parité v1 + captures utiles).
 * Correspondance v1 → v2 :
 *   message_received → message.new | message_reaction → message.reaction.new
 *   message_read → message.receipt.read | new_relation → relation.new (+ relation.request.accept)
 *   account_status (source) → account.add / account.reconnect / account.remove /
 *     account.status.* / account.initial_sync.* | mail_received → email.new
 *   mail_opened → tracking.open (+ tracking.click, email.new.bounce : nouveaux)
 */
export const V2_TRIGGER_EVENTS = [
  "message.new",
  "message.reaction.new",
  "message.receipt.read",
  "relation.new",
  "relation.request.accept",
  "account.add",
  "account.reconnect",
  "account.remove",
  "account.status.running",
  "account.status.paused",
  "account.status.disconnected",
  "account.status.errored",
  "account.initial_sync.completed",
  "account.initial_sync.failed",
  "email.new",
  "email.new.bounce",
  "tracking.open",
  "tracking.click",
] as const;

/**
 * Token d'authentification des webhooks v2, dérivé de UNIPILE_WEBHOOK_SECRET.
 *
 * La création d'endpoint v2 (`POST /v2/webhooks/endpoints/`) n'accepte PAS de
 * headers custom (contrairement au `Unipile-Auth` de la v1). On passe donc un
 * token dérivé en query param de l'URL cible (`?v2_token=...`) :
 * unipile-manage-webhooks le génère à l'enregistrement, unipile-webhook le
 * recalcule et compare en temps constant. Dérivé (HMAC) plutôt que le secret
 * brut pour ne pas exposer UNIPILE_WEBHOOK_SECRET dans les URLs (logs Unipile).
 */
export async function deriveV2WebhookToken(secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode("unipile-v2-webhook-endpoint"),
  );
  return Array.from(new Uint8Array(signature), (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Résout le token attendu dans `?v2_token=` : le secret dédié
 * `UNIPILE_V2_WEBHOOK_TOKEN` en priorité (valeur brute — introduit car
 * UNIPILE_WEBHOOK_SECRET est illisible après création côté dashboard, donc
 * impossible d'en dériver le token hors des edge functions), sinon dérivation
 * HMAC depuis `UNIPILE_WEBHOOK_SECRET`. Null si aucun des deux n'est configuré.
 */
export async function resolveV2WebhookToken(): Promise<string | null> {
  const dedicated = Deno.env.get("UNIPILE_V2_WEBHOOK_TOKEN");
  if (dedicated) return dedicated;
  const legacy = Deno.env.get("UNIPILE_WEBHOOK_SECRET");
  if (legacy) return deriveV2WebhookToken(legacy);
  return null;
}

/**
 * Contrôles de préparation à la bascule (action `readiness`).
 *
 * `buildReadinessChecks` est pur : il reçoit les faits déjà lus (secrets sous forme de booléens,
 * liste des comptes du service, points de terminaison de notifications, comptes de la base) et rend
 * la liste des contrôles { id, label, status, detail }. Aucun secret, aucun jeton, aucune adresse
 * entière ne passe par ici : les secrets sont des booléens, l'adresse du récepteur n'est pas rendue,
 * les libellés de comptes sont masqués (plan.ts).
 *
 * Aucun texte rendu ne nomme le prestataire ni ses variables d'environnement.
 */

import { summarizePlan, unmappedItems, type DbAccount, type Plan, buildPlan } from './plan.ts';

export type CheckStatus = 'ok' | 'warn' | 'ko';

export interface ReadinessCheck {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
  /** Données complémentaires affichables (effectifs, noms d'événements, libellés masqués). */
  data?: Record<string, unknown>;
}

export interface EndpointView {
  enabled: boolean;
  trigger_events: readonly string[];
}

export type EndpointFacts =
  | { state: 'skipped'; reason: 'key_missing' | 'service_unreachable' }
  | { state: 'error' }
  | { state: 'listed'; ours: readonly EndpointView[]; truncated: boolean };

export interface ReadinessFacts {
  keyConfigured: boolean;
  service: { ok: true; accounts: readonly unknown[]; truncated: boolean } | { ok: false };
  hostedDomain: { state: 'set'; host: string } | { state: 'unset' } | { state: 'invalid' };
  endpoints: EndpointFacts;
  /** Jeton de livraison des notifications : dédié, dérivé de l'ancien secret partagé, ou absent. */
  webhookToken: 'dedicated' | 'derived' | 'missing';
  adminCount: number;
  nativeEnabled: boolean;
  legacySecretsSet: boolean;
  remapInstalled: boolean | 'unknown';
  db: { ok: true; accounts: readonly DbAccount[] } | { ok: false };
  /** Événements que la plateforme doit recevoir. */
  wantedEvents: readonly string[];
}

/** Événements voulus qui manquent à un point de terminaison. */
export function missingEvents(endpoint: EndpointView, wanted: readonly string[]): string[] {
  const have = new Set(endpoint.trigger_events ?? []);
  return wanted.filter((event) => !have.has(event));
}

const KEY_LABEL = 'Clé du service de connexion';

function keyCheck(f: ReadinessFacts): ReadinessCheck {
  return f.keyConfigured
    ? { id: 'api_key', label: KEY_LABEL, status: 'ok', detail: 'La clé est configurée.' }
    : { id: 'api_key', label: KEY_LABEL, status: 'ko', detail: 'La clé est absente. Sans elle, aucun appel au service n\'est possible.' };
}

function serviceCheck(f: ReadinessFacts): ReadinessCheck {
  const label = 'Service de connexion joignable';
  if (!f.keyConfigured) return { id: 'service_reachable', label, status: 'ko', detail: 'Non vérifié : la clé est absente.' };
  if (!f.service.ok) return { id: 'service_reachable', label, status: 'ko', detail: 'Le service ne répond pas ou refuse la clé.' };
  const n = f.service.accounts.length;
  if (f.service.truncated) {
    return {
      id: 'service_reachable', label, status: 'warn',
      detail: `Le service répond. La liste est tronquée à ${n} comptes : le rapprochement des comptes est incomplet.`,
      data: { service_accounts: n, truncated: true },
    };
  }
  return { id: 'service_reachable', label, status: 'ok', detail: `Le service répond. ${n} compte${n > 1 ? 's' : ''} côté service.`, data: { service_accounts: n } };
}

function domainCheck(f: ReadinessFacts): ReadinessCheck {
  const label = 'Domaine de connexion à votre marque';
  switch (f.hostedDomain.state) {
    case 'set':
      // Un domaine qui nomme le service lui-même n'est pas un domaine à la marque, et son nom ne sort pas.
      if (/unipile/i.test(f.hostedDomain.host)) {
        return { id: 'hosted_domain', label, status: 'warn', detail: 'Le domaine configuré est celui du service, pas un domaine à votre marque.' };
      }
      return { id: 'hosted_domain', label, status: 'ok', detail: `Domaine configuré : ${f.hostedDomain.host}.` };
    case 'invalid':
      return { id: 'hosted_domain', label, status: 'ko', detail: 'La valeur configurée n\'est pas un nom de domaine valide.' };
    default:
      return { id: 'hosted_domain', label, status: 'warn', detail: 'Non configuré : les pages de connexion s\'ouvriront sur le domaine du service.' };
  }
}

function endpointCheck(f: ReadinessFacts): ReadinessCheck {
  const label = 'Réception des notifications';
  const e = f.endpoints;
  if (e.state === 'skipped') {
    return { id: 'webhook_endpoint', label, status: 'ko', detail: e.reason === 'key_missing' ? 'Non vérifié : la clé est absente.' : 'Non vérifié : le service ne répond pas.' };
  }
  if (e.state === 'error') return { id: 'webhook_endpoint', label, status: 'ko', detail: 'La lecture des adresses de réception a échoué.' };
  if (e.ours.length === 0) {
    return {
      id: 'webhook_endpoint', label, status: e.truncated ? 'warn' : 'ko',
      detail: e.truncated
        ? 'Aucune adresse de réception trouvée, mais la liste est tronquée : la vérification est incomplète.'
        : 'Aucune adresse de réception n\'est enregistrée pour ce projet. Enregistrez les notifications avant la bascule.',
      data: { endpoints: 0 },
    };
  }
  const enabled = e.ours.filter((endpoint) => endpoint.enabled);
  const best = (enabled.length > 0 ? enabled : e.ours).reduce((a, b) =>
    missingEvents(b, f.wantedEvents).length < missingEvents(a, f.wantedEvents).length ? b : a
  );
  const missing = missingEvents(best, f.wantedEvents);
  const data = { endpoints: e.ours.length, enabled: enabled.length, missing_events: missing };
  if (enabled.length === 0) {
    return { id: 'webhook_endpoint', label, status: 'ko', detail: 'L\'adresse de réception de ce projet est désactivée.', data };
  }
  if (missing.length > 0) {
    return {
      id: 'webhook_endpoint', label, status: 'ko',
      detail: `Il manque ${missing.length} événement${missing.length > 1 ? 's' : ''} sur ${f.wantedEvents.length} : ${missing.join(', ')}.`,
      data,
    };
  }
  if (e.ours.length > 1) {
    return { id: 'webhook_endpoint', label, status: 'warn', detail: `${e.ours.length} adresses de réception pointent vers ce projet (doublons). Réenregistrez les notifications pour les fusionner.`, data };
  }
  return { id: 'webhook_endpoint', label, status: 'ok', detail: `Enregistré, actif, ${f.wantedEvents.length} événements suivis.`, data };
}

function tokenCheck(f: ReadinessFacts): ReadinessCheck {
  const label = 'Clé de réception des notifications';
  if (f.webhookToken === 'dedicated') return { id: 'webhook_token', label, status: 'ok', detail: 'Une clé dédiée est configurée.' };
  if (f.webhookToken === 'derived') {
    return { id: 'webhook_token', label, status: 'warn', detail: 'La clé est dérivée de l\'ancien secret partagé. Une clé dédiée est recommandée.' };
  }
  return { id: 'webhook_token', label, status: 'ko', detail: 'Aucune clé n\'est configurée : les notifications seraient refusées.' };
}

function adminCheck(f: ReadinessFacts): ReadinessCheck {
  const label = 'Liste des administrateurs de la plateforme';
  return f.adminCount > 0
    ? { id: 'admin_list', label, status: 'ok', detail: `${f.adminCount} administrateur${f.adminCount > 1 ? 's' : ''} listé${f.adminCount > 1 ? 's' : ''}.` }
    : { id: 'admin_list', label, status: 'ko', detail: 'La liste est vide.' };
}

function nativeCheck(f: ReadinessFacts): ReadinessCheck {
  const label = 'Connexion directe (identifiants saisis dans Konekt)';
  return f.nativeEnabled
    ? { id: 'native_connection', label, status: 'ok', detail: 'Activée.' }
    : { id: 'native_connection', label, status: 'ok', detail: 'Désactivée (état par défaut). Les connexions passent par le lien hébergé.' };
}

function legacyCheck(f: ReadinessFacts): ReadinessCheck {
  const label = 'Anciennes clés du service';
  return f.legacySecretsSet
    ? { id: 'legacy_secrets', label, status: 'warn', detail: 'Encore définis. À retirer à la fin de la bascule.' }
    : { id: 'legacy_secrets', label, status: 'ok', detail: 'Retirés.' };
}

function installedCheck(f: ReadinessFacts): ReadinessCheck {
  const label = 'Outils de bascule en base de données';
  if (f.remapInstalled === true) return { id: 'remap_installed', label, status: 'ok', detail: 'Les fonctions de bascule et de restauration sont installées.' };
  if (f.remapInstalled === 'unknown') return { id: 'remap_installed', label, status: 'warn', detail: 'État non vérifiable pour le moment.' };
  return { id: 'remap_installed', label, status: 'ko', detail: 'Les fonctions de bascule ne sont pas installées : appliquez la migration.' };
}

/** Données du contrôle des comptes : effectifs et comptes sans correspondance (libellés masqués). */
export function planData(plan: Plan, listLimit = 50): Record<string, unknown> {
  const unmapped = unmappedItems(plan);
  return {
    counts: plan.counts,
    shared_targets: plan.sharedTargets,
    unmapped: unmapped.slice(0, listLimit).map((item) => ({
      kind: item.kind, label: item.maskedLabel, ref: item.ref, reason: item.reason,
    })),
    unmapped_truncated: unmapped.length > listLimit,
  };
}

function accountsCheck(f: ReadinessFacts): ReadinessCheck {
  const label = 'Comptes de la base et du service';
  if (!f.db.ok) return { id: 'accounts_mapping', label, status: 'ko', detail: 'Les comptes de la base n\'ont pas pu être lus.' };
  if (!f.service.ok) return { id: 'accounts_mapping', label, status: 'ko', detail: 'Rapprochement impossible : le service ne répond pas.' };
  const plan = buildPlan(f.db.accounts, f.service.accounts);
  const c = plan.counts.all;
  let detail = summarizePlan(plan);
  let status: CheckStatus = 'ok';
  if (c.unmapped > 0) {
    status = 'warn';
    detail += ' Reconnectez les comptes sans correspondance avant la bascule, ou acceptez de les laisser tels quels.';
  }
  if (f.service.truncated) {
    status = 'warn';
    detail += ' La liste du service est tronquée : le rapprochement est incomplet.';
  }
  if (plan.sharedTargets > 0) {
    status = 'warn';
    detail += ` ${plan.sharedTargets} compte${plan.sharedTargets > 1 ? 's' : ''} du service ${plan.sharedTargets > 1 ? 'sont visés' : 'est visé'} par plusieurs anciens identifiants.`;
  }
  return { id: 'accounts_mapping', label, status, detail, data: planData(plan) };
}

export function buildReadinessChecks(facts: ReadinessFacts): ReadinessCheck[] {
  return [
    keyCheck(facts),
    serviceCheck(facts),
    domainCheck(facts),
    endpointCheck(facts),
    tokenCheck(facts),
    adminCheck(facts),
    nativeCheck(facts),
    legacyCheck(facts),
    installedCheck(facts),
    accountsCheck(facts),
  ];
}

export function summarizeChecks(checks: readonly ReadinessCheck[]): { ok: number; warn: number; ko: number; ready: boolean } {
  const count = (status: CheckStatus) => checks.filter((check) => check.status === status).length;
  const ko = count('ko');
  return { ok: count('ok'), warn: count('warn'), ko, ready: ko === 0 };
}

// Contrôles de préparation : un état pour chaque cas, rien de secret ni de vendeur dans le texte.
//
//   deno test --no-check --import-map=e2e/local-stack/import_map.json --allow-env --allow-read supabase/functions/unipile-migration/readiness.test.ts

import { ok, strictEqual } from 'node:assert';
import { V2_TRIGGER_EVENTS } from '../_shared/unipile/index.ts';
import { buildReadinessChecks, missingEvents, summarizeChecks, type ReadinessFacts } from './readiness.ts';

const WANTED = V2_TRIGGER_EVENTS;

function facts(overrides: Partial<ReadinessFacts> = {}): ReadinessFacts {
  return {
    keyConfigured: true,
    service: { ok: true, accounts: [{ id: 'acc_L1', provider: 'linkedin', name: 'Jean', metadata: { v1_account_id: 'v1-l1' } }], truncated: false },
    hostedDomain: { state: 'set', host: 'connexion.konekt.fr' },
    endpoints: { state: 'listed', ours: [{ enabled: true, trigger_events: [...WANTED] }], truncated: false },
    webhookToken: 'dedicated',
    adminCount: 2,
    nativeEnabled: false,
    legacySecretsSet: false,
    remapInstalled: true,
    db: { ok: true, accounts: [{ kind: 'linkedin', storedId: 'v1-l1', label: 'Jean', email: null }] },
    wantedEvents: WANTED,
    ...overrides,
  };
}

const byId = (checks: ReturnType<typeof buildReadinessChecks>, id: string) => checks.find((check) => check.id === id)!;

Deno.test('tout est prêt : dix contrôles, aucun ko', () => {
  const checks = buildReadinessChecks(facts());
  strictEqual(checks.length, 10);
  deepIds(checks.map((c) => c.id));
  const summary = summarizeChecks(checks);
  strictEqual(summary.ko, 0);
  strictEqual(summary.warn, 0);
  strictEqual(summary.ready, true);
  for (const check of checks) {
    ok(check.label.length > 3 && check.detail.length > 3);
    ok(['ok', 'warn', 'ko'].includes(check.status));
  }
});

function deepIds(ids: string[]) {
  strictEqual(
    ids.join(','),
    'api_key,service_reachable,hosted_domain,webhook_endpoint,webhook_token,admin_list,native_connection,legacy_secrets,remap_installed,accounts_mapping',
  );
}

Deno.test('clé absente : clé, service et notifications en ko, aucun appel supposé', () => {
  const checks = buildReadinessChecks(facts({
    keyConfigured: false, service: { ok: false }, endpoints: { state: 'skipped', reason: 'key_missing' },
  }));
  strictEqual(byId(checks, 'api_key').status, 'ko');
  strictEqual(byId(checks, 'service_reachable').status, 'ko');
  strictEqual(byId(checks, 'webhook_endpoint').status, 'ko');
  strictEqual(byId(checks, 'accounts_mapping').status, 'ko');
  strictEqual(summarizeChecks(checks).ready, false);
});

Deno.test('service muet : ko sur le service, les notifications et les comptes', () => {
  const checks = buildReadinessChecks(facts({ service: { ok: false }, endpoints: { state: 'skipped', reason: 'service_unreachable' } }));
  strictEqual(byId(checks, 'api_key').status, 'ok');
  strictEqual(byId(checks, 'service_reachable').status, 'ko');
  ok(byId(checks, 'webhook_endpoint').detail.includes('ne répond pas'));
  strictEqual(byId(checks, 'accounts_mapping').status, 'ko');
});

Deno.test('liste du service tronquée : avertissement', () => {
  const checks = buildReadinessChecks(facts({
    service: { ok: true, accounts: [], truncated: true },
  }));
  strictEqual(byId(checks, 'service_reachable').status, 'warn');
  strictEqual(byId(checks, 'accounts_mapping').status, 'warn');
});

Deno.test('domaine : défini, absent (avertissement), invalide (ko)', () => {
  strictEqual(byId(buildReadinessChecks(facts()), 'hosted_domain').status, 'ok');
  strictEqual(byId(buildReadinessChecks(facts({ hostedDomain: { state: 'unset' } })), 'hosted_domain').status, 'warn');
  strictEqual(byId(buildReadinessChecks(facts({ hostedDomain: { state: 'invalid' } })), 'hosted_domain').status, 'ko');
  const vendorHost = byId(buildReadinessChecks(facts({ hostedDomain: { state: 'set', host: 'account.unipile.com' } })), 'hosted_domain');
  strictEqual(vendorHost.status, 'warn');
  ok(!/unipile/i.test(JSON.stringify(vendorHost)), 'le nom du prestataire ne sort pas');
});

Deno.test('notifications : aucun point, désactivé, événements manquants, doublons, liste tronquée', () => {
  const none = byId(buildReadinessChecks(facts({ endpoints: { state: 'listed', ours: [], truncated: false } })), 'webhook_endpoint');
  strictEqual(none.status, 'ko');
  const noneTruncated = byId(buildReadinessChecks(facts({ endpoints: { state: 'listed', ours: [], truncated: true } })), 'webhook_endpoint');
  strictEqual(noneTruncated.status, 'warn');

  const disabled = byId(buildReadinessChecks(facts({
    endpoints: { state: 'listed', ours: [{ enabled: false, trigger_events: [...WANTED] }], truncated: false },
  })), 'webhook_endpoint');
  strictEqual(disabled.status, 'ko');
  ok(disabled.detail.includes('désactivé'));

  const partial = byId(buildReadinessChecks(facts({
    endpoints: { state: 'listed', ours: [{ enabled: true, trigger_events: ['message.new', 'email.new'] }], truncated: false },
  })), 'webhook_endpoint');
  strictEqual(partial.status, 'ko');
  ok(partial.detail.includes('relation.new'));
  strictEqual((partial.data?.missing_events as string[]).length, WANTED.length - 2);

  const dup = byId(buildReadinessChecks(facts({
    endpoints: {
      state: 'listed', truncated: false,
      ours: [{ enabled: true, trigger_events: [...WANTED] }, { enabled: false, trigger_events: [] }],
    },
  })), 'webhook_endpoint');
  strictEqual(dup.status, 'warn');
  ok(dup.detail.includes('doublons'));

  strictEqual(byId(buildReadinessChecks(facts({ endpoints: { state: 'error' } })), 'webhook_endpoint').status, 'ko');
});

Deno.test('missingEvents : liste exacte', () => {
  strictEqual(missingEvents({ enabled: true, trigger_events: WANTED }, WANTED).length, 0);
  strictEqual(missingEvents({ enabled: true, trigger_events: [] }, WANTED).length, WANTED.length);
});

Deno.test('jeton : dédié ok, dérivé avertissement, absent ko', () => {
  strictEqual(byId(buildReadinessChecks(facts({ webhookToken: 'dedicated' })), 'webhook_token').status, 'ok');
  strictEqual(byId(buildReadinessChecks(facts({ webhookToken: 'derived' })), 'webhook_token').status, 'warn');
  strictEqual(byId(buildReadinessChecks(facts({ webhookToken: 'missing' })), 'webhook_token').status, 'ko');
});

Deno.test('administrateurs, connexion directe, anciens secrets, migration', () => {
  strictEqual(byId(buildReadinessChecks(facts({ adminCount: 0 })), 'admin_list').status, 'ko');
  strictEqual(byId(buildReadinessChecks(facts({ nativeEnabled: true })), 'native_connection').detail, 'Activée.');
  ok(byId(buildReadinessChecks(facts()), 'native_connection').detail.startsWith('Désactivée'));
  strictEqual(byId(buildReadinessChecks(facts({ legacySecretsSet: true })), 'legacy_secrets').status, 'warn');
  strictEqual(byId(buildReadinessChecks(facts({ remapInstalled: false })), 'remap_installed').status, 'ko');
  strictEqual(byId(buildReadinessChecks(facts({ remapInstalled: 'unknown' })), 'remap_installed').status, 'warn');
});

Deno.test('comptes : sans correspondance = avertissement, libellés masqués, base illisible = ko', () => {
  const withUnmapped = buildReadinessChecks(facts({
    db: {
      ok: true,
      accounts: [
        { kind: 'linkedin', storedId: 'v1-l1', label: 'Jean', email: null },
        { kind: 'email', storedId: 'v1-perdu', label: 'marie.curie@labo.fr', email: 'marie.curie@labo.fr' },
      ],
    },
  }));
  const accounts = byId(withUnmapped, 'accounts_mapping');
  strictEqual(accounts.status, 'warn');
  ok(accounts.detail.includes('1 sans correspondance'));
  const json = JSON.stringify(accounts);
  ok(!json.includes('marie.curie@labo.fr'), 'adresse entière absente');
  ok(json.includes('m***@labo.fr'));
  ok(!json.includes('v1-perdu'), 'ancien identifiant entier absent');
  ok(json.includes('…erdu'));

  strictEqual(byId(buildReadinessChecks(facts({ db: { ok: false } })), 'accounts_mapping').status, 'ko');
});

Deno.test('textes : français, aucun nom de prestataire ni de variable d\'environnement, aucun tiret long', () => {
  const scenarios = [
    facts(),
    facts({ keyConfigured: false, service: { ok: false }, endpoints: { state: 'skipped', reason: 'key_missing' }, webhookToken: 'missing', adminCount: 0, remapInstalled: false, legacySecretsSet: true, hostedDomain: { state: 'invalid' }, db: { ok: false } }),
    facts({ webhookToken: 'derived', hostedDomain: { state: 'unset' }, nativeEnabled: true, remapInstalled: 'unknown' }),
  ];
  for (const scenario of scenarios) {
    // Les identifiants de contrôle (api_key, webhook_token...) sont des clés de l'interface, pas du texte affiché.
    const text = JSON.stringify(buildReadinessChecks(scenario).map(({ id: _id, ...rest }) => rest));
    ok(!/unipile|UNIPILE_|_API_KEY|_TOKEN|_SECRET|CONNECTION_NATIVE|KONEKT_PLATFORM/i.test(text), text);
    ok(!text.includes('—'));
    ok(!/https?:\/\//.test(text), 'aucune adresse');
    // Mots simples : ni version du prestataire, ni « point de terminaison », ni « jeton », ni « ancienne API ».
    ok(!/\(V2\)|point de terminaison|jeton|ancienne API|secrets? de/i.test(text), text);
  }
});

Deno.test('libellés : clair et sans version du prestataire', () => {
  const labels = buildReadinessChecks(facts()).map((check) => check.label);
  ok(labels.includes('Clé du service de connexion'));
  ok(labels.includes('Réception des notifications'));
  ok(labels.includes('Clé de réception des notifications'));
  ok(labels.includes('Anciennes clés du service'));
});

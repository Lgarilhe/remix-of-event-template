/**
 * Téléphonie, lot A1 : garde-fous de la réception des appels Aircall par
 * organisation.
 *
 * Deux sortes de contrôles, sans navigateur, sans base ni runtime Deno :
 *   - le comportement des deux fonctions pures (supabase/functions/_shared/
 *     phone.ts et aircall-call.ts), importées telles quelles par Node ;
 *   - des assertions de motifs sur la migration, le récepteur de webhook et
 *     la fonction de connexion (même forme que lot0b-ecrivains.test.mjs).
 *
 * Lancer : node --test tests/c1/telephonie-aircall.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre (ex. une extraction de HEAD).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const load = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

const MIGRATION_NAME = readdirSync(join(ROOT, 'supabase/migrations'))
  .find((f) => f.endsWith('_telephonie_aircall_lot_a1_reception.sql'));

// ---------------------------------------------------------------------
// toE164 : un numéro ambigu rend null, jamais un faux rapprochement
// ---------------------------------------------------------------------
test('toE164 : formats français et internationaux', async () => {
  const { toE164 } = await load('supabase/functions/_shared/phone.ts');
  const cas = [
    ['06 12 34 56 78', '+33612345678'],
    ['06.12.34.56.78', '+33612345678'],
    ['+33 6 12 34 56 78', '+33612345678'],
    ['+33 (0)6 12 34 56 78', '+33612345678'],
    ['+330612345678', '+33612345678'],
    ['0033612345678', '+33612345678'],
    ['33612345678', '+33612345678'],
    ['0612345678 poste 12', '+33612345678'],
    ['+44 20 7946 0958', '+442079460958'],
    ['0044 20 7946 0958', '+442079460958'],
    ['+1 415 555 0132', '+14155550132'],
  ];
  for (const [entree, attendu] of cas) {
    assert.equal(toE164(entree), attendu, `toE164(${JSON.stringify(entree)})`);
  }
});

test('toE164 : le doute rend null', async () => {
  const { toE164 } = await load('supabase/functions/_shared/phone.ts');
  for (const entree of [null, undefined, '', '   ', 'abc', '12345', '612345678', '+33612', '+3361234567890', '0044', '+0123456789']) {
    assert.equal(toE164(entree), null, `toE164(${JSON.stringify(entree)})`);
  }
});

// ---------------------------------------------------------------------
// mapAircallCall : l'événement Aircall vers le format de record_phone_call
// ---------------------------------------------------------------------
const APPEL = {
  id: 123456,
  direction: 'inbound',
  status: 'done',
  started_at: 1790000000,
  answered_at: 1790000010,
  ended_at: 1790000070,
  duration: 70, // compte la sonnerie : ne doit PAS servir de durée de conversation
  raw_digits: '+33 6 12 34 56 78',
  number: { digits: '+33 1 99 99 99 99' }, // la ligne Aircall de l'agent, jamais le correspondant
  contact: { first_name: 'Marc', last_name: 'Moreau' },
  user: { id: 9, name: 'Julie Martin', email: 'julie@example.test' },
  recording: 'https://assets.aircall.example/rec/123456.mp3',
  tags: [{ name: 'rdv' }, { name: 'à rappeler' }],
  comments: [{ content: 'Rappeler mardi' }, { content: 'Parle anglais' }],
};

test('mapAircallCall : un appel décroché', async () => {
  const { mapAircallCall } = await load('supabase/functions/_shared/aircall-call.ts');
  const m = mapAircallCall(APPEL, 1790000071);
  assert.equal(m.externalId, '123456');
  assert.equal(m.eventAt, new Date(1790000071 * 1000).toISOString());
  assert.equal(m.call.direction, 'inbound');
  assert.equal(m.call.talk_seconds, 60, 'durée de conversation = fin - décroche, pas la durée brute');
  assert.equal(m.call.contact_number, '+33 6 12 34 56 78');
  assert.equal(m.call.contact_number_e164, '+33612345678');
  assert.equal(m.call.contact_name, 'Marc Moreau');
  assert.equal(m.call.agent_external_id, '9');
  assert.equal(m.call.agent_name, 'Julie Martin');
  assert.equal(m.call.agent_email, 'julie@example.test');
  assert.deepEqual(m.call.tags, ['rdv', 'à rappeler']);
  assert.equal(m.call.notes, 'Rappeler mardi\nParle anglais');
  assert.equal(m.call.recording_url, 'https://assets.aircall.example/rec/123456.mp3');
  assert.equal(m.call.started_at, new Date(1790000000 * 1000).toISOString());
});

test('mapAircallCall : un appel manqué n\'a pas de durée de conversation', async () => {
  const { mapAircallCall } = await load('supabase/functions/_shared/aircall-call.ts');
  const m = mapAircallCall({ ...APPEL, answered_at: null, duration: 25, missed_call_reason: 'agents_did_not_answer', recording: null }, 1790000071);
  assert.equal(m.call.talk_seconds, 0);
  assert.equal(m.call.missed_reason, 'agents_did_not_answer');
  assert.equal(m.call.recording_url, null);
});

test('mapAircallCall : la ligne Aircall n\'est jamais prise pour le correspondant', async () => {
  const { mapAircallCall } = await load('supabase/functions/_shared/aircall-call.ts');
  const { raw_digits, ...sansNumero } = APPEL;
  const m = mapAircallCall(sansNumero, 1790000071);
  assert.equal(m.call.contact_number, null);
  assert.equal(m.call.contact_number_e164, null);
});

test('mapAircallCall : événement sans identifiant ignoré, horodatages tolérants', async () => {
  const { mapAircallCall, toIso } = await load('supabase/functions/_shared/aircall-call.ts');
  assert.equal(mapAircallCall({ direction: 'inbound' }, 1790000071), null);
  assert.equal(mapAircallCall(null, 1790000071), null);
  assert.equal(toIso(1790000000), '2026-09-21T14:13:20.000Z');
  assert.equal(toIso(1790000000000), '2026-09-21T14:13:20.000Z');
  assert.equal(toIso('1790000000'), '2026-09-21T14:13:20.000Z');
  assert.equal(toIso('2026-09-21T14:13:20Z'), '2026-09-21T14:13:20.000Z');
  assert.equal(toIso(null), null);
  assert.equal(toIso(0), null);
  assert.equal(toIso('n\'importe quoi'), null);
  // Sans horodatage d'enveloppe, l'heure de réception sert (injectable pour le test).
  const m = mapAircallCall(APPEL, undefined, () => new Date('2026-10-05T10:00:00Z'));
  assert.equal(m.eventAt, '2026-10-05T10:00:00.000Z');
});

// ---------------------------------------------------------------------
// Migration : droits et garde d'ordre
// ---------------------------------------------------------------------
test('migration : tables, droits et fonctions', () => {
  assert.ok(MIGRATION_NAME, 'migration _telephonie_aircall_lot_a1_reception.sql introuvable');
  const sql = read(`supabase/migrations/${MIGRATION_NAME}`);

  // RLS sur les deux tables ; aucune écriture pour un rôle client.
  for (const t of ['phone_calls', 'telephony_connections']) {
    assert.match(sql, new RegExp(`ALTER TABLE public\\.${t} ENABLE ROW LEVEL SECURITY`), `${t} : RLS`);
    assert.match(sql, new RegExp(`REVOKE ALL ON public\\.${t} FROM PUBLIC, anon, authenticated`), `${t} : droits par défaut retirés`);
    assert.match(sql, new RegExp(`GRANT ALL ON public\\.${t} TO service_role`), `${t} : clé de service`);
    assert.match(sql, new RegExp(`organization_id\\s+uuid NOT NULL REFERENCES public\\.organizations\\(id\\) ON DELETE CASCADE`), `${t} : effacée avec l'organisation`);
  }
  // Les appels se lisent par l'organisation, jamais plus que SELECT.
  assert.match(sql, /GRANT SELECT ON public\.phone_calls TO authenticated/);
  assert.doesNotMatch(sql, /GRANT (ALL|INSERT|UPDATE|DELETE)[^;]*phone_calls[^;]*authenticated/);
  assert.match(sql, /organization_id = public\.get_user_org_id\(auth\.uid\(\)\)/);
  // La connexion (empreinte du jeton) n'a aucune policy ni aucun droit client.
  assert.doesNotMatch(sql, /CREATE POLICY[^;]*ON public\.telephony_connections/);
  assert.doesNotMatch(sql, /GRANT[^;]*telephony_connections[^;]*authenticated/);
  // Pas de jeton en clair dans la table.
  assert.match(sql, /webhook_token_hash\s+text NOT NULL/);
  assert.doesNotMatch(sql, /webhook_token\s+text/);
  // Un jeton ne désigne qu'une organisation.
  assert.match(sql, /UNIQUE \(provider, webhook_token_hash\)/);

  // record_phone_call : clé de service seulement, événement ancien sans effet.
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.record_phone_call\([^)]*\) FROM PUBLIC, anon, authenticated/);
  assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.record_phone_call\([^)]*\) TO service_role/);
  assert.match(sql, /WHERE pc\.last_event_at <= EXCLUDED\.last_event_at/);
  assert.match(sql, /RETURN 'stale'/);

  // get_telephony_status : SECURITY DEFINER, refusée à PUBLIC et anon, réservée owner/admin.
  assert.match(sql, /get_telephony_status[\s\S]*?SECURITY DEFINER/);
  assert.match(sql, /REVOKE ALL ON FUNCTION public\.get_telephony_status\(uuid\) FROM PUBLIC, anon/);
  assert.match(sql, /NOT IN \('owner', 'admin'\)/);
});

test('migration : horodatage unique parmi les migrations', () => {
  const versions = readdirSync(join(ROOT, 'supabase/migrations')).map((f) => f.split('_')[0]);
  const mine = MIGRATION_NAME.split('_')[0];
  assert.equal(versions.filter((v) => v === mine).length, 1, `version ${mine} en double`);
});

// ---------------------------------------------------------------------
// Récepteur : par organisation, jamais de jeton partagé
// ---------------------------------------------------------------------
test('aircall-webhook : l\'organisation vient du jeton de la connexion', () => {
  const src = read('supabase/functions/aircall-webhook/index.ts');
  assert.doesNotMatch(src, /AIRCALL_WEBHOOK_TOKEN/, 'plus de jeton partagé de la plateforme');
  assert.doesNotMatch(src, /airtable/i, 'plus de rapprochement par Airtable');
  assert.doesNotMatch(src, /from\(['"]aircall_calls['"]\)/, 'plus d\'écriture dans l\'ancienne table');
  assert.match(src, /sha256Hex\(token\)/);
  assert.match(src, /from\('telephony_connections'\)/);
  assert.match(src, /eq\('webhook_token_hash', tokenHash\)/);
  assert.match(src, /rpc\('record_phone_call'/);
  // Jeton inconnu : refus avant toute écriture d'appel.
  assert.ok(src.indexOf('Unauthorized') < src.indexOf("rpc('record_phone_call'"), 'le refus précède l\'écriture');
  // Rien de personnel dans les journaux.
  assert.doesNotMatch(src, /console\.(log|warn|error)\([^)]*(token|body\.data|raw_digits)/);
});

test('aircall-connect : réservé owner/admin, secrets jamais renvoyés', () => {
  const src = read('supabase/functions/aircall-connect/index.ts');
  assert.match(src, /requireAuth\(req, corsHeaders\)/);
  assert.match(src, /\['owner', 'admin'\]\.includes\(membership\.role\)/);
  assert.match(src, /\.eq\('organization_id', organizationId\)\s*\n\s*\.eq\('user_id', auth\.userId\)/, 'rôle lu pour CETTE organisation');
  // Aucune réponse ne porte le jeton API ni le jeton de webhook.
  for (const m of src.matchAll(/json\(([^;]*?)\);/g)) {
    assert.doesNotMatch(m[1], /apiToken|webhookToken|authHeader/, `réponse : ${m[1].slice(0, 80)}`);
  }
  // Aucun jeton dans les journaux.
  assert.doesNotMatch(src, /console\.(log|warn|error)\([^)]*(apiToken|webhookToken|authHeader)/);
  // Appels sortants bornés dans le temps (convention des fonctions).
  const sansHelper = src.replace(/function fetchWithTimeout[\s\S]*?\n\}\n/, '');
  assert.doesNotMatch(sansHelper, /[^.\w]fetch\(/, 'tout appel externe passe par fetchWithTimeout');
  // Un échec de sauvegarde ne laisse pas d'abonnement orphelin chez Aircall.
  assert.match(src, /if \(saveError\) \{[\s\S]*?deleteRemoteWebhook\(String\(webhookId\)\)/);
});

test('config.toml, export RGPD : les nouvelles fonctions sont déclarées', () => {
  const toml = read('supabase/config.toml');
  assert.match(toml, /\[functions\.aircall-connect\]\s*\nverify_jwt = false/);
  assert.match(toml, /\[functions\.aircall-webhook\]\s*\nverify_jwt = false/);
  const exp = read('supabase/functions/export-org-data/index.ts');
  assert.match(exp, /\.from\("phone_calls"\)/);
  assert.match(exp, /phone_calls: phoneCalls \|\| \[\]/);
  assert.match(exp, /phoneCallsError/);
});

// ---------------------------------------------------------------------
// Front : lecture par numéro, plus aucune lecture de l'ancienne table
// ---------------------------------------------------------------------
test('src/lib/phone.ts : copie exacte de la normalisation serveur', () => {
  assert.equal(read('src/lib/phone.ts'), read('supabase/functions/_shared/phone.ts'),
    'les deux copies de toE164 doivent rester identiques (cp supabase/functions/_shared/phone.ts src/lib/phone.ts)');
});

test('lecteurs d\'appels : phone_calls par numéro, plus aircall_calls ni Airtable', () => {
  const lib = read('src/lib/phoneCalls.ts');
  assert.match(lib, /\.from\('phone_calls'\)/);
  assert.match(lib, /\.in\('contact_number_e164', numbers\)/, 'rapprochement par numéro E.164');
  assert.doesNotMatch(lib, /select\('\*'\)/, 'colonnes nommées, jamais select(*)');
  assert.match(lib, /\.from\('candidate_contacts'\)[\s\S]*?\.eq\('organization_id', organizationId\)/, 'numéros lus pour l\'organisation active');

  for (const rel of ['src/hooks/useCandidateFullProfile.ts', 'src/hooks/useProfileActivity.ts', 'src/hooks/usePhoneCallHistory.ts',
    'src/components/outreach/result-card/ProfileDetailSheet.tsx', 'src/components/outreach/PhoneCallHistoryPanel.tsx']) {
    assert.doesNotMatch(read(rel), /aircall_calls|useAircallHistory|AircallHistoryPanel|matched_airtable_candidate_id/, `${rel} lit encore l'ancien modèle`);
  }
  // L'ancienne table n'a plus de lecteur dans le front.
  const srcFiles = [];
  const walk = (dir) => {
    for (const e of readdirSync(join(ROOT, dir), { withFileTypes: true })) {
      const rel = `${dir}/${e.name}`;
      if (e.isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(e.name) && rel !== 'src/integrations/supabase/types.ts') srcFiles.push(rel);
    }
  };
  walk('src');
  const readers = srcFiles.filter((f) => /from\(['"]aircall_calls['"]\)/.test(read(f)));
  assert.deepEqual(readers, [], 'lecteur(s) restant(s) de aircall_calls');
});

test('carte Aircall : liaison par le serveur, aucun secret relu', () => {
  const hook = read('src/hooks/useTelephonyStatus.ts');
  assert.match(hook, /rpc\('get_telephony_status'/);
  assert.match(hook, /invokeEdgeFunction[^\n]*'aircall-connect', \{ action: 'connect' \}/);
  assert.match(hook, /invokeEdgeFunction[^\n]*'aircall-connect', \{ action: 'disconnect' \}/);
  assert.match(hook, /enabled: !!organizationId && isAdmin/, 'état lu par les administrateurs seulement');
  const settings = read('src/components/settings/IntegrationsSettings.tsx');
  assert.match(settings, /config\.id === 'aircall' \? \(\s*<AircallCard/);
  // Retirer le jeton pendant une liaison active : la liaison part d'abord.
  assert.match(settings, /updates\.aircall_api_token === null && status\?\.connected[\s\S]*?await disconnect\(\)/);
  // Le panneau ne manipule jamais le jeton.
  assert.doesNotMatch(read('src/components/settings/AircallConnectionPanel.tsx'), /aircall_api_token|webhook_token/);
});

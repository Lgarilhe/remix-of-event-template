/**
 * Téléphonie, lot A2 : appels à rattacher à un candidat, et recruteur de
 * l'équipe qui a passé ou reçu chaque appel.
 *
 * Deux sortes de contrôles, sans navigateur ni base :
 *   - le comportement des fonctions pures (src/lib/phoneCallGroups.ts et
 *     callRecruiter.ts), importées telles quelles par Node ;
 *   - des assertions de motifs sur l'écriture du numéro, la page et la barre.
 *
 * Lancer : node --test tests/c1/telephonie-appels-a-rattacher.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const load = (rel) => import(pathToFileURL(join(ROOT, rel)).href);

const call = (over) => ({
  id: 'c', provider: 'aircall', direction: 'outbound', outcome: 'done', startedAt: '2026-10-06T10:00:00Z', talkSeconds: 60,
  contactNumber: null, numberE164: '+33612345678', contactName: null, agentName: null, agentEmail: null,
  recordingUrl: null, voicemailUrl: null, tags: [], notes: null, ...over,
});

// ---------------------------------------------------------------------
// Regroupement des appels non rattachés
// ---------------------------------------------------------------------
test('formatPhoneNumber : France lisible, autre indicatif sans deviner', async () => {
  const { formatPhoneNumber } = await load('src/lib/phoneCallGroups.ts');
  assert.equal(formatPhoneNumber('+33612345678'), '06 12 34 56 78');
  assert.equal(formatPhoneNumber('+33112345678'), '01 12 34 56 78');
  assert.equal(formatPhoneNumber('+442079460958'), '+442079460958');
});

test('groupUnattachedCalls : un groupe par numéro inconnu, du plus récent au plus ancien', async () => {
  const { groupUnattachedCalls } = await load('src/lib/phoneCallGroups.ts');
  const calls = [
    call({ id: 'a1', numberE164: '+33611111111', startedAt: '2026-10-06T08:00:00Z' }),
    call({ id: 'b1', numberE164: '+33622222222', startedAt: '2026-10-06T12:00:00Z', contactName: 'Marc Moreau' }),
    call({ id: 'a2', numberE164: '+33611111111', startedAt: '2026-10-06T09:00:00Z', contactName: 'Jeanne' }),
    call({ id: 'k1', numberE164: '+33633333333' }), // numéro connu d'un candidat : rattaché
    call({ id: 'n1', numberE164: null }), // numéro masqué : rien à rattacher
  ];
  const groups = groupUnattachedCalls(calls, new Set(['+33633333333']));
  assert.deepEqual(groups.map((g) => g.numberE164), ['+33622222222', '+33611111111']);
  const first = groups[1];
  assert.deepEqual(first.calls.map((c) => c.id), ['a2', 'a1'], 'appels du plus récent au plus ancien');
  assert.equal(first.lastStartedAt, '2026-10-06T09:00:00Z');
  assert.equal(first.contactName, 'Jeanne', 'nom connu de l\'opérateur, pris sur n\'importe quel appel du groupe');
  assert.equal(first.displayNumber, '06 11 11 11 11');
  assert.equal(groups[0].contactName, 'Marc Moreau');
});

test('groupUnattachedCalls : rien à rattacher quand tout est connu', async () => {
  const { groupUnattachedCalls } = await load('src/lib/phoneCallGroups.ts');
  assert.deepEqual(groupUnattachedCalls([call({})], new Set(['+33612345678'])), []);
  assert.deepEqual(groupUnattachedCalls([], new Set()), []);
});

test('keepCalls : un groupe sans appel restant disparaît, le dernier appel est recalculé', async () => {
  const { groupUnattachedCalls, keepCalls } = await load('src/lib/phoneCallGroups.ts');
  const groups = groupUnattachedCalls([
    call({ id: 'x1', numberE164: '+33611111111', startedAt: '2026-10-06T12:00:00Z', agentEmail: 'autre@x.fr' }),
    call({ id: 'x2', numberE164: '+33611111111', startedAt: '2026-10-06T08:00:00Z', agentEmail: 'moi@x.fr' }),
    call({ id: 'y1', numberE164: '+33622222222', agentEmail: 'autre@x.fr' }),
  ], new Set());
  const mine = keepCalls(groups, (c) => c.agentEmail === 'moi@x.fr');
  assert.equal(mine.length, 1);
  assert.deepEqual(mine[0].calls.map((c) => c.id), ['x2']);
  assert.equal(mine[0].lastStartedAt, '2026-10-06T08:00:00Z');
  assert.equal(groups[0].calls.length, 2, 'les groupes d\'origine ne sont pas modifiés');
});

// ---------------------------------------------------------------------
// Recruteur de l'équipe
// ---------------------------------------------------------------------
const MEMBERS = [
  { userId: 'u1', displayName: 'Julie Martin', email: 'Julie.Martin@Konekt.fr' },
  { userId: 'u2', displayName: 'l.garilhe', email: 'l.garilhe@konekt.fr' }, // display_name = préfixe brut de l'e-mail
  { userId: 'u3', displayName: null, email: null }, // e-mail non communiqué
];

test('resolveRecruiter : e-mail rapproché sans tenir compte de la casse', async () => {
  const { resolveRecruiter } = await load('src/lib/callRecruiter.ts');
  const r = resolveRecruiter(MEMBERS, ' julie.martin@konekt.fr ', 'Julie M.');
  assert.deepEqual(r, { userId: 'u1', name: 'Julie Martin', isMember: true });
});

test('resolveRecruiter : un display_name brut cède la place au nom complet de l\'opérateur', async () => {
  const { resolveRecruiter } = await load('src/lib/callRecruiter.ts');
  assert.equal(resolveRecruiter(MEMBERS, 'l.garilhe@konekt.fr', 'Laurent Garilhe').name, 'Laurent Garilhe');
  assert.equal(resolveRecruiter(MEMBERS, 'l.garilhe@konekt.fr', null).name, 'l.garilhe');
});

test('resolveRecruiter : agent inconnu de l\'équipe, nom de l\'opérateur gardé', async () => {
  const { resolveRecruiter } = await load('src/lib/callRecruiter.ts');
  assert.deepEqual(resolveRecruiter(MEMBERS, 'collegue@autre.fr', 'Paul Durand'), { userId: null, name: 'Paul Durand', isMember: false });
  assert.deepEqual(resolveRecruiter(MEMBERS, 'collegue@autre.fr', null), { userId: null, name: 'collegue', isMember: false });
  // Collaborateur : aucun e-mail de membre visible, jamais de faux rapprochement.
  assert.equal(resolveRecruiter([{ userId: 'u9', displayName: 'Z', email: null }], 'a@b.fr', 'A B').isMember, false);
});

test('resolveRecruiter : appel sans agent (personne n\'a décroché) rend null', async () => {
  const { resolveRecruiter } = await load('src/lib/callRecruiter.ts');
  assert.equal(resolveRecruiter(MEMBERS, null, null), null);
  assert.equal(resolveRecruiter(MEMBERS, '  ', ''), null);
});

test('isOwnCall : mes appels, casse ignorée, jamais un e-mail vide', async () => {
  const { isOwnCall } = await load('src/lib/callRecruiter.ts');
  assert.equal(isOwnCall('Moi@Konekt.fr', 'moi@konekt.fr'), true);
  assert.equal(isOwnCall('moi@konekt.fr', 'autre@konekt.fr'), false);
  assert.equal(isOwnCall(null, null), false);
  assert.equal(isOwnCall('', ''), false);
  assert.equal(isOwnCall('moi@konekt.fr', null), false);
});

// ---------------------------------------------------------------------
// Garde-fous statiques
// ---------------------------------------------------------------------
test('attachPhoneToCandidate : ne touche ni e-mail, ni notes, ni provenance, et annonce un conflit', () => {
  const src = read('src/lib/candidateContacts.ts');
  const fn = src.slice(src.indexOf('export async function attachPhoneToCandidate'), src.indexOf('// ─── Internal'));
  assert.match(fn, /\.update\(\{ phone, updated_by: user\.id \}\)/, 'mise à jour du seul numéro');
  assert.doesNotMatch(fn.slice(fn.indexOf('.update(')), /email|notes/, 'ni e-mail ni notes écrasés');
  assert.match(fn, /if \(previousPhone && !options\.replace\) return \{ status: 'conflict'/, 'un autre numéro n\'est jamais remplacé sans le dire');
  assert.match(fn, /toE164\(previousPhone\) === phone\) return \{ status: 'unchanged' \}/);
  assert.match(fn, /\.eq\('organization_id', organizationId\)\s*\n\s*\.eq\('candidate_id', candidateId\)/, 'filtré par organisation');
});

test('rattacher : candidat existant seulement, remplacement annoncé', () => {
  const dialog = read('src/components/calls/AttachCallDialog.tsx');
  assert.match(dialog, /allowCreate=\{false\}/, 'pas de création de candidat depuis un appel');
  assert.match(dialog, /setConflictPhone\(result\.previousPhone\)/);
  assert.match(dialog, /submit\(conflictPhone !== null\)/, 'le remplacement exige un second clic');
  const auto = read('src/components/calendar/CandidateAutocomplete.tsx');
  assert.match(auto, /allowCreate = true/, 'les autres écrans gardent l\'option « Créer »');
  assert.match(auto, /allowCreate && trimmed\.length >= 2/);
});

test('page Appels : « Mes appels » = les miens et ceux que personne n\'a décrochés', () => {
  const page = read('src/pages/Calls.tsx');
  assert.match(page, /isOwnCall\(userEmail, call\.agentEmail\) \|\| \(!call\.agentEmail && !call\.agentName\)/);
  assert.match(page, /useState<Scope>\('mine'\)/);
  // Une lecture en échec n'est jamais un état vide.
  assert.ok(page.indexOf('<ErrorState') < page.indexOf('<EmptyState'), 'erreur traitée avant l\'état vide');
  assert.doesNotMatch(page, /variant="primary"/, 'aucun bouton plein : rien à créer sur cet écran');
});

test('route /calls et lien de la barre : seulement après un premier appel reçu', () => {
  assert.match(read('src/App.tsx'), /<Route path="\/calls" element=\{<ProtectedRoute><OrganizationGuard><AppLayout><CallsPage \/><\/AppLayout>/);
  const row = read('src/components/sidebar/SidebarBottomRow.tsx');
  assert.match(row, /\.\.\.\(showCalls \? \[\{ to: '\/calls', label: 'Appels', icon: Phone \}\] : \[\]\)/);
  const hook = read('src/hooks/sidebar/useHasPhoneCalls.ts');
  assert.match(hook, /from\('phone_calls'\)\.select\('id', \{ count: 'exact', head: true \}\)/, 'comptage seul, sans lignes');
  assert.match(hook, /return query\.data === true/, 'faux tant que la réponse manque ou en erreur');
});

test('fiche : le recruteur de chaque appel s\'affiche avec ses initiales', () => {
  const panel = read('src/components/outreach/PhoneCallHistoryPanel.tsx');
  assert.match(panel, /resolveRecruiter\(call\.agentEmail, call\.agentName\)/);
  assert.match(panel, /<RecruiterTag recruiter=\{recruiter\}/);
});

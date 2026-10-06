/**
 * Téléphonie, lot A3 : ajouter un candidat depuis LinkedIn quand un appel vient
 * d'un inconnu absent de l'app.
 *
 * Deux sortes de contrôles, sans navigateur ni base :
 *   - les règles pures (src/lib/linkedinQuickFindModel.ts), importées telles
 *     quelles par Node ;
 *   - des assertions de motifs sur les garde-fous qui protègent le compte
 *     LinkedIn : une recherche par clic, le compte de la personne connectée,
 *     jamais de relance automatique.
 *
 * Lancer : node --test tests/c1/telephonie-linkedin-ajout.test.mjs
 * C1_ROOT=<dossier> relit un autre arbre.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
const load = () => import(pathToFileURL(join(ROOT, 'src/lib/linkedinQuickFindModel.ts')).href);

// ---------------------------------------------------------------------
// Licence du compte
// ---------------------------------------------------------------------
test('pickSearchApi : la licence la plus riche du compte, comme le Sourcing', async () => {
  const { pickSearchApi } = await load();
  assert.equal(pickSearchApi({ classic: true, recruiter: true, sales_navigator: true }), 'recruiter');
  assert.equal(pickSearchApi({ classic: true, sales_navigator: true }), 'sales_navigator');
  assert.equal(pickSearchApi({ classic: true }), 'classic');
  assert.equal(pickSearchApi(null), 'classic');
  assert.equal(pickSearchApi(undefined), 'classic');
});

// ---------------------------------------------------------------------
// Un résultat de recherche
// ---------------------------------------------------------------------
test('toPerson : un résultat complet', async () => {
  const { toPerson } = await load();
  const p = toPerson({
    id: 'ACoAAB123', name: 'Marc Moreau', headline: 'Directeur financier', location: 'Lyon, France',
    public_profile_url: 'https://www.linkedin.com/in/marc-moreau', profile_url: 'https://www.linkedin.com/in/ACoAAB123',
    profile_picture_url: 'https://media.example/marc.jpg',
  });
  assert.equal(p.id, 'ACoAAB123');
  assert.equal(p.name, 'Marc Moreau');
  assert.equal(p.headline, 'Directeur financier');
  assert.equal(p.location, 'Lyon, France');
  assert.equal(p.profileUrl, 'https://www.linkedin.com/in/marc-moreau', 'l\'adresse publique passe avant l\'adresse technique');
  assert.equal(p.pictureUrl, 'https://media.example/marc.jpg');
  assert.equal(p.raw.id, 'ACoAAB123', 'le résultat brut est gardé');
});

test('toPerson : repli sur prénom et nom, sur provider_id, lieu en objet', async () => {
  const { toPerson } = await load();
  const p = toPerson({ provider_id: 'P9', first_name: 'Claire', last_name: 'Bernard', location: { name: 'Paris' } });
  assert.equal(p.id, 'P9');
  assert.equal(p.name, 'Claire Bernard');
  assert.equal(p.location, 'Paris');
  assert.equal(p.headline, null);
  assert.equal(p.profileUrl, null);
});

test('toPerson : sans identifiant, sans nom ou nom masqué par LinkedIn, rien à ajouter', async () => {
  const { toPerson } = await load();
  assert.equal(toPerson(null), null);
  assert.equal(toPerson('texte'), null);
  assert.equal(toPerson({ name: 'Sans Id' }), null);
  assert.equal(toPerson({ id: 'X' }), null);
  assert.equal(toPerson({ id: 'X', name: '   ' }), null);
  assert.equal(toPerson({ id: 'X', name: 'LinkedIn Member' }), null);
  assert.equal(toPerson({ id: 'X', name: 'Membre LinkedIn' }), null);
});

test('linkedinSlug : adresse de profil, sans rien qui puisse fausser un filtre', async () => {
  const { linkedinSlug } = await load();
  assert.equal(linkedinSlug('https://www.linkedin.com/in/Marc-Moreau-1A2B/'), 'marc-moreau-1a2b');
  assert.equal(linkedinSlug('linkedin.com/in/claire.bernard?utm=x'), null, 'un point dans le filtre : refusé plutôt que deviné');
  assert.equal(linkedinSlug('https://www.linkedin.com/in/jean-d%C3%A9'), 'jean-d%c3%a9');
  assert.equal(linkedinSlug('https://exemple.fr/profil'), null);
  assert.equal(linkedinSlug(null), null);
  assert.equal(linkedinSlug('https://www.linkedin.com/in/a,b'), null);
});

// ---------------------------------------------------------------------
// Refus de LinkedIn ou du quota : un message, jamais une relance
// ---------------------------------------------------------------------
test('classifyQuickFindError : un message clair par cause', async () => {
  const { classifyQuickFindError } = await load();
  assert.equal(classifyQuickFindError({ errorType: 'QUOTA' }, 429).kind, 'quota');
  assert.equal(classifyQuickFindError({ errorType: 'RATE_LIMIT' }, 429).kind, 'rate_limit');
  assert.equal(classifyQuickFindError({}, 429).kind, 'rate_limit');
  assert.equal(classifyQuickFindError({ errorType: 'ACCOUNT_NOT_LINKED' }, 403).kind, 'not_linked');
  assert.equal(classifyQuickFindError({}, 403).kind, 'not_linked');
  assert.equal(classifyQuickFindError({ errorType: 'multiple_sessions' }, 500).kind, 'session');
  assert.equal(classifyQuickFindError({ error: 'LinkedIn error: multiple_sessions' }, 500).kind, 'session');
  assert.equal(classifyQuickFindError({}, 401).kind, 'expired');
  const other = classifyQuickFindError({ error: 'Erreur de recherche' }, 502);
  assert.deepEqual(other, { kind: 'other', message: 'Erreur de recherche' });
  assert.match(classifyQuickFindError(null, undefined).message, /Réessayez/);
});

test('classifyQuickFindError : jamais le nom du fournisseur dans un message affiché', async () => {
  const { classifyQuickFindError } = await load();
  const messages = [
    classifyQuickFindError({ errorType: 'QUOTA' }, 429), classifyQuickFindError({ errorType: 'RATE_LIMIT' }, 429),
    classifyQuickFindError({ errorType: 'ACCOUNT_NOT_LINKED' }, 403), classifyQuickFindError({ errorType: 'multiple_sessions' }, 500),
    classifyQuickFindError({}, 401), classifyQuickFindError(null, undefined),
  ].map((e) => e.message);
  for (const m of messages) assert.doesNotMatch(m, /unipile|apollo|people data labs|pdl/i, m);
});

// ---------------------------------------------------------------------
// La ligne candidat
// ---------------------------------------------------------------------
test('mergeProfile : le profil complet complète la recherche sans jamais l\'effacer par du vide', async () => {
  const { mergeProfile } = await load();
  const merged = mergeProfile(
    { id: 'A', headline: 'Titre court', skills: ['Excel'], location: 'Lyon' },
    { headline: '', skills: [], location: null, summary: 'Parcours', work_experience: [{ role: 'DAF' }], skills_extra: undefined },
  );
  assert.equal(merged.headline, 'Titre court');
  assert.deepEqual(merged.skills, ['Excel']);
  assert.equal(merged.location, 'Lyon');
  assert.equal(merged.summary, 'Parcours');
  assert.deepEqual(merged.work_experience, [{ role: 'DAF' }]);
  assert.deepEqual(mergeProfile({ a: 1 }, null), { a: 1 });
});

test('buildCandidateRow : comme un résultat du Sourcing, dans une recherche, sans étape ni « discovered »', async () => {
  const { buildCandidateRow, toPerson } = await load();
  const person = toPerson({ id: 'ACoAAB123', name: 'Marc Moreau', headline: 'DAF', public_profile_url: 'https://www.linkedin.com/in/marc-moreau', profile_picture_url: 'https://media.example/m.jpg' });
  const row = buildCandidateRow({
    projectId: 'p1', organizationId: 'o1', userId: 'u1', person,
    fullProfile: { summary: 'Parcours', work_experience: [{ role: 'DAF' }], contact_info: { phones: ['+33612345678'] } },
  });
  assert.equal(row.job_id, 'project:p1');
  assert.equal(row.project_id, 'p1');
  assert.equal(row.organization_id, 'o1');
  assert.equal(row.created_by, 'u1');
  assert.equal(row.candidate_id, 'ACoAAB123', 'l\'identifiant du résultat, comme le Sourcing');
  assert.equal(row.candidate_name, 'Marc Moreau');
  assert.equal(row.candidate_headline, 'DAF');
  assert.equal(row.linkedin_profile_url, 'https://www.linkedin.com/in/marc-moreau');
  assert.equal(row.linkedin_profile_data.profile_picture_url, 'https://media.example/m.jpg', 'la photo sert au sélecteur de candidat');
  assert.equal(row.linkedin_profile_data.summary, 'Parcours');
  for (const forbidden of ['status', 'general_stage', 'pipeline_stage', 'stage_entered_at', 'decision_source']) {
    assert.ok(!(forbidden in row), `${forbidden} : posé par le déclencheur, jamais par l'écriture`);
  }
});

test('buildCandidateRow : profil complet illisible, le candidat est créé avec la recherche', async () => {
  const { buildCandidateRow, toPerson } = await load();
  const person = toPerson({ id: 'X1', name: 'Claire Bernard', headline: 'DRH' });
  const row = buildCandidateRow({ projectId: 'p1', organizationId: 'o1', userId: 'u1', person, fullProfile: null });
  assert.equal(row.candidate_headline, 'DRH');
  assert.equal(row.linkedin_profile_url, null);
  assert.equal(row.linkedin_profile_data.id, 'X1');
});

// ---------------------------------------------------------------------
// Garde-fous du compte LinkedIn
// ---------------------------------------------------------------------
test('recherche : une par clic, jamais de relance, le compte de la personne seulement', () => {
  const finder = read('src/components/calls/LinkedInCandidateFinder.tsx');
  assert.doesNotMatch(finder, /useEffect|setInterval|setTimeout|while \(|for \(/, 'rien ne lance une recherche tout seul');
  assert.match(finder, /useMyLinkedInAccountId\(\)/, 'liaison stricte par utilisateur');
  assert.doesNotMatch(finder, /useFilteredLinkedInAccounts|selectedAccount/, 'jamais le compte d\'un collègue');
  assert.match(finder, /if \(!accountId\) \{/, 'sans compte utilisable : explication, aucune recherche');
  assert.match(finder, /if \(!canSearch\) return;/);
  assert.match(finder, /onClick=\{\(\) => void search\(\)\}/, 'seul le bouton Chercher (et Entrée) lance une recherche');
  assert.match(finder, /disabled=\{addingId !== null \|\| searching\}/, 'pas de second clic pendant une opération');
  assert.doesNotMatch(finder, /unipile/i, 'le nom du fournisseur n\'est jamais affiché');

  const lib = read('src/lib/linkedinQuickFind.ts');
  assert.match(lib, /category: 'people'/);
  assert.match(lib, /limit: RESULTS_SHOWN/);
  assert.match(lib, /const RESULTS_SHOWN = 5;/);
  assert.doesNotMatch(lib, /cursor|retry|retryAfter|while \(/, 'ni pagination ni relance');
  assert.equal((lib.match(/action: 'search'/g) ?? []).length, 1, 'une seule recherche par appel de la fonction');
});

test('ajout : retrouve l\'existant avant de visiter le profil, écrit une ligne de recherche sans doublon', () => {
  const lib = read('src/lib/linkedinQuickFind.ts');
  const add = lib.slice(lib.indexOf('export async function addCandidateFromLinkedIn'));
  assert.ok(add.indexOf('findExistingCandidate(') < add.indexOf("action: 'get_profile'"), 'un candidat déjà dans l\'app ne coûte aucune visite de profil');
  assert.ok(add.indexOf("action: 'get_profile'") < add.indexOf('ensureCallsSearchProject('), 'visite du profil avant d\'écrire');
  assert.match(lib, /\.eq\('kind', 'search'\)/, 'la recherche dédiée est une recherche, pas une mission (hors plafond de missions)');
  assert.match(lib, /kind: 'search'/);
  assert.match(lib, /onConflict: 'job_id,candidate_id,created_by', ignoreDuplicates: true/);
  assert.doesNotMatch(lib, /status: 'discovered'|general_stage/, 'la vue Pipeline masque « discovered »');
  assert.match(lib, /\.eq\('organization_id', organizationId\)/, 'recherche de l\'existant dans l\'organisation seulement');
  // Un refus du profil complet n'empêche pas l'ajout.
  assert.match(lib, /partial: fullProfile === null/);
});

test('fenêtre Rattacher : le choix LinkedIn n\'apparaît que sans candidat choisi, prérempli du nom connu', () => {
  const dialog = read('src/components/calls/AttachCallDialog.tsx');
  assert.match(dialog, /\{!candidate && \(/);
  assert.match(dialog, /Pas dans l'app \? Chercher sur LinkedIn/);
  assert.match(dialog, /defaultQuery=\{group\?\.contactName \?\? ''\}/);
  assert.match(dialog, /setCandidate\(result\.candidate\)/, 'le candidat ajouté est choisi d\'office');
  assert.match(dialog, /setFinderOpen\(false\)/);
});

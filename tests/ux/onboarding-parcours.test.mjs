/**
 * Onboarding en scènes : un vrai premier recrutement (prénom et espace, poste,
 * brief lu par l'IA, mission, LinkedIn, premiers candidats, premier message),
 * sans décor ni mouvement (docs/design/01-direction.md, § 11).
 *
 * Les modules purs (src/lib/onboarding, onboardingMeta) sont transpilés en
 * mémoire par esbuild, comme dans linkedin-status.test.mjs. Les scènes et les
 * hooks sont vérifiés par inspection de source.
 *
 * Lancer : npm run test:ux
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { transformSync } from 'esbuild';

const ROOT = new URL('../../', import.meta.url);
/** Chemin disque d'un fichier du dépôt (valable sous Windows comme ailleurs). */
const pathOf = (rel) => fileURLToPath(new URL(rel, ROOT));
/** Chemin d'un fichier absolu, relatif à la racine, avec des barres obliques. */
const relOf = (abs) => relative(fileURLToPath(ROOT), abs).split(sep).join('/');
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');
/** Code sans commentaires : les commentaires citent parfois ce qu'on interdit. */
const code = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

async function load(rel) {
  const { code: js } = transformSync(read(rel), { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(js).toString('base64')}`);
}

const names = await load('src/lib/onboarding/names.ts');
const ramp = await load('src/lib/onboarding/ramp.ts');
const brief = await load('src/lib/onboarding/brief.ts');
const company = await load('src/lib/onboarding/company.ts');
const meta = await load('src/components/onboarding/onboardingMeta.ts');

function walk(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}
const onboardingFiles = [
  ...walk(pathOf('src/components/onboarding/')),
  ...walk(pathOf('src/lib/onboarding/')),
  ...walk(pathOf('src/hooks/onboarding/')),
  pathOf('src/pages/Onboarding.tsx'),
];

// ------------------------------------------------------------------ prénom
test('Prénom : les métadonnées d’abord, l’adresse e-mail seulement quand elle en porte un', () => {
  assert.equal(names.guessFirstName({ metadata: { first_name: 'camille' } }), 'Camille');
  assert.equal(names.guessFirstName({ metadata: { full_name: 'Camille Durand' } }), 'Camille');
  assert.equal(names.guessFirstName({ email: 'laurent.garilhe@konekt.fr' }), 'Laurent');
  assert.equal(names.guessFirstName({ email: 'l.garilhe@konekt.fr' }), '', 'une initiale n’est pas un prénom');
  assert.equal(names.guessFirstName({ email: 'lgarilhe@konekt.fr' }), '', 'sans séparateur, rien à deviner');
  assert.equal(names.guessFirstName({ email: 'contact.paris@konekt.fr' }), '', 'adresse générique');
  assert.equal(names.guessFirstName({ email: 'jean2.dupont@x.fr' }), '', 'chiffre dans le prénom supposé');
  assert.equal(names.guessFirstName({}), '');
});

test('Prénom : nettoyé avant d’être écrit sur le profil', () => {
  assert.equal(names.normalizeFirstName('  camille   '), 'Camille');
  assert.equal(names.normalizeFirstName('jean-pierre'), 'Jean-Pierre');
  assert.equal(names.normalizeFirstName('   '), '');
});

// ------------------------------------------------------------------ montée en charge
test('Montée en charge : les chiffres affichés suivent ceux du serveur', () => {
  assert.deepEqual(ramp.WARMUP_WEEKS.map((w) => w.dailyActions), [20, 40, 60, 80]);
  const server = read('supabase/functions/_shared/linkedin-quotas.ts');
  assert.match(server, new RegExp(`max_actions_per_day: ${ramp.WARMUP_BASE_DAILY_ACTIONS},`), 'plafond de base');
  const stages = [...server.matchAll(/\{ maxDays: (\d+), factor: ([\d.]+) \}/g)].map((m) => [Number(m[1]), Number(m[2])]);
  assert.deepEqual(stages, [[7, 0.25], [14, 0.5], [21, 0.75]], 'paliers du serveur');
  assert.deepEqual([...ramp.WARMUP_FACTORS], [...stages.map(([, f]) => f), 1]);
});

// ------------------------------------------------------------------ brief
const RESPONSE = {
  success: true,
  filters: {
    keywords: '',
    role: [{ keywords: '"Senior Backend Engineer" OR Staff Engineer OR senior backend engineer', priority: 'MUST_HAVE', scope: 'CURRENT' }],
    seniority: [],
    years_of_experience_min: 4,
    years_of_experience_max: 14,
    skills_keywords: ['Go', 'PostgreSQL', 'go', 'Kubernetes'],
    industry_keywords: [],
    location_keywords: ['Paris'],
    location_within_area: 25,
    company_keywords: [{ keywords: 'Atelier Nova', priority: 'DOESNT_HAVE', scope: 'CURRENT_OR_PAST' }],
    school: [],
    spotlight: '',
    open_to_work: false,
  },
  analysis: { search_rationale: 'Un ingénieur backend senior. '.repeat(20), suggested_title: 'Backend', job_category: 'tech', location_hint: 'Lyon' },
  suggestions: { alt_skills: ['Rust'], alt_titles: ['Platform Engineer'] },
  power_filters: { feeder_companies: ['Datadog', 'Criteo', 'datadog'] },
};

test('Brief : la réponse de l’IA devient un brief que l’on peut corriger', () => {
  const draft = brief.parseBriefResponse(RESPONSE, 'Développeur back-end');
  assert.deepEqual(draft.titles, ['Senior Backend Engineer', 'Staff Engineer'], 'intitulés séparés, sans guillemets ni doublon de casse');
  assert.deepEqual(draft.skills, ['Go', 'PostgreSQL', 'Kubernetes'], 'compétences sans doublon');
  assert.equal(draft.xpMin, 4);
  assert.equal(draft.xpMax, 14);
  assert.equal(draft.location, 'Paris', 'le lieu des filtres l’emporte sur l’indice de l’analyse');
  assert.deepEqual(draft.feeders, ['Datadog', 'Criteo']);
  assert.deepEqual(draft.altSkills, ['Rust']);
  assert.ok(draft.rationale.length <= 221 && draft.rationale.endsWith('…'), 'justification coupée proprement');
  assert.equal(draft.title, 'Développeur back-end', 'le titre tapé par l’utilisateur reste le titre du poste');
});

test('Brief : sans filtres (repli de la fonction), aucun brief inventé', () => {
  assert.equal(brief.parseBriefResponse({ success: true, fallback: true, error: 'x' }, 'Poste'), null);
  assert.equal(brief.parseBriefResponse({ success: false }, 'Poste'), null);
  assert.equal(brief.parseBriefResponse(null, 'Poste'), null);
  const empty = brief.emptyBrief('Poste');
  assert.deepEqual(empty.skills, []);
  assert.equal(empty.filters, null);
});

test('Brief : les corrections se retrouvent dans les filtres enregistrés sur la mission', () => {
  const draft = brief.parseBriefResponse(RESPONSE, 'Développeur back-end');
  const edited = { ...draft, skills: ['Go', 'Terraform'], titles: ['Platform Engineer'], xpMin: 6, xpMax: 9, location: '' };
  const filters = brief.briefToFilters(edited);
  assert.deepEqual(filters.skills_keywords, ['Go', 'Terraform']);
  assert.equal(filters.role[0].keywords, 'Platform Engineer');
  assert.equal(filters.years_of_experience_min, 6);
  assert.equal(filters.years_of_experience_max, 9);
  assert.deepEqual(filters.location_keywords, []);
  assert.deepEqual(filters.company_keywords, RESPONSE.filters.company_keywords, 'le client exclu des expériences est conservé');
  assert.equal(brief.briefToFilters({ ...draft, titles: ['A', 'B'] }).role[0].keywords, 'A OR B');
});

test('Brief : le brief structuré de la mission suit la forme du parcours « brief » de la création', () => {
  const draft = brief.parseBriefResponse(RESPONSE, 'Développeur back-end');
  const many = { ...draft, skills: ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h'] };
  const details = brief.briefToJobDetails(many, { client: 'Atelier Nova', sector: 'Logiciels', website: 'https://nova.fr', logoUrl: null, briefText: 'Développeur back-end chez Atelier Nova' });
  assert.equal(details.title, 'Développeur back-end');
  assert.equal(details.brief_source, 'ai_structured');
  assert.equal(details.raw_brief, 'Développeur back-end chez Atelier Nova');
  assert.deepEqual(details.skills_must_have, ['a', 'b', 'c', 'd', 'e', 'f']);
  assert.deepEqual(details.skills_should_have, ['g', 'h']);
  assert.deepEqual(details.client, { name: 'Atelier Nova', sector: 'Logiciels', website: 'https://nova.fr' });
  assert.equal(details.experience_min, 4);
  assert.equal(brief.briefToJobDetails(draft, { client: null, sector: null, website: null, logoUrl: null, briefText: 'x' }).client, undefined);
});

test('Brief : l’expérience se lit à voix haute', () => {
  assert.equal(brief.experienceLabel(5, 10), '5 à 10 ans');
  assert.equal(brief.experienceLabel(1, 1), '1 an');
  assert.equal(brief.experienceLabel(5, null), '5 ans et plus');
  assert.equal(brief.experienceLabel(null, 3), 'jusqu\'à 3 ans');
  assert.equal(brief.experienceLabel(null, null), 'Non précisée');
});

// ------------------------------------------------------------------ société
test('Société : postes dédoublonnés, fiche sans fournisseur, contexte sans invention', () => {
  const roles = company.dedupeRoles([
    { title: 'Développeur back-end (H/F)', location: 'Paris' },
    { title: 'Développeur   back-end (h/f)', location: 'Lyon' },
    { title: 'Product Designer', location: null },
  ]);
  assert.deepEqual(roles.map((r) => r.title), ['Développeur back-end (H/F)', 'Product Designer']);
  const parsed = company.parseCompany({ name: 'Nova', domain: 'nova.fr', industry: 'Logiciels', size: '120', openRoles: [{ title: 'Data Engineer', source: 'Apollo' }] }, 'nova');
  assert.equal(parsed.websiteUrl, 'https://nova.fr');
  assert.deepEqual(parsed.openRoles, [{ title: 'Data Engineer', location: null }], 'la source d’un poste n’est pas gardée');
  assert.equal(company.parseCompany(null, 'Atelier').name, 'Atelier');
  assert.equal(company.companyContext(null), '');
  assert.match(company.companyContext(parsed), /Nova : Logiciels, 120 salariés\./);
});

// ------------------------------------------------------------------ parcours
test('Parcours : quatre étapes, une fin, et un raccourci quand LinkedIn est remis à plus tard', () => {
  assert.deepEqual(meta.ACTS.map((a) => a.id), ['you', 'role', 'linkedin', 'results']);
  const full = meta.buildFlow({ linkedinSkipped: false });
  assert.deepEqual(full, ['you', 'role', 'brief', 'linkedin', 'candidates', 'message', 'finale']);
  const short = meta.buildFlow({ linkedinSkipped: true });
  assert.deepEqual(short, ['you', 'role', 'brief', 'linkedin', 'finale']);
  for (const scene of full) assert.ok(meta.actIndexOf(scene) >= 0);
  assert.equal(meta.actIndexOf('finale'), meta.ACTS.length, 'à la fin, toutes les étapes sont cochées');
  assert.equal(meta.progressOf(full, 'finale'), 100);
  assert.ok(meta.progressOf(full, 'role') < meta.progressOf(full, 'brief'));
  assert.ok(meta.remainingMinutes(full, 'you') >= 3 && meta.remainingMinutes(full, 'you') <= 5);
});

test('Reprise : une scène d’un ancien parcours n’existe plus, on repart du début', () => {
  for (const scene of meta.buildFlow({ linkedinSkipped: false })) assert.ok(meta.isSceneKey(scene));
  for (const old of ['hello', 'profile', 'structure', 'ghost', null, 3]) assert.equal(meta.isSceneKey(old), false);
  const storage = read('src/components/onboarding/onboardingStorage.ts');
  assert.match(storage, /konekt_onboarding_progress_v8/);
  assert.match(storage, /LEGACY_STORAGE_KEYS = \[[^\]]*progress_v7/s, 'la progression de l’ancien parcours est effacée');
  assert.match(storage, /!isSceneKey\(parsed\.scene\)/);
});

test('Première scène : prénom, type d’espace et nom en un seul écran, l’espace créé à la validation', () => {
  const scene = code('src/components/onboarding/scenes/SceneYou.tsx');
  assert.match(scene, /await onSaveFirstName\(\);[\s\S]*createOrganization\(/, 'le prénom est écrit avant la création');
  assert.match(scene, /confirmSecond: confirmSecond \|\| allowSecondWorkspace/);
  assert.match(scene, /role="radiogroup"/);
  assert.match(scene, /disabled=\{!!createdOrgId && !picked\}/, 'un espace créé garde son type');
  for (const gone of ['SceneHello', 'SceneProfile', 'SceneStructure']) {
    assert.throws(() => read(`src/components/onboarding/scenes/${gone}.tsx`), `${gone} est fusionnée dans SceneYou`);
  }
});

test('Fin : quatre fonctions en ligne teasées, aucune annonce de ce qui n’existe pas encore', () => {
  const finale = read('src/components/onboarding/scenes/SceneFinale.tsx');
  assert.equal((finale.match(/key: '/g) ?? []).length, 4);
  for (const title of ["Assistant d'entretien en direct", 'Appels transcrits et analysés', 'Une adresse web suffit', 'La carte « Maintenant »']) {
    assert.ok(finale.includes(title), title);
  }
  assert.doesNotMatch(finale, /bientôt|prochainement/i);
  assert.match(finale, /Ouvrir ma mission/);
});

// ------------------------------------------------------------------ garde-fous de source
test('Fiche société : en arrière-plan, sans forcer le rafraîchissement', () => {
  const hook = code('src/hooks/onboarding/useCompanyLookup.ts');
  assert.match(hook, /invokeEdgeFunction[^)]*'enrich-company'/);
  assert.doesNotMatch(hook, /force_refresh/, 'force_refresh rend chaque recherche froide (15 à 40 s) et coûteuse');
  assert.match(hook, /runRef\.current/, 'une réponse tardive ne remplace pas la plus récente');
  const onboarding = code('src/pages/Onboarding.tsx');
  assert.doesNotMatch(onboarding, /await lookup/, 'la fiche n’est jamais attendue par une scène');
});

test('LinkedIn : même onglet, retour lu, liaison attendue côté serveur', () => {
  const lib = code('src/lib/onboarding/linkedin.ts');
  assert.match(lib, /success_redirect_url: linkedInReturnUrl\('ok'\)/);
  assert.match(lib, /failure_redirect_url: linkedInReturnUrl\('ko'\)/);
  const scene = code('src/components/onboarding/scenes/SceneLinkedIn.tsx');
  assert.match(scene, /window\.location\.assign\(url\)/, 'un seul parcours en cours : pas de second onglet');
  assert.doesNotMatch(scene, /window\.open/);
  assert.match(scene, /POLL_FOR_MS/, 'interrogation bornée dans le temps');
  assert.match(code('src/pages/Onboarding.tsx'), /get\('li'\)/);
  // L'état « connecté » vient de la liste des comptes et de leur statut, pas d'un simple compte listé.
  assert.match(lib, /classifyLinkedInStatus\([^)]*\) === 'connected'/);
});

test('Première recherche : une seule page, un seul appel, filtres relus sur la mission', () => {
  const search = code('src/lib/onboarding/search.ts');
  assert.equal((search.match(/invokeUnipile\(/g) ?? []).length, 1, 'un seul appel à la recherche (chaque appel consomme le quota du compte)');
  assert.match(search, /limit: input\.limit \?\? 10/);
  assert.match(search, /buildSearchParams\(/);
  assert.match(search, /mapGeneratedFilters\(/);
  const hook = code('src/hooks/onboarding/useFirstSearch.ts');
  assert.match(hook, /\.from\('sourcing_projects'\)[\s\S]*\.eq\('id', missionId\)/);
  assert.match(hook, /id: `project:\$\{missionId\}`/, 'le scoring exige une mission de l’organisation');
  // Sur Classic et Sales Navigator, le filtre de poste est ignoré : le poste passe dans les mots-clés.
  assert.match(search, /license !== 'recruiter'/);
  // Le scoring ne bloque jamais l’aperçu.
  assert.match(search, /if \(error\) \{[\s\S]*return \[\];/);
});

test('Mission : créée avec l’organisation de l’utilisateur, brief structuré et filtres IA', () => {
  const mission = code('src/lib/onboarding/mission.ts');
  const insert = mission.slice(mission.indexOf('.insert('), mission.indexOf('.select(\'id\')'));
  for (const field of ['organization_id: orgId', 'created_by: userId', 'filters_snapshot:', 'job_details:', 'client_name:']) {
    assert.ok(insert.includes(field), `sourcing_projects.insert : ${field}`);
  }
  assert.match(mission, /rpc\('replace_process_steps'/);
  assert.match(mission, /processApplied/);
  const filtersSnapshot = mission.slice(mission.indexOf('const filtersSnapshot'), mission.indexOf('const { data, error }'));
  assert.match(filtersSnapshot, /briefToFilters\(draft\)/);
  assert.match(filtersSnapshot, /source: 'onboarding'/);
});

test('Profil : le prénom et le ton s’écrivent là où le produit les lit', () => {
  const profile = code('src/lib/onboarding/profile.ts');
  assert.match(profile, /display_name: name/);
  assert.match(profile, /auth\.updateUser\(\{ data: \{ first_name: name \} \}\)/);
  const tone = profile.slice(profile.indexOf('saveWritingTone'));
  assert.match(tone, /\.select\('ai_context'\)/, 'le contexte IA existant est lu puis fusionné, jamais écrasé');
  assert.match(tone, /\{ \.\.\.current, tone \}/);
});

test('Message : rien n’est envoyé, le ton passe par le serveur', () => {
  const outreach = code('src/lib/onboarding/outreach.ts');
  assert.match(outreach, /tone: input\.tone === 'tu' \? 'casual' : 'professional'/);
  assert.doesNotMatch(outreach, /accountId|profileId/, 'sans compte ni identifiant de profil, la fonction n’appelle pas LinkedIn');
  assert.match(outreach, /currentActionType: 'message'/);
  const scene = read('src/components/onboarding/scenes/SceneMessage.tsx');
  assert.match(scene, /rien n'est envoyé/i);
});

test('Champ de saisie : un prénom proposé après le focus se remplace en tapant', () => {
  // Le prénom deviné arrive dans un effet, après l'autofocus : sélectionner au focus seulement
  // porterait sur un champ vide, et la frappe s'ajouterait (« LaurentLaurent »).
  const src = read('src/components/onboarding/parts/FillIn.tsx');
  assert.match(src, /typedRef/, 'la frappe est suivie pour ne plus resélectionner');
  assert.match(src, /useEffect\(\(\) => \{[^}]*\.select\(\)/s, 'la sélection est reposée quand la valeur arrive');
});

test('Sobriété : aucun mouvement, aucun bureau, aucune lampe qui suit le pointeur', () => {
  // Décision du propriétaire du 06/10/2026 : l'exception d'animation du 29/09 est retirée.
  assert.throws(() => readdirSync(pathOf('src/components/onboarding/stage/')), 'le dossier stage/ (bureau, ressorts, confettis) n’existe plus');
  for (const file of onboardingFiles) {
    const src = code(relOf(file));
    assert.doesNotMatch(src, /framer-motion/, `${file} : plus d'animation`);
    assert.doesNotMatch(src, /useReducedMotion|AnimatePresence|SPRING_|EASE_OUT/, `${file} : plus de ressort`);
  }
  const css = read('src/index.css');
  assert.doesNotMatch(css, /stage-open/);
  assert.doesNotMatch(css, /--paper/);
});

test('Marque : aucun fournisseur dans les textes de l’onboarding', () => {
  const vendors = /Unipile|Apollo|Anthropic|Claude|Clearbit|Perplexity|Firecrawl|Coresignal|BetterContact|OpenAI|Resend/;
  for (const file of onboardingFiles) {
    const src = readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
    // Les chaînes visibles : JSX et littéraux. Les noms de fonctions edge ('enrich-company') n'en font pas partie.
    const visible = [...src.matchAll(/>([^<>{}]*[A-Za-zÀ-ÿ][^<>{}]*)</g)].map((m) => m[1]).concat([...src.matchAll(/(?:toast\.\w+|title|label|placeholder|aria-label)[=(]\s*["'`]([^"'`]+)["'`]/g)].map((m) => m[1]));
    for (const text of visible) assert.doesNotMatch(text, vendors, `${file} : « ${text.trim()} »`);
  }
});

test('Texte : vouvoiement, pas de tiret long, pas d’emoji dans l’interface', () => {
  for (const file of onboardingFiles) {
    const src = code(relOf(file));
    assert.doesNotMatch(src, /—/, `${file} : tiret long`);
    assert.doesNotMatch(src, /\p{Extended_Pictographic}/u, `${file} : emoji`);
  }
});

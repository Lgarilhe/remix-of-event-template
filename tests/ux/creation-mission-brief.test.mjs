/**
 * Brief IA (fenêtre de création de mission) : design simplifié et analyse par
 * Sonnet 5.5 (docs/design/06-simplicite.md).
 *
 *  - aides pures (briefAnalysis.ts) : intitulés booléens en pastilles, lignes du
 *    panneau, job_details (salaire plausible seulement), messages d'erreur ;
 *  - rendu statique du panneau de droite dans ses quatre états ;
 *  - gardes sur le source : primitives de l'interface, vouvoiement, ni emoji ni
 *    tiret long ni dégradé, une seule croix, brouillon conservé au démontage ;
 *  - gardes serveur : action brief_analysis en Sonnet 5.5 sans toucher
 *    filter_generation, lecture du bloc texte, champs du brief renvoyés, fiche
 *    lue jusqu'à la même limite que le navigateur.
 *
 * Lancer : node --test tests/ux/creation-mission-brief.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
/** Source sans commentaires : ils citent souvent ce que la règle bannit. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const DIR = 'src/components/missions/v2';
const { outputFiles } = await build({
  stdin: {
    contents: [
      `export * from './${DIR}/briefAnalysis';`,
      `export { BriefAnalysisPanel } from './${DIR}/BriefAnalysisPanel';`,
      "export { createElement } from 'react';",
      "export { renderToStaticMarkup } from 'react-dom/server.browser';",
    ].join('\n'),
    resolveDir: ROOT,
    loader: 'ts',
  },
  bundle: true,
  write: false,
  format: 'esm',
  platform: 'node',
  logLevel: 'silent',
  loader: { '.webp': 'empty' },
  tsconfig: join(ROOT, 'tsconfig.app.json'),
  define: { 'process.env.NODE_ENV': '"production"' },
});
const kit = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
const renderPanel = (props) =>
  kit.renderToStaticMarkup(
    kit.createElement(kit.BriefAnalysisPanel, {
      analyzing: false,
      hasAnalysis: false,
      error: null,
      stale: false,
      fields: [],
      missing: [],
      ...props,
    }),
  );

const ANALYSIS = {
  suggested_title: 'Expert Sécurité Opérationnelle, Numspot',
  role_keywords: ['"Security Engineer" OR "Ingénieur Sécurité" OR (Expert Sécurité) OR "Security Engineer"'],
  skills_to_search: ['Threat hunting', 'SIEM'],
  location_hint: 'Courbevoie',
  years_experience_min: 4,
  years_experience_max: 10,
  experience_rationale: 'La fiche demande 4 à 10 ans.',
  job_category: 'tech',
  detected_company: 'Numspot',
  skills_must_have: ['Gestion des incidents', 'Threat hunting'],
  contract_type: 'cdi',
  remote_policy: 'hybrid',
  remote_days: 2,
  salary_min: null,
  salary_max: null,
  start_date: null,
};

// ─── Aides pures ──────────────────────────────────────────────────────────

test('intitulés : un groupe booléen devient une liste, sans guillemets ni doublons', () => {
  assert.deepEqual(kit.splitBooleanTitles(ANALYSIS.role_keywords), [
    'Security Engineer',
    'Ingénieur Sécurité',
    'Expert Sécurité',
  ]);
  assert.deepEqual(kit.splitBooleanTitles(['Dev', 'dev OR Ops']), ['Dev', 'dev', 'Ops']);
  assert.deepEqual(kit.splitBooleanTitles(undefined), []);
  assert.deepEqual(kit.splitBooleanTitles(['']), []);
});

test('panneau : une ligne par information, intitulés et compétences en pastilles', () => {
  const { fields, missing } = kit.buildExtractedFields(ANALYSIS, '');
  assert.deepEqual(fields.map((f) => f.id), [
    'title', 'client', 'location', 'experience', 'contract', 'remote', 'skills', 'roles',
  ]);
  const byId = Object.fromEntries(fields.map((f) => [f.id, f]));
  assert.equal(byId.experience.value, '4 à 10 ans');
  assert.equal(byId.experience.hint, 'La fiche demande 4 à 10 ans.');
  assert.equal(byId.contract.value, 'CDI');
  assert.equal(byId.remote.value, 'Hybride, 2 j de télétravail par semaine');
  assert.deepEqual(byId.skills.chips, ['Gestion des incidents', 'Threat hunting']);
  assert.deepEqual(byId.roles.chips, ['Security Engineer', 'Ingénieur Sécurité', 'Expert Sécurité']);
  // Ce que la fiche ne dit pas se lit à part.
  assert.deepEqual(missing, ['rémunération', 'date de démarrage']);
  // Le « domaine » n'est enregistré nulle part : pas de ligne qui ne sert à rien.
  assert.ok(!fields.some((f) => f.id === 'domain'));
});

test('panneau : le client saisi par l\'utilisateur n\'est pas répété, celui de la fiche oui', () => {
  const typed = kit.buildExtractedFields(ANALYSIS, 'Numspot').fields;
  assert.ok(!typed.some((f) => f.id === 'client'));
  const detected = kit.buildExtractedFields(ANALYSIS, '  ').fields;
  assert.equal(detected.find((f) => f.id === 'client').value, 'Numspot');
});

test('panneau : sans compétences indispensables, les compétences de recherche prennent le relais', () => {
  const { fields } = kit.buildExtractedFields({ ...ANALYSIS, skills_must_have: [] }, '');
  assert.deepEqual(fields.find((f) => f.id === 'skills').chips, ['Threat hunting', 'SIEM']);
});

test('rémunération : seule une valeur annuelle plausible est affichée et enregistrée', () => {
  assert.equal(kit.salaryLabel({ salary_min: 600, salary_max: 800 }), null, 'un taux journalier n\'est pas un salaire annuel');
  assert.equal(kit.salaryLabel({ salary_min: 60000, salary_max: 75000 }), '60 k€ à 75 k€ brut par an');
  assert.equal(kit.salaryLabel({ salary_min: 60000 }), 'À partir de 60 k€ brut par an');
  assert.equal(kit.salaryLabel({ salary_max: 75000 }), "Jusqu'à 75 k€ brut par an");
  const low = kit.buildJobDetails({ salary_min: 600, salary_max: 800 }, { briefName: '', briefText: 'Fiche', clientName: '' });
  assert.ok(!('salary_min' in low) && !('salary_type' in low));
  const ok = kit.buildJobDetails({ salary_min: 60000, salary_max: 75000 }, { briefName: '', briefText: 'Fiche', clientName: '' });
  assert.deepEqual([ok.salary_min, ok.salary_max, ok.salary_currency, ok.salary_type], [60000, 75000, 'EUR', 'annual']);
});

test('job_details : ce que l\'analyse extrait alimente le brief, avec des repli sûrs', () => {
  const jd = kit.buildJobDetails(
    {
      ...ANALYSIS,
      mission_description: 'Renforcer la sécurité du cloud.',
      context: 'Croissance de l\'équipe',
      seniority: 'Senior',
      skills_should_have: ['Python'],
      evaluation_criteria: ['Réponse à incident'],
    },
    { briefName: 'Ma mission', briefText: '  Fiche entière.  ', clientName: '' },
  );
  assert.equal(jd.title, 'Expert Sécurité Opérationnelle, Numspot', 'le titre de l\'analyse passe avant le nom saisi (comportement inchangé)');
  assert.equal(jd.mission_description, 'Renforcer la sécurité du cloud.');
  assert.equal(jd.raw_brief, 'Fiche entière.');
  assert.deepEqual(jd.client, { name: 'Numspot' }, 'le client trouvé dans la fiche, faute de saisie');
  assert.deepEqual(jd.skills_must_have, ['Gestion des incidents', 'Threat hunting']);
  assert.deepEqual(jd.evaluation_criteria, [
    { id: 'auto-1', label: 'Réponse à incident', description: '', category: 'technical', weight: 2 },
  ]);
  assert.deepEqual([jd.remote_policy, jd.remote_days, jd.contract_type, jd.experience_min, jd.experience_max], ['hybrid', 2, 'cdi', 4, 10]);

  // Sans description ni compétences indispensables : début de la fiche et compétences de recherche.
  const bare = kit.buildJobDetails(
    { skills_to_search: ['A', 'B'] },
    { briefName: 'Nom saisi', briefText: 'x'.repeat(900), clientName: 'Client saisi' },
  );
  assert.equal(bare.title, 'Nom saisi');
  assert.equal(bare.mission_description.length, 600);
  assert.deepEqual(bare.skills_must_have, ['A', 'B']);
  assert.deepEqual(bare.client, { name: 'Client saisi' });
  assert.ok(!('salary_min' in bare) && !('context' in bare));
});

test('nom de repli : virgule, jamais de tiret long', () => {
  assert.equal(kit.suggestedMissionName({ role_keywords: ['"SRE" OR "Platform Engineer"'], location_hint: 'Paris' }), 'SRE, Paris');
  assert.equal(kit.suggestedMissionName({ role_keywords: ['"SRE"'] }), 'SRE');
  assert.equal(kit.suggestedMissionName({}), 'Mission');
});

test('erreur d\'analyse : jamais le message technique, sauf limite de débit et surcharge', () => {
  const technical = Object.assign(new Error('AI_ERROR_400 invalid_request_error: output_config'), { status: 500 });
  const msg = kit.analysisErrorMessage(technical);
  assert.doesNotMatch(msg, /AI_ERROR|invalid_request|output_config/);
  assert.match(msg, /Réessayez/);
  assert.match(msg, /sans analyse/);
  const limited = Object.assign(new Error('Trop de requêtes, réessayez dans quelques secondes'), { status: 429 });
  assert.equal(kit.analysisErrorMessage(limited), 'Trop de requêtes, réessayez dans quelques secondes');
  const overloaded = Object.assign(new Error('Service IA temporairement surchargé, réessayez dans 30 secondes'), { status: 503 });
  assert.equal(kit.analysisErrorMessage(overloaded), 'Service IA temporairement surchargé, réessayez dans 30 secondes');
  assert.match(kit.analysisErrorMessage(null), /Réessayez/);
});

// ─── Panneau de droite, rendu statique ──────────────────────────────────

test('panneau, en attente : une illustration et une phrase, pas de liste', () => {
  const html = renderPanel({});
  assert.match(html, /L(&#x27;|')analyse apparaîtra ici/);
  assert.doesNotMatch(html, /<dl/);
  assert.doesNotMatch(html, /Réessayer/);
});

test('panneau, analyse en cours : squelette, état annoncé, pas de résultat', () => {
  const html = renderPanel({ analyzing: true });
  assert.match(html, /aria-busy="true"/);
  assert.match(html, /Analyse en cours/);
  assert.match(html, /animate-pulse/);
  assert.doesNotMatch(html, /<dl/);
});

test('panneau, erreur : ce qui s\'est passé et « Réessayer », jamais un état vide', () => {
  const html = renderPanel({ error: "Le service n'a pas répondu.", onRetry: () => {} });
  assert.match(html, /L&#x27;analyse n&#x27;a pas abouti|L'analyse n'a pas abouti/);
  assert.match(html, /Réessayer/);
  assert.doesNotMatch(html, /apparaîtra ici/);
  // Fiche trop courte : pas de bouton qui ne mènerait nulle part.
  assert.doesNotMatch(renderPanel({ error: 'Erreur', onRetry: undefined }), /Réessayer/);
});

test('panneau, résultat : liste de définitions, pastilles, informations manquantes, tout reste modifiable', () => {
  const { fields, missing } = kit.buildExtractedFields(ANALYSIS, '');
  const html = renderPanel({ hasAnalysis: true, fields, missing });
  assert.match(html, /<dl/);
  assert.match(html, /Ce que l(&#x27;|')assistant a retenu/);
  assert.equal((html.match(/<dt/g) || []).length, fields.length);
  assert.match(html, /<li><div[^>]*>Threat hunting<\/div><\/li>/, 'compétence en pastille');
  assert.match(html, /Non précisé dans la fiche : rémunération, date de démarrage\./);
  assert.match(html, /Tout reste modifiable dans le brief de la mission\./);
  assert.doesNotMatch(html, /fiche a changé/, 'pas de bandeau tant que la fiche n\'a pas changé');
});

test('panneau, fiche modifiée depuis l\'analyse : bandeau en tête, avant la liste, avec « Relancer »', () => {
  const { fields, missing } = kit.buildExtractedFields(ANALYSIS, '');
  const html = renderPanel({ hasAnalysis: true, stale: true, fields, missing, onRetry: () => {} });
  const banner = html.indexOf('La fiche a changé depuis');
  assert.ok(banner > -1 && banner < html.indexOf('<dl'), 'bandeau avant la liste, visible sans défiler');
  assert.match(html, /Relancer l(&#x27;|')analyse/);
});

// ─── Gardes sur le source ──────────────────────────────────────────────

const dialog = read(`${DIR}/CreateMissionV2.tsx`);
const panel = read(`${DIR}/BriefAnalysisPanel.tsx`);
const helpers = read(`${DIR}/briefAnalysis.ts`);
const FILES = { 'CreateMissionV2.tsx': dialog, 'BriefAnalysisPanel.tsx': panel, 'briefAnalysis.ts': helpers };

test('design : ni emoji, ni tiret long, ni dégradé, ni couleur en dur dans les trois fichiers', () => {
  for (const [name, src] of Object.entries(FILES)) {
    const c = code(src);
    assert.doesNotMatch(c, /\p{Extended_Pictographic}/u, `${name} : emoji`);
    assert.doesNotMatch(c, /—/, `${name} : tiret long`);
    assert.doesNotMatch(c, /konekt-skalr|konekt-shine|konekt-glow|gradient|shimmer/, `${name} : effet décoratif`);
    assert.doesNotMatch(c, /font-display|font-editorial|font-\[/, `${name} : police hors système`);
    assert.doesNotMatch(c, /hsl\(\d|#[0-9a-f]{3,6}\b|rgb\(/i, `${name} : couleur en dur`);
    assert.doesNotMatch(c, /text-\[\d+px\]|rounded-(2xl|3xl|none)\b/, `${name} : taille ou rayon hors système`);
    assert.doesNotMatch(c, /text-(muted-foreground|foreground)\/\d+/, `${name} : texte atténué par opacité`);
  }
});

test('design : primitives de l\'interface, pas de bouton ni de champ écrit à la main', () => {
  for (const [name, src] of Object.entries(FILES)) {
    assert.doesNotMatch(code(src), /<(button|input|textarea|label|select)\b/, `${name} : balise native`);
  }
  assert.match(dialog, /from '@\/components\/ui\/button'/);
  assert.match(dialog, /from '@\/components\/ui\/input'/);
  assert.match(dialog, /from '@\/components\/ui\/textarea'/);
  assert.match(dialog, /variant="primary"/);
});

test('design : une seule croix de fermeture, celle du dialogue', () => {
  assert.doesNotMatch(code(dialog), /aria-label="Fermer"/);
  assert.doesNotMatch(code(dialog), /\bX\b[,\s]*[}\n]/, 'pas d\'icône X importée pour une seconde croix');
  assert.match(dialog, /pr-14/, 'l\'en-tête laisse la place à la croix du dialogue');
});

test('texte : vouvoiement, pas de tutoiement dans les chaînes affichées', () => {
  for (const [name, src] of Object.entries(FILES)) {
    const c = code(src);
    // Bornes sur les lettres Unicode : \b ne voit que l'ASCII et prendrait « prêtes » pour un « tes » isolé.
    assert.doesNotMatch(c, /(?<!\p{L})(tu|toi|ton|ta|tes|tiens)(?!\p{L})/iu, `${name} : tutoiement`);
    assert.doesNotMatch(c, /['"`][^'"`\n]*\b(Colle|Remplis|Vérifie|Saisis|Utilise|Choisis|Complète)\b[^'"`\n]*['"`]/, `${name} : impératif au tutoiement`);
  }
  assert.match(dialog, /Collez la fiche de poste/);
  assert.match(dialog, /Comment souhaitez-vous décrire la mission/);
});

test('texte : aucun nom de fournisseur ni de modèle visible', () => {
  for (const [name, src] of Object.entries(FILES)) {
    const strings = [...code(src).matchAll(/(['"`])((?:\\.|(?!\1).)*)\1/g)].map((m) => m[2]).join('\n');
    assert.doesNotMatch(strings, /Sonnet|Claude|Anthropic|Unipile|Apollo|People Data Labs/i, `${name} : nom de fournisseur ou de modèle`);
  }
});

test('analyse : action brief_analysis par invokeWithCredits (pré-autorisation des crédits, modèle du catalogue)', () => {
  const c = code(dialog);
  assert.match(c, /invokeWithCredits<AnalyzeResponse>\(\s*'generate-search-filters',\s*'brief_analysis'/);
  assert.doesNotMatch(c, /invokeEdgeFunction\(/, 'plus d\'appel sans action ni crédits');
  assert.doesNotMatch(c, /modelOverride/, 'le modèle vient du catalogue, pas de l\'écran');
  // Un refus de crédits ne s'affiche qu'une fois : invokeWithCredits montre déjà le toast.
  assert.match(c, /isInsufficientCreditsError\(error\)/);
  // Une réponse dégradée n'est jamais présentée comme un résultat.
  assert.match(c, /data\.degraded/);
});

test('analyse : la fiche part entière, plafonnée à la limite lue par le serveur', () => {
  const server = read('supabase/functions/generate-search-filters/index.ts');
  const front = Number(/export const MAX_BRIEF_CHARS = (\d+);/.exec(helpers)?.[1]);
  const back = Number(/const MAX_DESCRIPTION_CHARS = (\d+);/.exec(server)?.[1]);
  assert.ok(front > 800, 'le navigateur ne retombe pas à 800 caractères');
  assert.equal(front, back, 'même limite des deux côtés, sinon du texte est coupé sans le dire');
  assert.doesNotMatch(server, /description\.substring\(0, 800\)/);
  assert.match(code(dialog), /briefText\.trim\(\)\.slice\(0, MAX_BRIEF_CHARS\)/);
});

test('brouillon : conservé au démontage (les parents retirent la fenêtre), jamais effacé par le double montage', () => {
  const c = code(dialog);
  // Garde historique (lot 1) : les formulations restent.
  assert.match(c, /saveEditorDraft\(\s*MISSION_DRAFT_KEY/);
  assert.match(c, /loadEditorDraft<MissionDraft>\(MISSION_DRAFT_KEY\)/);
  assert.match(c, /creationReussieRef\.current = true;/);
  assert.match(c, /const aConserver = aDuTexte && !creationReussieRef\.current;/);
  // Le démontage enregistre, et seulement s'il y a quelque chose à garder.
  assert.match(c, /useEffect\(\(\) => \(\) => \{\s*const brouillon = brouillonRef\.current\(\);\s*if \(brouillon\) persistDraft\(brouillon\);/);
  // Une mission créée efface le brouillon : l'enregistrement au fil de la saisie en a posé un.
  assert.equal((c.match(/clearEditorDraft\(MISSION_DRAFT_KEY\)/g) || []).length, 2, 'création par le brief et création manuelle');
  // L'ancien effet de fermeture (jamais exécuté, puis effaçant ce qu'il venait d'écrire) a disparu.
  assert.doesNotMatch(c, /if \(isOpen\) return;\s*const t = setTimeout\(\(\) => \{\s*const aDuTexte/);
});

test('analyse périmée : fiche ou client modifiés après l\'analyse, le résultat le dit', () => {
  const c = code(dialog);
  assert.match(c, /const isStale = analysis !== null && analysedKey !== analysisKey;/);
  assert.match(c, /stale=\{isStale\}/);
  // Le nom proposé par l'IA se met à jour à la relance, sans écraser une saisie de l'utilisateur.
  assert.match(c, /if \(!userNamedRef\.current\) \{\s*setBriefName\(/);
});

test('raccourci : Ctrl ou Cmd + Entrée lance l\'action principale de l\'écran', () => {
  const c = code(dialog);
  assert.match(c, /e\.key !== 'Enter' \|\| !\(e\.metaKey \|\| e\.ctrlKey\)/);
  assert.match(c, /onKeyDown=\{handleShortcut\}/);
});

// ─── Gardes serveur ─────────────────────────────────────────────────────

test('catalogues : brief_analysis en Sonnet 5.5 des deux côtés, filter_generation inchangé', () => {
  const server = read('supabase/functions/_shared/ai-config.ts');
  const client = read('src/types/aiCredits.ts');
  const serverBlock = (id) => new RegExp(`\\n  ${id}: \\{[\\s\\S]*?\\n  \\},`).exec(server)?.[0] ?? '';
  const clientLine = (id) => new RegExp(`\\n  ${id}: \\{[^\\n]*\\},`).exec(client)?.[0] ?? '';

  assert.match(serverBlock('brief_analysis'), /autoDefault: "claude-sonnet-5-5"/);
  assert.match(serverBlock('brief_analysis'), /routingTier: "default"/);
  assert.match(clientLine('brief_analysis'), /autoDefault: "claude-sonnet-5-5"/);
  assert.match(clientLine('brief_analysis'), /label: "Analyse d'une fiche de poste"/);

  // filter_generation est partagée avec nl-filter-edit et d'autres appelants qui lisent
  // content[0].text : lui donner un modèle 5.5 par défaut les casserait (bloc "thinking" en premier).
  assert.ok(serverBlock('filter_generation'), 'filter_generation existe côté serveur');
  assert.doesNotMatch(serverBlock('filter_generation'), /autoDefault/);
  assert.doesNotMatch(clientLine('filter_generation'), /autoDefault/);
});

test('edge function : aides génération 5 partagées (bloc texte, effort, marge de réflexion), 4096 jetons de contenu', () => {
  const server = read('supabase/functions/generate-search-filters/index.ts');
  const c = code(server);
  // Les aides vivent dans _shared/gen5-models.ts (une seule définition) : plus de copie locale.
  assert.match(c, /import \{[^}]*gen5Params[^}]*\} from "\.\.\/_shared\/gen5-models\.ts";/);
  assert.doesNotMatch(c, /function isGen5Model|function responseText|GEN5_EFFORT/, 'pas de copie locale des aides');
  assert.match(c, /const content = textFromContent\(aiResult\.content\);/);
  assert.doesNotMatch(c, /aiResult\.content\?\.\[0\]/, 'content[0] est le bloc thinking avec Sonnet 5.5');
  assert.match(c, /\.\.\.gen5Params\(resolvedModel\)/);
  assert.doesNotMatch(c, /temperature/, 'les modèles 5.5 refusent la température (400)');
  assert.match(c, /max_tokens: withThinkingHeadroom\(resolvedModel, 4096\)/);
  // Délai porté à 55 s pour les modèles 5.5, qui réfléchissent avant de répondre.
  assert.match(c, /isGen5Model\(resolvedModel\) \? 55000 : 45000/);
});

test('edge function : le brief structuré demandé au modèle est renvoyé, et une réponse illisible est signalée', () => {
  const server = read('supabase/functions/generate-search-filters/index.ts');
  const analysis = /analysis: \{([\s\S]*?)\n        \},\n        suggestions/.exec(server)?.[1] ?? '';
  for (const key of [
    'detected_company', 'skills_must_have', 'skills_should_have', 'skills_nice_to_have', 'salary_min', 'salary_max',
    'contract_type', 'remote_policy', 'remote_days', 'start_date', 'mission_description', 'context', 'seniority',
    'evaluation_criteria',
  ]) {
    assert.match(analysis, new RegExp(`\\b${key}:`), `analysis.${key} renvoyé`);
  }
  assert.match(server, /contract_type: cleanEnum\(parsed\.contract_type, CONTRACT_TYPES\)/);
  assert.match(server, /remote_policy: cleanEnum\(parsed\.remote_policy, REMOTE_POLICIES\)/);
  assert.match(server, /success: true,\s*degraded,/);
  assert.match(server, /degraded = true;/);
});

test('design : les tuiles de choix sont des cartes à coin de carte, pas des pilules', () => {
  const choose = dialog.slice(dialog.indexOf('const ChooseMode'), dialog.indexOf('// ─── Mode Brief IA'));
  assert.match(choose, /className="h-auto flex-col items-start justify-start gap-4 whitespace-normal rounded-xl p-5 text-left"/);
  assert.doesNotMatch(choose, /rounded-full/);
});

test('texte : la consigne n\'est dite qu\'une fois, le panneau vide annonce ce qui sera retenu', () => {
  const empty = code(panel);
  assert.doesNotMatch(empty, /Collez la fiche de poste, puis lancez l'analyse/);
  assert.match(empty, /Le poste, le lieu, l'expérience, le contrat et les compétences retenus par l'assistant s'afficheront ici\./);
  const d = code(dialog);
  assert.match(d, /placeholder=\{'Collez la fiche de poste ou décrivez le besoin\./);
  assert.doesNotMatch(d, /glissez-déposez un fichier ou décrivez/, 'le glisser-déposer est dit sous le champ');
  assert.match(d, /Fichier \.txt ou \.md, ou glisser-déposer/);
  assert.match(d, /Une offre, ou la page emplois d'une société pour choisir parmi ses offres\./);
});

test('adresse : « companies-v1 » est reconnue comme « companies », et l\'échec dit quoi faire', () => {
  const d = code(dialog);
  assert.ok(d.includes(String.raw`/\/companies(?:-v1)?\/([a-z0-9-]+)\/jobs\/`), 'adresse d\'une offre');
  assert.ok(d.includes(String.raw`/\/companies(?:-v1)?\/([a-z0-9-]+)/i`), 'adresse d\'une société');
  assert.match(d, /Ouvrez une offre sur le site et collez son adresse ici, ou collez le texte de la fiche\./);
  assert.match(d, /Collez l'adresse d'une offre précise, ou directement le texte de la fiche\./);
});

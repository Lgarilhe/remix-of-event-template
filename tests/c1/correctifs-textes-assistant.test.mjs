/**
 * Garde statique des correctifs « textes de l'assistant ».
 *
 * (1) Réponses proposées aux candidats (generate-reply-suggestions,
 *     analyze-response) : toujours au vouvoiement.
 *     - aucun ton au tutoiement : l'ancien « Décontracté » (`casual`) devient
 *       chaleureux au vouvoiement, par styleFromLegacyTone et toneLines de
 *       _shared/writing-style.ts ;
 *     - la consigne au modèle commence par l'obligation de vouvoyer ;
 *     - aucun texte fixe au tutoiement (réponses de secours, formules
 *       d'exemple), jugé par le vrai hasTutoiement ;
 *     - chaque suggestion du modèle passe par hasTutoiement (adresses retirées
 *       avant le contrôle) : celle qui tutoie est écartée, sans nouvel appel ;
 *       toutes écartées : réponses de secours vouvoyées ;
 *     - questions de qualification d'analyze-response (un clic les insère dans
 *       le message au candidat) : même obligation, même filtre ;
 *     - contexte IA : un ancien réglage « Tutoiement » est lu comme vouvoiement,
 *       les autres tons des consignes restent appliqués.
 * (2) Lectures de l'assistant (_shared/agent-tools-reads.ts) :
 *     - get_sequences_status lit les inscriptions de la mission sous toutes les
 *       formes de job_id des écrans (missionEnrollmentJobIds) ; get_org_analytics
 *       aussi pour les missions d'un collaborateur ;
 *     - get_org_analytics agrège l'étape générale (mission_candidate_rows),
 *       plus l'ancienne colonne pipeline_stage, réponse de même forme.
 *
 * Comportement en base : e2e/api/seq-assistant.spec.ts
 * (gss-formes-identifiant-mission, goa-pipeline-etape-generale,
 * goa-collaborateur-formes-identifiant-mission).
 *
 * Lancer : node --test tests/c1/correctifs-textes-assistant.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync, transformSync } from 'esbuild';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const REPLY = 'supabase/functions/generate-reply-suggestions/index.ts';
const ANALYZE = 'supabase/functions/analyze-response/index.ts';
const READS = 'supabase/functions/_shared/agent-tools-reads.ts';
const STYLE = 'supabase/functions/_shared/writing-style.ts';
const AI_CONTEXT = 'supabase/functions/_shared/ai-context.ts';
const FRONT_SCOPE = 'src/lib/sequenceErrorMessages.ts';

async function loadBundle(rel) {
  const { outputFiles } = buildSync({
    entryPoints: [join(ROOT, rel)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}

const style = await loadBundle(STYLE);
const front = await loadBundle(FRONT_SCOPE);

/** Position d'un motif, échec explicite s'il est absent. */
function at(src, needle, from = 0) {
  const i = src.indexOf(needle, from);
  assert.ok(i >= 0, `${needle} introuvable`);
  return i;
}

/** Fonction ou objet de premier niveau : de sa déclaration à la première ligne `}` ou `};` en colonne 0. */
function topLevelBlock(src, declaration) {
  const start = at(src, declaration);
  const end = src.slice(start).search(/\n\};?\n/);
  assert.ok(end > 0, `fin de ${declaration} introuvable`);
  return src.slice(start, start + end + 3);
}

/** Code sans commentaires, pour ne juger que ce qui s'exécute. */
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .map((line) => line.replace(/(^|[^:'"`\\])\/\/.*$/, '$1'))
    .join('\n');
}

/**
 * Exécute, avec le vrai hasTutoiement, le bloc qui va de la règle de
 * vouvoiement à la fin de keepVouvoiement (constantes et fonction réelles).
 */
function loadFilter(rel, fallbackName) {
  const src = read(rel);
  const start = at(src, 'const VOUVOIEMENT_RULE =');
  const fn = topLevelBlock(src, 'function keepVouvoiement');
  const end = src.indexOf(fn) + fn.length;
  assert.ok(end > start, `${rel} : keepVouvoiement doit suivre VOUVOIEMENT_RULE`);
  const { code } = transformSync(src.slice(start, end), { loader: 'ts', format: 'esm' });
  return new Function('hasTutoiement', `${code}\nreturn { VOUVOIEMENT_RULE, FALLBACK: ${fallbackName}, keepVouvoiement };`)(style.hasTutoiement);
}

const FUNCTIONS = [
  { rel: REPLY, fallback: 'FALLBACK_SUGGESTIONS' },
  { rel: ANALYZE, fallback: 'FALLBACK_REPLY_SUGGESTIONS' },
];

/** Formes du tutoiement adressées au candidat déjà vues dans ces fonctions. */
const CANDIDATE_TU_RE = /ton retour|si tu |te convient|vers toi|Tutoiement naturel|Décontracté et friendly|dispo si/i;

// ─── (1) Réponses proposées aux candidats ───────────────────────────────────

test('réponses proposées : aucun ton ni texte fixe au tutoiement (formes déjà vues)', () => {
  for (const { rel } of FUNCTIONS) {
    assert.doesNotMatch(read(rel), CANDIDATE_TU_RE, `${rel} garde une forme au tutoiement`);
  }
});

test('réponses proposées : ton « casual » chaleureux au vouvoiement, par styleFromLegacyTone et toneLines', () => {
  for (const { rel } of FUNCTIONS) {
    const src = codeOnly(read(rel));
    assert.match(src, /import \{ DEFAULT_WRITING_STYLE, hasTutoiement, mergeStyle, styleFromLegacyTone, toneLines \} from "\.\.\/_shared\/writing-style\.ts";/);
    const casual = src.slice(at(src, "case 'casual':"), at(src, "case 'direct':"));
    assert.match(casual, /Chaleureux, au vouvoiement/);
    assert.match(casual, /toneLines\(mergeStyle\(\{ \.\.\.DEFAULT_WRITING_STYLE \}, styleFromLegacyTone\('casual'\)\)\)/);
    assert.doesNotMatch(casual, /tutoi|emoji/i);
  }
  // Ce que ces lignes donnent au modèle : vouvoiement en tête, registre chaleureux, aucun tutoiement.
  const lines = style.toneLines(style.mergeStyle({ ...style.DEFAULT_WRITING_STYLE }, style.styleFromLegacyTone('casual')));
  assert.match(lines[0], /^Vouvoyez le candidat/);
  assert.match(lines[1], /^Registre chaleureux/);
  for (const line of lines) assert.equal(style.hasTutoiement(line), false, line);
});

test('réponses proposées : la consigne au modèle commence par l’obligation de vouvoyer', () => {
  const reply = codeOnly(read(REPLY));
  assert.match(reply, /const prompt = `\$\{VOUVOIEMENT_RULE\}\n\nTu es un recruteur tech expérimenté\./);
  // Seconde tentative (JSON illisible) : même obligation en tête.
  assert.match(reply, /system: \[\{ type: "text", text: VOUVOIEMENT_RULE \+ " Génère 3 réponses courtes en JSON valide\./);
  assert.match(reply, /14\. Vouvoiement obligatoire dans chaque suggestion, jamais de tutoiement/);
  const analyze = codeOnly(read(ANALYZE));
  assert.match(analyze, /const systemPrompt = `\$\{VOUVOIEMENT_RULE\}\n\nTu es un expert senior en recrutement tech/);
  assert.match(analyze, /- Vouvoiement obligatoire dans chaque suggestion, jamais de tutoiement/);
  for (const { rel, fallback } of FUNCTIONS) {
    const { VOUVOIEMENT_RULE } = loadFilter(rel, fallback);
    assert.match(VOUVOIEMENT_RULE, /^OBLIGATION : .*vouvoyez le candidat/);
    assert.equal(style.hasTutoiement(VOUVOIEMENT_RULE), false);
  }
});

test('réponses proposées : formules d’exemple et réponses de secours au vouvoiement (vrai hasTutoiement)', () => {
  const reply = read(REPLY);
  const calendly = reply.match(/Formule naturelle: "([^"]+)"/);
  assert.ok(calendly, 'formule du lien de rendez-vous introuvable');
  assert.match(calendly[1], /un créneau qui vous convient/);
  const missing = reply.match(/suggère "([^"]+)"/);
  assert.ok(missing, 'formule « Je vérifie ce point » introuvable');
  assert.equal(missing[1], 'Je vérifie ce point et je reviens vers vous');
  for (const example of [calendly[1], missing[1]]) assert.equal(style.hasTutoiement(example), false, example);

  for (const { rel, fallback } of FUNCTIONS) {
    const { FALLBACK } = loadFilter(rel, fallback);
    assert.deepEqual(FALLBACK.map((s) => s.text), [
      'Merci pour votre retour !',
      'Seriez-vous disponible pour un appel cette semaine ?',
      'Merci pour ces informations. Je reste disponible si vous avez des questions.',
    ]);
    // Chaque réponse écrite dans la fonction ({ text, type }) est vouvoyée.
    const literals = [...codeOnly(read(rel)).matchAll(/\{ text: "([^"]+)", type: "(?:quick|standard|detailed)"/g)].map((m) => m[1]);
    assert.ok(literals.length >= 3, `${rel} : réponses de secours introuvables`);
    for (const text of literals) assert.equal(style.hasTutoiement(text), false, `${rel} : « ${text} » tutoie`);
    // Plus aucune liste de secours écrite à la main : la constante partout.
    assert.doesNotMatch(codeOnly(read(rel)), /uggestions: \[\s*\{/);
  }
});

test('réponses proposées : chaque suggestion du modèle passe par hasTutoiement, sans nouvel appel', () => {
  for (const { rel, fallback } of FUNCTIONS) {
    const fn = codeOnly(topLevelBlock(read(rel), 'function keepVouvoiement'));
    assert.match(fn, /suggestions\.filter\(\(s\) => !tutoie\(s\?\.text, knownNames\)\)/);
    // Le contrôle : le vrai hasTutoiement, sur le texte sans ses adresses.
    const check = codeOnly(topLevelBlock(read(rel), 'function tutoie('));
    assert.match(check, /return hasTutoiement\(String\(text \?\? (""|'')\)\.replace\(\/https\?:\\\/\\\/\\S\+\/g, (" "|' ')\), knownNames\);/);
    assert.match(fn, /return dropped > 0 && kept\.length === 0 \? FALLBACK_(REPLY_)?SUGGESTIONS : kept;/);
    assert.doesNotMatch(fn, /fetch|callClaude/);

    const { FALLBACK, keepVouvoiement } = loadFilter(rel, fallback);
    const vous = { text: 'Merci pour votre message, seriez-vous disponible jeudi ?', type: 'quick' };
    const tu = { text: 'Merci pour ton message, tu es dispo jeudi ?', type: 'standard' };
    const toi = { text: 'Je vérifie ce point et je reviens vers toi.', type: 'detailed' };
    assert.deepEqual(keepVouvoiement([vous, tu, toi], []), [vous]);
    assert.equal(keepVouvoiement([tu, toi], []), FALLBACK, 'toutes écartées : réponses de secours');
    assert.deepEqual(keepVouvoiement([], []), [], 'aucune suggestion du modèle : rien à remplacer');
    // Noms propres connus masqués : « Minh Tu » n'est pas du tutoiement.
    const name = { text: 'Bonjour Minh Tu, merci pour votre retour.', type: 'quick' };
    assert.deepEqual(keepVouvoiement([name], ['Minh Tu']), [name]);
    // Lien de rendez-vous prérempli (first_name=Tu) : une adresse ne tutoie personne.
    const link = {
      text: 'Voici un lien pour réserver un créneau qui vous convient : https://calendly.com/jd/30min?a1=x&first_name=Tu&last_name=Nguyen',
      type: 'standard',
    };
    assert.equal(style.hasTutoiement(link.text, ['Tu Nguyen', 'Tu']), true, 'sans retrait des adresses, la suggestion serait écartée');
    assert.deepEqual(keepVouvoiement([link], ['Tu Nguyen', 'Tu']), [link]);
    // Une adresse retirée ne cache pas le tutoiement du texte autour.
    const tuLink = { text: 'Réserve ton créneau ici : https://calendly.com/jd/30min', type: 'quick' };
    assert.equal(keepVouvoiement([tuLink, vous], []).length, 1);
  }

  const reply = codeOnly(read(REPLY));
  // Réponse lue, puis seconde tentative : les deux chemins filtrent.
  assert.match(reply, /suggestions = keepVouvoiement\(Array\.isArray\(suggestions\) \? suggestions : \[\], knownNames\);/);
  assert.match(reply, /suggestions: keepVouvoiement\(Array\.isArray\(retryResult\.suggestions\) \? retryResult\.suggestions : \[\], knownNames\),/);
  assert.match(reply, /suggestions: FALLBACK_SUGGESTIONS,/);
  assert.equal((reply.match(/keepVouvoiement\(/g) ?? []).length, 2, 'deux appels');

  const analyze = codeOnly(read(ANALYZE));
  assert.match(analyze, /\? keepVouvoiement\(analysis\.replySuggestions\.slice\(0, 5\), knownNames\)/);
  assert.equal((analyze.match(/replySuggestions: FALLBACK_REPLY_SUGGESTIONS,/g) ?? []).length, 2);
  for (const src of [reply, analyze]) {
    assert.match(src, /const knownNames = \[\n\s*context\.recipientName \|\| '',/);
  }
});

test('réponses proposées : questions de qualification au vouvoiement (consigne et filtre)', () => {
  const analyze = codeOnly(read(ANALYZE));
  const { VOUVOIEMENT_RULE } = loadFilter(ANALYZE, 'FALLBACK_REPLY_SUGGESTIONS');
  assert.match(VOUVOIEMENT_RULE, /dans les suggestions de réponse et les questions de qualification, vouvoyez le candidat/);
  assert.match(analyze, /- Identifie les questions de qualification stratégiques à poser, formulées au vouvoiement/);
  assert.match(analyze, /\? analysis\.qualificationQuestions\.filter\(\(q\) => !tutoie\(q, knownNames\)\)\.slice\(0, 3\)/);
  assert.doesNotMatch(analyze, /analysis\.qualificationQuestions\.slice\(/);

  // Le filtre réel, sur des questions du modèle.
  const src = read(ANALYZE);
  const { code } = transformSync(topLevelBlock(src, 'function tutoie('), { loader: 'ts', format: 'esm' });
  const tutoie = new Function('hasTutoiement', `${code}\nreturn tutoie;`)(style.hasTutoiement);
  const questions = ['Quelle est ta disponibilité ?', 'Quelle est votre disponibilité ?', 'Tu es en poste ?', 'Quel est votre préavis ?', 'Quelles sont vos attentes ?'];
  assert.deepEqual(questions.filter((q) => !tutoie(q, [])).slice(0, 3), [
    'Quelle est votre disponibilité ?', 'Quel est votre préavis ?', 'Quelles sont vos attentes ?',
  ]);
});

test('réponses proposées : un ancien réglage « Tutoiement » est lu comme vouvoiement, les autres tons restent', () => {
  const reply = codeOnly(read(REPLY));
  assert.doesNotMatch(reply, /omitTone/, 'omitTone retirerait tous les tons des consignes');
  const m = reply.match(/const aiContext = \(await loadAndBuildAiContext\(svc, \{ userId, orgId \}\)\)\n\s*\.replace\((\/[^\n]+\/g), '([^']+)'\);/);
  assert.ok(m, 'lecture du contexte IA introuvable');
  // La ligne remplacée est bien celle qu'écrit formatScope (_shared/ai-context.ts).
  const ctx = read(AI_CONTEXT);
  assert.match(ctx, /tu: "tutoiement",/);
  assert.match(ctx, /lines\.push\(`- Ton imposé : \$\{TONE_LABEL\[ctx\.tone\]\}`\);/);
  const pattern = new Function(`return ${m[1]};`)();
  const block = (tone) => `Voix de marque de l'agence :\n- Ton imposé : ${tone}\n- Spécialité : tech\n\nStyle perso de l'expéditeur :\n- Ton imposé : ${tone}`;
  assert.equal(block('tutoiement').replace(pattern, m[2]), block('vouvoiement'));
  for (const tone of ['vouvoiement', 'décontracté / familier', 'formel / soutenu']) {
    assert.equal(block(tone).replace(pattern, m[2]), block(tone), tone);
  }
  // analyze-response ne charge pas le contexte IA.
  assert.doesNotMatch(codeOnly(read(ANALYZE)), /loadAndBuildAiContext|aiContext:/);
});

// ─── (2) Lectures de l'assistant ────────────────────────────────────────────

test('get_sequences_status : inscriptions de la mission sous toutes les formes de job_id (missionEnrollmentJobIds)', async () => {
  const reads = read(READS);
  const block = codeOnly(topLevelBlock(reads, 'const getSequencesStatus: AgentTool = {'));
  assert.match(block, /\.from\('sourcing_projects'\)\n\s*\.select\('job_id'\)\n\s*\.eq\('id', missionId\)/);
  assert.match(block, /const jobIds = missionEnrollmentJobIds\(missionId, /);
  assert.match(block, /\.eq\('organization_id', ctx\.organizationId\)\n\s*\.in\('job_id', jobIds\)/);
  assert.doesNotMatch(block, /\.eq\('job_id'/);

  // Copie serveur = fonction des écrans, sur les mêmes entrées.
  const serverFn = topLevelBlock(reads, 'function missionEnrollmentJobIds(');
  const { code } = transformSync(serverFn, { loader: 'ts', format: 'esm' });
  const server = new Function(`${code}\nreturn missionEnrollmentJobIds;`)();
  const id = '11111111-2222-3333-4444-555555555555';
  for (const linked of ['job_42', null, undefined, id, `project:${id}`]) {
    assert.deepEqual(server(id, linked), front.missionEnrollmentJobIds(id, linked), String(linked));
  }
  assert.deepEqual(server(id, 'job_42'), [id, `project:${id}`, 'job_42']);
});

test('get_org_analytics : pipeline par étape générale (mission_candidate_rows), réponse de même forme', () => {
  const block = codeOnly(topLevelBlock(read(READS), 'const getOrgAnalytics: AgentTool = {'));
  assert.doesNotMatch(block, /pipeline_stage|from\('job_candidate_status'\)/);
  assert.match(block, /ctx\.adminClient\.from\('mission_candidate_rows'\)\n\s*\.select\('general_stage, project_id, created_by'\)\n\s*\.eq\('organization_id', ctx\.organizationId\)\n\s*\.eq\('is_unopened', false\);/);
  // Collaborateur : même périmètre qu'avant (ses lignes ou ses missions).
  assert.match(block, /pq = pq\.or\(`created_by\.eq\.\$\{ctx\.userId\},project_id\.in\.\(\$\{missionIds\.join\(','\)\}\)`\);/);
  // Inscriptions d'un collaborateur : toutes les formes de job_id de ses missions.
  assert.match(block, /\.from\('sourcing_projects'\)\n\s*\.select\('id, job_id'\)\n\s*\.eq\('organization_id', ctx\.organizationId\)\n\s*\.in\('id', missionIds\);/);
  assert.match(block, /enrollmentJobIds = \[\.\.\.new Set\(missionIds\.flatMap\(\(id\) => missionEnrollmentJobIds\(id, linkedJob\.get\(id\)\)\)\)\];/);
  assert.match(block, /if \(enrollmentJobIds\) sq = sq\.in\('job_id', enrollmentJobIds\);/);
  assert.doesNotMatch(block, /sq\.in\('job_id', missionIds\)/);
  // Libellés de l'interface, toutes les étapes présentes.
  assert.match(block, /Object\.fromEntries\(GENERAL_STAGES\.map\(\(k\) => \[GENERAL_STAGE_LABEL\[k\], 0\]\)\)/);
  assert.match(block, /const k = stageLabel\(r\.general_stage\);/);
  // Forme rendue au modèle inchangée.
  assert.match(block, /pipeline: \{ total_candidates: pRows\.length, by_stage: stages \},/);
  assert.match(block, /pipeline: \{ total_candidates: 0, by_stage: \{\} \},/);
});

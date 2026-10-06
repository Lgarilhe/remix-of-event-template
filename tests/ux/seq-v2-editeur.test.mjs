/**
 * Lot 5d-2 : éditeur unique de séquence, modules purs et gardes statiques.
 *
 * Invariants épinglés (partie 1, fondations) :
 *   - aucun import de @xyflow/react sous src/components/sequences ;
 *   - src/lib/sequenceVariables.ts : les puces n'écrivent que des clés de
 *     SEQUENCE_TEMPLATE_KEYS (clés françaises du moteur), groupées « Le
 *     candidat », « La mission », « Vous », « La date », chacune avec son
 *     exemple (« Prénom · Claire ») ; mêmes libellés que le fil en lecture
 *     (templateExcerpt) ; variable inconnue détectée, avec ou sans repli ;
 *     texte de secours écrit dans la syntaxe du moteur et rendu par
 *     renderTemplatePreview (src/lib/templatePreview.ts) ;
 *   - isStepAllowedAt (sequenceGraph.ts) : règles de l'ancien éditeur jugées
 *     sur le chemin, branches comprises ; une entrée impossible garde sa
 *     raison ; types fermés jamais dans la palette.
 *
 * Partie 3 (message, aperçu réel, vérification, enregistrement) :
 *   - validateSequence : variable inconnue bloquante derrière une option dont
 *     le défaut garde l'ancien éditeur (aucun contrôle) ;
 *   - renderTemplatePreviewSegments : mis bout à bout, ses morceaux donnent
 *     exactement le texte de renderTemplatePreview (jeu commun du moteur) ;
 *   - exemple fictif pour chaque clé du moteur ; adresses de création ;
 *   - gardes statiques : composants du plan, enregistrement par
 *     useSequenceSave seulement, aucune valeur d'aperçu en stockage local,
 *     aucun appel serveur nouveau hors preview_values, phrases imposées,
 *     drapeau éteint sans changement (ancien éditeur dans le panneau).
 *
 * Partie 5 (gardes sur tout le dossier des pages Séquences, éditeur et hooks) :
 *   - aucune écriture de sequence_steps ni appel direct de save_sequence_steps ;
 *     seule lecture, la copie de « Copier une séquence » ; useSequenceSave seul
 *     chemin d'écriture des étapes (page et création) ;
 *   - « Guidé », « Expert », « Liste », « Visuel » absents (bornes Unicode) ;
 *   - stockage local : le brouillon (étapes, nom, réglages) et l'avis de la
 *     formule gratuite seulement, jamais une valeur d'aperçu.
 *
 * Sans navigateur ni base. Lancer : node --test tests/ux/seq-v2-editeur.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync, transformSync } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

/** Module TypeScript empaqueté avec ses imports relatifs, chargé par une URL data:. */
async function loadBundle(rel) {
  const { outputFiles } = buildSync({
    entryPoints: [join(ROOT, rel)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    tsconfig: join(ROOT, 'tsconfig.app.json'),
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}

/** Module sans import, transpilé seul. */
async function loadPure(rel) {
  const { code } = transformSync(read(rel), { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

const vars = await loadBundle('src/lib/sequenceVariables.ts');
const graph = await loadBundle('src/components/outreach/sequence/sequenceGraph.ts');
const flow = await loadBundle('src/lib/sequenceFlow.ts');
const starters = await loadBundle('src/lib/sequenceStarterTemplates.ts');
const preview = await loadPure('src/lib/templatePreview.ts');

const walk = (rel) => {
  const dir = join(ROOT, rel);
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) out.push(...walk(join(rel, name)));
    else if (/\.(ts|tsx)$/.test(name)) out.push(join(rel, name));
  }
  return out;
};

const VENDORS = /\b(?:Unipile|Apollo|PDL|People Data Labs|Calendly|Brandfetch|Clearbit|Resend|Anthropic|Claude|Notion)\b/i;
// Modes de l'ancien éditeur, jamais nommés. Bornes Unicode : sans le drapeau u,
// \b ne voit pas la fin de « Guidé » (é n'est pas un caractère de mot).
const MODE_WORDS = /(?<![\p{L}\p{N}_])(?:Guidé|Expert|Liste|Visuel)(?![\p{L}\p{N}_])/u;

// ── Gardes statiques ──────────────────────────────────────────────────────

test('aucun import de @xyflow/react sous src/components/sequences', () => {
  const files = walk('src/components/sequences');
  assert.ok(files.length > 0, 'dossier src/components/sequences introuvable');
  for (const file of files) assert.doesNotMatch(read(file), /@xyflow\/react/, file);
});

test('sequenceVariables.ts est un module pur : seul import, les clés du moteur', () => {
  const src = read('src/lib/sequenceVariables.ts');
  const imports = [...src.matchAll(/^import .* from '([^']+)';$/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['../components/outreach/sequence/sequenceGraph.ts']);
  assert.match(src, /^import \{ SEQUENCE_TEMPLATE_KEYS \} from/m);
  const code = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');
  assert.doesNotMatch(code, /localStorage|sessionStorage|supabase|fetch\(/);
});

// ── Variables : puces ─────────────────────────────────────────────────────

test('les puces écrivent les clés de SEQUENCE_TEMPLATE_KEYS, clés françaises seulement', () => {
  const keys = new Set(graph.SEQUENCE_TEMPLATE_KEYS);
  const aliases = ['first_name', 'last_name', 'name', 'company', 'job_title', 'sender_name', 'calendly_link'];
  assert.ok(vars.SEQUENCE_VARIABLES.length >= 15);
  const seen = new Set();
  for (const v of vars.SEQUENCE_VARIABLES) {
    assert.ok(keys.has(v.key), `clé inventée : ${v.key}`);
    assert.ok(!aliases.includes(v.key), `alias anglais proposé : ${v.key}`);
    assert.ok(!seen.has(v.key), `doublon : ${v.key}`);
    seen.add(v.key);
    const { text, caret } = vars.insertVariable('', 0, 0, v.key);
    assert.equal(text, `{{${v.key}}}`);
    assert.equal(caret, text.length);
    const [use] = vars.parseTemplateVariables(text);
    assert.equal(use.key, v.key);
    assert.equal(use.known, true);
    assert.equal(use.label, v.label);
  }
  // Clés que la spécification demande à proposer.
  for (const key of ['prenom', 'entreprise_actuelle', 'poste_actuel', 'poste_recherche', 'lien_calendly', 'mon_prenom', 'ma_signature']) {
    assert.ok(seen.has(key), `clé attendue dans le menu : ${key}`);
  }
});

test('menu groupé « Le candidat », « La mission », « Vous », « La date », chaque entrée avec un exemple', () => {
  assert.deepEqual([...vars.VARIABLE_GROUPS], ['Le candidat', 'La mission', 'Vous', 'La date']);
  const menu = vars.variableMenu(new Date(2026, 9, 6, 9, 30));
  assert.deepEqual(menu.map((g) => g.group), ['Le candidat', 'La mission', 'Vous', 'La date']);
  for (const group of menu) {
    assert.ok(group.variables.length > 0, `groupe vide : ${group.group}`);
    for (const v of group.variables) {
      assert.equal(v.group, group.group);
      assert.ok(v.label.trim() && v.example.trim(), `${v.key} : libellé et exemple`);
      for (const text of [v.label, v.example]) {
        assert.doesNotMatch(text, VENDORS, `${v.key} : nom de prestataire`);
        assert.doesNotMatch(text, /—/, `${v.key} : tiret long`);
      }
    }
  }
  assert.equal(vars.variableMenuText(menu[0].variables[0]), 'Prénom · Claire');
  assert.equal(menu[1].variables.find((v) => v.key === 'lien_calendly').label, 'Lien d’agenda');
});

test('les exemples de « La date » suivent les formats du moteur ; une valeur réelle remplace l’exemple', () => {
  const at = (h) => Object.fromEntries(vars.variableMenu(new Date(2026, 9, 6, h, 0))[3].variables.map((v) => [v.key, v.example]));
  assert.deepEqual(at(9), {
    salutation: 'Bonjour', periode_jour: 'matinée', aujourd_hui: 'mardi 6 octobre 2026', jour_semaine: 'mardi', date_courte: '06/10/2026',
  });
  assert.equal(at(14).periode_jour, 'après-midi');
  assert.equal(at(14).salutation, 'Bonjour');
  assert.equal(at(19).periode_jour, 'soirée');
  assert.equal(at(19).salutation, 'Bonsoir');
  const real = vars.variableMenu(new Date(2026, 9, 6, 9), { prenom: ' Lucie ', entreprise_actuelle: '', mon_prenom: null });
  const byKey = Object.fromEntries(real.flatMap((g) => g.variables).map((v) => [v.key, v.example]));
  assert.equal(byKey.prenom, 'Lucie');
  assert.equal(byKey.entreprise_actuelle, 'Somfy', 'valeur vide : exemple gardé');
  assert.equal(byKey.mon_prenom, 'Julie');
});

test('mêmes libellés que le fil en lecture, pour chaque clé du moteur', () => {
  for (const key of graph.SEQUENCE_TEMPLATE_KEYS) {
    const label = vars.variableLabel(key);
    assert.ok(label, `clé du moteur sans libellé : ${key}`);
    assert.equal(flow.templateExcerpt(`{{${key}}}`), `[${label}]`, key);
  }
  assert.equal(vars.variableLabel(' Prenom '), 'Prénom');
  assert.equal(vars.variableLabel('ville'), null);
});

// ── Variables : lecture, inconnues, texte de secours ──────────────────────

test('insertVariable remplace la sélection et place le curseur après la variable', () => {
  assert.deepEqual(vars.insertVariable('Bonjour , ça va', 8, 8, 'prenom'), { text: 'Bonjour {{prenom}}, ça va', caret: 18 });
  assert.deepEqual(vars.insertVariable('Bonjour Marie,', 8, 13, 'prenom'), { text: 'Bonjour {{prenom}},', caret: 18 });
  assert.deepEqual(vars.insertVariable('Bonjour Marie,', 13, 8, 'prenom'), { text: 'Bonjour {{prenom}},', caret: 18 }, 'sélection inversée');
  assert.deepEqual(vars.insertVariable('abc', -4, 99, 'nom'), { text: '{{nom}}', caret: 7 }, 'bornes ramenées au texte');
});

test('lecture des variables comme le moteur : clé en minuscules, repli fallback ou default, position', () => {
  const text = 'Bonjour {{ Prenom }}, chez {{entreprise_actuelle | fallback:"votre entreprise"}} {{prenmo}} {{inconnu | default:\'x\'}} {{ma_cle|upper}}';
  const uses = vars.parseTemplateVariables(text, ['MA_CLE']);
  assert.deepEqual(uses.map((u) => [u.key, u.known, u.fallback, u.label]), [
    ['prenom', true, null, 'Prénom'],
    ['entreprise_actuelle', true, 'votre entreprise', 'Entreprise actuelle'],
    ['prenmo', false, null, null],
    ['inconnu', false, 'x', null],
    ['ma_cle', true, null, null],
  ]);
  for (const u of uses) assert.equal(text.slice(u.start, u.end), u.raw);
  assert.equal(vars.parseTemplateVariables('{{prenom | fallback}}')[0].fallback, '', 'repli vide');
  const segments = vars.templateSegments(text, ['ma_cle']);
  assert.equal(segments.map((s) => (s.kind === 'text' ? s.text : s.variable.raw)).join(''), text, 'découpage sans perte');
  assert.deepEqual(vars.templateSegments('').length, 0);
});

test('variable inconnue signalée : retirée sans repli (comme findUnknownTemplateVariables), signalée aussi avec repli', () => {
  const texts = ['Bonjour {{prenmo}}, {{Prenmo}} {{poste_recherche}}', 'Objet {{inconnu | fallback:"x"}} {{perso}}'];
  const unknown = vars.unknownTemplateVariables(texts, ['perso']);
  assert.deepEqual(unknown.map((u) => [u.key, u.hasFallback]), [['prenmo', false], ['inconnu', true]]);
  const removed = unknown.filter((u) => !u.hasFallback).map((u) => `{{${u.key}}}`);
  assert.deepEqual(removed, texts.flatMap((t) => graph.findUnknownTemplateVariables(t, ['perso'])));
  assert.deepEqual(vars.unknownTemplateVariables(['{{first_name}} {{calendly_link}}']), [], 'alias anglais connus du moteur');
  assert.deepEqual(vars.usedVariables(texts, ['perso']).map((u) => u.key), ['prenmo', 'poste_recherche', 'inconnu', 'perso']);
});

test('texte de secours : écrit dans la syntaxe du moteur, rendu par renderTemplatePreview', () => {
  const base = 'Bonjour {{prenom}}, votre parcours chez {{ entreprise_actuelle | capitalize }} m’intéresse.';
  const withFallback = vars.setVariableFallback(base, 'entreprise_actuelle', 'votre entreprise');
  assert.equal(withFallback, 'Bonjour {{prenom}}, votre parcours chez {{entreprise_actuelle | capitalize | fallback:"votre entreprise"}} m’intéresse.');
  assert.equal(vars.variableFallback(withFallback, 'entreprise_actuelle'), 'votre entreprise');
  assert.equal(vars.variableFallback(withFallback, 'prenom'), null);
  assert.equal(vars.setVariableFallback(withFallback, 'entreprise_actuelle', 'votre entreprise'), withFallback, 'texte conforme non réécrit');
  // Donnée absente : le texte de secours part (posé en dernier, les filtres d'avant ne le touchent pas) ; présente : la valeur.
  assert.equal(preview.renderTemplatePreview(withFallback, { prenom: 'Claire' }).text, 'Bonjour Claire, votre parcours chez votre entreprise m’intéresse.');
  assert.equal(preview.renderTemplatePreview(withFallback, { prenom: 'Claire', entreprise_actuelle: 'somfy' }).text, 'Bonjour Claire, votre parcours chez Somfy m’intéresse.');
  // Retrait : les autres filtres restent.
  assert.equal(vars.setVariableFallback(withFallback, 'entreprise_actuelle', '  '), 'Bonjour {{prenom}}, votre parcours chez {{entreprise_actuelle | capitalize}} m’intéresse.');
  // Toutes les occurrences, casse de la clé ignorée ; caractères qui couperaient la variable retirés.
  const twice = vars.setVariableFallback('{{Prenom}} et {{prenom | default:"a"}}', 'PRENOM', 'Madame {x} | "Y"\nZ');
  assert.equal(twice, '{{Prenom | fallback:"Madame x  ”Y” Z"}} et {{prenom | fallback:"Madame x  ”Y” Z"}}');
  assert.equal(preview.renderTemplatePreview(twice, {}).text, 'Madame x  ”Y” Z et Madame x  ”Y” Z');
  assert.equal(vars.variableToken('prenom'), '{{prenom}}');
  assert.equal(vars.variableToken('prenom', 'Madame, Monsieur'), '{{prenom | fallback:"Madame, Monsieur"}}');
});

// ── isStepAllowedAt ───────────────────────────────────────────────────────

let seq = 0;
const step = (actionType, extra = {}) => {
  seq += 1;
  return {
    id: `s${seq}`, order: seq, actionType, conditionType: 'always', delayDays: 0, delayHours: 0, delayMinutes: 0,
    preferredHourStart: 9, preferredHourEnd: 18, useAiPersonalization: false, timeoutDays: 3, ...extra,
  };
};
/** Séquence à plat (comme la liste de l'ancien éditeur) : ordres 0..n-1. */
const flat = (...types) => types.map((t, i) => ({ ...step(t), id: `f${i}`, order: i }));
const allowedAt = (steps, position) => Object.fromEntries(graph.stepAllowancesAt(steps, position).map((a) => [a.actionType, a.allowed]));
const reasonOf = (steps, position, type) => graph.isStepAllowedAt(steps, position, type).reason;
const after = (steps, branch) => ({ afterStepId: steps[steps.length - 1].id, ...(branch ? { branch } : {}) });

test('palette : deux onglets, types proposés seulement, types fermés jamais', () => {
  assert.deepEqual([...graph.ADD_STEP_PALETTE.linkedin], ['profile_visit', 'connection_request', 'message', 'inmail', 'smart_message']);
  assert.deepEqual([...graph.ADD_STEP_PALETTE.conditions], ['check_connection', 'wait_connection', 'wait_reply']);
  const palette = [...graph.ADD_STEP_PALETTE.linkedin, ...graph.ADD_STEP_PALETTE.conditions];
  for (const type of palette) assert.ok(graph.isStepTypeOffered(type), `type fermé dans la palette : ${type}`);
  for (const type of ['email', 'whatsapp_message', 'condition_branch', 'wait_profile_visit']) {
    assert.ok(!palette.includes(type));
    const verdict = graph.isStepAllowedAt([], { afterStepId: null }, type);
    assert.equal(verdict.allowed, false);
    assert.equal(verdict.reason, graph.unsupportedStepNotice(type));
  }
  assert.deepEqual(graph.stepAllowancesAt([], { afterStepId: null }).map((a) => a.actionType), palette);
});

test('séquence à plat : mêmes règles que la liste de l’ancien éditeur', () => {
  assert.deepEqual(allowedAt([], { afterStepId: null }), {
    profile_visit: true, connection_request: true, message: true, inmail: true, smart_message: true,
    check_connection: true, wait_connection: false, wait_reply: false,
  });
  assert.equal(reasonOf([], { afterStepId: null }, 'wait_connection'), 'Ajoutez d’abord une invitation.');
  assert.equal(reasonOf([], { afterStepId: null }, 'wait_reply'), 'Ajoutez d’abord un message ou un InMail.');

  const visit = flat('profile_visit');
  assert.deepEqual(allowedAt(visit, after(visit)), {
    profile_visit: true, connection_request: true, message: false, inmail: true, smart_message: false,
    check_connection: true, wait_connection: false, wait_reply: false,
  });
  assert.match(reasonOf(visit, after(visit), 'message'), /^Seulement pour un candidat en relation/);

  const invite = flat('connection_request');
  assert.deepEqual(allowedAt(invite, after(invite)), {
    profile_visit: true, connection_request: false, message: false, inmail: true, smart_message: false,
    check_connection: true, wait_connection: true, wait_reply: false,
  });
  assert.equal(reasonOf(invite, after(invite), 'connection_request'), 'Une invitation part déjà plus haut sur ce chemin.');

  const waited = flat('connection_request', 'wait_connection');
  assert.deepEqual(allowedAt(waited, after(waited)), {
    profile_visit: true, connection_request: false, message: true, inmail: true, smart_message: true,
    check_connection: true, wait_connection: false, wait_reply: false,
  });
  assert.equal(reasonOf(waited, after(waited), 'wait_connection'), 'Une attente de connexion suit déjà l’invitation sur ce chemin.');

  const inmail = flat('inmail');
  assert.equal(allowedAt(inmail, after(inmail)).wait_reply, true);
  const checked = flat('profile_visit', 'check_connection');
  assert.equal(allowedAt(checked, after(checked)).message, true, 'vérification sans branche : message permis comme avant');
});

test('vérification de la connexion : chaque branche a ses règles', () => {
  const visit = step('profile_visit');
  const check = step('check_connection');
  const steps = [visit, check];
  const yes = { afterStepId: check.id, branch: 'true' };
  const no = { afterStepId: check.id, branch: 'false' };
  assert.deepEqual(allowedAt(steps, yes), {
    profile_visit: true, connection_request: false, message: true, inmail: true, smart_message: true,
    check_connection: false, wait_connection: false, wait_reply: false,
  });
  assert.equal(reasonOf(steps, yes, 'connection_request'), 'Le candidat est déjà en relation à cet endroit.');
  assert.equal(reasonOf(steps, yes, 'check_connection'), 'La relation est déjà connue dans cette branche.');
  assert.deepEqual(allowedAt(steps, no), {
    profile_visit: true, connection_request: true, message: false, inmail: true, smart_message: false,
    check_connection: false, wait_connection: false, wait_reply: false,
  });
  assert.equal(reasonOf(steps, no, 'message'), 'Pas en relation dans cette branche : choisissez une invitation ou un InMail.');
  assert.equal(reasonOf(steps, no, 'smart_message'), 'Pas en relation dans cette branche : choisissez un InMail.');
  // Dans la branche « Non connecté », après l'invitation : l'attente devient possible.
  const message = step('message', { nextStepId: '__end__' });
  const invite = step('connection_request');
  check.ifTrueGotoStep = message.id;
  check.ifFalseGotoStep = invite.id;
  const withInvite = [visit, check, message, invite];
  assert.equal(allowedAt(withInvite, { afterStepId: message.id }).connection_request, false, 'fin de la branche Connecté');
  assert.equal(allowedAt(withInvite, { afterStepId: invite.id }).wait_connection, true);
  assert.equal(allowedAt(withInvite, { afterStepId: invite.id }).message, false, 'toujours hors relation');
});

test('attente de connexion avec repli : « Acceptée » et « Pas acceptée après N jours »', () => {
  const invite = step('connection_request');
  const wait = step('wait_connection', { waitForEvent: 'connection_accepted', timeoutDays: 10 });
  const message = step('message', { nextStepId: '__end__' });
  const inmail = step('inmail');
  wait.nextStepId = message.id;
  wait.timeoutBranchStepId = inmail.id;
  const steps = [invite, wait, message, inmail];
  assert.equal(allowedAt(steps, { afterStepId: wait.id }).message, true, 'branche Acceptée');
  assert.equal(allowedAt(steps, { afterStepId: message.id }).message, true);
  const timeout = { afterStepId: wait.id, branch: 'timeout' };
  assert.equal(allowedAt(steps, timeout).message, false);
  assert.equal(allowedAt(steps, timeout).inmail, true);
  assert.equal(allowedAt(steps, timeout).connection_request, false, 'invitation déjà partie sur ce chemin');
  assert.equal(allowedAt(steps, { afterStepId: inmail.id }).message, false, 'fin de la branche Pas acceptée');
  assert.equal(allowedAt(steps, { afterStepId: inmail.id }).wait_reply, true);
});

test('Séquence recommandée : jugé sur le chemin de chaque branche', () => {
  const rec = starters.generateRecommendedSequence();
  const at = (i, branch) => allowedAt(rec, { afterStepId: rec[i].id, ...(branch ? { branch } : {}) });
  // Fin de la branche Connecté (relance IA) : message permis, invitation non.
  assert.equal(at(6).message, true);
  assert.equal(at(6).connection_request, false);
  assert.equal(at(6).wait_reply, true);
  // Fin de la branche Acceptée (relance IA après l'attente) : message permis.
  assert.equal(at(13).message, true);
  // Fin de la branche Pas acceptée (relance InMail) : message refusé, InMail permis.
  assert.equal(at(16).message, false);
  assert.equal(at(16).inmail, true);
  assert.equal(at(8, 'timeout').smart_message, false);
});

test('emplacement disparu, variante B, raisons courtes en français', () => {
  const steps = flat('connection_request');
  const gone = graph.isStepAllowedAt(steps, { afterStepId: 'absente' }, 'profile_visit');
  assert.equal(gone.allowed, false);
  assert.ok(gone.reason);
  // Une version B suit le chemin de sa version A.
  const a = { ...step('connection_request'), id: 'a', order: 0, variantGroup: 'A', variantWeight: 50 };
  const b = { ...a, id: 'b', variantGroup: 'B' };
  assert.deepEqual(allowedAt([a, b], { afterStepId: 'b' }), allowedAt([a, b], { afterStepId: 'a' }));
  const reasons = new Set();
  const samples = [[], flat('profile_visit'), flat('connection_request'), flat('connection_request', 'wait_connection')];
  for (const s of samples) {
    for (const branch of [undefined, 'true', 'false', 'timeout']) {
      const position = s.length ? { afterStepId: s[s.length - 1].id, branch } : { afterStepId: null };
      for (const verdict of graph.stepAllowancesAt(s, position)) {
        if (verdict.allowed) assert.equal(verdict.reason, null);
        else reasons.add(verdict.reason);
      }
    }
  }
  for (const reason of reasons) {
    assert.ok(reason.length <= 120, `raison trop longue : ${reason}`);
    assert.doesNotMatch(reason, /—/);
    assert.doesNotMatch(reason, MODE_WORDS);
    assert.doesNotMatch(reason, VENDORS);
  }
});

// ── Partie 2 : fil éditable, palette, panneau d'étape ─────────────────────

const editor = await loadBundle('src/lib/sequenceEditor.ts');
const fixtures = JSON.parse(read('tests/fixtures/sequence-editor-payloads.json'));

/** Texte de `start` jusqu'au `;` de même profondeur (parenthèses, crochets, accolades, chaînes). */
function statementFrom(src, start) {
  assert.ok(start >= 0, 'déclaration introuvable');
  let depth = 0;
  let quote = null;
  for (let i = start; i < src.length; i += 1) {
    const c = src[i];
    if (quote) {
      if (c === '\\') { i += 1; continue; }
      if (c === quote) quote = null;
      continue;
    }
    if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
    if ('([{'.includes(c)) depth += 1;
    else if (')]}'.includes(c)) depth -= 1;
    else if (c === ';' && depth === 0) return src.slice(start, i + 1);
  }
  throw new Error('fin de déclaration introuvable');
}
const stripLineComments = (src) => src.replace(/^\s*\/\/.*$/gm, '');
const tsToJs = (code) => transformSync(code, { loader: 'ts', format: 'cjs' }).code;
const fixedCrypto = (id) => ({ randomUUID: () => id });

// createEmptyStep réels de l'ancien éditeur (liste et onglet Visuel), extraits des fichiers.
const builderSrc = stripLineComments(read('src/components/outreach/SequenceBuilder.tsx'));
const oldListStep = new Function('STEP_TYPE_LABELS', 'crypto', `${tsToJs([
  statementFrom(builderSrc, builderSrc.indexOf('const TRIGGERS = [')),
  statementFrom(builderSrc, builderSrc.indexOf('const createEmptyStep = (')),
].join('\n'))}; return createEmptyStep;`);
const visualSrc = stripLineComments(read('src/components/outreach/sequence/VisualSequenceEditor.tsx'));
const oldBranchStep = new Function('waitEventFor', 'crypto', `${tsToJs(statementFrom(visualSrc, visualSrc.indexOf('const createEmptyStep = (')))}; return createEmptyStep;`);
const listStepOf = (id, order, type) => oldListStep(graph.STEP_TYPE_LABELS, fixedCrypto(id))(order, type);
const branchStepOf = (id, order, type) => oldBranchStep(graph.waitEventFor, fixedCrypto(id))(order, type);
const PALETTE = [...graph.ADD_STEP_PALETTE.linkedin, ...graph.ADD_STEP_PALETTE.conditions];

/** Ids rendus dans le fil (cartes), dans l'ordre. */
function renderedIds(nodes, out = []) {
  for (const n of nodes) {
    if (n.kind === 'step' || n.kind === 'fork') out.push(n.id);
    if (n.kind === 'fork') for (const b of n.branches) renderedIds(b.nodes, out);
  }
  return out;
}
/** Emplacements « Ajouter une étape » du fil, avec la branche. */
function addPositions(flow) {
  const out = flow.add ? [{ position: flow.add, branch: null }] : [];
  const visit = (nodes) => {
    for (const n of nodes) {
      if (n.kind !== 'fork') continue;
      for (const b of n.branches) {
        if (b.add) out.push({ position: b.add, branch: b.label });
        visit(b.nodes);
      }
    }
  };
  visit(flow.nodes);
  return out;
}
const findNode = (nodes, id) => {
  for (const n of nodes) {
    if ((n.kind === 'step' || n.kind === 'fork') && n.id === id) return n;
    if (n.kind === 'fork') for (const b of n.branches) { const hit = findNode(b.nodes, id); if (hit) return hit; }
  }
  return null;
};
const branchOf = (flow, label) => {
  let found = null;
  const visit = (nodes) => { for (const n of nodes) if (n.kind === 'fork') for (const b of n.branches) { if (b.label === label) found = b; visit(b.nodes); } };
  visit(flow.nodes);
  assert.ok(found, `branche introuvable : ${label}`);
  return found;
};

test('nouvelles étapes : celles de l’ancien éditeur (liste au fil principal, onglet Visuel dans une branche)', () => {
  for (const type of PALETTE) {
    for (const order of [0, 3]) {
      assert.deepEqual(editor.newListStep('n', order, type), listStepOf('n', order, type), `liste : ${type} à l’ordre ${order}`);
      assert.deepEqual(editor.newBranchStep('n', order, type), branchStepOf('n', order, type), `branche : ${type} à l’ordre ${order}`);
    }
  }
});

test('ajout au bout du fil principal : même résultat que la liste de l’ancien éditeur', () => {
  const types = ['profile_visit', 'connection_request', 'wait_connection', 'message', 'wait_reply'];
  let mine = [];
  let old = [];
  types.forEach((type, i) => {
    const id = `n${i}`;
    const flow = editor.buildEditorFlow(mine);
    assert.ok(flow.add, 'fil principal sans « Ajouter une étape »');
    mine = editor.addStepAt(mine, flow.add, type, id).steps;
    // addStep de SequenceBuilder : étape vide à l'ordre suivant, reliée par chainAfterLastMainStep.
    old = [...graph.chainAfterLastMainStep(old, id), listStepOf(id, graph.nextStepOrder(old), type)];
  });
  assert.deepEqual(mine, old);
  // Fil principal chaîné par « Étape suivante » (séquence de l'onglet Visuel) : relié comme dans la liste.
  const chained = [{ ...listStepOf('a', 0, 'profile_visit'), nextStepId: 'b' }, listStepOf('b', 1, 'connection_request')];
  const added = editor.addStepAt(chained, editor.buildEditorFlow(chained).add, 'wait_connection', 'c').steps;
  assert.deepEqual(added, [...graph.chainAfterLastMainStep(chained, 'c'), listStepOf('c', 2, 'wait_connection')]);
  assert.equal(added.find((s) => s.id === 'b').nextStepId, 'c');
  // Séquence vide : première étape de la liste, sans délai.
  assert.deepEqual(editor.addStepAt([], { afterStepId: null }, 'profile_visit', 'x').steps, [listStepOf('x', 0, 'profile_visit')]);
  assert.equal(editor.addStepAt(chained, { afterStepId: null }, 'profile_visit', 'x').newStepId, null, 'plus de première étape dans un fil non vide');
});

test('ajout dans une branche : même geste que l’onglet Visuel, l’autre branche reste où elle allait', () => {
  // Vérification en bout de fil : branches vides.
  let steps = [listStepOf('v', 0, 'profile_visit'), listStepOf('c', 1, 'check_connection')];
  let flow = editor.buildEditorFlow(steps);
  const check = findNode(flow.nodes, 'c');
  assert.deepEqual(check.branches.map((b) => [b.label, b.add]), [
    ['Connecté (1er degré)', { afterStepId: 'c', branch: 'true' }],
    ['Non connecté', { afterStepId: 'c', branch: 'false' }],
  ]);
  assert.equal(flow.add, null, 'pas d’ajout sous une fourche : chaque branche a le sien');
  steps = editor.addStepAt(steps, check.branches[0].add, 'message', 'm').steps;
  // handleAddStep de l'onglet Visuel : la fourche renvoie vers la nouvelle étape, créée sans délai.
  assert.deepEqual(steps, [steps[0], { ...listStepOf('c', 1, 'check_connection'), ifTrueGotoStep: 'm' }, branchStepOf('m', 2, 'message')]);
  flow = editor.buildEditorFlow(steps);
  // L'autre branche, sans étape choisie, est dessinée vide (validateSequence la signale, bloquant) ; y ajouter la remplit.
  assert.deepEqual(branchOf(flow, 'Non connecté').nodes.map((n) => n.kind), ['end']);
  assert.deepEqual(branchOf(flow, 'Non connecté').add, { afterStepId: 'c', branch: 'false' });
  assert.ok(graph.validateStepGraph(steps).some((e) => e.includes('la branche Non connecté est vide')));
  steps = editor.addStepAt(steps, branchOf(flow, 'Non connecté').add, 'connection_request', 'i').steps;
  assert.equal(steps.find((s) => s.id === 'c').ifFalseGotoStep, 'i');
  assert.equal(steps.find((s) => s.id === 'i').nextStepId, undefined, 'branche partie de rien : pas de renvoi');
  assert.deepEqual(graph.validateStepGraph(steps), []);
  // Au bout d'une branche : la dernière carte renvoie vers la nouvelle étape (comme afterStepId de l'onglet Visuel).
  flow = editor.buildEditorFlow(steps);
  assert.deepEqual(branchOf(flow, 'Non connecté').add, { afterStepId: 'i' });
  steps = editor.addStepAt(steps, branchOf(flow, 'Non connecté').add, 'wait_connection', 'w').steps;
  assert.equal(steps.find((s) => s.id === 'i').nextStepId, 'w');
  assert.deepEqual(steps.find((s) => s.id === 'w'), branchStepOf('w', 4, 'wait_connection'));
  flow = editor.buildEditorFlow(steps);
  assert.deepEqual(renderedIds(flow.nodes), ['v', 'c', 'm', 'i', 'w']);
  assert.match(findNode(flow.nodes, 'w').note, /^Sans acceptation après 3 jours, la séquence passe à l’étape suivante\.$/);

  // Vérification au milieu du fil : la branche choisie part de rien, l'autre garde l'étape où elle allait,
  // avec toute sa suite (le moteur ne passe jamais à l'ordre suivant après une étape visée par un renvoi).
  const middle = [
    listStepOf('a', 0, 'profile_visit'),
    listStepOf('b', 1, 'check_connection'),
    listStepOf('d', 2, 'message'),
    listStepOf('f', 3, 'inmail'),
    listStepOf('g', 4, 'message'),
  ];
  const middleFlow = editor.buildEditorFlow(middle);
  assert.deepEqual(renderedIds(branchOf(middleFlow, 'Connecté (1er degré)').nodes), ['d', 'f', 'g']);
  assert.deepEqual(branchOf(middleFlow, 'Non connecté').nodes.map((n) => n.kind), ['join']);
  const split = editor.addStepAt(middle, branchOf(middleFlow, 'Non connecté').add, 'connection_request', 'e').steps;
  const fork = split.find((s) => s.id === 'b');
  assert.equal(fork.ifFalseGotoStep, 'e');
  assert.equal(fork.ifTrueGotoStep, 'd', 'branche Connecté : même étape qu’avant, désormais explicite');
  const splitFlow = editor.buildEditorFlow(split);
  assert.deepEqual(renderedIds(branchOf(splitFlow, 'Connecté (1er degré)').nodes), ['d', 'f', 'g'], 'branche Connecté : toute sa suite gardée');
  assert.deepEqual(renderedIds(branchOf(splitFlow, 'Non connecté').nodes), ['e']);
  assert.deepEqual(splitFlow.orphans, [], 'aucune étape hors du parcours');
  // Ce que reçoit un candidat déjà en relation ne change pas : renvois écrits, même suite pour le moteur.
  assert.deepEqual(['d', 'f', 'g'].map((id) => graph.engineNextStepId(split.find((s) => s.id === id), split)), ['f', 'g', null]);
  assert.deepEqual(graph.validateStepGraph(split), []);
  assert.ok(!graph.validateSequence({ name: 'x', steps: split }).warnings.some((w) => w.check === 'unreachable'));
});

test('branche qui rejoint une étape : la nouvelle étape s’intercale ; repli d’une attente', () => {
  const invite = listStepOf('i', 0, 'connection_request');
  const wait = { ...listStepOf('w', 1, 'wait_connection'), timeoutAction: 'alternative_step', timeoutBranchStepId: 't', nextStepId: 'm' };
  const message = { ...listStepOf('m', 2, 'message'), nextStepId: '__end__' };
  const inmail = { ...listStepOf('t', 3, 'inmail'), nextStepId: 'm' };
  const steps = [invite, wait, message, inmail];
  const flow = editor.buildEditorFlow(steps);
  const timeout = branchOf(flow, 'Pas acceptée après 3 jours');
  assert.deepEqual(timeout.nodes.map((n) => n.kind), ['step', 'join']);
  assert.deepEqual(timeout.add, { afterStepId: 't' });
  const inserted = editor.addStepAt(steps, timeout.add, 'wait_reply', 'r').steps;
  assert.equal(inserted.find((s) => s.id === 't').nextStepId, 'r');
  assert.equal(inserted.find((s) => s.id === 'r').nextStepId, 'm', 'la jointure est gardée');
  assert.deepEqual(renderedIds(editor.buildEditorFlow(inserted).nodes), ['i', 'w', 'm', 't', 'r']);
  // « Aller à une étape de repli » sans étape : branche « Pas acceptée » vide, l'ajout la remplit.
  const open = [invite, { ...listStepOf('w', 1, 'wait_connection'), timeoutAction: 'alternative_step' }];
  const openFlow = editor.buildEditorFlow(open);
  assert.deepEqual(branchOf(openFlow, 'Pas acceptée après 3 jours').add, { afterStepId: 'w', branch: 'timeout' });
  const filled = editor.addStepAt(open, { afterStepId: 'w', branch: 'timeout' }, 'inmail', 'x').steps;
  assert.equal(filled.find((s) => s.id === 'w').timeoutBranchStepId, 'x');
  assert.deepEqual(graph.validateStepGraph(filled), []);
});

test('chaque emplacement du fil reçoit l’étape là où il le montre, sans rien perdre (jeux de référence, Séquence recommandée)', () => {
  const shapes = [
    ...fixtures.sequences.map((s) => ({ name: s.name, steps: s.rows.map(graph.rowToSequenceStep) })),
    { name: 'Séquence recommandée', steps: starters.generateRecommendedSequence() },
    ...starters.STARTER_TEMPLATES.map((t) => ({ name: t.name, steps: t.build() })),
    // Vérification ajoutée dans l'ancienne liste : aucune branche choisie, les deux suivent l'ordre.
    {
      name: 'Vérification sans branche choisie',
      steps: ['profile_visit', 'check_connection', 'message', 'inmail', 'message'].map((t, i) => listStepOf(`o${i}`, i, t)),
    },
  ];
  for (const { name, steps } of shapes) {
    const flow = editor.buildEditorFlow(steps);
    const before = renderedIds(flow.nodes);
    assert.equal(new Set(before).size, before.length, `${name} : une étape dessinée deux fois`);
    // Chaque étape est dessinée une fois (versions B et C dans leur carte) : dans le fil, ou « Hors du parcours ».
    const orphans = flow.orphans.map((n) => n.id);
    for (const id of orphans) assert.ok(!before.includes(id), `${name} : ${id} à la fois dans le fil et hors du parcours`);
    assert.deepEqual([...before, ...orphans].sort(), graph.getPrimarySteps(steps).map((s) => s.id).sort(), `${name} : étape absente`);
    for (const { position, branch } of addPositions(flow)) {
      // La visite de profil est permise partout : l'emplacement est valable.
      assert.equal(graph.isStepAllowedAt(steps, position, 'profile_visit').allowed, true, `${name} : emplacement refusé`);
      const result = editor.addStepAt(steps, position, 'profile_visit', 'nouvelle');
      assert.equal(result.newStepId, 'nouvelle', `${name} : ajout refusé (${JSON.stringify(position)})`);
      assert.equal(result.steps.length, steps.length + 1);
      const after = editor.buildEditorFlow(result.steps);
      const ids = renderedIds(after.nodes);
      // Une étape dessinée dans le fil y reste : un ajout ne la fait jamais passer « Hors du parcours ».
      for (const id of before) assert.ok(ids.includes(id), `${name} : ${id} sortie du fil après l’ajout (${JSON.stringify(position)})`);
      for (const id of orphans) assert.ok(ids.includes(id) || after.orphans.some((n) => n.id === id), `${name} : ${id} perdue après l’ajout`);
      assert.equal(ids.filter((id) => id === 'nouvelle').length, 1, `${name} : nouvelle étape non dessinée`);
      if (branch) assert.ok(renderedIds(branchOf(after, branch).nodes).includes('nouvelle'), `${name} : pas dans la branche ${branch}`);
    }
  }
});

test('types fermés : lisibles et signalés là où ils existent, jamais dans la palette', () => {
  const closed = fixtures.sequences.flatMap((s) => s.rows).filter((r) => !graph.isStepTypeOffered(r.action_type));
  assert.ok(closed.length >= 4, 'jeux sans types fermés');
  for (const seqFixture of fixtures.sequences) {
    const steps = seqFixture.rows.map(graph.rowToSequenceStep);
    const flow = editor.buildEditorFlow(steps);
    for (const id of renderedIds(flow.nodes)) {
      const node = findNode(flow.nodes, id);
      const notice = graph.unsupportedStepNotice(node.actionType);
      assert.equal(node.notice, notice);
      assert.equal(node.badges.includes('Non pris en charge'), !!notice, `${seqFixture.name} : badge de ${node.actionType}`);
    }
  }
});

test('versions, réglages communs et suite : mêmes règles que l’ancien éditeur', () => {
  const base = [listStepOf('a', 0, 'connection_request'), listStepOf('b', 1, 'message')];
  const withB = graph.addVariantToSteps(base, 'b', 'b2');
  assert.deepEqual(editor.versionsOf(withB, 'b2').map((s) => [s.id, s.variantGroup, s.variantWeight]), [['b', 'A', 50], ['b2', 'B', 50]]);
  assert.equal(editor.primaryOf(withB, 'b2').id, 'b');
  assert.equal(editor.canHaveVersions('message'), true);
  assert.equal(editor.canHaveVersions('wait_connection'), false);
  assert.equal(editor.MAX_VERSIONS, 3);
  // Réglage commun : écrit sur chaque version ; champ de version : sur une seule.
  const delayed = editor.updateStepGroup(withB, 'b2', { delayDays: 4 });
  assert.deepEqual(delayed.map((s) => s.delayDays), [0, 4, 4]);
  const texted = editor.updateVersion(withB, 'b2', { messageTemplate: 'B' });
  assert.deepEqual(texted.map((s) => s.messageTemplate ?? ''), ['', '', 'B']);
  // « Après cette étape » : continuer, terminer, aller à une étape.
  assert.deepEqual(editor.setAfterStep(withB, 'b', 'end').filter((s) => s.order === 1).map((s) => s.nextStepId), ['__end__', '__end__']);
  assert.equal(editor.afterStepValue({ nextStepId: '__end__' }), 'end');
  assert.equal(editor.afterStepValue({}), 'continue');
  assert.equal(editor.afterStepValue({ nextStepId: 'x' }), 'x');
  assert.deepEqual(editor.setAfterStep(editor.setAfterStep(withB, 'b', 'a'), 'b', 'continue').map((s) => s.nextStepId), [undefined, undefined, undefined]);
  // « Continuer » dit où va le moteur : l'étape d'ordre suivant, sauf après une étape visée par un renvoi.
  assert.equal(editor.continueTarget(withB, 'a'), 'b');
  assert.equal(editor.continueTarget(withB, 'b2'), null, 'dernière étape : rien ne suit');
  const branched = [listStepOf('v', 0, 'profile_visit'), listStepOf('c', 1, 'check_connection'), listStepOf('m', 2, 'message'), listStepOf('r', 3, 'inmail')];
  const added = editor.addStepAt(branched, { afterStepId: 'c', branch: 'false' }, 'message', 'n').steps;
  const inmailBranch = added.find((s) => s.id === 'n');
  assert.equal(graph.engineNextStepId(inmailBranch, added), null, 'première étape d’une branche : le moteur s’arrête après elle');
  assert.equal(editor.continueTarget(added, 'n'), null, 'jamais « Continuer » pour une étape où le moteur s’arrête');
  // Branche « Connecté » épinglée par l'ajout : sa suite est écrite (« Aller à l'étape 4 »), « Continuer » l'arrêterait.
  assert.equal(editor.afterStepValue(added.find((s) => s.id === 'm')), 'r');
  assert.equal(editor.continueTarget(added, 'm'), null);
  // Étape de branche qui rejoint une étape : « Continuer » effacerait ce lien et terminerait la branche.
  const rejoining = editor.addStepAt(added, { afterStepId: 'n' }, 'inmail', 'j').steps.map((s) => (s.id === 'j' ? { ...s, nextStepId: 'r' } : s));
  assert.equal(editor.continueTarget(rejoining, 'j'), null);
  // Ouverture : la transformation de l'ancien éditeur (invitation « IA » : la note part).
  const ai = [{ ...listStepOf('a', 0, 'connection_request'), useAiPersonalization: true, messageTemplate: 'Note' }];
  assert.deepEqual(editor.openEditorSteps(ai), graph.withoutInvitationAi(ai));
  assert.equal(editor.openEditorSteps(ai)[0].useAiPersonalization, false);
});

test('déplacer une étape : le fil garde ses liens, une étape reliée à une fourche ne bouge pas', () => {
  const linear = ['profile_visit', 'connection_request', 'wait_connection', 'message'].map((t, i) => listStepOf(`l${i}`, i, t));
  const moved = editor.moveStep(linear, 'l2', 'up');
  assert.deepEqual(renderedIds(editor.buildEditorFlow(moved).nodes), ['l0', 'l2', 'l1', 'l3']);
  assert.ok(moved.every((s) => s.nextStepId === undefined), 'fil à l’ordre : seuls les ordres changent');
  assert.deepEqual(editor.moveStep(moved, 'l2', 'down'), linear);
  assert.deepEqual(editor.canMoveStep(linear, 'l0', 'up'), { allowed: false, reason: 'Rien à monter : c’est la première étape de ce fil.' });
  assert.deepEqual(editor.canMoveStep(linear, 'l3', 'down'), { allowed: false, reason: 'Rien à descendre : c’est la dernière étape de ce fil.' });
  // Fil chaîné par renvois (Séquence recommandée, branche Connecté) : renvois reportés, ordres échangés.
  const rec = starters.generateRecommendedSequence();
  const recMoved = editor.moveStep(rec, rec[4].id, 'up');
  const connected = (steps) => renderedIds(branchOf(editor.buildEditorFlow(steps), 'Connecté (1er degré)').nodes);
  assert.deepEqual(connected(recMoved), [rec[2].id, rec[4].id, rec[3].id, rec[5].id, rec[6].id]);
  assert.deepEqual(graph.validateStepGraph(recMoved), []);
  assert.equal(renderedIds(editor.buildEditorFlow(recMoved).nodes).length, 17);
  // Première étape d'une branche, fourche, attente avec repli : rien ne bouge.
  assert.equal(editor.moveStep(rec, rec[2].id, 'up'), null);
  assert.equal(editor.canMoveStep(rec, rec[1].id, 'down').allowed, false);
  assert.match(editor.canMoveStep(rec, rec[8].id, 'down').reason, /fourche ou à une étape de repli/);
  // Versions A/B déplacées ensemble.
  const ab = graph.addVariantToSteps(linear, 'l3', 'l3b');
  const abMoved = editor.moveStep(ab, 'l3b', 'up');
  assert.deepEqual(abMoved.filter((s) => s.id.startsWith('l3')).map((s) => s.order), [2, 2]);
});

test('points de validateSequence rangés par étape ; sous-titre du panneau', () => {
  const steps = [listStepOf('a', 0, 'connection_request'), listStepOf('b', 1, 'message'), listStepOf('c', 2, 'email')];
  const withB = graph.addVariantToSteps(steps, 'b', 'b2');
  const validation = graph.validateSequence({ name: '', steps: withB });
  const issues = editor.issuesByOrder(validation);
  assert.deepEqual(issues.get(1).errors, ['Message à rédiger.']);
  assert.ok(issues.get(2).warnings.some((w) => w.startsWith('Les étapes e-mail ne partent pas encore')));
  assert.ok(!issues.has(0) || issues.get(0).errors.length === 0);
  // Points sans étape (nom de la séquence) : pas sur une carte.
  for (const entry of issues.values()) for (const text of [...entry.errors, ...entry.warnings]) assert.doesNotMatch(text, /^Donnez un nom/);
  const flow = editor.buildEditorFlow(starters.generateRecommendedSequence());
  const rec = starters.generateRecommendedSequence();
  const flowRec = editor.buildEditorFlow(rec);
  assert.equal(editor.placementText(flowRec.placements.get(rec[0].id)), 'Première étape, dès l’inscription');
  assert.equal(editor.placementText(flowRec.placements.get(rec[1].id)), 'Attendre 2 minutes'.replace('Attendre ', '').replace(/^./, (c) => c.toUpperCase()) + ' après l’étape 1');
  assert.equal(editor.placementText(flowRec.placements.get(rec[2].id)), 'Branche « Connecté (1er degré) », aussitôt après l’étape 2');
  assert.equal(editor.placementText(flowRec.placements.get(rec[14].id)), 'Branche « Pas acceptée après 3 jours », aussitôt après l’étape 9');
  assert.ok(flow.stepCount === 17);
});

// ── Partie 2 : gardes statiques ───────────────────────────────────────────

const EDITOR_FILES = [
  ...walk('src/components/sequences/editor'),
  'src/hooks/useSequenceEditor.ts',
  'src/lib/sequenceEditor.ts',
];
const codeOf = (rel) => read(rel).replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

test('éditeur : composants du plan, aucun canevas, aucun mode, aucun stockage local', () => {
  for (const name of ['SequenceFlow', 'StepCard', 'DelayPill', 'BranchColumns', 'AddStepButton', 'AddStepPalette', 'EndMarker', 'StepPanel']) {
    assert.ok(existsSync(join(ROOT, `src/components/sequences/editor/${name}.tsx`)), `${name}.tsx absent`);
  }
  for (const rel of EDITOR_FILES) {
    const code = codeOf(rel);
    assert.doesNotMatch(code, /@xyflow|ReactFlow/, `${rel} : canevas`);
    assert.doesNotMatch(code, MODE_WORDS, `${rel} : mode d’éditeur`);
    assert.doesNotMatch(code, /localStorage|sessionStorage|indexedDB/, `${rel} : stockage local`);
    assert.doesNotMatch(code, /<(?:button|input|select|textarea)\b/, `${rel} : contrôle brut`);
    assert.doesNotMatch(code, /—/, `${rel} : tiret long`);
    assert.doesNotMatch(code, VENDORS, `${rel} : nom de prestataire`);
    assert.doesNotMatch(code, /:\s*any\b|as any\b/, `${rel} : any`);
  }
});

test('éditeur : validateSequence seule règle, aucun appel serveur nouveau', () => {
  for (const rel of walk('src/components/sequences/editor')) {
    const code = codeOf(rel);
    assert.doesNotMatch(code, /validateStepGraph|findUnknownTemplateVariables|computeSaveWarnings|getAvailableStepTypes/, `${rel} : règle propre`);
    assert.doesNotMatch(code, /supabase|invokeEdgeFunction|fetch\(/, `${rel} : appel serveur`);
  }
  const hook = codeOf('src/hooks/useSequenceEditor.ts');
  assert.deepEqual([...hook.matchAll(/\.from\('(\w+)'\)/g)].map((m) => m[1]), ['sequence_step_executions'], 'seule lecture : l’historique d’une étape avant suppression');
  assert.match(hook, /\.select\('id', \{ count: 'exact', head: true \}\)/);
  assert.match(hook, /const HISTORY_EXECUTION_STATUSES = \['sent', 'opened', 'clicked', 'replied', 'bounced', 'failed', 'skipped'\];/);
  assert.doesNotMatch(hook, /\.rpc\(|invokeEdgeFunction|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  assert.match(read('src/components/outreach/SequenceBuilder.tsx'), /const HISTORY_EXECUTION_STATUSES = \['sent', 'opened', 'clicked', 'replied', 'bounced', 'failed', 'skipped'\];/);
  // Points des cartes : validateSequence de la session d'édition (page et création), rangés par issuesByOrder.
  const page = read('src/pages/SequenceDetailPage.tsx');
  assert.match(page, /const editorValidation = session\.validation;/);
  assert.match(read('src/hooks/useSequenceEditorSession.ts'), /const validation = useMemo\(\(\) => validateSequence\(/);
  assert.match(read('src/components/sequences/editor/StepsEditor.tsx'), /const issues = useMemo\(\(\) => issuesByOrder\(validation\), \[validation\]\);/);
  // Palette jugée par isStepAllowedAt, sur ADD_STEP_PALETTE.
  const palette = read('src/components/sequences/editor/AddStepPalette.tsx');
  assert.match(palette, /const allowance = isStepAllowedAt\(steps, position, type\);/);
  assert.match(palette, /entries\(ADD_STEP_PALETTE\.linkedin\)/);
  assert.match(palette, /entries\(ADD_STEP_PALETTE\.conditions\)/);
  assert.match(palette, /aria-disabled=\{!allowance\.allowed \|\| undefined\}/);
  assert.match(palette, /\{allowance\.allowed \? DESCRIPTIONS\[type\] : allowance\.reason\}/);
});

test('panneau d’étape : rédaction par l’IA avec la phrase de relecture, champs de l’ancien éditeur', () => {
  const panel = read('src/components/sequences/editor/StepPanel.tsx');
  assert.match(panel, /export const AI_WRITES_NOTICE = 'Chaque message sera généré et relu avant l’inscription\. Un message non relu ne part pas\.';/);
  assert.match(panel, /\{ value: 'ai', label: 'L’IA rédige pour chaque candidat' \}/);
  assert.match(panel, /\{ value: 'manual', label: 'Je rédige' \}/);
  assert.match(panel, /\{usesAi && <p className="[^"]*">\{AI_WRITES_NOTICE\}<\/p>\}/);
  // L'option IA n'est proposée que là où l'ancien éditeur la proposait (jamais pour l'invitation).
  assert.match(panel, /const aiAllowed = stepAllowsAi\(type\);/);
  for (const label of [
    'Versions de l’étape', 'Ajouter une version', 'Objet', 'Note d’invitation', 'Cc', 'Cci', 'Lien de désinscription', 'Signature',
    'Si connecté (1er degré), aller à', 'Si non connecté, aller à', 'Attendre au plus (jours)', 'Si rien ne se passe', 'Étape de repli',
    'Plus d’options', 'Délai', 'Créneau d’envoi', 'Pas avant', 'Pas après', 'Faire cette étape seulement si', 'Après cette étape',
    'Répartition A/B', 'Seuil de note (0 à 100)', 'Ton',
  ]) assert.ok(panel.includes(label), `champ absent : ${label}`);
  assert.match(panel, /id="subject"/);
  assert.match(panel, /id="message"/);
  assert.match(panel, /maxLength=\{isInvite \? INVITE_NOTE_MAX : undefined\}/);
  assert.match(panel, /\{textLength\} sur \{INVITE_NOTE_MAX\} caractères/);
  // Réglages communs écrits sur chaque version, champs de version sur une seule.
  assert.match(panel, /const updateActive = \(updates: Partial<Step>\) => onUpdateVersion\(active\.id, updates\);/);
  assert.match(panel, /const updateShared = \(updates: Partial<Step>\) => onUpdateStep\(primary\.id, updates\);/);
});

test('page d’une séquence : l’éditeur unique dans Étapes, le fil en lecture pour qui ne peut pas modifier', () => {
  const page = read('src/pages/SequenceDetailPage.tsx');
  assert.doesNotMatch(page, /SequenceBuilder/);
  assert.match(page, /\{canEdit\(sequence\) \? \(\s*<StepsEditor/);
  assert.match(page, /<StepsReadOnly\s+steps=\{sequence\.steps\}\s+canEdit=\{false\}/);
  // Ouverture : étapes relues par handleEdit, puis la transformation de l'ancien éditeur.
  assert.match(page, /setEditingSequence: openInEditor,/);
  assert.match(page, /resetEditor\(openEditorSteps\(next\.steps\)\);/);
  assert.match(page, /await handleEdit\(seq\);/);
  // État d'édition tenu par la page : il survit au changement d'onglet.
  assert.match(page, /const editor = useSequenceEditor\(\);/);
  // Panneau de 440 px : colonne séparée par un filet, collé en haut de la fenêtre (body sans conteneur de défilement).
  const stepsEditor = read('src/components/sequences/editor/StepsEditor.tsx');
  assert.match(stepsEditor, /w-\[440px\] shrink-0 border-l border-border">\s*<aside[\s\S]{0,200}sticky top-0/);
  assert.match(stepsEditor, /body\.style\.overflowX = 'clip';/);
  assert.match(stepsEditor, /body\.style\.overflowX = previous;/);
  // Barre de vérification dans la colonne du fil, hors de la zone qui défile en largeur.
  assert.ok(stepsEditor.indexOf('<ValidationBar') > stepsEditor.indexOf('ref={scrollRef}') && stepsEditor.indexOf('<ValidationBar') < stepsEditor.indexOf('w-[440px]'));
  assert.match(read('src/components/sequences/editor/StepsEditor.tsx'), /const PHONE_QUERY = '\(max-width: 767px\)';/);
});

// ── Partie 3 : message, aperçu réel, vérification, enregistrement ─────────

const beta = await loadPure('src/lib/sequencesBeta.ts');
const renderCases = JSON.parse(read('tests/fixtures/template-render-cases.json')).cases;

const msg = (id, order, text, extra = {}) => ({
  id, order, actionType: 'message', conditionType: 'always', delayDays: order ? 2 : 0, delayHours: 0, delayMinutes: 0,
  preferredHourStart: 9, preferredHourEnd: 18, messageTemplate: text, subjectTemplate: '', useAiPersonalization: false, aiTone: 'professional', ...extra,
});

test('validateSequence : sans option, aucun contrôle des variables (ancien éditeur) ; option « block » : point bloquant, ou recommandation avec texte de secours', () => {
  const sequence = { name: 'S', multiSenderEnabled: false, senderAccounts: [], steps: [msg('a', 0, 'Bonjour {{prenom}}, chez {{societe}}.')] };
  const byDefault = graph.validateSequence(sequence);
  assert.equal(byDefault.errors.filter((e) => e.check === 'unknown_variables').length, 0, 'défaut : comportement de l’ancien éditeur');
  assert.equal(byDefault.warnings.filter((e) => e.check === 'unknown_variables').length, 0);
  const blocked = graph.validateSequence(sequence, null, { unknownVariables: 'block' });
  assert.deepEqual(blocked.errors.filter((e) => e.check === 'unknown_variables').map((e) => e.message),
    ["Étape 1 : {{societe}} n’est pas une variable connue : elle serait retirée du message à l’envoi."]);
  // Variable personnelle de l'expéditeur : connue du moteur.
  assert.equal(graph.validateSequence(sequence, null, { unknownVariables: 'block', customKeys: ['Societe'] }).errors.length, 0);
  // Texte de secours : c'est toujours lui qui part, recommandation seulement.
  const fallback = graph.validateSequence({ ...sequence, steps: [msg('a', 0, 'Chez {{societe | fallback:"votre entreprise"}}.')] }, null, { unknownVariables: 'block' });
  assert.equal(fallback.errors.length, 0);
  assert.deepEqual(fallback.warnings.filter((w) => w.check === 'unknown_variables').map((w) => w.message),
    ["Étape 1 : {{societe}} n’est pas une variable connue : son texte de secours partira toujours."]);
  // Objet d'un InMail compris, version B nommée ; étape rédigée par l'IA : pas de contrôle (le modèle sert de structure).
  const steps = [
    msg('a', 0, 'Bonjour {{prenom}}', { actionType: 'inmail', subjectTemplate: 'Poste {{inconnue}}', variantGroup: 'A', variantWeight: 50 }),
    msg('b', 0, 'Salut {{autre}} et {{encore}}', { actionType: 'inmail', subjectTemplate: 'Poste', variantGroup: 'B', variantWeight: 50 }),
    msg('c', 1, 'Modèle {{nimporte}}', { useAiPersonalization: true }),
  ];
  const messages = graph.validateSequence({ ...sequence, steps }, null, { unknownVariables: 'block' }).errors.filter((e) => e.check === 'unknown_variables').map((e) => e.message);
  assert.deepEqual(messages, [
    "Étape 1 (A) : {{inconnue}} n’est pas une variable connue : elle serait retirée du message à l’envoi.",
    "Étape 1 (B) : {{autre}}, {{encore}} ne sont pas des variables connues : elles seraient retirées du message à l’envoi.",
  ]);
  // Rangés par étape (cartes, panneau) et nommant leur étape (« Voir » de la barre).
  const issues = editor.issuesByOrder({ errors: [{ check: 'unknown_variables', area: 'steps', message: messages[0] }], warnings: [] });
  assert.deepEqual(issues.get(0).errors, ["{{inconnue}} n’est pas une variable connue : elle serait retirée du message à l’envoi."]);
  assert.equal(editor.issueStepOrder(messages[1]), 0);
  assert.equal(editor.issueStepOrder('Donnez un nom à la séquence.'), null);
  assert.equal(editor.issueHasTarget({ area: 'senders', message: 'Aucun expéditeur…' }), true);
  assert.equal(editor.issueHasTarget({ area: 'info', message: 'Donnez un nom à la séquence.' }), false);
});

test('aperçu surligné : les morceaux donnent exactement le texte du moteur, un repère par donnée absente', () => {
  assert.ok(renderCases.length >= 10);
  for (const c of renderCases) {
    const expected = preview.renderTemplatePreview(c.text, c.values);
    const { segments, missing } = preview.renderTemplatePreviewSegments(c.text, c.values);
    assert.equal(segments.filter((x) => x.kind === 'text').map((x) => x.text).join(''), expected.text, c.name);
    assert.deepEqual(missing, expected.missing, c.name);
    assert.deepEqual([...new Set(segments.filter((x) => x.kind === 'missing').map((x) => x.key))].sort(), [...expected.missing].sort(), c.name);
  }
  const { segments } = preview.renderTemplatePreviewSegments('Bonjour {{prenom}}, chez {{entreprise_actuelle}}.', { prenom: 'Claire' });
  assert.deepEqual(segments, [{ kind: 'text', text: 'Bonjour Claire, chez' }, { kind: 'missing', key: 'entreprise_actuelle' }, { kind: 'text', text: '.' }]);
});

test('exemple fictif : une valeur pour chaque clé du moteur, alias compris', () => {
  const values = vars.exampleVariableValues(new Date(2026, 9, 6, 10, 0));
  for (const key of graph.SEQUENCE_TEMPLATE_KEYS) assert.ok(typeof values[key] === 'string' && values[key].trim(), `exemple manquant : ${key}`);
  assert.equal(values.prenom, 'Claire');
  assert.equal(values.first_name, 'Claire');
  assert.equal(values.salutation, 'Bonjour');
  assert.equal(vars.EXAMPLE_CANDIDATE_NAME, 'Claire Dubois');
});

test('création : /sequences/nouvelle?mission=<id>&depart=zero|modele:<clé>|copie:<id>', () => {
  assert.equal(beta.NEW_SEQUENCE_SLUG, 'nouvelle');
  assert.deepEqual(beta.parseNewSequenceStart('zero'), { kind: 'zero' });
  assert.deepEqual(beta.parseNewSequenceStart('modele:sequence-longue'), { kind: 'modele', key: 'sequence-longue' });
  assert.deepEqual(beta.parseNewSequenceStart('copie:0b9f'), { kind: 'copie', id: '0b9f' });
  for (const raw of [null, '', 'ia', 'modele:', 'autre:x']) assert.equal(beta.parseNewSequenceStart(raw), null, String(raw));
  assert.equal(beta.newSequencePath({ kind: 'zero' }), '/sequences/nouvelle?depart=zero');
  assert.equal(beta.newSequencePath({ kind: 'modele', key: 'sequence-longue' }, 'm1'), '/sequences/nouvelle?mission=m1&depart=modele:sequence-longue');
  assert.equal(beta.newSequencePath({ kind: 'copie', id: 's1' }, 'm1'), '/sequences/nouvelle?mission=m1&depart=copie:s1');
  // Chaque modèle Konekt s'ouvre par sa clé.
  for (const t of starters.STARTER_TEMPLATES) assert.match(t.key, /^[a-z0-9-]+$/);
  // Étapes en base retirées : versions comptées une fois (ancien removedPersistedStepCount).
  const base = [{ id: 'a', order: 0 }, { id: 'b1', order: 1 }, { id: 'b2', order: 1 }, { id: 'c', order: 2 }];
  assert.equal(editor.removedStepCount(base, [{ id: 'a' }, { id: 'c' }]), 1);
  assert.equal(editor.removedStepCount(base, [{ id: 'a' }, { id: 'b1' }]), 2);
  assert.equal(editor.removedStepCount(base, base), 0);
});

const PART3_FILES = [
  'src/components/sequences/editor/MessageEditor.tsx',
  'src/components/sequences/editor/VariableMenu.tsx',
  'src/components/sequences/editor/MessagePreview.tsx',
  'src/components/sequences/editor/ValidationBar.tsx',
  'src/components/sequences/editor/SaveDialogs.tsx',
  'src/components/sequences/NewSequenceDialog.tsx',
  'src/components/sequences/SequenceCreatePage.tsx',
  'src/hooks/useSequencePreview.ts',
  'src/hooks/useEditorSaveFlow.ts',
  'src/hooks/useLeaveGuard.ts',
  'src/hooks/useSequenceEditorDraft.ts',
  'src/hooks/useSequenceEditorSession.ts',
];

test('partie 3 : composants du plan ; textes en français, sans tiret long ni prestataire, aucun contrôle brut ni any', () => {
  for (const rel of PART3_FILES) {
    assert.ok(existsSync(join(ROOT, rel)), `${rel} absent`);
    const code = codeOf(rel);
    assert.doesNotMatch(code, /@xyflow|ReactFlow/, `${rel} : canevas`);
    assert.doesNotMatch(code, MODE_WORDS, `${rel} : mode d’éditeur`);
    assert.doesNotMatch(code, /<(?:button|input|select|textarea)\b/, `${rel} : contrôle brut`);
    assert.doesNotMatch(code, /—/, `${rel} : tiret long`);
    assert.doesNotMatch(code, VENDORS, `${rel} : nom de prestataire`);
    assert.doesNotMatch(code, /:\s*any\b|as any\b/, `${rel} : any`);
    assert.doesNotMatch(code, /window\.confirm|\bconfirm\(/, `${rel} : confirmation native`);
  }
});

test('variables : les puces écrivent les clés du moteur ; textes de secours dans la syntaxe du moteur ; variable inconnue soulignée', () => {
  const menu = read('src/components/sequences/editor/VariableMenu.tsx');
  assert.match(menu, /variableMenu\(new Date\(\)\)/, 'entrées du menu : variableMenu seulement');
  assert.match(menu, /onSelect=\{\(\) => onPick\(v\.key\)\}/);
  const field = read('src/components/sequences/editor/MessageEditor.tsx');
  assert.match(field, /const result = insertVariable\(value, range\.start, range\.end, key\);/);
  // « {{ » tapé : suggestions sous le champ, sans lui prendre le focus ; la frappe continue dans le message.
  assert.match(field, /variableQueryAt\(value, caret\)/);
  assert.match(field, /matchVariables\(queryText\)/);
  assert.match(field, /onOpenAutoFocus=\{\(event\) => event\.preventDefault\(\)\}/);
  assert.match(field, /const result = insertVariable\(value, query\.start, caret, key\);/);
  assert.match(field, /aria-activedescendant=/);
  assert.doesNotMatch(field, /next\.slice\(caret - 2, caret\) === '\{\{'/, '« {{ » n’ouvre plus le menu « + Variable » (il prenait le focus et la frappe)');
  assert.match(field, /onChange\(setVariableFallback\(text, variable\.key, e\.target\.value\)\)/);
  assert.match(field, /Si \{label\} manque, écrire :/);
  assert.match(field, /decoration-danger decoration-wavy/);
  assert.match(field, /<Textarea\b/);
  // Chaque entrée du menu écrit une clé française du moteur.
  for (const v of vars.SEQUENCE_VARIABLES) assert.ok(graph.SEQUENCE_TEMPLATE_KEYS.includes(v.key), v.key);
});

test('saisie de « {{ » : variable en cours de frappe, suggestions filtrées par clé ou libellé, clé tapée en entier gardée', () => {
  // Juste après « {{ » : toutes les variables, dans l'ordre du menu.
  assert.deepEqual(vars.variableQueryAt('Bonjour {{', 10), { start: 8, query: '' });
  assert.equal(vars.matchVariables('').length, vars.SEQUENCE_VARIABLES.length);
  // La frappe continue de filtrer : clé du moteur ou libellé français, accents ignorés.
  assert.deepEqual(vars.variableQueryAt('Bonjour {{pre', 13), { start: 8, query: 'pre' });
  assert.deepEqual(vars.matchVariables('prenom').map((v) => v.key), ['prenom', 'mon_prenom']);
  assert.deepEqual(vars.matchVariables('Prén').map((v) => v.key), ['prenom', 'mon_prenom']);
  assert.ok(vars.matchVariables('entre').some((v) => v.key === 'entreprise_actuelle'));
  assert.deepEqual(vars.matchVariables('zzz'), [], 'rien ne répond : pas de liste');
  // Espace, accolade fermante ou ponctuation : plus de suggestion, rien n'est perdu.
  assert.equal(vars.variableQueryAt('Bonjour {{prenom}}', 18), null);
  assert.equal(vars.variableQueryAt('Bonjour {{prenom}', 17), null);
  assert.equal(vars.variableQueryAt('Bonjour {{ merci', 16), null);
  assert.equal(vars.variableQueryAt('Bonjour', 7), null);
  // Curseur dans une variable déjà fermée : rien à compléter ; avant une autre variable : suggestions.
  assert.equal(vars.variableQueryAt('Bonjour {{prenom}} merci', 14), null);
  assert.equal(vars.variableQueryAt('Bonjour {{prenom | fallback:"Madame"}}', 16), null);
  assert.deepEqual(vars.variableQueryAt('Bonjour {{pr merci {{nom}}', 12), { start: 8, query: 'pr' });
  // Choix d'une suggestion : « {{ » et la saisie remplacés par la clé du moteur, curseur après la variable.
  assert.deepEqual(vars.insertVariable('Bonjour {{pre merci', 8, 13, 'prenom'), { text: 'Bonjour {{prenom}} merci', caret: 18 });
});

test('aperçu réel : preview_values seul appel nouveau ; inscrits, Retenus, exemple ; textes de la spécification ; jamais en stockage local', () => {
  const hook = read('src/hooks/useSequencePreview.ts');
  const hookCode = codeOf('src/hooks/useSequencePreview.ts');
  // Lectures sous la RLS de l'appelant : inscriptions de la séquence, Retenus de la mission, titre du poste.
  assert.deepEqual([...hookCode.matchAll(/\.from\('(\w+)'\)/g)].map((m) => m[1]), ['sequence_enrollments', 'sourcing_projects', 'mission_candidate_rows']);
  assert.match(hookCode, /\.eq\('general_stage', 'retained'\)/);
  assert.match(hookCode, /fetchPreviewValuesPage\(/);
  assert.doesNotMatch(hookCode, /invokeEdgeFunction|\.rpc\(|\.insert\(|\.update\(|\.upsert\(|\.delete\(/);
  assert.match(hookCode, /status: 'ready',\s*subjects: \[\.\.\.real, example\],/, 'l’exemple en dernier');
  // Candidat effacé (RGPD) ou absent de la réponse : jamais montré.
  assert.match(hookCode, /if \(!entry \|\| \(entry\.status === 'unavailable' && !entry\.retryable\)\) continue;/);
  assert.match(hook, /enrollment_ids|enrollmentIds/);
  assert.match(read('src/hooks/usePreviewValues.ts'), /\.\.\.\(enrollmentIds\.length > 0 \? \{ enrollment_ids: \[\.\.\.enrollmentIds\] \} : \{\}\),/);
  assert.match(read('src/hooks/usePreviewValues.ts'), /invokeEdgeFunction<PreviewValuesResponse>\('draft-sequence', \{\s*action: 'preview_values',/);
  // Aucune valeur d'aperçu écrite dans le stockage du navigateur.
  for (const rel of ['src/hooks/useSequencePreview.ts', 'src/components/sequences/editor/MessagePreview.tsx', 'src/hooks/useSequenceEditorSession.ts']) {
    assert.doesNotMatch(codeOf(rel), /localStorage|sessionStorage|indexedDB|saveEditorDraft/, rel);
  }
  // Le brouillon ne garde que ce qui sera enregistré : étapes, nom, réglages.
  assert.match(read('src/pages/SequenceDetailPage.tsx'), /const draftValue = useMemo<EditorDraftValue>\(\(\) => \(\{ steps: editor\.steps, settings: settingsDraft \}\)/);
  assert.match(read('src/components/sequences/SequenceCreatePage.tsx'), /const draftValue = useMemo<CreateDraftValue>\(\(\) => \(\{ name, steps: editor\.steps, settings: settingsDraft \}\)/);
  // Rendu : la copie du moteur ; texte sans aperçu pendant le chargement.
  const view = read('src/components/sequences/editor/MessagePreview.tsx');
  assert.match(view, /renderTemplatePreviewSegments\(template, values\)/);
  assert.match(view, /export const AI_PREVIEW_NOTICE = 'Rédigé et relu pour chaque candidat avant l’inscription\.';/);
  assert.match(view, /export const EXAMPLE_ONLY_NOTICE = 'Aperçu sur un exemple\. Retenez des candidats dans la mission pour voir leurs vrais messages\.';/);
  assert.match(view, /role="status" aria-label="Préparation de l’aperçu"/);
  assert.match(view, /aria-label="Candidat précédent"/);
  assert.match(view, /aria-label="Candidat suivant"/);
  assert.match(view, /inviteNoteText\(sentText\)/, 'note d’invitation coupée comme le moteur');
  assert.match(view, /sur \$\{INVITE_NOTE_MAX\} caractères pour ce candidat/);
  // Étape IA : la phrase de relecture du panneau reste celle du plan.
  assert.match(read('src/components/sequences/editor/StepPanel.tsx'), /\{usesAi && <p className="[^"]*">\{AI_WRITES_NOTICE\}<\/p>\}/);
});

test('vérification et enregistrement : validateSequence seule règle, useSequenceSave seul chemin d’écriture des étapes', () => {
  const session = read('src/hooks/useSequenceEditorSession.ts');
  assert.match(session, /\{ unknownVariables: 'block', customKeys \}/);
  assert.doesNotMatch(codeOf('src/hooks/useSequenceEditorSession.ts'), /validateStepGraph|findUnknownTemplateVariables|computeSaveWarnings/);
  const bar = read('src/components/sequences/editor/ValidationBar.tsx');
  assert.match(bar, /plural\(errors\.length, 'point à corriger', 'points à corriger'\)\} avant d’enregistrer/);
  assert.match(bar, /plural\(warnings\.length, 'recommandation', 'recommandations'\)/);
  assert.match(bar, /sticky bottom-0/);
  assert.doesNotMatch(codeOf('src/components/sequences/editor/ValidationBar.tsx'), /validateSequence\(/, 'la barre affiche, elle ne vérifie pas');
  // Fenêtres et gardes de l'ancien éditeur, dans le même ordre.
  const flow = read('src/hooks/useEditorSaveFlow.ts');
  assert.match(flow, /export const CONFIRM_BEFORE_SAVE_CHECKS: readonly string\[\] = \['unreachable', 'retired_condition', 'unknown_variables'\];/);
  assert.ok(flow.indexOf('if (errors.length > 0)') < flow.indexOf('removedStepCount > 0') && flow.indexOf('removedStepCount > 0') < flow.indexOf('CONFIRM_BEFORE_SAVE_CHECKS.includes'));
  const dialogs = read('src/components/sequences/editor/SaveDialogs.tsx');
  for (const title of ['Enregistrer malgré ces points ?', 'Quitter sans enregistrer ?']) assert.ok(dialogs.includes(`<AlertDialogTitle>${title}</AlertDialogTitle>`), title);
  assert.match(dialogs, /Supprimer et enregistrer/);
  // Ctrl/Cmd+S et brouillon local (editorDraft, sous try/catch).
  assert.match(session, /if \(!\(event\.ctrlKey \|\| event\.metaKey\) \|\| event\.altKey \|\| event\.key\.toLowerCase\(\) !== 's'\) return;\s*event\.preventDefault\(\);/);
  const draft = read('src/hooks/useSequenceEditorDraft.ts');
  assert.match(draft, /from '@\/lib\/editorDraft'/);
  assert.match(draft, /try \{\s*if \(d\) saveEditorDraft/);
  assert.match(draft, /stored\.base !== base/, 'repris seulement sur le même état enregistré');
  // Étapes écrites par useSequenceSave (save_sequence_steps), jamais directement.
  for (const rel of ['src/pages/SequenceDetailPage.tsx', 'src/components/sequences/SequenceCreatePage.tsx']) {
    const code = codeOf(rel);
    assert.match(code, /const \{ handleSaveSequence \} = useSequenceSave\(\{/, rel);
    assert.match(code, /await handleSaveSequence\(/, rel);
    assert.doesNotMatch(code, /from\('sequence_steps'\)\s*\.(?:insert|update|upsert|delete)|\.rpc\('save_sequence_steps'/, rel);
  }
  assert.match(read('src/pages/SequenceDetailPage.tsx'), /steps: editor\.steps,/);
  assert.match(read('src/hooks/useSequenceSave.ts'), /if \(createdSequenceId\) onCreated\?\.\(createdSequenceId\);/);
  // Formule gratuite : créée sans envoi par la règle existante (« Brouillon »), dite avec le texte de la spécification (section 4).
  const save = read('src/hooks/useSequenceSave.ts');
  assert.match(save, /const createInactiveForPlan = shouldCreateInactiveForPlan\(sequence, canSendSequences, planStateUnknown\);/);
  assert.match(save, /\} else if \(announceCreated\) \{\s*announceCreated\(\{ inactiveForPlan: createInactiveForPlan \}\);\s*\} else \{/, 'sans annonce : messages de l’ancien éditeur');
  const createPage = read('src/components/sequences/SequenceCreatePage.tsx');
  assert.ok(createPage.includes("export const FREE_PLAN_NOTICE = 'Votre formule permet de préparer des séquences et d’écrire aux candidats un par un. L’envoi automatique, avec les relances, fait partie des formules payantes.';"));
  assert.match(createPage, /const freePlan = !canSendSequences && !planStateUnknown;/);
  assert.match(createPage, /\{showFreeNotice && \([\s\S]{0,800}\{FREE_PLAN_NOTICE\}\s*<\/Banner>/, 'annoncé avant d’enregistrer');
  // Une fois par personne (spécification, section 4) : « Compris » mémorisé, même clé que /sequences.
  assert.match(createPage, /const showFreeNotice = freePlan && !\(userId && \(freeNoticeDismissedFor === userId \|\| isFreeNoticeDismissed\(userId\)\)\);/);
  assert.match(createPage, />\s*Compris\s*<\/Button>/);
  assert.match(createPage, /const freeNoticeKey = \(userId: string\) => `konekt:sequences-free-notice-dismissed:\$\{userId\}`;/);
  assert.match(read('src/pages/SequencesPage.tsx'), /const freeNoticeKey = \(userId: string\) => `konekt:sequences-free-notice-dismissed:\$\{userId\}`;/);
  // Après l'enregistrement, le toast ne répète pas l'avis.
  assert.match(createPage, /toast\.info\('Séquence enregistrée sans envoi automatique', \{/);
  assert.doesNotMatch(createPage, /description: FREE_PLAN_NOTICE/);
  assert.match(createPage, /action: \{ label: 'Voir les offres', onClick: \(\) => navigate\('\/pricing'\) \}/);
  // Vocabulaire figé : jamais « désactivée ».
  assert.doesNotMatch(codeOf('src/components/sequences/SequenceCreatePage.tsx'), /[Dd]ésactiv/);
  // Après le premier enregistrement : l'adresse de la séquence remplace /sequences/nouvelle (pas d'entrée d'historique en double).
  assert.match(createPage, /navigate\(`\$\{path\}\$\{path\.includes\('\?'\) \? '&' : '\?'\}onglet=etapes`, \{ replace: true \}\);/);
  // Copie : mêmes étapes que l'ancien choix de départ (rowToSequenceStep, ordres regroupés), « Copie de … ».
  const create = read('src/components/sequences/SequenceCreatePage.tsx');
  assert.match(create, /steps: renumberByOrderGroup\(\(\(rows \?\? \[\]\) as unknown as SequenceStepRow\[\]\)\.map\(rowToSequenceStep\)\),/);
  assert.match(create, /name: `Copie de \$\{seq\.name\}`,/);
  assert.match(create, /resetEditor\(openEditorSteps\(readySequence\.steps\), \[\]\);/, 'aucune étape en base : pas de contrôle d’historique');
  // En-tête : un seul bouton plein, état d'enregistrement de la spécification.
  const header = read('src/components/sequences/SequenceHeader.tsx');
  for (const text of ["'Modifications non enregistrées'", "'Enregistrement…'", 'Enregistré à ', 'Échec de l’enregistrement']) assert.ok(header.includes(text), text);
});

test('points d’entrée : drapeau allumé, l’éditeur unique ; éteint, l’ancien éditeur inchangé', () => {
  // /sequences/nouvelle : sa propre route, avant /sequences/:id, sous la même garde (éteint : renvoi vers /missions).
  const app = read('src/App.tsx');
  const createRoute = app.indexOf('<Route path="/sequences/nouvelle"');
  const detailRoute = app.indexOf('<Route path="/sequences/:id"');
  assert.ok(createRoute > 0 && createRoute < detailRoute, '/sequences/nouvelle avant /sequences/:id');
  assert.match(app, /<Route path="\/sequences\/nouvelle" element=\{<ProtectedRoute><OrganizationGuard><SequencesGate><AppLayout><SequenceDetailPage creating \/><\/AppLayout><\/SequencesGate><\/OrganizationGuard><\/ProtectedRoute>\} \/>/);
  assert.equal(`${beta.SEQUENCES_PATH}/${beta.NEW_SEQUENCE_SLUG}`, '/sequences/nouvelle');
  const page = read('src/pages/SequenceDetailPage.tsx');
  assert.match(page, /export default function SequenceDetailPage\(\{ creating = false \}: \{ creating\?: boolean \}\) \{/);
  assert.match(page, /return creating \? <SequenceCreatePage \/> : <SequenceView id=\{id\} \/>;/);
  // Écran Séquences (toujours derrière le drapeau) : plus d'ancien éditeur.
  const screen = read('src/pages/SequencesPage.tsx');
  assert.doesNotMatch(screen, /SequenceBuilder|SequenceTemplateSelector/);
  assert.match(screen, /<NewSequenceDialog/);
  assert.match(screen, /const editSequence = \(seq: SequenceWithStats\) => navigate\(`\$\{sequencePath\(seq\.id\)\}\?onglet=etapes`\);/);
  assert.match(screen, /<TemplatesGallery onUse=\{\(_sequence, key\) => navigate\(newSequencePath\(\{ kind: 'modele', key \}\)\)\} \/>/);
  // Panneau de la mission : selon le drapeau.
  const list = read('src/components/outreach/SequencesList.tsx');
  assert.match(list, /handleEdit: openLegacyEditor,/);
  assert.match(list, /if \(!sequencesBeta\) \{\s*void openLegacyEditor\(seq\);\s*return;\s*\}/);
  assert.match(list, /if \(sequencesBeta\) setNewDialogOpen\(true\);\s*else setShowTemplateSelector\(true\);/);
  // Demande de création venue du parent (ancienne page) : même choix selon le drapeau.
  assert.match(list, /handledCreateRequestRef\.current = createRequestId;\s*if \(sequencesBeta\) setNewDialogOpen\(true\);\s*else setShowTemplateSelector\(true\);\s*\}\s*\}, \[createRequestId, sequencesBeta\]\);/);
  assert.equal((list.match(/if \(sequencesBeta\) setNewDialogOpen\(true\);\s*else setShowTemplateSelector\(true\);/g) || []).length, 2, 'création : bouton et demande du parent');
  assert.match(list, /\{sequencesBeta && \(\s*<NewSequenceDialog/);
  assert.match(list, /<SequenceTemplateSelector/, 'éteint : l’ancien choix de départ');
  assert.match(list, /<SequenceBuilder/, 'éteint : l’ancien éditeur');
  // « Nouvelle séquence » : trois départs, rien d'écrit avant « Enregistrer » ; l'IA vient au lot 5e.
  const dialog = read('src/components/sequences/NewSequenceDialog.tsx');
  for (const text of ['title="Partir d’un modèle"', 'title="Copier une séquence"', 'title="Partir de zéro"', "'Nouvelle séquence'"]) assert.ok(dialog.includes(text), text);
  assert.doesNotMatch(dialog, /Dupliquer|Depuis un modèle/);
  // Le modèle choisi s'ouvre par sa clé (modèle Konekt) ou son identifiant (modèle de l'organisation).
  assert.match(dialog, /<TemplatesGallery onUse=\{\(_sequence, key\) => go\(\{ kind: 'modele', key \}\)\} \/>/);
  assert.match(dialog, /onClick=\{\(\) => go\(\{ kind: 'copie', id: seq\.id \}\)\}/);
  assert.doesNotMatch(dialog, /Rédiger avec l’IA/);
  assert.match(dialog, /navigate\(newSequencePath\(start, missionId\)\)/);
  assert.doesNotMatch(codeOf('src/components/sequences/NewSequenceDialog.tsx'), /supabase|insert\(/, 'rien d’écrit');
});

// ── Partie 5 : gardes sur tout le dossier des pages Séquences ─────────────

/** Fichiers des pages Séquences (drapeau allumé) : composants, éditeur, ses hooks et modules. */
const SEQUENCES_SURFACE = [
  ...walk('src/components/sequences'),
  'src/pages/SequenceDetailPage.tsx',
  'src/pages/SequencesPage.tsx',
  'src/hooks/useSequenceEditor.ts',
  'src/hooks/useSequenceEditorSession.ts',
  'src/hooks/useSequenceEditorDraft.ts',
  'src/hooks/useEditorSaveFlow.ts',
  'src/hooks/useLeaveGuard.ts',
  'src/hooks/useSequencePreview.ts',
  'src/hooks/usePreviewValues.ts',
  'src/lib/sequenceEditor.ts',
  'src/lib/sequenceVariables.ts',
];

/** Méthodes chaînées à partir de `start` (`.from(…).select(…).eq(…)`), parenthèses et chaînes comprises. */
function methodChain(code, start) {
  const names = [];
  const head = /\s*\.\s*(\w+)\s*\(/y;
  let i = start;
  for (;;) {
    head.lastIndex = i;
    const m = head.exec(code);
    if (!m) return names;
    names.push(m[1]);
    let depth = 0;
    let quote = null;
    let j = head.lastIndex - 1;
    for (; j < code.length; j += 1) {
      const c = code[j];
      if (quote) {
        if (c === '\\') { j += 1; continue; }
        if (c === quote) quote = null;
        continue;
      }
      if (c === "'" || c === '"' || c === '`') { quote = c; continue; }
      if (c === '(') depth += 1;
      else if (c === ')') { depth -= 1; if (depth === 0) break; }
    }
    i = j + 1;
  }
}

test('lecteur de chaînes : méthodes d’une requête, écritures repérées', () => {
  const code = "await Promise.all([supabase\n  .from('sequence_steps')\n  .select('*, x(y)')\n  .eq('a', ')'), z]); supabase.from('sequence_steps').delete().in('id', ids);";
  const chains = [...code.matchAll(/\.from\(\s*['"`]sequence_steps['"`]\s*\)/g)].map((m) => methodChain(code, m.index));
  assert.deepEqual(chains, [['from', 'select', 'eq'], ['from', 'delete', 'in']]);
});

test('enregistrement par useSequenceSave seulement : aucune écriture de sequence_steps ni appel de save_sequence_steps dans les pages Séquences', () => {
  const WRITES = new Set(['insert', 'update', 'upsert', 'delete']);
  const reads = [];
  for (const rel of SEQUENCES_SURFACE) {
    const code = codeOf(rel);
    assert.doesNotMatch(code, /save_sequence_steps/, `${rel} : appel direct de save_sequence_steps`);
    for (const m of code.matchAll(/\.from\(\s*['"`]sequence_steps['"`]\s*\)/g)) {
      const chain = methodChain(code, m.index);
      assert.ok(!chain.some((name) => WRITES.has(name)), `${rel} : écriture de sequence_steps (${chain.join('.')})`);
      reads.push(`${rel} : ${chain.join('.')}`);
    }
  }
  // Seule lecture : « Copier une séquence » (/sequences/nouvelle?depart=copie:<id>), rien d'écrit avant « Enregistrer ».
  assert.deepEqual(reads, ['src/components/sequences/SequenceCreatePage.tsx : from.select.eq.order']);
  assert.match(read('src/components/sequences/SequenceCreatePage.tsx'), /supabase\.from\('sequence_steps'\)\.select\('\*'\)\.eq\('sequence_id', start\.id\)/);
  // L'écriture des étapes : save_sequence_steps, appelée par useSequenceSave, utilisée par la page et la création.
  assert.match(read('src/hooks/useSequenceSave.ts'), /await supabase\.rpc\('save_sequence_steps', \{/);
  const savers = SEQUENCES_SURFACE.filter((rel) => /\buseSequenceSave\(/.test(codeOf(rel)));
  assert.deepEqual(savers.sort(), ['src/components/sequences/SequenceCreatePage.tsx', 'src/pages/SequenceDetailPage.tsx']);
  // L'éditeur et ses hooks n'écrivent dans aucune table (seules lectures : historique d'une étape, aperçu).
  for (const rel of SEQUENCES_SURFACE.filter((r) => r.includes('/editor/') || /useSequenceEditor|useEditorSaveFlow|useLeaveGuard|useSequencePreview|usePreviewValues|sequenceEditor|sequenceVariables/.test(r))) {
    const code = codeOf(rel);
    for (const m of code.matchAll(/\.from\(\s*['"`]\w+['"`]\s*\)/g)) {
      const chain = methodChain(code, m.index);
      assert.ok(!chain.some((name) => WRITES.has(name)), `${rel} : écriture (${chain.join('.')})`);
    }
    assert.doesNotMatch(code, /\.rpc\(/, `${rel} : appel de fonction en base`);
  }
});

test('« Guidé », « Expert », « Liste » et « Visuel » absents des pages Séquences, éditeur compris', () => {
  for (const rel of SEQUENCES_SURFACE) assert.doesNotMatch(codeOf(rel), MODE_WORDS, `${rel} : mode d’éditeur`);
  // Le motif voit bien ces mots, accent final compris.
  for (const word of ['Mode Guidé actif', 'Expert', 'Liste', 'onglet Visuel.']) assert.match(word, MODE_WORDS);
  for (const word of ['Listes', 'Expertise', 'Visuels', 'guidée']) assert.doesNotMatch(word, MODE_WORDS);
});

test('valeurs d’aperçu jamais écrites en stockage local : seul le brouillon y écrit, et il ne garde que ce qui sera enregistré', () => {
  const storage = /localStorage|sessionStorage|indexedDB|caches\.open/;
  const writers = SEQUENCES_SURFACE.filter((rel) => storage.test(codeOf(rel)) || /from '@\/lib\/editorDraft'/.test(read(rel)));
  // SequencesPage et SequenceCreatePage : l'avis de la formule gratuite, vu une fois par personne (5c-2) ; useSequenceEditorDraft : le brouillon.
  assert.deepEqual(writers.sort(), ['src/components/sequences/SequenceCreatePage.tsx', 'src/hooks/useSequenceEditorDraft.ts', 'src/pages/SequencesPage.tsx']);
  for (const rel of ['src/pages/SequencesPage.tsx', 'src/components/sequences/SequenceCreatePage.tsx']) {
    assert.doesNotMatch(codeOf(rel).match(/localStorage[^\n]*/g).join('\n'), /preview|values|Preview/, rel);
    assert.match(read(rel), /localStorage\.setItem\(freeNoticeKey\(userId\), '1'\);/, rel);
  }
  // Le brouillon reçoit la valeur de la page (étapes, nom, réglages), jamais l'aperçu.
  const session = read('src/hooks/useSequenceEditorSession.ts');
  assert.match(session, /const draft = useSequenceEditorDraft\(\{\s*key: loaded \? options\.draftKey : null,\s*base: options\.draftBase,\s*value: options\.draftValue,/);
  assert.ok(session.indexOf('useSequenceEditorDraft({') < session.indexOf('useSequencePreview({'), 'aperçu lu après le brouillon, sans y entrer');
  const draft = codeOf('src/hooks/useSequenceEditorDraft.ts');
  assert.doesNotMatch(draft, /preview|Preview|values\b/);
  // Aperçu : en mémoire seulement (ni cache persistant, ni stockage du navigateur).
  for (const rel of ['src/hooks/useSequencePreview.ts', 'src/hooks/usePreviewValues.ts', 'src/components/sequences/editor/MessagePreview.tsx']) {
    assert.doesNotMatch(codeOf(rel), /useQuery|queryClient|persist|editorDraft/, rel);
  }
});

test('ajout sous une étape « Fin de la séquence » : la fin passe à la nouvelle étape ; la retirer rend la fin', () => {
  // Visite, message qui termine la séquence, InMail hors du parcours (plus rien n'y mène).
  const steps = [
    listStepOf('v', 0, 'profile_visit'),
    { ...listStepOf('m', 1, 'message'), messageTemplate: 'Bonjour', nextStepId: '__end__' },
    { ...listStepOf('x', 2, 'inmail'), subjectTemplate: 'Objet', messageTemplate: 'Texte' },
  ];
  const flow = editor.buildEditorFlow(steps);
  assert.deepEqual(flow.orphans.map((n) => n.id), ['x']);
  assert.deepEqual(flow.add, { afterStepId: 'm' }, '« Ajouter une étape » sous la dernière carte du fil');
  const added = editor.addStepAt(steps, flow.add, 'wait_reply', 'n').steps;
  assert.equal(added.find((s) => s.id === 'm').nextStepId, 'n');
  assert.equal(added.find((s) => s.id === 'n').nextStepId, '__end__', 'la fin suit la nouvelle étape');
  assert.deepEqual(renderedIds(editor.buildEditorFlow(added).nodes), ['v', 'm', 'n']);
  assert.equal(graph.engineNextStepId(added.find((s) => s.id === 'n'), added), null, 'le moteur s’arrête après la nouvelle étape');
  // Retirée : l'état d'avant (comparé comme le juge le hook, en JSON), et le moteur ne passe jamais à l'InMail hors du parcours.
  const removed = graph.removeStepFromSequence(added, 'n');
  assert.equal(JSON.stringify(removed), JSON.stringify(steps));
  assert.equal(graph.engineNextStepId(removed.find((s) => s.id === 'm'), removed), null);
});

// ── Corrections après relecture (sous-lot 5d-2) ───────────────────────────

test('relecture : enregistrement figé, brouillon au départ de l’éditeur, réglages en brouillon, « Dupliquer » demandé', () => {
  // Pendant l'enregistrement, fil, panneau et réglages sont inertes (useInertWhile), le focus revient ensuite au même champ.
  const inert = read('src/hooks/useInertWhile.ts');
  assert.match(inert, /node\.setAttribute\('inert', ''\);/);
  assert.match(inert, /node\.removeAttribute\('inert'\);/);
  assert.match(inert, /target\.focus\(\{ preventScroll: true \}\)/);
  const detail = read('src/pages/SequenceDetailPage.tsx');
  assert.match(detail, /const saving = session\.flow\.saving \|\| savingSettings;/);
  assert.match(detail, /useInertWhile\(settingsAreaRef, saving\);/);
  assert.match(detail, /frozen=\{saving\}/);
  const create = read('src/components/sequences/SequenceCreatePage.tsx');
  assert.match(create, /useInertWhile\(settingsAreaRef, session\.flow\.saving\);/);
  assert.match(create, /frozen=\{session\.flow\.saving\}/);
  const editor = read('src/components/sequences/editor/StepsEditor.tsx');
  assert.match(editor, /useInertWhile\(editAreaRef, frozen\);/);
  assert.match(editor, /useInertWhile\(sheetRef, frozen\);/);
  // Brouillon : écrit au démontage ou au changement de clé si la seconde n'est pas écoulée ; `clear` l'empêche.
  const draft = codeOf('src/hooks/useSequenceEditorDraft.ts');
  assert.match(draft, /useEffect\(\(\) => \(\) => \{\s*if \(pending\.current\) writeSnapshot\(committed\.current\);\s*\}, \[key, writeSnapshot\]\);/);
  assert.match(draft, /const clear = useCallback\(\(\) => \{\s*pending\.current = false;/);
  // Réglages : l'éditeur se charge aussi sur l'onglet Réglages (clé du brouillon) ; « Dupliquer » et « Voir les inscrits » passent par la garde.
  assert.match(detail, /\(tab !== 'etapes' && tab !== 'reglages'\)/);
  assert.match(detail, /onDuplicate=\{\(\) => session\.leave\.request\(\(\) => \{ void handleDuplicate\(sequence\); \}\)\}/);
  assert.match(detail, /onClick: \(\) => changeTab\('candidats'\)/);
  // Séquence vide intacte : ni point rouge sur l'onglet, ni barre en erreur.
  assert.match(detail, /e\.area !== 'senders' && e\.check !== 'steps'/);
  assert.match(editor, /\{\(hasSteps \|\| editor\.dirty\) && <ValidationBar/);
});

test('relecture : panneau et barre collés à la fenêtre, bulle effacée, fil recentré sur la carte ouverte', () => {
  const editor = read('src/components/sequences/editor/StepsEditor.tsx');
  assert.match(editor, /body\.setAttribute\('data-sequence-editor', ''\);/);
  assert.match(editor, /body\.removeAttribute\('data-sequence-editor'\);/);
  assert.match(read('src/components/agent/AssistantLauncher.tsx'), /\[body\[data-sequence-editor\]_&\]:hidden/);
  // Carte ouverte toujours entière dans la zone du fil ; branches plus étroites à côté du panneau.
  assert.match(editor, /\[data-step-card="\$\{CSS\.escape\(selectedPrimaryId\)\}"\]/);
  assert.match(read('src/components/sequences/editor/StepCard.tsx'), /data-step-card=\{node\.id\}/);
  assert.match(read('src/components/sequences/editor/BranchColumns.tsx'), /compact \? 'md:min-w-\[14rem\]' : 'md:min-w-\[17rem\]'/);
  assert.match(editor, /compact=\{panelBeside\}/);
  // Téléphone : la fermeture du panneau d'étape (44 px) remplace celle du kit.
  assert.match(editor, /<SheetContent ref=\{sheetRef\} side="right" hideClose/);
  assert.match(read('src/components/ui/sheet.tsx'), /\{!hideClose && \(/);
  // Barre : message d'au moins 20 rem, deux lignes au plus.
  const bar = read('src/components/sequences/editor/ValidationBar.tsx');
  assert.match(bar, /flex-\[1_1_20rem\]/);
  assert.match(bar, /line-clamp-2/);
});

test('relecture : textes et petits défauts visuels', () => {
  // Palette : la raison reste lisible (seuls l'icône et le titre s'estompent), onglets de 44 px, hauteur constante.
  const palette = read('src/components/sequences/editor/AddStepPalette.tsx');
  assert.doesNotMatch(palette, /cursor-not-allowed opacity-60/);
  assert.match(palette, /!allowance\.allowed && 'opacity-50'/);
  assert.match(palette, /\{allowance\.allowed \? DESCRIPTIONS\[type\] : allowance\.reason\}/);
  assert.equal((palette.match(/max-md:min-h-11">(Actions LinkedIn|Conditions et attentes)/g) ?? []).length, 2);
  assert.equal((palette.match(/<TabsContent forceMount value="\w+" className="mt-0 \[grid-area:1\/1\] data-\[state=inactive\]:invisible">/g) ?? []).length, 2);
  // Délai : nom accessible du vocabulaire figé ; phrase du créneau une seule fois dans le panneau, apostrophe typographique.
  const delay = read('src/components/sequences/editor/DelayPill.tsx');
  assert.match(delay, /aria-label=\{`Délai de l’étape \$\{stepNumber\} : \$\{label\}\. Modifier`\}/);
  assert.doesNotMatch(delay, /Délai avant/);
  const panel = read('src/components/sequences/editor/StepPanel.tsx');
  assert.match(panel, /<DelayFields value=\{primary\} onChange=\{updateShared\} showWindowHelp=\{false\} \/>/);
  assert.equal(editor.SEND_WINDOW_TEXT, 'Envois en semaine uniquement, dans votre fuseau horaire, et dans les heures ouvrées de l’expéditeur.');
  assert.equal(graph.SEND_WINDOW_HELP.includes("l'expéditeur"), true, 'l’ancien éditeur garde sa phrase');
  // Badge court ; aide et compteur sous le champ ; rédaction empilée sous 640 px.
  assert.ok(codeOf('src/lib/sequenceEditor.ts').includes("badges.push('Rédigé par l’IA');"));
  assert.match(panel, /belowField=\{\(isInvite \|\| usesAi\) && \(/);
  assert.match(panel, /className="max-sm:grid max-sm:w-full max-sm:grid-cols-1"/);
  // Étape IA : « Structure du message », sans candidat ni navigation.
  const preview = read('src/components/sequences/editor/MessagePreview.tsx');
  assert.match(preview, /if \(usesAi\) \{\s*return \(\s*<section aria-label="Aperçu du message" className="space-y-2">\s*<h3 className="text-sm font-medium text-foreground">Structure du message<\/h3>/);
  // En-tête : titre tronqué sur sa ligne à partir de 768 px ; « Nouvelle séquence » alignée à gauche.
  assert.match(read('src/components/sequences/SequenceHeader.tsx'), /md:flex-nowrap/);
  assert.match(read('src/components/sequences/SequenceHeader.tsx'), /md:truncate/);
  assert.match(read('src/components/sequences/NewSequenceDialog.tsx'), /<DialogHeader className="text-left">/);
  // Fenêtre d'une étape qui ne peut pas être supprimée : titre affirmatif, un seul bouton.
  assert.match(read('src/hooks/useSequenceEditor.ts'), /`L’étape \$\{number\} ne peut pas être supprimée`/);
  assert.match(read('src/components/sequences/editor/StepsEditor.tsx'), /<AlertDialogCancel>Garder l’étape<\/AlertDialogCancel>/);
});

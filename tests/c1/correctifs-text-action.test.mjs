/**
 * Garde statique du correctif « text-action hors séquence » (11/10/2026).
 *
 * Messages au candidat rédigés par la messagerie (text-action, actions
 * cta_reply, rewrite et translate vers le français, hors contexte séquence) :
 * toujours au vouvoiement, comme les réponses proposées
 * (generate-reply-suggestions, analyze-response) et les rédacteurs de prise de
 * contact (lot 5e-2). La traduction vers le français remplace le message en
 * cours de rédaction (MessageComposer, applyTranslation) : elle est contrôlée
 * comme les deux autres.
 * - la consigne commence par l'obligation de vouvoyer ; la règle « Si
 *   tutoiement dans le dernier message du candidat → continuer en tutoiement »
 *   et l'exemple au tutoiement du CTA « job_details » ont disparu ;
 * - l'ancien ton « Décontracté » (`casual`) est chaleureux au vouvoiement, par
 *   styleFromLegacyTone et toneLines de _shared/writing-style.ts ;
 * - un ancien réglage « Tutoiement » des consignes est lu comme vouvoiement,
 *   pour ces actions seulement ;
 * - le texte produit passe par le vrai hasTutoiement : adresses web et e-mail
 *   retirées (« www. », « calendly.com/… », « …@tu-berlin.de ») ; noms connus
 *   masqués, y compris chaque suite d'au moins deux mots du nom (« Minh Tu »
 *   d'un « Minh Tu Nguyen ») ; texte manifestement anglais non jugé (« a ton
 *   of ») ; s'il tutoie : une seule correction, s'il reste 30 s sur les 60 de
 *   la fonction, sans nouvelle tentative ; rewrite garde les variantes qui
 *   vouvoient ; sinon 422 PROPOSAL_NOT_COMPLIANT, phrase française sans nombre
 *   ni mot repris par humanizeError, jetons débités (correction comprise) comme
 *   en contexte séquence ;
 * - contexte séquence, traduction vers l'anglais et autres actions inchangés.
 *
 * Comportement contre la stack locale : e2e/api/seq-draft.spec.ts (describe
 * « text-action : réponse et reformulation de la messagerie au vouvoiement »).
 *
 * Lancer : node --test tests/c1/correctifs-text-action.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync, transformSync } from 'esbuild';

const ROOT = process.env.C1_ROOT || fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

const TEXT_ACTION = 'supabase/functions/text-action/index.ts';
const STYLE = 'supabase/functions/_shared/writing-style.ts';
const SEND_RULES = 'supabase/functions/_shared/sequence-send-rules.ts';
const EDGE_CLIENT = 'src/lib/invokeEdgeFunction.ts';

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
const sendRules = await loadBundle(SEND_RULES);

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
 * Exécute, avec le vrai hasTutoiement, le bloc qui va de la liste des actions
 * contrôlées à la fin de keepVouvoiement (constantes et fonctions réelles).
 */
function loadHelpers() {
  const src = read(TEXT_ACTION);
  const start = at(src, 'const CANDIDATE_MESSAGE_ACTIONS =');
  const fn = topLevelBlock(src, 'function keepVouvoiement(');
  const end = src.indexOf(fn) + fn.length;
  assert.ok(end > start, 'keepVouvoiement doit suivre CANDIDATE_MESSAGE_ACTIONS');
  const { code } = transformSync(src.slice(start, end), { loader: 'ts', format: 'esm' });
  return new Function(
    'hasTutoiement',
    `${code}\nreturn { CANDIDATE_MESSAGE_ACTIONS, VOUVOIEMENT_RULE, VOUVOIEMENT_CORRECTION, CANDIDATE_TUTOIEMENT_MESSAGE,
      FUNCTION_BUDGET_MS, MODEL_TIMEOUT_MS, RESPONSE_MARGIN_MS, isClearlyEnglish, tutoie, nameForms, parseModelObject,
      readCandidateReply, candidateTexts, keepVouvoiement };`,
  )(style.hasTutoiement);
}

/** toneToInstruction réel, avec les vraies règles de style. */
function loadToneToInstruction() {
  const { code } = transformSync(topLevelBlock(read(TEXT_ACTION), 'function toneToInstruction('), { loader: 'ts', format: 'esm' });
  return new Function(
    'toneLines', 'mergeStyle', 'DEFAULT_WRITING_STYLE', 'styleFromLegacyTone',
    `${code}\nreturn toneToInstruction;`,
  )(style.toneLines, style.mergeStyle, style.DEFAULT_WRITING_STYLE, style.styleFromLegacyTone);
}

/** Corps d'une branche de la construction des consignes : de `else if (action === '<a>')` à la branche suivante. */
function promptBranch(src, actionName, nextMarker) {
  const start = at(src, `else if (action === '${actionName}') {`);
  return src.slice(start, at(src, nextMarker, start));
}

// ─── Consigne ───────────────────────────────────────────────────────────────

test('cta_reply, rewrite et translate vers le français : la consigne commence par l’obligation de vouvoyer', () => {
  const src = codeOnly(read(TEXT_ACTION));
  const { VOUVOIEMENT_RULE } = loadHelpers();
  assert.match(VOUVOIEMENT_RULE, /^OBLIGATION : vouvoyez le candidat/);
  assert.equal(style.hasTutoiement(VOUVOIEMENT_RULE), false);

  const rewrite = promptBranch(src, 'rewrite', "else if (action === 'translate')");
  assert.match(rewrite, /systemPrompt = `\$\{VOUVOIEMENT_RULE\}\n\nTu es un expert en rédaction de messages professionnels/);
  assert.match(rewrite, /Vouvoiement obligatoire dans chaque variante, jamais de tutoiement\./);

  // Traduction : obligation en tête vers le français seulement (toute cible autre que l'anglais).
  const translate = promptBranch(src, 'translate', "else if (action === 'summarize')");
  assert.match(translate, /const targetLangFull = targetLang === 'en' \? 'English' : 'French';\n\s*translateToFrench = targetLangFull === 'French';/);
  const translatePrompt = translate.match(/systemPrompt = `([^`]*(?:`[^`]*`[^`]*)*?)`;\n\s*userPrompt = `Traduis ce message/);
  assert.ok(translatePrompt, 'consigne de translate introuvable');
  assert.match(translatePrompt[1], /^\$\{translateToFrench \? `\$\{VOUVOIEMENT_RULE\}\\n\\n` : ''\}Tu traduis des messages professionnels/);
  assert.match(translatePrompt[1], /\$\{translateToFrench \? '\\nVers le français : vouvoiement obligatoire, jamais de tutoiement\.' : ''\}/);

  const cta = promptBranch(src, 'cta_reply', 'else {\n      return new Response(');
  assert.match(cta, /systemPrompt = `\$\{VOUVOIEMENT_RULE\}\n\nTu es un recruteur expérimenté/);
  assert.match(cta, /- Vouvoiement obligatoire, même si le candidat tutoie ou si un autre ton est indiqué plus haut : jamais de tutoiement/);
  // Plus de règle qui suit le tutoiement du candidat, plus d'exemple au tutoiement.
  assert.doesNotMatch(cta, /continuer en tutoiement|idem vouvoiement/);
  assert.doesNotMatch(cta, /tu veux qu'on en discute/);
  const example = cta.match(/CTA final pour la prochaine étape \(ex: "([^"]+)"\)/);
  assert.ok(example, 'exemple du CTA « job_details » introuvable');
  assert.equal(style.hasTutoiement(example[1]), false, example[1]);
});

test('ton « casual » : chaleureux au vouvoiement (styleFromLegacyTone, toneLines), les autres tons inchangés', () => {
  const src = codeOnly(read(TEXT_ACTION));
  assert.match(src, /DEFAULT_WRITING_STYLE,\n\s*buildStyleInstructions,\n\s*hasTutoiement,\n\s*mergeStyle,/);
  const casualCase = src.slice(at(src, "case 'casual':"), at(src, "case 'direct':"));
  assert.match(casualCase, /toneLines\(mergeStyle\(\{ \.\.\.DEFAULT_WRITING_STYLE \}, styleFromLegacyTone\('casual'\)\)\)/);
  assert.doesNotMatch(casualCase, /tutoi|friendly|Décontracté/);

  const toneToInstruction = loadToneToInstruction();
  const casual = toneToInstruction('casual');
  const lines = casual.split('\n');
  assert.equal(lines[0], 'TON: Chaleureux, au vouvoiement');
  assert.match(lines[1], /^- Vouvoyez le candidat/);
  assert.match(lines[2], /^- Registre chaleureux/);
  assert.equal(style.hasTutoiement(casual), false, casual);
  assert.doesNotMatch(casual, /tutoiement/);
  // Les autres tons ne changent pas.
  assert.equal(toneToInstruction('formal'), 'TON: Formel et professionnel (vouvoiement, structure claire).');
  assert.equal(toneToInstruction('direct'), 'TON: Direct et efficace (phrases courtes, droit au but).');
  assert.equal(toneToInstruction('empathetic'), 'TON: Empathique et chaleureux (intérêt humain).');
  assert.equal(toneToInstruction('autre'), '');
});

test('consignes de l’organisation : « Tutoiement » lu comme vouvoiement, pour les messages au candidat seulement', () => {
  const src = codeOnly(read(TEXT_ACTION));
  const m = src.match(/if \(candidateMessage\) \{\n\s*aiContext = aiContext\.replace\((\/[^\n]+\/g), '([^']+)'\);\n\s*\}/);
  assert.ok(m, 'relecture du contexte IA introuvable');
  // Placée après le chargement du contexte, avant tout appel au modèle.
  assert.ok(src.indexOf(m[0]) > at(src, 'let aiContext = await loadAndBuildAiContext('));
  assert.ok(src.indexOf(m[0]) < at(src, 'const callModel = '));
  // La ligne remplacée est celle qu'écrit formatScope (_shared/ai-context.ts).
  const ctx = read('supabase/functions/_shared/ai-context.ts');
  assert.match(ctx, /tu: "tutoiement",/);
  assert.match(ctx, /lines\.push\(`- Ton imposé : \$\{TONE_LABEL\[ctx\.tone\]\}`\);/);
  const pattern = new Function(`return ${m[1]};`)();
  const block = (tone) => `Voix de marque de l'agence :\n- Ton imposé : ${tone}\n\nStyle perso de l'expéditeur :\n- Ton imposé : ${tone}`;
  assert.equal(block('tutoiement').replace(pattern, m[2]), block('vouvoiement'));
  for (const tone of ['vouvoiement', 'décontracté / familier', 'formel / soutenu']) {
    assert.equal(block(tone).replace(pattern, m[2]), block(tone), tone);
  }
});

// ─── Contrôle de la sortie ──────────────────────────────────────────────────

test('actions contrôlées : cta_reply, rewrite et translate vers le français, hors séquence', () => {
  const src = codeOnly(read(TEXT_ACTION));
  const { CANDIDATE_MESSAGE_ACTIONS } = loadHelpers();
  assert.deepEqual([...CANDIDATE_MESSAGE_ACTIONS].sort(), ['cta_reply', 'rewrite', 'translate']);
  // Un seul prédicat, calculé après la consigne (translateToFrench connu), avant tout appel au modèle.
  const predicate = /const candidateMessage = !sequenceContext && CANDIDATE_MESSAGE_ACTIONS\.has\(action\)\n\s*&& \(action !== 'translate' \|\| translateToFrench\);/;
  assert.match(src, predicate);
  const at0 = src.search(predicate);
  assert.ok(at0 > at(src, "translateToFrench = targetLangFull === 'French';"));
  assert.ok(at0 < at(src, 'const callModel = '));
  assert.match(src, /let translateToFrench = false;/);
});

test('contrôle du tutoiement : vrai hasTutoiement, adresses retirées, noms connus masqués', () => {
  const { tutoie, parseModelObject, candidateTexts, keepVouvoiement } = loadHelpers();
  assert.equal(tutoie('Tu es disponible jeudi ?', []), true);
  assert.equal(tutoie('Seriez-vous disponible jeudi ?', []), false);
  assert.equal(tutoie('Je reviens vers toi demain.', []), true);
  // Noms propres connus : « Minh Tu » n'est pas du tutoiement.
  assert.equal(style.hasTutoiement('Merci Minh Tu, seriez-vous disponible ?'), true, 'sans masquage, le nom serait pris pour un tutoiement');
  assert.equal(tutoie('Merci Minh Tu, seriez-vous disponible ?', ['Minh Tu', 'Minh']), false);
  // Lien prérempli : une adresse ne tutoie personne, le texte autour reste jugé.
  const link = 'Voici un lien pour réserver un créneau qui vous convient : https://calendly.com/jd/30min?first_name=Tu&last_name=Nguyen';
  assert.equal(style.hasTutoiement(link, ['Tu Nguyen']), true, 'sans retrait des adresses, le lien serait pris pour un tutoiement');
  assert.equal(tutoie(link, ['Tu Nguyen']), false);
  assert.equal(tutoie('Réserve ton créneau : https://calendly.com/jd/30min', []), true);
  // Adresses sans protocole et adresses e-mail : retirées aussi, le texte autour reste jugé.
  const mail = 'Merci, je vous envoie la fiche. Contact : recrutement@tu-berlin.de';
  const www = 'Seriez-vous disponible ? Voici mon agenda : www.calendly.com/jd?first_name=Tu';
  const bare = 'Seriez-vous disponible ? Voici mon agenda : calendly.com/jd/30min?first_name=Tu';
  for (const t of [mail, www, bare]) {
    assert.equal(style.hasTutoiement(t), true, `sans retrait, pris pour un tutoiement : ${t}`);
    assert.equal(tutoie(t, []), false, t);
  }
  assert.equal(tutoie('Écris-moi à recrutement@exemple.fr quand tu veux.', []), true);
  assert.equal(tutoie('Ton agenda : www.calendly.com/jd', []), true);

  // Texte manifestement anglais : jamais jugé (« a ton of » n'est pas le possessif).
  const english = 'Thanks for your reply. We have a ton of exciting projects, would you be available Thursday for a quick call?';
  assert.equal(style.hasTutoiement(english), true, 'sans la langue, « a ton of » serait pris pour un tutoiement');
  assert.equal(tutoie(english, []), false);
  // Un texte français reste jugé, même court ou mêlé d'anglais.
  assert.equal(tutoie('Hello, tu es open to work ? Let me know if you have time for a call.', []), true);
  assert.equal(tutoie('Top, tu es dispo jeudi pour un call ?', []), true);
  assert.equal(tutoie('Tu es dispo ?', []), true);

  // Noms : chaque suite d'au moins deux mots est masquée (prénom composé sans le nom de famille).
  const { nameForms } = loadHelpers();
  assert.deepEqual(nameForms('Minh Tu Nguyen').sort(), ['Minh', 'Minh Tu', 'Minh Tu Nguyen', 'Tu Nguyen'].sort());
  assert.deepEqual(nameForms('  Laurent  '), ['Laurent']);
  assert.deepEqual(nameForms(undefined), []);
  assert.deepEqual(nameForms('Anne Tu Te').sort(), ['Anne', 'Anne Tu', 'Anne Tu Te'].sort(), 'jamais « Tu Te » seul');
  const known = [...nameForms('Minh Tu Nguyen'), ...nameForms('Laurent')];
  assert.equal(style.hasTutoiement('Merci Minh Tu, seriez-vous disponible jeudi ?', ['Minh Tu Nguyen', 'Minh', 'Laurent']), true,
    'avec le nom entier et son premier mot seulement, « Minh Tu » serait pris pour un tutoiement');
  assert.equal(tutoie('Merci Minh Tu, seriez-vous disponible jeudi ?', known), false);
  assert.equal(tutoie('Merci Minh Tu Nguyen, seriez-vous disponible jeudi ?', known), false);
  assert.equal(tutoie('Merci Minh, tu es disponible jeudi ?', known), true, 'le pronom reste jugé');

  // Lecture de la réponse du modèle.
  assert.deepEqual(parseModelObject('```json\n{"message":"Bonjour"}\n```'), { message: 'Bonjour' });
  assert.equal(parseModelObject('pas du JSON'), null);
  assert.equal(parseModelObject('[1, 2]'), null);
  assert.deepEqual(candidateTexts('cta_reply', { message: 'a', reason: 'tu' }), ['a']);
  assert.deepEqual(candidateTexts('cta_reply', { message: 42 }), []);
  assert.deepEqual(candidateTexts('rewrite', { variants: [{ label: 'Court', text: 'a' }, { text: 7 }, null] }), ['a']);
  // translate : texte brut, lu tel quel.
  const { readCandidateReply } = loadHelpers();
  assert.deepEqual(readCandidateReply('translate', '  Seriez-vous disponible ?\n'), { translated: 'Seriez-vous disponible ?' });
  assert.equal(readCandidateReply('translate', '   '), null);
  assert.deepEqual(readCandidateReply('cta_reply', '{"message":"a"}'), { message: 'a' });
  assert.deepEqual(candidateTexts('translate', { translated: 'b' }), ['b']);
  assert.equal(keepVouvoiement('translate', { translated: 'Tu es disponible jeudi ?' }, []), null);
  assert.deepEqual(keepVouvoiement('translate', { translated: 'Êtes-vous disponible jeudi ?' }, []), { translated: 'Êtes-vous disponible jeudi ?' });

  // cta_reply : le message entier, refusé s'il tutoie.
  const vousReply = { message: 'Seriez-vous disponible jeudi ?', cta_used: 'call', reason: 'r' };
  assert.equal(keepVouvoiement('cta_reply', vousReply, []), vousReply);
  assert.equal(keepVouvoiement('cta_reply', { message: 'Tu es dispo jeudi ?', cta_used: 'call' }, []), null);
  // rewrite : les variantes qui tutoient sont retirées, aucune restante : null.
  const vous = { label: 'Standard', text: 'Seriez-vous disponible cette semaine ?' };
  const tu = { label: 'Court', text: 'Tu es dispo cette semaine ?' };
  assert.deepEqual(keepVouvoiement('rewrite', { variants: [tu, vous] }, []), { variants: [vous] });
  assert.equal(keepVouvoiement('rewrite', { variants: [tu, { label: 'Élaboré', text: 'Ton profil me plaît.' }] }, []), null);
  assert.equal(keepVouvoiement('rewrite', { variants: [] }, []), null);
});

test('tutoiement à la sortie : une seule correction s’il reste 30 s sur 60, sans nouvelle tentative, avant le débit', () => {
  const src = codeOnly(read(TEXT_ACTION));
  const { FUNCTION_BUDGET_MS, MODEL_TIMEOUT_MS, RESPONSE_MARGIN_MS, VOUVOIEMENT_CORRECTION } = loadHelpers();
  assert.equal(FUNCTION_BUDGET_MS, 60_000);
  assert.equal(MODEL_TIMEOUT_MS, 30_000);
  assert.equal(RESPONSE_MARGIN_MS, 5_000);
  // Échéance posée à l'entrée de la requête.
  assert.match(src, /if \(req\.method === 'OPTIONS'\) return new Response\(null, \{ headers: corsHeaders \}\);\n\s*const deadline = Date\.now\(\) \+ FUNCTION_BUDGET_MS;/);
  assert.match(src, /import \{ hasTimeForAiCorrection \} from "\.\.\/_shared\/sequence-send-rules\.ts";/);
  // Règle partagée : 30 s au moins avant l'échéance.
  const deadline = 1_000_000;
  assert.equal(sendRules.hasTimeForAiCorrection(deadline, deadline - 30_000), true);
  assert.equal(sendRules.hasTimeForAiCorrection(deadline, deadline - 29_999), false);

  const callModel = src.slice(at(src, 'const callModel = '), at(src, 'let result: Awaited<'));
  assert.match(callModel, /messages: correction\?\.messages \?\? baseMessages,/);
  assert.match(callModel, /timeoutMs: correction\?\.timeoutMs \?\? MODEL_TIMEOUT_MS,/);
  assert.match(callModel, /\.\.\.\(sequenceContext \? \{ maxRetries: 0 \} : \{\}\),/);
  assert.match(callModel, /\.\.\.\(correction \? \{ maxRetries: 0 \} : \{\}\),/);

  const block = src.slice(at(src, 'if (candidateMessage) {\n      const clientName'), at(src, 'let creditsUsed: number | null = null;'));
  assert.match(block, /const first = readCandidateReply\(action, result\.content\);\n\s*if \(first && candidateTexts\(action, first\)\.some\(\(t\) => tutoie\(t, knownNames\)\)\) \{/);
  assert.match(block, /if \(hasTimeForAiCorrection\(deadline, Date\.now\(\)\)\) \{/);
  assert.equal((block.match(/await callModel\(/g) ?? []).length, 1, 'une seule correction');
  assert.match(block, /\.\.\.baseMessages,\n\s*\{ role: 'assistant', content: result\.content \},\n\s*\{ role: 'user', content: VOUVOIEMENT_CORRECTION\[action as 'cta_reply' \| 'rewrite' \| 'translate'\] \},/);
  assert.match(block, /corrected = readCandidateReply\(action, second\.content\);/);
  assert.match(block, /timeoutMs: Math\.min\(MODEL_TIMEOUT_MS, deadline - Date\.now\(\) - RESPONSE_MARGIN_MS\),/);
  assert.match(block, /tokensInput \+= second\.usage\.input_tokens;\n\s*tokensOutput \+= second\.usage\.output_tokens;/);
  assert.match(block, /candidateReply = \(corrected && keepVouvoiement\(action, corrected, knownNames\)\) \?\? keepVouvoiement\(action, first, knownNames\);/);
  assert.match(block, /candidateRefused = candidateReply === null;/);
  // Noms connus masqués : candidat et recruteur (toutes leurs formes), client du poste.
  assert.match(block, /const knownNames = \[\n\s*\.\.\.nameForms\(body\.candidate_name\),\n\s*\.\.\.nameForms\(body\.recruiter_name\),\n\s*typeof clientName === 'string' \? clientName : '',\n\s*\];/);
  assert.deepEqual(Object.keys(VOUVOIEMENT_CORRECTION).sort(), ['cta_reply', 'rewrite', 'translate']);
  for (const key of ['cta_reply', 'rewrite', 'translate']) {
    assert.match(VOUVOIEMENT_CORRECTION[key], /^Votre (réponse|traduction) tutoie le candidat\. .*au vouvoiement/);
    assert.equal(style.hasTutoiement(VOUVOIEMENT_CORRECTION[key]), false);
  }
  assert.match(VOUVOIEMENT_CORRECTION.translate, /rendez uniquement la traduction\.$/);

  // Débit : jetons des deux appels, une seule fois.
  const settle = src.slice(at(src, 'let creditsUsed: number | null = null;'), at(src, 'creditsUsed = settled.charged;'));
  assert.match(settle, /tokensInput,\n\s*tokensOutput,/);
  assert.doesNotMatch(settle, /result\.usage/);
  assert.match(src, /let tokensInput = result\.usage\.input_tokens;\n\s*let tokensOutput = result\.usage\.output_tokens;/);
});

test('refus : 422 PROPOSAL_NOT_COMPLIANT après le débit, phrase française sans nombre ni mot repris par humanizeError', () => {
  const src = codeOnly(read(TEXT_ACTION));
  const refusal = src.match(/if \(candidateRefused\) \{\n\s*return json\(\{\n\s*success: false,\n\s*error: CANDIDATE_TUTOIEMENT_MESSAGE,\n\s*error_code: 'PROPOSAL_NOT_COMPLIANT',\n\s*credits_used: creditsUsed,\n\s*\}, 422\);\n\s*\}/);
  assert.ok(refusal, 'refus introuvable');
  assert.ok(src.indexOf(refusal[0]) > at(src, 'creditsUsed = settled.charged;'), 'le refus suit le débit');
  // Réponse contrôlée rendue telle quelle (corrigée, ou variantes qui vouvoient).
  // translate compris : la traduction corrigée remplace la première.
  assert.match(src, /if \(candidateReply\) \{\n\s*payload = \{ success: true, \.\.\.candidateReply \};\n\s*\} else if \(action === 'translate'\) \{\n\s*payload\.translated = result\.content\.trim\(\);/);

  const { CANDIDATE_TUTOIEMENT_MESSAGE } = loadHelpers();
  assert.equal(CANDIDATE_TUTOIEMENT_MESSAGE, "Proposition retirée : le texte tutoie le candidat ; les messages vouvoient. Votre texte n'a pas changé.");
  assert.doesNotMatch(CANDIDATE_TUTOIEMENT_MESSAGE, /\d/);
  // Aucun déclencheur de humanizeError : la phrase du serveur s'affiche telle quelle.
  const edge = read(EDGE_CLIENT);
  const humanize = topLevelBlock(edge, 'function humanizeError(');
  const triggers = [...humanize.matchAll(/lower\.includes\('([^']+)'\)/g)].map((x) => x[1]);
  assert.ok(triggers.length >= 10, 'déclencheurs de humanizeError introuvables');
  for (const t of triggers) assert.ok(!CANDIDATE_TUTOIEMENT_MESSAGE.toLowerCase().includes(t), `« ${t} » dans le message`);
  // Même code qu'en contexte séquence.
  assert.equal((src.match(/error_code: 'PROPOSAL_NOT_COMPLIANT'/g) ?? []).length, 2);
});

// ─── Ce qui ne change pas ───────────────────────────────────────────────────

test('contexte séquence inchangé : ton casual refusé, vouvoiement imposé, contrôle par reviewTextProposal', () => {
  const src = codeOnly(read(TEXT_ACTION));
  assert.match(src, /if \(body\.tone === 'casual'\) \{\n\s*return json\(\{ error: SEQUENCE_TONE_REFUSED_MESSAGE, error_code: 'SEQUENCE_TONE_REFUSED' \}, 400\);/);
  assert.match(src, /"- Vouvoiement obligatoire dans le texte, même si le texte d'origine tutoie ou si un autre ton est indiqué plus haut\.",/);
  assert.match(src, /const review = reviewTextProposal\(\{ before: text!, after: proposal, slot: stepSlot \}, checkContext\);/);
  // Le contrôle hors séquence ne s'applique jamais en contexte séquence.
  assert.equal((src.match(/!sequenceContext && CANDIDATE_MESSAGE_ACTIONS\.has\(action\)/g) ?? []).length, 1);
  assert.equal((src.match(/if \(candidateMessage\) \{/g) ?? []).length, 2);
});

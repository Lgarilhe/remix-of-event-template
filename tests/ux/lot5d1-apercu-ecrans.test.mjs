/**
 * Lot 5d-1 : aperçu réel par preview_values, côté écrans (« Relire les
 * messages », EnrollmentPreviewModal).
 *
 * Invariants épinglés :
 *   - les étapes écrites sont rendues avec les valeurs du serveur
 *     (usePreviewValues, fonction draft-sequence, pages de 10 candidats) et
 *     renderTemplatePreview, plus jamais avec resolveVariables (retiré) ;
 *   - chaque candidat est décrit par les colonnes que l'inscription écrira
 *     (previewProfileOf, mêmes sources que handleEnroll) ;
 *   - pendant la préparation : squelette, jamais un texte faux ; sans aperçu
 *     (effacement, échec) : la raison, « Réessayer » quand un nouvel essai peut
 *     aboutir ; mission inconnue du serveur : nouvel appel sans mission ;
 *   - une étape écrite non retouchée n'est pas enregistrée dans
 *     message_overrides (le moteur la rend à l'envoi avec la même règle) ; sa
 *     retouche l'est, avec les variables de l'heure d'envoi et le lien d'agenda
 *     gardés pour le moteur ;
 *   - retouches et aperçus IA inchangés : génération, relecture obligatoire
 *     (lot 5a-2) ; le texte des étapes écrites sert de contexte à l'IA.
 *
 * Sans navigateur ni base. Lancer : npm run test:ux
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** Transpile et charge un module TypeScript ; imports « @/ » résolus dans src/, sauf ceux remplacés par `stubs`. */
async function loadModule(rel, stubs = {}) {
  const resolveSrc = (spec) => {
    const base = path.join(ROOT, 'src', spec.slice(2));
    for (const candidate of [`${base}.ts`, `${base}.tsx`, path.join(base, 'index.ts')]) {
      if (existsSync(candidate)) return candidate;
    }
    throw new Error(`module introuvable : ${spec}`);
  };
  const result = await build({
    stdin: { contents: read(rel), resolveDir: path.dirname(path.join(ROOT, rel)), loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    logLevel: 'silent',
    plugins: [{
      name: 'alias-and-stubs',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => {
          if (args.path in stubs) return { path: args.path, namespace: 'stub' };
          if (args.path.startsWith('@/')) return { path: resolveSrc(args.path) };
          return undefined;
        });
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: stubs[args.path], loader: 'js' }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

function between(source, from, to) {
  const a = source.indexOf(from);
  assert.ok(a >= 0, `« ${from} » introuvable`);
  const b = source.indexOf(to, a + from.length);
  assert.ok(b > a, `« ${to} » introuvable après « ${from} »`);
  return source.slice(a, b);
}

const HOOK = 'src/hooks/usePreviewValues.ts';
const REACT_STUB = 'export const useState = (i) => [typeof i === "function" ? i() : i, () => {}]; export const useCallback = (f) => f; export const useRef = (v) => ({ current: v }); export const useEffect = () => {}; export const useMemo = (f) => f(); export default {};';
// Variante dont le setState applique la mise à jour (sans nouveau rendu) : les lectures par ref voient l'état écrit.
const APPLYING_REACT_STUB = 'export const useState = (i) => { let v = typeof i === "function" ? i() : i; return [v, (u) => { v = typeof u === "function" ? u(v) : u; }]; }; export const useCallback = (f) => f; export const useRef = (v) => ({ current: v }); export const useEffect = () => {}; export const useMemo = (f) => f(); export default {};';

// invokeEdgeFunction factice : chaque appel est noté, la réponse vient de globalThis.__previewReply.
const values = await loadModule(HOOK, {
  react: REACT_STUB,
  '@/lib/invokeEdgeFunction': 'export const invokeEdgeFunction = async (fn, body) => { (globalThis.__previewCalls ||= []).push({ fn, body }); return globalThis.__previewReply(body); };',
});
const { renderTemplatePreview } = await loadModule('src/lib/templatePreview.ts');
const enrollmentHook = await loadModule('src/hooks/useEnrollmentPreview.ts', {
  react: REACT_STUB,
  '@/lib/invokeWithCredits': 'export const invokeWithCredits = async (fn, action, body) => { (globalThis.__aiCalls ||= []).push(body); return { data: { message: "Message IA" }, error: null }; }; export const estimateActionCredits = () => 1;',
  '@/integrations/supabase/client': 'export const supabase = {};',
  '@/hooks/useAuthReady': 'export const useAuthReady = () => ({ user: null });',
});

const hookSrc = read(HOOK);
const previewHookSrc = read('src/hooks/useEnrollmentPreview.ts');
const modal = read('src/components/outreach/EnrollmentPreviewModal.tsx');
const confirm = read('src/components/outreach/enrollment-preview/RecipientsConfirm.tsx');

const takeCalls = (key) => {
  const calls = globalThis[key] || [];
  globalThis[key] = [];
  return calls;
};

test('5D1-E1 previewProfileOf : les colonnes que handleEnroll écrira, sans entreprise', () => {
  const profile = {
    id: 'ACoAAE1', provider_id: 'ACwAAE1', name: '🚀 Julie Martin', headline: 'Directrice financière chez Acme',
    public_profile_url: 'https://www.linkedin.com/in/julie', network_distance: 1,
    work_experience: [{ company: 'Ancienne entreprise', role: 'Analyste' }], location: 'Lyon, France',
  };
  assert.deepEqual(values.previewProfileOf(profile, 'Contrôleur de gestion'), {
    id: 'ACoAAE1',
    provider_id: 'ACwAAE1',
    profile_name: '🚀 Julie Martin',
    profile_headline: 'Directrice financière chez Acme',
    profile_url: 'https://www.linkedin.com/in/julie',
    job_title: 'Contrôleur de gestion',
    network_distance: 'FIRST_DEGREE',
  });
  assert.deepEqual(values.previewProfileOf({ id: 'x', profile_url: 'https://a', network_distance: 'OUT_OF_NETWORK' }), {
    id: 'x', provider_id: null, profile_name: null, profile_headline: null, profile_url: 'https://a', job_title: null, network_distance: 'OUT_OF_NETWORK',
  });
  // Mêmes sources que l'inscription : sinon l'aperçu ne serait pas le texte envoyé.
  const upsert = between(modal, ".from('sequence_enrollments')\n            .upsert({", '}, {');
  assert.match(upsert, /profile_name: profile\.name,/);
  assert.match(upsert, /profile_headline: profile\.headline,/);
  assert.match(upsert, /profile_url: profile\.profile_url \|\| profile\.public_profile_url,/);
  assert.match(upsert, /job_title: job\?\.title,/);
  assert.match(upsert, /network_distance: normalizedDistance,/);
  assert.match(upsert, /\.\.\.enrollmentRowFields\(profile\),/);
  assert.doesNotMatch(upsert, /company_name/, "l'inscription n'écrit pas d'entreprise : l'aperçu non plus");
  assert.match(modal, /jobTitle: job\?\.title \?\? null,/);
  assert.match(modal, /missionId: missionIdOfJob\(job\?\.id\) \?\? null,/);
});

test('5D1-E2 texte affiché : rendu du moteur, heure d’envoi annoncée entre crochets', () => {
  const vals = { prenom: 'Paul', poste_actuel: 'Data Engineer', entreprise_actuelle: 'Qonto' };
  const sendTime = { salutation: '[Bonjour ou Bonsoir, selon l’heure d’envoi]', aujourd_hui: '[date d’envoi]' };
  const template = '{{salutation}} {{prenom}}, {{poste_actuel}} chez {{entreprise_actuelle}} ? {{client}}. Écrit le {{aujourd_hui}}.';
  const shown = values.previewDisplayText(template, vals, sendTime);
  assert.equal(shown, '[Bonjour ou Bonsoir, selon l’heure d’envoi] Paul, Data Engineer chez Qonto ?. Écrit le [date d’envoi].');
  assert.equal(shown, renderTemplatePreview(template, { ...vals, ...sendTime }).text, 'même règle que renderTemplatePreview');
  assert.equal(values.previewDisplayText('', vals, sendTime), '');
});

test('5D1-E3 texte modifiable : heure d’envoi et lien d’agenda gardés pour le moteur, le reste rendu', () => {
  const vals = { prenom: 'Paul', lien_calendly: 'https://agenda.example/l', calendly_link: 'https://agenda.example/l' };
  const keep = ['salutation', 'periode_jour', ...values.KEPT_FOR_SEND_KEYS];
  assert.deepEqual([...values.KEPT_FOR_SEND_KEYS], ['calendly_link', 'lien_calendly']);
  assert.equal(
    values.previewEditableText('{{ salutation | upper }} {{prenom}} {{nom}}, réservez ici : {{calendly_link}}. Bonne {{periode_jour}} !', vals, keep),
    '{{ salutation | upper }} Paul, réservez ici : {{calendly_link}}. Bonne {{periode_jour}} !',
  );
  // Sans variable gardée : exactement le rendu du moteur.
  assert.equal(values.previewEditableText('Bonjour {{prenom}}, {{nom}}.', vals, keep), renderTemplatePreview('Bonjour {{prenom}}, {{nom}}.', vals).text);
  // Le moteur, lui, remplit ensuite les variables gardées : parité du texte final.
  const stored = values.previewEditableText('{{salutation}} {{prenom}} {{calendly_link}}', vals, keep);
  assert.equal(
    renderTemplatePreview(stored, { ...vals, salutation: 'Bonsoir' }).text,
    renderTemplatePreview('{{salutation}} {{prenom}} {{calendly_link}}', { ...vals, salutation: 'Bonsoir' }).text,
  );
});

test('5D1-E4 une page preview_values : corps de l’appel, effacement, échec, mission inconnue (error.code)', async () => {
  assert.equal(values.PREVIEW_PAGE_SIZE, 10, 'pages de 10 candidats');
  const profiles = [values.previewProfileOf({ id: 'a', name: 'Paul Roux' }), values.previewProfileOf({ id: 'b' }), values.previewProfileOf({ id: 'c' }), values.previewProfileOf({ id: 'd' })];
  const base = { organizationId: 'org', missionId: 'mission', sequenceId: 'seq', accountId: 'acc', keys: ['prenom', 'mon_prenom'] };
  takeCalls('__previewCalls');
  globalThis.__previewReply = () => ({
    data: {
      candidates: [{ id: 'a', values: { prenom: 'Paul' }, at_send: { mon_prenom: '[prénom de l’expéditeur choisi à l’envoi]' }, missing: ['client'] }],
      excluded: [
        { id: 'b', reason: 'gdpr_erased', message: "Ce candidat a demandé l'effacement de ses données : aucun aperçu." },
        { id: 'c', reason: 'gdpr_unverified', message: 'Effacement non vérifié.' },
        { id: 'd', reason: 'preview_failed', message: "L'aperçu de ce candidat n'a pas pu être préparé. Réessayez dans un instant." },
      ],
      send_time: { salutation: '[Bonjour ou Bonsoir, selon l’heure d’envoi]' },
    },
    error: null,
  });
  const page = await values.fetchPreviewValuesPage(base, profiles);
  const [call] = takeCalls('__previewCalls');
  assert.equal(call.fn, 'draft-sequence');
  assert.deepEqual(call.body, {
    action: 'preview_values', organization_id: 'org', mission_id: 'mission', sequence_id: 'seq', account_id: 'acc',
    keys: ['prenom', 'mon_prenom'], profiles,
  });
  assert.equal(page.kind, 'values');
  assert.deepEqual(page.entries.get('a'), { status: 'ready', values: { prenom: 'Paul' }, atSend: { mon_prenom: '[prénom de l’expéditeur choisi à l’envoi]' }, missing: ['client'] });
  assert.deepEqual(page.entries.get('b'), { status: 'unavailable', message: "Ce candidat a demandé l'effacement de ses données : aucun aperçu.", retryable: false });
  assert.deepEqual(page.entries.get('c'), { status: 'unavailable', message: 'Effacement non vérifié.', retryable: true });
  assert.deepEqual(page.entries.get('d'), { status: 'unavailable', message: "L'aperçu de ce candidat n'a pas pu être préparé. Réessayez dans un instant.", retryable: true }, 'lecture en échec côté serveur : à réessayer');
  assert.deepEqual(page.sendTime, { salutation: '[Bonjour ou Bonsoir, selon l’heure d’envoi]' });

  // Poste hérité dont l'identifiant n'est pas une mission : nouvel appel sans mission, comme le moteur.
  // Le code arrive par error.code (invokeEdgeFunction recopie error_code), plus par data.code.
  const notFound = Object.assign(new Error('Mission introuvable dans cette organisation.'), { status: 404, code: 'MISSION_NOT_FOUND' });
  globalThis.__previewReply = (body) => (body.mission_id
    ? { data: { success: false, error: 'Mission introuvable dans cette organisation.', error_code: 'MISSION_NOT_FOUND' }, error: notFound }
    : { data: { candidates: [{ id: 'a', values: {}, missing: [] }], excluded: [], send_time: {} }, error: null });
  const retried = await values.fetchPreviewValuesPage({ ...base, missionId: 'poste', accountId: null }, profiles.slice(0, 1));
  assert.deepEqual(takeCalls('__previewCalls').map((c) => c.body.mission_id), ['poste', null]);
  assert.equal(retried.kind, 'values');
  assert.deepEqual(retried.entries.get('a'), { status: 'ready', values: {}, atSend: {}, missing: [] });
  // Ancienne forme (« code » dans le corps) : plus lue.
  globalThis.__previewReply = () => ({ data: { success: false, error: 'Mission introuvable.', code: 'MISSION_NOT_FOUND' }, error: new Error('x') });
  await values.fetchPreviewValuesPage({ ...base, missionId: 'poste' }, profiles.slice(0, 1));
  assert.equal(takeCalls('__previewCalls').length, 1, '« code » du corps ignoré');

  // Échec : la phrase du serveur, jamais un texte inventé.
  globalThis.__previewReply = () => ({
    data: { success: false, error: 'Ce compte LinkedIn est relié à un autre membre de l’équipe.', error_code: 'PREVIEW_ACCOUNT_OF_OTHER_MEMBER' },
    error: Object.assign(new Error('x'), { code: 'PREVIEW_ACCOUNT_OF_OTHER_MEMBER' }),
  });
  const failed = await values.fetchPreviewValuesPage({ ...base, missionId: null }, profiles.slice(0, 1));
  assert.deepEqual(failed, { kind: 'failed', message: 'Ce compte LinkedIn est relié à un autre membre de l’équipe.' });
  assert.equal(takeCalls('__previewCalls').length, 1, 'pas de second appel sans mission');
  assert.match(hookSrc, /\(error\.code \?\? data\?\.error_code\) === 'MISSION_NOT_FOUND'/);
  assert.doesNotMatch(hookSrc, /data\?\.code\b/);
});

test('5D1-E5 usePreviewValues : un appel par page de 10, une seule fois par candidat, ensure attend les valeurs, Réessayer ne relance que ce qui peut aboutir', async () => {
  takeCalls('__previewCalls');
  // Réponse différée : chaque appel se résout quand on le décide.
  const pending = [];
  globalThis.__previewReply = (body) => new Promise((resolve) => pending.push({ body, resolve }));
  const replyAll = (make) => { while (pending.length) { const { body, resolve } = pending.shift(); resolve(make(body)); } };
  const hook = values.usePreviewValues({ organizationId: 'org', missionId: 'm', sequenceId: 's', accountId: 'acc', jobTitle: 'Poste', keys: ['prenom'] });
  const people = Array.from({ length: 23 }, (_, i) => ({ id: `p${i}`, name: `Personne ${i}` }));
  const first = hook.request(people);
  assert.deepEqual(takeCalls('__previewCalls').map((c) => c.body.profiles.length), [10, 10, 3], 'pages de 10');
  // Déjà demandés (en cours) : aucun nouvel appel ; ensure attend la même réponse.
  void hook.request(people.slice(0, 5));
  let ensured = null;
  const waiting = hook.ensure([people[2]]).then((r) => { ensured = r; });
  assert.equal(takeCalls('__previewCalls').length, 0, 'un candidat n’est demandé qu’une fois');
  await Promise.resolve();
  assert.equal(ensured, null, 'ensure attend la réponse');
  replyAll((body) => ({
    data: {
      candidates: body.profiles.filter((p) => p.id !== 'p1' && p.id !== 'p2').map((p) => ({ id: p.id, values: { prenom: p.profile_name }, missing: [] })),
      excluded: [{ id: 'p1', reason: 'gdpr_erased', message: 'Effacé.' }, { id: 'p2', reason: 'preview_failed', message: 'À réessayer.' }],
      send_time: {},
    },
    error: null,
  }));
  await first;
  await waiting;
  assert.deepEqual(ensured.entries.get('p2'), { status: 'unavailable', message: 'À réessayer.', retryable: true });
  assert.deepEqual(ensured.entries.get('p0'), { status: 'ready', values: { prenom: 'Personne 0' }, atSend: {}, missing: [] });
  // Candidat hors de l'écran : demandé par ensure seul (génération IA), une page à lui.
  const outside = hook.ensure([{ id: 'p99', name: 'Hors écran' }]);
  assert.deepEqual(takeCalls('__previewCalls').map((c) => c.body.profiles.map((p) => p.id)), [['p99']]);
  replyAll(() => ({ data: { candidates: [{ id: 'p99', values: { prenom: 'Hors' }, missing: [] }], excluded: [], send_time: {} }, error: null }));
  assert.equal((await outside).entries.get('p99').status, 'ready');
  // Réessayer : l'échec relancé, jamais l'effacé.
  hook.retry();
  assert.deepEqual(takeCalls('__previewCalls').map((c) => c.body.profiles.map((p) => p.id)), [['p2']]);
  replyAll(() => ({ data: { candidates: [], excluded: [], send_time: {} }, error: { message: 'réseau' } }));
  const effect = between(hookSrc, 'const request = useCallback(', '}, [store, publish,');
  assert.match(effect, /store\.entries\.set\(p\.id, \{ status: 'loading' \}\)/, 'squelette pendant la préparation');
  assert.match(effect, /outcome\.entries\.get\(p\.id\) \?\? \{ status: 'unavailable', message: PREVIEW_VALUES_FAILED_MESSAGE, retryable: true \}/);
  assert.match(hookSrc, /if \(store\.alive\) setSnapshot\(/, 'réponse d’un ancien contexte ignorée');
});

test('5D1-E6 resolveVariables retiré de src, étapes écrites rendues par preview_values dans la préparation', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const name of readdirSync(path.join(ROOT, dir))) {
      const rel = `${dir}/${name}`;
      if (statSync(path.join(ROOT, rel)).isDirectory()) walk(rel);
      else if (/\.(ts|tsx)$/.test(name) && /resolveVariables/.test(read(rel))) offenders.push(rel);
    }
  };
  walk('src');
  assert.deepEqual(offenders, [], 'resolveVariables n’a plus aucun appelant');
  assert.match(modal, /import \{ keptForSendKeys, previewDisplayText, previewEditableText, usePreviewValues \} from '@\/hooks\/usePreviewValues';/);
  // Variables des textes de la séquence seules, séquence passée au serveur (rotation).
  assert.match(modal, /const previewKeys = useMemo\(\(\) => templateKeys\(steps\.flatMap\(s => \[s\.messageTemplate, s\.subjectTemplate\]\)\), \[steps\]\);/);
  assert.match(modal, /sequenceId: sequence\.id,/);
  assert.match(modal, /keys: previewKeys,/);
  // Candidats de l'écran demandés par pages.
  assert.match(modal, /const screenProfiles = \[selectedProfile, summaryProfile, footerProfile, \.\.\.pagedProfiles\]/);
  assert.match(modal, /if \(!isOpen \|\| !hasWrittenSteps\) return;\n\s*void requestPreviewValues\(screenProfilesRef\.current\);/);
  const written = between(modal, 'const writtenPreviewOf = (profile: LinkedInProfile, step: SequenceStepPreview): WrittenStepPreview => {', '\n  };\n');
  assert.match(written, /if \(!entry \|\| entry\.status === 'loading'\) return \{ status: 'loading' \};/);
  assert.match(written, /onRetry: entry\.retryable \? previewValues\.retry : undefined/);
  assert.match(written, /const keep = keptForSendKeys\(entry, previewValues\.sendTime\);/);
  assert.match(written, /text: previewDisplayText\(step\.messageTemplate, entry\.values, previewValues\.sendTime, entry\.atSend\),/);
  assert.match(written, /editableSubject: previewEditableText\(step\.subjectTemplate, entry\.values, keep\),/);
  assert.match(written, /editableText: previewEditableText\(step\.messageTemplate, entry\.values, keep\),/);
  // Premier message (pied et récapitulatif) : squelette ou raison, jamais le modèle deviné.
  const first = between(modal, 'const firstMessageFor = (profile: LinkedInProfile): FirstMessagePreview => {', '// Pied :');
  assert.match(first, /if \(written\.status === 'loading'\) return \{ key: step\.stepId, label, condition, text: '', loading: true \};/);
  assert.match(first, /unavailable: written\.message, onRetry: written\.onRetry/);
  assert.match(confirm, /\{item\.loading \? \(/);
  assert.match(confirm, /<span className="sr-only">Préparation de l'aperçu en cours<\/span>/);
  assert.match(confirm, /\) : item\.unavailable \? \(/);
  // Carte d'étape : squelette, raison avec « Réessayer », texte rendu ; retouche affichée comme avant.
  const card = between(modal, 'function MessageStepCard(', 'function SummaryMode(');
  assert.match(card, /const writtenShown = written && !preview\?\.isEdited \? written : null;/);
  assert.match(card, /\{preview\?\.isGenerating \|\| writtenShown\?\.status === 'loading' \? \(/);
  assert.match(card, /"Préparation de l'aperçu en cours"/);
  assert.match(card, /\) : writtenShown\?\.status === 'unavailable' \? \(/);
  assert.match(card, /\{writtenShown\.onRetry && \(/);
  assert.match(card, /const message = writtenReady \? writtenReady\.editableText :/, 'retouche partie du texte modifiable');
});

test('5D1-E6b variables remplies à l’envoi : annoncées entre crochets à l’écran, gardées telles quelles dans une retouche', () => {
  const entry = { atSend: { mon_prenom: '[prénom de l’expéditeur choisi à l’envoi]', tarif: '[variable personnelle de l’expéditeur, remplie à l’envoi si elle existe]' } };
  const sendTime = { salutation: '[Bonjour ou Bonsoir, selon l’heure d’envoi]' };
  const keep = values.keptForSendKeys(entry, sendTime);
  assert.deepEqual(keep, ['salutation', 'calendly_link', 'lien_calendly', 'mon_prenom', 'tarif']);
  const template = '{{salutation}} {{prenom}}, {{tarif}}. {{mon_prenom}}';
  const vals = { prenom: 'Julie' };
  assert.equal(
    values.previewDisplayText(template, vals, sendTime, entry.atSend),
    '[Bonjour ou Bonsoir, selon l’heure d’envoi] Julie, [variable personnelle de l’expéditeur, remplie à l’envoi si elle existe]. [prénom de l’expéditeur choisi à l’envoi]',
  );
  // Jamais l'annonce enregistrée dans une retouche : la variable reste pour le moteur.
  assert.equal(values.previewEditableText(template, vals, keep), '{{salutation}} Julie, {{tarif}}. {{mon_prenom}}');
});

test('5D1-E7 étape écrite : jamais générée ni enregistrée sans retouche ; l’IA reçoit son texte rendu, attendu pour un candidat hors de l’écran', async () => {
  // La règle d'enregistrement ne change pas : aperçus générés ou retouchés seulement.
  assert.match(previewHookSrc, /if \(msg\.isGenerated \|\| msg\.isEdited\) \{/);
  const generate = between(previewHookSrc, 'const generateForCandidate = useCallback(', 'const generateForCandidateById = useCallback(');
  assert.match(generate, /if \(!step\.useAiPersonalization\) continue;/, 'aucun aperçu gardé pour une étape écrite');
  const regenerate = between(previewHookSrc, 'const regenerateStep = useCallback(', 'const editMessage = useCallback(');
  assert.match(regenerate, /if \(!step\.useAiPersonalization\) \{\s*removePreview\(candidateId, stepId\);\s*return;\s*\}/);
  assert.match(regenerate, /await buildPrevSentSteps\(/, 'Régénérer : même historique rendu que la génération');

  takeCalls('__aiCalls');
  const profile = { id: 'p1', name: 'Julie Martin', network_distance: 2 };
  const steps = [
    { stepId: 'w', stepOrder: 0, actionType: 'message', messageTemplate: 'Bonjour {{prenom}}', subjectTemplate: '', useAiPersonalization: false },
    { stepId: 'ia', stepOrder: 1, actionType: 'message', messageTemplate: 'Relance', subjectTemplate: '', useAiPersonalization: true },
  ];
  // Valeurs du serveur qui arrivent plus tard (candidat hors de l'écran) : la génération les attend.
  const asked = [];
  const writtenText = async (p, step) => {
    asked.push(step.stepId);
    await new Promise((r) => setTimeout(r, 5));
    return { subject: '', message: `${step.messageTemplate.replace('{{prenom}}', 'Julie')} (rendu serveur)` };
  };
  const hook = enrollmentHook.useEnrollmentPreview({ steps, profiles: [profile], job: null, accountId: 'acc', writtenText });
  assert.equal(hook.generatedCount, 0);
  await hook.generateForCandidateById('p1');
  const calls = takeCalls('__aiCalls');
  assert.equal(calls.length, 1, 'une génération : l’étape IA seule');
  assert.deepEqual(calls[0].sequenceContext.prevSentSteps, [{ actionType: 'message', finalMessage: 'Bonjour Julie (rendu serveur)', stepOrder: 0 }]);
  assert.ok(asked.length >= 1 && asked.every((id) => id === 'w'), 'valeurs demandées pour l’étape écrite');
  assert.doesNotMatch(JSON.stringify(calls[0]), /\{\{prenom\}\}/, 'jamais le modèle non rendu');
  // « Générer l'aperçu » d'une seule étape IA (regenerateStep) : le même texte rendu, plus un historique vide.
  await hook.regenerateStep('p1', 'ia');
  assert.deepEqual(takeCalls('__aiCalls')[0].sequenceContext.prevSentSteps, [{ actionType: 'message', finalMessage: 'Bonjour Julie (rendu serveur)', stepOrder: 0 }]);
  // Valeurs indisponibles (effacement, échec) : le modèle brut en dernier recours, jamais un texte deviné.
  const bare = enrollmentHook.useEnrollmentPreview({ steps, profiles: [profile], job: null, accountId: 'acc', writtenText: async () => null });
  await bare.generateForCandidateById('p1');
  assert.equal(takeCalls('__aiCalls')[0].sequenceContext.prevSentSteps[0].finalMessage, 'Bonjour {{prenom}}');
  // « Régénérer » une étape écrite : aucun appel à l'IA.
  await hook.regenerateStep('p1', 'w');
  assert.equal(takeCalls('__aiCalls').length, 0);
  // Une séquence sans étape IA n'a rien à générer : compteur nul, aucun crédit annoncé.
  const writtenOnly = enrollmentHook.useEnrollmentPreview({ steps: steps.slice(0, 1), profiles: [profile], job: null, accountId: 'acc', writtenText });
  assert.equal(writtenOnly.hasAiSteps, false);
  assert.equal(writtenOnly.estimatedCredits, 0);
  await writtenOnly.generateForCandidateById('p1');
  assert.equal(takeCalls('__aiCalls').length, 0);
  // La préparation fournit ce texte en attendant les valeurs du candidat (ensure), hors écran compris.
  const provider = between(modal, 'const writtenTextForAi = useCallback(async (profile: LinkedInProfile, step: SequenceStepPreview) => {', '}, [ensurePreviewValues]);');
  assert.match(provider, /const \{ entries, sendTime \} = await ensurePreviewValues\(\[profile\]\);/);
  assert.match(provider, /const keep = keptForSendKeys\(entry, sendTime\);/);
});

test('5D1-E7b génération en échec : texte de départ rendu pour le candidat (valeurs attendues), séquence 100 % IA comprise', async () => {
  const failing = await loadModule('src/hooks/useEnrollmentPreview.ts', {
    react: APPLYING_REACT_STUB,
    '@/lib/invokeWithCredits': 'export const invokeWithCredits = async () => ({ data: null, error: new Error("panne") }); export const estimateActionCredits = () => 1;',
    '@/integrations/supabase/client': 'export const supabase = {};',
    '@/hooks/useAuthReady': 'export const useAuthReady = () => ({ user: null });',
  });
  const profile = { id: 'p1', name: 'Julie Martin' };
  const steps = [{ stepId: 'ia', stepOrder: 0, actionType: 'message', messageTemplate: 'Bonjour {{prenom}}, {{poste_actuel}}', subjectTemplate: '', useAiPersonalization: true }];
  const writtenText = async (p, step) => ({ subject: '', message: step.messageTemplate.replace('{{prenom}}', 'Julie').replace(', {{poste_actuel}}', '') });
  const hook = failing.useEnrollmentPreview({ steps, profiles: [profile], job: null, accountId: 'acc', writtenText });
  await hook.generateForCandidateById('p1');
  // Texte de départ gardé dans l'aperçu (non enregistré : ni généré ni retouché).
  assert.deepEqual(hook.getMessageOverrides('p1'), {});
  // Retouche de l'objet seul : le texte de départ est celui rendu pour le candidat, jamais le modèle brut.
  hook.editMessage('p1', 'ia', 'subject', 'Objet');
  assert.equal(hook.getMessageOverrides('p1').ia.message, 'Bonjour Julie');
  // La préparation demande les valeurs même sans étape écrite (ensure ne dépend pas de l'écran).
  assert.doesNotMatch(between(hookSrc, 'const ensure = useCallback(', '}, [request, store]);'), /enabled/);
});

test('5D1-E9 étape écrite prête seulement avec ses valeurs : bandeau, liste, récapitulatif et barre du candidat', () => {
  const ready = between(modal, 'const stepReady = useCallback(', ');\n');
  assert.match(ready, /\? isReady\(candidateId, step\.stepId\)/, 'étape IA : générée ou retouchée');
  assert.match(ready, /: previewEntryOf\(candidateId\)\?\.status === 'ready' \|\| !!getPreview\(candidateId, step\.stepId\)\?\.isEdited\)/, 'étape écrite : valeurs du serveur ou retouche');
  assert.doesNotMatch(ready, /!step\.useAiPersonalization \|\|/, 'plus jamais prête d’office');
  assert.match(modal, /const readyCount = activeProfiles\.filter\(p => messageSteps\.every\(s => stepReady\(p\.id, s\)\)\)\.length;/);
  assert.match(modal, /return messages\.length > 0 && messages\.every\(m => stepReady\(p\.id, m\.step\)\);/, 'premier candidat prêt du récapitulatif');
  assert.match(modal, /const allGenerated = messageSteps\.every\(s => \(s\.useAiPersonalization \? !!getPreview\(p\.id, s\.stepId\)\?\.isGenerated : stepReady\(p\.id, s\)\)\);/);
  assert.match(modal, /isReady=\{step => stepReady\(selectedProfile\.id, step\)\}/);
  // Barre du candidat : « Générer » seulement pour une étape IA ; une étape écrite en préparation le dit sur sa carte.
  const bar = between(modal, 'function CandidatePreviewsBar(', 'function MessageStepCard(');
  assert.match(bar, /\{missingAi > 0 && \(/);
  assert.match(bar, /missingAi > 1 \? `Générer les \$\{missingAi\} aperçus` : "Générer l'aperçu"/);
  // « Générer tous les aperçus » prépare aussi les étapes écrites (valeurs demandées, gratuit).
  const generate = between(previewHookSrc, 'const generateForCandidate = useCallback(', 'const generateForCandidateById = useCallback(');
  assert.match(generate, /const firstWritten = messageSteps\.find\(s => !s\.useAiPersonalization\);\n\s*if \(firstWritten\) await writtenMessage\(profile, firstWritten\);/);
});

test('5D1-E10 première retouche d’une étape écrite : texte et objet rendus gardés (InMail sans objet perdu)', async () => {
  const applying = await loadModule('src/hooks/useEnrollmentPreview.ts', {
    react: APPLYING_REACT_STUB,
    '@/lib/invokeWithCredits': 'export const invokeWithCredits = async () => ({ data: { message: "x" }, error: null }); export const estimateActionCredits = () => 1;',
    '@/integrations/supabase/client': 'export const supabase = {};',
    '@/hooks/useAuthReady': 'export const useAuthReady = () => ({ user: null });',
  });
  const steps = [{ stepId: 'in', stepOrder: 0, actionType: 'inmail', messageTemplate: 'Bonjour {{prenom}}', subjectTemplate: 'Poste chez {{client}}', useAiPersonalization: false }];
  const hook = applying.useEnrollmentPreview({ steps, profiles: [{ id: 'p1', name: 'Julie Martin' }], job: null, accountId: 'acc' });
  const base = { subject: 'Poste chez Globex', message: 'Bonjour Julie' };
  hook.editMessage('p1', 'in', 'message', 'Bonjour Julie, je reviens vers vous', base);
  assert.deepEqual(hook.getMessageOverrides('p1').in, { subject: 'Poste chez Globex', message: 'Bonjour Julie, je reviens vers vous', isEdited: true });
  // Retouches suivantes : le texte déjà modifié reste, la base n'écrase rien.
  hook.editMessage('p1', 'in', 'message', 'Bonjour Julie, je reviens', { subject: 'Autre', message: 'Autre' });
  assert.deepEqual(hook.getMessageOverrides('p1').in, { subject: 'Poste chez Globex', message: 'Bonjour Julie, je reviens', isEdited: true });
  // La carte passe la base (texte et objet modifiables) à la première retouche ; le champ Objet part de l'objet rendu.
  const card = between(modal, 'function MessageStepCard(', 'function SummaryMode(');
  assert.match(card, /writtenReady \? \{ subject: writtenReady\.editableSubject, message: writtenReady\.editableText \} : undefined,/);
  assert.match(card, /const subject = writtenReady \? writtenReady\.editableSubject : preview\?\.subject \|\| '';/);
  assert.match(card, /onChange=\{e => editField\('subject', e\.target\.value\)\}/);
  assert.match(card, /onChange=\{e => editField\('message', e\.target\.value\)\}/);
  assert.match(modal, /onEditMessage=\{\(field, value, base\) => editMessage\(selectedCandidateId, step\.stepId, field, value, base\)\}/);
});

test('5D1-E11 note d’invitation affichée coupée à 300 caractères, comme le moteur l’envoie', () => {
  assert.match(modal, /const shownText = \(actionType: string, text: string\) => \(actionType === 'connection_request' \? inviteNoteText\(text\) : text\);/);
  const card = between(modal, 'function MessageStepCard(', 'function SummaryMode(');
  assert.match(card, /\{shownText\(step\.actionType, writtenReady\.text\) \|\|/, 'étape écrite');
  assert.match(card, /renderSendTimeVariables\(shownText\(step\.actionType, \(preview\?\.message \|\| ''\)/, 'retouche ou aperçu généré');
  const first = between(modal, 'const firstMessageFor = (profile: LinkedInProfile): FirstMessagePreview => {', '// Pied :');
  assert.match(first, /text: shownText\(step\.actionType, \(preview\?\.message \|\| ''\)/);
  assert.match(first, /text: shownText\(step\.actionType, written\.text\),/);
  // Le champ de retouche garde le texte entier (le moteur coupe à l'envoi).
  assert.match(card, /value=\{message\.replace\(\/<\[\^>\]\+>\/g, ''\)\}/);
});

test('5D1-E12 étape écrite retouchée : « Revenir au modèle », pas « nouvelle version générée »', () => {
  const card = between(modal, 'function MessageStepCard(', 'function SummaryMode(');
  assert.match(card, /const isWrittenStep = written !== undefined && written !== null;/);
  assert.match(card, /aria-label=\{isWrittenStep \? 'Revenir au modèle' : `Régénérer ce message \(\$\{cost\}\)`\}/);
  assert.match(card, /'Votre modification sera remplacée par le message de la séquence, rendu pour ce candidat\. Cette action est irréversible\.'/);
  assert.match(card, /'Le message que vous avez modifié sera remplacé par une nouvelle version générée\. Cette action est irréversible\.'/);
  assert.match(card, /\{isWrittenStep \? 'Revenir au modèle' : 'Régénérer'\}/);
  // L'étape écrite reçoit `written` ; une étape IA, null.
  assert.match(modal, /written=\{step\.useAiPersonalization \? null : writtenPreviewOf\(selectedProfile, step\)\}/);
});

test('5D1-E8 textes visibles du hook d’aperçu : français, sans nom de fournisseur ni tiret long', () => {
  const src = hookSrc.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');
  const strings = [...src.matchAll(/(["'`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)].map((m) => m[2]);
  for (const s of strings) {
    assert.doesNotMatch(s, /Unipile|Apollo|People Data Labs|\bPDL\b|Anthropic|Claude|Notion|—/, `« ${s} »`);
  }
  assert.match(hookSrc, /export const PREVIEW_VALUES_FAILED_MESSAGE = "L'aperçu de ce message n'a pas pu être préparé\. Réessayez dans un instant\.";/);
});

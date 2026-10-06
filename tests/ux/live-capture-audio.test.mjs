/**
 * Assistant d'entretien en direct : capture de la voix du candidat.
 *
 * Le micro seul n'entend pas le candidat quand on porte un casque. Le panneau
 * partage maintenant l'audio de la visio (onglet ou écran) en plus du micro, et
 * transcrit chaque source à part : le micro est le recruteur, l'audio partagé le
 * candidat.
 *  - règles pures (src/lib/liveAudioCapture.ts) : navigateurs compatibles,
 *    partage refusé ou sans son, texte transmis à l'analyse, adresse de transcription ;
 *  - gardes sur le panneau : ordre du démarrage, une source par flux, arrêt de
 *    toutes les sources, reprise du partage ;
 *  - guide audio conforme à ce que fait le code.
 * Le son réel et la transcription ne se testent pas ici : voir la PR.
 * Lancer : node --test tests/ux/live-capture-audio.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
/** Code sans commentaires : les commentaires citent parfois ce qui est proscrit. */
const code = (rel) =>
  read(rel)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

async function load(contents) {
  const { outputFiles } = await build({
    stdin: { contents, resolveDir: ROOT, loader: 'ts' },
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    tsconfig: join(ROOT, 'tsconfig.app.json'),
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
}

const lib = await load("export * from './src/lib/liveAudioCapture';");

const UA = {
  chromeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
  edgeWindows: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36 Edg/154.0.0.0',
  chromeMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Safari/537.36',
  firefox: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:140.0) Gecko/20100101 Firefox/140.0',
  safariMac: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  chromeAndroid: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/154.0.0.0 Mobile Safari/537.36',
  chromeIos: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/154.0.0.0 Mobile/15E148 Safari/604.1',
};

// ─── Navigateurs compatibles ──────────────────────────────────────────────

test('partage audio : Chrome et Edge sur ordinateur, Windows ou Mac', () => {
  for (const userAgent of [UA.chromeWindows, UA.edgeWindows, UA.chromeMac]) {
    assert.equal(lib.supportsDisplayAudio({ userAgent, hasGetDisplayMedia: true }), true, userAgent);
  }
});

test('partage audio : Firefox, Safari et les navigateurs mobiles ne partagent pas le son', () => {
  for (const userAgent of [UA.firefox, UA.safariMac, UA.chromeAndroid, UA.chromeIos]) {
    assert.equal(lib.supportsDisplayAudio({ userAgent, hasGetDisplayMedia: true }), false, userAgent);
  }
});

test('partage audio : sans getDisplayMedia, ou marqué mobile par le navigateur, jamais proposé', () => {
  assert.equal(lib.supportsDisplayAudio({ userAgent: UA.chromeWindows, hasGetDisplayMedia: false }), false);
  assert.equal(lib.supportsDisplayAudio({ userAgent: UA.chromeWindows, hasGetDisplayMedia: true, mobile: true }), false);
});

test('partage audio : les marques du navigateur suffisent quand l\'agent utilisateur est réduit', () => {
  assert.equal(
    lib.supportsDisplayAudio({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', hasGetDisplayMedia: true, brands: ['Not-A.Brand', 'Chromium', 'Google Chrome'] }),
    true,
  );
  assert.equal(
    lib.supportsDisplayAudio({ userAgent: 'Mozilla/5.0 (X11; Linux x86_64)', hasGetDisplayMedia: true, brands: ['Safari'] }),
    false,
  );
});

// ─── Capture : partage refusé, sans son, réussi ───────────────────────────

function fakeTrack(kind) {
  return { kind, stopped: false, stop() { this.stopped = true; } };
}

function installBrowser({ userAgent = UA.chromeWindows, getDisplayMedia }) {
  const previous = { navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator'), MediaStream: globalThis.MediaStream };
  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: { userAgent, mediaDevices: { getDisplayMedia } },
  });
  globalThis.MediaStream = class {
    constructor(tracks = []) { this.tracks = tracks; }
    getTracks() { return this.tracks; }
    getAudioTracks() { return this.tracks.filter((t) => t.kind === 'audio'); }
  };
  return () => {
    if (previous.navigator) Object.defineProperty(globalThis, 'navigator', previous.navigator);
    else delete globalThis.navigator;
    globalThis.MediaStream = previous.MediaStream;
  };
}

function sharedStream(...kinds) {
  const tracks = kinds.map(fakeTrack);
  return {
    tracks,
    getTracks: () => tracks,
    getAudioTracks: () => tracks.filter((t) => t.kind === 'audio'),
  };
}

test('capture : fenêtre fermée ou partage refusé = « annulé », jamais une panne', async () => {
  const restore = installBrowser({ getDisplayMedia: async () => { throw Object.assign(new Error('x'), { name: 'NotAllowedError' }); } });
  try {
    await assert.rejects(lib.captureDisplayAudio(), (e) => e instanceof lib.DisplayAudioError && e.reason === 'cancelled');
  } finally { restore(); }
});

test('capture : autre erreur du navigateur = « échec »', async () => {
  const restore = installBrowser({ getDisplayMedia: async () => { throw Object.assign(new Error('x'), { name: 'AbortError' }); } });
  try {
    await assert.rejects(lib.captureDisplayAudio(), (e) => e instanceof lib.DisplayAudioError && e.reason === 'failed');
  } finally { restore(); }
});

test('capture : partage sans son (case « Partager aussi l\'audio » oubliée) = refusé, et tout est arrêté', async () => {
  const shared = sharedStream('video');
  const restore = installBrowser({ getDisplayMedia: async () => shared });
  try {
    await assert.rejects(lib.captureDisplayAudio(), (e) => e instanceof lib.DisplayAudioError && e.reason === 'no-audio');
    assert.ok(shared.tracks.every((t) => t.stopped), 'la vidéo du partage doit être arrêtée');
  } finally { restore(); }
});

test('capture : navigateur sans partage audio = « non pris en charge », fenêtre jamais ouverte', async () => {
  let opened = false;
  const restore = installBrowser({ userAgent: UA.firefox, getDisplayMedia: async () => { opened = true; return sharedStream('audio'); } });
  try {
    await assert.rejects(lib.captureDisplayAudio(), (e) => e instanceof lib.DisplayAudioError && e.reason === 'unsupported');
    assert.equal(opened, false);
  } finally { restore(); }
});

test('capture : le flux transcrit est l\'audio seul, le partage entier est surveillé et se relâche', async () => {
  const shared = sharedStream('video', 'audio');
  let options;
  const restore = installBrowser({ getDisplayMedia: async (o) => { options = o; return shared; } });
  try {
    const capture = await lib.captureDisplayAudio();
    assert.deepEqual(capture.stream.getTracks().map((t) => t.kind), ['audio']);
    assert.equal(capture.watched.length, 2, "l'arrêt du partage est surveillé sur l'audio et la vidéo");
    // Son numérique : ni débruitage, ni égalisation, ni annulation d'écho.
    assert.deepEqual(options.audio, { echoCancellation: false, noiseSuppression: false, autoGainControl: false });
    // Vidéo réduite au minimum, Konekt lui-même exclu de la fenêtre de partage.
    assert.deepEqual(options.video, { frameRate: 1, width: 160, height: 90 });
    assert.equal(options.selfBrowserSurface, 'exclude');
    capture.release();
    assert.ok(shared.tracks.every((t) => t.stopped), 'release arrête audio et vidéo');
  } finally { restore(); }
});

// ─── Texte transmis à l'analyse, adresse, préférence ──────────────────────

const label = (speaker) => (speaker === 0 ? 'Recruteur' : 'Candidat');

test('texte : avec deux sources, une ligne étiquetée à chaque changement de locuteur', () => {
  let transcript = '';
  let last = null;
  for (const [speaker, text] of [[0, 'Parlez-moi de votre parcours.'], [1, 'Je suis développeur React.'], [1, 'Depuis six ans.'], [0, 'Et en équipe ?']]) {
    transcript += lib.turnPiece(last, speaker, text, true, label);
    last = speaker;
  }
  assert.equal(
    transcript,
    '\n[Recruteur] Parlez-moi de votre parcours.\n[Candidat] Je suis développeur React. Depuis six ans.\n[Recruteur] Et en équipe ?',
  );
});

test('texte : avec une seule piste, le texte reste continu et sans étiquette (la distinction des voix peut se tromper)', () => {
  let transcript = '';
  let last = null;
  for (const [speaker, text] of [[0, 'Bonjour.'], [1, 'Bonjour à vous.']]) {
    transcript += lib.turnPiece(last, speaker, text, false, label);
    last = speaker;
  }
  assert.equal(transcript, ' Bonjour. Bonjour à vous.');
});

test('adresse : distinction des voix demandée seulement pour une piste mélangée', () => {
  const mixed = new URL(lib.transcriptionUrl(true));
  const separate = new URL(lib.transcriptionUrl(false));
  assert.equal(mixed.searchParams.get('diarize'), 'true');
  assert.equal(separate.searchParams.get('diarize'), 'false');
  for (const url of [mixed, separate]) {
    assert.equal(url.searchParams.get('language'), 'fr');
    assert.equal(url.searchParams.get('interim_results'), 'true');
  }
});

test('préférence : « visio ou appel » par défaut, le choix « sur place » est gardé, stockage indisponible toléré', () => {
  const store = new Map();
  globalThis.localStorage = { getItem: (k) => store.get(k) ?? null, setItem: (k, v) => store.set(k, v) };
  try {
    assert.equal(lib.readCaptureMode(), 'meeting');
    lib.storeCaptureMode('mic');
    assert.equal(lib.readCaptureMode(), 'mic');
    lib.storeCaptureMode('meeting');
    assert.equal(lib.readCaptureMode(), 'meeting');
    globalThis.localStorage = { getItem() { throw new Error('bloqué'); }, setItem() { throw new Error('bloqué'); } };
    assert.equal(lib.readCaptureMode(), 'meeting');
    assert.doesNotThrow(() => lib.storeCaptureMode('mic'));
  } finally { delete globalThis.localStorage; }
});

// ─── Gardes sur le panneau ────────────────────────────────────────────────

const panel = code('src/components/ats/LiveCoachingPanel.tsx');
const guide = code('src/components/ats/AudioSetupGuide.tsx');
const startBody = panel.slice(panel.indexOf('const startRecording = useCallback'), panel.indexOf('const restartMeetingAudio = useCallback'));

test('démarrage : partage avant micro, clé de transcription avant la séance et l\'introduction', () => {
  const order = [
    'await captureDisplayAudio()',
    'navigator.mediaDevices.getUserMedia',
    "invokeEdgeFunction<{ key?: string }>('deepgram-temp-key')",
    ".from('call_coaching_sessions')",
    "'generate_intro'",
  ].map((marker) => startBody.indexOf(marker));
  assert.ok(order.every((i) => i > 0), `étape absente du démarrage : ${order}`);
  assert.deepEqual([...order].sort((a, b) => a - b), order, 'ordre : partage, micro, clé, séance, introduction');
});

test('démarrage : un échec relâche le partage, le micro et les connexions ouvertes, sans alerte de transcription', () => {
  const failure = startBody.slice(startBody.indexOf('} catch (err) {'));
  assert.match(failure, /stoppingRef\.current = true;[\s\S]*?stopSources\(sourcesRef\.current\)/);
  assert.match(failure, /micStream\?\.getTracks\(\)\.forEach/);
  assert.match(failure, /meeting\?\.release\(\)/);
  assert.match(failure, /toastStartError\(err\)/);
});

test('sources : une connexion par flux, le micro est le recruteur, l\'audio partagé le candidat', () => {
  assert.match(startBody, /openSource\(micStream, 'mic', transcriptionKey\)/);
  assert.match(startBody, /openSource\(meeting\.stream, 'meeting', transcriptionKey\)/);
  assert.match(startBody, /kind === 'mic' \? 0 : 1/);
  // Deux sources : voix connues, aucune distinction à demander au service.
  assert.match(startBody, /transcriptionUrl\(!withMeeting\)/);
  assert.match(startBody, /turnPiece\(lastSpeakerRef\.current, speaker, finalText, withMeeting, speakerLabel\)/);
  // Le texte en cours d'une source n'est pas effacé par la phrase finale de l'autre.
  assert.match(startBody, /if \(interimSourceRef\.current === kind\) setInterimText\(''\)/);
});

test('arrêt : toutes les sources, le partage compris, à l\'arrêt demandé comme au démontage', () => {
  assert.equal((panel.match(/stopSources\(sourcesRef\.current\)/g) ?? []).length, 3, 'démontage, arrêt, échec du démarrage');
  assert.equal((panel.match(/meetingCaptureRef\.current\?\.release\(\)/g) ?? []).length >= 2, true);
  assert.doesNotMatch(panel, /socketRef|mediaRecorderRef/, 'plus de source unique');
});

test('reprise : le partage se relance sans arrêter le micro, l\'ancienne source est remplacée sans alerte', () => {
  const restart = panel.slice(panel.indexOf('const restartMeetingAudio = useCallback'), panel.indexOf('const stopRecording = useCallback'));
  assert.match(restart, /await captureDisplayAudio\(\)/);
  assert.match(restart, /'deepgram-temp-key'/);
  assert.match(restart, /s\.socket\.onerror = null;\s*s\.socket\.onclose = null;/);
  assert.match(restart, /filter\(\(s\) => s\.kind !== 'meeting'\)/);
  assert.match(restart, /openSource\(next\.stream, 'meeting', keyData\.key\)/);
  // Deux accès à la reprise : l'alerte quand le partage s'arrête, et « Changer le partage » en continu.
  assert.match(panel, /Relancer le partage/);
  assert.match(panel, /Changer le partage/);
});

test('annulation du partage : message dédié, jamais « Accès au microphone refusé »', () => {
  const toasts = panel.slice(panel.indexOf('function toastStartError'), panel.indexOf('export const LiveCoachingPanel'));
  assert.ok(toasts.indexOf('DisplayAudioError') < toasts.indexOf("'NotAllowedError'"), 'le partage annulé est reconnu avant le refus du micro');
  assert.ok(toasts.includes("'Partage annulé'"));
  assert.ok(toasts.includes("'Aucun son partagé'"));
});

test('choix de la source : « Visio ou appel » ou « Sur place », désactivé sans navigateur compatible', () => {
  assert.match(panel, /<ToggleGroupItem\s+value="meeting"\s+disabled=\{!meetingSupported\}/);
  assert.ok(panel.includes('Visio ou appel'));
  assert.ok(panel.includes('Sur place'));
  assert.match(panel, /const effectiveMode: CaptureMode = meetingSupported \? captureMode : 'mic'/);
  assert.match(panel, /storeCaptureMode\(mode\)/);
  // Le bouton principal reste le même.
  assert.match(panel, /<Button variant="primary" onClick=\{\(\) => void startRecording\(\)\}/);
});

test('guide audio : décrit le partage réel, ne promet plus une transcription Aircall ni un mixeur virtuel', () => {
  assert.ok(guide.includes("Cochez « Partager aussi l'audio de l'onglet »"));
  assert.ok(guide.includes("Cochez « Partager aussi l'audio du système »"));
  assert.ok(guide.includes('Windows'));
  assert.doesNotMatch(guide, /VB-Cable|BlackHole|récupérer la transcription|intégration Aircall/);
  assert.match(guide, />\s*Compris\s*</);
});

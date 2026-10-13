/**
 * Refonte mission, lot 5f-2d : « Inscrire dans une séquence » de la messagerie
 * (interrupteur des séquences allumé).
 *
 * - MessagesInbox : l'interrupteur se lit ici (jamais dans pages/Inbox.tsx), la branche
 *   allumée monte InboxContactSheet (chargée à l'ouverture), l'ancien dialogue et
 *   SequenceEnrollModal restent dans la branche éteinte, et la tranche évaluée par
 *   messagerie-onglets n'est pas touchée.
 * - unverifiedRelationNotice : module pur, lu sous Node.
 * - InboxContactSheet : lu dans son source, puis empaqueté par esbuild avec des doublures de
 *   React et du kit et appelé comme une fonction (pas de DOM) : candidat, poste, compte,
 *   avertissement, repli sans profil ou sans compte.
 *
 * Lancer : node --test tests/ux/lot5f2d-messagerie.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const read = (rel) => readFileSync(path.join(ROOT, rel), 'utf8');

/** Sans commentaires : les gardes de code lisent le code. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

const EM_DASH = String.fromCharCode(0x2014);
const EN_DASH = String.fromCharCode(0x2013);

let esbuild = null;
try {
  esbuild = await import('esbuild');
} catch {
  esbuild = null;
}

async function loadTs(t, rel) {
  try {
    return await import(`../../${rel}`);
  } catch (err) {
    if (err && err.code === 'ERR_UNKNOWN_FILE_EXTENSION') {
      t.skip('Node sans lecture native du TypeScript (22.18 ou plus requis)');
      return null;
    }
    throw err;
  }
}

const INBOX = 'src/components/outreach/MessagesInbox.tsx';
const INBOX_PAGE = 'src/pages/Inbox.tsx';
const SHEET = 'src/components/outreach/inbox/InboxContactSheet.tsx';
const PURE = 'src/components/outreach/inbox/unverifiedRelation.ts';

const NOTICE = "Relation LinkedIn non vérifiée : si vous êtes déjà en relation, l'invitation sera sautée.";

// ─── MessagesInbox : aiguillage ─────────────────────────────────────────────

test('5F2D-M1 l\'interrupteur se lit dans MessagesInbox, jamais dans la page Inbox', () => {
  const inbox = code(read(INBOX));
  assert.match(inbox, /import \{ useSequencesBeta \} from '@\/hooks\/useSequencesBeta';/);
  assert.equal((inbox.match(/useSequencesBeta\(\)/g) || []).length, 1, 'une seule lecture');
  assert.match(inbox, /const drafts = useChatDrafts\(\);\s*const sequencesV2 = useSequencesBeta\(\);/);
  // Garde 5F3-1 : la page Inbox ne connaît ni l'interrupteur ni le plan.
  assert.doesNotMatch(code(read(INBOX_PAGE)), /useSequencesBeta|sequencesBeta|hasPlanFeature/);
});

test('5F2D-M2 la tranche évaluée par messagerie-onglets n\'a pas bougé', () => {
  const inbox = read(INBOX);
  const from = inbox.indexOf('const externalCounts =');
  const to = inbox.indexOf('const { addReaction');
  assert.ok(from > 0 && to > from, 'tranche retrouvée');
  const slice = inbox.slice(from, to);
  assert.doesNotMatch(slice, /sequencesV2|useSequencesBeta|Suspense|InboxContactSheet/);
  // Rien d'inséré entre les deux repères : la tranche reste les deux instructions d'origine.
  assert.equal((slice.match(/\bconst\b/g) || []).length, 2, 'externalCounts et threadCounts seulement');
});

test('5F2D-M3 branche allumée : la feuille, chargée à l\'ouverture, ouverte par l\'état du dialogue', () => {
  const inbox = code(read(INBOX));
  // Chargement à la demande : aucun import statique.
  assert.doesNotMatch(inbox, /import \{ InboxContactSheet \}/);
  assert.match(
    inbox,
    /const InboxContactSheet = lazy\(\(\) =>\s*import\('\.\/inbox\/InboxContactSheet'\)\.then\(\(m\) => \(\{ default: m\.InboxContactSheet \}\)\),?\s*\);/,
  );
  assert.match(inbox, /import React, \{ Suspense, lazy, /);

  const on = inbox.slice(inbox.indexOf('{sequencesV2 ? ('), inbox.indexOf(') : ('));
  assert.ok(on.length > 100, 'branche allumée lue');
  assert.match(on, /inbox\.showSequenceSelect && \(\s*<Suspense fallback=\{null\}>\s*<InboxContactSheet/);
  assert.match(on, /open=\{inbox\.showSequenceSelect\}/);
  assert.match(on, /onOpenChange=\{inbox\.setShowSequenceSelect\}/);
  assert.match(on, /chat=\{inbox\.selectedChat\}/);
  assert.match(on, /accountId=\{selectedAccount\}/);
  assert.match(on, /missions=\{inbox\.activeMissions\}/);
  assert.match(on, /missionId=\{selectedMissionId\}/);
  assert.match(on, /onMissionChange=\{setSelectedMissionId\}/);
  // Fin d'inscription : les inscriptions de la messagerie sont relues.
  assert.match(on, /onEnrolled=\{\(\) => \{\s*inbox\.fetchEnrollments\(\);\s*\}\}/);
  // Rien d'autre dans cette branche : ni dialogue, ni ancienne fenêtre, ni adresse de séquence.
  assert.doesNotMatch(on, /<Dialog|SequenceEnrollModal|pendingSequence|\/sequences|SEQUENCES_PATH|sequencePath\(/);
});

test('5F2D-M4 branche éteinte : l\'ancien dialogue et SequenceEnrollModal, verbatim', () => {
  const raw = read(INBOX);
  const inbox = code(raw);
  const offStart = inbox.indexOf(') : (');
  const offEnd = inbox.indexOf('{inbox.showPipelineModal && candidateProfile && (');
  assert.ok(offStart > 0 && offEnd > offStart, 'branche éteinte retrouvée');
  const off = inbox.slice(offStart, offEnd);

  for (const needle of [
    '<Dialog open={inbox.showSequenceSelect} onOpenChange={inbox.setShowSequenceSelect}>',
    '<DialogTitle>Choisir une séquence</DialogTitle>',
    '<Label htmlFor="inbox-enroll-mission">Mission</Label>',
    'value={selectedMissionId || NO_MISSION}',
    "onValueChange={(value) => setSelectedMissionId(value === NO_MISSION ? '' : value)}",
    '<SelectTrigger id="inbox-enroll-mission" className="max-md:h-11">',
    '<SelectItem value={NO_MISSION}>Sans mission</SelectItem>',
    'title="Impossible de charger les séquences."',
    'onClick={() => void inbox.fetchSequences()}',
    'title="Aucune séquence active"',
    '<Link to="/missions" onClick={() => inbox.setShowSequenceSelect(false)}>',
    'aria-label="Séquences actives"',
    'onClick={() => handleChooseSequence(sequence)}',
    '{pendingSequence && enrollProfile && selectedAccount && (',
    '<SequenceEnrollModal',
    'accountId={selectedAccount}',
    'job={selectedMission ? { id: selectedMission.id, title: selectedMission.name } : null}',
    'notice={enrollNotice}',
    'setPendingSequence(null);',
    'inbox.fetchEnrollments();',
  ]) {
    assert.ok(off.includes(needle), `ancien bloc : « ${needle} » présent dans la branche éteinte`);
  }
  assert.equal((off.match(/<Dialog open=/g) || []).length, 1);
  assert.equal((off.match(/<SequenceEnrollModal/g) || []).length, 1);

  // Aussi en dehors du nouveau code : une seule occurrence de chaque, tout est dans la branche éteinte.
  assert.equal((inbox.match(/<Dialog open=\{inbox\.showSequenceSelect\}/g) || []).length, 1);
  assert.equal((inbox.match(/<SequenceEnrollModal/g) || []).length, 1);
  assert.match(inbox, /import \{ SequenceEnrollModal \} from '\.\/SequenceEnrollModal';/);

  // Le reste de la logique de l'ancien parcours (présélection de la mission, choix) n'est ni retiré ni dupliqué.
  for (const needle of [
    "const [pendingSequence, setPendingSequence] = useState<InboxSequenceOption | null>(null);",
    "const [selectedMissionId, setSelectedMissionId] = useState('');",
    'if (inbox.showSequenceSelect) setSelectedMissionId(linkedMissionId);',
    'const selectedMission = inbox.activeMissions.find(m => m.id === selectedMissionId) ?? null;',
    'const handleChooseSequence = (sequence: InboxSequenceOption) => {',
  ]) {
    assert.equal(inbox.split(needle).length - 1, 1, `« ${needle} » une fois`);
  }
  // Garde lot6a : une seule conversation montée.
  assert.equal((inbox.match(/<MessageView\b/g) || []).length, 1);
});

test('5F2D-M5 l\'aiguillage place l\'ancien bloc avant le dialogue du pipeline, la feuille avant lui', () => {
  const inbox = code(read(INBOX));
  const iSwitch = inbox.indexOf('{sequencesV2 ? (');
  const iSheet = inbox.indexOf('<InboxContactSheet');
  const iOff = inbox.indexOf(') : (');
  const iDialog = inbox.indexOf('<Dialog open={inbox.showSequenceSelect}');
  const iPipeline = inbox.indexOf('{inbox.showPipelineModal && candidateProfile && (');
  assert.ok(iSwitch > 0 && iSwitch < iSheet && iSheet < iOff && iOff < iDialog && iDialog < iPipeline);
  // La page est rendue une seule fois par branche.
  assert.equal((inbox.match(/<InboxContactSheet/g) || []).length, 1);
});

// ─── unverifiedRelationNotice : module pur ──────────────────────────────────

test('5F2D-M6 unverifiedRelationNotice : distance inconnue et séquence qui invite', async (t) => {
  const m = await loadTs(t, PURE);
  if (!m) return;
  const invite = [{ action_type: 'visit_profile' }, { action_type: 'connection_request' }, { action_type: 'message' }];
  assert.equal(m.UNVERIFIED_RELATION_NOTICE, NOTICE);

  // Distance inconnue (null, absente) et une étape d'invitation : l'avertissement.
  assert.equal(m.unverifiedRelationNotice(invite, null), NOTICE);
  assert.equal(m.unverifiedRelationNotice(invite, undefined), NOTICE);

  // Distance connue, quelle qu'elle soit : rien.
  for (const known of ['FIRST_DEGREE', 'SECOND_DEGREE', 'THIRD_DEGREE', 'OUT_OF_NETWORK', 'SELF']) {
    assert.equal(m.unverifiedRelationNotice(invite, known), null, known);
  }

  // Sans étape d'invitation : rien, même sans distance.
  assert.equal(m.unverifiedRelationNotice([{ action_type: 'message' }, { action_type: 'inmail' }], null), null);
  assert.equal(m.unverifiedRelationNotice([], null), null);
  assert.equal(m.unverifiedRelationNotice(null, null), null);
  assert.equal(m.unverifiedRelationNotice(undefined, null), null);
});

test('5F2D-M7 unverifiedRelationNotice : les deux écritures du type d\'étape, comme l\'ancien parcours', async (t) => {
  const m = await loadTs(t, PURE);
  if (!m) return;
  assert.equal(m.unverifiedRelationNotice([{ actionType: 'connection_request' }], null), NOTICE);
  assert.equal(m.unverifiedRelationNotice([{ action_type: null, actionType: 'connection_request' }], null), NOTICE);
  assert.equal(m.unverifiedRelationNotice([{ action_type: '', actionType: 'message' }], null), null);
  // Une chaîne vide n'est pas « inconnue » : la règle ne regarde que null et undefined.
  assert.equal(m.unverifiedRelationNotice([{ action_type: 'connection_request' }], ''), null);
});

test('5F2D-M8 le module pur n\'importe rien et ne dit rien de plus', () => {
  const src = read(PURE);
  assert.doesNotMatch(code(src), /^\s*import\b/m, 'aucun import : chargeable par Node');
  assert.ok(!src.includes(EM_DASH) && !src.includes(EN_DASH));
  assert.doesNotMatch(src, /\(s\)|Unipile|Apollo|PDL/);
});

// ─── InboxContactSheet : source ─────────────────────────────────────────────

test('5F2D-M9 InboxContactSheet : candidat sur valeurs simples, poste préfixé, compte de la page', () => {
  const src = read(SHEET);
  const body = code(src);

  // Candidat : valeurs simples, profil de l'ancien parcours (distance du participant comprise).
  assert.match(body, /const linkedinId = person\?\.linkedinId \?\? null;/);
  assert.match(body, /attendee\?\.specifics\?\.network_distance \?\? attendee\?\.network_distance \?\? undefined/);
  assert.match(body, /const distance = normalizeNetworkDistance\(rawDistance\);/);
  assert.match(body, /\[linkedinId, name, headline, profileUrl, picture, rawDistance\]/);
  assert.match(body, /profileToFlowCandidate\(profile, \{ hasLinkedIn: !!linkedinId \}\)/);
  assert.match(body, /id: linkedinId,/);
  assert.match(body, /profile_url: profileUrl,\s*public_profile_url: profileUrl,/);
  assert.match(body, /profile_picture_url: picture,/);
  assert.match(body, /network_distance: rawDistance,/);
  // Ni l'objet de la conversation ni un profil construit au rendu ne servent de dépendance.
  assert.doesNotMatch(body, /\}, \[[^\]]*\b(chat|person|attendee|candidateProfile|enrollProfile)\b[^\]]*\]\)/);
  // Aucune ligne de Pipeline : le candidat n'a pas de rowId.
  assert.doesNotMatch(body, /rowId/);
  assert.doesNotMatch(body, /onOpenCandidate/);

  // Poste, mission, compte, avertissement, fin d'inscription.
  assert.match(body, /id: `project:\$\{missionKey\}`, title: missionName/);
  assert.match(body, /missionId=\{missionKey\}/);
  assert.match(body, /job=\{job\}/);
  assert.match(body, /accountId=\{accountId\}/);
  assert.match(body, /notice=\{notice\}/);
  assert.match(body, /unverifiedRelationNotice\(steps, distance\)/);
  assert.match(body, /onEnrolled=\{\(\) => onEnrolled\(\)\}/);
  assert.match(body, /above=\{/);

  // Le choix de la mission : mêmes id, classes et options que l'ancien dialogue, par le kit.
  assert.match(body, /<Label htmlFor="inbox-enroll-mission">Mission<\/Label>/);
  assert.match(body, /<SelectTrigger id="inbox-enroll-mission" className="max-md:h-11">/);
  assert.match(body, /<SelectItem value=\{NO_MISSION\}>Sans mission<\/SelectItem>/);
  assert.match(body, /onValueChange=\{\(value\) => onMissionChange\(value === NO_MISSION \? '' : value\)\}/);
  assert.match(body, /const NO_MISSION = '__none__';/);
  assert.doesNotMatch(body, /<button\b|<select\b/, 'composants du kit, pas de balise brute');
});

test('5F2D-M10 InboxContactSheet : aucune écriture, aucune adresse de séquence, textes propres', () => {
  const src = read(SHEET);
  const body = code(src);
  // Aucune écriture ni lecture : le flux s'en charge.
  assert.doesNotMatch(body, /supabase|\.from\(|\.rpc\(|retainCandidates|enrollCandidates|localStorage|sessionStorage|navigate/);
  // Garde seq-v2-socle : pas d'adresse de séquence hors des fichiers autorisés (les chemins d'import mis à part).
  assert.doesNotMatch(src, /['"`]\/sequences\b|\bSEQUENCES_PATH\b|\bsequencePath\(/);
  assert.doesNotMatch(src.replace(/from '[^']*'/g, ''), /\/sequences|SEQUENCES_PATH|sequencePath\(/);
  // Pas de tiret long, de « (s) », de nom de prestataire.
  assert.ok(!src.includes(EM_DASH) && !src.includes(EN_DASH));
  assert.doesNotMatch(src, /\(s\)|Unipile|Apollo|PDL|People Data Labs/);
  // Vouvoiement.
  assert.doesNotMatch(body, /\b(tu|ton|ta|tes|toi|te)\b/i);
  // Les deux phrases de repli et le bouton.
  assert.match(body, /ne peut pas être inscrit dans une séquence/);
  assert.match(body, /reliez votre compte dans Paramètres, puis réessayez/);
  assert.match(body, />\s*Fermer\s*</);
  // Les hooks sont tous avant le repli (règle des hooks).
  assert.ok(body.lastIndexOf('useMemo(') < body.indexOf('if (candidates.length === 0 || !accountId)'));
  assert.ok(body.lastIndexOf('useCallback(') < body.indexOf('if (candidates.length === 0 || !accountId)'));
});

// ─── InboxContactSheet : comportement ───────────────────────────────────────

const SRC_DIR = path.join(ROOT, 'src');

/** Doublures : React et le kit réduits à des marqueurs, la feuille du flux aussi ; le reste est le vrai code. */
const STUBS = {
  react: 'export const useMemo = (fn) => fn(); export const useCallback = (fn) => fn;',
  'react/jsx-runtime': `
    export const Fragment = 'Fragment';
    export const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
    export const jsxs = jsx;
  `,
  '@/components/ui/button': "export const Button = 'Button';",
  '@/components/ui/label': "export const Label = 'Label';",
  '@/components/ui/select': `
    export const Select = 'Select';
    export const SelectContent = 'SelectContent';
    export const SelectItem = 'SelectItem';
    export const SelectTrigger = 'SelectTrigger';
    export const SelectValue = 'SelectValue';
  `,
  '@/components/ui/sheet': `
    export const Sheet = 'Sheet';
    export const SheetClose = 'SheetClose';
    export const SheetContent = 'SheetContent';
    export const SheetDescription = 'SheetDescription';
    export const SheetFooter = 'SheetFooter';
    export const SheetHeader = 'SheetHeader';
    export const SheetTitle = 'SheetTitle';
  `,
  '@/components/sequences/contact/ContactFlowSheet': "export const ContactFlowSheet = 'ContactFlowSheet';",
  // Modules de l'application que le test n'a pas à charger.
  '@/components/outreach/sequence/sequenceGraph': 'export const isStepTypeOffered = () => true;',
  'date-fns': 'export const format = () => ""; export const isToday = () => false; export const isYesterday = () => false; export const parseISO = (v) => v;',
  '@/lib/relativeTime': 'export const timeAgo = () => null;',
  '@/lib/inboxThreadState': "export const threadState = () => 'none';",
  './useMessagesInbox': 'export {};',
};

function resolveAlias(request) {
  const base = path.join(SRC_DIR, request.slice(2));
  for (const suffix of ['.ts', '.tsx', '/index.ts', '/index.tsx']) {
    if (existsSync(base + suffix)) return base + suffix;
  }
  return undefined;
}

async function loadSheet() {
  const result = await esbuild.build({
    entryPoints: [path.join(ROOT, SHEET)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'neutral',
    jsx: 'automatic',
    logLevel: 'silent',
    plugins: [{
      name: 'stubs',
      setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => {
          if (args.path in STUBS) return { path: args.path, namespace: 'stub' };
          if (args.path.startsWith('@/')) {
            const resolved = resolveAlias(args.path);
            if (resolved) return { path: resolved };
          }
          return undefined;
        });
        b.onLoad({ filter: /.*/, namespace: 'stub' }, (args) => ({ contents: STUBS[args.path], loader: 'js' }));
      },
    }],
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

/** Premier nœud (dans l'arbre rendu) qui satisfait le prédicat. */
function find(node, predicate) {
  if (node === null || typeof node !== 'object') return null;
  if (Array.isArray(node)) {
    for (const child of node) {
      const hit = find(child, predicate);
      if (hit) return hit;
    }
    return null;
  }
  if (predicate(node)) return node;
  return find(node.props?.children, predicate);
}
function findAll(node, predicate, out = []) {
  if (node === null || typeof node !== 'object') return out;
  if (Array.isArray(node)) {
    node.forEach((child) => findAll(child, predicate, out));
    return out;
  }
  if (predicate(node)) out.push(node);
  findAll(node.props?.children, predicate, out);
  return out;
}
const textOf = (node) => {
  if (node === null || node === undefined || node === false) return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return textOf(node.props?.children);
};

const attendee = (extra = {}) => ({
  id: 'att_1',
  name: 'Camille Durand',
  headline: 'CTO chez Acme',
  profile_url: 'https://www.linkedin.com/in/camille-durand',
  attendee_provider_id: 'ACoAAAcamille',
  provider_id: 'ACoAAAcamille',
  profile_picture_url: 'https://media.licdn.com/camille.jpg',
  ...extra,
});
const chatOf = (attendeeExtra = {}, chatExtra = {}) => ({
  id: 'chat_1',
  account_id: 'acc_1',
  attendees: [attendee(attendeeExtra)],
  ...chatExtra,
});
const MISSIONS = [
  { id: '11111111-1111-4111-8111-111111111111', name: 'CTO Fintech', job_id: null, job_title: 'CTO', client_name: null, status: 'active', outreach_config: null },
  { id: '22222222-2222-4222-8222-222222222222', name: 'Head of Data', job_id: null, job_title: null, client_name: null, status: 'active', outreach_config: null },
];

function props(extra = {}) {
  const calls = { open: [], mission: [], enrolled: [] };
  return {
    calls,
    value: {
      open: true,
      onOpenChange: (v) => calls.open.push(v),
      chat: chatOf({ specifics: { network_distance: 'DISTANCE_2' } }),
      accountId: 'acc_page',
      missions: MISSIONS,
      missionId: '',
      onMissionChange: (id) => calls.mission.push(id),
      onEnrolled: (...args) => calls.enrolled.push(args),
      ...extra,
    },
  };
}
const sheetOf = (tree) => find(tree, (n) => n.type === 'ContactFlowSheet');

test('5F2D-M11 flux monté : candidat de la conversation, compte de la page, sans mission', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const kit = await loadSheet();
  const { value } = props();
  const tree = kit.InboxContactSheet(value);
  assert.equal(tree.type, 'ContactFlowSheet');
  const p = tree.props;
  assert.equal(p.open, true);
  assert.equal(p.onOpenChange, value.onOpenChange);
  assert.equal(p.title, 'Inscrire dans une séquence');
  assert.equal(p.accountId, 'acc_page', 'le compte de la page, pas celui de la conversation');
  assert.equal(p.missionId, null);
  assert.equal(p.job, null, 'sans mission, aucun poste : rien n\'est écrit dans le Pipeline');
  assert.equal(p.candidates.length, 1);
  const [c] = p.candidates;
  assert.equal(c.id, 'ACoAAAcamille');
  assert.equal(c.rowId, null);
  assert.equal(c.candidateId, 'ACoAAAcamille');
  assert.equal(c.name, 'Camille Durand');
  assert.equal(c.headline, 'CTO chez Acme');
  assert.equal(c.pictureUrl, 'https://media.licdn.com/camille.jpg');
  assert.equal(c.hasLinkedIn, true);
  // Le profil est celui de l'ancien parcours.
  assert.equal(c.profile.id, 'ACoAAAcamille');
  assert.equal(c.profile.name, 'Camille Durand');
  assert.equal(c.profile.headline, 'CTO chez Acme');
  assert.equal(c.profile.profile_url, 'https://www.linkedin.com/in/camille-durand');
  assert.equal(c.profile.public_profile_url, 'https://www.linkedin.com/in/camille-durand');
  assert.equal(c.profile.profile_picture_url, 'https://media.licdn.com/camille.jpg');
  assert.equal(c.profile.network_distance, 'DISTANCE_2');
  assert.equal(c.profile.provider_id, undefined, 'comme avant : pas d\'identifiant du fournisseur sur le profil mince');
  // Pas de fiche à ouvrir depuis la messagerie.
  assert.equal(p.onOpenCandidate, undefined);
  assert.equal(typeof p.notice, 'function');
});

test('5F2D-M12 mission choisie : identifiant nu pour le flux, poste préfixé « project: » avec le nom', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const kit = await loadSheet();
  const chosen = MISSIONS[1];
  const { value } = props({ missionId: chosen.id });
  const p = sheetOf(kit.InboxContactSheet(value)).props;
  assert.equal(p.missionId, chosen.id);
  assert.deepEqual(p.job, { id: `project:${chosen.id}`, title: 'Head of Data' });

  // Une mission qui n'est plus dans la liste : comme « Sans mission », jamais un poste fantôme.
  const gone = sheetOf(kit.InboxContactSheet(props({ missionId: 'inconnue' }).value)).props;
  assert.equal(gone.missionId, null);
  assert.equal(gone.job, null);
});

test('5F2D-M13 choix de la mission au-dessus du flux : mêmes options, « Sans mission » rend la chaîne vide', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const kit = await loadSheet();
  const { value, calls } = props({ missionId: MISSIONS[0].id });
  const above = sheetOf(kit.InboxContactSheet(value)).props.above;
  assert.ok(above, 'le choix est passé à la feuille');

  const label = find(above, (n) => n.type === 'Label');
  assert.equal(label.props.htmlFor, 'inbox-enroll-mission');
  assert.equal(textOf(label), 'Mission');
  const select = find(above, (n) => n.type === 'Select');
  assert.equal(select.props.value, MISSIONS[0].id);
  const trigger = find(above, (n) => n.type === 'SelectTrigger');
  assert.equal(trigger.props.id, 'inbox-enroll-mission');
  assert.equal(trigger.props.className, 'max-md:h-11');

  const items = findAll(above, (n) => n.type === 'SelectItem');
  assert.deepEqual(items.map((n) => textOf(n)), ['Sans mission', 'CTO Fintech', 'Head of Data']);
  assert.deepEqual(items.map((n) => n.props.value), ['__none__', MISSIONS[0].id, MISSIONS[1].id]);

  select.props.onValueChange('__none__');
  select.props.onValueChange(MISSIONS[1].id);
  assert.deepEqual(calls.mission, ['', MISSIONS[1].id]);

  // Sans mission, la valeur affichée est l'option « Sans mission ».
  const none = sheetOf(kit.InboxContactSheet(props({ missionId: '' }).value)).props.above;
  assert.equal(find(none, (n) => n.type === 'Select').props.value, '__none__');
});

test('5F2D-M14 avertissement calculé sur les étapes de la séquence que le flux a choisie', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const kit = await loadSheet();
  const invite = [{ action_type: 'connection_request' }, { action_type: 'message' }];
  const messageOnly = [{ action_type: 'message' }];

  // Distance inconnue (le fournisseur n'en donne pas).
  const unknown = sheetOf(kit.InboxContactSheet(props({ chat: chatOf() }).value)).props;
  assert.equal(unknown.notice(invite), NOTICE);
  assert.equal(unknown.notice(messageOnly), null);
  assert.equal(unknown.candidates[0].profile.network_distance, undefined);

  // Distance connue, sous l'une ou l'autre écriture du fournisseur.
  const nested = sheetOf(kit.InboxContactSheet(props({ chat: chatOf({ specifics: { network_distance: 'DISTANCE_1' } }) }).value)).props;
  assert.equal(nested.notice(invite), null);
  const root = sheetOf(kit.InboxContactSheet(props({ chat: chatOf({ network_distance: 'FIRST_DEGREE' }) }).value)).props;
  assert.equal(root.notice(invite), null);
  assert.equal(root.candidates[0].profile.network_distance, 'FIRST_DEGREE');
  // La distance imbriquée passe avant celle de la racine, comme dans l'ancien parcours.
  const both = sheetOf(kit.InboxContactSheet(props({ chat: chatOf({ specifics: { network_distance: 'DISTANCE_3' }, network_distance: 'FIRST_DEGREE' }) }).value)).props;
  assert.equal(both.candidates[0].profile.network_distance, 'DISTANCE_3');
});

test('5F2D-M15 fin d\'inscription : l\'appelant relit ses inscriptions, sans argument', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const kit = await loadSheet();
  const { value, calls } = props();
  const p = sheetOf(kit.InboxContactSheet(value)).props;
  p.onEnrolled(['ACoAAAcamille']);
  assert.deepEqual(calls.enrolled, [[]]);
  // La fermeture est faite par la feuille du flux, pas par ce composant.
  assert.deepEqual(calls.open, []);
  // « Retenir sans contacter » n'a rien à relire dans la messagerie.
  assert.equal(p.onChanged, undefined);
});

test('5F2D-M16 sans identifiant de profil : une phrase et « Fermer », jamais un flux ni un silence', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const kit = await loadSheet();
  const noId = chatOf({ attendee_provider_id: undefined, provider_id: undefined });
  for (const chat of [noId, null, { id: 'chat_2', account_id: 'acc_1', attendees: [] }, { id: 'chat_3', account_id: 'acc_1' }]) {
    const { value } = props({ chat });
    const tree = kit.InboxContactSheet(value);
    assert.equal(tree.type, 'Sheet');
    assert.equal(tree.props.open, true);
    assert.equal(sheetOf(tree), null, 'le flux n\'est pas monté');
    const description = find(tree, (n) => n.type === 'SheetDescription');
    assert.match(textOf(description), /ne permet pas d'identifier le profil LinkedIn du candidat/);
    assert.equal(textOf(find(tree, (n) => n.type === 'SheetTitle')), 'Inscrire dans une séquence');
    const close = find(tree, (n) => n.type === 'Button');
    assert.equal(textOf(close), 'Fermer');
    assert.equal(find(tree, (n) => n.type === 'SheetClose').props.asChild, true, 'le bouton ferme la feuille');
  }
});

test('5F2D-M17 sans compte : une phrase et « Fermer »', async (t) => {
  if (!esbuild) return t.skip('esbuild absent');
  const kit = await loadSheet();
  for (const accountId of [null, '']) {
    const tree = kit.InboxContactSheet(props({ accountId }).value);
    assert.equal(tree.type, 'Sheet');
    assert.equal(sheetOf(tree), null);
    assert.match(textOf(find(tree, (n) => n.type === 'SheetDescription')), /Aucun compte LinkedIn n'est relié/);
    assert.equal(textOf(find(tree, (n) => n.type === 'Button')), 'Fermer');
  }
});

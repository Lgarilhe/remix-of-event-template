/**
 * Refonte des séquences, lot 5h « Bascule » (demande du propriétaire du
 * 07/10/2026 : ne plus devoir écrire ?sequences-v2=1).
 *
 * - L'interrupteur konekt.sequences-v2 est allumé par défaut ; ?sequences-v2=0
 *   ou la clé à '0' rendent l'ancien parcours (secours jusqu'au lot 5j),
 *   ?sequences-v2=1 reste accepté.
 * - Allumé, donc pour tous : entrée « Séquences » de la barre latérale, palette
 *   Ctrl J, « G puis S », liens de la liste des séquences ; « Créer une
 *   séquence », « Modifier » et « Dupliquer » de SequencesList mènent aux pages.
 * - /outreach mène à /sequences (le secours le renvoie vers /missions par la
 *   garde des pages) ; ?tab=outreach mène toujours au panneau de la mission.
 * - Les notifications d'une séquence sans mission mènent à /sequences/<id> au
 *   lieu de /missions ; l'alerte « Relances non arrêtées » sans séquence ni
 *   mission ouvre la fiche du candidat (décision du 07/10/2026).
 *
 * Modules purs transpilés en mémoire (esbuild), le reste par lecture des
 * sources (patron des autres tests de tests/ux).
 *
 * Lancer : node --test tests/ux/lot5h-bascule.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

async function loadPure(rel) {
  const { code } = transformSync(read(rel), { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

/** Source sans commentaires (un commentaire ne doit ni satisfaire ni casser une garde). */
const code = (rel) => read(rel)
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1')
  .replace(/\{\/\*[\s\S]*?\*\/\}/g, '');

const beta = await loadPure('src/lib/sequencesBeta.ts');
const missionBeta = await loadPure('src/lib/missionBeta.ts');
const kinds = await loadPure('src/lib/notificationKinds.ts');

const store = (value) => {
  const written = [];
  return { written, getItem: () => value, setItem: (k, v) => { written.push([k, v]); } };
};

// ─── Interrupteur : allumé par défaut, secours par la clé ou le paramètre ───

test('5h : l’interrupteur est allumé par défaut, pour tout navigateur qui n’a jamais choisi', () => {
  assert.equal(beta.SEQUENCES_BETA_DEFAULT, true);
  assert.equal(beta.readSequencesBeta(store(null)), true, 'clé absente');
  assert.equal(beta.readSequencesBeta(store('')), true, 'clé vide');
  assert.equal(beta.readSequencesBeta(store('oui')), true, 'valeur inconnue');
  assert.equal(beta.readSequencesBeta(null), true, 'stockage indisponible (navigation privée)');
  const throwing = { getItem: () => { throw new Error('bloqué'); }, setItem: () => { throw new Error('bloqué'); } };
  assert.equal(beta.readSequencesBeta(throwing), true, 'stockage qui refuse : défaut, sans erreur');
  // Magasin du module (barre, palette, raccourcis, garde) : allumé sans rien écrire.
  beta.resetSequencesBetaForTests();
  assert.equal(beta.getSequencesBeta(), true);
  beta.resetSequencesBetaForTests();
});

test('5h : secours par la clé : konekt.sequences-v2 à « 0 » rend l’ancien parcours, « 1 » le nouveau', () => {
  assert.equal(beta.SEQUENCES_BETA_STORAGE_KEY, 'konekt.sequences-v2');
  assert.equal(beta.readSequencesBeta(store('0')), false);
  assert.equal(beta.readSequencesBeta(store('1')), true);
  // Le choix est écrit dans les deux sens : « 0 » survit au défaut allumé.
  const s = store(null);
  assert.equal(beta.writeSequencesBeta(false, s), true);
  assert.deepEqual(s.written, [['konekt.sequences-v2', '0']]);
  // Magasin : éteindre puis rallumer, abonnés prévenus.
  beta.resetSequencesBetaForTests();
  let calls = 0;
  const off = beta.subscribeSequencesBeta(() => { calls += 1; });
  beta.setSequencesBeta(false);
  assert.equal(beta.getSequencesBeta(), false);
  beta.setSequencesBeta(true);
  assert.equal(beta.getSequencesBeta(), true);
  assert.equal(calls, 2);
  off();
  beta.resetSequencesBetaForTests();
});

test('5h : secours par le paramètre : ?sequences-v2=0 éteint, ?sequences-v2=1 reste accepté', () => {
  assert.equal(beta.sequencesBetaParam('?sequences-v2=0'), false);
  assert.equal(beta.sequencesBetaParam('?mission=m1&sequences-v2=0'), false);
  assert.equal(beta.sequencesBetaParam('?sequences-v2=1'), true);
  assert.equal(beta.sequencesBetaParam('?sequences-v2=2'), null, 'autre valeur : le stockage décide');
  assert.equal(beta.sequencesBetaParam(''), null);
  assert.equal(beta.withoutSequencesBetaParam('?onglet=etapes&sequences-v2=0'), '?onglet=etapes');
  // Garde des pages : le paramètre l'emporte sur la valeur enregistrée, dès ce rendu.
  const gate = code('src/components/sequences/SequencesGate.tsx');
  assert.match(gate, /const stored = useSequencesBeta\(\);/);
  assert.match(gate, /const requested = sequencesBetaParam\(search\);/);
  assert.match(gate, /const on = requested \?\? stored;/);
  assert.match(gate, /setSequencesBeta\(requested\);/, 'le choix du paramètre est retenu');
  assert.match(gate, /if \(!on\) return <Navigate to=\{withPreviewAccessToken\(SEQUENCES_FALLBACK_PATH\)\} replace \/>;/);
  assert.equal(beta.SEQUENCES_FALLBACK_PATH, '/missions', 'secours : les pages renvoient vers la liste des missions');
  // Ailleurs dans l'application, la mise en page applique puis retire le paramètre.
  assert.match(code('src/components/AppLayout.tsx'), /useSequencesBetaParamSync\(\);/);
});

test('5h : aucun lecteur ne force l’interrupteur : tous suivent le défaut du module', () => {
  const hook = code('src/hooks/useSequencesBeta.ts');
  // Rendu serveur et premier rendu : la valeur par défaut du module, jamais un littéral.
  assert.match(hook, /useSyncExternalStore\(subscribeSequencesBeta, getSequencesBeta, \(\) => SEQUENCES_BETA_DEFAULT\)/);
  const readers = {
    'src/components/sidebar/SidebarBottomRow.tsx': /const showSequences = useSequencesBeta\(\);/,
    'src/components/layout/NavigationPalette.tsx': /const showSequences = useSequencesBeta\(\);/,
    'src/components/sidebar/KeyboardShortcutsDialog.tsx': /const showSequences = useSequencesBeta\(\);/,
    'src/components/layout/GoShortcuts.tsx': /!isSequencesPath\(path\) \|\| getSequencesBeta\(\)/,
    'src/components/outreach/SequencesList.tsx': /const sequencesBeta = useSequencesBeta\(\);/,
    'src/components/agent/AgentToolApprovalCard.tsx': /const sequencesBeta = useSequencesBeta\(\);/,
    'src/components/settings/AgentActionsSettings.tsx': /const sequencesBeta = useSequencesBeta\(\);/,
  };
  for (const [rel, reader] of Object.entries(readers)) {
    const src = code(rel);
    assert.match(src, reader, `${rel} : lecture de l'interrupteur`);
    assert.doesNotMatch(src, /(?:showSequences|sequencesBeta)\s*=\s*(?:true|false)\b/, `${rel} : valeur écrite en dur`);
    assert.doesNotMatch(src, /useSequencesBeta\(\)\s*(?:\|\||\?\?|&&)/, `${rel} : lecture contournée`);
  }
  // Le défaut ne vit qu'à un endroit.
  assert.match(code('src/lib/sequencesBeta.ts'), /export const SEQUENCES_BETA_DEFAULT = true;/);
});

// ─── Accès pour tous : barre, palette, raccourcis ───────────────────────────

test('5h : entrée « Séquences » de la barre latérale par défaut, entre Agenda et Marketplace', () => {
  const row = code('src/components/sidebar/SidebarBottomRow.tsx');
  assert.match(row, /\.\.\.\(showSequences \? \[\{ to: '\/sequences', label: 'Séquences', icon: Send \}\] : \[\]\)/);
  assert.ok(row.indexOf("'/calendar'") < row.indexOf("'/sequences'") && row.indexOf("'/sequences'") < row.indexOf("'/marketplace'"));
  // showSequences = useSequencesBeta() = défaut allumé : l'entrée est là sans paramètre ni clé.
  assert.equal(beta.readSequencesBeta(store(null)), true);
  // Palette Ctrl J et « G puis S » suivent le même interrupteur.
  assert.match(code('src/components/layout/NavigationPalette.tsx'), /\{showSequences && \(\s*<CommandItem onSelect=\{\(\) => go\('\/sequences'\)\}>/);
  assert.match(code('src/components/layout/GoShortcuts.tsx'), /s: '\/sequences',/);
  assert.match(code('src/components/sidebar/KeyboardShortcutsDialog.tsx'), /\.\.\.\(showSequences \? \[G_SEQUENCES\] : \[\]\),/);
});

test('5h : rangée basse à sept cibles (Séquences, Appels et Marketplace) : rien ne sort de la barre', () => {
  // Séquences par défaut, plus Appels dès un premier appel reçu : sept cibles
  // (six liens et l'Aide) pour une organisation qui voit Marketplace.
  const row = code('src/components/sidebar/SidebarBottomRow.tsx');
  assert.match(row, /const targetCount = links\.length \+ 1;/, 'liens et Aide comptés');
  assert.match(row, /const tight = !collapsed && targetCount >= 6;/, 'six cibles : selon le nombre, plus selon le drapeau');
  assert.match(row, /const dense = !collapsed && targetCount >= 7;/);
  assert.doesNotMatch(row, /const tight = showSequences/, 'le drapeau seul ne décide plus de la disposition');
  // Téléphone : deux lignes de quatre colonnes de 44 px ; ordinateur : cibles de 32 px de large,
  // Aide comprise (le bouton icône du kit fait 36 px sans md:w-8).
  assert.match(row, /dense \? 'max-md:grid max-md:grid-cols-\[repeat\(4,2\.75rem\)\] max-md:gap-y-1' : tight \? 'md:gap-0\.5' : 'gap-0\.5'/);
  assert.match(row, /const targetClass = collapsed \? 'h-8 w-8' : cn\('min-h-11 min-w-11 md:min-h-9 px-1', dense \? 'md:w-8 md:min-w-8' : 'md:min-w-9'\);/);
  // Chiffre des tâches en retard dans l'angle, sans élargir sa cible.
  assert.match(row, /isTasks && !collapsed && overdue !== null && !dense && \(tight/);
  assert.match(row, /dense\s*\? 'absolute right-0\.5 top-0\.5 leading-none'\s*: tight && 'max-md:absolute/);

  // Largeurs : tiroir de téléphone et barre d'ordinateur, moins px-2 du pied et la bordure.
  const kit = read('src/components/ui/sidebar.tsx');
  const rem = (name) => Number(kit.match(new RegExp(`const ${name} = "(\\d+(?:\\.\\d+)?)rem";`))[1]) * 16;
  const phone = rem('SIDEBAR_WIDTH_MOBILE') - 2 * 8 - 1;
  const desktop = rem('SIDEBAR_WIDTH') - 2 * 8 - 1;
  assert.equal(phone, 271);
  assert.equal(desktop, 239);
  assert.ok(6 * 44 <= phone && 7 * 44 > phone, 'six cibles de 44 px tiennent sur une ligne, sept non');
  assert.ok(4 * 44 <= phone, 'quatre colonnes de 44 px tiennent');
  assert.ok(7 * 32 <= desktop && 7 * 36 > desktop, 'sept cibles de 32 px tiennent, pas de 36 px');
});

// ─── Adresses ───────────────────────────────────────────────────────────────

test('5h : /outreach mène à /sequences ; le secours le renvoie vers /missions par la garde des pages', () => {
  const app = code('src/App.tsx');
  // ?sequences-v2= suit la redirection : /outreach n'est pas sous AppLayout, seule
  // la garde des pages peut appliquer le secours (/outreach?sequences-v2=0 → /missions).
  assert.match(app, /<Route path="\/outreach" element=\{<Navigate to=\{withPreviewAccessToken\('\/sequences', onlySequencesBetaParam\(location\.search\)\)\} replace \/>\} \/>/);
  assert.match(app, /import \{ onlySequencesBetaParam \} from "@\/lib\/sequencesBeta";/);
  assert.match(app, /const location = useLocation\(\);/);
  // Seul le choix valable passe ; les autres paramètres ne suivent pas (comme avant le lot 5h).
  assert.equal(beta.onlySequencesBetaParam('?sequences-v2=0'), '?sequences-v2=0');
  assert.equal(beta.onlySequencesBetaParam('?a=1&sequences-v2=1&b=2'), '?sequences-v2=1');
  assert.equal(beta.onlySequencesBetaParam('?sequences-v2=oui'), '');
  assert.equal(beta.onlySequencesBetaParam('?a=1'), '');
  assert.equal(beta.onlySequencesBetaParam(''), '');
  // La garde lit ce paramètre à l'arrivée : éteint dès ce rendu, puis renvoi vers /missions.
  assert.equal(beta.sequencesBetaParam(beta.onlySequencesBetaParam('?sequences-v2=0')), false);
  assert.doesNotMatch(app, /path="\/outreach" element=\{<Navigate to=\{withPreviewAccessToken\('\/missions'\)\}/, 'ancienne redirection retirée');
  // /sequences passe par SequencesGate (éteint : /missions), après la session et l'organisation.
  assert.match(app, /<Route path="\/sequences" element=\{<ProtectedRoute><OrganizationGuard><SequencesGate><AppLayout><SequencesPage \/><\/AppLayout><\/SequencesGate><\/OrganizationGuard><\/ProtectedRoute>\} \/>/);
});

test('5h : ?tab=outreach mène toujours au panneau Prise de contact de la mission', () => {
  const ID = '11111111-2222-3333-4444-555555555555';
  assert.equal(missionBeta.legacyToV3Target(`/missions/${ID}`, '?tab=outreach'), `/missions/${ID}?panneau=contact`);
  assert.deepEqual(missionBeta.legacyTabToV3('outreach'), { screen: 'pipeline', params: { panneau: 'contact' } });
  // La conversion de la mission ne dépend pas de l'interrupteur des séquences.
  assert.doesNotMatch(read('src/lib/missionBeta.ts'), /sequencesBeta|sequences-v2/);
});

// ─── Notifications d'une séquence sans mission ─────────────────────────────

/** Objet de notification écrit autour d'un repère : du `user_id` qui l'ouvre jusqu'au repère. */
const notificationAround = (rel, needle) => {
  const src = read(rel);
  const at = src.indexOf(needle);
  assert.ok(at >= 0, `${rel} : repère introuvable : ${needle}`);
  const open = src.lastIndexOf('user_id', at);
  assert.ok(open >= 0 && at - open < 1500, `${rel} : objet de notification introuvable avant ${needle}`);
  return src.slice(open, at + needle.length);
};

test('5h : les notifications d’une séquence sans mission mènent à /sequences, plus à /missions', () => {
  const cases = [
    ['supabase/functions/process-sequences/index.ts', "metadata: { source: 'sequence_auto_pause'",
      /link: seqRow\.project_id \? `\/missions\/\$\{seqRow\.project_id\}\?tab=outreach` : `\/sequences\/\$\{seqId\}`,/],
    ['supabase/functions/unipile-webhook/index.ts', 'source: SIBLING_STOP_FAILED_SOURCE,',
      /link: projectId\s*\?\s*`\/missions\/\$\{projectId\}\?tab=outreach`\s*:\s*alert\.sequenceId\s*\?\s*`\/sequences\/\$\{alert\.sequenceId\}`\s*:/],
    ['supabase/functions/unipile-webhook/index.ts', "channel: 'email',",
      /link: projectId \? `\/missions\/\$\{projectId\}\?tab=outreach` : `\/sequences\/\$\{primary\.sequence_id\}`,/],
    ['supabase/functions/unipile-webhook/index.ts', "source: 'email_bounce',",
      /link: projectId \? `\/missions\/\$\{projectId\}\?tab=outreach` : `\/sequences\/\$\{e\.sequence_id\}`,/],
  ];
  for (const [rel, needle, link] of cases) {
    const notif = notificationAround(rel, needle);
    assert.match(notif, link, `${rel} (${needle}) : lien sans mission`);
    assert.doesNotMatch(notif, /:\s*'\/missions'/, `${rel} (${needle}) : repli sur /missions`);
  }
  // Plus aucun repli « séquence sans mission » vers /missions dans ces deux écrivains
  // (le rendez-vous sans séance garde son lien : ce n'est pas une séquence sans mission).
  const webhook = code('supabase/functions/unipile-webhook/index.ts');
  assert.doesNotMatch(webhook, /\?tab=outreach` : '\/missions'/);
  const engine = code('supabase/functions/process-sequences/index.ts');
  assert.doesNotMatch(engine, /\?tab=outreach` : '\/missions'/);
});

// Décision du 07/10/2026 : l'écran Séquences ne montre pas le candidat.
test('relances non arrêtées sans séquence ni mission : la fiche du candidat, plus /sequences', () => {
  const rel = 'supabase/functions/unipile-webhook/index.ts';
  const notif = notificationAround(rel, 'source: SIBLING_STOP_FAILED_SOURCE,');
  assert.match(notif, /: alert\.candidateId \? `\/pipeline\?candidate=\$\{encodeURIComponent\(alert\.candidateId\)\}` : '\/pipeline',/);
  assert.doesNotMatch(notif, /'\/sequences'/, 'repli sur l’écran Séquences');
  const webhook = code(rel);
  assert.doesNotMatch(webhook, /:\s*'\/sequences'/);
  // Identifiant : celui d'un InMail de l'organisation (son entrée au /pipeline), sinon l'expéditeur.
  assert.match(webhook, /candidateId: \(inmailMatches \?\? \[\]\)\.find\(\(m\) => m\.organization_id === orgId\)\?\.recipient_profile_id \?\? senderId \?\? null,/);
  // Le /pipeline ouvre la fiche par cet identifiant, celui de l'entrée d'un InMail sans ligne de mission.
  assert.match(code('src/pages/ATS.tsx'), /candidates\.find\(c => c\.candidateId === deepLinkCandidateId\)/);
  assert.match(code('src/hooks/useATSData.ts'), /candidateId: inmail\.recipient_profile_id,/);
});

test('5h : l’inventaire des notifications inscrit /sequences, et le classement ne change pas', () => {
  const header = read('src/lib/notificationKinds.ts').split('*/')[0];
  const row = (writer) => {
    const line = header.split('\n').find((l) => l.startsWith(` * | ${writer}`));
    assert.ok(line, `ligne d'inventaire ${writer}`);
    return line.split('|').slice(1, -1).map((c) => c.trim());
  };
  assert.equal(row('unipile-webhook (réponse par e-mail, sans chat_id)')[3], '/missions/…?tab=outreach ou /sequences/…');
  assert.equal(row("unipile-webhook (rebond d'e-mail)")[3], '/missions/…?tab=outreach ou /sequences/…');
  assert.equal(row('unipile-webhook (relances non arrêtées après une réponse)')[3], '/missions/…?tab=outreach, /sequences/… ou /pipeline?candidate=…');
  assert.equal(row("process-sequences (auto-pause, trop d'échecs)")[3], '/missions/…?tab=outreach ou /sequences/…');
  assert.match(header, /Séquence sans mission \(lot 5h\)/);
  // Les nouvelles adresses restent classées comme avant (le classement ne lit le lien que pour la marketplace).
  assert.equal(kinds.notificationKind({ type: 'error', link: '/sequences/s1', metadata: { source: 'sequence_auto_pause', sequence_id: 's1' } }), 'action');
  assert.equal(kinds.notificationKind({ type: 'action', link: '/sequences/s1', metadata: { source: 'email_bounce', sequence_id: 's1' } }), 'action');
  assert.equal(kinds.notificationKind({ type: 'action', link: '/pipeline?candidate=ACo1', metadata: { source: 'reply_sibling_stop_failed' } }), 'action');
  assert.equal(kinds.notificationKind({ type: 'new_message', link: '/sequences/s1', metadata: { channel: 'email', is_candidate: true } }), 'message');
});

// ─── SequencesList : Créer, Modifier, Dupliquer vers les pages ─────────────

test('5h : SequencesList : « Créer une séquence » mène à /sequences/nouvelle?mission=<id>', () => {
  const list = code('src/components/outreach/SequencesList.tsx');
  assert.match(list, /const handleCreateNew = \(\) => \{\s*if \(sequencesBeta\) setNewDialogOpen\(true\);\s*else setShowTemplateSelector\(true\);\s*\};/);
  assert.match(list, /<Button type="button" variant="primary" size="sm" onClick=\{handleCreateNew\}[\s\S]{0,120}Créer une séquence/);
  assert.match(list, /\{sequencesBeta && \(\s*<NewSequenceDialog[\s\S]{0,300}?missionId=\{projectId \?\? null\}/);
  const dialog = code('src/components/sequences/NewSequenceDialog.tsx');
  assert.match(dialog, /navigate\(newSequencePath\(start, missionId\)\);/);
  assert.equal(beta.newSequencePath({ kind: 'zero' }, 'm1'), '/sequences/nouvelle?mission=m1&depart=zero');
  assert.equal(beta.newSequencePath({ kind: 'modele', key: 'recommandee' }, 'm1'), '/sequences/nouvelle?mission=m1&depart=modele:recommandee');
  assert.equal(beta.newSequencePath({ kind: 'copie', id: 's9' }, 'm1'), '/sequences/nouvelle?mission=m1&depart=copie:s9');
});

test('5h : SequencesList : « Modifier » ouvre l’onglet Étapes de la page, avec la mission d’origine', () => {
  const list = code('src/components/outreach/SequencesList.tsx');
  assert.match(list, /const handleEdit = \(seq: SequenceWithStats\) => \{\s*if \(!sequencesBeta\) \{\s*void openLegacyEditor\(seq\);\s*return;\s*\}\s*const path = sequencePath\(seq\.id, projectId\);\s*navigate\(`\$\{path\}\$\{path\.includes\('\?'\) \? '&' : '\?'\}onglet=etapes`\);/);
  assert.match(list, /onClick=\{\(e\) => \{ e\.stopPropagation\(\); handleEdit\(seq\); \}\}[\s\S]{0,200}Modifier/);
  assert.equal(beta.sequencePath('s1', 'm1'), '/sequences/s1?depuis=mission:m1');
  assert.equal(beta.sequencePath('s1'), '/sequences/s1');
});

test('5h : SequencesList : « Dupliquer » crée la copie puis ouvre sa page ; « Enregistrer comme modèle » inchangé', () => {
  const list = code('src/components/outreach/SequencesList.tsx');
  assert.match(list, /onDuplicated: sequencesBeta \? \(copy\) => navigate\(sequencePath\(copy\.id, projectId\)\) : undefined,/);
  // La copie s'ouvre seulement une fois ses étapes recopiées.
  const actions = code('src/lib/sequenceActions.ts');
  const dup = actions.slice(actions.indexOf('const handleDuplicate = async'), actions.indexOf('const handleEdit = async'));
  assert.ok(dup.indexOf("supabase.rpc('save_sequence_steps'") < dup.indexOf('onDuplicated?.({ id: newSeq.id, name: newSeq.name });'));
  assert.ok(dup.indexOf('createdCopyId = null;') < dup.indexOf('onDuplicated?.('));
  // Secours : pas d'ouverture, la liste se recharge comme avant.
  assert.match(dup, /await fetchSequences\(\);/);
  assert.match(list, /setSaveTemplateSeq\(seq\);[\s\S]{0,200}Enregistrer comme modèle/);
  assert.match(list, /<SaveAsTemplateModal/);
});

test('5h : secours : l’ancien parcours de SequencesList reste entier', () => {
  const list = code('src/components/outreach/SequencesList.tsx');
  assert.match(list, /<SequenceTemplateSelector/, 'ancien choix de départ');
  assert.match(list, /<SequenceBuilder/, 'ancien éditeur, seul éditeur interrupteur éteint');
  assert.match(list, /\) : \(\s*<p className="min-w-0 break-words text-sm font-medium text-foreground">\{seq\.name\}<\/p>\s*\)\}/, 'nom sans lien');
  assert.match(list, /\{sequencesBeta && \(\s*<Link\s+to=\{SEQUENCES_PATH\}/, 'lien vers l’écran de l’organisation masqué');
  // L'ancienne page mission n'est pas modifiée par la bascule.
  assert.doesNotMatch(read('src/components/missions/MissionOutreach.tsx'), /sequencesBeta|useSequencesBeta|\/sequences\b/);
});

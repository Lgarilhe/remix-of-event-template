/**
 * Refonte mission, lot 5f-2b : onglet « Contactés » du panneau Prise de contact
 * et pastille du bouton « Prise de contact ».
 *
 * Comportement du module pur (src/lib/contactedGroups.ts, lu sous Node) et
 * gardes statiques de la lecture, de la liste, du panneau et de la barre d'outils.
 *
 * Lancer : node --test tests/ux/lot5f2b-contactes.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

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

const NOW = new Date(2026, 9, 12, 10, 0);
const at = (d, h = 9) => new Date(2026, 9, d, h).toISOString();

/** Inscription minimale ; chaque test surcharge ce qu'il prouve. */
const enrollment = (id, extra = {}) => ({
  id,
  sequenceId: 'seq-1',
  sequenceName: 'Approche',
  sequenceActive: true,
  profileId: `p-${id}`,
  providerId: null,
  resolvedProfileId: null,
  profileName: `Candidat ${id}`,
  profileHeadline: null,
  profileUrl: null,
  createdBy: 'u1',
  accountId: 'acc-1',
  createdAt: at(1),
  status: 'active',
  pause_reason: null,
  tracking_data: {},
  replied_at: null,
  completed_at: null,
  updated_at: at(1),
  executions: [],
  ...extra,
});

const row = (id, extra = {}) => ({
  id,
  candidateId: `p-${id}`,
  name: `Ligne ${id}`,
  headline: null,
  linkedinUrl: null,
  pictureUrl: null,
  stage: 'contacted',
  contactedAt: at(2),
  repliedAt: null,
  ...extra,
});

const groupOf = (view, key) => view.entries.find((e) => e.key === key)?.group;

test('5F2B-1 chaque statut d’inscription va dans son groupe', async (t) => {
  const m = await loadTs(t, 'src/lib/contactedGroups.ts');
  if (!m) return;
  const review = { status: 'scheduled', scheduled_at: at(13), error_message: "Message rédigé par l'IA à relire avant l'envoi.", final_message: null, step: { action_type: 'message' } };
  const cases = [
    // A répondu
    ['replied', { status: 'replied', replied_at: at(5) }],
    ['stopped-sibling-reply', { status: 'stopped', executions: [{ status: 'skipped', scheduled_at: at(4), skip_reason: 'Le candidat a répondu dans une autre séquence' }] }],
    // Bloqués
    ['account', { status: 'paused', pause_reason: 'account_disconnected' }],
    ['subscription', { status: 'paused', pause_reason: 'subscription_required' }],
    ['quota', { status: 'paused', pause_reason: 'quota_reached' }],
    ['unreachable', { status: 'paused', pause_reason: 'blocked_by_candidate' }],
    ['send-failed', { status: 'paused', pause_reason: 'send_failed', executions: [{ status: 'failed', scheduled_at: at(4), error_message: 'Erreur' }] }],
    ['auto-paused', { status: 'paused', pause_reason: 'auto_paused' }],
    ['ai-review', { status: 'active', executions: [review] }],
    // En attente
    ['active', { status: 'active', executions: [{ status: 'scheduled', scheduled_at: at(13), step: { action_type: 'message' } }] }],
    ['manual-pause', { status: 'paused', pause_reason: 'manual' }],
    ['sequence-paused', { status: 'paused', pause_reason: 'sequence_inactive' }],
    ['quota-blocked-step', { status: 'active', executions: [{ status: 'quota_blocked', scheduled_at: at(13), step: { action_type: 'connection_request' } }] }],
    // Sans suite
    ['completed', { status: 'completed', completed_at: at(6) }],
    ['stopped', { status: 'stopped' }],
    ['cancelled', { status: 'cancelled' }],
    ['bounced', { status: 'bounced' }],
    ['manual-stop', { status: 'completed', tracking_data: { completion_reason: 'manual_stop', manual_stop: { token: 'x', by: 'u1', at: at(6) } } }],
    ['erased', { status: 'paused', pause_reason: 'account_disconnected', tracking_data: { gdpr_erased_at: at(7) } }],
  ];
  const expected = {
    replied: 'replied', 'stopped-sibling-reply': 'replied',
    account: 'blocked', subscription: 'blocked', quota: 'blocked', unreachable: 'blocked', 'send-failed': 'blocked', 'auto-paused': 'blocked', 'ai-review': 'blocked',
    active: 'waiting', 'manual-pause': 'waiting', 'sequence-paused': 'waiting', 'quota-blocked-step': 'waiting',
    completed: 'closed', stopped: 'closed', cancelled: 'closed', bounced: 'closed', 'manual-stop': 'closed', erased: 'closed',
  };
  const view = m.buildContacted(cases.map(([id, extra]) => enrollment(id, extra)), [], { now: NOW });
  for (const [id] of cases) assert.equal(groupOf(view, id), expected[id], `${id}`);
  assert.equal(view.total, cases.length);
  assert.deepEqual(view.counts, { replied: 2, blocked: 7, waiting: 4, closed: 6 });
  // Les groupes sortent dans l'ordre de l'écran.
  assert.deepEqual(view.groups.map((g) => g.key), ['replied', 'blocked', 'waiting', 'closed']);
  assert.deepEqual(view.groups.map((g) => g.label), ['A répondu', 'Bloqués', 'En attente', 'Sans suite']);
});

test('5F2B-2 une ligne par candidat : identités réunies, la réponse puis la dernière inscription', async (t) => {
  const m = await loadTs(t, 'src/lib/contactedGroups.ts');
  if (!m) return;
  // Même personne sous trois identifiants, dans trois séquences.
  const view = m.buildContacted([
    enrollment('old', { profileId: 'A', createdAt: at(1), status: 'completed', completed_at: at(3), sequenceId: 's-old', sequenceName: 'Ancienne' }),
    enrollment('new', { profileId: 'B', providerId: 'A', createdAt: at(8), status: 'active', sequenceId: 's-new', sequenceName: 'Récente' }),
    enrollment('slug', { profileId: 'C', profileUrl: 'https://www.linkedin.com/in/Marc-Moreau/', createdAt: at(2), status: 'completed', completed_at: at(4) }),
    enrollment('slug2', { profileId: 'D', profileUrl: 'https://fr.linkedin.com/in/marc-moreau?trk=x', createdAt: at(9), status: 'paused', pause_reason: 'manual' }),
    enrollment('other', { profileId: 'Z' }),
  ], [], { now: NOW });
  assert.equal(view.total, 3, 'A/B réunis par le fournisseur, C/D par l’adresse, Z seul');
  assert.deepEqual(view.entries.map((e) => e.key).sort(), ['new', 'other', 'slug2']);
  assert.equal(view.entries.find((e) => e.key === 'new').enrollment.sequenceName, 'Récente', 'dernière inscription');

  // Une réponse prime sur une inscription plus récente restée active.
  const replied = m.buildContacted([
    enrollment('r', { profileId: 'X', createdAt: at(1), status: 'replied', replied_at: at(2) }),
    enrollment('later', { profileId: 'X', createdAt: at(9), status: 'active' }),
  ], [], { now: NOW });
  assert.equal(replied.total, 1);
  assert.equal(replied.entries[0].key, 'r');
  assert.equal(replied.entries[0].group, 'replied');
});

test('5F2B-3 lignes du Pipeline : contactés hors séquence, fiche et nom des inscrits, réponse vue par le Pipeline', async (t) => {
  const m = await loadTs(t, 'src/lib/contactedGroups.ts');
  if (!m) return;
  const view = m.buildContacted(
    [
      enrollment('e1', { profileId: 'p-1', profileName: null, status: 'active' }),
      enrollment('e2', { profileId: 'p-2', status: 'active' }),
    ],
    [
      row('1', { candidateId: 'p-1', name: 'Alice Martin', headline: 'CTO', pictureUrl: 'https://media.licdn.com/a.jpg', stage: 'retained' }),
      row('2', { candidateId: 'p-2', stage: 'replied', repliedAt: at(5) }),
      row('3', { stage: 'contacted', contactedAt: at(2) }),
      row('4', { stage: 'replied', repliedAt: at(4) }),
      row('5', { stage: 'retained' }),
      row('6', { stage: 'interviewing' }),
      row('7', { stage: 'to_sort' }),
    ],
    { now: NOW },
  );
  const e1 = view.entries.find((e) => e.key === 'e1');
  assert.equal(e1.name, 'Alice Martin', 'le nom de la ligne du Pipeline sert quand l’inscription n’en a pas');
  assert.equal(e1.rowId, '1', 'la fiche s’ouvre depuis la ligne');
  assert.equal(e1.pictureUrl, 'https://media.licdn.com/a.jpg');
  assert.equal(e1.group, 'waiting', 'retenu mais inscrit : en attente du premier envoi');
  // Le Pipeline range le candidat en Répondu : la réponse prime sur l’inscription restée active.
  assert.equal(groupOf(view, 'e2'), 'replied');
  // Contactés ou répondus sans inscription : listés, jamais doublés. Retenus, en entretien et à trier : absents.
  const manual = view.entries.filter((e) => e.enrollment === null);
  assert.deepEqual(manual.map((e) => e.key).sort(), ['row:3', 'row:4']);
  assert.equal(manual.find((e) => e.key === 'row:3').group, 'waiting');
  assert.equal(manual.find((e) => e.key === 'row:4').group, 'replied');
  assert.match(manual.find((e) => e.key === 'row:3').manualLabel, /^Contacté hors séquence le 02\/10$/);
  assert.match(manual.find((e) => e.key === 'row:4').manualLabel, /^A répondu le 04\/10, hors séquence$/);
  assert.equal(manual.every((e) => e.line === null), true);
  assert.equal(view.total, 4);
});

test('5F2B-4 effacement RGPD : fermé, sans nom, sans photo, sans lien', async (t) => {
  const m = await loadTs(t, 'src/lib/contactedGroups.ts');
  if (!m) return;
  const view = m.buildContacted(
    [enrollment('gone', { profileId: 'p-9', profileName: 'Nom effacé', profileUrl: 'https://www.linkedin.com/in/gone', status: 'replied', replied_at: at(3), tracking_data: { gdpr_erased_at: at(7) } })],
    [row('9', { candidateId: 'p-9', name: 'Nom effacé', pictureUrl: 'https://media.licdn.com/x.jpg', stage: 'replied' })],
    { now: NOW },
  );
  const [entry] = view.entries;
  assert.equal(entry.group, 'closed', 'même répondu, un profil effacé ne demande plus rien');
  assert.equal(entry.name, 'Profil effacé');
  assert.equal(entry.headline, null);
  assert.equal(entry.pictureUrl, null);
  assert.equal(entry.candidateId, null);
  assert.equal(entry.profileUrl, null);
});

test('5F2B-5 tri dans un groupe : le fait le plus récent d’abord, départage stable', async (t) => {
  const m = await loadTs(t, 'src/lib/contactedGroups.ts');
  if (!m) return;
  const view = m.buildContacted([
    enrollment('a', { status: 'replied', replied_at: at(3), updated_at: at(3) }),
    enrollment('b', { status: 'replied', replied_at: at(9), updated_at: at(9) }),
    enrollment('c', { status: 'replied', replied_at: at(5), updated_at: at(5) }),
    enrollment('w1', { createdAt: at(2) }),
    enrollment('w2', { createdAt: at(8) }),
  ], [], { now: NOW });
  assert.deepEqual(view.groups.find((g) => g.key === 'replied').entries.map((e) => e.key), ['b', 'c', 'a']);
  assert.deepEqual(view.groups.find((g) => g.key === 'waiting').entries.map((e) => e.key), ['w2', 'w1']);
});

test('5F2B-6 gestes proposés : ceux du statut, selon la personne', async (t) => {
  const m = await loadTs(t, 'src/lib/contactedGroups.ts');
  if (!m) return;
  const action = (extra, ctx) => m.buildContacted([enrollment('x', extra)], [], { now: NOW, ...ctx }).entries[0].line.action;
  assert.equal(action({ status: 'active' }).kind, 'pause');
  assert.equal(action({ status: 'paused', pause_reason: 'blocked_by_candidate' }).kind, 'stop');
  assert.equal(action({ status: 'replied', replied_at: at(3) }).kind, 'conversation');
  // Reconnecter : seulement pour le titulaire du compte qui envoie.
  assert.equal(action({ status: 'paused', pause_reason: 'account_disconnected' }, { myAccountId: 'acc-1' }).kind, 'reconnect');
  assert.equal(action({ status: 'paused', pause_reason: 'account_disconnected' }, { myAccountId: 'acc-2' }), null);
  assert.equal(action({ status: 'paused', pause_reason: 'account_disconnected' }, {}), null);
  // Réactiver la séquence : propriétaire ou administrateur, séquence éteinte.
  const off = { status: 'paused', pause_reason: 'sequence_inactive', sequenceActive: false };
  assert.equal(action(off, { canManageSequence: true }).kind, 'reactivate');
  assert.equal(action(off, { canManageSequence: false }), null);
  // Arrêt manuel : l’auteur est nommé par le contexte.
  const stopped = m.buildContacted(
    [enrollment('s', { status: 'completed', tracking_data: { completion_reason: 'manual_stop', manual_stop: { token: 't', by: 'u7', at: at(6) } } })],
    [], { now: NOW, memberName: (id) => (id === 'u7' ? 'Claire Dubois' : null) },
  );
  assert.match(stopped.entries[0].line.label, /Claire Dubois/);
});

test('5F2B-7 pastille : les réponses d’abord, sinon les bloqués, jamais de zéro', async (t) => {
  const m = await loadTs(t, 'src/lib/contactedGroups.ts');
  if (!m) return;
  const { contactBadge } = m;
  assert.equal(contactBadge(0, 0), null);
  assert.equal(contactBadge(null, null), null, 'lecture non aboutie : rien');
  assert.equal(contactBadge(undefined, 0), null);
  assert.equal(contactBadge(Number.NaN, -3), null);
  assert.deepEqual(contactBadge(1, 0), { text: '1 réponse', tone: 'brand', description: '1 réponse' });
  assert.deepEqual(contactBadge(2, 0), { text: '2 réponses', tone: 'brand', description: '2 réponses' });
  assert.deepEqual(contactBadge(0, 1), { text: '1 bloqué', tone: 'warning', description: '1 bloqué' });
  assert.deepEqual(contactBadge(null, 3), { text: '3 bloqués', tone: 'warning', description: '3 bloqués' });
  // Les deux : le texte visible dit les réponses, la lecture complète dit tout.
  assert.deepEqual(contactBadge(2, 1), { text: '2 réponses', tone: 'brand', description: '2 réponses, 1 bloqué' });
});

// ─── Gardes statiques ───────────────────────────────────────────────────────

const HOOK = read('src/hooks/useMissionContacted.ts');
const LIST = read('src/components/missions/v3/panels/ContactedList.tsx');
const PANEL = read('src/components/missions/v3/panels/ContactPanel.tsx');
const TOOLBAR = read('src/components/missions/v3/pipeline/PipelineToolbar.tsx');
const SCREEN = read('src/components/missions/v3/pipeline/PipelineScreen.tsx');
const BADGE = read('src/components/missions/v3/pipeline/useContactBadge.ts');
const GROUPS = read('src/lib/contactedGroups.ts');

/** Sans commentaires : les gardes d'écriture lisent le code. */
const code = (src) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`\\])\/\/.*$/gm, '$1');

test('5F2B-8 lecture : trois formes de l’id de mission, sous la RLS, jamais d’écriture, jamais les profils non ouverts', () => {
  const src = code(HOOK);
  assert.match(src, /missionEnrollmentJobIds\(projectId, projectJobId\)/);
  assert.match(src, /\.in\('job_id', jobIds\)/);
  assert.match(src, /queryKey: \['project-candidates', id, 'contacted'\]/, 'relu par invalidateStageReaders avec la mission');
  // Toute lecture de la vue exclut les profils jamais ouverts et se limite à la mission.
  const rowReads = src.match(/rowsDb\s*\.from\('mission_candidate_rows'\)[\s\S]*?;/g) ?? [];
  assert.ok(rowReads.length >= 1, 'lecture de mission_candidate_rows');
  for (const read of rowReads) {
    assert.match(read, /\.eq\('project_id', projectId\)/);
    assert.match(read, /\.eq\('is_unopened', false\)/);
  }
  // Exécutions : seulement celles dont le statut a besoin.
  assert.match(src, /EXECUTION_STATUSES = \['active', 'paused', 'stopped'\]/);
  for (const file of [src, code(LIST), code(GROUPS), code(BADGE)]) {
    assert.doesNotMatch(file, /\.(insert|upsert|update)\(/, 'aucune écriture dans la lecture ni dans la liste');
    assert.doesNotMatch(file, /\.delete\(\)\s*\.(eq|in|match|neq)\(|\.from\([^)]*\)\s*\.delete\(/, 'aucune suppression de ligne');
    assert.doesNotMatch(file, /\brpc\(\s*['"](set_candidate_stages?|undo_candidate_stages)['"]/);
    assert.doesNotMatch(file, /job_candidate_status|pipeline_stage|localStorage|trackEvent/);
  }
});

test('5F2B-9 liste : gestes du lot 5b seulement, collaborateur sur ses lignes, lien gardé par l’interrupteur', () => {
  const src = code(LIST);
  assert.match(src, /createEnrollmentActions\(\{/, 'pause : la même écriture gardée que le suivi, avec « Annuler »');
  // La ligne se relit dès l'écriture réussie (createEnrollmentActions appelle fetchStatusCounts juste après), pas seulement sur « Annuler ».
  assert.match(src, /fetchStatusCounts: async \(\) => \{ await onRefresh\(\); \}/);
  assert.match(src, /stopEnrollments\(\{\s*enrollmentIds: \[enrollment\.id\]/, 'arrêt : action serveur avec « Annuler »');
  assert.match(src, /const isOwn = \(entry: ContactedEntry\) => !isCollaborator \|\| \(!!userId && entry\.enrollment\?\.createdBy === userId\);/);
  assert.match(src, /case 'pause':\s*return isOwn\(entry\)/);
  assert.match(src, /case 'stop':\s*return isOwn\(entry\)/);
  assert.match(src, /return sequencesBeta \? \(\s*<Button asChild/);
  // Les autres gestes (relire, reprendre, réessayer, réactiver) restent sur la page de la séquence.
  assert.doesNotMatch(src, /resume_enrollments|re_enroll|mark_replied|skip_execution/);
  // Sans suite : replié au départ ; un groupe vide n’est pas écrit.
  assert.match(src, /COLLAPSED_AT_START: ReadonlySet<ContactedGroupKey> = new Set\(\['closed'\]\)/);
  assert.match(src, /group\.entries\.length > 0/);
  assert.match(src, /aria-expanded=\{open\}/);
  // États de la lecture : chargement, erreur avec réessai, vide.
  assert.match(src, /Les candidats contactés n’ont pas pu être chargés\./);
  assert.match(src, /Aucun candidat contacté pour l’instant\./);
  assert.match(src, />\s*Réessayer\s*</);
});

test('5F2B-10 panneau : Contactés ouvert s’il a une ligne, l’onglet suit l’adresse, interrupteur éteint inchangé', () => {
  const src = code(PANEL);
  assert.match(src, /outreachParam === 'contactes' \|\| outreachParam === 'sequences' \? outreachParam : null/);
  assert.match(src, /chosen \?\? \(contacted\.isPending \? null : \(contacted\.view\?\.total \?\? 0\) > 0 \? 'contactes' : 'sequences'\)/);
  assert.match(src, /useMissionContactedView\(project\.id, project\.job_id, \{ enabled: sequencesV2 && !isArchived \}\)/);
  // « Séquences » s’écrit dans l’adresse interrupteur allumé ; éteint, elle la retire comme avant.
  assert.match(src, /if \(!sequencesV2 && next === 'sequences'\) params\.delete\(OUTREACH_PARAM\);\s*else params\.set\(OUTREACH_PARAM, next\);/);
  // Les contactés se lisent sans compte LinkedIn relié ; les séquences demandent un compte.
  const v2 = src.slice(src.indexOf('} else if (sequencesV2) {'), src.indexOf('} else if (accountsLoading) {'));
  assert.match(v2, /<ContactedList[\s\S]*?status=\{contacted\.view \? 'ready' : contacted\.isError \? 'error' : 'loading'\}/);
  assert.match(v2, /accountsLoading \? loadingAccounts : accounts\.length === 0 \? noAccount :/);
  assert.match(v2, /hidden=\{tab !== 'contactes'\}/);
  assert.match(v2, /hidden=\{tab !== 'sequences'\}/);
  // Pendant la lecture, aucun onglet n’est choisi à la place de la personne.
  assert.match(v2, /\{tab === null && \(/);
  assert.match(src, /tabIndex=\{selected \|\| \(tab === null && index === 0\) \? 0 : -1\}/);
  // Les gardes de l’ancien rendu restent vraies.
  assert.match(PANEL, /\{ key: 'invitations', label: 'Invitations' \}/);
  assert.match(PANEL, /<SequencesList[\s\S]*?layout="compact"/);
  assert.match(PANEL, /besidePage=\{!fullscreen\}/);
  assert.match(PANEL, /<InvitationsPanel/);
});

test('5F2B-11 pastille : le nom du bouton ne change pas, le texte complet est sa description, éteint = rien', () => {
  assert.match(TOOLBAR, /aria-label="Prise de contact"/);
  assert.match(TOOLBAR, /aria-describedby=\{contactBadge \? CONTACT_BADGE_ID : undefined\}/);
  assert.match(TOOLBAR, /<span id=\{CONTACT_BADGE_ID\} className="sr-only">\{contactBadge\.description\}<\/span>/);
  assert.match(TOOLBAR, /data-testid="contact-badge"/);
  // Sur téléphone, un point à la place du texte ; la pastille ne prend jamais de couleur de danger.
  assert.match(TOOLBAR, /h-2 w-2 rounded-full sm:hidden/);
  assert.doesNotMatch(code(TOOLBAR), /text-danger|bg-danger|destructive/);
  assert.match(SCREEN, /const contactBadge = useContactBadge\(project, ctx\.isArchived\);/);
  assert.match(SCREEN, /contactBadge=\{contactBadge\}/);
  const badge = code(BADGE);
  assert.match(badge, /const enabled = useSequencesBeta\(\) && !archived;/);
  assert.match(badge, /attention\.data\?\.\[project\.id\]\?\.repliesMine \?\? null/);
  assert.match(badge, /counts \? counts\.blocked : null/);
  assert.match(badge, /enabled \? contactBadge\(replies, blocked\) : null/);
});

test('5F2B-12 textes de la partie ajoutée : français, sans tiret long, sans « (s) », sans nom de prestataire', () => {
  for (const [name, source] of [
    ['contactedGroups.ts', GROUPS], ['useMissionContacted.ts', HOOK], ['ContactedList.tsx', LIST],
    ['ContactPanel.tsx', PANEL], ['PipelineToolbar.tsx', TOOLBAR], ['useContactBadge.ts', BADGE],
  ]) {
    assert.ok(!source.includes('—'), `${name} : pas de tiret long`);
    assert.doesNotMatch(source, /[A-Za-zÀ-ÿ]\(s\)/, `${name} : accorder par le nombre`);
    assert.doesNotMatch(code(source), /\b(Unipile|Apollo|PDL|People Data Labs|Anthropic|Claude)\b/, `${name} : nom de prestataire`);
  }
});

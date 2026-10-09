/**
 * Suite d'un entretien : message de suivi au candidat et présentation au manager.
 *
 * - modules purs (src/lib/interviewFollowUp.ts avec ses alias @/, et le module
 *   partagé du serveur supabase/functions/_shared/interview-followup.ts, sans
 *   dépendance Deno), empaquetés par esbuild et chargés par une URL data: ;
 * - composant, panneau et onglet : inspection de source.
 *
 * Sans navigateur ni base. Un envoi réel et la qualité d'un brouillon ne se
 * vérifient pas ici.
 * Lancer : node --test tests/ux/interview-followup.test.mjs (ou npm run test:ux)
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildSync } from 'esbuild';

const ROOT = new URL('../../', import.meta.url);
const ROOT_PATH = fileURLToPath(ROOT);
const read = (rel) => readFileSync(new URL(rel, ROOT), 'utf8');

const load = async (rel) => {
  const { outputFiles } = buildSync({
    entryPoints: [join(ROOT_PATH, rel)],
    bundle: true,
    write: false,
    format: 'esm',
    platform: 'node',
    logLevel: 'silent',
    tsconfig: join(ROOT_PATH, 'tsconfig.app.json'),
  });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString('base64')}`);
};

const front = await load('src/lib/interviewFollowUp.ts');
const server = await load('supabase/functions/_shared/interview-followup.ts');

const component = read('src/components/ats/InterviewFollowUp.tsx');
const panel = read('src/components/ats/LiveCoachingPanel.tsx');
const tab = read('src/components/ats/ScorecardTab.tsx');

// Un compte rendu où chaque champ interne porte une marque reconnaissable.
const REPORT = {
  summary: 'SYNTHESE : parcours solide en logistique.',
  recommendation: 'GO',
  recommendation_reason: 'RAISON : maîtrise le périmètre.',
  strengths: ['FORT 1', 'FORT 2'],
  red_flags: ['ALERTE : instabilité'],
  open_questions: ['QUESTION : préavis ?'],
  follow_up_message: 'SUIVI : merci pour l’échange.',
  criteria_evaluation: [
    { name: 'Pilotage', score: 4, comment: 'COMMENT : bon', verbatim: 'VERBATIM : « je gère douze personnes »' },
    { name: 'Anglais', score: 9, comment: '', verbatim: 'VERBATIM 2' },
  ],
};

// ─── Suite proposée ────────────────────────────────────────────────────────

test('suite proposée : GO annonce la suite, NO_GO refuse, le reste demande des précisions', () => {
  assert.equal(front.suggestedAction('GO'), 'next_step');
  assert.equal(front.suggestedAction(' go '), 'next_step');
  assert.equal(front.suggestedAction('NO_GO'), 'decline');
  assert.equal(front.suggestedAction('A_CREUSER'), 'clarify');
  assert.equal(front.suggestedAction('MAYBE'), 'clarify');
  assert.equal(front.suggestedAction(null), 'clarify');
  assert.equal(front.suggestedAction(undefined), 'clarify');
});

test('présentation au manager : cabinets et freelances, jamais une recommandation défavorable', () => {
  assert.equal(front.offersManagerPresentation('GO', 'agency'), true);
  assert.equal(front.offersManagerPresentation('A_CREUSER', 'freelance'), true);
  assert.equal(front.offersManagerPresentation('NO_GO', 'agency'), false);
  assert.equal(front.offersManagerPresentation('GO', 'enterprise'), false);
  // Organisation pas encore chargée : fermé (fail-closed, comme hasFeature).
  assert.equal(front.offersManagerPresentation('GO', null), false);
});

test('les types d’organisation du serveur sont ceux du portail client', () => {
  for (const orgType of ['agency', 'freelance', 'enterprise']) {
    assert.equal(
      server.canPresentToManager(orgType),
      front.offersManagerPresentation('GO', orgType),
      `écart sur ${orgType}`,
    );
  }
  assert.equal(server.canPresentToManager(null), false);
  assert.equal(server.canPresentToManager(undefined), false);
  assert.equal(server.canPresentToManager('autre'), false);
});

test('les actions et l’adresse e-mail ont la même définition côté navigateur et côté serveur', () => {
  assert.deepEqual(front.FOLLOW_UP_ACTIONS.map((a) => a.value), [...server.FOLLOW_UP_ACTIONS]);
  for (const value of ['a@b.fr', 'prenom.nom@exemple.com', 'a b@c.fr', 'a@b', '@b.fr', '', '  ']) {
    assert.equal(front.isValidEmail(value), server.EMAIL_RE.test(value.trim()), value);
  }
});

// ─── Brief : client et manager ─────────────────────────────────────────────

test('manager et client lus dans le brief, champs vides quand ils manquent', () => {
  const brief = { client: { name: ' Acme ', hiring_manager: { name: 'Léa Martin', title: 'DRH', email: ' lea@acme.fr ' } } };
  assert.deepEqual(front.hiringManagerOf(brief), { name: 'Léa Martin', title: 'DRH', email: 'lea@acme.fr' });
  assert.equal(front.clientNameOf(brief), 'Acme');
  for (const empty of [null, undefined, {}, { client: null }, { client: { hiring_manager: 'x' } }, 'texte', []]) {
    assert.deepEqual(front.hiringManagerOf(empty), { name: '', title: '', email: '' });
    assert.equal(front.clientNameOf(empty), '');
  }
});

// ─── Ce que le modèle a le droit de voir ───────────────────────────────────

test('présentation au manager : ni points d’alerte, ni verbatims, ni questions ouvertes, ni message de suivi', () => {
  const view = server.managerReportView(REPORT);
  const serialized = JSON.stringify(view);
  for (const interne of ['ALERTE', 'VERBATIM', 'QUESTION', 'SUIVI']) {
    assert.ok(!serialized.includes(interne), `${interne} ne doit pas passer`);
  }
  assert.match(serialized, /SYNTHESE/);
  assert.match(serialized, /FORT 1/);
  assert.match(serialized, /COMMENT : bon/);
  // Une note hors de 0 à 5 est écartée, le critère reste.
  assert.deepEqual(view.criteria.map((c) => c.score), [4, null]);
});

test('le prompt de présentation ne contient aucune marque interne', () => {
  const prompt = server.buildDraftPrompt({
    kind: 'manager_presentation', action: 'next_step', candidateName: 'Paul Durand', jobTitle: 'Responsable logistique',
    clientName: 'Acme', managerName: 'Léa Martin', senderName: 'Sam', nextStepName: '', report: REPORT,
  });
  const all = `${prompt.system}\n${prompt.user}`;
  for (const interne of ['ALERTE', 'VERBATIM', 'QUESTION', 'SUIVI']) {
    assert.ok(!all.includes(interne), `${interne} ne doit pas partir au modèle`);
  }
  assert.match(prompt.user, /Léa Martin/);
  assert.match(prompt.user, /Pilotage : 4\/5/);
  assert.match(prompt.system, /aucune parole du candidat citée/);
});

test('le prompt du message au candidat ne reprend ni raison, ni notes, ni alertes', () => {
  const prompt = server.buildDraftPrompt({
    kind: 'follow_up', action: 'clarify', candidateName: 'Paul Durand', jobTitle: 'Responsable logistique',
    clientName: '', managerName: '', senderName: 'Sam', nextStepName: '', report: REPORT,
  });
  const all = `${prompt.system}\n${prompt.user}`;
  for (const interne of ['ALERTE', 'RAISON', 'VERBATIM', 'COMMENT', 'SYNTHESE']) {
    assert.ok(!all.includes(interne), `${interne} ne doit pas partir au modèle`);
  }
  // Les questions ouvertes servent pour « Précisions » seulement.
  assert.match(prompt.user, /QUESTION : préavis/);
  const next = server.buildDraftPrompt({
    kind: 'follow_up', action: 'next_step', candidateName: 'Paul', jobTitle: '', clientName: '', managerName: '',
    senderName: '', nextStepName: 'Entretien manager', report: REPORT,
  });
  assert.ok(!next.user.includes('QUESTION'));
  assert.match(next.user, /Entretien manager/);
});

test('lecture du brouillon : objet et corps obligatoires, bornés', () => {
  assert.deepEqual(server.parseDraft('Voici : {"subject":" Suite ","body":"Bonjour,\\n\\nMerci."}'), { subject: 'Suite', body: 'Bonjour,\n\nMerci.' });
  assert.equal(server.parseDraft('{"subject":"","body":"x"}'), null);
  assert.equal(server.parseDraft('{"subject":"x"}'), null);
  assert.equal(server.parseDraft('pas du json'), null);
  assert.equal(server.parseDraft(null), null);
  const long = server.parseDraft(JSON.stringify({ subject: 'a'.repeat(500), body: 'b'.repeat(9000) }));
  assert.equal(long.subject.length, server.MAX_SUBJECT_LENGTH);
  assert.equal(long.body.length, server.MAX_BODY_LENGTH);
});

// ─── Envoi ─────────────────────────────────────────────────────────────────

const SEND = {
  kind: 'follow_up', to_email: ' Paul@Exemple.FR ', to_name: 'Paul', subject: 'Suite', body: 'Bonjour',
  candidate_id: 'ACoAA123', linkedin_url: 'https://www.linkedin.com/in/paul',
};

test('envoi : un message complet passe, adresse en minuscules', () => {
  const ok = server.validateSendPayload(SEND);
  assert.equal(ok.ok, true);
  assert.equal(ok.value.to_email, 'paul@exemple.fr');
  assert.equal(ok.value.consent_confirmed, false);
});

test('envoi : refus d’une demande incomplète, avec un code stable', () => {
  const code = (patch) => {
    const r = server.validateSendPayload({ ...SEND, ...patch });
    return r.ok ? 'OK' : r.code;
  };
  assert.equal(code({ kind: 'autre' }), 'INVALID_KIND');
  assert.equal(code({ to_email: 'pas-une-adresse' }), 'INVALID_EMAIL');
  assert.equal(code({ subject: '  ' }), 'SUBJECT_REQUIRED');
  assert.equal(code({ subject: 'a'.repeat(201) }), 'SUBJECT_TOO_LONG');
  assert.equal(code({ body: '' }), 'BODY_REQUIRED');
  assert.equal(code({ body: 'a'.repeat(5001) }), 'BODY_TOO_LONG');
  assert.equal(code({ candidate_id: '' }), 'CANDIDATE_REQUIRED');
  assert.equal(server.validateSendPayload(null).code, 'INVALID_KIND');
});

test('présentation : l’accord du candidat est obligatoire et doit valoir true', () => {
  const presentation = { ...SEND, kind: 'manager_presentation' };
  for (const consent of [undefined, false, 'true', 1, null]) {
    const r = server.validateSendPayload({ ...presentation, candidate_consent_confirmed: consent });
    assert.equal(r.ok, false, `accord ${String(consent)} refusé`);
    assert.equal(r.code, 'CONSENT_REQUIRED');
  }
  const ok = server.validateSendPayload({ ...presentation, candidate_consent_confirmed: true });
  assert.equal(ok.ok, true);
  assert.equal(ok.value.consent_confirmed, true);
});

test('le corps part en HTML sans rien interpréter', () => {
  assert.equal(server.textToHtml('Bonjour,\n<b>Léa</b> & "Sam"'), '<div>Bonjour,<br>&lt;b&gt;Léa&lt;/b&gt; &amp; &quot;Sam&quot;</div>');
});

test('la note de fiche dit ce qui est parti, vers qui, quand, et l’accord déclaré', () => {
  const base = { toEmail: 'lea@acme.fr', toName: 'Léa Martin', fromEmail: 'sam@cabinet.fr', subject: 'Paul Durand', sentAtIso: '2026-10-05T10:30:00Z' };
  const suivi = server.noteContent({ ...base, kind: 'follow_up' });
  assert.match(suivi, /^E-mail de suivi envoyé à Léa Martin \(lea@acme\.fr\) le 05\/10\/2026 à 12:30 depuis sam@cabinet\.fr\./);
  assert.ok(!/accord/i.test(suivi));
  const presentation = server.noteContent({ ...base, kind: 'manager_presentation', toName: '' });
  assert.match(presentation, /^Présentation envoyée à lea@acme\.fr le /);
  assert.match(presentation, /Accord du candidat à sa présentation confirmé par le recruteur/);
});

// ─── Interface ─────────────────────────────────────────────────────────────

test('composant : rédaction avec crédits, envoi par la fonction dédiée, confirmation avant envoi', () => {
  assert.match(component, /invokeWithCredits<[^>]*>\(\s*'generate-interview-followup',\s*'interview_followup'/);
  assert.match(component, /invokeEdgeFunction<[^>]*>\(\s*'send-candidate-email'/);
  assert.match(component, /<AlertDialog /);
  assert.match(component, /setConfirmOpen\(true\)/);
  // L'envoi lui-même ne part que du bouton de la boîte de dialogue.
  assert.equal((component.match(/void send\(\)/g) ?? []).length, 1);
  assert.match(component, /<AlertDialogAction[\s\S]*void send\(\)/);
});

test('composant : l’accord du candidat est une case à cocher qui conditionne l’envoi de la présentation', () => {
  assert.match(component, /<Checkbox/);
  assert.match(component, /requiresConsent = kind === 'manager_presentation'/);
  assert.match(component, /\(!requiresConsent \|\| consent\)/);
  assert.match(component, /candidate_consent_confirmed: requiresConsent \? consent : undefined/);
  assert.match(component, /disabled=\{!canSend \|\| mailbox\.loading\}/);
});

test('composant : la présentation n’est proposée qu’aux cabinets et freelances, jamais pour un refus', () => {
  assert.match(component, /offersManagerPresentation\(report\.recommendation, orgType\) && action !== 'decline'/);
  assert.match(component, /\{offersManager && \(/);
});

test('composant : le message au candidat repart de zéro quand la suite change', () => {
  assert.match(component, /<MessageComposer\s+key=\{action\}\s+kind="follow_up"/);
});

test('composant : boîte e-mail de la personne connectée, lien vers les connexions si absente', () => {
  assert.match(component, /useEmailConnectorStatus\(organizationId, user\?\.id\)/);
  assert.match(component, /to="\/settings\/account\/connections"/);
});

test('composant : le client et le manager viennent du brief de la mission du candidat', () => {
  assert.match(component, /BRIEF_CLIENT_COLUMNS: string = 'client:job_details->client'/);
  assert.match(component, /\.from\('sourcing_projects'\)/);
  assert.match(component, /enabled: Boolean\(projectId\) && offersManager/);
  assert.match(component, /hiringManagerOf\(briefQuery\.data\)/);
});

test('composant : aucun nom de prestataire dans ce que la personne lit', () => {
  const strings = [...component.matchAll(/(['"`])((?:\\.|(?!\1).)*?[A-Za-zÀ-ÿ]{3,}(?:\\.|(?!\1).)*?)\1/g)].map((m) => m[2]);
  const visible = strings.join('\n') + '\n' + (component.match(/>[^<>{}\n]*[A-Za-zÀ-ÿ]{3,}[^<>{}\n]*</g) ?? []).join('\n');
  assert.doesNotMatch(visible, /unipile|deepgram|anthropic|claude|resend|gemini|openai/i);
});

test('panneau et onglet : le compte rendu affiche la suite, avec l’adresse, le profil et la mission du candidat', () => {
  assert.match(panel, /<InterviewFollowUp[\s\S]*report=\{report\}/);
  assert.match(panel, /candidateEmail=\{candidateEmail\}/);
  assert.match(panel, /candidateLinkedinUrl=\{candidateLinkedinUrl\}/);
  assert.match(panel, /projectId=\{projectId\}/);
  assert.match(panel, /onScheduleNext=\{\(\) => setScheduleOpen\(true\)\}/);
  // Le bouton « Programmer l'entretien suivant » vit désormais dans le composant, une seule fois.
  assert.doesNotMatch(panel, /Programmer l'entretien suivant/);
  assert.equal((component.match(/Programmer l'entretien suivant/g) ?? []).length, 1);
  assert.match(tab, /candidateEmail=\{candidate\.email\}/);
  assert.match(tab, /candidateLinkedinUrl=\{candidate\.linkedin\}/);
  assert.match(tab, /projectId=\{activeEval\.projectId\}/);
});

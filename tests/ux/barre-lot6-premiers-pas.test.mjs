/**
 * Barre latérale, lot 6 : Premiers pas (§7 de la spécification, chantier C5).
 *
 * Le module pur src/lib/firstSteps.ts est transpilé en mémoire par esbuild et
 * chargé par une URL data: (patron de notification-kinds.test.mjs). Le hook et
 * la section, qui dépendent du client Supabase, sont vérifiés par inspection
 * de source.
 *
 * Lancer : node --test tests/ux/barre-lot6-premiers-pas.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const firstStepsSrc = read('src/lib/firstSteps.ts');
const { code } = transformSync(firstStepsSrc, { loader: 'ts', format: 'esm' });
const {
  FIRST_STEPS,
  FIRST_STEPS_HIDDEN_KEY,
  FIRST_STEPS_DONE_KEY,
  evaluateFirstSteps,
} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

const hook = read('src/hooks/sidebar/useFirstSteps.ts');
const section = read('src/components/sidebar/todo/FirstStepsSection.tsx');

/** Signaux complets, rien de coché. */
const base = (extra = {}) => ({
  missionCount: 0,
  partnerMissionCount: 0,
  linkedinLinked: false,
  searchWithResults: false,
  teamInvited: false,
  partnerInvitedOrPublished: false,
  interviewScheduled: false,
  canInviteTeam: true,
  ...extra,
});
const ids = (r) => r.steps.map((s) => s.id);

// ---------------------------------------------------------------- B6P-1
test('B6P-1 : firstSteps.ts est pur, sans aucun import', () => {
  assert.doesNotMatch(firstStepsSrc, /^\s*import\s/m);
  assert.doesNotMatch(firstStepsSrc, /\brequire\(/);
});

// ---------------------------------------------------------------- B6P-2
test('B6P-2 : étapes par type d\'organisation, exactement comme au §7.1', () => {
  assert.deepEqual(FIRST_STEPS, {
    enterprise: ['create_job', 'invite_partner', 'schedule_interview'],
    agency: ['create_mission', 'link_linkedin', 'first_search', 'invite_team'],
    freelance: ['create_mission', 'link_linkedin', 'first_search'],
  });
  assert.equal(FIRST_STEPS_HIDDEN_KEY('o1', 'u1'), 'konekt:nav:first-steps-hidden:o1:u1');
  assert.equal(FIRST_STEPS_DONE_KEY('o1', 'u1'), 'konekt:nav:first-steps-done:o1:u1');
});

// ---------------------------------------------------------------- B6P-3
test('B6P-3 : cabinet sans droit d\'équipe (formule gratuite ou solo) : 3 étapes, sans invite_team', () => {
  const r = evaluateFirstSteps('agency', base({ canInviteTeam: false, teamInvited: null }));
  assert.equal(r.status, 'ok');
  assert.deepEqual(ids(r), ['create_mission', 'link_linkedin', 'first_search']);
});

test('B6P-3 : cabinet avec droit d\'équipe : 4 étapes', () => {
  const r = evaluateFirstSteps('agency', base());
  assert.equal(r.status, 'ok');
  assert.deepEqual(ids(r), ['create_mission', 'link_linkedin', 'first_search', 'invite_team']);
  assert.equal(r.allDone, false);
});

test('B6P-3 : canInviteTeam null (état d\'abonnement non reçu) : loading', () => {
  const r = evaluateFirstSteps('agency', base({ canInviteTeam: null, teamInvited: null }));
  assert.equal(r.status, 'loading');
  assert.deepEqual(r.steps, []);
  assert.equal(r.allDone, false);
});

test('B6P-3 : indépendant : pas d\'invite_team, même si canInviteTeam est inconnu', () => {
  const r = evaluateFirstSteps('freelance', base({ canInviteTeam: null, teamInvited: null }));
  assert.equal(r.status, 'ok');
  assert.deepEqual(ids(r), ['create_mission', 'link_linkedin', 'first_search']);
});

test('B6P-3 : missionCount 0 et partnerMissionCount 2 : pas de create_mission ni de create_job', () => {
  const agency = evaluateFirstSteps('agency', base({ missionCount: 0, partnerMissionCount: 2 }));
  assert.equal(agency.status, 'ok');
  assert.ok(!ids(agency).includes('create_mission'));
  const enterprise = evaluateFirstSteps('enterprise', base({ missionCount: 0, partnerMissionCount: 2 }));
  assert.equal(enterprise.status, 'ok');
  assert.deepEqual(ids(enterprise), ['invite_partner', 'schedule_interview']);
});

test('B6P-3 : une mission à soi et des missions partenaires : create_mission gardée et cochée', () => {
  const r = evaluateFirstSteps('agency', base({ missionCount: 1, partnerMissionCount: 2 }));
  assert.deepEqual(r.steps[0], { id: 'create_mission', done: true });
});

test('B6P-3 : un signal requis null : loading', () => {
  for (const [orgType, key] of [
    ['agency', 'missionCount'],
    ['agency', 'linkedinLinked'],
    ['agency', 'searchWithResults'],
    ['agency', 'teamInvited'],
    ['freelance', 'linkedinLinked'],
    ['enterprise', 'missionCount'],
    ['enterprise', 'partnerInvitedOrPublished'],
    ['enterprise', 'interviewScheduled'],
  ]) {
    const r = evaluateFirstSteps(orgType, base({ [key]: null }));
    assert.equal(r.status, 'loading', `${orgType} / ${key}`);
  }
  // Aucune mission et missions partenaires inconnues : on ne sait pas s'il faut montrer l'étape.
  assert.equal(evaluateFirstSteps('agency', base({ missionCount: 0, partnerMissionCount: null })).status, 'loading');
});

test('B6P-3 : un signal d\'une étape non retenue peut rester null', () => {
  // Cabinet : les signaux de l'entreprise ne sont pas requis.
  const agency = evaluateFirstSteps('agency', base({ partnerInvitedOrPublished: null, interviewScheduled: null }));
  assert.equal(agency.status, 'ok');
  // Entreprise : ni LinkedIn, ni recherche, ni équipe.
  const enterprise = evaluateFirstSteps('enterprise', base({
    linkedinLinked: null, searchWithResults: null, teamInvited: null, canInviteTeam: null,
  }));
  assert.equal(enterprise.status, 'ok');
  // Au moins une mission : le nombre de missions partenaires n'est pas requis.
  assert.equal(evaluateFirstSteps('agency', base({ missionCount: 3, partnerMissionCount: null })).status, 'ok');
});

test('B6P-3 : tout coché : allDone', () => {
  const agency = evaluateFirstSteps('agency', base({
    missionCount: 2, linkedinLinked: true, searchWithResults: true, teamInvited: true,
  }));
  assert.equal(agency.status, 'ok');
  assert.equal(agency.allDone, true);
  assert.ok(agency.steps.every((s) => s.done));

  const enterprise = evaluateFirstSteps('enterprise', base({
    missionCount: 1, partnerInvitedOrPublished: true, interviewScheduled: true,
  }));
  assert.equal(enterprise.allDone, true);

  const partial = evaluateFirstSteps('freelance', base({ missionCount: 1, linkedinLinked: true }));
  assert.equal(partial.allDone, false);
  assert.deepEqual(partial.steps.map((s) => s.done), [true, true, false]);
});

// ---------------------------------------------------------------- B6P-4
test('B6P-4 : useFirstSteps : trois comptages sans lignes, filtrés sur l\'organisation', () => {
  for (const table of ['sourcing_projects', 'mission_invitations', 'qualification_sessions']) {
    const re = new RegExp(`from\\('${table}'\\)\\.select\\('id', \\{ count: 'exact', head: true \\}\\)\\s*\\.eq\\('organization_id', organizationId\\)`);
    assert.match(hook, re, table);
  }
  assert.equal((hook.match(/head: true/g) || []).length, 3);
  assert.match(hook, /\.gt\('stats_total_found', 0\)/);
  assert.match(hook, /Promise\.all\(/);
  assert.match(hook, /queryKey: \['sidebar', 'first-steps', organizationId, orgType\]/);
  assert.match(hook, /if \(invitations\.error\) throw invitations\.error;/);
  assert.match(hook, /if \(interviews\.error\) throw interviews\.error;/);
  assert.match(hook, /if \(searches\.error\) throw searches\.error;/);
});

test('B6P-4 : droit d\'équipe par le plan effectif, sièges lus seulement une fois l\'état reçu', () => {
  assert.match(hook, /hasPlanFeature\(subscription\.effectivePlanId, 'team'\)/);
  assert.match(hook, /hasFeature\(orgType, 'team_management'\)/);
  assert.match(hook, /isAdmin/);
  // canInviteTeam null tant que l'état n'est pas reçu.
  assert.match(hook, /subscription\.state === null\s*\?\s*null/);
  // seatCount n'est lu que sous la garde state !== null.
  const seatIdx = hook.indexOf('subscription.seatCount');
  assert.ok(seatIdx > 0, 'seatCount lu');
  const guardIdx = hook.lastIndexOf('subscription.state !== null', seatIdx);
  assert.ok(guardIdx > 0 && seatIdx - guardIdx < 200, 'seatCount sous la garde state !== null');
  assert.match(hook, /pendingInvitationsLoaded/);
});

test('B6P-4 : aucune lecture de last_search_at, aucun appel au service de connexion LinkedIn', () => {
  assert.doesNotMatch(hook, /last_search_at/);
  assert.doesNotMatch(hook, /unipile/i);
  assert.doesNotMatch(hook, /invokeEdgeFunction|functions\.invoke/);
  assert.match(hook, /useMemberLinkedInAccounts\(\)/);
  assert.match(hook, /m\.user_id === userId/);
});

test('B6P-4 : sources partagées par le contrat (useMyMissions, useQuotaGate) et comptages bornés à la section visible', () => {
  assert.match(hook, /from '@\/hooks\/sidebar\/useMyMissions'/);
  assert.match(hook, /useMyMissions\(\{ enabled \}\)/);
  assert.match(hook, /useQuotaGate\(\)/);
  assert.match(hook, /ownOrgMissionCount/);
  assert.match(hook, /partnerMissionCount/);
  assert.match(hook, /enabled: enabled && !!organizationId && !!orgType/);
  assert.doesNotMatch(hook, /\bas any\b|: any\b/);
});

test('B6P-4 : drapeaux locaux lus et écrits sous try/catch', () => {
  assert.match(hook, /try \{\s*value = window\.localStorage\.getItem\(key\) === '1';\s*\} catch/);
  assert.match(hook, /try \{\s*window\.localStorage\.setItem\(key, '1'\);\s*\} catch/);
  assert.match(hook, /useSyncExternalStore\(/);
});

// ---------------------------------------------------------------- B6P-5
test('B6P-5 : FirstStepsSection : liens sans ancre, cibles du §7.3', () => {
  const targets = [...section.matchAll(/return (?:ctx\.\w+ \? )?[`'](\/[^`']*)[`'](?: : [`'](\/[^`']*)[`'])?;/g)]
    .flatMap((m) => [m[1], m[2]].filter(Boolean));
  assert.ok(targets.length >= 8, `cibles trouvées : ${targets.join(', ')}`);
  for (const t of targets) assert.doesNotMatch(t, /#/, t);
  assert.doesNotMatch(section, /['"`][^'"`]*#[a-z][^'"`]*['"`]/i, 'aucune ancre dans le fichier');
  assert.match(section, /\/missions\?create=brief/);
  assert.match(section, /'\/settings\/account\/connections'/);
  assert.match(section, /\?tab=sourcing` : '\/sourcing'/);
  assert.match(section, /'\/settings\/org\/team'/);
  assert.match(section, /'\/calendar'/);
});

test('B6P-5 : invite_partner mène à Process, avec le sous-titre qui indique où publier', () => {
  assert.match(section, /case 'invite_partner':[\s\S]{0,300}\?tab=process`/);
  assert.match(section, /'Inviter : Process\. Publier : Configuration\.'/);
});

test('B6P-5 : textes visibles exacts du §10', () => {
  for (const text of [
    'Premiers pas', 'Masquer', 'Masquer les premiers pas',
    'Créer une première mission', 'Créer un premier poste', 'Relier votre compte LinkedIn',
    'Lancer une première recherche', 'Inviter votre équipe',
    'Inviter un cabinet ou publier sur la marketplace', 'Planifier un entretien',
    'Impossible de vérifier vos premiers pas.',
  ]) {
    assert.ok(section.includes(text), text);
  }
  assert.match(section, /aria-label="Masquer les premiers pas"/);
  assert.match(section, /\{doneCount\} sur \{steps\.length\}/);
});

test('B6P-5 : FIRST_STEPS_DONE_KEY lue avant tout rendu de chargement', () => {
  const doneIdx = section.indexOf('FIRST_STEPS_DONE_KEY(');
  const nullIdx = section.indexOf('return null', doneIdx);
  const sectionIdx = section.indexOf('<SidebarSection');
  const hookIdx = section.indexOf('useFirstSteps({');
  assert.ok(doneIdx > 0, 'clé lue');
  assert.ok(nullIdx > doneIdx && nullIdx < sectionIdx, 'retour anticipé avant le rendu');
  // Les lectures (useFirstSteps) vivent dans un composant enfant, monté seulement si la section est visible.
  assert.ok(hookIdx > nullIdx, 'useFirstSteps appelé après le retour anticipé, dans le composant enfant');
  assert.match(section, /if \(!doneKey \|\| !orgType \|\| done \|\| hidden\) return null;/);
  // Tous cochés : la clé « finie » est écrite, la section disparaît.
  assert.match(section, /if \(finished\) onAllDone\(\);/);
  assert.match(section, /\[finished, onAllDone\]/);
  // Étape faite : coche verte, non cliquable.
  assert.match(section, /<CheckCircle2 className="text-green-600/);
});

test('B6P-5 : la section n\'exporte que son composant', () => {
  const exports = [...section.matchAll(/^export\s+(?:const|function|default|class|let)\s+(\w+)?/gm)].map((m) => m[1]);
  assert.deepEqual(exports, ['FirstStepsSection']);
});

// ---------------------------------------------------------------- Textes
test('Aucun nom de fournisseur ni tiret long dans les fichiers du chantier', () => {
  const vendors = /\b(Unipile|Apollo|Anthropic|Claude|Resend|Stripe|BetterContact|People Data Labs|PDL)\b/;
  for (const [name, src] of [['firstSteps', firstStepsSrc], ['useFirstSteps', hook], ['FirstStepsSection', section]]) {
    assert.doesNotMatch(src, vendors, name);
    assert.ok(!src.includes('—'), `${name} : tiret long`);
  }
});

/**
 * Carte « Mon compte LinkedIn », sections ajoutées (passe 2b) : « Invitations en attente »
 * et « Contrat LinkedIn » (src/components/connections/LinkedInExtras.tsx).
 *
 * - modules purs : textes (linkedInExtrasCopy.ts), lecture des réponses et appels
 *   (linkedInExtrasApi.ts, appels injectés, sans réseau) ;
 * - garde statique : montage en différé et seulement pour un compte utilisable, retrait
 *   derrière une boîte de confirmation, cibles de 44 px, états chargement / vide / erreur,
 *   aucun nom de prestataire, aucun texte brut du serveur.
 *
 * Lancer : node --test tests/ux/linkedin-extras.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadTs, read, stripComments } from './connexion-helpers.mjs';

const copy = await loadTs('src/components/connections/linkedInExtrasCopy.ts');
const api = await loadTs('src/components/connections/linkedInExtrasApi.ts');

const COPY_SRC = read('src/components/connections/linkedInExtrasCopy.ts');
const API_SRC = read('src/components/connections/linkedInExtrasApi.ts');
const UI_SRC = read('src/components/connections/LinkedInExtras.tsx');
const CARD_SRC = read('src/components/settings/MyLinkedInAccount.tsx');

/** Toutes les phrases que la copie peut rendre, pour les gardes de style. */
function allCopyStrings() {
  const out = [];
  const walk = (v) => {
    if (typeof v === 'string') out.push(v);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(copy.INVITATIONS_COPY);
  walk(copy.CONTRACTS_COPY);
  out.push(
    copy.invitationsCountText(1), copy.invitationsCountText(4),
    copy.withdrawAriaLabel('Claire Martin'), copy.withdrawDialogBody('Claire Martin'),
    copy.contractUseAriaLabel('Contrat A'), copy.contractChangedText('Contrat A'),
    copy.contractProductLabel('recruiter'), copy.contractProductLabel('sales_navigator'),
  );
  for (const days of [null, 0, 1, 5, 29, 30, 90, 364, 365, 800]) out.push(copy.invitationAgeText(days));
  return out;
}

// ------------------------------------------------------------------ textes
test('ancienneté d’une invitation : aujourd’hui, hier, jours, mois, plus d’un an, date inconnue', () => {
  assert.equal(copy.invitationAgeText(null), 'Date d’envoi inconnue');
  assert.equal(copy.invitationAgeText(-3), 'Date d’envoi inconnue');
  assert.equal(copy.invitationAgeText(0), 'Envoyée aujourd’hui');
  assert.equal(copy.invitationAgeText(1), 'Envoyée hier');
  assert.equal(copy.invitationAgeText(12), 'Envoyée il y a 12 jours');
  assert.equal(copy.invitationAgeText(29), 'Envoyée il y a 29 jours');
  assert.equal(copy.invitationAgeText(30), 'Envoyée il y a 1 mois');
  assert.equal(copy.invitationAgeText(95), 'Envoyée il y a 3 mois');
  assert.equal(copy.invitationAgeText(400), 'Envoyée il y a plus d’un an');
});

test('compte des invitations : singulier et pluriel', () => {
  assert.equal(copy.invitationsCountText(1), '1 invitation en attente');
  assert.equal(copy.invitationsCountText(12), '12 invitations en attente');
});

test('les textes citent la personne et le contrat, et expliquent l’exclusion Recruiter / Sales Navigator', () => {
  assert.match(copy.withdrawAriaLabel('Claire Martin'), /Claire Martin/);
  assert.match(copy.withdrawDialogBody('Claire Martin'), /Claire Martin/);
  assert.match(copy.contractUseAriaLabel('Contrat A'), /Contrat A/);
  assert.match(copy.CONTRACTS_COPY.explanation, /Recruiter et Sales Navigator ne fonctionnent pas en même temps/);
  assert.equal(copy.contractProductLabel('recruiter'), 'LinkedIn Recruiter');
  assert.equal(copy.contractProductLabel('sales_navigator'), 'Sales Navigator');
  assert.equal(copy.contractProductLabel('autre'), null);
});

test('style : vouvoiement, aucun tiret cadratin, aucun mot de remplissage, aucun nom de prestataire', () => {
  const FILLER = /\b(crucial|essentiel|robuste|riche|fluide|puissant|innovant|explorer|naviguer|garantir|veiller à)\b/i;
  const VENDOR = /unipile|people data labs|\bpdl\b|apollo|anthropic|claude|resend/i;
  const TUTOIEMENT = /\b(tu|ton|ta|tes|toi|te)\b/i;
  for (const s of allCopyStrings()) {
    assert.ok(!s.includes('—') && !s.includes('–'), `tiret cadratin dans « ${s} »`);
    assert.ok(!FILLER.test(s), `mot de remplissage dans « ${s} »`);
    assert.ok(!VENDOR.test(s), `nom de prestataire dans « ${s} »`);
    assert.ok(!TUTOIEMENT.test(s), `tutoiement dans « ${s} »`);
  }
});

// ------------------------------------------------------------------ lecture des réponses
test('liste d’invitations : forme réduite, doublons et lignes sans identifiant écartés, photo en https seulement', () => {
  const page = api.parseInvitationsPage({
    success: true,
    invitations: [
      { id: 'inv1', name: ' Claire Martin ', headline: 'CTO', picture_url: 'https://media.example/p.jpg', age_days: 12.9, profile_url: 'x' },
      { id: 'inv1', name: 'Doublon' },
      { id: 42, name: null, picture_url: 'http://insecure.example/p.jpg', age_days: null },
      { name: 'Sans identifiant' },
      null,
    ],
    cursor: 'abc',
    total: 7,
  });
  assert.deepEqual(page, {
    invitations: [
      { id: 'inv1', name: 'Claire Martin', headline: 'CTO', pictureUrl: 'https://media.example/p.jpg', ageDays: 12 },
      { id: '42', name: null, headline: null, pictureUrl: null, ageDays: null },
    ],
    cursor: 'abc',
    total: 7,
  });
});

test('liste d’invitations : fin de liste sans curseur, forme inconnue refusée (jamais une liste vide)', () => {
  const last = api.parseInvitationsPage({ success: true, invitations: [], cursor: null, total: 0 });
  assert.deepEqual(last, { invitations: [], cursor: null, total: 0 });
  assert.equal(api.parseInvitationsPage({ success: false, invitations: [] }), null);
  assert.equal(api.parseInvitationsPage({ success: true }), null);
  assert.equal(api.parseInvitationsPage(null), null);
});

test('contrats : section seulement au-delà d’un contrat ; un nom de prestataire n’est pas repris', () => {
  const contracts = api.parseContracts({
    success: true,
    recruiter_info: { has_recruiter: true, has_sales_navigator: true },
    contracts: [
      { id: 'c1', name: 'Cabinet Martin', product: 'recruiter', selected: true, description: 'Contrat principal' },
      { id: 'c2', name: 'Unipile contract', product: 'sales_navigator', selected: false },
      { id: 'c2', name: 'Doublon', product: 'recruiter' },
      { name: 'Sans identifiant' },
    ],
  });
  assert.equal(contracts.length, 2);
  assert.deepEqual(contracts[0], { id: 'c1', name: 'Cabinet Martin', product: 'recruiter', selected: true, description: 'Contrat principal' });
  assert.equal(contracts[1].name, null, 'nom de prestataire écarté');
  assert.equal(api.hasContractChoice(contracts), true);
  assert.equal(api.hasContractChoice(contracts.slice(0, 1)), false);
  assert.equal(api.hasContractChoice([]), false);
  assert.equal(api.hasContractChoice(null), false);
  assert.equal(api.parseContracts({ success: true }), null);
  assert.equal(api.parseContracts({ success: false, contracts: [] }), null);
});

test('contrats : lus seulement si l’offre peut en avoir (Recruiter, Sales Navigator, ou offre inconnue)', () => {
  assert.equal(api.shouldReadContracts(null), true);
  assert.equal(api.shouldReadContracts(undefined), true);
  assert.equal(api.shouldReadContracts({ recruiter: true }), true);
  assert.equal(api.shouldReadContracts({ sales_navigator: true }), true);
  assert.equal(api.shouldReadContracts({ recruiter: false, sales_navigator: false }), false);
  assert.equal(api.shouldReadContracts({}), false);
});

test('mises à jour locales : un seul contrat choisi, une invitation retirée fait baisser le total', () => {
  const contracts = [
    { id: 'c1', name: 'A', product: 'recruiter', selected: true, description: null },
    { id: 'c2', name: 'B', product: 'sales_navigator', selected: false, description: null },
  ];
  assert.deepEqual(api.withSelectedContract(contracts, 'c2').map((c) => c.selected), [false, true]);
  const page = { invitations: [{ id: 'a' }, { id: 'b' }], cursor: null, total: 2 };
  assert.deepEqual(api.withoutInvitation(page, 'a'), { invitations: [{ id: 'b' }], cursor: null, total: 1 });
  assert.deepEqual(api.withoutInvitation(page, 'zz'), page, 'identifiant inconnu : rien ne change');
  assert.equal(api.withoutInvitation({ ...page, total: null }, 'a').total, null);
});

// ------------------------------------------------------------------ appels
test('list_sent_invitations : action, compte et curseur transmis ; réponse lue', async () => {
  const calls = [];
  const invoke = async (body) => {
    calls.push(body);
    return { data: { success: true, invitations: [{ id: 'inv1', name: 'Claire', age_days: 3 }], cursor: 'next', total: 30 } };
  };
  const first = await api.listSentInvitations(invoke, 'acc1');
  const second = await api.listSentInvitations(invoke, 'acc1', 'next');
  assert.deepEqual(calls[0], { action: 'list_sent_invitations', account_id: 'acc1' });
  assert.deepEqual(calls[1], { action: 'list_sent_invitations', account_id: 'acc1', cursor: 'next' });
  assert.equal(first.ok, true);
  assert.equal(second.page.cursor, 'next');
});

test('list_sent_invitations : un échec garde le message du serveur s’il est montrable, sinon le repli', async () => {
  const shown = await api.listSentInvitations(async () => ({
    data: { success: false, error: 'Limite LinkedIn atteinte. Espacez vos requêtes et réessayez plus tard.' },
  }), 'acc1');
  assert.equal(shown.ok, false);
  assert.match(shown.userMessage, /Limite LinkedIn atteinte/);

  const vendor = await api.listSentInvitations(async () => ({ data: { success: false, error: 'Unipile responded 502' } }), 'acc1');
  assert.equal(vendor.ok, false);
  assert.equal(vendor.userMessage, copy.INVITATIONS_COPY.errorBody);

  const empty = await api.listSentInvitations(async () => ({ data: null }), 'acc1');
  assert.equal(empty.ok, false, 'une réponse vide n’est pas une liste vide');
});

test('withdraw_invitation : succès, suivi des séquences non mis à jour, invitation introuvable, échec', async () => {
  const sent = [];
  const ok = await api.withdrawInvitation(async (b) => { sent.push(b); return { data: { success: true, request_id: 'inv1', enrollments_updated: 1, enrollments_synced: true } }; }, 'acc1', 'inv1');
  assert.deepEqual(sent[0], { action: 'withdraw_invitation', account_id: 'acc1', request_id: 'inv1' });
  assert.deepEqual(ok, { ok: true, enrollmentsSynced: true });

  const notSynced = await api.withdrawInvitation(async () => ({ data: { success: true, enrollments_synced: false } }), 'acc1', 'inv1');
  assert.deepEqual(notSynced, { ok: true, enrollmentsSynced: false });

  const gone = await api.withdrawInvitation(async () => ({
    data: { success: false, errorType: 'INVITATION_NOT_FOUND', error: 'Cette invitation n’existe plus ou a déjà été traitée.' },
    httpStatus: 404,
  }), 'acc1', 'inv1');
  assert.equal(gone.ok, false);
  assert.equal(gone.notFound, true);
  assert.equal(gone.userMessage, copy.INVITATIONS_COPY.alreadyGone);

  const refused = await api.withdrawInvitation(async () => ({
    data: { success: false, errorType: 'ACCOUNT_NOT_YOURS', error: "Ce compte LinkedIn est relié par un autre membre de l'organisation. Retirez les invitations depuis votre propre compte." },
    httpStatus: 403,
  }), 'acc1', 'inv1');
  assert.equal(refused.ok, false);
  assert.ok(!refused.notFound);
  assert.match(refused.userMessage, /propre compte/);

  const raw = await api.withdrawInvitation(async () => ({ data: { success: false, error: 'Unipile 500' }, httpStatus: 500 }), 'acc1', 'inv1');
  assert.equal(raw.userMessage, copy.INVITATIONS_COPY.withdrawFailed);
});

test('list_contracts et select_contract : actions, compte et contrat transmis ; échecs en texte de Konekt', async () => {
  const sent = [];
  const listed = await api.listContracts(async (b) => {
    sent.push(b);
    return { data: { success: true, contracts: [{ id: 'c1', name: 'A', product: 'recruiter', selected: true }, { id: 'c2', name: 'B', product: 'sales_navigator' }] }, error: null };
  }, 'acc1');
  assert.deepEqual(sent[0], { action: 'list_contracts', account_id: 'acc1' });
  assert.equal(listed.ok, true);
  assert.equal(listed.contracts.length, 2);

  const failed = await api.listContracts(async () => ({ data: { success: false, error: 'Unipile 500' }, error: new Error('x') }), 'acc1');
  assert.equal(failed.ok, false);
  assert.equal(failed.userMessage, copy.CONTRACTS_COPY.errorBody);

  const picked = await api.selectContract(async (b) => { sent.push(b); return { data: { success: true, contract: { id: 'c2' } }, error: null }; }, 'acc1', 'c2');
  assert.deepEqual(sent[1], { action: 'select_contract', account_id: 'acc1', contract_id: 'c2' });
  assert.equal(picked.ok, true);

  const refused = await api.selectContract(async () => ({ data: { success: false }, error: new Error('403') }), 'acc1', 'c2');
  assert.equal(refused.ok, false);
  assert.equal(refused.userMessage, copy.CONTRACTS_COPY.selectFailed);
});

// ------------------------------------------------------------------ garde statique des écrans
test('la carte monte les sections en différé, pour un compte relié et utilisable seulement', () => {
  const src = stripComments(CARD_SRC);
  assert.match(src, /lazy\(\(\) => import\('@\/components\/connections\/LinkedInExtras'\)\)/);
  assert.match(src, /myMapping && myAccount && li\.isUsable[\s\S]{0,80}<Suspense/);
  assert.match(src, /<LinkedInExtras[\s\S]{0,200}accountId=\{myMapping\.linkedin_account_id\}/);
  // Ajout seul : plus aucun import statique du composant.
  assert.ok(!/import \{[^}]*LinkedInExtras[^}]*\} from/.test(src) && !/import LinkedInExtras from/.test(src));
});

test('le retrait passe par une boîte de confirmation, jamais window.confirm', () => {
  const src = stripComments(UI_SRC);
  assert.match(src, /<AlertDialog>/);
  assert.match(src, /<AlertDialogAction variant="destructive"/);
  assert.match(src, /onClick=\{\(\) => onWithdraw\(invitation\)\}/);
  assert.ok(!/window\.confirm|confirm\(/.test(src.replace(/INVITATIONS_COPY\.confirm/g, '')));
});

test('la confirmation du retrait ne promet pas plus que le serveur ne fait', () => {
  const body = copy.withdrawDialogBody('Claire Martin');
  // Une attente sans délai, une inscription en pause ou sous un autre identifiant ne bouge pas : « peut », jamais « continue ».
  assert.doesNotMatch(body, /\bcontinue\b/);
  assert.match(body, /peut passer tout de suite à l’étape prévue en cas de non-acceptation/);
});

test('retrait : le focus passe à la ligne suivante, sinon au titre, jamais perdu dans le document', () => {
  const src = stripComments(UI_SRC);
  assert.match(src, /data-withdraw=""/);
  assert.match(src, /pendingFocusIndex\.current = index;/);
  assert.match(src, /pendingFocusIndex\.current = variables\.index;/);
  assert.match(src, /querySelectorAll<HTMLButtonElement>\('button\[data-withdraw\]'\)/);
  assert.match(src, /<span ref=\{titleRef\} tabIndex=\{-1\}/);
  assert.match(src, /<ul ref=\{listRef\}/);
});

test('états chargement, vide et erreur ; cibles de 44 px ; noms accessibles par ligne', () => {
  const src = stripComments(UI_SRC);
  assert.match(src, /role="status"/);
  assert.match(src, /INVITATIONS_COPY\.loading/);
  assert.match(src, /INVITATIONS_COPY\.empty/);
  assert.match(src, /<ErrorState[\s\S]{0,200}INVITATIONS_COPY\.loadFailedTitle/);
  assert.match(src, /<ErrorState[\s\S]{0,200}CONTRACTS_COPY\.loadFailedTitle/);
  assert.match(src, /aria-label=\{withdrawAriaLabel\(name\)\}/);
  assert.match(src, /aria-label=\{contractUseAriaLabel\(name\)\}/);
  assert.ok((src.match(/max-md:h-11/g) ?? []).length >= 4, 'boutons de 44 px au doigt');
  assert.match(src, /hasNextPage/);
});

test('contrats : section absente à un seul contrat, choix par le serveur, liste relue ensuite', () => {
  const src = stripComments(UI_SRC);
  assert.match(src, /if \(!hasContractChoice\(contracts\)\) return null/);
  assert.match(src, /selectContract\(accountsInvoke, accountId, contract\.id\)/);
  assert.match(src, /withSelectedContract\(contracts, contract\.id\)/);
  assert.match(src, /onChanged\?\.\(\)/);
  assert.match(src, /CONTRACTS_COPY\.explanation/);
});

test('aucun nom de prestataire dans une chaîne affichable, aucun texte brut du serveur', () => {
  for (const [name, src] of [['copie', COPY_SRC], ['appels', API_SRC], ['écran', UI_SRC]]) {
    const code = stripComments(src);
    // Les chaînes entre guillemets du code (hors noms de fonctions, d'actions et de clés).
    for (const m of code.matchAll(/(['"`])((?:(?!\1)[^\\\n]|\\.)*)\1/g)) {
      const literal = m[2];
      if (/^[a-z_]+(-[a-z_]+)*$/.test(literal)) continue; // identifiant technique
      if (/^(@\/|\.\/)[\w./-]+$/.test(literal)) continue; // chemin d'import
      assert.ok(!/unipile|people data labs|apollo|anthropic/i.test(literal), `${name} : « ${literal} »`);
    }
  }
  // Le message du serveur ne passe jamais tel quel : filtre safeServerMessage.
  assert.match(stripComments(API_SRC), /safeServerMessage\(record\(data\)\.error\)/);
  assert.ok(!/toast\.(error|info|warning|success)\([^)]*\.error\b/.test(stripComments(UI_SRC)));
});

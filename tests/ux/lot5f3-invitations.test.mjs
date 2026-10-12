/**
 * Refonte mission, lot 5f-3 : les invitations LinkedIn reçues vivent dans la
 * messagerie (/inbox?onglet=invitations), pour tous. Interrupteur des séquences
 * allumé, le panneau Prise de contact n'a plus l'onglet et son ancien lien mène
 * à la messagerie ; éteint, le panneau provisoire garde son onglet.
 *
 * Lecture du code source, dans le style de tests/ux. Le comportement (accepter,
 * décliner, redirection, panneau) est joué par e2e/flows/seq-v2-invitations.spec.ts.
 *
 * Lancer : node --test tests/ux/lot5f3-invitations.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const inbox = read('src/pages/Inbox.tsx');
const panel = read('src/components/missions/v3/panels/ContactPanel.tsx');

test('5F3-1 la messagerie a l\'onglet Invitations, sans interrupteur', () => {
  assert.match(inbox, /import \{ InvitationsPanel \} from '@\/components\/outreach\/InvitationsPanel';/);
  assert.match(inbox, /const INVITATIONS_PARAM = 'invitations';/);
  assert.match(inbox, /searchParams\.get\('onglet'\) === INVITATIONS_PARAM \? 'invitations' : 'conversations'/);
  assert.match(inbox, /options=\{\[\{ value: 'conversations', label: 'Conversations' \}, \{ value: 'invitations', label: 'Invitations' \}\]\}/);
  assert.match(inbox, /aria-label="Messagerie"/);
  // Pour tous : ni l'interrupteur des séquences ni la formule ne conditionnent l'onglet.
  assert.doesNotMatch(inbox, /useSequencesBeta|sequencesBeta|hasPlanFeature/);
  // Passer d'un onglet à l'autre réécrit ?onglet= sans empiler d'historique ; les onglets de la liste gardent leurs valeurs.
  assert.match(inbox, /if \(next === 'invitations'\) params\.set\('onglet', INVITATIONS_PARAM\);\s*else params\.delete\('onglet'\);/);
  assert.match(inbox, /\}, \{ replace: true \}\);\s*\}, \[setSearchParams\]\);\s*\n\s*\/\/ SECURITY/);
});

test('5F3-2 l\'onglet n\'ouvre que le compte LinkedIn de la personne, avec ses états', () => {
  const body = inbox.slice(inbox.indexOf("{view === 'invitations' ? ("), inbox.indexOf('<AttendeePicturesProvider organizationId'));
  assert.match(body, /<InvitationsPanel\s+accounts=\{accounts\}\s+selectedAccount=\{currentAccount\}\s+onAccountChange=\{setSelectedAccount\}\s+organizationId=\{organizationId \|\| null\}/);
  assert.match(body, /accountsLoading \?/, 'chargement des comptes');
  assert.match(body, /connectionsError \?[\s\S]*?onClick=\{retryConnections\}>Réessayer</, 'erreur de lecture des comptes, avec réessai');
  assert.match(body, /accounts\.length === 0 \?[\s\S]*?Pour voir vos invitations, reliez d'abord un compte LinkedIn\./, 'aucun compte relié');
  // Les comptes passés sont ceux, déjà filtrés, de la messagerie (jamais le compte d'un collègue).
  assert.match(inbox, /return mapped\.filter\(a => a\.id === linkedId\);/);
});

test('5F3-3 panneau Prise de contact : interrupteur allumé, plus d\'onglet Invitations et le lien mène à la messagerie', () => {
  assert.match(panel, /import \{ useSequencesBeta \} from '@\/hooks\/useSequencesBeta';/);
  assert.match(panel, /const INBOX_INVITATIONS_PATH = '\/inbox\?onglet=invitations';/);
  assert.match(panel, /const invitationsInPanel = !useSequencesBeta\(\);/);
  assert.match(panel, /if \(!invitationsInPanel && asksInvitations\) return <Navigate to=\{INBOX_INVITATIONS_PATH\} replace \/>;/);
  assert.match(panel, /const tabs = invitationsInPanel \? TABS : TABS\.filter\(\(item\) => item\.key === 'sequences'\);/);
  // Une seule rubrique restante : pas de barre d'onglets, et l'onglet Invitations n'est pas monté.
  assert.match(panel, /\{tabs\.length > 1 && \(\s*<div\s+role="tablist"/);
  assert.match(panel, /\{invitationsInPanel && \(\s*<div\s+role="tabpanel"\s+id=\{`\$\{baseId\}-panel-invitations`\}/);
  // La redirection vient après tous les hooks du composant.
  const hooksEnd = panel.lastIndexOf('useState<');
  assert.ok(panel.indexOf('return <Navigate') > Math.max(hooksEnd, panel.lastIndexOf('useCallback(')), 'Navigate après les hooks');
});

test('5F3-4 interrupteur éteint : le panneau provisoire est inchangé', () => {
  // Les gardes de l'ancien rendu restent vraies : onglets, composants et message.
  assert.match(panel, /\{ key: 'invitations', label: 'Invitations' \}/);
  assert.match(panel, /<InvitationsPanel\s+accounts=\{accounts\}/);
  assert.match(panel, /<SequencesList[\s\S]*?layout="compact"/);
  assert.match(panel, /besidePage=\{!fullscreen\}/);
  assert.match(panel, /Réactivez la mission pour gérer ses séquences et ses invitations\./);
  assert.match(panel, /reliez d'abord un compte LinkedIn/);
  // La conversion des adresses de mission ne change pas et ne connaît ni la messagerie ni l'interrupteur (garde du lot 5h).
  assert.doesNotMatch(read('src/lib/missionBeta.ts'), /\/inbox|sequences-v2|useSequencesBeta/);
});

test('5F3-5 textes : français, sans tiret long, sans « (s) », sans nom de prestataire', () => {
  // Inbox.tsx garde un tiret long dans son en-tête d'avant le lot : on contrôle la partie ajoutée.
  const inboxAdded = inbox.slice(inbox.indexOf('type InboxView'), inbox.indexOf('export default function Inbox'))
    + inbox.slice(inbox.indexOf('// Lot 5f-3'), inbox.indexOf('// SECURITY'))
    + inbox.slice(inbox.indexOf("{view === 'invitations' ? ("), inbox.indexOf('<AttendeePicturesProvider organizationId'));
  for (const [name, source] of [['Inbox.tsx (partie ajoutée)', inboxAdded], ['ContactPanel.tsx', panel]]) {
    assert.ok(source.length > 200, `${name} : partie lue`);
    assert.ok(!source.includes('—'), `${name} : pas de tiret long`);
    assert.doesNotMatch(source, /\(s\)/, `${name} : accorder par le nombre`);
  }
  // Les textes ajoutés (hors commentaires) ne nomment aucun prestataire.
  const added = [
    "Pour voir vos invitations, reliez d'abord un compte LinkedIn.",
    'La prise de contact est fermée. Réactivez la mission pour gérer ses séquences.',
  ].join(' ');
  assert.doesNotMatch(added, /Unipile|Apollo|PDL|People Data Labs|Anthropic|Claude|Notion/);
});

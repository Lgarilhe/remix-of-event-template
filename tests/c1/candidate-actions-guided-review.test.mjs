import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSync } from 'esbuild';

const bundled = buildSync({ entryPoints: ['src/lib/guidedActionReview.ts'], bundle: true, platform: 'node', format: 'esm', write: false });
const review = await import(`data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`);
const message = (changes = {}) => ({ id: 'reply', kind: 'message', label: 'Réponse au candidat', service: 'outlook', audience: 'candidate', recipient: 'candidate@example.test', senderAddress: 'recruiter@example.test', requiresSubject: true, subject: 'Votre entretien', content: 'Bonjour, voici les précisions demandées.', ...changes });
const acknowledge = (...effects) => Object.fromEntries(effects.map(effect => [effect.id, review.guidedReviewIdentity(effect)]));

test('confirmation requires every current content to have been explicitly reviewed', () => {
  const reply = message();
  const note = { id: 'note', kind: 'document', label: 'Synthèse', destination: 'Fiche candidat', content: 'Une précision reste attendue.' };
  assert.equal(review.guidedReviewCanConfirm([reply, note], {}), false);
  assert.equal(review.guidedReviewCanConfirm([reply, note], acknowledge(reply)), false);
  assert.equal(review.guidedReviewCanConfirm([reply, note], acknowledge(reply, note)), true);
  assert.equal(review.guidedReviewCanConfirm([], {}), false);
  assert.equal(review.guidedReviewCanConfirm([reply, reply], acknowledge(reply)), false);
});

test('changing text, subject, recipient, service, sender or destination invalidates the old review', () => {
  const effect = message();
  for (const change of [{ content: 'Nouveau texte' }, { subject: 'Autre objet' }, { recipient: 'teammate@example.test' }, { service: 'gmail' }, { senderAddress: 'other@example.test' }, { audience: 'team' }, { destination: 'Autre fiche' }]) {
    assert.equal(review.guidedReviewCanConfirm([message(change)], acknowledge(effect)), false, JSON.stringify(change));
  }
});

test('identical visible addresses never preserve a review after the sending account or target changes', () => {
  const effect = message({ identityKey: 'account-a:target-a:chat-a' });
  assert.equal(review.guidedReviewCanConfirm([message({ identityKey: 'account-b:target-a:chat-a' })], acknowledge(effect)), false);
  assert.equal(review.guidedReviewCanConfirm([message({ identityKey: 'account-a:target-b:chat-a' })], acknowledge(effect)), false);
});

test('server trimming preserves the review without ignoring changes inside the text', () => {
  const effect = message({ subject: '  Votre entretien\n', content: '\n Bonjour, voici les précisions demandées.  ' });
  assert.equal(review.guidedReviewCanConfirm([message()], acknowledge(effect)), true);
  assert.equal(review.guidedReviewCanConfirm([message({ content: 'Bonjour, voici les nouvelles précisions demandées.' })], acknowledge(effect)), false);
});

test('step acknowledgement uses the confirmed save result independently of a delayed React cache', () => {
  const original = message({ content: '  Bonjour, voici les précisions demandées.\n' });
  const expected = review.guidedReviewIdentity(original);
  assert.equal(review.guidedReviewSavedAcknowledgement(expected, message()), expected);
  assert.equal(review.guidedReviewSavedAcknowledgement(expected, null), null);
  assert.equal(review.guidedReviewSavedAcknowledgement(expected, message({ content: 'Autre texte.' })), null);
  assert.equal(review.guidedReviewSavedAcknowledgement(expected, message({ senderAddress: 'other@example.test' })), null);
  assert.equal(review.guidedReviewSavedAcknowledgement(expected, message({ content: '   ' })), null);
  // Même après une preuve de sauvegarde, la confirmation globale vérifie les props actuelles.
  const reviewed = { [original.id]: review.guidedReviewSavedAcknowledgement(expected, message()) };
  assert.equal(review.guidedReviewCanConfirm([message({ recipient: 'changed@example.test' })], reviewed), false);
});

test('empty content and required mail subjects block review without banning subjectless channels', () => {
  assert.equal(review.guidedReviewValid(message({ content: '   ' })), false);
  assert.equal(review.guidedReviewValid(message({ subject: '\n' })), false);
  assert.equal(review.guidedReviewValid(message({ requiresSubject: false, subject: undefined, service: 'whatsapp' })), true);
  assert.equal(review.guidedReviewValid({ id: 'comment', kind: 'comment', label: 'Équipe', content: 'Compte rendu.' }), true);
});

test('recap counts candidate and team messages and recorded contents exactly', () => {
  assert.equal(review.guidedReviewSummary([message(), message({ id: 'team', audience: 'team' }), { id: 'note', kind: 'document' }, { id: 'comment', kind: 'comment' }]), '2 messages à envoyer · 2 contenus à enregistrer');
  assert.equal(review.guidedReviewSummary([{ kind: 'document' }]), '1 contenu à enregistrer');
});

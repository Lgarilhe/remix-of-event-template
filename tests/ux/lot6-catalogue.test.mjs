/**
 * Chantier design, lot 6 : catalogue des séquences et table des canaux.
 *
 * Aucun identifiant technique ne s'affiche (D-01, D-56, D-58), un statut a un
 * seul libellé et un seul ton (D-55), un canal a un seul nom (D-66). Les
 * modules purs sont transpilés en mémoire par esbuild (patron de
 * notification-kinds.test.mjs).
 *
 * Lancer : node --test tests/ux/lot6-catalogue.test.mjs
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { transformSync } from 'esbuild';

const read = (rel) => readFileSync(new URL(`../../${rel}`, import.meta.url), 'utf8');

const load = async (rel) => {
  const { code } = transformSync(read(rel), { loader: 'ts', format: 'esm' });
  return import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
};

const catalog = await load('src/lib/sequenceCatalog.ts');
const channels = await load('src/lib/channels.ts');

test('D-01 : chaque type d’étape du moteur d’envoi a un libellé en français', () => {
  // Types écrits par l'éditeur et traités par process-sequences.
  const types = [
    'connection_request', 'message', 'smart_message', 'inmail', 'profile_visit', 'email',
    'whatsapp_message', 'check_connection', 'condition_branch', 'wait_connection',
    'wait_reply', 'wait_profile_visit', 'wait_for_event',
  ];
  for (const type of types) {
    const label = catalog.sequenceActionLabel(type);
    assert.notEqual(label, catalog.UNKNOWN_STEP_LABEL, `${type} sans libellé`);
    assert.doesNotMatch(label, /_/, `${type} affiché brut`);
  }
});

test('D-01 : les anciennes clés « send_* » et une clé inconnue restent lisibles', () => {
  assert.equal(catalog.sequenceActionLabel('send_connection'), 'Invitation LinkedIn');
  assert.equal(catalog.sequenceActionLabel('send_inmail'), 'InMail');
  assert.equal(catalog.sequenceActionLabel('visit_profile'), 'Visite du profil');
  assert.equal(catalog.sequenceActionLabel('nouvelle_action'), 'Étape de séquence');
  assert.equal(catalog.sequenceActionLabel(null), 'Étape de séquence');
});

test('D-55 : un statut, un libellé et un ton de badge connu', () => {
  const tones = new Set(['success', 'warning', 'info', 'danger', 'muted']);
  for (const table of [catalog.ENROLLMENT_STATUSES, catalog.EXECUTION_STATUSES]) {
    for (const [key, meta] of Object.entries(table)) {
      assert.ok(tones.has(meta.tone), `${key} : ton ${meta.tone}`);
      assert.doesNotMatch(meta.label, /_|^[a-z]/, `${key} : libellé « ${meta.label} »`);
    }
  }
  // Les statuts écrits en base par la contrainte des inscriptions.
  for (const status of ['active', 'paused', 'completed', 'replied', 'bounced', 'cancelled', 'stopped']) {
    assert.notEqual(catalog.enrollmentStatusMeta(status).label, 'Statut inconnu', status);
  }
  assert.equal(catalog.enrollmentStatusMeta('inconnu').label, 'Statut inconnu');
});

test('D-56 : les raisons d’arrêt sont traduites, jamais affichées telles qu’enregistrées', () => {
  const cases = {
    'Stoppé depuis Inbox': 'Arrêtée à la main',
    'Reply detected via webhook': 'Le candidat a répondu',
    'Timeout 3d (no reply)': "Délai d'attente dépassé",
    'No phone number — WhatsApp skipped': 'Pas de numéro de téléphone',
    'Email bounced (NDR)': 'E-mail non distribué',
    'Enrollment became paused before send (last-call check)': "Inscription arrêtée avant l'envoi",
    'texte inconnu': 'Étape non exécutée',
  };
  for (const [raw, label] of Object.entries(cases)) {
    assert.equal(catalog.skipReasonLabel(raw), label, raw);
  }
  assert.equal(catalog.skipReasonLabel(null), null);
  assert.equal(catalog.pauseReasonLabel('account_disconnected'), 'Compte LinkedIn déconnecté');
  assert.equal(catalog.pauseReasonLabel('manual'), null);
});

test('D-66 : quatre canaux, un nom chacun, et le canal d’un compte', () => {
  assert.deepEqual(Object.keys(channels.CHANNELS).sort(), ['call', 'email', 'linkedin', 'whatsapp']);
  assert.equal(channels.channelOfAccount('LINKEDIN'), 'linkedin');
  assert.equal(channels.channelOfAccount('WHATSAPP'), 'whatsapp');
  assert.equal(channels.channelOfAccount('GOOGLE_OAUTH'), 'email');
  assert.equal(channels.channelOfAccount(undefined), 'linkedin');
  for (const meta of Object.values(catalog.SEQUENCE_ACTIONS)) {
    assert.ok(meta.channel === null || meta.channel in channels.CHANNELS);
  }
});

test('D-66 : la pastille de canal ne lit pas le nom deux fois', () => {
  const icon = read('src/components/ui/ChannelIcon.tsx');
  assert.match(icon, /alt=\{showLabel \? '' : label\}/);
  assert.doesNotMatch(icon, /text-linkedin|text-whatsapp/, 'le libellé reste en texte neutre');
});

test('D-62 : trois tons de rédaction, en mots entiers', () => {
  assert.deepEqual(
    catalog.MESSAGE_TONES.map((t) => t.label),
    ['Professionnel', 'Décontracté', 'Enthousiaste'],
  );
});

// Règles pures du moteur de séquences (audit 2026-09-25, lot E1a).
//
//   deno test --no-check supabase/functions/_shared/sequence-engine-rules.test.ts

import { deepStrictEqual, strictEqual } from 'node:assert';
import {
  decidePostSendRecheck, hasAlreadySentStep, isEmailSentButNotRecorded, isMissingRequiredText,
  isNudgeable, isUncertainSendError, localDayEnd, missionJobIds, resolveStepContent,
  shouldCloseForNoPreviousMessage, EMAIL_CHANNEL_SKIP_REASON, LEGACY_EMAIL_CHANNEL_SKIP_REASON,
  MANUAL_SKIP_REASON, NUDGE_ACTION_TYPES,
} from './sequence-engine-rules.ts';

// ─── SEQ-001
Deno.test('fin de journée : minuit suivant dans le fuseau de l\'inscription', () => {
  // 2026-09-25 10:00 UTC = 12:00 à Paris (UTC+2) → fin 2026-09-26 00:00 Paris = 2026-09-25 22:00 UTC
  strictEqual(localDayEnd(new Date('2026-09-25T10:00:00Z'), 'Europe/Paris').toISOString(), '2026-09-25T22:00:00.000Z');
  // 23:30 UTC = 01:30 le 26 à Paris → fin 2026-09-27 00:00 Paris
  strictEqual(localDayEnd(new Date('2026-09-25T23:30:00Z'), 'Europe/Paris').toISOString(), '2026-09-26T22:00:00.000Z');
  // New York (UTC-4 en septembre)
  strictEqual(localDayEnd(new Date('2026-09-25T10:00:00Z'), 'America/New_York').toISOString(), '2026-09-26T04:00:00.000Z');
  // Fuseau invalide ou absent : Europe/Paris
  strictEqual(localDayEnd(new Date('2026-09-25T10:00:00Z'), 'Pas/UnFuseau').toISOString(), '2026-09-25T22:00:00.000Z');
  strictEqual(localDayEnd(new Date('2026-09-25T10:00:00Z'), null).toISOString(), '2026-09-25T22:00:00.000Z');
});

Deno.test('avance : aujourd\'hui plus tard oui, J+3 non, déjà échue non', () => {
  const now = new Date('2026-09-25T10:00:00Z');
  strictEqual(isNudgeable('2026-09-25T14:00:00Z', now, 'Europe/Paris'), true);
  strictEqual(isNudgeable('2026-09-28T08:00:00Z', now, 'Europe/Paris'), false);
  strictEqual(isNudgeable('2026-09-25T22:30:00Z', now, 'Europe/Paris'), false, 'lendemain 00:30 à Paris');
  strictEqual(isNudgeable('2026-09-25T09:00:00Z', now, 'Europe/Paris'), false, 'déjà échue : prise au cycle suivant');
  strictEqual(isNudgeable(null, now, 'Europe/Paris'), false);
});

Deno.test('avance : jamais les invitations, attentes, conditions ni visites', () => {
  for (const t of ['connection_request', 'wait_reply', 'wait_connection', 'wait_profile_visit', 'condition_branch', 'check_connection', 'profile_visit']) {
    strictEqual(NUDGE_ACTION_TYPES.includes(t), false, t);
  }
});

// ─── SEQ-003
Deno.test('envoi réussi puis pause : envoyé, jamais annulé', () => {
  deepStrictEqual(decidePostSendRecheck('active', 'message'), { kind: 'proceed' });
  deepStrictEqual(decidePostSendRecheck(null, 'message'), { kind: 'proceed' });
  deepStrictEqual(decidePostSendRecheck('paused', 'inmail'), {
    kind: 'record_sent_and_stop', skipReason: "Inscription devenue paused pendant l'envoi", writeExecution: true,
  });
  const email = decidePostSendRecheck('replied', 'email');
  strictEqual(email.kind, 'record_sent_and_stop');
  strictEqual(email.kind === 'record_sent_and_stop' && email.writeExecution, false, 'e-mail : statut déjà écrit par sequence-send-email');
});

// ─── SEQ-004
Deno.test('filet d\'envoi : étape déjà partie, y compris ligne héritée de BUG-095', () => {
  strictEqual(hasAlreadySentStep([{ status: 'sent' }]), true);
  strictEqual(hasAlreadySentStep([{ status: 'opened' }]), true);
  strictEqual(hasAlreadySentStep([{ status: 'cancelled', skip_reason: 'Enrollment became paused during execution' }]), true);
  strictEqual(hasAlreadySentStep([{ status: 'cancelled', skip_reason: 'Enrollment became paused before send (last-call check)' }]), false);
  strictEqual(hasAlreadySentStep([{ status: 'cancelled', skip_reason: 'Arrêt manuel' }, { status: 'failed' }]), false);
});

// ─── SEQ-005
Deno.test('envoi incertain : 5xx du POST d\'envoi, jamais relancé', () => {
  strictEqual(isUncertainSendError('linkedin_send_failed_504: Gateway Timeout', 'message'), true);
  strictEqual(isUncertainSendError('whatsapp_send_failed_502', 'whatsapp_message'), true);
  strictEqual(isUncertainSendError('Invite 500: boom', 'connection_request'), true);
  strictEqual(isUncertainSendError('send_uncertain: timeout', 'inmail'), true);
  // Antérieures à l'envoi : relancées
  strictEqual(isUncertainSendError('linkedin_send_failed_429: too many', 'message'), false);
  strictEqual(isUncertainSendError('InMail balance check failed (HTTP 503) — reschedule', 'inmail'), false);
  strictEqual(isUncertainSendError('Profile visit 502: x', 'profile_visit'), false);
  // E-mail : filet propre
  strictEqual(isUncertainSendError('sequence-send-email 500: x', 'email'), false);
  strictEqual(isEmailSentButNotRecorded('sequence-send-email 500: {"error":"Email sent but failed to update execution status"}'), true);
  strictEqual(isEmailSentButNotRecorded('status_update_failed'), true);
  strictEqual(isEmailSentButNotRecorded('sequence-send-email 500: provider down'), false);
});

// ─── SEQ-029
Deno.test('garde « pas de message précédent » : un saut de canal, de condition ou manuel ne clôt pas', () => {
  strictEqual(shouldCloseForNoPreviousMessage([]), false);
  strictEqual(shouldCloseForNoPreviousMessage([{ status: 'skipped', skip_reason: 'Condition: if_connected' }]), false);
  strictEqual(shouldCloseForNoPreviousMessage([{ status: 'skipped', skip_reason: EMAIL_CHANNEL_SKIP_REASON }]), false);
  strictEqual(shouldCloseForNoPreviousMessage([{ status: 'skipped', skip_reason: LEGACY_EMAIL_CHANNEL_SKIP_REASON }]), false);
  strictEqual(shouldCloseForNoPreviousMessage([{ status: 'skipped', skip_reason: MANUAL_SKIP_REASON }]), false);
  // Bloquants
  strictEqual(shouldCloseForNoPreviousMessage([{ status: 'failed' }]), true);
  strictEqual(shouldCloseForNoPreviousMessage([{ status: 'cancelled', skip_reason: 'Annulé manuellement' }]), true);
  strictEqual(shouldCloseForNoPreviousMessage([{ status: 'skipped', skip_reason: 'Adresse en liste de suppression (opt-out)' }]), true);
  // Un message parti suffit
  strictEqual(shouldCloseForNoPreviousMessage([{ status: 'failed' }, { status: 'sent' }]), false);
  strictEqual(shouldCloseForNoPreviousMessage([{ status: 'cancelled', skip_reason: 'Enrollment became replied during execution' }]), false);
});

// ─── SEQ-020
Deno.test('contenu : l\'édition du Journal l\'emporte sur l\'aperçu, champ par champ', () => {
  const override = { message: 'Aperçu validé', subject: 'Objet aperçu' };
  deepStrictEqual(
    resolveStepContent({ finalMessage: 'Texte corrigé', finalSubject: null, override, messageTemplate: 'Modèle', subjectTemplate: 'Objet modèle' }),
    { message: 'Texte corrigé', subject: 'Objet aperçu', editedMessage: true, editedSubject: false, usedOverride: true },
  );
  deepStrictEqual(
    resolveStepContent({ finalMessage: null, finalSubject: null, override, messageTemplate: 'Modèle', subjectTemplate: '' }),
    { message: 'Aperçu validé', subject: 'Objet aperçu', editedMessage: false, editedSubject: false, usedOverride: true },
  );
  deepStrictEqual(
    resolveStepContent({ finalMessage: '  ', finalSubject: undefined, override: null, messageTemplate: 'Modèle', subjectTemplate: null }),
    { message: 'Modèle', subject: '', editedMessage: false, editedSubject: false, usedOverride: false },
  );
});

// ─── SEQ-035
Deno.test('texte vide : refusé pour message, InMail, WhatsApp, pas pour une invitation', () => {
  strictEqual(isMissingRequiredText('message', ''), true);
  strictEqual(isMissingRequiredText('inmail', '   '), true);
  strictEqual(isMissingRequiredText('smart_message', null), true);
  strictEqual(isMissingRequiredText('whatsapp_message', undefined), true);
  strictEqual(isMissingRequiredText('connection_request', ''), false);
  strictEqual(isMissingRequiredText('message', 'Bonjour'), false);
});

// ─── SEQ-006
Deno.test('mission : les deux formes d\'identifiant', () => {
  deepStrictEqual(missionJobIds('abc'), ['abc', 'project:abc']);
  deepStrictEqual(missionJobIds('project:abc'), ['abc', 'project:abc']);
  strictEqual(missionJobIds(null), null);
  strictEqual(missionJobIds(''), null);
});

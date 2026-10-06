// Modèles de séquence (lot 5c-2) : les modèles Konekt, livrés dans le code et
// non en base, et la lecture d'un modèle de l'organisation
// (sequence_templates.steps_config) en séquence prête pour l'éditeur.
//
// Un modèle ne part jamais tel quel : « Utiliser ce modèle » ouvre l'éditeur,
// rien n'est enregistré avant « Enregistrer ». Les textes n'emploient que des
// variables connues du moteur ({{prenom}}, {{poste_recherche}},
// {{mon_prenom}}), retirées proprement quand elles sont vides.
//
// Module pur (types seulement depuis src/types), testé sous Node.

import type { Sequence, SequenceStep } from '../types/sequence';
import { renumberByOrderGroup, templateStepOrders } from '../components/outreach/sequence/sequenceGraph.ts';

export interface StarterTemplate {
  key: string;
  name: string;
  /** Une phrase : le déroulé, sans jargon. */
  description: string;
  /** Étapes neuves (identifiants tirés à chaque appel). */
  build: () => SequenceStep[];
}

type StepOverrides = Partial<SequenceStep>;

const mkStep = (order: number, actionType: SequenceStep['actionType'], overrides: StepOverrides = {}): SequenceStep => ({
  id: crypto.randomUUID(),
  order,
  actionType,
  conditionType: 'always',
  delayDays: 0,
  delayHours: 0,
  delayMinutes: 0,
  preferredHourStart: 9,
  preferredHourEnd: 18,
  useAiPersonalization: actionType === 'smart_message',
  aiTone: 'professional',
  timeoutDays: 3,
  timeoutAction: 'skip',
  ...overrides,
});

const INVITE_NOTE = 'Bonjour {{prenom}}, je recrute pour un poste de {{poste_recherche}} et votre parcours m’a donné envie d’échanger avec vous. Belle journée, {{mon_prenom}}';
const MESSAGE_AFTER_ACCEPT = 'Merci d’avoir accepté mon invitation, {{prenom}}.\n\nJe vous contacte au sujet d’un poste de {{poste_recherche}} qui pourrait correspondre à votre parcours. Seriez-vous disponible pour un court échange cette semaine ?\n\n{{mon_prenom}}';
const MESSAGE_CONNECTED = 'Bonjour {{prenom}},\n\nJe recrute pour un poste de {{poste_recherche}} et votre parcours a retenu mon attention. Seriez-vous disponible pour un court échange cette semaine ?\n\n{{mon_prenom}}';
const MESSAGE_FOLLOW_UP = 'Bonjour {{prenom}}, je reviens vers vous au sujet du poste de {{poste_recherche}}. Un échange de 15 minutes vous conviendrait-il ?\n\n{{mon_prenom}}';
const INMAIL_SUBJECT = 'Poste de {{poste_recherche}}';
const INMAIL_MESSAGE = 'Bonjour {{prenom}},\n\nJe recrute pour un poste de {{poste_recherche}} et votre parcours correspond à ce que nous recherchons. Seriez-vous disponible pour en parler ?\n\n{{mon_prenom}}';

const waitConnection = (order: number, overrides: StepOverrides = {}) =>
  mkStep(order, 'wait_connection', { waitForEvent: 'connection_accepted', timeoutDays: 10, ...overrides });

/** Invitation, attente de 10 jours, puis message si l'invitation est acceptée. */
function invitationThenMessage(): SequenceStep[] {
  const visit = mkStep(0, 'profile_visit');
  const invite = mkStep(1, 'connection_request', { delayDays: 1, messageTemplate: INVITE_NOTE });
  const wait = waitConnection(2);
  const message = mkStep(3, 'message', { conditionType: 'if_connected', messageTemplate: MESSAGE_AFTER_ACCEPT });
  return [visit, invite, wait, message];
}

/** Message si le candidat est déjà en relation, sinon invitation avec note. */
function checkConnectionFirst(): SequenceStep[] {
  const visit = mkStep(0, 'profile_visit');
  const check = mkStep(1, 'check_connection', { delayDays: 1 });
  const message = mkStep(2, 'message', { messageTemplate: MESSAGE_CONNECTED, nextStepId: '__end__' });
  const invite = mkStep(3, 'connection_request', { messageTemplate: INVITE_NOTE });
  const wait = waitConnection(4);
  check.ifTrueGotoStep = message.id;
  check.ifFalseGotoStep = invite.id;
  invite.nextStepId = wait.id;
  return [visit, check, message, invite, wait];
}

/** Invitation, message après acceptation, relance 4 jours plus tard. */
function invitationMessageFollowUp(): SequenceStep[] {
  const invite = mkStep(0, 'connection_request', { messageTemplate: INVITE_NOTE });
  const wait = waitConnection(1);
  const message = mkStep(2, 'message', { conditionType: 'if_connected', messageTemplate: MESSAGE_AFTER_ACCEPT });
  const followUp = mkStep(3, 'message', { conditionType: 'if_connected', delayDays: 4, messageTemplate: MESSAGE_FOLLOW_UP });
  return [invite, wait, message, followUp];
}

/** Invitation ; acceptée, un message ; pas acceptée après 10 jours, un InMail. */
function inmailIfNotAccepted(): SequenceStep[] {
  const invite = mkStep(0, 'connection_request', { messageTemplate: INVITE_NOTE });
  const wait = waitConnection(1, { timeoutAction: 'alternative_step' });
  const message = mkStep(2, 'message', { messageTemplate: MESSAGE_AFTER_ACCEPT, nextStepId: '__end__' });
  const inmail = mkStep(3, 'inmail', { subjectTemplate: INMAIL_SUBJECT, messageTemplate: INMAIL_MESSAGE });
  wait.nextStepId = message.id;
  wait.timeoutBranchStepId = inmail.id;
  return [invite, wait, message, inmail];
}

/**
 * Séquence longue (17 étapes), l'ancienne « séquence recommandée » de
 * l'éditeur : visite, vérification de la relation, puis deux branches de
 * messages rédigés par l'IA et de relances, avec un InMail si l'invitation
 * n'est pas acceptée. Chaque message rédigé par l'IA se relit avant
 * l'inscription (lot 5a-2).
 */
export function generateRecommendedSequence(): SequenceStep[] {
  const profileVisit = mkStep(0, 'profile_visit');
  const checkConnection = mkStep(1, 'check_connection', { delayMinutes: 2 });
  const t1_message = mkStep(2, 'smart_message');
  const t2_waitReply = mkStep(3, 'wait_connection', { actionType: 'wait_reply', waitForEvent: 'reply_received', timeoutDays: 3, timeoutAction: 'skip' });
  const t3_relance1 = mkStep(4, 'smart_message');
  const t4_waitReply2 = mkStep(5, 'wait_reply', { waitForEvent: 'reply_received', timeoutDays: 4, timeoutAction: 'skip' });
  const t5_relance2 = mkStep(6, 'smart_message');

  t1_message.nextStepId = t2_waitReply.id;
  t2_waitReply.nextStepId = t3_relance1.id;
  t3_relance1.nextStepId = t4_waitReply2.id;
  t4_waitReply2.nextStepId = t5_relance2.id;

  const f1_invite = mkStep(7, 'connection_request');
  const f2_waitConnection = mkStep(8, 'wait_connection', { waitForEvent: 'connection_accepted', timeoutDays: 3, timeoutAction: 'skip' });
  const f3_message = mkStep(9, 'smart_message');
  const f4_waitReply = mkStep(10, 'wait_reply', { waitForEvent: 'reply_received', timeoutDays: 3, timeoutAction: 'skip' });
  const f5_relance1 = mkStep(11, 'smart_message');
  const f6_waitReply2 = mkStep(12, 'wait_reply', { waitForEvent: 'reply_received', timeoutDays: 4, timeoutAction: 'skip' });
  const f7_relance2 = mkStep(13, 'smart_message');
  const f8_inmail = mkStep(14, 'inmail', { useAiPersonalization: true });
  const f9_waitReply = mkStep(15, 'wait_reply', { waitForEvent: 'reply_received', timeoutDays: 5, timeoutAction: 'skip' });
  const f10_inmailRelance = mkStep(16, 'inmail', { useAiPersonalization: true });

  f1_invite.nextStepId = f2_waitConnection.id;
  f2_waitConnection.nextStepId = f3_message.id;
  f3_message.nextStepId = f4_waitReply.id;
  f4_waitReply.nextStepId = f5_relance1.id;
  f5_relance1.nextStepId = f6_waitReply2.id;
  f6_waitReply2.nextStepId = f7_relance2.id;
  f2_waitConnection.timeoutAction = 'alternative_step';
  f2_waitConnection.timeoutBranchStepId = f8_inmail.id;
  f8_inmail.nextStepId = f9_waitReply.id;
  f9_waitReply.nextStepId = f10_inmailRelance.id;

  checkConnection.ifTrueGotoStep = t1_message.id;
  checkConnection.ifFalseGotoStep = f1_invite.id;

  return [
    profileVisit, checkConnection,
    t1_message, t2_waitReply, t3_relance1, t4_waitReply2, t5_relance2,
    f1_invite, f2_waitConnection,
    f3_message, f4_waitReply, f5_relance1, f6_waitReply2, f7_relance2,
    f8_inmail, f9_waitReply, f10_inmailRelance,
  ];
}

/** Modèles Konekt, dans l'ordre d'affichage (spécification des séquences, 3.1-B). */
export const STARTER_TEMPLATES: readonly StarterTemplate[] = [
  {
    key: 'invitation-message',
    name: 'Invitation puis message',
    description: 'Visite du profil, invitation avec note, puis un message si l’invitation est acceptée dans les 10 jours.',
    build: invitationThenMessage,
  },
  {
    key: 'verifier-connexion',
    name: 'Vérifier la connexion d’abord',
    description: 'Un message si le candidat est déjà en relation avec vous, sinon une invitation avec note.',
    build: checkConnectionFirst,
  },
  {
    key: 'invitation-message-relance',
    name: 'Invitation, message, relance',
    description: 'Invitation avec note, message après l’acceptation, puis une relance 4 jours plus tard.',
    build: invitationMessageFollowUp,
  },
  {
    key: 'inmail-si-refus',
    name: 'InMail si l’invitation n’est pas acceptée',
    description: 'Invitation avec note : un message si elle est acceptée, un InMail si elle ne l’est pas après 10 jours.',
    build: inmailIfNotAccepted,
  },
  {
    key: 'sequence-longue',
    name: 'Séquence longue (17 étapes)',
    description: 'Vérification de la relation, messages rédigés par l’IA et relances sur chaque branche, InMail si l’invitation n’est pas acceptée.',
    build: generateRecommendedSequence,
  },
];

/** Séquence prête pour l'éditeur à partir d'un modèle Konekt. Nom repris du modèle, à changer avant d'enregistrer. */
export function starterTemplateToSequence(template: StarterTemplate): Sequence {
  return { name: template.name, description: template.description, steps: template.build(), isActive: true };
}

/** Modèle de l'organisation (ligne sequence_templates). */
export interface TemplateRow {
  id: string;
  name: string;
  description: string | null;
  steps_config: ReadonlyArray<Record<string, unknown>> | null;
  category: string | null;
  is_system: boolean;
  created_at: string;
}

const str = (s: Record<string, unknown>, ...keys: string[]): string | undefined => {
  for (const key of keys) {
    const value = s[key];
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
};
const num = (s: Record<string, unknown>, ...keys: string[]): number | undefined => {
  for (const key of keys) {
    const value = s[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return undefined;
};
const bool = (s: Record<string, unknown>, ...keys: string[]): boolean | undefined => {
  for (const key of keys) {
    const value = s[key];
    if (typeof value === 'boolean') return value;
  }
  return undefined;
};
const strList = (s: Record<string, unknown>, ...keys: string[]): string[] | undefined => {
  for (const key of keys) {
    const value = s[key];
    if (Array.isArray(value)) return value.filter((v): v is string => typeof v === 'string');
  }
  return undefined;
};

/**
 * Même lecture que le choix de modèle de l'éditeur actuel
 * (SequenceTemplateSelector, retiré au lot 5j) : chaque étape reçoit un nouvel
 * identifiant et les renvois de branchement (étape suivante, branches,
 * repli) sont traduits vers ces identifiants ; un renvoi inconnu est retiré.
 * L'ordre enregistré (commun aux variantes A/B) est gardé, celui d'un ancien
 * modèle est relu par position.
 */
export function templateRowToSequence(template: TemplateRow): Sequence {
  const configs = template.steps_config ?? [];
  const idMap = new Map<string, string>();
  for (const s of configs) {
    const oldId = s.id;
    if (typeof oldId === 'string' || typeof oldId === 'number') idMap.set(String(oldId), crypto.randomUUID());
  }
  const remap = (ref: string | undefined): string | undefined => {
    if (!ref) return undefined;
    if (ref === '__end__') return '__end__';
    return idMap.get(ref);
  };

  const orders = templateStepOrders(configs);
  const steps: SequenceStep[] = configs.map((s, idx) => {
    const oldId = typeof s.id === 'string' || typeof s.id === 'number' ? String(s.id) : undefined;
    const timeoutTarget = remap(str(s, 'timeout_branch_step_id', 'timeoutBranchStepId'));
    return {
      id: (oldId && idMap.get(oldId)) || crypto.randomUUID(),
      order: orders[idx],
      actionType: (str(s, 'action_type', 'actionType') ?? 'message') as SequenceStep['actionType'],
      conditionType: (str(s, 'condition_type', 'conditionType') ?? 'always') as SequenceStep['conditionType'],
      conditionValue: str(s, 'condition_value', 'conditionValue'),
      delayDays: num(s, 'delay_days', 'delayDays') ?? (idx === 0 ? 0 : 2),
      delayHours: num(s, 'delay_hours', 'delayHours') ?? 0,
      delayMinutes: num(s, 'delay_minutes', 'delayMinutes') ?? 0,
      preferredHourStart: num(s, 'preferred_hour_start', 'preferredHourStart') ?? 9,
      preferredHourEnd: num(s, 'preferred_hour_end', 'preferredHourEnd') ?? 18,
      subjectTemplate: str(s, 'subject_template', 'subjectTemplate') ?? '',
      messageTemplate: str(s, 'message_template', 'messageTemplate') ?? '',
      useAiPersonalization: bool(s, 'use_ai_personalization', 'useAiPersonalization') ?? false,
      aiTone: (str(s, 'ai_tone', 'aiTone') ?? 'professional') as SequenceStep['aiTone'],
      timeoutDays: num(s, 'timeout_days', 'timeoutDays') ?? 3,
      waitForEvent: str(s, 'wait_for_event', 'waitForEvent') as SequenceStep['waitForEvent'],
      // Seule l'étape de repli est enregistrée : c'est elle qui dit ce que fera le moteur.
      timeoutAction: timeoutTarget ? 'alternative_step' : 'skip',
      ifTrueGotoStep: remap(str(s, 'if_true_goto_step', 'ifTrueGotoStep')),
      ifFalseGotoStep: remap(str(s, 'if_false_goto_step', 'ifFalseGotoStep')),
      nextStepId: s.ends_sequence === true ? '__end__' : remap(str(s, 'next_step_id', 'nextStepId')),
      timeoutBranchStepId: timeoutTarget,
      variantGroup: str(s, 'variant_group', 'variantGroup'),
      variantWeight: num(s, 'variant_weight', 'variantWeight'),
      ccEmails: strList(s, 'cc_emails', 'ccEmails'),
      bccEmails: strList(s, 'bcc_emails', 'bccEmails'),
      includeUnsubscribe: bool(s, 'include_unsubscribe', 'includeUnsubscribe'),
      signatureId: str(s, 'signature_id', 'signatureId'),
    };
  });

  return {
    name: template.name,
    description: template.description || undefined,
    steps: renumberByOrderGroup(steps),
    isActive: true,
  };
}

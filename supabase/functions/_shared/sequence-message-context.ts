/**
 * Compute sequence message context — shared between :
 *  - process-sequences (cron qui envoie les messages réels)
 *  - generate-outreach-message (preview dans le modal d'enrollment)
 *
 * Source unique de vérité pour le typage des messages d'une séquence
 * (PREMIER MESSAGE / RELANCE 1 / RELANCE 2 / INMAIL DE RELANCE / etc.)
 * et leurs instructions de ton respectives.
 *
 * Pourquoi : avant cette refonte, le cron avait sa logique sophistiquée
 * (référence le précédent message, ton plus direct, etc.) tandis que
 * la preview appelait juste generate-outreach-message sans contexte
 * → toutes les "relances" du modal preview ressemblaient à des premiers
 * messages, ce qui mentait à l'utilisateur sur ce qu'allait vraiment
 * envoyer le cron.
 */

export type StepActionType =
  | 'message'
  | 'inmail'
  | 'smart_message'
  | 'email'
  | 'connection_request'
  | 'whatsapp_message'
  | 'profile_visit'
  | 'wait_connection'
  | 'wait_reply'
  | 'wait_profile_visit'
  | 'check_connection'
  | 'condition_branch'
  | string;

export interface PrevSentStep {
  /** action_type du step précédent (message / inmail / connection_request / ...) */
  actionType: StepActionType;
  /** Texte final du message envoyé (utile pour donner du contexte au LLM). */
  finalMessage?: string | null;
  /** step_order pour reconstituer l'ordre. */
  stepOrder?: number;
}

export interface MessageTypeContext {
  /** Label sémantique du message à générer (PREMIER MESSAGE, RELANCE 1, etc.). */
  msgType: string;
  /** Instructions de ton à injecter dans le system prompt du LLM. */
  toneInstructions: string;
  /** Bloc texte des messages précédents (pour mémoire conversationnelle). */
  previousMessagesBlock: string;
  /** Vrai si c'est le tout 1er reach-out (rien envoyé avant). */
  isFirstReach: boolean;
}

/**
 * Calcule le type de message + les instructions de ton selon :
 *  - le type d'action du step courant (invitation / message / inmail / ...)
 *  - les steps précédemment exécutés (pour distinguer 1er msg / relance / etc.)
 */
export function computeMessageTypeContext(
  currentActionType: StepActionType,
  prevSentSteps: PrevSentStep[],
): MessageTypeContext {
  const isInvite = currentActionType === 'connection_request';
  const isInMail = currentActionType === 'inmail' || currentActionType === 'smart_message';

  const hadInvite = prevSentSteps.some(p => p.actionType === 'connection_request');
  const prevMessages = prevSentSteps.filter(p =>
    ['message', 'inmail', 'smart_message', 'email', 'whatsapp_message'].includes(p.actionType)
  );
  const prevInMails = prevMessages.filter(p =>
    ['inmail', 'smart_message'].includes(p.actionType)
  );
  const prevDirectMsgs = prevMessages.filter(p => p.actionType === 'message');
  const hadMsg = prevMessages.length > 0;
  const isFirstReach = prevSentSteps.length === 0;

  let msgType: string;
  let toneInstructions: string;

  if (isInvite) {
    msgType = 'INVITATION';
    toneInstructions = "Note d'invitation courte. MAX 50 caractères.";
  } else if (isInMail) {
    if (prevInMails.length === 0) {
      msgType = 'INMAIL INITIAL';
      toneInstructions = `TON FORMEL ET DIRECT. C'est un InMail (le candidat n'est pas connecté).
- Objet obligatoire, < 40 caractères, mobile-first
- Proposition de valeur claire et concise
- CTA non-engageant: demande d'avis, PAS de proposition de call/rdv
- 200-400 caractères pour le corps`;
    } else {
      msgType = 'INMAIL DE RELANCE';
      toneInstructions = `C'est une RELANCE. Le candidat a déjà reçu un premier InMail.
- Tu PEUX et DOIS faire référence au fait que tu as déjà contacté le candidat (ex: "Suite à mon précédent message", "Je reviens vers toi", "Je me permets de te relancer")
- Propose un angle complémentaire ou renforce le pitch initial
- Objet < 40 caractères, peut référencer le premier message
- Ton un peu plus direct/familier que le premier InMail
- 200-400 caractères pour le corps`;
    }
  } else {
    if (!hadMsg && !hadInvite) {
      msgType = 'PREMIER MESSAGE';
      toneInstructions = `PREMIER CONTACT. Accroche personnalisée + pitch concis + CTA non-engageant.
- Cherche un hook dans les posts LinkedIn récents ou le "À propos"
- 200-400 caractères`;
    } else if (!hadMsg && hadInvite) {
      msgType = 'SUITE INVITATION';
      toneInstructions = `PREMIER MESSAGE après acceptation de connexion.
- Bref remerciement (1 phrase) puis pitch direct
- NE DIS PAS "je reviens vers vous"
- 200-400 caractères`;
    } else if (prevDirectMsgs.length === 1) {
      msgType = 'RELANCE 1';
      toneInstructions = `PREMIÈRE RELANCE. Tu PEUX référencer ton précédent message.
- Apporte un angle complémentaire ou renforce le pitch
- Ton plus direct, familier
- 200-350 caractères`;
    } else {
      msgType = 'RELANCE 2';
      toneInstructions = `DEUXIÈME RELANCE. Tu PEUX référencer tes précédents messages.
- Ton direct, un peu plus insistant mais jamais agressif
- Propose un dernier angle ou un CTA concret (appel, café, etc.)
- 200-350 caractères`;
    }
  }

  // Bloc texte des messages précédents (pour mémoire conversationnelle).
  const previousMessagesBlock = prevMessages.length > 0
    ? prevMessages
        .map((p, i) => `MESSAGE ${i + 1} (${p.actionType}): "${(p.finalMessage || '').slice(0, 200)}"`)
        .join('\n')
    : '';

  return { msgType, toneInstructions, previousMessagesBlock, isFirstReach };
}

/**
 * Helper pour construire prevSentSteps depuis la liste complète des steps
 * d'une séquence + le step courant (cas du PREVIEW : on n'a pas vraiment
 * "envoyé" les messages, on simule juste).
 *
 * Pour le PREVIEW, on considère que TOUS les steps d'order < currentStepOrder
 * et qui sont des actions de type "reach" (message/invite/inmail/...)
 * comme déjà envoyés, peu importe leur réelle exécution.
 */
export function simulatePrevSentStepsForPreview(
  allSteps: Array<{ stepOrder: number; actionType: StepActionType; finalMessage?: string | null }>,
  currentStepOrder: number,
): PrevSentStep[] {
  return allSteps
    .filter(s =>
      s.stepOrder < currentStepOrder &&
      ['message', 'inmail', 'smart_message', 'email', 'connection_request', 'whatsapp_message'].includes(s.actionType)
    )
    .sort((a, b) => a.stepOrder - b.stepOrder)
    .map(s => ({ actionType: s.actionType, finalMessage: s.finalMessage || null, stepOrder: s.stepOrder }));
}

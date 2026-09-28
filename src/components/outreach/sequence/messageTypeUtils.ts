// Imports lisibles par Node tel quel (type seul, extension explicite) : ce
// fichier est testé directement par tests/ux/seq-audit-f1b.test.mjs.
import type { SequenceStep } from '../SequenceBuilder';
import { connectionContextOf, previousStepsOf, type ConnectionContext } from './sequenceGraph.ts';

export interface MessageTypeInfo {
  label: string;
  shortLabel: string;
  color: string; // tailwind classes
}

const DIRECT_COLOR = 'bg-brand-purple/10 text-brand-purple';
const INMAIL_COLOR = 'bg-info/10 text-info';

/**
 * Type de message annoncé pour une étape, aligné sur la rédaction du moteur
 * (process-sequences, generatePersonalizedMessage) :
 * - invitation avec ou sans note selon le texte saisi (le moteur envoie la note) ;
 * - InMail ou message direct selon la relation avec le candidat, quand le
 *   parcours la garantit (branche de la vérification, invitation acceptée,
 *   délai de l'attente dépassé). Sans garantie, un Message IA est annoncé
 *   « InMail si non connecté » ;
 * - position (premier message, suite d'invitation, relance) comptée sur les
 *   étapes réellement jouées avant elle, y compris en mode Liste.
 */
export function getStepMessageType(
  step: SequenceStep,
  allSteps: SequenceStep[]
): MessageTypeInfo | null {
  // Only message-type steps get a label
  if (!['message', 'smart_message', 'inmail', 'connection_request', 'whatsapp_message'].includes(step.actionType)) {
    return null;
  }

  if (step.actionType === 'connection_request') {
    return step.messageTemplate?.trim()
      ? { label: 'Invitation avec note', shortLabel: 'Avec note', color: 'bg-success/10 text-success' }
      : { label: 'Invitation sans note', shortLabel: 'Sans note', color: 'bg-success/10 text-success' };
  }

  const previousSteps = previousStepsOf(step, allSteps);

  if (step.actionType === 'whatsapp_message') {
    const prevWhatsApp = previousSteps.filter(s => s.actionType === 'whatsapp_message');
    if (prevWhatsApp.length === 0) {
      return { label: 'WhatsApp initial', shortLabel: 'WhatsApp', color: 'bg-green-500/10 text-green-500' };
    }
    return { label: 'WhatsApp relance', shortLabel: 'WA relance', color: 'bg-green-500/10 text-green-500' };
  }

  const context: ConnectionContext = step.actionType === 'message' ? 'connected' : connectionContextOf(step, allSteps);
  const prevInMails = previousSteps.filter(s => ['inmail', 'smart_message'].includes(s.actionType));
  const prevDirectMsgs = previousSteps.filter(s => ['message', 'smart_message'].includes(s.actionType));
  const hadInvite = previousSteps.some(s => s.actionType === 'connection_request');

  const inmailType = (): MessageTypeInfo => (prevInMails.length === 0
    ? { label: 'InMail initial (formel)', shortLabel: 'InMail initial', color: INMAIL_COLOR }
    : { label: 'InMail de relance', shortLabel: 'InMail relance', color: INMAIL_COLOR });

  const directType = (): MessageTypeInfo => {
    if (prevDirectMsgs.length === 0 && !hadInvite) {
      return { label: 'Premier message (accroche)', shortLabel: '1er message', color: DIRECT_COLOR };
    }
    if (prevDirectMsgs.length === 0) {
      return { label: 'Suite invitation (merci + pitch)', shortLabel: 'Post-connexion', color: DIRECT_COLOR };
    }
    if (prevDirectMsgs.length === 1) {
      return { label: 'Relance 1', shortLabel: 'Relance 1', color: 'bg-warning/10 text-warning' };
    }
    return { label: 'Relance 2', shortLabel: 'Relance 2', color: 'bg-destructive/10 text-destructive' };
  };

  if (context === 'connected') return directType();
  if (context === 'not_connected' || step.actionType === 'inmail') return inmailType();

  // Message IA sans relation garantie : message direct ou InMail à l'envoi.
  const direct = directType();
  return { ...direct, label: `${direct.label}, InMail si non connecté` };
}

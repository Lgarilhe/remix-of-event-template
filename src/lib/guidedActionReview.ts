import type { MessagingService } from '@/lib/messagingServices';

/** Une vue commune aux propositions réelles et à leur aperçu. */
export interface GuidedReviewEffect {
  id: string;
  kind: 'message' | 'document' | 'comment';
  label: string;
  content: string;
  subject?: string;
  requiresSubject?: boolean;
  service?: MessagingService;
  audience?: 'candidate' | 'team';
  recipient?: string;
  senderAddress?: string;
  destination?: string;
  statusLabel?: string;
  editable?: boolean;
  /** Identité des cibles et des comptes, conservée sans l'afficher. */
  identityKey?: string;
}

export type GuidedReviewAcknowledgements = Record<string, string>;

/** La relecture porte sur le texte ET sur sa destination, jamais sur le seul id. */
export function guidedReviewIdentity(effect: GuidedReviewEffect): string {
  return JSON.stringify([
    effect.id, effect.kind, effect.label, effect.content.trim(), effect.subject?.trim() ?? '',
    !!effect.requiresSubject, effect.service ?? '', effect.audience ?? '',
    effect.recipient ?? '', effect.senderAddress ?? '', effect.destination ?? '',
    effect.identityKey ?? '',
  ]);
}

export function guidedReviewValid(effect: GuidedReviewEffect): boolean {
  return !!effect.content.trim() && (!effect.requiresSubject || !!effect.subject?.trim());
}

export function guidedReviewAcknowledged(effect: GuidedReviewEffect, reviewed: GuidedReviewAcknowledgements): boolean {
  return reviewed[effect.id] === guidedReviewIdentity(effect);
}

/** La preuve de sauvegarde vient du résultat confirmé, indépendamment du cache React. */
export function guidedReviewSavedAcknowledgement(expectedIdentity: string, saved: GuidedReviewEffect | null): string | null {
  if (!saved || !guidedReviewValid(saved)) return null;
  const identity = guidedReviewIdentity(saved);
  return identity === expectedIdentity ? identity : null;
}

export function guidedReviewCanConfirm(effects: GuidedReviewEffect[], reviewed: GuidedReviewAcknowledgements): boolean {
  return effects.length > 0 && new Set(effects.map(effect => effect.id)).size === effects.length
    && effects.every(effect => guidedReviewValid(effect) && guidedReviewAcknowledged(effect, reviewed));
}

export function guidedReviewSummary(effects: GuidedReviewEffect[]): string {
  const messages = effects.filter(effect => effect.kind === 'message').length;
  const contents = effects.length - messages;
  return [
    messages > 0 && `${messages} message${messages > 1 ? 's' : ''} à envoyer`,
    contents > 0 && `${contents} contenu${contents > 1 ? 's' : ''} à enregistrer`,
  ].filter(Boolean).join(' · ');
}

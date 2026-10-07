import type { DemoConversation } from './inboxDemo';
import type { MessagingService } from './messagingServices';

export interface DemoActionSource {
  id: string;
  title: string;
  author: string;
  timestamp: string;
  detail: string;
  service?: MessagingService;
}

export interface DemoCandidateAction {
  id: string;
  title: string;
  reason: string;
  owner: string;
  dueAt: string;
  sources: DemoActionSource[];
}

/** Scénarios écrits pour la démo, sans génération IA ni accès à un compte. */
export function createDemoCandidateActions(conversations: DemoConversation[]): Record<string, DemoCandidateAction[]> {
  const event = (candidate: string, id: string) => conversations.find(c => c.id === candidate)!.events.find(e => e.id === id)!;
  const booking = event('demo-camille', 'camille-booking');
  const alexReply = event('demo-alex', 'alex-email-in');
  const call = event('demo-maya', 'maya-call');
  const mayaEmail = event('demo-maya', 'maya-email');
  const after = (timestamp: string, hours: number) => new Date(Date.parse(timestamp) + hours * 3_600_000).toISOString();
  return {
    'demo-camille': [{
      id: 'demo-prep-camille', title: 'Préparer l’échange avec Camille', owner: 'Laurent', dueAt: after(booking.timestamp, -24),
      reason: 'L’échange est confirmé. Préparer les questions sur ses attentes et son expérience en accessibilité.',
      sources: [
        { id: booking.id, title: booking.eventName!, author: 'Réservation de Camille', timestamp: booking.timestamp, detail: 'Créneau confirmé à 11h30. Aucune nouvelle prise de rendez-vous à proposer.', service: 'calendly' },
        { id: 'demo-camille-post', title: 'Publication LinkedIn fictive', author: 'Camille', timestamp: after(booking.timestamp, -120), detail: '« Nous avons revu les composants de notre design system pour améliorer la navigation au clavier. » Un sujet à aborder pendant l’échange, sans en déduire une recherche d’emploi.', service: 'linkedin' },
      ],
    }],
    'demo-alex': [{
      id: 'demo-coordinate-alex', title: 'Faire le point avec Guillaume avant de répondre', owner: 'Laurent', dueAt: after(alexReply.timestamp, 24),
      reason: 'Alex attend des précisions. Guillaume les a déjà demandées au manager : se coordonner pour envoyer une réponse complète.',
      sources: [
        { id: alexReply.id, title: 'Questions d’Alex', author: 'Alex', timestamp: alexReply.timestamp, detail: alexReply.finalMessage!, service: 'outlook' },
        { id: 'demo-guillaume-alex', title: 'Suivi de l’équipe fictif', author: 'Guillaume', timestamp: after(alexReply.timestamp, 1), detail: '« J’ai demandé au manager la taille de l’équipe et le cycle de vente. Je vous partage son retour dès réception. » Une tâche est déjà portée par Guillaume : obtenir ces précisions.', service: 'outlook' },
      ],
    }],
    'demo-maya': [{
      id: 'demo-scorecard-maya', title: 'Clarifier l’expérience B2B avant la présentation', owner: 'Laurent', dueAt: after(call.timestamp, 48),
      reason: 'La pré-qualification est documentée. La scorecard laisse un critère du poste à confirmer : préparer une question ciblée.',
      sources: [
        { id: 'demo-maya-scorecard', title: 'Scorecard de pré-qualification fictive', author: 'Laurent', timestamp: after(call.timestamp, 1), detail: 'Recherche utilisateur : 4/5. Design system : 3/5. Expérience sur un produit B2B : non évaluée. Le score ne constitue pas une décision du manager.' },
        { id: call.id, title: 'Compte rendu de l’appel fictif', author: 'Laurent', timestamp: call.timestamp, detail: 'Maya souhaite découvrir l’équipe produit. Deux exemples de projets ont été demandés. Son expérience B2B n’a pas encore été abordée.', service: 'aircall' },
        { id: mayaEmail.id, title: 'Email de suivi', author: 'Laurent', timestamp: mayaEmail.timestamp, detail: mayaEmail.finalMessage!, service: 'gmail' },
      ],
    }],
  };
}

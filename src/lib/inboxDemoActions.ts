import type { DemoConversation } from './inboxDemo';
import type { MessagingService } from './messagingServices';

export interface DemoActionSource {
  id: string;
  title: string;
  author: string;
  timestamp: string;
  summary: string;
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
      id: 'demo-prep-camille', title: 'Préparer l’entretien de Camille', owner: 'Laurent', dueAt: after(booking.timestamp, -24),
      reason: 'Son entretien est confirmé. L’accessibilité est un sujet à approfondir.',
      sources: [
        { id: booking.id, title: 'Entretien confirmé', author: 'Réservation de Camille', timestamp: booking.timestamp, summary: 'Le rendez-vous est réservé, il reste à préparer vos questions.', detail: 'Créneau confirmé à 11h30. Aucune nouvelle prise de rendez-vous à proposer.', service: 'calendly' },
        { id: 'demo-camille-post', title: 'Publication de Camille', author: 'Camille', timestamp: after(booking.timestamp, -120), summary: 'Camille a partagé un travail sur l’accessibilité de son design system.', detail: '« Nous avons revu les composants de notre design system pour améliorer la navigation au clavier. » Un sujet à aborder pendant l’échange, sans en déduire une recherche d’emploi.', service: 'linkedin' },
      ],
    }],
    'demo-alex': [{
      id: 'demo-coordinate-alex', title: 'Faire le point avec Guillaume', owner: 'Laurent', dueAt: after(alexReply.timestamp, 24),
      reason: 'Alex attend des précisions que Guillaume a déjà demandées au manager.',
      sources: [
        { id: alexReply.id, title: 'Questions d’Alex', author: 'Alex', timestamp: alexReply.timestamp, summary: 'Alex demande la taille de l’équipe et la durée du cycle de vente.', detail: alexReply.finalMessage!, service: 'outlook' },
        { id: 'demo-guillaume-alex', title: 'Suivi de Guillaume', author: 'Guillaume', timestamp: after(alexReply.timestamp, 1), summary: 'Guillaume attend déjà la réponse du manager. Coordonnez-vous avant de répondre à Alex.', detail: '« J’ai demandé au manager la taille de l’équipe et le cycle de vente. Je vous partage son retour dès réception. » Une tâche est déjà portée par Guillaume : obtenir ces précisions.', service: 'outlook' },
      ],
    }],
    'demo-maya': [{
      id: 'demo-scorecard-maya', title: 'Vérifier l’expérience B2B de Maya', owner: 'Laurent', dueAt: after(call.timestamp, 48),
      reason: 'Ce critère du poste n’a pas été évalué pendant la pré-qualification.',
      sources: [
        { id: 'demo-maya-scorecard', title: 'Scorecard de pré-qualification', author: 'Laurent', timestamp: after(call.timestamp, 1), summary: 'L’expérience sur un produit B2B est encore à confirmer.', detail: 'Recherche utilisateur : 4/5. Design system : 3/5. Expérience sur un produit B2B : non évaluée. Le score ne constitue pas une décision du manager.' },
        { id: call.id, title: 'Compte rendu de l’appel', author: 'Laurent', timestamp: call.timestamp, summary: 'L’échange a couvert ses attentes, mais pas ses projets B2B.', detail: 'Maya souhaite découvrir l’équipe produit. Deux exemples de projets ont été demandés. Son expérience B2B n’a pas encore été abordée.', service: 'aircall' },
        { id: mayaEmail.id, title: 'Email de suivi', author: 'Laurent', timestamp: mayaEmail.timestamp, summary: 'Deux exemples de son portfolio ont été demandés.', detail: mayaEmail.finalMessage!, service: 'gmail' },
      ],
    }],
  };
}

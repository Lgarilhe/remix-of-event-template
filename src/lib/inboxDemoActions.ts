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
  prepareLabel: string;
  applyLabel: string;
  successLabel: string;
  effects: DemoActionEffect[];
  sources: DemoActionSource[];
}

export type DemoActionEffect = {
  id: string;
  kind: 'document';
  label: string;
  destination: string;
  content: string;
} | {
  id: string;
  kind: 'message';
  label: string;
  service: MessagingService;
  recipient: string;
  subject?: string;
  content: string;
};

export interface DemoActionResult {
  appliedAt: string;
  contents: Record<string, string>;
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
      id: 'demo-prep-camille', title: 'Préparer l’entretien de Camille',
      reason: 'Son entretien est confirmé. L’accessibilité est un sujet à approfondir.',
      prepareLabel: 'Préparer', applyLabel: 'Enregistrer la préparation', successLabel: 'Brief et questions enregistrés',
      effects: [
        { id: 'camille-brief', kind: 'document', label: 'Brief d’entretien', destination: 'Fiche candidat · Entretien confirmé', content: 'Objectif : explorer le parcours de Camille pour le poste de développeuse React senior.\n\nÀ approfondir : son travail sur l’accessibilité du design system et sa façon de concevoir des composants utilisables au clavier.\n\nLe rendez-vous est déjà confirmé : conserver ce créneau.' },
        { id: 'camille-questions', kind: 'document', label: 'Questions d’entretien', destination: 'Fiche candidat · Guide d’entretien', content: '1. Quel composant React avez-vous fait évoluer pour améliorer l’accessibilité ?\n2. Comment avez-vous testé la navigation au clavier et vérifié les résultats ?\n3. Quels compromis avez-vous faits entre réutilisation, performance et accessibilité ?' },
      ],
      sources: [
        { id: booking.id, title: 'Entretien confirmé', author: 'Réservation de Camille', timestamp: booking.timestamp, summary: 'Le rendez-vous est réservé, il reste à préparer vos questions.', detail: 'Créneau confirmé à 11h30. Aucune nouvelle prise de rendez-vous à proposer.', service: 'calendly' },
        { id: 'demo-camille-post', title: 'Publication de Camille', author: 'Camille', timestamp: after(booking.timestamp, -120), summary: 'Camille a partagé un travail sur l’accessibilité de son design system.', detail: '« Nous avons revu les composants de notre design system pour améliorer la navigation au clavier. » Un sujet à aborder pendant l’échange, sans en déduire une recherche d’emploi.', service: 'linkedin' },
      ],
    }],
    'demo-alex': [{
      id: 'demo-coordinate-alex', title: 'Répondre à Alex et coordonner le suivi',
      reason: 'Alex attend des précisions que Guillaume a déjà demandées au manager.',
      prepareLabel: 'Préparer la réponse', applyLabel: 'Envoyer et enregistrer', successLabel: 'Email envoyé · Commentaire publié',
      effects: [
        { id: 'alex-comment', kind: 'document', label: 'Commentaire d’équipe', destination: 'Fiche candidat · Commentaires d’équipe', content: '@Guillaume Alex demande la taille de l’équipe et la durée du cycle de vente. Ces précisions sont déjà attendues du manager. Merci de partager son retour ici pour que nous puissions compléter la réponse, sans relance en double.' },
        { id: 'alex-response', kind: 'message', label: 'Réponse à Alex', service: 'outlook', recipient: 'alex.martin@example.test', subject: 'Suite à vos questions sur le poste', content: 'Bonjour Alex,\n\nMerci pour vos questions et vos disponibilités. Nous attendons encore les précisions du manager sur la taille de l’équipe et la durée du cycle de vente. Je vous les partagerai dès que nous les aurons.\n\nÀ bientôt,\nLaurent' },
      ],
      sources: [
        { id: alexReply.id, title: 'Questions d’Alex', author: 'Alex', timestamp: alexReply.timestamp, summary: 'Alex demande la taille de l’équipe et la durée du cycle de vente.', detail: alexReply.finalMessage!, service: 'outlook' },
        { id: 'demo-guillaume-alex', title: 'Suivi de Guillaume', author: 'Guillaume', timestamp: after(alexReply.timestamp, 1), summary: 'Guillaume attend déjà la réponse du manager. Coordonnez-vous avant de répondre à Alex.', detail: '« J’ai demandé au manager la taille de l’équipe et le cycle de vente. Je vous partage son retour dès réception. » Une tâche est déjà portée par Guillaume : obtenir ces précisions.', service: 'outlook' },
      ],
    }],
    'demo-maya': [{
      id: 'demo-scorecard-maya', title: 'Clarifier l’expérience B2B de Maya',
      reason: 'Ce critère du poste n’a pas été évalué pendant la pré-qualification.',
      prepareLabel: 'Préparer', applyLabel: 'Envoyer et enregistrer', successLabel: 'Email envoyé · Questions enregistrées',
      effects: [
        { id: 'maya-questions', kind: 'document', label: 'Questions de scorecard', destination: 'Fiche candidat · Scorecard · Points à approfondir', content: 'Critère : expérience sur un produit B2B (non évalué).\n\n1. Sur quel produit B2B avez-vous travaillé et quels utilisateurs avez-vous rencontrés ?\n2. Quel était votre rôle, quelles décisions avez-vous prises et quels résultats avez-vous observés ?\n\nLe critère reste non évalué jusqu’à l’échange et au retour de l’évaluateur.' },
        { id: 'maya-message', kind: 'message', label: 'Email à Maya', service: 'gmail', recipient: 'maya.bernard@example.test', subject: 'Un point à préciser pour notre prochain échange', content: 'Bonjour Maya,\n\nPour compléter notre échange, pourriez-vous préciser si l’un des projets de votre portfolio concerne un produit B2B ? Un exemple avec les utilisateurs concernés, votre rôle et les décisions que vous avez prises nous aiderait à préparer la suite.\n\nMerci et à bientôt,\nLaurent' },
      ],
      sources: [
        { id: 'demo-maya-scorecard', title: 'Scorecard de pré-qualification', author: 'Laurent', timestamp: after(call.timestamp, 1), summary: 'L’expérience sur un produit B2B est encore à confirmer.', detail: 'Recherche utilisateur : 4/5. Design system : 3/5. Expérience sur un produit B2B : non évaluée. Le score ne constitue pas une décision du manager.' },
        { id: call.id, title: 'Compte rendu de l’appel', author: 'Laurent', timestamp: call.timestamp, summary: 'L’échange a couvert ses attentes, mais pas ses projets B2B.', detail: 'Maya souhaite découvrir l’équipe produit. Deux exemples de projets ont été demandés. Son expérience B2B n’a pas encore été abordée.', service: 'aircall' },
        { id: mayaEmail.id, title: 'Email de suivi', author: 'Laurent', timestamp: mayaEmail.timestamp, summary: 'Deux exemples de son portfolio ont été demandés.', detail: mayaEmail.finalMessage!, service: 'gmail' },
      ],
    }],
  };
}

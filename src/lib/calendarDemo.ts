import { addDays, addMinutes, setHours, setMinutes } from 'date-fns';
import type { CalendarEvent } from '@/hooks/useCalendarEvents';
import type { InterviewLinks } from '@/lib/sidebarSignals';

export type CalendarDemoService = 'outlook' | 'google_calendar' | 'teams' | 'google_meet';

export interface CalendarDemoCriterion {
  id: string;
  label: string;
  question: string;
}

export interface CalendarDemoInterview {
  event: CalendarEvent;
  initials: string;
  calendar: 'outlook' | 'google_calendar';
  meeting: 'teams' | 'google_meet';
  criteria: CalendarDemoCriterion[];
  transcript: { speaker: 'Recruteur' | 'Candidat'; text: string }[];
  insight: string;
  followUp: string;
  report: string;
}

export const CALENDAR_DEMO_SERVICE_LABELS: Record<CalendarDemoService, string> = {
  outlook: 'Outlook',
  google_calendar: 'Google Agenda',
  teams: 'Microsoft Teams',
  google_meet: 'Google Meet',
};

/** Des exemples datés à l'ouverture, jamais écrits dans les agendas ou la base. */
export function createCalendarDemo(now = new Date()): CalendarDemoInterview[] {
  const camilleStart = addMinutes(now, 5);
  const alexStart = setMinutes(setHours(addDays(now, 1), 14), 30);
  alexStart.setSeconds(0, 0);
  return [
    {
      event: {
        id: 'demo-interview-camille', type: 'qualification',
        startAt: camilleStart.toISOString(), endAt: addMinutes(camilleStart, 45).toISOString(),
        title: 'Entretien avec Camille Durand', subtitle: 'Product Designer · Atelier Cloud', status: 'scheduled',
        meta: { candidateName: 'Camille Durand', candidateHeadline: 'Product Designer · 6 ans d’expérience',
          jobTitle: 'Product Designer', clientName: 'Atelier Cloud', round: { kind: 'numbered', n: 1, label: '1er entretien' } },
      },
      initials: 'CD', calendar: 'outlook', meeting: 'teams',
      criteria: [
        { id: 'research', label: 'Recherche utilisateur', question: 'Comment avez-vous transformé un retour utilisateur en amélioration du produit ?' },
        { id: 'collaboration', label: 'Collaboration avec les développeurs', question: 'Comment gérez-vous les compromis entre expérience et contraintes techniques ?' },
        { id: 'motivation', label: 'Motivation pour le poste', question: 'Qu’aimeriez-vous retrouver dans votre prochaine équipe ?' },
      ],
      transcript: [
        { speaker: 'Recruteur', text: 'Camille, pouvez-vous me parler d’un projet où la recherche a changé votre approche ?' },
        { speaker: 'Candidat', text: 'Sur notre onboarding, j’ai mené huit entretiens. Nous avons simplifié le formulaire avec les développeurs, puis testé le nouveau parcours.' },
        { speaker: 'Recruteur', text: 'Quel a été le résultat ?' },
        { speaker: 'Candidat', text: 'Les abandons ont baissé de 18 %. Je souhaite maintenant suivre un produit sur la durée, au sein d’une petite équipe.' },
      ],
      insight: 'Recherche et collaboration illustrées par un exemple concret. Le résultat est quantifié.',
      followUp: 'Comment avez-vous mesuré la baisse des abandons, et sur quelle période ?',
      report: 'Camille décrit une démarche de recherche structurée et une collaboration étroite avec les développeurs. Elle cite une baisse de 18 % des abandons sur l’onboarding. À approfondir : la méthode de mesure et son rôle exact dans les arbitrages.',
    },
    {
      event: {
        id: 'demo-interview-alex', type: 'qualification',
        startAt: alexStart.toISOString(), endAt: addMinutes(alexStart, 30).toISOString(),
        title: 'Entretien avec Alex Martin', subtitle: 'Account Executive · Nova Studio', status: 'scheduled',
        meta: { candidateName: 'Alex Martin', candidateHeadline: 'Account Executive · 5 ans d’expérience',
          jobTitle: 'Account Executive', clientName: 'Nova Studio', round: { kind: 'numbered', n: 2, label: '2e entretien' } },
      },
      initials: 'AM', calendar: 'google_calendar', meeting: 'google_meet',
      criteria: [
        { id: 'sales', label: 'Gestion du cycle de vente', question: 'Décrivez une vente complexe que vous avez menée de bout en bout.' },
        { id: 'discovery', label: 'Découverte des besoins', question: 'Comment identifiez-vous les décideurs et les priorités du client ?' },
        { id: 'motivation', label: 'Motivation pour le poste', question: 'Qu’est-ce qui vous attire dans cette équipe et ce marché ?' },
      ],
      transcript: [
        { speaker: 'Recruteur', text: 'Alex, comment avez-vous abordé votre dernier contrat avec plusieurs décideurs ?' },
        { speaker: 'Candidat', text: 'J’ai réuni les responsables métier et les achats pour clarifier leurs objectifs. Nous avons défini un pilote et des critères de réussite communs.' },
        { speaker: 'Recruteur', text: 'Qu’avez-vous appris de ce pilote ?' },
        { speaker: 'Candidat', text: 'Le client a validé le déploiement après six semaines. J’aimerais retrouver cette approche conseil dans mon prochain poste.' },
      ],
      insight: 'Alex implique les différents décideurs et construit une validation commune avant le déploiement.',
      followUp: 'Quels critères de réussite avaient été convenus, et quel était le montant du contrat ?',
      report: 'Alex présente une vente construite autour d’un pilote de six semaines et d’objectifs partagés avec les décideurs. Son approche est orientée conseil. À approfondir : les résultats mesurés, la taille des contrats et son autonomie sur la négociation.',
    },
  ];
}

/** Ces valeurs sont des clés d'interface, jamais utilisées pour naviguer. */
export function calendarDemoLinks(id: string): InterviewLinks {
  return { qualification: `${id}:scorecard`, candidate: null, scorecard: `${id}:scorecard`, coaching: `${id}:assistant` };
}

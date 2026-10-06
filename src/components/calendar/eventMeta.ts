import { Briefcase, Clock, Mail, Zap, type LucideIcon } from 'lucide-react';
import type { CalendarEvent, CalendarEventRound } from '@/hooks/useCalendarEvents';

/**
 * Types d'événement de l'agenda : une seule table pour la grille, la fiche et
 * la légende (revue design A-44). Les types restent neutres et se distinguent
 * par leur icône et leur nom ; la seule couleur de l'agenda signale un conflit.
 */
export const EVENT_TYPES: Record<CalendarEvent['type'], { label: string; icon: LucideIcon }> = {
  qualification: { label: 'Entretien', icon: Briefcase },
  inmail: { label: 'InMail', icon: Mail },
  sequence_step: { label: 'Séquence', icon: Zap },
  reminder: { label: 'Rappel', icon: Clock },
};

/** « 1er entretien », « 2e entretien », « Entretien final » : jamais « 1ER » ni « Final round ». */
export function roundLabel(round: CalendarEventRound | undefined): string | null {
  if (!round) return null;
  if (round.kind === 'final') return 'Entretien final';
  if (round.n === 1) return '1er entretien';
  return round.n ? `${round.n}e entretien` : null;
}

/** URL http(s), ou le préréglage « Visio » sans lien de CreateEventModal. */
export const isVisioLink = (loc: string | null | undefined) =>
  !!loc && (/^https?:\/\//i.test(loc) || loc.trim().toLowerCase() === 'visio');

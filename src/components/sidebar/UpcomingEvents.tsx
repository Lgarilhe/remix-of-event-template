/**
 * Zone « Événements à venir » de la barre latérale, sous le panneau de l'onglet
 * actif (visible sur les trois onglets, masquée quand la barre est repliée).
 *
 * Les entretiens que j'anime sur les 3 prochains jours, par heure (« Dans 8
 * min », « 17:00 », « Demain 14:30 »), 4 lignes au plus, puis « Tout afficher »
 * vers l'agenda. Cliquer une ligne ouvre la fiche du candidat (la page de
 * l'entretien s'il n'est pas rattaché à un candidat). De 15 minutes avant le
 * début jusqu'à la fin, la ligne propose en dessous l'assistant d'entretien, la
 * visio et la grille (une seule ligne d'icônes). Sans rendez-vous prévu,
 * un lien permet d'essayer les exemples locaux.
 *
 * La lecture est celle de l'alerte de début d'entretien (useUpcomingInterviews).
 */
import { Fragment } from 'react';
import { useNavigate } from 'react-router-dom';
import { CalendarClock, Ellipsis, Play } from 'lucide-react';
import { useCalendarDemo } from '@/components/calendar/CalendarDemoProvider';
import { useUpcomingInterviews } from '@/hooks/sidebar/useUpcomingInterviews';
import { useMissionNames } from '@/hooks/sidebar/useMyMissions';
import { useNow } from '@/hooks/sidebar/useNow';
import { useCloseMobileSidebar } from '@/hooks/sidebar/useCloseMobileSidebar';
import {
  UPCOMING_DISPLAY_LIMIT,
  formatUpcomingTime,
  interviewLinks,
  isInterviewActive,
  joinUrlOf,
  upcomingInterviews,
} from '@/lib/sidebarSignals';
import { SidebarSection } from './SidebarSection';
import { SidebarRow } from './SidebarRow';
import { InterviewActionButtons } from './InterviewActionButtons';
import { SIDEBAR_GHOST_CLASS } from './sidebarButtonClass';
import { UpcomingInterviewExamples } from './UpcomingInterviewExamples';

export function UpcomingEvents() {
  const demo = useCalendarDemo();
  const nowMs = useNow(60_000);
  const now = new Date(nowMs);
  const navigate = useNavigate();
  const closeMobile = useCloseMobileSidebar();
  const { status, stale, retry, rows } = useUpcomingInterviews({ now: nowMs });
  const upcoming = upcomingInterviews(rows, now, UPCOMING_DISPLAY_LIMIT);
  const missionName = useMissionNames({ enabled: upcoming.some((r) => !!r.project_id && !r.job_title) });

  const open = (to: string) => {
    closeMobile();
    navigate(to);
  };

  const items = upcoming.map((row) => {
    const links = interviewLinks(row);
    const joinUrl = joinUrlOf(row.event_location);
    const person = (row.candidate_name ?? row.event_name ?? '').trim() || 'Entretien';
    return (
      <Fragment key={row.id}>
        <SidebarRow
          leading={<CalendarClock />}
          title={person}
          sub={row.job_title ?? missionName(row.project_id)}
          right={row.event_start_at ? formatUpcomingTime(row.event_start_at, now) : null}
          to={links.candidate ?? links.qualification}
        />
        {isInterviewActive(row, now) && (links.coaching || joinUrl) && (
          <li className="px-2 pb-1 pl-9">
            <InterviewActionButtons
              links={links}
              joinUrl={joinUrl}
              onOpen={open}
              compact
              secondaryClassName={SIDEBAR_GHOST_CLASS}
            />
          </li>
        )}
      </Fragment>
    );
  });

  // Une démonstration déjà ouverte reste disponible même si la lecture réelle attend.
  if (status === 'loading' && !demo.active) return null;
  const showReal = status !== 'loading' && (status !== 'ok' || upcoming.length > 0);

  return (
    <div className="max-h-[45vh] shrink-0 overflow-y-auto border-t border-sidebar-border pt-1">
      {(!demo.active || showReal) && <SidebarSection
        id="upcoming-events"
        title="Événements à venir"
        state={status}
        stale={stale}
        onRetry={retry}
        isEmpty={upcoming.length === 0}
        hideWhenEmpty={false}
        emptyText="Aucun événement à venir."
        errorText="Impossible de charger vos événements."
        footer={<>
          {showReal && <SidebarRow leading={<Ellipsis />} title="Tout afficher" to="/calendar" muted />}
          {!demo.active && <SidebarRow leading={<Play />} title="Voir un exemple" onSelect={demo.startDemo} muted />}
        </>}
      >
        {items}
      </SidebarSection>}
      <UpcomingInterviewExamples hasRealEvents={showReal} />
    </div>
  );
}

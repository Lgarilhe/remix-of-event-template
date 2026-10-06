/**
 * Entretiens aujourd'hui et Comptes rendus à faire (§4.5, D33) : entretiens
 * que j'anime, listes disjointes (fin à venir, fin passée). Aucune ligne ne
 * compte dans le chiffre. Sections masquées si vides ; une seule lecture, donc
 * un seul message de chargement ou d'erreur, porté par la première section.
 */
import { useEffect, useState } from 'react';
import { CalendarClock, FileText } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useTodoInterviews, type InterviewRow } from '@/hooks/sidebar/useTodoInterviews';
import { useMissionNames } from '@/hooks/sidebar/useMyMissions';
import { canJoin, formatShortTime } from '@/lib/sidebarSignals';
import { SidebarSection } from '../SidebarSection';
import { SidebarRow } from '../SidebarRow';
import { SIDEBAR_GHOST_CLASS } from '../sidebarButtonClass';

/** Classes ajoutées au Button du kit (taille xs) ; SidebarRow pose les 44 px sur téléphone. */
const JOIN_BUTTON_CLASS = cn(SIDEBAR_GHOST_CLASS, 'rounded-md px-2 text-xs font-medium text-sidebar-foreground');

/** Heure courante, rafraîchie toutes les `intervalMs` tant que la section est montée. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}

const personOf = (row: InterviewRow) => (row.candidate_name ?? row.event_name ?? '').trim();

export function InterviewsSections() {
  const nowMs = useNow(60_000);
  const { status, stale, retry, today, debriefs } = useTodoInterviews({ now: nowMs });
  const missionName = useMissionNames({
    enabled: [...today, ...debriefs].some((r) => !!r.project_id && !r.job_title),
  });
  const now = new Date(nowMs);

  const todayRows = today.map((row) => {
    const time = row.event_start_at ? formatShortTime(row.event_start_at, now) : '';
    const person = personOf(row);
    const location = row.event_location?.trim() ?? '';
    return (
      <SidebarRow
        key={row.id}
        leading={<CalendarClock />}
        title={person ? `${time} · ${person}` : time}
        sub={row.job_title ?? missionName(row.project_id)}
        to={`/qualification/${row.id}`}
        action={
          canJoin(row, now) ? (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              onClick={() => window.open(location, '_blank', 'noopener,noreferrer')}
              className={JOIN_BUTTON_CLASS}
            >
              Rejoindre
            </Button>
          ) : undefined
        }
      />
    );
  });

  const debriefRows = debriefs.map((row) => {
    const time = row.event_start_at ? formatShortTime(row.event_start_at, now) : '';
    const person = personOf(row);
    return (
      <SidebarRow
        key={row.id}
        leading={<FileText />}
        title="Compte rendu à faire"
        sub={person ? `${person} · ${time}` : time}
        to={`/qualification/${row.id}`}
      />
    );
  });

  return (
    <>
      <SidebarSection
        id="interviews-today"
        title="Entretiens aujourd'hui"
        state={status}
        stale={stale}
        onRetry={retry}
        isEmpty={today.length === 0}
        errorText="Impossible de charger vos entretiens."
      >
        {todayRows}
      </SidebarSection>
      {status === 'ok' && (
        <SidebarSection
          id="interviews-debriefs"
          title="Comptes rendus à faire"
          state="ok"
          // Aujourd'hui masquée (vide) : la ligne « données peut-être anciennes » passe ici.
          stale={stale && today.length === 0}
          onRetry={retry}
          isEmpty={debriefs.length === 0}
        >
          {debriefRows}
        </SidebarSection>
      )}
    </>
  );
}

import { useMemo } from 'react';
import { useLocation } from 'react-router-dom';

/**
 * Passive app-location context: where the user currently is in the app.
 * Derived from the router so the chat knows the user's context even when
 * opened from the floating button (not just from a mission action).
 */
export interface AppContext {
  /** Human label of the current page (FR) */
  page: string;
  /** Raw pathname */
  path: string;
  /** sourcing_projects.id when on a mission, else null */
  missionId: string | null;
  /** Resolved mission name when known */
  missionTitle: string | null;
  /** Active mission tab (overview/brief/process/sourcing/…) when on a mission */
  missionTab: string | null;
  /** Candidate id when on a scorecard / qualification route */
  candidateId: string | null;
}

const PAGE_LABELS: Array<[RegExp, string]> = [
  [/^\/missions\/[^/]+/, 'Mission'],
  [/^\/missions\/?$/, 'Liste des missions'],
  [/scorecard\/[^/]+/, 'Scorecard candidat'],
  [/^\/qualification\/[^/]+/, 'Qualification candidat'],
  [/^\/pipeline/, 'Pipeline (ATS)'],
  [/^\/inbox/, 'Messagerie'],
  [/^\/calendar/, 'Calendrier'],
  [/^\/tasks/, 'Tâches'],
  [/^\/dashboard/, 'Tableau de bord'],
  [/^\/settings/, 'Paramètres'],
  [/^\/marketplace/, 'Marketplace'],
  [/^\/agents/, 'Agents'],
  [/^\/pricing/, 'Tarifs'],
];

export function useAppContext(): AppContext {
  const { pathname, search } = useLocation();

  return useMemo(() => {
    const missionId = pathname.match(/^\/missions\/([^/]+)/)?.[1] ?? null;
    const candidateId =
      pathname.match(/scorecard\/([^/]+)/)?.[1] ??
      pathname.match(/^\/qualification\/([^/]+)/)?.[1] ??
      null;
    const missionTab = missionId
      ? new URLSearchParams(search).get('tab') || 'overview'
      : null;
    const page = PAGE_LABELS.find(([re]) => re.test(pathname))?.[1] ?? 'Application';

    // Title is resolved by the agent via Phase B read tools (keeps this hook
    // query-free so it's safe to run app-wide, incl. public/unauth pages).
    return { page, path: pathname, missionId, missionTitle: null, missionTab, candidateId };
  }, [pathname, search]);
}

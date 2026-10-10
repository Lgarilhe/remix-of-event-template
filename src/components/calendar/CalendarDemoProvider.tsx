import { createContext, lazy, Suspense, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useSidebar } from '@/components/ui/sidebar';
import { createCalendarDemo, type CalendarDemoInterview } from '@/lib/calendarDemo';

const InterviewDemoDialog = lazy(() => import('@/components/calendar/InterviewDemoDialog'));

export type PreviewTab = 'scorecard' | 'assistant' | 'meeting';
export interface DemoDraft {
  ratings: Record<string, number>;
  comments: Record<string, string>;
  notes: string;
  simulation: 'idle' | 'transcript' | 'report';
}
const emptyDraft = (): DemoDraft => ({ ratings: {}, comments: {}, notes: '', simulation: 'idle' });

interface CalendarDemoContextValue {
  active: boolean;
  interviews: CalendarDemoInterview[];
  startDemo: () => void;
  stopDemo: () => void;
  openPreview: (interview: CalendarDemoInterview, tab: PreviewTab) => void;
}
const CalendarDemoContext = createContext<CalendarDemoContextValue | null>(null);

/** État local de l'aperçu, partagé entre les pages et la barre latérale. */
export function CalendarDemoProvider({ children }: { children: ReactNode }) {
  const location = useLocation();
  const navigate = useNavigate();
  const { setOpen, setOpenMobile } = useSidebar();
  const requested = location.pathname === '/calendar' && new URLSearchParams(location.search).get('demo') === '1';
  const [interviews, setInterviews] = useState(() => requested ? createCalendarDemo() : []);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [tab, setTab] = useState<PreviewTab>('scorecard');
  const [drafts, setDrafts] = useState<Record<string, DemoDraft>>({});
  const openerRef = useRef<HTMLElement | null>(null);
  const requestedRef = useRef(false);
  const active = interviews.length > 0;

  const startDemo = useCallback(() => {
    setInterviews(previous => previous.length ? previous : createCalendarDemo());
    setOpen(true);
    setOpenMobile(true);
  }, [setOpen, setOpenMobile]);

  // Le paramètre historique démarre le même aperçu. Une fois ouvert, le tiroir
  // reste libre de se fermer et la démo accompagne les changements de page.
  useEffect(() => {
    if (requested && !requestedRef.current) startDemo();
    requestedRef.current = requested;
  }, [requested, startDemo]);

  const stopDemo = useCallback(() => {
    setSelectedId(null);
    setInterviews([]);
    setDrafts({});
    if (requested) navigate('/calendar', { replace: true });
  }, [navigate, requested]);

  const openPreview = useCallback((interview: CalendarDemoInterview, nextTab: PreviewTab) => {
    if (!interviews.some(item => item.event.id === interview.event.id)) return;
    openerRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setSelectedId(interview.event.id);
    setTab(nextTab);
    setOpenMobile(false);
  }, [interviews, setOpenMobile]);

  const selected = interviews.find(interview => interview.event.id === selectedId) ?? null;
  const draft = selected ? drafts[selected.event.id] ?? emptyDraft() : emptyDraft();
  function updateDraft(update: Partial<DemoDraft>) {
    if (!selected) return;
    const id = selected.event.id;
    setDrafts(previous => ({ ...previous, [id]: { ...(previous[id] ?? emptyDraft()), ...update } }));
  }
  function restoreFocus(event: Event) {
    const opener = openerRef.current;
    if (opener?.isConnected && opener.getClientRects().length) {
      event.preventDefault();
      opener.focus();
      return;
    }
    // Sur mobile, la fermeture du tiroir a retiré le bouton d'origine.
    const trigger = [...document.querySelectorAll<HTMLElement>('[data-sidebar="trigger"]')]
      .find(element => element.getClientRects().length > 0);
    if (trigger) {
      event.preventDefault();
      trigger.focus();
    }
  }
  const value = useMemo(() => ({ active, interviews, startDemo, stopDemo, openPreview }), [active, interviews, startDemo, stopDemo, openPreview]);

  return <CalendarDemoContext.Provider value={value}>
    {children}
    {selected && <Suspense fallback={null}>
      <InterviewDemoDialog selected={selected} tab={tab} draft={draft}
        onClose={() => setSelectedId(null)} onTabChange={setTab} onDraftChange={updateDraft} onRestoreFocus={restoreFocus} />
    </Suspense>}
  </CalendarDemoContext.Provider>;
}

// Le hook et le provider exposent le même contexte local.
// eslint-disable-next-line react-refresh/only-export-components
export function useCalendarDemo(): CalendarDemoContextValue {
  const context = useContext(CalendarDemoContext);
  if (!context) throw new Error('useCalendarDemo must be used within a CalendarDemoProvider.');
  return context;
}

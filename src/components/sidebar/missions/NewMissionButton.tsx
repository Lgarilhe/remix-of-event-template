/**
 * « Nouvelle mission » en tête de l'onglet Missions (D14, §3.7). Au plafond de
 * la formule, le bouton cède la place à l'encart gris MissionQuotaNotice : le
 * plafond est annoncé d'emblée, jamais refusé après le clic.
 */
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { useQuotaGate } from '@/hooks/useQuotaGate';
import { useCloseMobileSidebar } from '@/hooks/sidebar/useCloseMobileSidebar';
import { MissionQuotaNotice } from '@/components/missions/MissionQuotaNotice';

export function NewMissionButton() {
  const navigate = useNavigate();
  const closeMobile = useCloseMobileSidebar();
  const { canCreateJob, maxJobs } = useQuotaGate();

  if (!canCreateJob && maxJobs !== null) {
    return <MissionQuotaNotice maxJobs={maxJobs} onNavigate={closeMobile} className="mx-1" />;
  }

  return (
    <button
      type="button"
      onClick={() => {
        closeMobile();
        navigate('/missions?create=brief');
      }}
      className="mx-1 flex w-[calc(100%-0.5rem)] items-center justify-center gap-1.5 rounded-md bg-primary px-3 text-[13px] font-semibold text-primary-foreground min-h-11 md:min-h-8 transition-colors hover:bg-primary/90 outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring"
    >
      <Plus aria-hidden="true" className="h-4 w-4" />
      Nouvelle mission
    </button>
  );
}

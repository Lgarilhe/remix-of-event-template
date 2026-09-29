/**
 * « Nouvelle mission » en tête de l'onglet Missions (D14, §3.7). Au plafond de
 * la formule, le bouton cède la place à l'encart gris MissionQuotaNotice : le
 * plafond est annoncé d'emblée, jamais refusé après le clic.
 * Bouton principal du kit, monochrome (lot 12, A-53) ; 44 px sur téléphone.
 */
import { useNavigate } from 'react-router-dom';
import { Plus } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { useQuotaGate } from '@/hooks/useQuotaGate';
import { useCloseMobileSidebar } from '@/hooks/sidebar/useCloseMobileSidebar';
import { MissionQuotaNotice } from '@/components/missions/MissionQuotaNotice';
import { SIDEBAR_FOCUS_CLASS } from '../sidebarButtonClass';

export function NewMissionButton() {
  const navigate = useNavigate();
  const closeMobile = useCloseMobileSidebar();
  const { canCreateJob, maxJobs } = useQuotaGate();

  if (!canCreateJob && maxJobs !== null) {
    return <MissionQuotaNotice maxJobs={maxJobs} onNavigate={closeMobile} className="mx-1" />;
  }

  return (
    <Button
      type="button"
      variant="primary"
      size="sm"
      onClick={() => {
        closeMobile();
        navigate('/missions?create=brief');
      }}
      className={cn(SIDEBAR_FOCUS_CLASS, 'mx-1 flex gap-1.5 min-h-11 md:min-h-8')}
    >
      <Plus aria-hidden="true" />
      Nouvelle mission
    </Button>
  );
}

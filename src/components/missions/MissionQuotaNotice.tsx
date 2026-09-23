/**
 * Encart « plafond de missions atteint » (D14, D23), partagé par la barre
 * latérale et la page /missions : même texte, même couleur grise partout (le
 * rouge est réservé aux pannes). Il remplace le bouton « Nouvelle mission ».
 */
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';
import { useOrganization } from '@/hooks/useOrganization';
import { missionQuotaMessage } from '@/lib/sidebarMissions';

export interface MissionQuotaNoticeProps {
  maxJobs: number;
  /** Appelé au clic sur « Changer de formule » (la barre ferme la feuille sur téléphone). */
  onNavigate?: () => void;
  className?: string;
}

export function MissionQuotaNotice({ maxJobs, onNavigate, className }: MissionQuotaNoticeProps) {
  const { isAdmin } = useOrganization();

  return (
    <div
      className={cn(
        'rounded-lg border border-border bg-muted/50 px-3 py-2 text-[12.5px] text-muted-foreground',
        className,
      )}
    >
      <p className="font-medium text-foreground/80">{missionQuotaMessage(maxJobs)}</p>
      {isAdmin ? (
        <Link
          to="/settings/org/billing"
          onClick={onNavigate}
          className="mt-0.5 inline-flex min-h-11 items-center font-medium text-foreground underline underline-offset-2 hover:text-foreground/80 md:min-h-0"
        >
          Changer de formule
        </Link>
      ) : (
        <p className="mt-0.5">Un administrateur peut changer de formule.</p>
      )}
    </div>
  );
}

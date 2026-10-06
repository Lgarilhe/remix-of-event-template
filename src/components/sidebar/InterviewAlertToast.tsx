/**
 * Alerte de début d'entretien, posée par Sonner (toast.custom) à l'heure du
 * rendez-vous. Rendue hors du routeur : aucun contexte lu ici, tout passe par
 * les props (voir InterviewActionButtons).
 */
import { CalendarClock, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import type { InterviewLinks } from '@/lib/sidebarSignals';
import { InterviewActionButtons } from './InterviewActionButtons';

export interface InterviewAlertToastProps {
  /** Candidat ou, à défaut, nom de l'événement. */
  person: string;
  /** Poste ou mission, sous le nom. */
  sub: string | null;
  links: InterviewLinks;
  joinUrl: string | null;
  onOpen: (to: string) => void;
  onClose: () => void;
}

export function InterviewAlertToast({ person, sub, links, joinUrl, onOpen, onClose }: InterviewAlertToastProps) {
  return (
    <div
      role="status"
      className="flex w-[356px] max-w-[calc(100vw-2rem)] flex-col gap-3 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-xl"
    >
      <div className="flex items-start gap-2.5">
        <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center text-muted-foreground [&>svg]:h-4 [&>svg]:w-4">
          <CalendarClock aria-hidden="true" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold">Entretien maintenant</p>
          <p className="truncate text-xs text-muted-foreground">{sub ? `${person} · ${sub}` : person}</p>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-xs"
          aria-label="Fermer l'alerte"
          onClick={onClose}
          className="shrink-0 max-md:h-11 max-md:w-11"
        >
          <X aria-hidden="true" />
        </Button>
      </div>
      <InterviewActionButtons links={links} joinUrl={joinUrl} onOpen={onOpen} />
    </div>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { useCandidateFullProfile } from '@/hooks/useCandidateFullProfile';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface Props {
  candidateId: string;
  linkedinUrl: string | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Élément auquel la fenêtre s'accroche (la ligne du candidat). */
  children: React.ReactNode;
}

/** Historique des interactions, ouvert depuis le menu de la ligne du candidat. */
export function HistoryPopover({ candidateId, linkedinUrl, isOpen, onOpenChange, children }: Props) {
  const [loaded, setLoaded] = useState(false);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isOpen && !loaded) setLoaded(true);
  }, [isOpen, loaded]);

  return (
    <Popover open={isOpen} onOpenChange={onOpenChange}>
      <PopoverAnchor ref={anchorRef}>{children}</PopoverAnchor>
      <PopoverContent
        className="max-h-72 w-80 space-y-2 overflow-y-auto"
        side="right"
        align="start"
        // En se fermant, la fenêtre rend le focus au menu « Actions » de la ligne.
        onCloseAutoFocus={(e) => {
          const menuButton = anchorRef.current?.querySelector<HTMLElement>('[aria-haspopup="menu"]');
          if (menuButton) {
            e.preventDefault();
            menuButton.focus();
          }
        }}
      >
        <p className="text-sm font-semibold text-foreground">Historique des interactions</p>
        {loaded ? (
          <HistoryContent candidateId={candidateId} linkedinUrl={linkedinUrl} />
        ) : null}
      </PopoverContent>
    </Popover>
  );
}

function HistoryContent({ candidateId, linkedinUrl }: { candidateId: string; linkedinUrl: string | null }) {
  const { timeline, loading } = useCandidateFullProfile(candidateId, linkedinUrl);

  if (loading) {
    return (
      <div className="space-y-2">
        <Skeleton className="h-3 w-48" />
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-3 w-44" />
      </div>
    );
  }

  if (timeline.length === 0) {
    return <p className="text-xs text-muted-foreground">Aucune interaction avec ce candidat pour le moment.</p>;
  }

  const hidden = timeline.length - 10;

  return (
    <div className="space-y-1.5">
      {timeline.slice(0, 10).map((item, i) => (
        <p key={i} className="text-xs leading-snug text-foreground-secondary">
          {item.date && (
            <span className="font-medium tabular-nums text-foreground">
              {format(new Date(item.date), 'dd/MM/yy', { locale: fr })}
            </span>
          )}
          {item.date && <span aria-hidden="true"> · </span>}
          {item.title}
          {item.detail && <span className="text-muted-foreground"> · {item.detail}</span>}
        </p>
      ))}
      {hidden > 0 && (
        <p className="text-xs text-muted-foreground">
          et {hidden} {hidden > 1 ? 'autres interactions' : 'autre interaction'}
        </p>
      )}
    </div>
  );
}

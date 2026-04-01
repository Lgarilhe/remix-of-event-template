import React, { useState, useEffect } from 'react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { useCandidateFullProfile } from '@/hooks/useCandidateFullProfile';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface Props {
  candidateId: string;
  linkedinUrl: string | null;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function HistoryPopover({ candidateId, linkedinUrl, isOpen, onOpenChange, children }: Props) {
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    if (isOpen && !loaded) setLoaded(true);
  }, [isOpen, loaded]);

  return (
    <Popover open={isOpen} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-80 p-3 space-y-2 max-h-72 overflow-y-auto" side="right">
        <h4 className="text-xs font-semibold">Historique des interactions</h4>
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
    return <p className="text-[11px] text-muted-foreground">Aucune interaction passée.</p>;
  }

  return (
    <div className="space-y-1.5">
      {timeline.slice(0, 10).map((item, i) => (
        <div key={i} className="text-[10px] leading-snug">
          <span className="font-medium text-foreground/80">
            {item.date ? format(new Date(item.date), 'dd/MM/yy', { locale: fr }) : '—'}
          </span>
          {' — '}<span>{item.title}</span>
          {item.detail && (
            <span className="text-muted-foreground italic"> · {item.detail}</span>
          )}
        </div>
      ))}
      {timeline.length > 10 && (
        <p className="text-[10px] text-muted-foreground">+{timeline.length - 10} autres interactions</p>
      )}
    </div>
  );
}

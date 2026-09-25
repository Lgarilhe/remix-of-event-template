import React, { useState, useEffect, useRef } from 'react';
import { Anchor as PopoverAnchor } from '@radix-ui/react-popover';
import { supabase } from '@/integrations/supabase/client';
import { Popover, PopoverContent } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ScoreBadge } from '@/components/ui/score-badge';

interface Props {
  candidateId: string;
  jobId?: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  /** Élément auquel la fenêtre s'accroche (la ligne du candidat). */
  children: React.ReactNode;
}

/**
 * Détail du score d'un candidat, ouvert depuis le menu de sa ligne. La ligne
 * sert d'ancre, pas de déclencheur : un clic sur le candidat affiche ses
 * aperçus, il n'ouvre pas cette fenêtre.
 */
export function ScoringPopover({ candidateId, jobId, isOpen, onOpenChange, children }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const anchorRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen || data) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);

    const fetch = async () => {
      try {
        const query = supabase
          .from('job_candidate_status')
          .select('score, recommendation, scoring_details, pipeline_stage, status')
          .eq('candidate_id', candidateId);

        if (jobId) query.eq('job_id', jobId);

        const { data: rows, error } = await query.order('updated_at', { ascending: false }).limit(1);
        if (error) throw error;
        if (!cancelled) setData(rows?.[0] || null);
      } catch (err) {
        console.warn('[ScoringPopover] score fetch failed:', err);
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetch();
    return () => { cancelled = true; };
  }, [isOpen, candidateId, jobId, data, attempt]);

  const strengths: string[] = data?.scoring_details?.strengths ?? [];
  const concerns: string[] = data?.scoring_details?.concerns ?? [];

  return (
    <Popover open={isOpen} onOpenChange={onOpenChange}>
      <PopoverAnchor ref={anchorRef}>{children}</PopoverAnchor>
      <PopoverContent
        className="w-80 space-y-3"
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
        <p className="text-sm font-semibold text-foreground">Détail du score</p>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ) : failed ? (
          <div className="space-y-2">
            <p className="text-xs text-muted-foreground">Le score n'a pas pu être chargé. Vérifiez votre connexion, puis réessayez.</p>
            <Button variant="outline" size="xs" onClick={() => setAttempt(a => a + 1)}>Réessayer</Button>
          </div>
        ) : !data || data.score == null ? (
          <p className="text-xs text-muted-foreground">Ce candidat n'a pas encore de score pour cette mission.</p>
        ) : (
          <div className="space-y-3">
            <ScoreBadge score={data.score} showLevel />
            {strengths.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-foreground">Forces</p>
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-foreground-secondary">
                  {strengths.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
            {concerns.length > 0 && (
              <div>
                <p className="mb-1 text-xs font-medium text-foreground">Points d'attention</p>
                <ul className="list-disc space-y-0.5 pl-4 text-xs text-foreground-secondary">
                  {concerns.map((s, i) => <li key={i}>{s}</li>)}
                </ul>
              </div>
            )}
            {data.scoring_details?.summary && (
              <p className="border-t border-border pt-2 text-xs text-muted-foreground">{data.scoring_details.summary}</p>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

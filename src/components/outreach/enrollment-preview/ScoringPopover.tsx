import React, { useState, useEffect, useRef } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Popover, PopoverAnchor, PopoverContent } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { ScoreBadge } from '@/components/ui/score-badge';

interface Props {
  candidateId: string;
  jobId?: string;
  /** Mission (uuid sans « project: »), quand le poste en est une : la note se lit par mission et organisation. */
  projectId?: string;
  organizationId?: string | null;
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
export function ScoringPopover({ candidateId, jobId, projectId, organizationId, isOpen, onOpenChange, children }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const anchorRef = useRef<HTMLDivElement>(null);

  // Un autre candidat, une autre mission ou une autre organisation : la note lue ne vaut plus.
  useEffect(() => {
    setData(null);
  }, [candidateId, jobId, projectId, organizationId]);

  useEffect(() => {
    if (!isOpen || data) return;
    let cancelled = false;
    setLoading(true);
    setFailed(false);
    // En contexte de mission, la lecture attend l'organisation.
    if (projectId && !organizationId) return () => { cancelled = true; };

    const fetch = async () => {
      try {
        // Mission : la ligne notée de ce candidat dans la mission, quelle que soit la
        // forme du job_id ou l'auteur (comme la note de la carte). Sinon : le poste.
        // Une ligne notée passe avant une ligne sans note, puis la plus récente (règle de la vue).
        const readBy = async (column: 'project_id' | 'job_id', value: string) => {
          let query = supabase
            .from('job_candidate_status')
            .select('score, recommendation, scoring_details')
            .eq('candidate_id', candidateId)
            .eq(column, value);
          if (column === 'project_id' && organizationId) query = query.eq('organization_id', organizationId);
          // Règle de la vue mission_candidate_rows : la ligne notée la plus récente,
          // à défaut la plus récente (les doublons d'un candidat sont peu nombreux).
          const { data: found, error: readError } = await query
            .order('updated_at', { ascending: false });
          if (readError) throw readError;
          return found?.find((r) => r.score != null) ?? found?.[0] ?? null;
        };
        let row = projectId ? await readBy('project_id', projectId) : null;
        // Un job_id ancien n'est pas une mission : repli sur le poste.
        if (!row && jobId) row = await readBy('job_id', jobId);
        if (!cancelled) setData(row);
      } catch (err) {
        console.warn('[ScoringPopover] score fetch failed:', err);
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    fetch();
    return () => { cancelled = true; };
  }, [isOpen, candidateId, jobId, projectId, organizationId, data, attempt]);

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

import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';

interface Props {
  candidateId: string;
  jobId?: string;
  isOpen: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
}

export function ScoringPopover({ candidateId, jobId, isOpen, onOpenChange, children }: Props) {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!isOpen || data) return;
    setLoading(true);

    const fetch = async () => {
      const query = supabase
        .from('job_candidate_status')
        .select('score, recommendation, scoring_details, pipeline_stage, status')
        .eq('candidate_id', candidateId);

      if (jobId) query.eq('job_id', jobId);

      const { data: rows } = await query.order('updated_at', { ascending: false }).limit(1);
      setData(rows?.[0] || null);
      setLoading(false);
    };
    fetch();
  }, [isOpen, candidateId, jobId, data]);

  return (
    <Popover open={isOpen} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-80 p-3 space-y-2" side="right">
        <h4 className="text-xs font-semibold">Scoring détaillé</h4>
        {loading ? (
          <div className="space-y-2">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-3/4" />
          </div>
        ) : !data ? (
          <p className="text-[11px] text-muted-foreground">Aucun scoring disponible pour ce candidat.</p>
        ) : (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              {data.score != null && (
                <Badge variant="outline" className="text-xs">{data.score}/100</Badge>
              )}
              {data.recommendation && (
                <span className="text-[11px] text-muted-foreground">{data.recommendation}</span>
              )}
            </div>
            {data.scoring_details?.strengths?.length > 0 && (
              <div>
                <p className="text-[10px] font-medium text-emerald-600 mb-0.5">Forces</p>
                {data.scoring_details.strengths.map((s: string, i: number) => (
                  <p key={i} className="text-[10px] text-muted-foreground">• {s}</p>
                ))}
              </div>
            )}
            {data.scoring_details?.concerns?.length > 0 && (
              <div>
                <p className="text-[10px] font-medium text-amber-600 mb-0.5">Points d'attention</p>
                {data.scoring_details.concerns.map((s: string, i: number) => (
                  <p key={i} className="text-[10px] text-muted-foreground">• {s}</p>
                ))}
              </div>
            )}
            {data.scoring_details?.summary && (
              <p className="text-[10px] text-muted-foreground italic border-t border-border pt-1">{data.scoring_details.summary}</p>
            )}
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}

import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import type { MissionStageCounts } from '@/hooks/useMissionStageCounts';
import { MISSION_PIPELINE_STAGES, missionPipelineProgress } from '@/lib/missionPipelineProgress';
import { cn } from '@/lib/utils';

export function MissionPipelineDot({ name, counts, loading = false, stale = false }: {
  name: string;
  counts?: MissionStageCounts | null;
  loading?: boolean;
  stale?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const progress = missionPipelineProgress(counts);
  const label = loading && !counts ? 'Chargement du pipeline' : progress.label;
  const description = `${label}${stale && counts ? ' (dernière valeur connue)' : ''}`;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="ghost" size="icon-xs" title={description}
          aria-label={`Pipeline de ${name} : ${description}`}
          className="shrink-0 min-h-11 min-w-11 md:min-h-7 md:min-w-7">
          <span aria-hidden="true" className={cn('h-2.5 w-2.5 rounded-full',
            progress.color ?? 'border border-border-strong bg-transparent')} />
        </Button>
      </PopoverTrigger>
      <PopoverContent aria-label="Avancement du pipeline" align="start"
        onKeyDown={event => {
          if (event.key === 'Escape') {
            event.preventDefault();
            event.stopPropagation();
            setOpen(false);
          }
        }}
        className="w-72 max-h-[var(--radix-popover-content-available-height)] space-y-3 overflow-y-auto">
        <div>
          <p className="text-sm font-medium">{description}</p>
          {progress.count !== null && progress.count > 0 && (
            <p className="mt-1 text-xs text-muted-foreground">
              {progress.count} {progress.key === 'sourcing' ? 'profil' : 'candidat'}{progress.count > 1 ? 's' : ''} {progress.key === 'sourcing' ? 'à ouvrir' : 'dans cette étape'}.
            </p>
          )}
        </div>
        <p className="text-xs text-muted-foreground">Le point indique l’étape la plus avancée actuellement dans le pipeline.</p>
        <ul className="space-y-2" aria-label="Couleurs du pipeline">
          {MISSION_PIPELINE_STAGES.map(stage => (
            <li key={stage.key} className="flex items-center gap-2 text-sm">
              <span aria-hidden="true" className={cn('h-2.5 w-2.5 shrink-0 rounded-full', stage.color)} />
              <span>{stage.label}</span>
            </li>
          ))}
        </ul>
      </PopoverContent>
    </Popover>
  );
}
import { useState } from 'react';

// Refonte mission, lot 2 : une ligne de la liste des candidats (conception
// 4.2, zone 5) : case, candidat, étape, prochaine action (règle provisoire),
// ancienneté dans l'étape, note. Clic sur la ligne ou Entrée sur le nom : fiche.

import { memo } from 'react';
import { Badge } from '@/components/ui/badge';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import { provisionalNextAction, rowStageLabel, type MissionCandidateRow, type MissionStepRef } from '../types';

export const UNNAMED_CANDIDATE = 'Candidat sans nom';

export function candidateName(row: Pick<MissionCandidateRow, 'name'>): string {
  return row.name?.trim() || UNNAMED_CANDIDATE;
}

export function ScorePill({ score, title }: { score: number | null; title?: string | null }) {
  if (score === null) return null;
  const rounded = Math.round(score);
  return (
    <span
      title={title ?? undefined}
      aria-label={`Note ${rounded}`}
      className={cn(
        'inline-flex h-5 min-w-[28px] items-center justify-center rounded-full px-1.5 text-2xs font-semibold tabular-nums',
        rounded >= 70 ? 'bg-success-muted text-success' : rounded >= 40 ? 'bg-warning-muted text-warning' : 'bg-danger-muted text-danger',
      )}
    >
      {rounded}
    </span>
  );
}

interface CandidateListRowProps {
  row: MissionCandidateRow;
  steps: readonly MissionStepRef[];
  selected: boolean;
  active: boolean;
  /** Ligne gardée à sa place mais sortie du filtre après un geste. */
  dimmed: boolean;
  now: number;
  onToggle: (row: MissionCandidateRow, checked: boolean) => void;
  onOpen: (rowId: string) => void;
}

export const CandidateListRow = memo(function CandidateListRow({
  row,
  steps,
  selected,
  active,
  dimmed,
  now,
  onToggle,
  onOpen,
}: CandidateListRowProps) {
  const name = candidateName(row);
  const stage = rowStageLabel(row, steps);
  const next = provisionalNextAction(row, now);

  return (
    <tr
      data-testid="candidate-row"
      data-row-id={row.id}
      data-active={active || undefined}
      data-selected={selected || undefined}
      onClick={() => onOpen(row.id)}
      className={cn(
        'group cursor-pointer border-b border-border transition-colors duration-150 ease-out last:border-b-0',
        active ? 'bg-brand/10' : selected ? 'bg-muted/60' : 'hover:bg-muted/40',
        dimmed && 'opacity-60',
      )}
    >
      <td className="w-10 py-2.5 pl-3 pr-1 align-top" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          onCheckedChange={(value) => onToggle(row, value === true)}
          aria-label={`Sélectionner ${name}`}
          className="mt-0.5"
        />
      </td>
      <td className="min-w-0 py-2.5 pr-3 align-top">
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(row.id);
          }}
          className="block max-w-full truncate rounded-sm text-left font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {name}
        </button>
        {row.headline && <p className="truncate text-xs text-muted-foreground">{row.headline}</p>}
        <p className="mt-0.5 truncate text-xs text-muted-foreground sm:hidden">
          {stage}
          {next.text && next.text !== stage ? ` · ${next.text}` : ''}
          {dimmed ? ' · déplacé' : ''}
        </p>
      </td>
      <td className="hidden w-40 py-2.5 pr-3 align-top text-foreground sm:table-cell">
        <span className="block truncate">{stage}</span>
      </td>
      <td className="hidden w-60 py-2.5 pr-3 align-top md:table-cell">
        <span className="flex min-w-0 flex-wrap items-center gap-1.5">
          {next.text && <span className="truncate text-foreground">{next.text}</span>}
          {next.stale && (
            <Badge variant="warning" className="px-1.5 py-0 text-2xs">
              sans mouvement
            </Badge>
          )}
        </span>
      </td>
      <td className="hidden w-16 py-2.5 pr-3 align-top tabular-nums text-muted-foreground sm:table-cell">
        {next.days !== null ? `${next.days} j` : ''}
      </td>
      <td className="w-14 py-2.5 pr-3 text-right align-top">
        <ScorePill score={row.score} title={row.recommendation} />
      </td>
    </tr>
  );
});

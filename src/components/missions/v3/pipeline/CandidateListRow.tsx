// Refonte mission, lots 2 et 3 : une ligne de la liste des candidats (conception
// 4.2, zone 5) : case, candidat, étape, prochaine action (règle de la section
// 4.3, src/lib/missionNextAction.ts), ancienneté dans l'étape, note. Clic sur
// la ligne ou Entrée sur le nom : fiche.

import { memo } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { cn } from '@/lib/utils';
import type { GeneralStage } from '@/lib/candidateStage';
import { buildRowSignals, rowNextAction, type RowSignals } from '@/lib/missionNextAction';
import { rowStageLabel, type MissionCandidateRow, type MissionStepRef } from '../types';

export const UNNAMED_CANDIDATE = 'Candidat sans nom';

export function candidateName(row: Pick<MissionCandidateRow, 'name'>): string {
  return row.name?.trim() || UNNAMED_CANDIDATE;
}

/** Note du candidat : un nombre en gras, sans couleur (maquette). */
export function ScorePill({ score, title }: { score: number | null; title?: string | null }) {
  if (score === null) return null;
  const rounded = Math.round(score);
  return (
    <span title={title ?? undefined} aria-label={`Note ${rounded}`} className="text-sm font-semibold tabular-nums text-foreground">
      {rounded}
    </span>
  );
}

/** Pastille de l'étape, colorée selon l'étape (tokens du thème). */
const STAGE_PILL: Record<GeneralStage, string> = {
  replied: 'bg-brand/15 text-brand',
  retained: 'bg-warning-muted text-warning',
  hired: 'bg-success-muted text-success',
  interviewing: 'bg-muted text-foreground',
  contacted: 'bg-muted/50 text-muted-foreground',
  to_sort: 'bg-muted/50 text-muted-foreground',
  rejected: 'bg-muted/30 text-muted-foreground',
};

/** Signaux vides : lignes d'une liste qui n'affiche pas la colonne (section À trier), sans réponse ni report. */
let bareSignals: RowSignals | null = null;
function signalsWithout(now: number): RowSignals {
  if (bareSignals === null || bareSignals.now !== now) {
    bareSignals = buildRowSignals({ now, attention: null, snoozed: null, interlocutor: null, orgType: null });
  }
  return bareSignals;
}

/** Colonnes affichées selon la place du tableau (CandidateList). */
export interface CandidateListColumns {
  stage: boolean;
  next: boolean;
  since: boolean;
}

const ALL_COLUMNS: CandidateListColumns = { stage: true, next: true, since: true };

interface CandidateListRowProps {
  row: MissionCandidateRow;
  steps: readonly MissionStepRef[];
  selected: boolean;
  active: boolean;
  /** Ligne gardée à sa place mais sortie du filtre après un geste. */
  dimmed: boolean;
  /** Colonnes affichées ; toutes par défaut. */
  columns?: CandidateListColumns;
  /** compact : lignes de la section À trier (nom, titre, note), séparées par un filet haut. */
  variant?: 'default' | 'compact';
  now: number;
  /** Réponses, reports et interlocuteur de la mission, construits une fois pour toutes les lignes. */
  signals?: RowSignals;
  onToggle: (row: MissionCandidateRow, checked: boolean) => void;
  onOpen: (rowId: string) => void;
}

export const CandidateListRow = memo(function CandidateListRow({
  row,
  steps,
  selected,
  active,
  dimmed,
  columns = ALL_COLUMNS,
  variant = 'default',
  now,
  signals,
  onToggle,
  onOpen,
}: CandidateListRowProps) {
  const name = candidateName(row);
  const stage = rowStageLabel(row, steps);
  const next = rowNextAction(row, signals ?? signalsWithout(now));

  const compact = variant === 'compact';
  // Sans colonne Étape, l'étape passe sous le nom ; inutile dans À trier (toutes les lignes y sont).
  const stageUnderName = !columns.stage && !(compact && row.stage === 'to_sort' && !dimmed);
  // Liste étroite hors À trier (téléphone) : nom, puis « Étape · action », sans intitulé du poste (maquette).
  const narrow = !compact && !columns.stage;
  const stageText = dimmed ? `Déplacé vers ${stage}` : stage;
  const nextText = !compact && next.text && next.text !== stage ? next.text : null;

  return (
    <tr
      data-testid="candidate-row"
      data-row-id={row.id}
      data-active={active || undefined}
      data-selected={selected || undefined}
      onClick={() => onOpen(row.id)}
      className={cn(
        'group cursor-pointer transition-colors duration-150 ease-out',
        compact ? 'border-t border-border/50' : 'border-b border-border/50',
        active ? 'bg-brand/10' : selected ? 'bg-muted/60' : dimmed ? 'bg-muted/30 hover:bg-muted/40' : 'hover:bg-muted/40',
      )}
    >
      <td className={cn('w-10 py-2 pr-1 align-middle', compact ? 'pl-2' : 'pl-3 sm:pl-2')} onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={selected}
          onCheckedChange={(value) => onToggle(row, value === true)}
          aria-label={`Sélectionner ${name}`}
        />
      </td>
      <td className={cn('min-w-0 py-2 pr-3 align-middle', narrow ? 'h-14' : 'h-[50px]')}>
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onOpen(row.id);
          }}
          className={cn(
            'block max-w-full truncate rounded-sm text-left font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            narrow ? 'text-base' : 'text-sm',
          )}
        >
          {name}
        </button>
        {!narrow && row.headline && <p className="truncate text-xs text-muted-foreground">{row.headline}</p>}
        {narrow ? (
          <p className="mt-px truncate text-sm">
            <span className="text-muted-foreground">{stageText}</span>
            {nextText && <span className="text-foreground"> · {nextText}</span>}
          </p>
        ) : (
          stageUnderName && (
            <p className="mt-0.5 truncate text-xs text-muted-foreground">
              {stageText}
              {nextText ? ` · ${nextText}` : ''}
            </p>
          )
        )}
      </td>
      {columns.stage && (
        <td className="w-48 py-2 pr-3 align-middle">
          <span className={cn('inline-block max-w-full truncate rounded-md px-2 py-0.5 text-xs', STAGE_PILL[row.stage])}>{stage}</span>
          {/* Ligne sortie du filtre après un geste : gardée à sa place, dite déplacée. */}
          {dimmed && <span className="block text-xs text-muted-foreground">déplacé</span>}
        </td>
      )}
      {columns.next && (
        <td className="w-[19rem] py-2 pr-3 align-middle">
          {next.text && (
            <span
              className={cn('block truncate text-sm', next.stale ? 'text-warning' : 'text-muted-foreground')}
              title={next.stale ? 'Sans mouvement' : undefined}
            >
              {next.text}
              {next.stale && <span className="sr-only">, sans mouvement</span>}
            </span>
          )}
        </td>
      )}
      {columns.since && (
        <td className="w-14 py-2 pr-3 text-right align-middle tabular-nums text-muted-foreground">
          {next.days !== null ? `${next.days}\u00a0j` : ''}
        </td>
      )}
      <td className={cn('w-12 py-2 text-right align-middle', compact ? 'pr-2' : 'pr-3 sm:pr-2')}>
        <ScorePill score={row.score} title={row.recommendation} />
      </td>
    </tr>
  );
});

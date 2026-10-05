// Refonte mission, lots 2 et 3 : une ligne de la liste des candidats (conception
// 4.2, zone 5) : case, candidat (visage, nom, titre), étape avec l'ancienneté
// dessous, prochaine action (règle de la section 4.3,
// src/lib/missionNextAction.ts), note en anneau. Clic sur la ligne ou Entrée
// sur le nom : fiche.
//
// Design simplifié (04/10/2026) : plus de colonne « Depuis » ni de « Aucune
// action depuis 0 j » (l'ancienneté passe sous l'étape, en orange quand le
// candidat n'avance plus), plus de pastille colorée par étape, l'action
// n'apparaît que lorsqu'il y en a une.

import { memo } from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { PersonAvatar } from '@/components/ui/person-avatar';
import { cn } from '@/lib/utils';
import { buildRowSignals, rowNextAction, type RowSignals } from '@/lib/missionNextAction';
import { rowStageLabel, type MissionCandidateRow, type MissionStepRef } from '../types';

export const UNNAMED_CANDIDATE = 'Candidat sans nom';

export function candidateName(row: Pick<MissionCandidateRow, 'name'>): string {
  return row.name?.trim() || UNNAMED_CANDIDATE;
}

/** Anneau de la note : couleur de marque pour tous les niveaux (maquette), le nombre au centre. */
const RING_SIZE = 32;
const RING_RADIUS = 13;
const RING_LENGTH = 2 * Math.PI * RING_RADIUS;

export function ScorePill({ score, title }: { score: number | null; title?: string | null }) {
  if (score === null) return null;
  const rounded = Math.round(score);
  const share = Math.max(0, Math.min(100, rounded)) / 100;
  return (
    <span
      title={title ?? undefined}
      aria-label={`Note ${rounded}`}
      className="relative inline-flex shrink-0 items-center justify-center text-xs font-semibold tabular-nums text-foreground"
      style={{ width: RING_SIZE, height: RING_SIZE }}
    >
      <svg viewBox={`0 0 ${RING_SIZE} ${RING_SIZE}`} className="absolute inset-0 -rotate-90" aria-hidden="true">
        <circle cx={RING_SIZE / 2} cy={RING_SIZE / 2} r={RING_RADIUS} fill="none" strokeWidth={2.5} className="stroke-foreground/15" />
        <circle
          cx={RING_SIZE / 2}
          cy={RING_SIZE / 2}
          r={RING_RADIUS}
          fill="none"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeDasharray={`${RING_LENGTH * share} ${RING_LENGTH}`}
          className="stroke-brand"
        />
      </svg>
      <span className="relative">{rounded}</span>
    </span>
  );
}

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
}

const ALL_COLUMNS: CandidateListColumns = { stage: true, next: true };

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
  // Seule une vraie action s'écrit : le texte de repos (« Aucune action depuis N j ») n'est plus affiché.
  const actionText = !compact && next.rank !== null && next.text ? next.text : null;
  // Ancienneté dans l'étape : rien avant un jour révolu, ni pour un candidat écarté ou à trier.
  const ageText = next.days !== null && next.days >= 1 && row.stage !== 'rejected' && row.stage !== 'to_sort' ? `depuis\u00a0${next.days}\u00a0j` : null;

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
      <td className={cn('min-w-0 py-2 pr-3 align-middle', narrow ? 'h-14' : 'h-[56px]')}>
        <div className="flex min-w-0 items-center gap-3">
          <PersonAvatar name={row.name} src={row.pictureUrl} candidateId={row.candidateId} size={32} />
          <div className="min-w-0 flex-1">
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
            {!narrow && row.headline && <p className="truncate text-sm text-muted-foreground">{row.headline}</p>}
            {narrow ? (
              <p className="mt-px truncate text-sm">
                <span className="text-muted-foreground">{stageText}</span>
                {actionText && <span className="text-foreground"> · {actionText}</span>}
              </p>
            ) : (
              stageUnderName && (
                <p className="mt-0.5 truncate text-sm text-muted-foreground">
                  {stageText}
                  {actionText ? ` · ${actionText}` : ''}
                </p>
              )
            )}
          </div>
        </div>
      </td>
      {columns.stage && (
        <td className="w-40 py-2 pr-3 align-middle">
          <span className="block truncate text-sm text-foreground-secondary">{stage}</span>
          {/* Ligne sortie du filtre après un geste : gardée à sa place, dite déplacée. */}
          {dimmed ? (
            <span className="block text-sm text-muted-foreground">déplacé</span>
          ) : (
            ageText && (
              <span className={cn('block truncate text-sm', next.stale ? 'text-warning' : 'text-muted-foreground')} title={next.stale ? 'Sans mouvement' : undefined}>
                {ageText}
                {next.stale && <span className="sr-only">, sans mouvement</span>}
              </span>
            )
          )}
        </td>
      )}
      {columns.next && (
        <td className="w-[15rem] py-2 pr-3 align-middle">
          {actionText && (
            <span className={cn('block truncate text-sm font-medium', next.rank === '3' ? 'text-warning' : 'text-foreground')}>{actionText}</span>
          )}
        </td>
      )}
      <td className={cn('w-14 py-2 text-right align-middle', compact ? 'pr-2' : 'pr-3 sm:pr-2')}>
        <ScorePill score={row.score} title={row.recommendation} />
      </td>
    </tr>
  );
});

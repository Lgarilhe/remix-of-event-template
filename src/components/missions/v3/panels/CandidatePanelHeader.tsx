// Refonte mission, lot 2 : en-tête de la fiche candidat (conception 4.4).
// Toujours visible : le nom, le poste, la note ; l'étape et depuis quand ; la
// prochaine action (règle provisoire du lot 2) ; le bouton principal qui dépend
// de l'étape, « Déplacer vers » et « Écarter ». Changer d'étape ne ferme pas la
// fiche. Flèches : candidat précédent ou suivant dans la liste affichée.
import { useEffect, useRef } from 'react';
import { ArrowRightLeft, Check, ChevronDown, ChevronUp, ExternalLink, UserX, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';
import { stageLabel } from '@/lib/stageDisplay';
import {
  moveOptions,
  nextStageOption,
  provisionalNextAction,
  rowStageLabel,
  stageFilterParam,
  type MissionCandidateRow,
  type MissionStepRef,
  type MoveOption,
  type StageMoveRequest,
} from '../types';
import { milestoneTexts, sinceText, type ScoreReasons } from './candidateAdapters';

export interface CandidatePanelHeaderProps {
  titleId: string;
  row: MissionCandidateRow;
  steps: readonly MissionStepRef[];
  name: string;
  position: string | null;
  location: string | null;
  reasons: ScoreReasons | null;
  canMove: boolean;
  moveDisabledReason: string | null;
  isMoving: boolean;
  onMove: (option: MoveOption, verb: StageMoveRequest['verb']) => void;
  onClose: () => void;
  onPrevious: (() => void) | null;
  onNext: (() => void) | null;
}

function ScoreBadge({ score }: { score: number }) {
  const rounded = Math.round(score);
  return (
    <span
      className={cn(
        'inline-flex h-6 shrink-0 items-center rounded-full px-2 text-xs font-semibold tabular-nums',
        rounded >= 70 ? 'bg-success-muted text-success' : rounded >= 40 ? 'bg-warning-muted text-warning' : 'bg-danger-muted text-danger',
      )}
    >
      Note {rounded}
    </span>
  );
}

/** Clé de l'étape actuelle de la ligne, au format des options (stageFilterParam). */
function currentKey(row: Pick<MissionCandidateRow, 'stage' | 'processStepId'>): string {
  return stageFilterParam({ stage: row.stage, stepId: row.stage === 'interviewing' ? row.processStepId : null });
}

function verbFor(option: MoveOption): StageMoveRequest['verb'] {
  if (option.target.stage === 'retained') return 'retenu';
  if (option.target.stage === 'rejected') return 'écarté';
  return 'déplacé';
}

function nextLabel(option: MoveOption): string {
  return option.target.stage === 'retained' ? 'Retenir' : `Passer à ${option.label}`;
}

export function CandidatePanelHeader({
  titleId,
  row,
  steps,
  name,
  position,
  location,
  reasons,
  canMove,
  moveDisabledReason,
  isMoving,
  onMove,
  onClose,
  onPrevious,
  onNext,
}: CandidatePanelHeaderProps) {
  const currentLabel = rowStageLabel(row, steps);
  const action = provisionalNextAction(row);
  const since = sinceText(action.days);
  const next = nextStageOption(row, steps);
  const options = moveOptions(steps);
  const current = currentKey(row);
  const disabled = !canMove || isMoving;
  const milestones = milestoneTexts(row);
  const showAction = action.text !== null && action.text !== currentLabel;
  const rejectedFrom = row.stage === 'rejected' ? stageLabel(row.rejectedFromStage) : null;

  // « Écarter » disparaît quand la ligne est écartée : le focus qu'il avait
  // passe à « Déplacer vers », jamais sur la page entière.
  const moveTriggerRef = useRef<HTMLButtonElement>(null);
  const previousStage = useRef(row.stage);
  useEffect(() => {
    const was = previousStage.current;
    previousStage.current = row.stage;
    if (was === 'rejected' || row.stage !== 'rejected') return;
    const active = document.activeElement;
    if (active === null || active === document.body) moveTriggerRef.current?.focus({ preventScroll: true });
  }, [row.stage]);

  return (
    <div className="border-b border-border px-4 pb-4 pt-3 sm:px-5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Candidat précédent"
            title="Candidat précédent (flèche haut)"
            className="min-h-11 min-w-11 lg:min-h-0 lg:min-w-0"
            disabled={!onPrevious}
            onClick={() => onPrevious?.()}
          >
            <ChevronUp className="h-4 w-4" aria-hidden="true" />
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="icon-sm"
            aria-label="Candidat suivant"
            title="Candidat suivant (flèche bas)"
            className="min-h-11 min-w-11 lg:min-h-0 lg:min-w-0"
            disabled={!onNext}
            onClick={() => onNext?.()}
          >
            <ChevronDown className="h-4 w-4" aria-hidden="true" />
          </Button>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label="Fermer le panneau"
          title="Fermer (Échap)"
          className="min-h-11 min-w-11 lg:min-h-0 lg:min-w-0"
          onClick={onClose}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </Button>
      </div>

      <div className="mt-2 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id={titleId} tabIndex={-1} className="break-words text-lg font-semibold leading-tight text-foreground outline-none">
            {name}
          </h2>
          {position && <p className="mt-0.5 break-words text-sm text-muted-foreground">{position}</p>}
          {(location || row.linkedinUrl) && (
            <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
              {location && <span>{location}</span>}
              {row.linkedinUrl && (
                <a
                  href={row.linkedinUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 rounded-sm underline-offset-4 transition-colors duration-150 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  Profil LinkedIn
                  <ExternalLink className="h-3 w-3" aria-hidden="true" />
                  <span className="sr-only">(nouvel onglet)</span>
                </a>
              )}
            </p>
          )}
        </div>
        {row.score !== null && <ScoreBadge score={row.score} />}
      </div>

      <div className="mt-3 space-y-1 text-sm">
        <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-foreground">
            {currentLabel}
          </span>
          {since && <span className="text-muted-foreground">{since}</span>}
          {action.stale && (
            <span className="inline-flex items-center rounded-full bg-warning-muted px-2 py-0.5 text-2xs font-medium text-warning">
              sans mouvement
            </span>
          )}
        </p>
        {rejectedFrom && <p className="text-xs text-muted-foreground">Écarté à l'étape {rejectedFrom}.</p>}
        {showAction && (
          <p className="text-muted-foreground">
            <span className="text-foreground">Prochaine action : </span>
            {action.text}
          </p>
        )}
        {milestones.length > 0 && <p className="text-xs text-muted-foreground">{milestones.join(' · ')}</p>}
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {next && (
          <Button type="button" variant="primary" size="sm" disabled={disabled} onClick={() => onMove(next, verbFor(next))}>
            <Check className="mr-1.5 h-4 w-4" aria-hidden="true" />
            {nextLabel(next)}
          </Button>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button ref={moveTriggerRef} type="button" variant="outline" size="sm" disabled={disabled}>
              <ArrowRightLeft className="mr-1.5 h-4 w-4" aria-hidden="true" />
              Déplacer vers
              <ChevronDown className="ml-1 h-3.5 w-3.5 opacity-70" aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="max-h-80 overflow-y-auto">
            {options
              .filter((option) => option.target.stage !== 'rejected')
              .map((option) => {
                const isCurrent = option.key === current;
                return (
                  <DropdownMenuItem
                    key={option.key}
                    disabled={isCurrent}
                    onSelect={() => onMove(option, verbFor(option))}
                  >
                    <span className="flex-1">{option.label}</span>
                    {isCurrent && <span className="ml-3 text-xs text-muted-foreground">étape actuelle</span>}
                  </DropdownMenuItem>
                );
              })}
          </DropdownMenuContent>
        </DropdownMenu>
        {row.stage !== 'rejected' && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            disabled={disabled}
            onClick={() => {
              const reject = options.find((o) => o.target.stage === 'rejected');
              if (reject) onMove(reject, 'écarté');
            }}
          >
            <UserX className="mr-1.5 h-4 w-4" aria-hidden="true" />
            Écarter
          </Button>
        )}
      </div>
      {!canMove && moveDisabledReason && <p className="mt-2 text-xs text-muted-foreground">{moveDisabledReason}</p>}

      {reasons && (
        <div className="mt-4 rounded-lg bg-muted/40 p-3 text-sm">
          <p className="text-xs font-medium text-foreground">Pourquoi cette note</p>
          {reasons.summary && <p className="mt-1 text-muted-foreground">{reasons.summary}</p>}
          {(reasons.strengths.length > 0 || reasons.concerns.length > 0) && (
            <div className="mt-2 grid gap-3 sm:grid-cols-2">
              {reasons.strengths.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-success">Points forts</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                    {reasons.strengths.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
              {reasons.concerns.length > 0 && (
                <div>
                  <p className="text-xs font-medium text-warning">Réserves</p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                    {reasons.concerns.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

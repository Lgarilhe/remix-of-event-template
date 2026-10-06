// Refonte mission, lot 2 : en-tête de la fiche candidat (conception 4.4,
// maquette FicheCandidat). Rangée collante : le nom, la place dans la liste,
// les flèches et la croix ; dessous le poste, le lieu et la note. Puis la
// section Étape : l'étape et depuis quand, la prochaine action (règle de la
// section 4.3, lot 3), Contacter pour un Retenu, « Étape suivante »,
// « Déplacer vers », « Déjà contacté » et « Écarter ». Changer d'étape ne ferme
// pas la fiche. Flèches : candidat précédent ou suivant dans la liste affichée.
import { useEffect, useRef, type ReactNode } from 'react';
import { ChevronDown, ChevronUp, ExternalLink, X } from 'lucide-react';
import { badgeVariants } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PersonAvatar } from '@/components/ui/person-avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { useMissionRowSignals } from '@/hooks/useMissionNow';
import { rowNextAction } from '@/lib/missionNextAction';
import { cn } from '@/lib/utils';
import { stageLabel } from '@/lib/stageDisplay';
import { useMissionV3 } from '../MissionV3Context';
import {
  moveOptions,
  nextStageOption,
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
  /** Photo de la ligne ou du profil chargé ; absente, ce sont les initiales. */
  pictureUrl: string | null;
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
  /** Place dans la liste affichée (« 3 sur 12 ») ; null hors de la liste. */
  rank: { index: number; total: number } | null;
  /** Action propre à l'étape, avant « Étape suivante » (Contacter pour un Retenu) ; null sinon. */
  contactAction: ReactNode;
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

/** « Retenir » depuis À trier (mot de la conception, section 11), sinon « Étape suivante : … ». */
function nextLabel(option: MoveOption): string {
  return option.target.stage === 'retained' ? 'Retenir' : `Étape suivante : ${option.label}`;
}

export function CandidatePanelHeader({
  titleId,
  row,
  steps,
  name,
  pictureUrl,
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
  rank,
  contactAction,
}: CandidatePanelHeaderProps) {
  const currentLabel = rowStageLabel(row, steps);
  const { project } = useMissionV3();
  const action = rowNextAction(row, useMissionRowSignals(project));
  const since = sinceText(action.days);
  const options = moveOptions(steps);
  const contacted =
    row.stage === 'to_sort' || row.stage === 'retained'
      ? options.find((o) => o.target.stage === 'contacted') ?? null
      : null;
  // Pour un Retenu, l'étape suivante (Contacté) est déjà « Déjà contacté » :
  // un seul bouton pour la même écriture, Contacter restant l'action principale.
  const nextOption = nextStageOption(row, steps);
  const next = contacted && nextOption?.target.stage === 'contacted' ? null : nextOption;
  const current = currentKey(row);
  const disabled = !canMove || isMoving;
  const milestones = milestoneTexts(row);
  // Prochaine action (règle de la section 4.3) : seulement si elle ajoute
  // quelque chose à la ligne d'étape (« depuis aujourd'hui » y est déjà dit ;
  // une action de la règle, comme « Répondre », s'affiche toujours).
  const showAction = action.text !== null && action.text !== currentLabel && (action.days !== 0 || action.rank !== null);
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

  const reject = row.stage !== 'rejected' ? options.find((o) => o.target.stage === 'rejected') ?? null : null;
  const meta = [location, row.score !== null ? `Note ${Math.round(row.score)}` : null].filter(Boolean).join(' · ');

  return (
    <>
      <div className="sticky top-0 z-10 flex items-start gap-3 border-b border-border bg-background py-3 pl-5 pr-3">
        <PersonAvatar name={name} src={pictureUrl} candidateId={row.candidateId} size={40} className="mt-0.5" />
        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
          <div className="flex items-center gap-0.5">
            <h2
              id={titleId}
              tabIndex={-1}
              title={name}
              className="min-w-0 flex-1 break-words text-lg font-semibold leading-tight text-foreground outline-none line-clamp-2"
            >
              {name}
            </h2>
            {rank && (
              <span className="mr-1.5 whitespace-nowrap text-xs tabular-nums text-muted-foreground max-sm:hidden">
                {rank.index} sur {rank.total}
              </span>
            )}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Candidat précédent"
              title="Candidat précédent (flèche haut)"
              className="min-h-11 min-w-11 shrink-0 lg:min-h-0 lg:min-w-0"
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
              className="min-h-11 min-w-11 shrink-0 lg:min-h-0 lg:min-w-0"
              disabled={!onNext}
              onClick={() => onNext?.()}
            >
              <ChevronDown className="h-4 w-4" aria-hidden="true" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label="Fermer le panneau"
              title="Fermer (Échap)"
              className="min-h-11 min-w-11 shrink-0 lg:min-h-0 lg:min-w-0"
              onClick={onClose}
            >
              <X className="h-4 w-4" aria-hidden="true" />
            </Button>
          </div>
          {position && (
            <p title={position} className="truncate text-sm text-foreground-secondary">
              {position}
            </p>
          )}
          {(meta || row.linkedinUrl || rank) && (
            <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
              {meta && <span>{meta}</span>}
              {/* Sur téléphone, « N sur M » quitte la rangée du nom pour lui laisser la place. */}
              {rank && (
                <span className="sm:hidden">
                  {rank.index} sur {rank.total}
                </span>
              )}
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
      </div>

      <section aria-label="Étape du candidat" className="flex flex-col gap-3 px-5 py-4">
        <div className="flex flex-col gap-1">
          <div className="flex items-start gap-2">
            <p className="min-w-0 flex-1 pt-1 text-md font-semibold text-foreground">
              {currentLabel}
              {since ? `, ${since}` : ''}
              {action.stale && (
                <span className={cn(badgeVariants({ variant: 'warning' }), 'ml-2 translate-y-[-1px] align-middle text-2xs')}>
                  sans mouvement
                </span>
              )}
            </p>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  ref={moveTriggerRef}
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={disabled}
                  className="-mr-2.5 shrink-0 text-foreground-secondary hover:text-foreground"
                >
                  Déplacer vers
                  <ChevronDown className="h-3.5 w-3.5" aria-hidden="true" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="max-h-80 overflow-y-auto">
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
          </div>
          {rejectedFrom && <p className="text-xs text-muted-foreground">Écarté à l'étape {rejectedFrom}.</p>}
          {showAction && <p className="text-xs text-muted-foreground">{action.text}</p>}
          {milestones.length > 0 && <p className="text-xs text-muted-foreground">{milestones.join(' · ')}</p>}
        </div>

        {(contactAction || next) && (
          <div className="flex flex-wrap items-center gap-2">
            {contactAction}
            {next && (
              <Button type="button" variant="outline" size="default" disabled={disabled} onClick={() => onMove(next, verbFor(next))}>
                {nextLabel(next)}
              </Button>
            )}
          </div>
        )}

        {(contacted || reject) && (
          <div className="-mx-2.5 flex items-center gap-1">
            {contacted && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                className="text-foreground-secondary hover:text-foreground"
                onClick={() => onMove(contacted, 'déplacé')}
              >
                Déjà contacté (téléphone, e-mail, LinkedIn)
              </Button>
            )}
            <div className="flex-1" />
            {reject && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={disabled}
                className="shrink-0 text-danger hover:bg-danger-muted hover:text-danger"
                onClick={() => onMove(reject, 'écarté')}
              >
                Écarter
              </Button>
            )}
          </div>
        )}
        {!canMove && moveDisabledReason && <p className="text-xs text-muted-foreground">{moveDisabledReason}</p>}
      </section>

      {reasons && (
        <section aria-label="Pourquoi cette note" className="border-t border-border px-5 py-4 text-sm">
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
        </section>
      )}
    </>
  );
}

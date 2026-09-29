// Refonte mission, écran Cadrage : Étapes d'entretien (conception 5.6).
// Tableau : nom, intervieweur, candidats « En ce moment » (get_mission_stage_counts,
// même lecture que la barre d'étapes du Pipeline, jamais de zéro inventé),
// réordonnancement au clavier (Monter, Descendre), suppression confirmée qui
// déplace d'abord les candidats de l'étape (DeleteStepDialog). Écritures des
// étapes : mutations de useMissionProcess. Les champs de réunion (durée,
// format, visio, adresse, éliminatoire, objectifs) ne sont plus affichés :
// leurs données restent en base.
import { useEffect, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, ChevronDown, GripVertical, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PROCESS_TEMPLATES } from '@/components/missions/process/shared';
import { useMissionProcess, type ProcessStep } from '@/hooks/useMissionProcess';
import { useMissionStageCounts } from '@/hooks/useMissionStageCounts';
import { useOrganization } from '@/hooks/useOrganization';
import type { SourcingProject } from '@/hooks/useSourcingProjects';
import { cn } from '@/lib/utils';
import { initialsOf, movedOrder, stepCountLabel } from './cadrageModel';
import { DeleteStepDialog } from './DeleteStepDialog';
import { useOrgMemberNames } from './TeamSection';

const ROW_GRID =
  'grid grid-cols-[28px_18px_minmax(0,1fr)_32px] items-center gap-x-3 gap-y-1.5 sm:grid-cols-[28px_18px_minmax(0,0.8fr)_minmax(0,1.5fr)_104px_32px]';

type CountState = { kind: 'loading' } | { kind: 'error' } | { kind: 'ready'; byStep: Record<string, number> };

/** Nom d'étape enregistré à la sortie du champ ; vide : l'ancien nom revient. */
function StepNameInput({
  step,
  index,
  readOnly,
  onCommit,
}: {
  step: ProcessStep;
  index: number;
  readOnly: boolean;
  onCommit: (name: string) => void;
}) {
  const [draft, setDraft] = useState(step.name ?? '');
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(step.name ?? '');
  }, [step.name, focused]);
  const commit = () => {
    const name = draft.trim();
    if (!name) setDraft(step.name ?? '');
    else if (name !== (step.name ?? '').trim()) onCommit(name);
  };
  return (
    <Input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        commit();
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      disabled={readOnly}
      aria-label={`Nom de l'étape ${index + 1}`}
      placeholder="Nom de l'étape"
      autoComplete="off"
      className="h-[34px] min-w-0 font-medium"
    />
  );
}

/** Nom de l'intervieweur extérieur, enregistré à la sortie du champ. */
function ExternalNameInput({
  step,
  stepName,
  readOnly,
  autoFocus,
  onCommit,
}: {
  step: ProcessStep;
  stepName: string;
  readOnly: boolean;
  autoFocus: boolean;
  onCommit: (name: string | null) => void;
}) {
  const [draft, setDraft] = useState(step.interviewer_name ?? '');
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!focused) setDraft(step.interviewer_name ?? '');
  }, [step.interviewer_name, focused]);
  useEffect(() => {
    if (autoFocus) ref.current?.focus();
  }, [autoFocus]);
  return (
    <Input
      ref={ref}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onFocus={() => setFocused(true)}
      onBlur={() => {
        setFocused(false);
        const name = draft.trim();
        if (name !== (step.interviewer_name ?? '').trim()) onCommit(name || null);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          (e.target as HTMLInputElement).blur();
        }
      }}
      disabled={readOnly}
      aria-label={`Nom et fonction de l'intervieweur de l'étape ${stepName}`}
      placeholder="Nom et fonction"
      autoComplete="off"
      className="h-[34px] min-w-0 text-[13px]"
    />
  );
}

export function InterviewStepsSection({ project, readOnly }: { project: SourcingProject; readOnly: boolean }) {
  const {
    steps,
    team,
    loadingSteps,
    loadingTeam,
    stepsError,
    refetchSteps,
    addStep,
    updateStep,
    deleteStep,
    reorderSteps,
    initializeFromTemplate,
    isAdding,
  } = useMissionProcess(project.id);
  const countsQuery = useMissionStageCounts([project.id]);
  const { organizationName } = useOrganization();
  const { members, nameOf, knownNameOf } = useOrgMemberNames(project.organization_id ?? null);

  // Ordre affiché pendant l'écriture d'un réordonnancement.
  const [order, setOrder] = useState<string[] | null>(null);
  const [reordering, setReordering] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);
  const [announce, setAnnounce] = useState('');
  const [refocus, setRefocus] = useState<{ id: string; dir: 'up' | 'down' } | null>(null);
  const [extFocusId, setExtFocusId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<ProcessStep | null>(null);
  const [adding, setAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const listRef = useRef<HTMLDivElement>(null);

  const stepIds = steps.map((s) => s.id).join(',');
  const sameSet = order !== null && order.length === steps.length && order.every((id) => steps.some((s) => s.id === id));
  const displayed = sameSet ? order!.map((id) => steps.find((s) => s.id === id)!) : steps;
  useEffect(() => {
    if (order !== null && (!sameSet || order.join(',') === stepIds)) setOrder(null);
  }, [order, sameSet, stepIds]);

  // Le focus suit le bouton pressé quand la ligne change de place.
  useEffect(() => {
    if (!refocus) return;
    const root = listRef.current;
    const wanted = root?.querySelector<HTMLButtonElement>(`[data-move="${refocus.id}:${refocus.dir}"]`);
    const fallback = root?.querySelector<HTMLButtonElement>(`[data-move="${refocus.id}:done"]`);
    (wanted && !wanted.disabled ? wanted : fallback)?.focus();
    setRefocus(null);
  }, [refocus, displayed]);

  const counts: CountState = countsQuery.isLoading
    ? { kind: 'loading' }
    : countsQuery.data?.[project.id]
      ? { kind: 'ready', byStep: countsQuery.data[project.id].interviewingByStep }
      : { kind: 'error' };

  const teamIds = new Set(team.map((m) => m.user_id));
  const orgLabel = organizationName?.trim() || 'votre organisation';

  const move = async (step: ProcessStep, dir: 'up' | 'down') => {
    const ids = displayed.map((s) => s.id);
    const next = movedOrder(ids, step.id, dir === 'up' ? -1 : 1);
    if (!next || reordering) return;
    setOrder(next);
    setRefocus({ id: step.id, dir });
    setAnnounce(`Étape « ${step.name?.trim() || 'sans nom'} » en position ${next.indexOf(step.id) + 1} sur ${next.length}.`);
    setReordering(true);
    try {
      await reorderSteps(next);
    } catch {
      setOrder(null);
    } finally {
      setReordering(false);
    }
  };

  const submitNew = async () => {
    const name = newName.trim();
    if (!name) return;
    try {
      await addStep({ name });
      setNewName('');
      setAdding(false);
    } catch {
      // Refus annoncé par useMissionProcess.
    }
  };

  const stepsFailed = stepsError && !loadingSteps && steps.length === 0;

  return (
    <section id="cadrage-etapes" aria-labelledby="cadrage-etapes-titre" className="flex scroll-mt-4 flex-col gap-2.5">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
        <h2 id="cadrage-etapes-titre" className="text-2xs font-semibold uppercase tracking-wider text-muted-foreground">
          Étapes d'entretien
        </h2>
        <span className="text-[12.5px] text-muted-foreground">Dans l'ordre où le candidat les passe.</span>
      </div>

      <div ref={listRef} className="flex flex-col rounded-xl border border-border bg-card px-4 py-1">
        <p className="sr-only" aria-live="polite">
          {announce}
        </p>

        {loadingSteps ? (
          <div className="flex flex-col gap-2 py-2.5" aria-hidden="true">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-3/4" />
          </div>
        ) : stepsFailed ? (
          <div className="flex flex-wrap items-center gap-3 py-4 text-[13px] text-muted-foreground" role="alert">
            <span>Impossible de charger les étapes pour l'instant.</span>
            <Button type="button" variant="outline" size="sm" onClick={() => void refetchSteps()}>
              Réessayer
            </Button>
          </div>
        ) : displayed.length === 0 ? (
          <div className="flex flex-col gap-3 py-4">
            <p className="text-[13px] text-muted-foreground">Aucune étape. Ajoutez au moins une étape pour suivre les entretiens.</p>
            {!readOnly && (
              <div className="flex flex-col gap-2">
                <span className="text-xs text-muted-foreground">Ou partez d'un modèle :</span>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {Object.entries(PROCESS_TEMPLATES).map(([key, tpl]) => (
                    <button
                      key={key}
                      type="button"
                      disabled={isAdding}
                      onClick={() => void initializeFromTemplate(tpl.steps, tpl.label)}
                      className={cn(
                        'flex flex-col gap-0.5 rounded-lg border border-border bg-background px-3 py-2 text-left transition-colors',
                        'hover:border-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                        'disabled:cursor-not-allowed disabled:opacity-50',
                      )}
                    >
                      <span className="text-[13px] font-medium text-foreground">{tpl.label}</span>
                      <span className="text-xs text-muted-foreground">{tpl.steps.map((s) => s.name).join(', ')}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          <>
            <div className={cn(ROW_GRID, 'hidden h-7 text-xs text-muted-foreground sm:grid')} aria-hidden="true">
              <span />
              <span />
              <span>Étape</span>
              <span>Intervieweur</span>
              <span>En ce moment</span>
              <span />
            </div>
            {displayed.map((step, index) => {
              const name = step.name?.trim() || 'sans nom';
              const moving = movingId === step.id && !readOnly;
              const userId = step.interviewer_user_id;
              const isExt = !userId && step.interviewer_type === 'client';
              const whoName = userId
                ? knownNameOf(userId) || step.interviewer_name?.trim() || nameOf(userId)
                : step.interviewer_name?.trim() || (step.interviewer_type === 'panel' ? 'Plusieurs personnes' : '');
              const whoLabel = whoName || (isExt ? 'Nom à préciser' : 'À préciser');
              const current = userId ? `member:${userId}` : isExt ? 'external' : 'none';
              const count =
                counts.kind === 'loading' ? (
                  <Skeleton className="h-4 w-16" />
                ) : counts.kind === 'error' ? (
                  <span className="text-muted-foreground">indisponible</span>
                ) : (
                  stepCountLabel(counts.byStep[step.id] ?? 0)
                );

              return (
                <div key={step.id} className={cn('flex flex-col border-t border-border', index === 0 && 'max-sm:border-t-0')}>
                  <div
                    className={cn(
                      ROW_GRID,
                      '-mx-2 rounded-lg px-2 py-1.5 sm:min-h-11',
                      moving && 'bg-accent',
                    )}
                  >
                    {readOnly ? (
                      <span aria-hidden="true" />
                    ) : (
                      <button
                        type="button"
                        aria-pressed={moving}
                        aria-label={`Réordonner l'étape ${name}`}
                        onClick={() => setMovingId(moving ? null : step.id)}
                        className={cn(
                          'grid h-8 w-7 place-items-center rounded-md transition-colors hover:bg-accent',
                          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
                          moving ? 'text-foreground' : 'text-muted-foreground',
                        )}
                      >
                        <GripVertical className="h-4 w-4" aria-hidden="true" />
                      </button>
                    )}
                    <span className="text-right text-[12.5px] tabular-nums text-muted-foreground" aria-hidden="true">
                      {index + 1}
                    </span>
                    <StepNameInput
                      step={step}
                      index={index}
                      readOnly={readOnly}
                      onCommit={(value) => void updateStep({ id: step.id, name: value }).catch(() => undefined)}
                    />
                    <div className="col-start-3 row-start-2 min-w-0 sm:col-start-auto sm:row-start-auto">
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild disabled={readOnly}>
                          <button
                            type="button"
                            aria-label={`Intervieweur de l'étape ${name} : ${whoLabel}${isExt ? ', hors Konekt' : ''}`}
                            className={cn(
                              'flex h-[34px] w-full min-w-0 items-center gap-2 rounded-lg border border-input bg-background px-2.5 text-left text-[13px] transition-colors',
                              'hover:border-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/20',
                              'disabled:cursor-not-allowed disabled:opacity-60',
                            )}
                          >
                            {userId && (
                              <span
                                aria-hidden="true"
                                className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-muted text-[10.5px] font-bold text-foreground"
                              >
                                {initialsOf(whoName)}
                              </span>
                            )}
                            <span className={cn('min-w-0 flex-1 truncate', whoName ? 'text-foreground' : 'text-muted-foreground')}>
                              {whoLabel}
                            </span>
                            {isExt && (
                              <span className="shrink-0 rounded-md bg-muted px-1.5 py-px text-[11.5px] text-muted-foreground">
                                hors Konekt
                              </span>
                            )}
                            {!readOnly && <ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />}
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-[min(330px,calc(100vw-32px))]">
                          <DropdownMenuLabel className="text-xs font-normal text-muted-foreground">
                            Un membre de {orgLabel}
                          </DropdownMenuLabel>
                          <DropdownMenuRadioGroup
                            value={current}
                            onValueChange={(value) => {
                              if (value.startsWith('member:')) {
                                const uid = value.slice('member:'.length);
                                void updateStep({
                                  id: step.id,
                                  interviewer_type: 'internal',
                                  interviewer_user_id: uid,
                                  interviewer_name: knownNameOf(uid),
                                }).catch(() => undefined);
                              } else if (value === 'external') {
                                setExtFocusId(step.id);
                                if (!isExt) {
                                  void updateStep({
                                    id: step.id,
                                    interviewer_type: 'client',
                                    interviewer_user_id: null,
                                    interviewer_name: null,
                                  }).catch(() => undefined);
                                }
                              } else {
                                void updateStep({
                                  id: step.id,
                                  interviewer_type: 'internal',
                                  interviewer_user_id: null,
                                  interviewer_name: null,
                                }).catch(() => undefined);
                              }
                            }}
                          >
                            {members.map((m) => (
                              <DropdownMenuRadioItem key={m.user_id} value={`member:${m.user_id}`} className="gap-2">
                                <span className="min-w-0 flex-1 truncate">{nameOf(m.user_id)}</span>
                                {!loadingTeam && !teamIds.has(m.user_id) && (
                                  <span className="shrink-0 text-xs text-muted-foreground">pas dans l'équipe</span>
                                )}
                              </DropdownMenuRadioItem>
                            ))}
                            <DropdownMenuSeparator />
                            <DropdownMenuRadioItem value="external">Une personne hors Konekt…</DropdownMenuRadioItem>
                            <DropdownMenuRadioItem value="none">Aucun intervieweur</DropdownMenuRadioItem>
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                    <span className="col-start-3 row-start-3 text-[12.5px] tabular-nums text-muted-foreground sm:col-start-auto sm:row-start-auto sm:text-foreground/80">
                      <span className="sm:sr-only">En ce moment : </span>
                      {count}
                    </span>
                    {readOnly ? (
                      <span aria-hidden="true" className="col-start-4 row-start-1 sm:col-start-auto sm:row-start-auto" />
                    ) : (
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Supprimer l'étape ${name}`}
                        onClick={() => setDeleting(step)}
                        className="col-start-4 row-start-1 text-muted-foreground hover:text-destructive sm:col-start-auto sm:row-start-auto"
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    )}
                  </div>

                  {isExt && (
                    <div className="pb-2.5 pl-[70px] sm:grid sm:grid-cols-[minmax(0,0.8fr)_minmax(0,1.5fr)_104px_32px] sm:gap-x-3">
                      <span className="hidden sm:block" aria-hidden="true" />
                      <ExternalNameInput
                        step={step}
                        stepName={name}
                        readOnly={readOnly}
                        autoFocus={extFocusId === step.id}
                        onCommit={(value) => void updateStep({ id: step.id, interviewer_name: value }).catch(() => undefined)}
                      />
                    </div>
                  )}

                  {moving && (
                    <div className="flex flex-wrap items-center gap-1.5 pb-2.5 sm:pl-[70px]">
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        data-move={`${step.id}:up`}
                        disabled={index === 0 || reordering}
                        onClick={() => void move(step, 'up')}
                      >
                        <ArrowUp aria-hidden="true" />
                        Monter
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        size="xs"
                        data-move={`${step.id}:down`}
                        disabled={index === displayed.length - 1 || reordering}
                        onClick={() => void move(step, 'down')}
                      >
                        <ArrowDown aria-hidden="true" />
                        Descendre
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="xs"
                        data-move={`${step.id}:done`}
                        onClick={() => setMovingId(null)}
                      >
                        Terminer
                      </Button>
                    </div>
                  )}
                </div>
              );
            })}
          </>
        )}

        {!readOnly && !loadingSteps && !stepsFailed && (
          <div className="border-t border-border py-1">
            {adding ? (
              <form
                className="flex flex-wrap items-center gap-2 py-1"
                onSubmit={(e) => {
                  e.preventDefault();
                  void submitNew();
                }}
              >
                <Input
                  autoFocus
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setAdding(false);
                      setNewName('');
                    }
                  }}
                  aria-label="Nom de la nouvelle étape"
                  placeholder="Nom de l'étape"
                  autoComplete="off"
                  className="h-8 min-w-0 flex-[1_1_12rem]"
                />
                <Button type="submit" variant="primary" size="sm" disabled={!newName.trim() || isAdding} loading={isAdding}>
                  Ajouter
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setAdding(false);
                    setNewName('');
                  }}
                >
                  Annuler
                </Button>
              </form>
            ) : (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setAdding(true)}
                className="-ml-2.5 text-muted-foreground hover:text-foreground"
              >
                <Plus aria-hidden="true" />
                Ajouter une étape
              </Button>
            )}
          </div>
        )}
      </div>

      <DeleteStepDialog
        projectId={project.id}
        step={deleting}
        steps={displayed}
        deleteStep={deleteStep}
        onClose={() => setDeleting(null)}
      />
    </section>
  );
}

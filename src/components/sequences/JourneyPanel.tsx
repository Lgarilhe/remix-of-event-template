// Panneau « Parcours de Claire Dubois » de l'onglet « Candidats » (lot 5c-2) :
// qui l'a inscrit, son statut et l'action qui débloque, puis chaque étape de
// la séquence pour ce candidat (faite, en cours, en échec, non envoyée, à
// venir, branche non prise). Lecture de l'inscription et de ses exécutions,
// sous la RLS ; les gestes viennent de l'onglet (actions existantes).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Ban, Check, ExternalLink, Pencil, Sparkles, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ErrorState } from '@/components/layout';
import { SequenceActionIcon } from '@/components/outreach/SequenceBadges';
import {
  actionTypeLabel,
  formatSequenceError,
  formatSkipReason,
  isAiReviewPending,
  isHiddenActionType,
  isSentExecutionStatus,
} from '@/lib/sequenceErrorMessages';
import { hasManualStopTrace } from '@/lib/sequenceLabels';
import { dayMonth, clockTime, whenLabel, type EnrollmentStatusLine } from '@/lib/enrollmentStatusLine';
import { delayLabel } from '@/lib/sequenceFlow';
import { cn } from '@/lib/utils';
import type { DetailEnrollment, DetailExecution, DetailStep } from '@/hooks/useSequenceEnrollments';

const TONE_CLASS: Record<EnrollmentStatusLine['tone'], string> = {
  default: 'text-foreground',
  muted: 'text-muted-foreground',
  brand: 'text-brand',
  warning: 'text-warning',
  danger: 'text-danger',
};

type ItemState = 'done' | 'current' | 'fail' | 'skip' | 'todo';

interface JourneyItem {
  step: DetailStep;
  number: number;
  exec: DetailExecution | null;
  state: ItemState;
  detail: string;
}

const PENDING = new Set(['scheduled', 'waiting_event', 'quota_blocked', 'sending']);
const at = (iso: string) => `le ${dayMonth(iso)} à ${clockTime(new Date(iso))}`;

/** Une ligne par ordre d'étape : la version jouée pour ce candidat, sinon la version A. */
function journeyItems(steps: readonly DetailStep[], enrollment: DetailEnrollment): JourneyItem[] {
  const executions = enrollment.executions ?? [];
  const orders = [...new Set(steps.map((s) => s.step_order))].sort((a, b) => a - b);
  const lastExecOrder = Math.max(-1, ...executions.map((e) => e.step_order));
  const live = enrollment.status === 'active' || enrollment.status === 'paused';
  return orders.map((order, index) => {
    const group = steps.filter((s) => s.step_order === order);
    const exec = [...executions].filter((e) => group.some((s) => s.id === e.step_id)).sort((a, b) => Date.parse(b.scheduled_at) - Date.parse(a.scheduled_at))[0] ?? null;
    const step = (exec && group.find((s) => s.id === exec.step_id))
      ?? group.find((s) => !s.variant_group) ?? group.find((s) => s.variant_group === 'A') ?? group[0];
    let state: ItemState;
    let detail: string;
    if (!exec) {
      if (order < lastExecOrder) {
        state = 'skip';
        detail = 'Branche non prise';
      } else {
        state = 'todo';
        detail = live ? `À venir · ${delayLabel(stepDelay(step))}` : 'Non jouée';
      }
    } else if (isSentExecutionStatus(exec.status)) {
      state = 'done';
      // Vérification ou attente : rien n'est parti chez le candidat.
      const verb = isHiddenActionType(step.action_type) ? 'Fait' : 'Envoyé';
      detail = exec.executed_at ? `${verb} ${at(exec.executed_at)}` : verb;
    } else if (exec.status === 'failed') {
      state = 'fail';
      detail = `En échec : ${formatSequenceError(exec.error_message) || 'échec sans détail'}`;
    } else if (exec.status === 'skipped' || exec.status === 'cancelled') {
      state = 'skip';
      const reason = formatSkipReason(exec.skip_reason, { manualStop: hasManualStopTrace(enrollment.tracking_data) });
      detail = reason ? `Non envoyée : ${reason.charAt(0).toLowerCase()}${reason.slice(1)}` : 'Non envoyée';
    } else if (PENDING.has(exec.status)) {
      state = 'current';
      detail = exec.status === 'waiting_event'
        ? 'En attente'
        : exec.status === 'quota_blocked'
          ? `Reporté : plafond LinkedIn atteint, nouvel essai ${whenLabel(exec.scheduled_at)}`
          : exec.status === 'sending'
            ? 'Envoi en cours'
            : isAiReviewPending(exec)
              ? 'Message rédigé par l’IA à relire avant l’envoi'
              : `Prévu ${whenLabel(exec.scheduled_at)}`;
    } else {
      state = 'done';
      detail = 'Fait';
    }
    return { step, number: index + 1, exec, state, detail };
  });
}

function stepDelay(step: DetailStep): { delayDays: number; delayHours: number; delayMinutes: number } {
  return { delayDays: step.delay_days ?? 0, delayHours: step.delay_hours ?? 0, delayMinutes: step.delay_minutes ?? 0 };
}

function StateIcon({ state }: { state: ItemState }) {
  const base = 'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border';
  if (state === 'done') return <span className={cn(base, 'border-foreground-secondary bg-foreground-secondary text-background')}><Check className="h-3 w-3" aria-hidden="true" /></span>;
  if (state === 'current') return <span className={cn(base, 'border-brand ring-2 ring-brand/30')} />;
  if (state === 'fail') return <span className={cn(base, 'border-danger text-danger')}><X className="h-3 w-3" aria-hidden="true" /></span>;
  return <span className={cn(base, 'border-border', state === 'skip' && 'border-dashed')} />;
}

const STATE_LABEL: Record<ItemState, string> = {
  done: 'Faite',
  current: 'En cours',
  fail: 'En échec',
  skip: 'Non jouée',
  todo: 'À venir',
};

interface JourneyPanelProps {
  enrollmentId: string | null;
  steps: readonly DetailStep[];
  /** Change après chaque geste : le parcours est relu. */
  reloadKey: number;
  onClose: () => void;
  statusLineOf: (enrollment: DetailEnrollment) => EnrollmentStatusLine;
  /** Bouton de l'action principale (le même que sur la ligne). */
  renderAction: (enrollment: DetailEnrollment, line: EnrollmentStatusLine) => ReactNode;
  /** Qui l'a inscrit (« vous » pour soi). */
  memberName: (userId: string | null) => string | null;
  /** Gestes réservés : un collaborateur n'agit que sur ses inscriptions. */
  canAct: (enrollment: DetailEnrollment) => boolean;
  onEditMessage: (exec: DetailExecution, enrollment: DetailEnrollment) => void;
  onReviewMessage: (exec: DetailExecution, enrollment: DetailEnrollment) => void;
  onSkipStep: (exec: DetailExecution, enrollment: DetailEnrollment) => void;
}

export function JourneyPanel({
  enrollmentId, steps, reloadKey, onClose, statusLineOf, renderAction, memberName, canAct,
  onEditMessage, onReviewMessage, onSkipStep,
}: JourneyPanelProps) {
  const [enrollment, setEnrollment] = useState<DetailEnrollment | null>(null);
  const [state, setState] = useState<'loading' | 'error' | 'ready'>('loading');
  // Inscription affichée : une relecture après un geste garde le parcours à l'écran.
  const loadedId = useRef<string | null>(null);

  const load = useCallback(async () => {
    if (!enrollmentId) return;
    const [enrollRes, execRes] = await Promise.all([
      supabase.from('sequence_enrollments').select('*').eq('id', enrollmentId).maybeSingle(),
      supabase.from('sequence_step_executions').select('*').eq('enrollment_id', enrollmentId).order('step_order', { ascending: true }).order('id', { ascending: true }),
    ]);
    if (enrollRes.error || execRes.error || !enrollRes.data) {
      console.error('Error loading journey:', enrollRes.error || execRes.error);
      setState('error');
      return;
    }
    const stepById = new Map(steps.map((s) => [s.id, s]));
    setEnrollment({
      ...enrollRes.data,
      executions: (execRes.data ?? []).map((exec) => {
        const step = stepById.get(exec.step_id);
        return {
          ...exec,
          step: step ? { action_type: step.action_type, message_template: step.message_template, subject_template: step.subject_template, timeout_days: step.timeout_days ?? null, wait_for_event: step.wait_for_event ?? null } : undefined,
        };
      }),
    });
    loadedId.current = enrollmentId;
    setState('ready');
  }, [enrollmentId, steps]);

  // reloadKey : relecture après un geste de l'onglet.
  useEffect(() => {
    if (!enrollmentId) {
      loadedId.current = null;
      setEnrollment(null);
      return;
    }
    if (loadedId.current !== enrollmentId) {
      setEnrollment(null);
      setState('loading');
    }
    void load();
  }, [enrollmentId, load, reloadKey]);

  const name = enrollment?.profile_name || 'ce candidat';
  const line = enrollment ? statusLineOf(enrollment) : null;
  const author = enrollment ? memberName(enrollment.created_by ?? null) : null;
  const acting = enrollment ? canAct(enrollment) : false;

  return (
    <Sheet open={!!enrollmentId} onOpenChange={(open) => !open && onClose()}>
      <SheetContent side="right" className="flex w-full flex-col gap-0 p-0 sm:max-w-md">
        <SheetHeader className="space-y-1 border-b border-border px-6 py-5 pr-14 text-left">
          <SheetTitle className="break-words">{enrollment ? `Parcours de ${name}` : 'Parcours du candidat'}</SheetTitle>
          <SheetDescription>{enrollment?.profile_headline || 'Étapes de la séquence pour ce candidat.'}</SheetDescription>
        </SheetHeader>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {state === 'loading' && !enrollment ? (
            <div role="status" aria-label="Chargement du parcours" className="space-y-3">
              {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-10 w-full rounded-lg" />)}
            </div>
          ) : state === 'error' || !enrollment || !line ? (
            <ErrorState title="Parcours indisponible pour l’instant." description="Vérifiez votre connexion, puis réessayez." onRetry={() => { void load(); }} />
          ) : (
            <>
              {author && (
                <p className="text-xs text-muted-foreground">
                  {author === 'vous' ? 'Inscrit par vous, depuis votre compte LinkedIn' : `Inscrit par ${author}, depuis son compte LinkedIn`}
                </p>
              )}
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className={cn('text-sm font-medium', TONE_CLASS[line.tone])}>{line.label}</p>
                {acting && renderAction(enrollment, line)}
              </div>

              <ol className="space-y-4" aria-label="Étapes du parcours">
                {journeyItems(steps, enrollment).map((item) => {
                  const exec = item.exec;
                  const live = enrollment.status === 'active';
                  const review = !!exec && isAiReviewPending(exec);
                  const canEditMessage = acting && !!exec && exec.status === 'scheduled' && !review && !!(exec.final_message || item.step.message_template);
                  const canSkip = acting && live && !!exec && (exec.status === 'scheduled' || exec.status === 'quota_blocked');
                  return (
                    <li key={item.step.id} className={cn('flex items-start gap-3', item.state === 'skip' && 'opacity-70')}>
                      <StateIcon state={item.state} />
                      <div className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-foreground">
                          <span className="tabular-nums text-muted-foreground">{item.number}</span>
                          <SequenceActionIcon type={item.step.action_type} className="text-muted-foreground" />
                          <span>{actionTypeLabel(item.step.action_type)}</span>
                          <span className="sr-only">, {STATE_LABEL[item.state]}</span>
                        </p>
                        <p className={cn('mt-0.5 text-xs', item.state === 'fail' ? 'text-danger' : review ? 'text-warning' : 'text-muted-foreground')}>{item.detail}</p>
                        {(review && acting) || canEditMessage || canSkip ? (
                          <div className="mt-2 flex flex-wrap gap-2">
                            {review && acting && exec && (
                              <Button type="button" variant="outline" size="xs" className="max-md:h-11" onClick={() => onReviewMessage(exec, enrollment)}>
                                <Sparkles aria-hidden="true" />
                                Relire le message
                              </Button>
                            )}
                            {canEditMessage && exec && (
                              <Button type="button" variant="outline" size="xs" className="max-md:h-11" onClick={() => onEditMessage(exec, enrollment)}>
                                <Pencil aria-hidden="true" />
                                Modifier le message
                              </Button>
                            )}
                            {canSkip && exec && (
                              <Button type="button" variant="ghost" size="xs" className="max-md:h-11" onClick={() => onSkipStep(exec, enrollment)}>
                                <Ban aria-hidden="true" />
                                Ne pas envoyer cette étape
                              </Button>
                            )}
                          </div>
                        ) : null}
                      </div>
                    </li>
                  );
                })}
              </ol>
            </>
          )}
        </div>

        {enrollment?.profile_url && (
          <div className="border-t border-border px-6 py-3">
            <Button asChild variant="ghost" size="sm" className="max-md:h-11">
              <a href={enrollment.profile_url} target="_blank" rel="noopener noreferrer">
                <ExternalLink aria-hidden="true" />
                Voir sur LinkedIn
              </a>
            </Button>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

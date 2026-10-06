// Panneau « Parcours de Claire Dubois » de l'onglet « Candidats » (lot 5c-2) :
// qui l'a inscrit, son statut et l'action qui débloque, puis son chemin sur le
// graphe de la séquence (src/lib/sequenceJourney.ts) : étapes faites, étape en
// cours, issues à venir d'une attente ou d'une fourche, branche non prise.
// Lecture de l'inscription (de cette séquence seulement) et de ses exécutions,
// sous la RLS ; les gestes viennent de l'onglet (actions existantes).
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Ban, Check, CornerDownRight, ExternalLink, Flag, Pencil, Sparkles, X } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { ErrorState } from '@/components/layout';
import { SequenceActionIcon } from '@/components/outreach/SequenceBadges';
import { isAiReviewPending } from '@/lib/sequenceErrorMessages';
import { hasManualStopTrace } from '@/lib/sequenceLabels';
import { type EnrollmentStatusLine } from '@/lib/enrollmentStatusLine';
import { buildJourney, type JourneyItem, type JourneyState } from '@/lib/sequenceJourney';
import type { SequenceStepRow } from '@/components/outreach/sequence/sequenceGraph';
import { cn } from '@/lib/utils';
import type { DetailEnrollment, DetailExecution } from '@/hooks/useSequenceEnrollments';

const TONE_CLASS: Record<EnrollmentStatusLine['tone'], string> = {
  default: 'text-foreground',
  muted: 'text-muted-foreground',
  brand: 'text-brand',
  warning: 'text-warning',
  danger: 'text-danger',
};

function StateIcon({ state }: { state: JourneyState | 'not_taken' }) {
  const base = 'mt-0.5 grid h-5 w-5 shrink-0 place-items-center rounded-full border';
  if (state === 'done') return <span className={cn(base, 'border-foreground-secondary bg-foreground-secondary text-background')}><Check className="h-3 w-3" aria-hidden="true" /></span>;
  if (state === 'current') return <span className={cn(base, 'border-brand ring-2 ring-brand/30')} />;
  if (state === 'fail') return <span className={cn(base, 'border-danger text-danger')}><X className="h-3 w-3" aria-hidden="true" /></span>;
  return <span className={cn(base, 'border-border', (state === 'skip' || state === 'not_taken') && 'border-dashed')} />;
}

const STATE_LABEL: Record<JourneyState, string> = {
  done: 'Faite',
  current: 'En cours',
  fail: 'En échec',
  skip: 'Non jouée',
  todo: 'À venir',
};

interface JourneyPanelProps {
  enrollmentId: string | null;
  /** Séquence affichée : une inscription d'une autre séquence (lien recopié) n'est pas ouverte. */
  sequenceId: string;
  /** Lignes de sequence_steps (renvois, fourches, fins) : le chemin se lit sur le graphe. */
  steps: readonly SequenceStepRow[];
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
  enrollmentId, sequenceId, steps, reloadKey, onClose, statusLineOf, renderAction, memberName, canAct,
  onEditMessage, onReviewMessage, onSkipStep,
}: JourneyPanelProps) {
  const [enrollment, setEnrollment] = useState<DetailEnrollment | null>(null);
  const [state, setState] = useState<'loading' | 'error' | 'elsewhere' | 'ready'>('loading');
  // Inscription affichée : une relecture après un geste garde le parcours à l'écran.
  const loadedId = useRef<string | null>(null);
  // Étapes lues par une référence : la séquence relue après un geste (nouveau
  // tableau, même contenu) ne relance pas la lecture du parcours.
  const stepsRef = useRef(steps);
  stepsRef.current = steps;

  const load = useCallback(async () => {
    if (!enrollmentId) return;
    const [enrollRes, execRes] = await Promise.all([
      supabase.from('sequence_enrollments').select('*').eq('id', enrollmentId).eq('sequence_id', sequenceId).maybeSingle(),
      supabase.from('sequence_step_executions').select('*').eq('enrollment_id', enrollmentId).order('step_order', { ascending: true }).order('id', { ascending: true }),
    ]);
    if (enrollRes.error || execRes.error) {
      console.error('Error loading journey:', enrollRes.error || execRes.error);
      setState('error');
      return;
    }
    if (!enrollRes.data) {
      // Inscription d'une autre séquence (lien recopié ou périmé), ou illisible : rien d'ouvert, aucun geste.
      setEnrollment(null);
      loadedId.current = enrollmentId;
      setState('elsewhere');
      return;
    }
    const stepById = new Map(stepsRef.current.map((s) => [s.id, s]));
    setEnrollment({
      ...enrollRes.data,
      executions: (execRes.data ?? []).map((exec) => {
        const step = stepById.get(exec.step_id);
        return {
          ...exec,
          step: step ? { action_type: step.action_type, message_template: step.message_template ?? null, subject_template: step.subject_template ?? null, timeout_days: step.timeout_days ?? null, wait_for_event: step.wait_for_event ?? null } : undefined,
        };
      }),
    });
    loadedId.current = enrollmentId;
    setState('ready');
  }, [enrollmentId, sequenceId]);

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
  const journey = enrollment
    ? buildJourney(steps, enrollment.executions ?? [], {
        live: enrollment.status === 'active' || enrollment.status === 'paused',
        manualStop: hasManualStopTrace(enrollment.tracking_data),
      })
    : [];

  const renderItems = (items: JourneyItem<DetailExecution>[], current: DetailEnrollment): ReactNode => items.map((item) => {
    if (item.kind === 'branches') {
      return (
        <li key={item.key} className="space-y-3">
          {item.branches.map((branch) => (
            <div key={branch.label} className="space-y-3 border-l border-border pl-4">
              <p className="text-xs font-medium text-foreground-secondary">{branch.label}</p>
              <ol className="space-y-3" aria-label={branch.label}>{renderItems(branch.items, current)}</ol>
            </div>
          ))}
        </li>
      );
    }
    if (item.kind === 'not_taken') {
      return (
        <li key={item.key} className="flex items-start gap-3 opacity-70">
          <StateIcon state="not_taken" />
          <div className="min-w-0 flex-1">
            <p className="text-sm text-foreground">Branche non prise : {item.label}</p>
            <p className="mt-0.5 text-xs text-muted-foreground">{item.steps.join(', ')}</p>
          </div>
        </li>
      );
    }
    if (item.kind === 'join') {
      return (
        <li key={item.key} className="flex items-center gap-3 text-xs text-muted-foreground">
          <CornerDownRight className="h-4 w-4 shrink-0" aria-hidden="true" />
          Rejoint l’étape {item.number} · {item.title}
        </li>
      );
    }
    if (item.kind === 'end') {
      return (
        <li key={item.key} className="flex items-center gap-3 text-xs text-muted-foreground">
          <Flag className="h-4 w-4 shrink-0" aria-hidden="true" />
          {item.label}
        </li>
      );
    }
    const exec = item.exec;
    const live = current.status === 'active';
    const review = !!exec && isAiReviewPending(exec);
    const canEditMessage = acting && !!exec && exec.status === 'scheduled' && !review && !!(exec.final_message || exec.step?.message_template);
    const canSkip = acting && live && !!exec && (exec.status === 'scheduled' || exec.status === 'quota_blocked');
    return (
      <li key={item.key} className={cn('flex items-start gap-3', item.state === 'skip' && 'opacity-70')}>
        <StateIcon state={item.state} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-x-1.5 text-sm text-foreground">
            <span className="tabular-nums text-muted-foreground">{item.number}</span>
            <SequenceActionIcon type={item.actionType} className="text-muted-foreground" />
            <span>{item.title}</span>
            <span className="sr-only">, {STATE_LABEL[item.state]}</span>
          </p>
          <p className={cn('mt-0.5 text-xs', item.state === 'fail' ? 'text-danger' : review ? 'text-warning' : 'text-muted-foreground')}>{item.detail}</p>
          {(review && acting) || canEditMessage || canSkip ? (
            <div className="mt-2 flex flex-wrap gap-2">
              {review && acting && exec && (
                <Button type="button" variant="outline" size="xs" className="max-md:h-11" onClick={() => onReviewMessage(exec, current)}>
                  <Sparkles aria-hidden="true" />
                  Relire le message
                </Button>
              )}
              {canEditMessage && exec && (
                <Button type="button" variant="outline" size="xs" className="max-md:h-11" onClick={() => onEditMessage(exec, current)}>
                  <Pencil aria-hidden="true" />
                  Modifier le message
                </Button>
              )}
              {canSkip && exec && (
                <Button type="button" variant="ghost" size="xs" className="max-md:h-11" onClick={() => onSkipStep(exec, current)}>
                  <Ban aria-hidden="true" />
                  Ne pas envoyer cette étape
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </li>
    );
  });

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
          ) : state === 'elsewhere' ? (
            <ErrorState
              variant="compact"
              title="Parcours indisponible."
              description="Ce candidat n’est pas inscrit dans cette séquence : le lien vient peut-être d’une autre séquence."
            />
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
                {renderItems(journey, enrollment)}
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

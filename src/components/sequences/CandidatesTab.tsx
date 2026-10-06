// Onglet « Candidats » de la page d'une séquence (lot 5c-2) : puces sans zéro,
// recherche, une ligne par inscrit (visage, étape, statut et prochaine action
// par src/lib/enrollmentStatusLine.ts, expéditeur, menu « Actions pour X »),
// barre groupée, et le panneau « Parcours de Claire Dubois » au clic.
//
// Gestes, tous par les actions existantes :
// - pause d'un candidat ou d'un groupe et « Arrêter pour ce candidat », sans
//   fenêtre, avec « Annuler » (lot 5b, useUndoableEnrollmentAction) ;
// - « Reprendre » et « Relancer la séquence » par le serveur (resume_enrollments,
//   re_enroll), après leur confirmation actuelle ;
// - « Ne pas envoyer cette étape » (skip_execution) et « Marquer comme ayant
//   répondu » (mark_replied), après confirmation ;
// - « Relire le message » d'une étape rédigée par l'IA (lot 5a-2) et
//   « Modifier le message » : final_message de l'étape encore programmée.
// Un collaborateur n'agit que sur les candidats qu'il a inscrits (D3).
import { useEffect, useMemo, useRef, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import {
  AlertCircle,
  Ban,
  CheckCircle2,
  ExternalLink,
  MoreHorizontal,
  Pause,
  Play,
  RefreshCw,
  Route,
  Search,
  Sparkles,
  X,
  XCircle,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useMemberName } from '@/hooks/useTeamMembers';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { useUndoableEnrollmentAction } from '@/hooks/useUndoableEnrollmentAction';
import {
  useSequenceEnrollments,
  type DetailEnrollment,
  type DetailExecution,
  type DetailStep,
} from '@/hooks/useSequenceEnrollments';
import { createEnrollmentActions, isGdprErased, resumeRetriesFailedStep, type SequenceWithStats } from '@/lib/sequenceActions';
import {
  ENROLLMENT_CHIPS,
  emptyChipText,
  enrollmentChipCounts,
  enrollmentStatusLine,
  hasVisibleStepAfterLastDone,
  isMeetingBookedCompletion,
  type EnrollmentChip,
  type EnrollmentStatusLine,
} from '@/lib/enrollmentStatusLine';
import {
  actionTypeLabel,
  isAiReviewPending,
  isSequencePauseResumable,
  skipConflictMessage,
  STOP_FAILED_MESSAGE,
  summarizeResumeResponse,
  type ResumeResponse,
} from '@/lib/sequenceErrorMessages';
import { MANUAL_STOP_HELP, RELAUNCH_AFTER_STOP_LABEL, STOP_FOR_CANDIDATE_LABEL, readManualStopFromTracking } from '@/lib/sequenceLabels';
import { cn } from '@/lib/utils';
import { REVEAL_ON_ROW } from '@/components/missions/v3/cadrage/sectionUi';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PersonAvatar } from '@/components/ui/person-avatar';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { EmptyState, ErrorState } from '@/components/layout';
import { EditScheduledMessageModal } from '@/components/outreach/activity-log/EditScheduledMessageModal';
import type { SequenceStepRow } from '@/components/outreach/sequence/sequenceGraph';
import { JourneyPanel } from './JourneyPanel';

interface CandidatesTabProps {
  sequence: SequenceWithStats;
  countsUnavailable: boolean;
  chip: EnrollmentChip;
  onChipChange: (chip: EnrollmentChip) => void;
  /** Inscription dont le parcours est ouvert (?parcours=). */
  journeyId: string | null;
  onJourneyChange: (id: string | null) => void;
  /** Propriétaire, administrateur ou auteur : « Réactiver la séquence ». */
  canManageSequence: boolean;
  onReactivate: () => void;
  /** Relecture des compteurs de la page après un geste. */
  onChanged: () => void;
  enrollHref: string;
}

const TONE_CLASS: Record<EnrollmentStatusLine['tone'], string> = {
  default: 'text-foreground',
  muted: 'text-muted-foreground',
  brand: 'text-brand',
  warning: 'text-warning',
  danger: 'text-danger',
};

/** Pauses qu'un « Reprendre » individuel lève (les autres ont leur propre action). */
const RESUMABLE_PAUSE_REASONS = new Set(['manual', 'send_failed']);
/** « Arrêter » groupé : 200 inscriptions au plus par demande (stop_enrollments). */
const BULK_STOP_MAX = 200;
/** « Marquer comme ayant répondu » groupé : même plafond, appels par lots de 5 en parallèle. */
const BULK_REPLIED_MAX = 200;
const BULK_REPLIED_CONCURRENCY = 5;
const PENDING = new Set(['scheduled', 'waiting_event', 'quota_blocked', 'sending']);

type Confirm =
  | { type: 'resume'; ids: string[] }
  | { type: 'reEnroll'; id: string }
  | { type: 'markReplied'; ids: string[] }
  | { type: 'skip'; exec: DetailExecution; name: string };

/** Téléphone : zone invisible de 44 px autour de la case (01-direction, § 5), sans changer son dessin. */
const CHECKBOX_TOUCH = 'relative max-md:after:absolute max-md:after:-inset-3.5';

/** Clic sur la ligne : le parcours, sauf depuis un contrôle de la ligne. */
const INTERACTIVE = 'a,button,input,label,[role="checkbox"],[role="menuitem"],[role="menu"]';

export function CandidatesTab({
  sequence, countsUnavailable, chip, onChipChange, journeyId, onJourneyChange,
  canManageSequence, onReactivate, onChanged, enrollHref,
}: CandidatesTabProps) {
  const { isCollaborator } = useOrganization();
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const memberName = useMemberName();
  const { getUserLinkedAccountId } = useMemberLinkedInAccounts();
  const myAccountId = userId ? getUserLinkedAccountId(userId) : null;
  const { offerUndoPause, stopEnrollments, resumeIds } = useUndoableEnrollmentAction();
  const steps = sequence.steps as DetailStep[];
  // Lignes complètes de sequence_steps (renvois, fins de séquence) : la suite se lit sur le graphe.
  const stepRows = sequence.steps as SequenceStepRow[];

  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => setQuery(search.trim()), 300);
    return () => window.clearTimeout(timer);
  }, [search]);

  const data = useSequenceEnrollments(sequence.id, steps, { chip, query });
  const { enrollments, setEnrollments } = data;
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulkBusy, setBulkBusy] = useState<'pause' | 'stop' | 'resume' | 'replied' | null>(null);
  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [editing, setEditing] = useState<{ exec: DetailExecution; name: string | null; aiReview: boolean } | null>(null);
  const [journeyKey, setJourneyKey] = useState(0);
  const [, setBulkResuming] = useState(false);
  // Noms connus (liste et parcours), pour les toasts.
  const names = useRef(new Map<string, string>());
  for (const e of enrollments) if (e.profile_name) names.current.set(e.id, e.profile_name);

  // La sélection suit la liste affichée.
  useEffect(() => {
    setSelected((prev) => new Set([...prev].filter((id) => enrollments.some((e) => e.id === id))));
  }, [enrollments]);

  const refreshAll = async () => {
    await data.reload();
    setJourneyKey((k) => k + 1);
    onChanged();
  };
  const nameOf = (id: string) => names.current.get(id) || 'ce candidat';

  const { stopEnrollment, pauseEnrollments, markReplied } = createEnrollmentActions({
    supabase, invokeEdgeFunction, toast, sequenceId: sequence.id, nameOf,
    fetchEnrollments: refreshAll, fetchStatusCounts: async () => onChanged(),
    setEnrollments: setEnrollments as Parameters<typeof createEnrollmentActions>[0]['setEnrollments'],
    offerUndoPause, setBulkResuming,
  });

  // D3 : même règle que le serveur, un collaborateur n'agit que sur ses inscriptions.
  const ownRow = (e: DetailEnrollment) => !isCollaborator || (!!userId && e.created_by === userId);
  const canResume = (e: DetailEnrollment) => e.status === 'paused' && !isGdprErased(e) && ownRow(e)
    && (!e.pause_reason || RESUMABLE_PAUSE_REASONS.has(e.pause_reason) || isSequencePauseResumable(e.status, e.pause_reason, sequence.is_active));

  const lineOf = (e: DetailEnrollment): EnrollmentStatusLine => enrollmentStatusLine(e, {
    memberName: (id) => memberName(id),
    sequenceActive: sequence.is_active,
    canManageSequence,
    isAccountHolder: !!myAccountId && e.account_id === myAccountId,
    hasNextStep: hasVisibleStepAfterLastDone(e.executions ?? [], stepRows),
  });

  // ── Gestes ──────────────────────────────────────────────────────────────

  const resume = async (ids: string[]) => {
    const name = ids.length === 1 ? nameOf(ids[0]) : null;
    setBulkBusy(ids.length > 1 ? 'resume' : null);
    try {
      const result = await resumeIds(ids);
      const payload: ResumeResponse = { success: result.unprocessed === 0, counts: result.counts, message: result.callError ?? undefined };
      const summary = summarizeResumeResponse(payload, name);
      if (summary.tone === 'success') toast.success(summary.message);
      else if (summary.tone === 'info') toast.info(summary.message);
      else toast.error(summary.message);
    } catch (err) {
      console.error('Error resuming enrollments:', err);
      toast.error(name ? `La séquence n’a pas pu reprendre pour ${name}` : 'La reprise a échoué. Réessayez.');
    } finally {
      setBulkBusy(null);
      setSelected(new Set());
    }
    await refreshAll();
  };

  const reEnroll = async (id: string) => {
    const name = nameOf(id);
    try {
      const { data: payload, error } = await invokeEdgeFunction<ResumeResponse>('process-sequences', { action: 're_enroll', enrollment_ids: [id] });
      if (error || !payload?.success) throw new Error(payload?.message || error?.message || 'Réessayez dans un instant.');
      const outcome = payload.results?.find((r) => r.enrollment_id === id)?.outcome;
      if (outcome === 'resumed') {
        toast.success(`Séquence relancée pour ${name}`, {
          description: 'La prochaine action est programmée selon les délais de la séquence, pendant vos heures d’envoi.',
        });
      } else if (outcome === 'nothing_to_resume') {
        toast.info(`Rien à relancer : cette séquence est terminée pour ${name}`);
      } else if (outcome === 'account_unlinked') {
        toast.error('Ce compte LinkedIn n’est plus relié. Reliez-le avant de relancer la séquence.');
      } else {
        toast.error(`La séquence n’a pas pu être relancée pour ${name}`, { description: payload.results?.find((r) => r.enrollment_id === id)?.message });
      }
    } catch (err) {
      console.error('Error relaunching enrollment:', err);
      toast.error(`La séquence n’a pas pu être relancée pour ${name}`, { description: err instanceof Error ? err.message : undefined });
    }
    await refreshAll();
  };

  const stop = async (ids: string[]) => {
    if (ids.length > BULK_STOP_MAX) {
      toast.info(`Arrêt groupé limité à ${BULK_STOP_MAX} candidats`, { description: 'Mettez plutôt la séquence en pause, ou arrêtez les candidats par groupes.' });
      return;
    }
    setBulkBusy(ids.length > 1 ? 'stop' : null);
    try {
      await stopEnrollments({ enrollmentIds: ids, candidateName: ids.length === 1 ? nameOf(ids[0]) : null, onSettled: refreshAll });
    } catch (err) {
      console.error('Error stopping enrollments:', err);
      toast.error(STOP_FAILED_MESSAGE);
    } finally {
      setBulkBusy(null);
      setSelected(new Set());
    }
  };

  const markRepliedMany = async (ids: string[]) => {
    if (ids.length === 1) {
      await markReplied(ids[0]);
      return;
    }
    if (ids.length > BULK_REPLIED_MAX) {
      toast.info(`Réponse groupée limitée à ${BULK_REPLIED_MAX} candidats`, { description: 'Marquez les candidats par groupes.' });
      return;
    }
    setBulkBusy('replied');
    let changed = 0;
    let failed = 0;
    // Par lots de 5 appels en parallèle : chaque appel arrête aussi les autres séquences du candidat.
    for (let i = 0; i < ids.length; i += BULK_REPLIED_CONCURRENCY) {
      const batch = ids.slice(i, i + BULK_REPLIED_CONCURRENCY);
      const results = await Promise.all(batch.map(async (id) => {
        try {
          const { data: payload, error } = await invokeEdgeFunction<{ success?: boolean; changed?: boolean }>('process-sequences', { action: 'mark_replied', enrollment_id: id });
          if (error || !payload?.success) return 'failed' as const;
          return payload.changed ? 'changed' as const : 'unchanged' as const;
        } catch {
          return 'failed' as const;
        }
      }));
      changed += results.filter((r) => r === 'changed').length;
      failed += results.filter((r) => r === 'failed').length;
    }
    setBulkBusy(null);
    setSelected(new Set());
    if (failed === 0) toast.success(changed > 1 ? `Réponses enregistrées pour ${changed} candidats` : changed === 1 ? 'Réponse enregistrée' : 'Rien n’a changé : ces séquences étaient déjà closes.', changed > 0 ? { description: 'Leurs étapes restantes ont été annulées.' } : undefined);
    else toast.warning(`${changed} réponse${changed > 1 ? 's' : ''} enregistrée${changed > 1 ? 's' : ''}, ${failed} en échec`, { description: 'Réessayez pour les candidats restants.' });
    await refreshAll();
  };

  const skip = async (exec: DetailExecution, name: string) => {
    try {
      const { data: payload, error } = await invokeEdgeFunction<{ success?: boolean; error_code?: string; message?: string }>('process-sequences', { action: 'skip_execution', execution_id: exec.id });
      if (error?.status === 409) toast.error(skipConflictMessage(error.code ?? payload?.error_code, error.message));
      else if (error?.status === 403) toast.error(payload?.message || error.message);
      else if (error || !payload?.success) toast.error('L’étape n’a pas pu être retirée. Réessayez.', { description: error?.message });
      else toast.success(`${name} ne recevra pas cette étape`, { description: 'La séquence passe à l’étape suivante.' });
    } catch (err) {
      console.error('Error skipping execution:', err);
      toast.error('L’étape n’a pas pu être retirée. Réessayez.');
    }
    await refreshAll();
  };

  const onConfirm = async () => {
    const current = confirm;
    setConfirm(null);
    if (!current) return;
    if (current.type === 'resume') await resume(current.ids);
    else if (current.type === 'reEnroll') await reEnroll(current.id);
    else if (current.type === 'markReplied') await markRepliedMany(current.ids);
    else await skip(current.exec, current.name);
  };

  const reviewExec = (e: DetailEnrollment) => (e.executions ?? []).find((x) => isAiReviewPending(x)) ?? null;
  const scheduledExec = (e: DetailEnrollment) => (e.executions ?? [])
    .filter((x) => x.status === 'scheduled' || x.status === 'quota_blocked')
    .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at))[0] ?? null;

  /** Bouton de l'action principale (ligne et parcours). */
  const renderAction = (e: DetailEnrollment, line: EnrollmentStatusLine) => {
    const a = line.action;
    if (!a) return null;
    const name = e.profile_name || 'ce candidat';
    const cls = 'max-md:h-11';
    // Retraits d'envoi (pause, arrêt) en discret gris : le contour d'encre reste aux actions qui font avancer.
    const retreat = cn(cls, 'text-muted-foreground');
    switch (a.kind) {
      case 'pause':
        return ownRow(e) ? <Button type="button" variant="ghost" size="xs" className={retreat} onClick={() => { void stopEnrollment(e.id); }}>{a.label}</Button> : null;
      case 'resume':
      case 'retry':
        return canResume(e) ? (
          <Button type="button" variant="outline" size="xs" className={cls} onClick={() => setConfirm({ type: 'resume', ids: [e.id] })}>
            {a.kind === 'retry' && !resumeRetriesFailedStep(e) ? 'Reprendre la séquence' : a.label}
          </Button>
        ) : null;
      case 'stop':
        return ownRow(e) ? <Button type="button" variant="ghost" size="xs" className={retreat} onClick={() => { void stop([e.id]); }}>{a.label}</Button> : null;
      case 'relaunch':
        return ownRow(e) && !isGdprErased(e) ? <Button type="button" variant="outline" size="xs" className={cls} onClick={() => setConfirm({ type: 'reEnroll', id: e.id })}>{a.label}</Button> : null;
      case 'review': {
        const exec = reviewExec(e);
        return exec && ownRow(e) ? (
          <Button type="button" variant="outline" size="xs" className={cls} onClick={() => setEditing({ exec, name, aiReview: true })}>
            <Sparkles aria-hidden="true" />
            {a.label}
          </Button>
        ) : null;
      }
      case 'reactivate':
        return <Button type="button" variant="outline" size="xs" className={cls} onClick={onReactivate}>{a.label}</Button>;
      case 'show_error':
        return <Button type="button" variant="outline" size="xs" className={cls} onClick={() => onJourneyChange(e.id)}>{a.label}</Button>;
      case 'reconnect':
        return <Button asChild variant="outline" size="xs" className={cls}><Link to="/settings/account/connections">{a.label}</Link></Button>;
      case 'pricing':
        return <Button asChild variant="outline" size="xs" className={cls}><Link to="/pricing">{a.label}</Link></Button>;
      case 'conversation': {
        const chat = data.chatByEnrollment.get(e.id);
        return <Button asChild variant="outline" size="xs" className={cls}><Link to={chat ? `/inbox?chatId=${encodeURIComponent(chat)}` : '/inbox'}>{a.label}</Link></Button>;
      }
      default:
        return null;
    }
  };

  // ── Lecture ─────────────────────────────────────────────────────────────

  const orders = useMemo(() => [...new Set(steps.map((s) => s.step_order))].sort((a, b) => a - b), [steps]);
  const stepOf = (e: DetailEnrollment): string | null => {
    const execs = e.executions ?? [];
    const pending = execs.filter((x) => PENDING.has(x.status)).sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at))[0];
    const failed = execs.filter((x) => x.status === 'failed').sort((a, b) => Date.parse(b.scheduled_at) - Date.parse(a.scheduled_at))[0];
    const last = [...execs].sort((a, b) => b.step_order - a.step_order)[0];
    const exec = pending ?? failed ?? last;
    if (!exec) return null;
    const step = steps.find((s) => s.id === exec.step_id);
    const number = orders.indexOf(exec.step_order) + 1;
    return `${number > 0 ? `${number} · ` : ''}${actionTypeLabel(step?.action_type ?? exec.step?.action_type)}`;
  };

  const counts = countsUnavailable ? null : enrollmentChipCounts(sequence.enrollments);
  const chips = ENROLLMENT_CHIPS.filter((c) => c.key === 'tous' || c.key === chip || !counts || counts[c.key] > 0);
  const selectable = enrollments.filter((e) => ownRow(e));
  const selectedRows = enrollments.filter((e) => selected.has(e.id));
  const allSelected = selectable.length > 0 && selectable.every((e) => selected.has(e.id));
  const toggle = (id: string, on: boolean) => setSelected((prev) => {
    const next = new Set(prev);
    if (on) next.add(id);
    else next.delete(id);
    return next;
  });
  const openRow = (event: MouseEvent<HTMLTableRowElement>, id: string) => {
    if ((event.target as HTMLElement).closest(INTERACTIVE)) return;
    onJourneyChange(id);
  };

  // Accordé au nombre ; pour une séquence terminée, seules les séquences commencées avant sa fin sont arrêtées (contrat §8).
  function markRepliedText(ids: string[]): string {
    const help = 'Utile si le candidat a répondu hors de Konekt (téléphone, en personne, etc.).';
    if (ids.length > 1) {
      return `Ces ${ids.length} candidats passeront en « A répondu » et leurs étapes restantes seront annulées. Leurs autres séquences encore en cours ou en pause seront aussi arrêtées. ${help}`;
    }
    const target = enrollments.find((e) => e.id === ids[0]);
    const others = target?.status === 'completed'
      ? 'Ses autres séquences encore en cours ou en pause, commencées avant la fin de celle-ci, seront aussi arrêtées.'
      : 'Ses autres séquences encore en cours ou en pause seront aussi arrêtées.';
    return `${nameOf(ids[0])} passera en « A répondu » et ses étapes restantes seront annulées. ${others} ${help}`;
  }

  const noEnrollmentAtAll = !countsUnavailable && sequence.enrollments.total === 0 && chip === 'tous' && !query;

  const confirmTitle = !confirm ? '' : confirm.type === 'resume'
    ? (confirm.ids.length > 1 ? `Reprendre ${confirm.ids.length} candidats ?` : `Reprendre la séquence pour ${nameOf(confirm.ids[0])} ?`)
    : confirm.type === 'reEnroll'
      ? `Relancer ${nameOf(confirm.id)} ?`
      : confirm.type === 'markReplied'
        ? (confirm.ids.length > 1 ? `Marquer ${confirm.ids.length} candidats comme ayant répondu ?` : `Marquer ${nameOf(confirm.ids[0])} comme ayant répondu ?`)
        : 'Ne pas envoyer cette étape ?';
  const confirmText = !confirm ? '' : confirm.type === 'resume'
    ? 'Une étape déjà programmée garde sa date (au plus tôt dans une minute) ; sinon, l’étape suivante est programmée selon son délai habituel, pendant vos heures d’envoi.'
    : confirm.type === 'reEnroll'
      ? 'La séquence reprend à l’étape suivante, selon ses délais habituels, pendant vos heures d’envoi.'
      : confirm.type === 'markReplied'
        ? markRepliedText(confirm.ids)
        : `${confirm.name} ne recevra pas cette étape. La séquence passera à l’étape suivante. Pour ne plus rien lui envoyer, arrêtez la séquence pour ce candidat.`;
  const confirmAction = !confirm ? '' : confirm.type === 'resume' ? 'Reprendre' : confirm.type === 'reEnroll' ? 'Relancer' : confirm.type === 'markReplied' ? 'Marquer comme ayant répondu' : 'Ne pas envoyer';

  if (noEnrollmentAtAll) {
    return (
      <EmptyState
        illustration="envoi"
        title="Aucun candidat inscrit."
        description="Les candidats inscrits dans cette séquence s’afficheront ici, avec leur statut et leur prochaine action."
        action={
          <Button asChild variant="outline" size="sm" className="max-md:h-11">
            <Link to={enrollHref}>Inscrire des candidats</Link>
          </Button>
        }
      />
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="group" aria-label="Filtrer les candidats" className="-mx-1 flex max-w-full gap-1 overflow-x-auto px-1 scrollbar-hide">
          {chips.map((c) => {
            const n = counts?.[c.key];
            const active = chip === c.key;
            return (
              <Button
                key={c.key}
                type="button"
                variant="ghost"
                size="sm"
                aria-pressed={active}
                onClick={() => onChipChange(c.key)}
                className={cn('shrink-0 gap-1.5 max-md:h-11', active ? 'bg-muted font-semibold text-foreground hover:bg-muted' : 'text-foreground-secondary')}
              >
                {c.label}
                {n !== undefined && n > 0 && <span className="font-semibold tabular-nums text-foreground">{n}</span>}
              </Button>
            );
          })}
        </div>
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            type="search"
            aria-label="Rechercher un candidat"
            placeholder="Rechercher un candidat"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-9 max-md:h-11"
          />
        </div>
      </div>

      {selectedRows.length > 0 && (
        <div role="toolbar" aria-label="Actions sur la sélection" className="flex flex-wrap items-center gap-2 border-y border-border py-2">
          <span className="text-sm text-foreground">
            <span className="font-semibold tabular-nums">{selectedRows.length}</span> candidat{selectedRows.length > 1 ? 's' : ''} sélectionné{selectedRows.length > 1 ? 's' : ''}
          </span>
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground max-md:h-11" loading={bulkBusy === 'pause'} disabled={bulkBusy !== null}
            onClick={async () => { setBulkBusy('pause'); await pauseEnrollments(selectedRows.map((e) => e.id)); setBulkBusy(null); setSelected(new Set()); }}>
            {bulkBusy !== 'pause' && <Pause aria-hidden="true" />}
            Mettre en pause
          </Button>
          <Button type="button" variant="outline" size="sm" className="max-md:h-11" loading={bulkBusy === 'resume'} disabled={bulkBusy !== null}
            onClick={() => setConfirm({ type: 'resume', ids: selectedRows.map((e) => e.id) })}>
            {bulkBusy !== 'resume' && <Play aria-hidden="true" />}
            Reprendre
          </Button>
          <Button type="button" variant="ghost" size="sm" className="text-muted-foreground max-md:h-11" loading={bulkBusy === 'stop'} disabled={bulkBusy !== null}
            onClick={() => { void stop(selectedRows.map((e) => e.id)); }}>
            {bulkBusy !== 'stop' && <XCircle aria-hidden="true" />}
            Arrêter
          </Button>
          <Button type="button" variant="outline" size="sm" className="max-md:h-11" loading={bulkBusy === 'replied'} disabled={bulkBusy !== null}
            onClick={() => setConfirm({ type: 'markReplied', ids: selectedRows.map((e) => e.id) })}>
            {bulkBusy !== 'replied' && <CheckCircle2 aria-hidden="true" />}
            Marquer comme ayant répondu
          </Button>
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Vider la sélection" onClick={() => setSelected(new Set())} className="max-md:h-11 max-md:w-11">
            <X aria-hidden="true" />
          </Button>
        </div>
      )}

      {data.loading ? (
        <div role="status" aria-label="Chargement des inscriptions" className="divide-y divide-border border-y border-border">
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} className="flex h-16 items-center gap-3 px-3">
              <Skeleton className="h-8 w-8 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-3.5 w-1/3 rounded-sm" />
                <Skeleton className="h-3 w-1/2 rounded-sm" />
              </div>
              <Skeleton className="hidden h-3 w-32 rounded-sm md:block" />
            </div>
          ))}
        </div>
      ) : data.loadError && enrollments.length === 0 ? (
        <ErrorState
          title="Inscriptions indisponibles pour l’instant."
          description="Vérifiez votre connexion, puis réessayez."
          detail={data.loadError}
          onRetry={() => { void data.reload(); }}
        />
      ) : enrollments.length === 0 ? (
        <EmptyState
          variant="compact"
          icon={Search}
          title={query ? `Aucun candidat ne correspond à « ${query} ».` : emptyChipText(chip)}
          action={
            <Button type="button" variant="outline" size="sm" className="max-md:h-11" onClick={() => { setSearch(''); setQuery(''); onChipChange('tous'); }}>
              Effacer les filtres
            </Button>
          }
        />
      ) : (
        <>
          {/* Disposition fixe : le nom et le titre se tronquent au lieu d'élargir le tableau. */}
          <table className="w-full table-fixed border-collapse text-sm">
            <caption className="sr-only">Candidats inscrits</caption>
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted-foreground">
                <th scope="col" className="w-10 py-2 pl-3 pr-1 font-medium">
                  <Checkbox
                    checked={allSelected}
                    disabled={selectable.length === 0}
                    onCheckedChange={(on) => setSelected(on ? new Set(selectable.map((e) => e.id)) : new Set())}
                    aria-label="Sélectionner tous les candidats affichés"
                    className={CHECKBOX_TOUCH}
                  />
                </th>
                <th scope="col" className="py-2 pr-3 font-medium">Candidat</th>
                <th scope="col" className="hidden w-36 py-2 pr-3 font-medium lg:table-cell">Étape</th>
                <th scope="col" className="hidden w-48 py-2 pr-3 font-medium md:table-cell">Statut</th>
                <th scope="col" className="hidden w-56 py-2 pr-3 font-medium md:table-cell">Prochaine action</th>
                <th scope="col" className="hidden w-14 py-2 pr-3 font-medium lg:table-cell"><abbr title="Expéditeur" className="no-underline">Exp.</abbr></th>
                <th scope="col" className="w-12 py-2 pr-2 font-medium"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {enrollments.map((e) => {
                const line = lineOf(e);
                const name = e.profile_name || 'Candidat';
                const own = ownRow(e);
                const gdpr = isGdprErased(e);
                const step = stepOf(e);
                const sender = memberName(e.created_by ?? null);
                const action = renderAction(e, line);
                const manualStop = readManualStopFromTracking(e.status, e.tracking_data);
                const review = reviewExec(e);
                const scheduled = scheduledExec(e);
                const statusBlock = (
                  <>
                    <p className={cn('text-sm', TONE_CLASS[line.tone])}>{line.label}</p>
                    {!own && e.status === 'paused' && !gdpr && (
                      <p className="mt-0.5 text-xs text-muted-foreground">Inscrit par un autre membre : un administrateur ou ce membre peut le reprendre.</p>
                    )}
                  </>
                );
                const nextBlock = (line.next || action) && (
                  <div className="space-y-1">
                    {line.next && <p className="text-sm text-muted-foreground">{line.next}</p>}
                    {action}
                  </div>
                );
                return (
                  <tr
                    key={e.id}
                    onClick={(event) => openRow(event, e.id)}
                    className={cn('group cursor-pointer border-b border-border align-top transition-colors duration-150 last:border-b-0 hover:bg-accent/40', selected.has(e.id) && 'bg-accent/40')}
                  >
                    <td className="py-3 pl-3 pr-1">
                      <Checkbox
                        checked={selected.has(e.id)}
                        disabled={!own}
                        onCheckedChange={(on) => toggle(e.id, on === true)}
                        aria-label={`Sélectionner ${name}`}
                        className={cn('mt-1.5', CHECKBOX_TOUCH)}
                      />
                    </td>
                    <td className="min-w-0 py-3 pr-3">
                      <div className="flex min-w-0 items-start gap-3">
                        <PersonAvatar name={name} size={32} className="mt-0.5 shrink-0" />
                        <div className="min-w-0">
                          <p className="truncate text-md font-semibold text-foreground">{name}</p>
                          {e.profile_headline && <p className="truncate text-xs text-muted-foreground">{e.profile_headline}</p>}
                          {/* Téléphone et tablette : statut et prochaine action sous le nom. */}
                          <div className="mt-1.5 space-y-1 md:hidden">
                            {step && <p className="text-xs text-muted-foreground">{step}</p>}
                            {statusBlock}
                            {nextBlock}
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="hidden py-3 pr-3 text-sm text-foreground-secondary lg:table-cell">{step ?? <span className="text-muted-foreground">-</span>}</td>
                    <td className="hidden py-3 pr-3 md:table-cell">{statusBlock}</td>
                    <td className="hidden py-3 pr-3 md:table-cell">{nextBlock}</td>
                    <td className="hidden py-3 pr-3 lg:table-cell">
                      {sender && (
                        <span title={sender === 'vous' ? 'Vous' : sender} className="inline-flex">
                          <PersonAvatar name={sender === 'vous' ? 'Vous' : sender} size={24} alt={sender === 'vous' ? 'Vous' : sender} />
                        </span>
                      )}
                    </td>
                    <td className="py-2 pr-2 text-right">
                      <DropdownMenu modal={false}>
                        <DropdownMenuTrigger asChild>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon-sm"
                            aria-label={`Actions pour ${name}`}
                            className={cn(REVEAL_ON_ROW, 'data-[state=open]:opacity-100 max-md:h-11 max-md:w-11')}
                          >
                            <MoreHorizontal aria-hidden="true" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end" className="w-72">
                          {own && e.status === 'active' && (
                            <DropdownMenuItem onSelect={() => { void stopEnrollment(e.id); }} className="gap-2 max-md:min-h-11">
                              <Pause className="h-4 w-4" aria-hidden="true" />
                              Mettre en pause pour ce candidat
                            </DropdownMenuItem>
                          )}
                          {e.status === 'paused' && e.pause_reason === 'account_disconnected' && (
                            <DropdownMenuItem asChild className="gap-2 max-md:min-h-11">
                              <Link to="/settings/account/connections"><RefreshCw className="h-4 w-4" aria-hidden="true" />Reconnecter le compte</Link>
                            </DropdownMenuItem>
                          )}
                          {e.status === 'paused' && e.pause_reason === 'subscription_required' && (
                            <DropdownMenuItem asChild className="gap-2 max-md:min-h-11">
                              <Link to="/pricing"><ExternalLink className="h-4 w-4" aria-hidden="true" />Voir les offres</Link>
                            </DropdownMenuItem>
                          )}
                          {e.status === 'paused' && (e.pause_reason === 'send_failed' || e.pause_reason === 'auto_paused') && (
                            <DropdownMenuItem onSelect={() => onJourneyChange(e.id)} className="gap-2 max-md:min-h-11">
                              <AlertCircle className="h-4 w-4" aria-hidden="true" />
                              Voir l’erreur
                            </DropdownMenuItem>
                          )}
                          {canResume(e) && (
                            <DropdownMenuItem onSelect={() => setConfirm({ type: 'resume', ids: [e.id] })} className="gap-2 max-md:min-h-11">
                              <Play className="h-4 w-4" aria-hidden="true" />
                              {resumeRetriesFailedStep(e) ? 'Réessayer l’étape en échec' : 'Reprendre la séquence'}
                            </DropdownMenuItem>
                          )}
                          {own && review && (
                            <DropdownMenuItem onSelect={() => setEditing({ exec: review, name, aiReview: true })} className="gap-2 max-md:min-h-11">
                              <Sparkles className="h-4 w-4" aria-hidden="true" />
                              Relire le message
                            </DropdownMenuItem>
                          )}
                          {own && e.status === 'active' && scheduled && (
                            <DropdownMenuItem onSelect={() => setConfirm({ type: 'skip', exec: scheduled, name })} className="gap-2 max-md:min-h-11">
                              <Ban className="h-4 w-4" aria-hidden="true" />
                              Ne pas envoyer cette étape
                            </DropdownMenuItem>
                          )}
                          {own && !gdpr && (e.status === 'active' || e.status === 'paused') && (
                            <DropdownMenuItem
                              onSelect={() => { void stop([e.id]); }}
                              aria-label={STOP_FOR_CANDIDATE_LABEL}
                              aria-describedby={`stop-help-${e.id}`}
                              className="items-start gap-2 max-md:min-h-11"
                            >
                              <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                              <span className="flex min-w-0 flex-col">
                                <span>{STOP_FOR_CANDIDATE_LABEL}</span>
                                <span id={`stop-help-${e.id}`} className="whitespace-normal text-xs text-muted-foreground">{MANUAL_STOP_HELP}</span>
                              </span>
                            </DropdownMenuItem>
                          )}
                          {own && (e.status === 'active' || e.status === 'paused' || e.status === 'completed') && (
                            <DropdownMenuItem onSelect={() => setConfirm({ type: 'markReplied', ids: [e.id] })} className="gap-2 max-md:min-h-11">
                              <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
                              Marquer comme ayant répondu
                            </DropdownMenuItem>
                          )}
                          {own && !gdpr && ['replied', 'completed', 'cancelled', 'stopped'].includes(e.status) && !isMeetingBookedCompletion(e.status, e.tracking_data) && (
                            <DropdownMenuItem onSelect={() => setConfirm({ type: 'reEnroll', id: e.id })} className="gap-2 max-md:min-h-11">
                              <RefreshCw className="h-4 w-4" aria-hidden="true" />
                              {manualStop ? RELAUNCH_AFTER_STOP_LABEL : 'Relancer depuis l’étape suivante'}
                            </DropdownMenuItem>
                          )}
                          <DropdownMenuSeparator />
                          <DropdownMenuItem onSelect={() => onJourneyChange(e.id)} className="gap-2 max-md:min-h-11">
                            <Route className="h-4 w-4" aria-hidden="true" />
                            Voir le parcours
                          </DropdownMenuItem>
                          {e.profile_url && (
                            <DropdownMenuItem asChild className="gap-2 max-md:min-h-11">
                              <a href={e.profile_url} target="_blank" rel="noopener noreferrer"><ExternalLink className="h-4 w-4" aria-hidden="true" />Voir sur LinkedIn</a>
                            </DropdownMenuItem>
                          )}
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {data.hasMore && (
            <div className="flex justify-center">
              <Button type="button" variant="ghost" size="sm" onClick={() => { void data.loadMore(); }} loading={data.loadingMore} className="max-md:h-11">
                Afficher la suite
              </Button>
            </div>
          )}
        </>
      )}

      <JourneyPanel
        enrollmentId={journeyId}
        sequenceId={sequence.id}
        steps={stepRows}
        reloadKey={journeyKey}
        onClose={() => onJourneyChange(null)}
        statusLineOf={(e) => {
          if (e.profile_name) names.current.set(e.id, e.profile_name);
          return lineOf(e);
        }}
        renderAction={renderAction}
        memberName={(id) => memberName(id)}
        canAct={ownRow}
        onEditMessage={(exec, e) => setEditing({ exec, name: e.profile_name, aiReview: false })}
        onReviewMessage={(exec, e) => setEditing({ exec, name: e.profile_name, aiReview: true })}
        onSkipStep={(exec, e) => setConfirm({ type: 'skip', exec, name: e.profile_name || 'Ce candidat' })}
      />

      <AlertDialog open={!!confirm} onOpenChange={(open) => !open && setConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmTitle}</AlertDialogTitle>
            <AlertDialogDescription>{confirmText}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{confirm?.type === 'skip' ? 'Garder l’envoi' : 'Annuler'}</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void onConfirm(); }} className={confirm?.type === 'skip' ? 'bg-destructive hover:bg-destructive/90' : undefined}>
              {confirmAction}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <EditScheduledMessageModal
        isOpen={!!editing}
        onClose={() => setEditing(null)}
        execution={editing ? {
          id: editing.exec.id,
          scheduled_at: editing.exec.scheduled_at,
          final_subject: editing.exec.final_subject,
          final_message: editing.exec.final_message,
          step: editing.exec.step,
          enrollment: { profile_name: editing.name },
        } : null}
        onSaved={() => { void refreshAll(); }}
        aiReview={editing?.aiReview ?? false}
      />
    </div>
  );
}

/**
 * Page d'une séquence (/sequences/:id, lot 5c-2), derrière l'interrupteur
 * konekt.sequences-v2 (garde SequencesGate).
 *
 * En-tête : fil d'Ariane (&depuis=mission:<id> passe par la mission), nom et
 * « Renommer la séquence », pastille de statut, ligne de rythme, un seul
 * bouton plein, menu « ... ». Onglets (?onglet=) : Étapes, Candidats
 * (?statut=, ?parcours=), Statistiques, Journal, Réglages.
 *
 * Onglet Étapes (lot 5d-2) : l'éditeur unique pour qui peut modifier la
 * séquence (étapes relues par handleEdit, état tenu par useSequenceEditor),
 * le fil en lecture pour les autres. Un seul « Enregistrer » pour les étapes
 * et les Réglages (bouton de l'en-tête ou Ctrl/Cmd+S), brouillon local,
 * « Quitter sans enregistrer ? » (useSequenceEditorSession). Les étapes
 * s'écrivent par useSequenceSave (save_sequence_steps), comme l'ancien
 * éditeur. /sequences/nouvelle : SequenceCreatePage, même éditeur.
 *
 * Les gestes sont ceux de la liste des séquences (src/lib/sequenceActions.ts,
 * appliqués à une liste d'une seule séquence), du suivi des inscrits et du
 * lot 5b : aucune écriture d'exécution, aucune reprise ni statut 'active'
 * écrit depuis le navigateur ; les reprises passent par le serveur.
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import { useUndoableEnrollmentAction } from '@/hooks/useUndoableEnrollmentAction';
import { useSequenceSave } from '@/hooks/useSequenceSave';
import { useSequenceEditor } from '@/hooks/useSequenceEditor';
import { useSequenceEditorSession } from '@/hooks/useSequenceEditorSession';
import { sequenceEditorDraftKey } from '@/hooks/useSequenceEditorDraft';
import { useSequenceDetail } from '@/hooks/useSequenceDetail';
import { useInertWhile } from '@/hooks/useInertWhile';
import { DEFAULT_QUOTAS, useMemberQuotas } from '@/hooks/useMemberQuotas';
import { hasPlanFeature } from '@/lib/featureGates';
import { SEQUENCES_PATH, sequencePath } from '@/lib/sequencesBeta';
import {
  candidats,
  COLLABORATOR_DEACTIVATION_HINT,
  createSequenceListActions,
  DEFAULT_STOP_CONDITIONS,
  PLAN_STATE_LOADING_MESSAGE,
  sequenceSaveError,
  type ActivateConfirm,
  type EditorBaseStepIds,
  type SequenceWithStats,
} from '@/lib/sequenceActions';
import { isDraftSequence } from '@/lib/sequenceTableStats';
import { parseEnrollmentChip, type EnrollmentChip } from '@/lib/enrollmentStatusLine';
import { isAiReviewPending } from '@/lib/sequenceErrorMessages';
import { withAlwaysOnStops, type SequenceIssue } from '@/components/outreach/sequence/sequenceGraph';
import { issueStepOrder, openEditorSteps, removedStepCount } from '@/lib/sequenceEditor';
import type { Sequence, SequenceStep } from '@/types/sequence';
import { SEOHead } from '@/components/SEOHead';
import { ErrorState, PageLayout } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent } from '@/components/ui/tabs';
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
import { SequenceHeader } from '@/components/sequences/SequenceHeader';
import { SequenceMenu } from '@/components/sequences/SequenceMenu';
import { SequenceStatusPill } from '@/components/sequences/SequenceStatusPill';
import { SequenceTabs } from '@/components/sequences/SequenceTabs';
import { parseSequenceTab } from '@/components/sequences/sequenceTabsModel';
import { RhythmLine, type SendingHours } from '@/components/sequences/RhythmLine';
import { StepsReadOnly } from '@/components/sequences/StepsReadOnly';
import { StepsEditor } from '@/components/sequences/editor/StepsEditor';
import { useMissionDraftReadiness } from '@/hooks/useSequenceAI';
import { SaveDialogs } from '@/components/sequences/editor/SaveDialogs';
import { SequenceCreatePage } from '@/components/sequences/SequenceCreatePage';
import { CandidatesTab } from '@/components/sequences/CandidatesTab';
import { JournalTab } from '@/components/sequences/JournalTab';
import { SettingsTab, type SequenceSettingsDraft } from '@/components/sequences/SettingsTab';

// Statistiques : recharts (~100 Ko) chargé à l'ouverture de l'onglet.
const SequenceAnalytics = React.lazy(() => import('@/components/outreach/SequenceAnalytics'));

const OTHER_ORG_READ_ONLY_HINT = 'Séquence d’une autre organisation : vous pouvez la consulter, pas la modifier.';
const NOT_AUTHOR_READ_ONLY_HINT = 'Seul l’auteur de cette séquence peut la modifier : dupliquez-la pour l’adapter.';
const FAILURE_PAUSE_REASONS = ['send_failed', 'auto_paused'];
/** Étapes lues pour trouver la prochaine envoyable (au-delà, inconnue). */
const NEXT_AT_SCAN = 25;

/** Mission d'origine lue dans &depuis=mission:<id>. */
function fromMission(raw: string | null): string | null {
  if (!raw?.startsWith('mission:')) return null;
  return raw.slice('mission:'.length) || null;
}

function settingsOf(seq: SequenceWithStats): SequenceSettingsDraft {
  return {
    stopConditions: { ...DEFAULT_STOP_CONDITIONS, ...(seq.stop_conditions ?? {}) },
    multiSenderEnabled: !!seq.multi_sender_enabled,
    senderAccounts: seq.sender_accounts ?? [],
    rotationMode: seq.rotation_mode ?? 'round_robin',
  };
}

interface EditorDraftValue {
  steps: SequenceStep[];
  settings: SequenceSettingsDraft | null;
}

const draftTime = (date: Date) => `${date.toLocaleDateString('fr-FR')} à ${date.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}`;

/** `creating` : route /sequences/nouvelle (placée avant /sequences/:id dans App.tsx). */
export default function SequenceDetailPage({ creating = false }: { creating?: boolean }) {
  const { id } = useParams<{ id: string }>();
  return creating ? <SequenceCreatePage /> : <SequenceView id={id} />;
}

function SequenceView({ id }: { id: string | undefined }) {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { organizationId, isCollaborator } = useOrganization();
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const missionId = fromMission(searchParams.get('depuis'));
  const { sequence, sequences, setSequences, state, countsError, fetchSequence } = useSequenceDetail(id);
  const [missionName, setMissionName] = useState<string | null>(null);
  const [linkedMission, setLinkedMission] = useState<{ name: string; client: string | null } | null>(null);

  // Décision 32 : aucune activation tant que l'état d'abonnement n'est pas lu.
  const { effectivePlanId, isLoading: isPlanLoading, isLoadingError: isPlanLoadError, refetch: refetchPlan } = useSubscriptionState();
  const canSendSequences = isPlanLoading || hasPlanFeature(effectivePlanId, 'sequences_send');
  const planStateUnknown = isPlanLoading || isPlanLoadError;
  const planRef = useRef({ unknown: planStateUnknown, loadError: isPlanLoadError, canSend: canSendSequences });
  planRef.current = { unknown: planStateUnknown, loadError: isPlanLoadError, canSend: canSendSequences };

  const { offerUndo, resumeIds, showSummary } = useUndoableEnrollmentAction();
  const { isReady: quotasReady, getQuotaForUser } = useMemberQuotas();

  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [activateConfirm, setActivateConfirm] = useState<ActivateConfirm>(null);
  const [duplicatingId, setDuplicatingId] = useState<string | null>(null);
  const duplicatingRef = useRef(false);
  const [nudging, setNudging] = useState(false);
  // L'ancienne fenêtre d'édition n'est plus ouverte ici : handleEdit relit les
  // étapes en base et les confie à l'éditeur unique de l'onglet Étapes.
  const [, setShowBuilder] = useState(false);
  const [editingSequence, setEditingSequence] = useState<Sequence | null>(null);
  const [editingActiveCount, setEditingActiveCount] = useState<number | undefined>(0);
  // Étapes telles que lues à l'ouverture : point de départ du brouillon et des étapes retirées.
  const [editorBase, setEditorBase] = useState<string | null>(null);
  const editorBaseStepIdsRef = useRef<EditorBaseStepIds>(null);
  const editor = useSequenceEditor();
  const { reset: resetEditor } = editor;
  const [editorLoad, setEditorLoad] = useState<{ id: string; state: 'loading' | 'ready' | 'error' } | null>(null);
  const editorLoadRef = useRef(editorLoad);
  editorLoadRef.current = editorLoad;
  const [settingsDraft, setSettingsDraft] = useState<SequenceSettingsDraft | null>(null);
  const [settingsErrors, setSettingsErrors] = useState<string[]>([]);
  const [savingSettings, setSavingSettings] = useState(false);
  const [nextAt, setNextAt] = useState<string | null | undefined>(undefined);
  const healthRef = useRef<HTMLElement>(null);
  const [focusHealth, setFocusHealth] = useState(false);

  // ── Adresse : onglet, puce, parcours ────────────────────────────────────
  const hasEnrollments = countsError || (sequence?.enrollments.total ?? 0) > 0;
  const tab = parseSequenceTab(searchParams.get('onglet'), hasEnrollments);
  const chip = parseEnrollmentChip(searchParams.get('statut'));
  const journeyId = searchParams.get('parcours');
  const setParam = useCallback((key: string, value: string | null) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (value === null) params.delete(key);
      else params.set(key, value);
      return params;
    }, { replace: true });
  }, [setSearchParams]);
  const setTab = (next: string) => setParam('onglet', next);
  const setChip = (next: EnrollmentChip) => setParam('statut', next === 'tous' ? null : next);
  const setJourney = (next: string | null) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next) {
        params.set('parcours', next);
        params.set('onglet', 'candidats');
      } else {
        params.delete('parcours');
      }
      return params;
    }, { replace: true });
  };

  // Fil d'Ariane depuis une mission, et mission de la séquence (Réglages) : noms lus sous la RLS.
  useEffect(() => {
    if (!missionId) {
      setMissionName(null);
      return;
    }
    let cancelled = false;
    void supabase.from('sourcing_projects').select('name').eq('id', missionId).maybeSingle().then(({ data }) => {
      if (!cancelled) setMissionName(data?.name ?? null);
    });
    return () => {
      cancelled = true;
    };
  }, [missionId]);
  const projectId = sequence?.project_id ?? null;
  useEffect(() => {
    if (!projectId) {
      setLinkedMission(null);
      return;
    }
    let cancelled = false;
    void supabase.from('sourcing_projects').select('name, client_name').eq('id', projectId).maybeSingle().then(({ data }) => {
      if (!cancelled) setLinkedMission(data ? { name: data.name, client: data.client_name ?? null } : null);
    });
    return () => {
      cancelled = true;
    };
  }, [projectId]);

  // Prochaine étape envoyable d'un candidat en cours (ligne de rythme). Une
  // étape rédigée par l'IA en attente de relecture ne part pas (le moteur la
  // repousse d'une heure à chaque passage, lot 5a-2) : elle n'est pas annoncée.
  const sequenceId = sequence?.id ?? null;
  const enrollmentTotal = sequence?.enrollments.total ?? 0;
  const loadNextAt = useCallback(async () => {
    if (!sequenceId) return;
    const { data, error } = await supabase
      .from('sequence_step_executions')
      .select('scheduled_at, status, error_message, final_message, sequence_enrollments!inner(sequence_id, status)')
      .eq('sequence_enrollments.sequence_id', sequenceId)
      .eq('sequence_enrollments.status', 'active')
      .in('status', ['scheduled', 'quota_blocked'])
      .order('scheduled_at', { ascending: true })
      .limit(NEXT_AT_SCAN);
    if (error) {
      console.warn('[SequenceDetailPage] prochaine action indisponible:', error);
      setNextAt(undefined);
      return;
    }
    const rows = data ?? [];
    const sendable = rows.find((row) => !isAiReviewPending(row));
    // Toutes les étapes lues attendent une relecture : la prochaine envoyable est inconnue, rien n'est annoncé.
    setNextAt(sendable?.scheduled_at ?? (rows.length === NEXT_AT_SCAN ? undefined : null));
  }, [sequenceId]);
  useEffect(() => {
    void loadNextAt();
  }, [loadNextAt, enrollmentTotal]);

  const refreshPage = useCallback(async () => {
    await fetchSequence();
    void loadNextAt();
  }, [fetchSequence, loadNextAt]);

  // « Diagnostic des envois » : la carte « État de l'envoi » du Journal.
  useEffect(() => {
    if (!focusHealth || tab !== 'journal') return;
    const frame = window.requestAnimationFrame(() => {
      healthRef.current?.scrollIntoView({ block: 'start' });
      healthRef.current?.focus({ preventScroll: true });
      setFocusHealth(false);
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusHealth, tab]);

  // ── Droits ──────────────────────────────────────────────────────────────
  const canManage = (seq: SequenceWithStats) => !!organizationId && seq.organization_id === organizationId;
  // Contrat §8 : un collaborateur ne modifie, ne supprime et n'active que ses séquences.
  const canEdit = (seq: SequenceWithStats) => canManage(seq) && (!isCollaborator || (!!userId && seq.created_by === userId));
  const readOnlyHint = (seq: SequenceWithStats) => (canManage(seq) ? NOT_AUTHOR_READ_ONLY_HINT : OTHER_ORG_READ_ONLY_HINT);
  // D3 : la mise en pause de toute la séquence n'est pas proposée à un collaborateur.
  const deactivationLocked = (seq: SequenceWithStats) => seq.is_active && isCollaborator;
  const enrollmentsPanelAction = () => ({
    // Même garde qu'un changement d'onglet : « Quitter sans enregistrer ? » s'il reste des modifications.
    action: { label: 'Voir les inscrits', onClick: () => changeTab('candidats') },
  });

  // Étapes relues par handleEdit : l'éditeur repart de cet état enregistré,
  // avec la même transformation que l'ancien éditeur à l'ouverture.
  const openInEditor = useCallback((next: Sequence | null) => {
    setEditingSequence(next);
    if (!next?.id) return;
    resetEditor(openEditorSteps(next.steps));
    setEditorBase(JSON.stringify(openEditorSteps(next.steps)));
    setEditorLoad({ id: next.id, state: 'ready' });
  }, [resetEditor]);

  // Enregistrement des étapes : même chemin que l'ancien éditeur (en-tête, puis save_sequence_steps).
  const { handleSaveSequence } = useSequenceSave({
    organizationId,
    projectId: sequence?.project_id ?? null,
    canSendSequences,
    planStateUnknown,
    editorBaseStepIdsRef,
    navigate,
    fetchSequences: refreshPage,
    setShowBuilder,
    setEditingSequence,
  });

  const { handleNudgeToday, activateSequence, requestToggle, handleDelete, handleDuplicate, handleEdit } = createSequenceListActions({
    supabase, invokeEdgeFunction, toast, navigate,
    organizationId, projectId: null, userId, isCollaborator,
    sequences, setSequences, fetchSequences: refreshPage, togglingId, setTogglingId,
    canManage, canEdit, readOnlyHint, deactivationLocked, enrollmentsPanelAction,
    offerUndo, resumeIds, showSummary,
    planRef, refetchPlan, planStateUnknown, isPlanLoadError, canSendSequences,
    missionSequenceIds: sequence && canManage(sequence) && sequence.is_active ? [sequence.id] : [],
    setNudging, setNudgeConfirmOpen: () => undefined,
    setActivateConfirm, setDeleteConfirmId: () => undefined, duplicatingRef, setDuplicatingId,
    editorBaseStepIdsRef, setEditingActiveCount, setEditingSequence: openInEditor, setShowBuilder,
    copyName: (name) => `Copie de ${name}`,
    onDuplicated: (copy) => navigate(sequencePath(copy.id, missionId)),
  });

  // Onglet Étapes (ou Réglages, pour que des réglages modifiés aient leur
  // brouillon) ouvert par qui peut modifier : étapes relues en base une fois
  // par séquence (handleEdit), puis gardées par l'éditeur d'un onglet à l'autre.
  const editable = !!sequence && canEdit(sequence);
  const loadEditor = useCallback(async (seq: SequenceWithStats) => {
    setEditorLoad({ id: seq.id, state: 'loading' });
    await handleEdit(seq);
    // Étapes illisibles : handleEdit l'a dit par un message et n'a rien ouvert.
    setEditorLoad((prev) => (prev?.id === seq.id && prev.state === 'loading' ? { id: seq.id, state: 'error' } : prev));
  }, [handleEdit]);
  useEffect(() => {
    if (state !== 'ready' || !sequence || !editable || (tab !== 'etapes' && tab !== 'reglages')) return;
    if (editorLoadRef.current?.id === sequence.id) return;
    void loadEditor(sequence);
  }, [state, sequence, editable, tab, loadEditor]);
  const hours: SendingHours | null = useMemo(() => {
    if (!quotasReady || !userId) return null;
    const own = getQuotaForUser(userId);
    return {
      start: own?.business_hours_start ?? DEFAULT_QUOTAS.business_hours_start,
      end: own?.business_hours_end ?? DEFAULT_QUOTAS.business_hours_end,
      timezone: own?.timezone ?? DEFAULT_QUOTAS.timezone,
    };
  }, [quotasReady, userId, getQuotaForUser]);

  // ── Réglages : brouillon, puis « Enregistrer » de l'en-tête ─────────────
  const baseSettings = useMemo(() => (sequence ? settingsOf(sequence) : null), [sequence]);
  const settings = settingsDraft ?? baseSettings;
  const settingsDirty = !!settingsDraft && !!baseSettings && JSON.stringify(settingsDraft) !== JSON.stringify(baseSettings);

  /** Réglages seuls (étapes inchangées) : écriture de l'en-tête, comme avant le lot 5d-2. Lève en cas d'échec. */
  const saveSettings = async () => {
    if (!sequence || !settingsDraft) return;
    setSavingSettings(true);
    try {
      const { data, error } = await supabase
        .from('outreach_sequences')
        .update({
          stop_conditions: withAlwaysOnStops(settingsDraft.stopConditions) as unknown as Json,
          sender_accounts: settingsDraft.senderAccounts as unknown as Json,
          rotation_mode: settingsDraft.rotationMode,
          multi_sender_enabled: settingsDraft.multiSenderEnabled,
        })
        .eq('id', sequence.id)
        .select('id');
      if (error) throw sequenceSaveError(error);
      if (!data || data.length === 0) throw new Error('Vous n’avez pas les droits nécessaires pour enregistrer cette séquence.');
      toast.success('Réglages enregistrés');
      setSettingsDraft(null);
      await fetchSequence();
    } finally {
      setSavingSettings(false);
    }
  };

  // ── Éditeur : enregistrement, brouillon, sortie ─────────────────────────
  const editorReady = !!sequence && editable && editorLoad?.id === sequence.id && editorLoad.state === 'ready';
  const baseSteps = editingSequence?.id === sequence?.id ? editingSequence?.steps ?? [] : [];
  const draftBase = editorReady && editorBase !== null ? JSON.stringify({ steps: editorBase, settings: baseSettings }) : null;
  const draftValue = useMemo<EditorDraftValue>(() => ({ steps: editor.steps, settings: settingsDraft }), [editor.steps, settingsDraft]);

  const performSave = async () => {
    if (!sequence || !settings) return;
    if (!session.stepsDirty) {
      await saveSettings();
      return;
    }
    // Étapes modifiées : un seul enregistrement, réglages compris (en-tête puis save_sequence_steps).
    await handleSaveSequence({
      ...(editingSequence ?? { isActive: sequence.is_active }),
      id: sequence.id,
      name: sequence.name,
      description: sequence.description || undefined,
      isActive: sequence.is_active,
      steps: editor.steps,
      stopConditions: withAlwaysOnStops(settings.stopConditions),
      senderAccounts: settings.senderAccounts,
      rotationMode: settings.rotationMode,
      multiSenderEnabled: settings.multiSenderEnabled,
    });
    setSettingsDraft(null);
    session.draft.clear();
    // Étapes relues en base : nouveaux identifiants des étapes ajoutées, contrôle de modification concurrente à jour.
    await handleEdit(sequence);
  };

  const showBlocked = (errors: readonly SequenceIssue[]) => {
    const first = errors[0];
    if (!first) return;
    if (first.area === 'senders') {
      setSettingsErrors(errors.filter((e) => e.area === 'senders').map((e) => e.message));
      setTab('reglages');
      return;
    }
    setTab('etapes');
    const order = issueStepOrder(first.message);
    const target = order === null ? undefined : editor.steps.find((st) => st.order === order && (!st.variantGroup || st.variantGroup === 'A'));
    if (target) editor.select(target.id);
  };

  const session = useSequenceEditorSession<EditorDraftValue>({
    editor,
    loaded: editorReady,
    name: sequence?.name ?? '',
    settings,
    settingsDirty: editable && settingsDirty,
    creating: false,
    organizationId,
    sequenceId: sequence?.id ?? null,
    missionId: sequence?.project_id ?? null,
    stepsTabActive: tab === 'etapes',
    draftKey: sequence ? sequenceEditorDraftKey(userId, organizationId, sequence.id) : null,
    draftBase,
    draftValue,
    draftDirty: editor.dirty || settingsDirty,
    onDraftRestore: (value, savedAt) => {
      editor.restore(value.steps);
      if (value.settings) setSettingsDraft(value.settings);
      toast.info('Modifications non enregistrées reprises', {
        description: savedAt ? `Retrouvées dans ce navigateur (${draftTime(savedAt)}).` : 'Retrouvées dans ce navigateur.',
        duration: 12000,
        action: { label: 'Revenir à la version enregistrée', onClick: () => discardChanges() },
      });
    },
    removedStepCount: editorReady ? removedStepCount(baseSteps, editor.steps) : 0,
    activeEnrollmentCount: editingActiveCount,
    perform: performSave,
    onBlocked: showBlocked,
    onDiscard: () => {
      editor.discard();
      setSettingsDraft(null);
      setSettingsErrors([]);
    },
  });
  const editorValidation = session.validation;
  // Lot 5e : « Demander à l'IA » dans le panneau d'étape ; « Rédiger à partir du poste » avec la mission de la séquence.
  const draftReadiness = useMissionDraftReadiness(sequence?.project_id ?? null);
  const askAI = useMemo(
    () => ({ organizationId, missionId: sequence?.project_id ?? null, jobDescribed: draftReadiness.described }),
    [organizationId, sequence?.project_id, draftReadiness.described],
  );
  const dirty = editable && (session.dirty || settingsDirty);
  // Enregistrement en cours : étapes et réglages figés, rien de tapé ne peut être remplacé par la version relue.
  const saving = session.flow.saving || savingSettings;
  const settingsAreaRef = useRef<HTMLDivElement>(null);
  useInertWhile(settingsAreaRef, saving);

  function discardChanges() {
    editor.discard();
    setSettingsDraft(null);
    setSettingsErrors([]);
    session.draft.clear();
  }

  // Quitter l'édition (Étapes, Réglages) pour un autre onglet : demandé s'il reste des modifications.
  const isEditingTab = (value: string) => value === 'etapes' || value === 'reglages';
  const changeTab = (next: string) => {
    if (dirty && isEditingTab(tab) && !isEditingTab(next)) session.leave.request(() => setTab(next));
    else setTab(next);
  };

  const rename = async (name: string): Promise<boolean> => {
    if (!sequence) return false;
    const { data, error } = await supabase.from('outreach_sequences').update({ name }).eq('id', sequence.id).select('id');
    if (error || !data || data.length === 0) {
      toast.error('Le nom n’a pas été enregistré', { description: error ? sequenceSaveError(error).message : 'Vous n’avez pas les droits sur cette séquence.' });
      return false;
    }
    setSequences((prev) => prev.map((s) => (s.id === sequence.id ? { ...s, name } : s)));
    toast.success('Séquence renommée');
    return true;
  };

  const deleteSequence = async () => {
    if (!sequence) return;
    const deleted = await handleDelete(sequence.id);
    // Séquence supprimée : son brouillon n'a plus d'objet.
    if (deleted) session.draft.clear();
    if (deleted) navigate(missionId ? `/missions/${encodeURIComponent(missionId)}?panneau=contact` : SEQUENCES_PATH, { replace: true });
  };

  const showDiagnostic = () => {
    changeTab('journal');
    setFocusHealth(true);
  };

  // ── Rendu ───────────────────────────────────────────────────────────────
  const header = sequence && settings && (() => {
    const editable = canEdit(sequence);
    const draft = !countsError && isDraftSequence(sequence.enrollments);
    const status = draft ? 'draft' : sequence.is_active ? 'active' : 'paused';
    const failed = countsError ? null : FAILURE_PAUSE_REASONS.reduce((sum, r) => sum + (sequence.enrollments.pausedByReason[r] ?? 0), 0);
    const waitsForPlan = !sequence.is_active && isPlanLoading;
    return (
      <SequenceHeader
        name={sequence.name}
        mission={missionId && missionName ? { id: missionId, name: missionName } : null}
        canRename={editable}
        onRename={rename}
        status={
          <SequenceStatusPill
            status={status}
            isActive={sequence.is_active}
            canToggle={editable}
            disabled={togglingId === sequence.id || waitsForPlan}
            lockedHint={deactivationLocked(sequence) ? COLLABORATOR_DEACTIVATION_HINT : waitsForPlan ? PLAN_STATE_LOADING_MESSAGE : undefined}
            onToggle={() => { void requestToggle(sequence); }}
          />
        }
        dirty={dirty}
        saving={saving}
        onSave={session.flow.save}
        saveState={editable ? session.flow.state : null}
        savedAt={session.flow.savedAt}
        enrollHref={sequence.project_id ? `/missions/${encodeURIComponent(sequence.project_id)}?tab=pipeline` : '/sourcing'}
        menu={
          <SequenceMenu
            sequence={sequence}
            canManage={canManage(sequence)}
            canEdit={editable}
            countsUnavailable={countsError}
            duplicating={duplicatingId === sequence.id}
            nudging={nudging}
            onDuplicate={() => session.leave.request(() => { void handleDuplicate(sequence); })}
            onNudge={() => { void handleNudgeToday(); }}
            onShowDiagnostic={showDiagnostic}
            onDelete={() => { void deleteSequence(); }}
          />
        }
        rhythm={
          <RhythmLine
            hours={hours}
            nextAt={nextAt}
            failedCount={failed}
            status={status}
            onShowJournal={showDiagnostic}
          />
        }
      />
    );
  })();

  return (
    <PageLayout maxWidth="xl">
      <SEOHead title={`${sequence?.name ?? 'Séquence'} | Konekt`} description="Suivi d’une séquence" />

      {state === 'loading' && (
        <div role="status" aria-label="Chargement de la séquence" className="space-y-4">
          <Skeleton className="h-4 w-40 rounded-sm" />
          <Skeleton className="h-9 w-80 rounded-sm" />
          <Skeleton className="h-3 w-96 max-w-full rounded-sm" />
          <Skeleton className="h-11 w-full rounded-sm" />
          {[0, 1, 2, 3].map((i) => <Skeleton key={i} className="h-14 w-full rounded-sm" />)}
        </div>
      )}

      {state === 'error' && (
        <ErrorState
          title="Séquence indisponible pour l’instant."
          description="Elle a peut-être été supprimée, ou la connexion a échoué."
          onRetry={() => { void fetchSequence(); }}
          action={
            <Button type="button" variant="ghost" size="sm" onClick={() => navigate(SEQUENCES_PATH)}>
              Retour
            </Button>
          }
        />
      )}

      {state === 'ready' && sequence && settings && (
        <>
          {header}
          <Tabs value={tab} onValueChange={changeTab}>
            <SequenceTabs
              active={tab}
              hasEnrollments={hasEnrollments}
              candidateCount={countsError ? null : sequence.enrollments.total}
              journalAlert={!countsError && FAILURE_PAUSE_REASONS.some((r) => (sequence.enrollments.pausedByReason[r] ?? 0) > 0)}
              // Comme à la création : une séquence sans étape n'est pas signalée (l'état vide le dit déjà).
              stepsAlert={editorReady && editorValidation.errors.some((e) => e.area !== 'senders' && e.check !== 'steps')}
              settingsAlert={editorReady && editorValidation.errors.some((e) => e.area === 'senders')}
            />
            <TabsContent value="etapes" className="mt-6">
              {canEdit(sequence) ? (
                <StepsEditor
                  editor={editor}
                  validation={editorValidation}
                  enrolledCount={countsError ? 0 : sequence.enrollments.total}
                  state={editorLoad?.id === sequence.id ? editorLoad.state : 'loading'}
                  onRetry={() => { void loadEditor(sequence); }}
                  preview={session.preview}
                  extraKeys={session.customKeys}
                  onShowSettings={() => setTab('reglages')}
                  frozen={saving}
                  askAI={askAI}
                />
              ) : (
                <StepsReadOnly
                  steps={sequence.steps}
                  canEdit={false}
                  enrolledCount={countsError ? 0 : sequence.enrollments.total}
                  onEdit={() => undefined}
                />
              )}
            </TabsContent>
            <TabsContent value="candidats" className="mt-6">
              <CandidatesTab
                sequence={sequence}
                countsUnavailable={countsError}
                chip={chip}
                onChipChange={setChip}
                journeyId={journeyId}
                onJourneyChange={setJourney}
                canManageSequence={canEdit(sequence) && !isCollaborator}
                onReactivate={() => { void requestToggle(sequence); }}
                onChanged={() => { void refreshPage(); }}
                enrollHref={sequence.project_id ? `/missions/${encodeURIComponent(sequence.project_id)}?tab=pipeline` : '/sourcing'}
              />
            </TabsContent>
            {hasEnrollments && (
              <TabsContent value="statistiques" className="mt-6">
                <React.Suspense fallback={null}>
                  <SequenceAnalytics isOpen={false} onClose={() => undefined} embedded sequenceId={sequence.id} sequenceName={sequence.name} />
                </React.Suspense>
              </TabsContent>
            )}
            {hasEnrollments && (
              <TabsContent value="journal" className="mt-6">
                <JournalTab ref={healthRef} sequenceId={sequence.id} onShowJourney={setJourney} />
              </TabsContent>
            )}
            <TabsContent value="reglages" className="mt-6">
              <div ref={settingsAreaRef} aria-busy={saving || undefined}>
                <SettingsTab
                  value={settings}
                  onChange={(next) => { setSettingsDraft(next); setSettingsErrors([]); }}
                  canEdit={canEdit(sequence)}
                  readOnlyHint={readOnlyHint(sequence)}
                  missionLabel={linkedMission ? [linkedMission.name, linkedMission.client].filter(Boolean).join(' · ') : null}
                  hours={hours}
                  errors={settingsErrors}
                />
              </div>
            </TabsContent>
          </Tabs>
        </>
      )}

      <SaveDialogs flow={session.flow} leave={session.leave} />

      {/* Réactivation avec des candidats à reprendre : confirmation actuelle. */}
      <AlertDialog open={!!activateConfirm} onOpenChange={(open) => !open && setActivateConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Réactiver cette séquence ?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2">
                <p>
                  {candidats(activateConfirm?.resumable ?? 0)} en pause {(activateConfirm?.resumable ?? 0) > 1 ? 'reprendront' : 'reprendra'}.
                  Chaque étape garde sa date prévue ; celles déjà passées partiront dans les prochaines heures.
                </p>
                {(activateConfirm?.otherMembers ?? 0) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {candidats(activateConfirm?.otherMembers ?? 0)} inscrits par d’autres membres resteront en pause : un administrateur
                    ou le membre qui les a inscrits peut les reprendre depuis l’onglet Candidats.
                  </p>
                )}
                {(activateConfirm?.otherPaused ?? 0) > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {candidats(activateConfirm?.otherPaused ?? 0)} mis en pause pour une autre raison (un par un, compte déconnecté,
                    limite atteinte) {(activateConfirm?.otherPaused ?? 0) > 1 ? 'resteront' : 'restera'} en pause.
                  </p>
                )}
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (activateConfirm) {
                  void activateSequence(activateConfirm.id, activateConfirm.resumable, activateConfirm.otherPaused, activateConfirm.otherMembers);
                }
                setActivateConfirm(null);
              }}
            >
              Réactiver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </PageLayout>
  );
}


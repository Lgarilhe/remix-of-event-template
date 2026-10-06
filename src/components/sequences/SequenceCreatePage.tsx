// Nouvelle séquence dans l'éditeur unique (lot 5d-2), derrière l'interrupteur
// konekt.sequences-v2 : /sequences/nouvelle?mission=<id>&depart=zero|modele:<clé>|copie:<id>.
//
// Départ : séquence vide, modèle Konekt (sequenceStarterTemplates.ts) ou de
// l'organisation (sequence_templates), copie d'une séquence lue sous la RLS
// (« Copie de … », mêmes règles que l'ancien choix de départ). Rien n'est
// écrit avant « Enregistrer » : la séquence est créée par useSequenceSave
// (en-tête, puis save_sequence_steps), sans envoi sur la formule gratuite
// (shouldCreateInactiveForPlan, texte de la spécification), puis la page passe
// sur son adresse (remplacement : pas d'entrée d'historique en double).
// Onglets Étapes et Réglages ; brouillon local, repris à la réouverture de la
// même adresse.
//
// Lot 5e, rédaction par l'IA à partir du poste (&depart=ia) : AIDraftWizard
// s'ouvre sur la page (« Le poste », puis « L'angle ») ; la séquence rédigée
// remplit l'onglet Étapes, non enregistrée (gardée dans le brouillon local
// comme toute saisie), avec le bandeau de la spécification et « Rédiger à
// nouveau ». &proposition=<id> : séquence proposée par l'assistant
// (create_sequence), relue dans la ligne agent_tool_executions de l'appelant ;
// sa mission entre dans l'adresse. Une étape dont l'IA n'a pas laissé de texte
// bloque l'enregistrement (validateSequence, option aiDraft) ; une formulation
// signalée est une recommandation, tant que le texte n'a pas changé.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { Lock, Sparkles } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import { useSequenceSave } from '@/hooks/useSequenceSave';
import { useInertWhile } from '@/hooks/useInertWhile';
import { useSequenceEditor } from '@/hooks/useSequenceEditor';
import { useSequenceEditorSession } from '@/hooks/useSequenceEditorSession';
import { sequenceEditorDraftKey } from '@/hooks/useSequenceEditorDraft';
import { DEFAULT_QUOTAS, useMemberQuotas } from '@/hooks/useMemberQuotas';
import { hasPlanFeature } from '@/lib/featureGates';
import { DEFAULT_STOP_CONDITIONS, type EditorBaseStepIds } from '@/lib/sequenceActions';
import { SEQUENCES_PATH, parseNewSequenceStart, sequencePath, type NewSequenceStart } from '@/lib/sequencesBeta';
import { STARTER_TEMPLATES, starterTemplateToSequence, templateRowToSequence } from '@/lib/sequenceStarterTemplates';
import { issueStepOrder, openEditorSteps } from '@/lib/sequenceEditor';
import {
  asSenderAccounts,
  asStopConditions,
  renumberByOrderGroup,
  rowToSequenceStep,
  withAlwaysOnStops,
  type SequenceIssue,
  type SequenceStepRow,
} from '@/components/outreach/sequence/sequenceGraph';
import type { Sequence, SequenceStep } from '@/types/sequence';
import { SEOHead } from '@/components/SEOHead';
import { ErrorState, PageLayout } from '@/components/layout';
import { Banner, bannerActionClass } from '@/components/ui/banner';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent } from '@/components/ui/tabs';
import { SequenceHeader } from './SequenceHeader';
import { SequenceTabs } from './SequenceTabs';
import { SettingsTab, type SequenceSettingsDraft } from './SettingsTab';
import type { SendingHours } from './RhythmLine';
import { StepsEditor } from './editor/StepsEditor';
import { SaveDialogs } from './editor/SaveDialogs';
import { NewSequenceDialog } from './NewSequenceDialog';
import { AIDraftWizard } from './ai/AIDraftWizard';
import { useMissionDraftReadiness } from '@/hooks/useSequenceAI';
import {
  AI_DRAFT_BANNER,
  AI_DRAFT_FREE_PLAN,
  EMPTY_NOTES,
  creditsLabel,
  readProposal,
  readStoredNotes,
  readStoredSettings,
  validationOptionOf,
  type AiDraftNotes,
  type AiDraftResult,
  type DraftSettings,
} from '@/lib/sequenceDraft';

const CREATE_TABS = ['etapes', 'reglages'] as const;
/** Préfixe du brouillon d'une création : une entrée par mission et par départ. */
const NEW_DRAFT_PREFIX = 'nouvelle:';
type CreateTab = (typeof CREATE_TABS)[number];
const START_ERRORS: Record<NewSequenceStart['kind'], string> = {
  zero: 'Nouvelle séquence indisponible pour l’instant.',
  modele: 'Modèle indisponible pour l’instant.',
  copie: 'Séquence à copier indisponible pour l’instant.',
  ia: 'Rédaction indisponible pour l’instant.',
};
const PROPOSAL_ERROR = 'Séquence proposée par l’assistant indisponible.';

/** Formule sans envoi (spécification, section 4). */
export const FREE_PLAN_NOTICE = 'Votre formule permet de préparer des séquences et d’écrire aux candidats un par un. L’envoi automatique, avec les relances, fait partie des formules payantes.';

// Avis de la formule gratuite : une fois par personne, « Compris » mémorisé dans ce navigateur (même clé que /sequences).
const freeNoticeKey = (userId: string) => `konekt:sequences-free-notice-dismissed:${userId}`;
function isFreeNoticeDismissed(userId: string | null): boolean {
  if (!userId) return false;
  try {
    return localStorage.getItem(freeNoticeKey(userId)) === '1';
  } catch {
    return false;
  }
}

/** Séquence rédigée par l'IA : étapes, notes de la rédaction, nom et description. */
interface AiSeed {
  name: string;
  description: string;
  steps: SequenceStep[];
  notes: AiDraftNotes;
}

interface CreateDraftValue {
  name: string;
  steps: SequenceStep[];
  settings: SequenceSettingsDraft | null;
  /** Rédaction par l'IA : notes et réglages de l'assistant de rédaction (lot 5e). */
  ai?: { notes: AiDraftNotes; settings: DraftSettings | null; description: string | null } | null;
}

function settingsOfSequence(seq: Sequence): SequenceSettingsDraft {
  return {
    stopConditions: withAlwaysOnStops({ ...DEFAULT_STOP_CONDITIONS, ...(seq.stopConditions ?? {}) }),
    multiSenderEnabled: !!seq.multiSenderEnabled,
    senderAccounts: seq.senderAccounts ?? [],
    rotationMode: seq.rotationMode ?? 'round_robin',
  };
}

type Mission = { name: string; title: string | null; client: string | null };
// Colonnes typées `string` : la lecture du chemin JSON (->>) dépasse sinon la profondeur des types générés.
const MISSION_COLUMNS: string = 'name, client_name, title:job_details->>title';

export function SequenceCreatePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { organizationId } = useOrganization();
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const missionParam = searchParams.get('mission') || null;
  const departParam = searchParams.get('depart') || 'zero';
  const start = useMemo<NewSequenceStart>(() => parseNewSequenceStart(departParam) ?? { kind: 'zero' }, [departParam]);
  const aiMode = start.kind === 'ia';
  // Séquence proposée par l'assistant (outil create_sequence), reprise dans l'éditeur.
  const propositionParam = aiMode ? searchParams.get('proposition') || null : null;
  const setSearchParamsRef = useRef(setSearchParams);
  setSearchParamsRef.current = setSearchParams;
  const tab: CreateTab = searchParams.get('onglet') === 'reglages' ? 'reglages' : 'etapes';
  const setTab = (next: string) => {
    setSearchParams((prev) => {
      const params = new URLSearchParams(prev);
      if (next === 'etapes') params.delete('onglet');
      else params.set('onglet', next);
      return params;
    }, { replace: true });
  };

  // Formule gratuite ou abonnement pas encore lu : la séquence est créée désactivée (décision 32).
  const { effectivePlanId, isLoading: isPlanLoading, isLoadingError: isPlanLoadError } = useSubscriptionState();
  const canSendSequences = isPlanLoading || hasPlanFeature(effectivePlanId, 'sequences_send');
  const planStateUnknown = isPlanLoading || isPlanLoadError;
  // Formule lue et sans envoi : la séquence sera créée sans envoi (Brouillon), annoncé avant d'enregistrer.
  const freePlan = !canSendSequences && !planStateUnknown;
  const [freeNoticeDismissedFor, setFreeNoticeDismissedFor] = useState<string | null>(null);
  const showFreeNotice = freePlan && !(userId && (freeNoticeDismissedFor === userId || isFreeNoticeDismissed(userId)));
  const dismissFreeNotice = () => {
    if (!userId) return;
    setFreeNoticeDismissedFor(userId);
    try {
      localStorage.setItem(freeNoticeKey(userId), '1');
    } catch {
      // Stockage indisponible : l'avis reste fermé pour cette page.
    }
  };

  // Mission lue sous la RLS : la séquence n'y est rattachée que si elle est lisible.
  const [mission, setMission] = useState<{ state: 'loading' | 'ready' | 'none'; value: Mission | null }>({ state: missionParam ? 'loading' : 'none', value: null });
  useEffect(() => {
    if (!missionParam) {
      setMission({ state: 'none', value: null });
      return;
    }
    let cancelled = false;
    setMission({ state: 'loading', value: null });
    void supabase.from('sourcing_projects').select(MISSION_COLUMNS).eq('id', missionParam).maybeSingle().then(({ data }) => {
      if (cancelled) return;
      const row = data as unknown as { name: string | null; client_name: string | null; title: string | null } | null;
      setMission(row?.name ? { state: 'ready', value: { name: row.name, title: row.title?.trim() || null, client: row.client_name ?? null } } : { state: 'none', value: null });
    });
    return () => { cancelled = true; };
  }, [missionParam]);
  const missionId = mission.state === 'ready' ? missionParam : null;

  // Rédaction par l'IA (lot 5e) : rien d'enregistré, état remis à zéro à chaque autre départ.
  const [aiFilled, setAiFilled] = useState(false);
  const aiFilledRef = useRef(false);
  const [aiNotes, setAiNotes] = useState<AiDraftNotes>(EMPTY_NOTES);
  const [aiSettings, setAiSettings] = useState<DraftSettings | null>(null);
  const [aiDescription, setAiDescription] = useState<string | null>(null);
  const [wizardOpen, setWizardOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);
  const aiSeedRef = useRef<AiSeed | null>(null);
  const lastAiRef = useRef<AiSeed | null>(null);
  const autoOpenRef = useRef(false);
  useEffect(() => {
    aiSeedRef.current = null;
    lastAiRef.current = null;
    aiFilledRef.current = false;
    autoOpenRef.current = false;
    setAiFilled(false);
    setAiNotes(EMPTY_NOTES);
    setAiSettings(null);
    setAiDescription(null);
    setWizardOpen(false);
  }, [departParam, propositionParam, missionParam]);

  // Départ : séquence vide, modèle, copie ou rédaction par l'IA.
  const [initial, setInitial] = useState<{ state: 'loading' } | { state: 'error' } | { state: 'ready'; sequence: Sequence }>({ state: 'loading' });
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (mission.state === 'loading' || !organizationId) return;
    let cancelled = false;
    setInitial({ state: 'loading' });
    const done = (sequence: Sequence | null) => {
      if (!cancelled) setInitial(sequence ? { state: 'ready', sequence } : { state: 'error' });
    };
    void (async () => {
      try {
        if (start.kind === 'zero') {
          const job = mission.value?.title || mission.value?.name;
          done({ name: job ? `Approche ${job}` : 'Nouvelle séquence', steps: [], isActive: true, stopConditions: DEFAULT_STOP_CONDITIONS });
          return;
        }
        if (start.kind === 'ia') {
          if (!propositionParam) {
            // Rédaction à partir du poste : la mission lisible est indispensable.
            if (mission.state !== 'ready') {
              done(null);
              return;
            }
            const job = mission.value?.title || mission.value?.name;
            done({ name: job ? `Approche ${job}` : 'Nouvelle séquence', steps: [], isActive: true, stopConditions: DEFAULT_STOP_CONDITIONS });
            return;
          }
          // Proposition de l'assistant : sa ligne (lisible par son auteur), étapes au format de l'éditeur.
          const { data, error } = await supabase
            .from('agent_tool_executions')
            .select('tool_name, status, dry_run_result')
            .eq('id', propositionParam)
            .maybeSingle();
          const proposal = error ? null : readProposal(data, () => crypto.randomUUID());
          if (cancelled) return;
          if (!proposal) {
            done(null);
            return;
          }
          if (proposal.missionId && proposal.missionId !== missionParam) {
            // Mission de la proposition dans l'adresse : fil d'Ariane, retour et rattachement à l'enregistrement.
            const missionOfProposal = proposal.missionId;
            setSearchParamsRef.current((prev) => {
              const params = new URLSearchParams(prev);
              params.set('mission', missionOfProposal);
              return params;
            }, { replace: true });
            return;
          }
          aiSeedRef.current = { name: proposal.name, description: proposal.description, steps: proposal.steps, notes: proposal.notes };
          done({ name: proposal.name, description: proposal.description, steps: [], isActive: true, stopConditions: DEFAULT_STOP_CONDITIONS });
          return;
        }
        if (start.kind === 'modele') {
          const starter = STARTER_TEMPLATES.find((t) => t.key === start.key);
          if (starter) {
            done(starterTemplateToSequence(starter));
            return;
          }
          const { data, error } = await supabase
            .from('sequence_templates')
            .select('id, name, description, steps_config, category, is_system, created_at')
            .eq('id', start.key)
            .maybeSingle();
          if (error || !data) {
            done(null);
            return;
          }
          done(templateRowToSequence({
            ...data,
            steps_config: Array.isArray(data.steps_config) ? (data.steps_config as Array<Record<string, unknown>>) : [],
          }));
          return;
        }
        // Copie complète (branches, versions, fins, options e-mail) ; les expéditeurs seulement depuis notre organisation.
        const [{ data: seq, error: seqError }, { data: rows, error: rowsError }] = await Promise.all([
          supabase
            .from('outreach_sequences')
            .select('id, name, description, organization_id, stop_conditions, sender_accounts, rotation_mode, multi_sender_enabled')
            .eq('id', start.id)
            .maybeSingle(),
          supabase.from('sequence_steps').select('*').eq('sequence_id', start.id).order('step_order', { ascending: true }),
        ]);
        if (seqError || rowsError || !seq) {
          done(null);
          return;
        }
        const sameOrganization = seq.organization_id === organizationId;
        done({
          name: `Copie de ${seq.name}`,
          description: seq.description || undefined,
          steps: renumberByOrderGroup(((rows ?? []) as unknown as SequenceStepRow[]).map(rowToSequenceStep)),
          isActive: true,
          stopConditions: asStopConditions(seq.stop_conditions),
          senderAccounts: sameOrganization ? asSenderAccounts(seq.sender_accounts) : [],
          rotationMode: seq.rotation_mode || 'round_robin',
          multiSenderEnabled: sameOrganization && !!seq.multi_sender_enabled,
        });
      } catch (err) {
        console.error('[SequenceCreatePage] départ illisible :', err);
        done(null);
      }
    })();
    return () => { cancelled = true; };
  }, [start, propositionParam, missionParam, mission.state, mission.value, organizationId, attempt]);

  // État de l'éditeur : étapes, nom, réglages ; rien d'enregistré.
  const editor = useSequenceEditor();
  const { reset: resetEditor, restore: restoreEditor } = editor;
  const [name, setName] = useState('');
  const [initialName, setInitialName] = useState('');
  const [baseSettings, setBaseSettings] = useState<SequenceSettingsDraft | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<SequenceSettingsDraft | null>(null);
  const [settingsErrors, setSettingsErrors] = useState<string[]>([]);
  const readySequence = initial.state === 'ready' ? initial.sequence : null;
  // Séquence rédigée par l'IA : par-dessus un départ vide, donc à enregistrer (et gardée en brouillon local).
  const applyAi = useCallback((seed: AiSeed, keepName = false) => {
    restoreEditor(seed.steps);
    if (!keepName) setName(seed.name);
    setAiNotes(seed.notes);
    setAiDescription(seed.description || null);
    aiFilledRef.current = true;
    setAiFilled(true);
    lastAiRef.current = seed;
  }, [restoreEditor]);
  useEffect(() => {
    if (!readySequence) return;
    // Aucune étape n'est encore en base : une suppression ne demande pas l'historique.
    resetEditor(openEditorSteps(readySequence.steps), []);
    setName(readySequence.name);
    setInitialName(readySequence.name);
    setBaseSettings(settingsOfSequence(readySequence));
    setSettingsDraft(null);
    if (aiSeedRef.current) applyAi(aiSeedRef.current);
  }, [readySequence, resetEditor, applyAi]);
  const loaded = !!readySequence && baseSettings !== null;
  const settings = settingsDraft ?? baseSettings;
  const settingsDirty = !!settingsDraft && !!baseSettings && JSON.stringify(settingsDraft) !== JSON.stringify(baseSettings);

  const { isReady: quotasReady, getQuotaForUser } = useMemberQuotas();
  const hours: SendingHours | null = useMemo(() => {
    if (!quotasReady || !userId) return null;
    const own = getQuotaForUser(userId);
    return {
      start: own?.business_hours_start ?? DEFAULT_QUOTAS.business_hours_start,
      end: own?.business_hours_end ?? DEFAULT_QUOTAS.business_hours_end,
      timezone: own?.timezone ?? DEFAULT_QUOTAS.timezone,
    };
  }, [quotasReady, userId, getQuotaForUser]);

  const back = missionParam ? `/missions/${encodeURIComponent(missionParam)}?panneau=contact` : SEQUENCES_PATH;

  // Enregistrement : création par useSequenceSave, puis la page de la séquence.
  const editorBaseStepIdsRef = useRef<EditorBaseStepIds>(null);
  const createdIdRef = useRef<string | null>(null);
  const { handleSaveSequence } = useSequenceSave({
    organizationId,
    projectId: missionId,
    canSendSequences,
    planStateUnknown,
    editorBaseStepIdsRef,
    navigate,
    fetchSequences: async () => undefined,
    setShowBuilder: () => undefined,
    setEditingSequence: () => undefined,
    onCreated: (id) => { createdIdRef.current = id; },
    // Créée sans envoi faute de droit d'envoi (règle existante, shouldCreateInactiveForPlan) : dit avec le texte de la spécification.
    announceCreated: ({ inactiveForPlan }) => {
      if (!inactiveForPlan) {
        toast.success('Séquence créée');
      } else if (freePlan) {
        // L'avis a déjà donné la raison : le toast dit seulement ce qui a été fait.
        toast.info('Séquence enregistrée sans envoi automatique', {
          ...(aiFilled ? { description: AI_DRAFT_FREE_PLAN } : {}),
          action: { label: 'Voir les offres', onClick: () => navigate('/pricing') },
        });
      } else {
        toast.warning('Séquence enregistrée sans envoi', {
          description: 'Votre formule n’a pas pu être vérifiée : activez la séquence depuis sa page.',
        });
      }
    },
  });

  const performSave = async () => {
    if (!readySequence || !settings) return;
    const sequence: Sequence = {
      name: name.trim(),
      description: (aiFilled && aiDescription) || readySequence.description,
      steps: editor.steps,
      isActive: true,
      stopConditions: withAlwaysOnStops(settings.stopConditions),
      senderAccounts: settings.senderAccounts,
      rotationMode: settings.rotationMode,
      multiSenderEnabled: settings.multiSenderEnabled,
    };
    createdIdRef.current = null;
    await handleSaveSequence(sequence);
    session.draft.clear();
    // Première création : la page passe sur l'adresse de la séquence, à la place de /sequences/nouvelle (pas d'entrée d'historique en double).
    const id = createdIdRef.current;
    if (id) {
      const path = sequencePath(id, missionId);
      navigate(`${path}${path.includes('?') ? '&' : '?'}onglet=etapes`, { replace: true });
    }
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
    const target = order === null ? undefined : editor.steps.find((s) => s.order === order && (!s.variantGroup || s.variantGroup === 'A'));
    if (target) editor.select(target.id);
  };

  const resetToStart = useCallback(() => {
    editor.discard();
    setName(initialName);
    setSettingsDraft(null);
    setSettingsErrors([]);
    aiFilledRef.current = false;
    setAiFilled(false);
    setAiNotes(EMPTY_NOTES);
  }, [editor, initialName]);
  // « Repartir de zéro » d'un brouillon repris : la rédaction de départ (proposition ou rédaction de cette visite), sinon l'assistant de rédaction.
  const restartFromStart = useCallback(() => {
    resetToStart();
    if (!aiMode) return;
    if (lastAiRef.current) applyAi(lastAiRef.current);
    else if (!propositionParam) setWizardOpen(true);
  }, [resetToStart, aiMode, applyAi, propositionParam]);

  const draftValue = useMemo<CreateDraftValue>(() => ({
    name,
    steps: editor.steps,
    settings: settingsDraft,
    ai: aiFilled ? { notes: aiNotes, settings: aiSettings, description: aiDescription } : null,
  }), [name, editor.steps, settingsDraft, aiFilled, aiNotes, aiSettings, aiDescription]);
  const aiValidation = useMemo(() => (aiFilled ? validationOptionOf(aiNotes) : undefined), [aiFilled, aiNotes]);
  const session = useSequenceEditorSession<CreateDraftValue>({
    editor,
    loaded,
    name,
    settings,
    settingsDirty,
    creating: true,
    organizationId,
    sequenceId: null,
    missionId,
    stepsTabActive: tab === 'etapes',
    draftKey: sequenceEditorDraftKey(userId, organizationId, `${NEW_DRAFT_PREFIX}${missionParam ?? ''}:${departParam}${propositionParam ? `:${propositionParam}` : ''}`),
    draftBase: loaded ? 'creation' : null,
    draftValue,
    draftDirty: editor.dirty || name !== initialName || settingsDirty,
    onDraftRestore: (value, savedAt) => {
      editor.restore(value.steps);
      if (value.name) setName(value.name);
      if (value.settings) setSettingsDraft(value.settings);
      if (aiMode && value.ai) {
        setAiNotes(readStoredNotes(value.ai.notes));
        setAiSettings(readStoredSettings(value.ai.settings));
        setAiDescription(typeof value.ai.description === 'string' ? value.ai.description : null);
        aiFilledRef.current = true;
        setAiFilled(true);
      }
      toast.info('Brouillon de séquence repris', {
        description: savedAt
          ? `Votre travail du ${savedAt.toLocaleDateString('fr-FR')} à ${savedAt.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} a été conservé.`
          : 'Votre travail précédent a été conservé.',
        duration: 12000,
        action: { label: 'Repartir de zéro', onClick: () => { restartFromStart(); session.draft.clear(); } },
      });
    },
    removedStepCount: 0,
    activeEnrollmentCount: 0,
    perform: performSave,
    onBlocked: showBlocked,
    onDiscard: resetToStart,
    aiDraft: aiValidation,
  });

  // Rédaction par l'IA : l'assistant de rédaction s'ouvre une fois, sauf si un brouillon de cette rédaction vient d'être repris.
  useEffect(() => {
    if (!aiMode || propositionParam || !loaded || autoOpenRef.current) return;
    autoOpenRef.current = true;
    if (!aiFilledRef.current) setWizardOpen(true);
  }, [aiMode, propositionParam, loaded]);
  const readiness = useMissionDraftReadiness(missionId);
  const askAI = useMemo(() => ({ organizationId, missionId, jobDescribed: readiness.described }), [organizationId, missionId, readiness.described]);

  const onDrafted = (result: AiDraftResult, settings: DraftSettings) => {
    const replacing = aiFilledRef.current;
    setWizardOpen(false);
    setAiSettings(settings);
    applyAi({ name: result.name, description: result.description, steps: result.steps, notes: result.notes }, replacing);
    setTab('etapes');
    const used = result.creditsUsed ?? 0;
    if (used > 0) toast.success('Séquence rédigée', { description: `${creditsLabel(used)} utilisé${used > 1 ? 's' : ''}.` });
  };
  // Annuler la première rédaction : retour d'où l'on vient ; « Rédiger à nouveau » annulé : la séquence affichée reste.
  const cancelWizard = () => {
    setWizardOpen(false);
    if (!aiFilledRef.current) navigate(back);
  };

  // Enregistrement en cours : étapes et réglages figés jusqu'au passage sur la page de la séquence.
  const settingsAreaRef = useRef<HTMLDivElement>(null);
  useInertWhile(settingsAreaRef, session.flow.saving);
  // Bandeau de la rédaction : reçoit le focus quand l'assistant de rédaction se ferme sur un résultat.
  const aiBannerRef = useRef<HTMLDivElement>(null);

  return (
    <PageLayout maxWidth="xl">
      <SEOHead title={`${name || 'Nouvelle séquence'} | Konekt`} description="Nouvelle séquence" />

      {(initial.state === 'loading' || (initial.state === 'ready' && !loaded)) && (
        <div role="status" aria-label="Préparation de la séquence" className="space-y-4">
          <Skeleton className="h-4 w-40 rounded-sm" />
          <Skeleton className="h-9 w-80 rounded-sm" />
          <Skeleton className="h-11 w-full rounded-sm" />
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-14 w-full rounded-sm" />)}
        </div>
      )}

      {initial.state === 'error' && (
        <ErrorState
          title={propositionParam ? PROPOSAL_ERROR : START_ERRORS[start.kind]}
          description="Vérifiez votre connexion puis réessayez, ou partez d’une séquence vide."
          onRetry={() => setAttempt((n) => n + 1)}
          action={
            <Button type="button" variant="ghost" size="sm" onClick={() => navigate(back)}>
              Retour
            </Button>
          }
        />
      )}

      {loaded && settings && (
        <>
          <SequenceHeader
            name={name}
            mission={missionId && mission.value ? { id: missionId, name: mission.value.name } : null}
            canRename
            onRename={async (next) => {
              setName(next);
              return true;
            }}
            dirty
            saving={session.flow.saving}
            onSave={session.flow.save}
            saveState={session.flow.state === 'saving' || session.flow.state === 'error' ? session.flow.state : 'unsaved'}
            enrollHref={null}
          />
          {/* Rédaction par l'IA : la formule gratuite est dite dans le bandeau de la rédaction (un seul cadre), et au toast d'enregistrement. */}
          {!aiMode && showFreeNotice && (
            <Banner
              tone="info"
              icon={Lock}
              className="mb-4 rounded-lg border"
              action={
                <span className="flex shrink-0 items-center gap-4">
                  <Link to="/pricing" className={`${bannerActionClass} max-md:inline-flex max-md:min-h-11 max-md:items-center`}>Voir les offres</Link>
                  <Button type="button" variant="link" onClick={dismissFreeNotice} className={`h-auto p-0 ${bannerActionClass} max-md:min-h-11`}>
                    Compris
                  </Button>
                </span>
              }
            >
              {FREE_PLAN_NOTICE}
            </Banner>
          )}
          {aiMode && aiFilled && (
            <div ref={aiBannerRef} tabIndex={-1} className="mb-4 rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-ring">
              <Banner
                tone="info"
                icon={Sparkles}
                className="rounded-lg border"
                action={missionId ? (
                  <Button type="button" variant="link" onClick={() => setWizardOpen(true)} className={`h-auto shrink-0 p-0 ${bannerActionClass} max-sm:hidden`}>
                    Rédiger à nouveau
                  </Button>
                ) : undefined}
              >
                {AI_DRAFT_BANNER}
                {/* Formule gratuite (décision 6) : préparée, enregistrée sans envoi automatique. */}
                {freePlan && <span className="mt-1 block text-foreground-secondary">{AI_DRAFT_FREE_PLAN}</span>}
                {/* Sous 640 px, l'action passe sous le texte (à côté, le texte n'aurait plus la place). */}
                {missionId && (
                  <span className="block sm:hidden">
                    <Button type="button" variant="link" onClick={() => setWizardOpen(true)} className={`h-auto min-h-11 p-0 ${bannerActionClass}`}>
                      Rédiger à nouveau
                    </Button>
                  </span>
                )}
              </Banner>
            </div>
          )}
          <Tabs value={tab} onValueChange={setTab}>
            <SequenceTabs
              active={tab}
              hasEnrollments={false}
              candidateCount={null}
              journalAlert={false}
              only={CREATE_TABS}
              stepsAlert={session.validation.errors.some((e) => e.area !== 'senders' && e.check !== 'steps')}
              settingsAlert={session.validation.errors.some((e) => e.area === 'senders')}
            />
            <TabsContent value="etapes" className="mt-6">
              {aiMode && !aiFilled ? (
                // Avant la rédaction : l'assistant de rédaction est ouvert par-dessus.
                <div className="mx-auto w-full max-w-md space-y-3 py-10 text-center">
                  <p className="text-sm text-muted-foreground">Les étapes apparaîtront ici une fois la séquence rédigée.</p>
                  {missionId && (
                    <Button type="button" variant="outline" onClick={() => setWizardOpen(true)} className="max-md:h-11">
                      <Sparkles aria-hidden="true" />
                      Rédiger avec l’IA
                    </Button>
                  )}
                </div>
              ) : (
              <StepsEditor
                editor={editor}
                validation={session.validation}
                enrolledCount={0}
                state="ready"
                onRetry={() => undefined}
                preview={session.preview}
                extraKeys={session.customKeys}
                onShowSettings={() => setTab('reglages')}
                frozen={session.flow.saving}
                askAI={askAI}
                aiNotes={aiFilled ? aiNotes : undefined}
              />
              )}
            </TabsContent>
            <TabsContent value="reglages" className="mt-6">
              <div ref={settingsAreaRef} aria-busy={session.flow.saving || undefined}>
                <SettingsTab
                  value={settings}
                  onChange={(next) => { setSettingsDraft(next); setSettingsErrors([]); }}
                  canEdit
                  readOnlyHint=""
                  missionLabel={mission.value ? [mission.value.name, mission.value.client].filter(Boolean).join(' · ') : null}
                  hours={hours}
                  errors={settingsErrors}
                />
              </div>
            </TabsContent>
          </Tabs>
          <SaveDialogs flow={session.flow} leave={session.leave} />
        </>
      )}

      {aiMode && missionId && (
        <AIDraftWizard
          open={wizardOpen}
          onCancel={cancelWizard}
          organizationId={organizationId}
          missionId={missionId}
          previousSettings={aiSettings}
          replacing={aiFilled}
          onDrafted={onDrafted}
          focusAfterDraft={() => aiBannerRef.current}
          onFromTemplate={() => {
            setWizardOpen(false);
            setTemplatesOpen(true);
          }}
        />
      )}
      {aiMode && (
        <NewSequenceDialog
          open={templatesOpen}
          onOpenChange={setTemplatesOpen}
          missionId={missionId}
          missionLabel={mission.value ? [mission.value.name, mission.value.client].filter(Boolean).join(' · ') : null}
          existingSequences={[]}
          initialStep="templates"
        />
      )}
    </PageLayout>
  );
}

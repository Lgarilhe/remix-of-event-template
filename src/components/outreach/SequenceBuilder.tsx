import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  saveEditorDraft,
  loadEditorDraft,
  clearEditorDraft,
  editorDraftSavedAt,
} from '@/lib/editorDraft';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
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
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SegmentedControl, type SegmentedOption } from '@/components/ui/segmented-control';
import { SaveStatus, type SaveState } from '@/components/ui/save-status';
import { getConditionsForActionType, isWhatsAppStep, isCrossChannelCondition } from './sequence/conditionTypes';
import { VariableInserter } from './sequence/VariableInserter';
import { previewMessageTemplate, VARIABLE_EXAMPLE } from './sequence/messageTypeUtils';
import { useEmailSignatures } from '@/hooks/useEmailSignatures';
import { useCurrentProfile } from '@/hooks/useCurrentProfile';
import { sequenceActionLabel, MESSAGE_TONES, formatStepDelay } from '@/lib/sequenceCatalog';
import { SequenceActionIcon } from './SequenceBadges';
import {
  Plus,
  Trash2,
  Eye,
  Clock,
  Save,
  GitBranch,
  Hourglass,
  X,
  List,
  Workflow,
  FlaskConical,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  AlertCircle,
  AlertTriangle,
  ChevronRight,
  Info,
  ListChecks,
  Shield,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { VisualSequenceEditor } from './sequence/VisualSequenceEditor';
import { StopConditionsSettings } from './sequence/StopConditionsSettings';
import { MultiSenderSettings } from './sequence/MultiSenderSettings';
import {
  SequenceWizardStepper,
  SequenceWizardStepperCompact,
  WizardStep,
  WIZARD_STEPS,
} from './sequence/SequenceWizardStepper';
import { SequenceValidationChecklist, SequenceValidationSummary } from './sequence/SequenceValidationChecklist';

export interface SequenceStep {
  id: string;
  order: number;
  actionType: 'inmail' | 'email' | 'connection_request' | 'profile_visit' | 'message' | 'smart_message' | 'whatsapp_message' | 'wait_connection' | 'wait_reply' | 'wait_profile_visit' | 'condition_branch' | 'check_connection';
  conditionType: 'always' | 'if_connected' | 'if_not_connected' | 'if_no_response' | 'if_email_opened' | 'if_email_not_opened' | 'if_link_clicked' | 'if_link_not_clicked' | 'if_has_email' | 'if_no_email' | 'if_has_phone' | 'if_no_phone' | 'if_bounced' | 'if_unsubscribed' | 'if_score_above';
  conditionValue?: string;
  delayDays: number;
  delayHours: number;
  delayMinutes: number;
  preferredHourStart: number;
  preferredHourEnd: number;
  subjectTemplate?: string;
  messageTemplate?: string;
  useAiPersonalization: boolean;
  aiTone?: 'professional' | 'casual' | 'enthusiastic';
  timeoutDays?: number;
  waitForEvent?: 'connection_accepted' | 'reply_received' | 'profile_visited';
  timeoutAction?: 'skip' | 'alternative_step' | 'end_sequence';
  alternativeStepIndex?: number;
  ifTrueGotoStep?: string;
  ifFalseGotoStep?: string;
  nextStepId?: string;
  timeoutBranchStepId?: string;
  variantGroup?: string | null;
  variantWeight?: number;
  ccEmails?: string[];
  bccEmails?: string[];
  includeUnsubscribe?: boolean;
  signatureId?: string;
}

export interface StopConditions {
  on_reply: boolean;
  on_click: boolean;
  on_unsubscribe: boolean;
  on_meeting_booked: boolean;
}

export interface SenderAccountConfig {
  account_id: string;
  email: string;
  daily_limit: number;
}

export interface Sequence {
  id?: string;
  name: string;
  description?: string;
  steps: SequenceStep[];
  isActive: boolean;
  stopConditions?: StopConditions;
  senderAccounts?: SenderAccountConfig[];
  rotationMode?: string;
  multiSenderEnabled?: boolean;
}

interface SequenceBuilderProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (sequence: Sequence) => Promise<void>;
  initialSequence?: Sequence;
  /**
   * L'offre permet d'envoyer des séquences : une nouvelle séquence peut alors
   * être enregistrée et activée d'un seul geste.
   */
  canActivate?: boolean;
}

// ACTIONS = ce qu'on FAIT. Libellés et icônes : catalogue des séquences (src/lib/sequenceCatalog.ts).
const ACTIONS = [
  { value: 'connection_request', description: 'Envoyer une demande de connexion', requiresPrevious: [], excludeIfPrevious: ['connection_request'], requiresConnection: false },
  { value: 'inmail', description: 'Envoyer un InMail (payant)', requiresPrevious: [], excludeIfPrevious: [], requiresConnection: false },
  { value: 'email', description: 'Envoyer un e-mail', requiresPrevious: [], excludeIfPrevious: [], requiresConnection: false },
  { value: 'profile_visit', description: 'Visiter le profil du candidat', requiresPrevious: [], excludeIfPrevious: [], requiresConnection: false },
  { value: 'message', description: 'Message direct (relation du 1er degré)', requiresPrevious: [], excludeIfPrevious: [], requiresConnection: true },
  { value: 'smart_message', description: "Message rédigé par l'IA (1er degré)", requiresPrevious: [], excludeIfPrevious: [], requiresConnection: true },
  { value: 'whatsapp_message', description: 'Envoyer un message WhatsApp', requiresPrevious: [], excludeIfPrevious: [], requiresConnection: false },
];

// TRIGGERS = ce qu'on ATTEND (les « déclencheurs »)
const TRIGGERS = [
  { value: 'check_connection', description: 'Oriente selon le degré de relation', requiresPrevious: [], excludeIfPrevious: [] },
  { value: 'wait_connection', description: "Attend que l'invitation soit acceptée", waitEvent: 'connection_accepted', requiresPrevious: ['connection_request'], excludeIfPrevious: ['wait_connection'] },
  { value: 'wait_reply', description: 'Attend la réponse du candidat', waitEvent: 'reply_received', requiresPrevious: ['inmail', 'email', 'message', 'smart_message', 'whatsapp_message'], excludeIfPrevious: [] },
  { value: 'wait_profile_visit', description: 'Attend une visite de votre profil', waitEvent: 'profile_visited', requiresPrevious: ['profile_visit'], excludeIfPrevious: [] },
];

const TIMEOUT_ACTIONS = [
  { value: 'skip', label: "Passer à l'étape suivante" },
  { value: 'alternative_step', label: 'Aller à une autre étape' },
  { value: 'end_sequence', label: 'Terminer la séquence' },
];

const DEFAULT_STOP_CONDITIONS: StopConditions = { on_reply: true, on_click: false, on_unsubscribe: true, on_meeting_booked: false };

const getAvailableStepTypes = (previousSteps: SequenceStep[]) => {
  const previousTypes = previousSteps.map(s => s.actionType);

  const availableActions = ACTIONS.filter(action => {
    if (action.excludeIfPrevious.some(ex => previousTypes.includes(ex as SequenceStep['actionType']))) return false;
    // requiresConnection : Message LinkedIn nécessite une connexion 1er degré.
    // On autorise dans 3 cas :
    //   1. C'est le 1er step (cas candidat déjà connecté)
    //   2. Un wait_connection est avant (l'invitation a été acceptée)
    //   3. Un check_connection est avant (la branche "1er degré" du test)
    if (action.requiresConnection && previousSteps.length > 0
        && !previousTypes.includes('wait_connection')
        && !previousTypes.includes('check_connection')) return false;
    return true;
  });

  const availableTriggers = TRIGGERS.filter(trigger => {
    if (trigger.excludeIfPrevious.some(ex => previousTypes.includes(ex as SequenceStep['actionType']))) return false;
    if (trigger.requiresPrevious.length > 0) {
      const hasRequired = trigger.requiresPrevious.some(req => previousTypes.includes(req as SequenceStep['actionType']));
      if (!hasRequired) return false;
    }
    return true;
  });

  return { availableActions, availableTriggers };
};

const createEmptyStep = (order: number, actionType: string = 'connection_request'): SequenceStep => {
  const trigger = TRIGGERS.find(t => t.value === actionType);
  return {
    id: crypto.randomUUID(),
    order,
    actionType: actionType as SequenceStep['actionType'],
    conditionType: 'always',
    delayDays: order === 0 ? 0 : 2,
    delayHours: 0,
    delayMinutes: 0,
    preferredHourStart: 9,
    preferredHourEnd: 18,
    useAiPersonalization: false,
    aiTone: 'professional',
    timeoutDays: 3,
    timeoutAction: 'skip',
    waitForEvent: trigger?.waitEvent as SequenceStep['waitForEvent'],
  };
};

const generateRecommendedSequence = (): SequenceStep[] => {
  const mkStep = (
    order: number,
    actionType: SequenceStep['actionType'],
    overrides: Partial<SequenceStep> = {}
  ): SequenceStep => ({
    id: crypto.randomUUID(),
    order,
    actionType,
    conditionType: 'always',
    delayDays: 0,
    delayHours: 0,
    delayMinutes: 0,
    preferredHourStart: 9,
    preferredHourEnd: 18,
    useAiPersonalization: actionType === 'smart_message',
    aiTone: 'professional',
    timeoutDays: 3,
    timeoutAction: 'skip',
    ...overrides,
  });

  const profileVisit = mkStep(0, 'profile_visit');
  const checkConnection = mkStep(1, 'check_connection', { delayMinutes: 2 });
  const t1_message = mkStep(2, 'smart_message');
  const t2_waitReply = mkStep(3, 'wait_connection', { actionType: 'wait_reply', waitForEvent: 'reply_received', timeoutDays: 3, timeoutAction: 'skip' });
  const t3_relance1 = mkStep(4, 'smart_message');
  const t4_waitReply2 = mkStep(5, 'wait_reply', { waitForEvent: 'reply_received', timeoutDays: 4, timeoutAction: 'skip' });
  const t5_relance2 = mkStep(6, 'smart_message');

  t1_message.nextStepId = t2_waitReply.id;
  t2_waitReply.nextStepId = t3_relance1.id;
  t3_relance1.nextStepId = t4_waitReply2.id;
  t4_waitReply2.nextStepId = t5_relance2.id;

  const f1_invite = mkStep(7, 'connection_request');
  const f2_waitConnection = mkStep(8, 'wait_connection', { waitForEvent: 'connection_accepted', timeoutDays: 3, timeoutAction: 'skip' });
  const f3_message = mkStep(9, 'smart_message');
  const f4_waitReply = mkStep(10, 'wait_reply', { waitForEvent: 'reply_received', timeoutDays: 3, timeoutAction: 'skip' });
  const f5_relance1 = mkStep(11, 'smart_message');
  const f6_waitReply2 = mkStep(12, 'wait_reply', { waitForEvent: 'reply_received', timeoutDays: 4, timeoutAction: 'skip' });
  const f7_relance2 = mkStep(13, 'smart_message');
  const f8_inmail = mkStep(14, 'inmail', { useAiPersonalization: true });
  const f9_waitReply = mkStep(15, 'wait_reply', { waitForEvent: 'reply_received', timeoutDays: 5, timeoutAction: 'skip' });
  const f10_inmailRelance = mkStep(16, 'inmail', { useAiPersonalization: true });

  f1_invite.nextStepId = f2_waitConnection.id;
  f2_waitConnection.nextStepId = f3_message.id;
  f3_message.nextStepId = f4_waitReply.id;
  f4_waitReply.nextStepId = f5_relance1.id;
  f5_relance1.nextStepId = f6_waitReply2.id;
  f6_waitReply2.nextStepId = f7_relance2.id;
  f2_waitConnection.timeoutAction = 'alternative_step';
  f2_waitConnection.timeoutBranchStepId = f8_inmail.id;
  f8_inmail.nextStepId = f9_waitReply.id;
  f9_waitReply.nextStepId = f10_inmailRelance.id;

  checkConnection.ifTrueGotoStep = t1_message.id;
  checkConnection.ifFalseGotoStep = f1_invite.id;

  return [
    profileVisit, checkConnection,
    t1_message, t2_waitReply, t3_relance1, t4_waitReply2, t5_relance2,
    f1_invite, f2_waitConnection,
    f3_message, f4_waitReply, f5_relance1, f6_waitReply2, f7_relance2,
    f8_inmail, f9_waitReply, f10_inmailRelance,
  ];
};

const isAction = (actionType: string) => ACTIONS.some(a => a.value === actionType);
const isTrigger = (actionType: string) => TRIGGERS.some(t => t.value === actionType);
const needsMessage = (type: string) => ['inmail', 'email', 'connection_request', 'message', 'smart_message', 'whatsapp_message'].includes(type);
const needsSubject = (type: string) => ['inmail', 'email'].includes(type);
const canABTest = (type: string) => ['inmail', 'email', 'message', 'smart_message', 'connection_request', 'whatsapp_message'].includes(type);

/** Seuil de score : un nombre de 0 à 100 (revue design D-40). */
const scoreThresholdError = (value?: string) => {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return 'Indiquez un seuil entre 0 et 100.';
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > 100) return 'Le seuil doit être compris entre 0 et 100.';
  return null;
};

const stepOptionLabel = (s: SequenceStep) => `Étape ${s.order + 1} : ${sequenceActionLabel(s.actionType)}`;

const plural = (n: number, singular: string, pluralForm = `${singular}s`) => `${n} ${n > 1 ? pluralForm : singular}`;

const getVariantGroups = (steps: SequenceStep[]): Map<number, SequenceStep[]> => {
  const groups = new Map<number, SequenceStep[]>();
  for (const step of steps) {
    if (step.variantGroup) {
      const existing = groups.get(step.order) || [];
      existing.push(step);
      groups.set(step.order, existing);
    }
  }
  return groups;
};

const getPrimarySteps = (steps: SequenceStep[]): SequenceStep[] => {
  const seen = new Set<number>();
  const result: SequenceStep[] = [];
  for (const step of steps) {
    if (step.variantGroup && step.variantGroup !== 'A') continue;
    if (step.variantGroup === 'A' && seen.has(step.order)) continue;
    seen.add(step.order);
    result.push(step);
  }
  for (const step of steps) {
    if (!step.variantGroup && !result.includes(step)) {
      result.push(step);
    }
  }
  return result.sort((a, b) => a.order - b.order);
};

// ── Wizard step order ──
const WIZARD_ORDER: WizardStep[] = ['info', 'senders', 'steps', 'guardrails', 'review'];

const MODE_OPTIONS: SegmentedOption<'wizard' | 'expert'>[] = [
  { value: 'wizard', label: 'Guidé' },
  { value: 'expert', label: 'Expert' },
];

/** Brouillon d'une sequence en cours de creation, un seul par navigateur. */
const SEQUENCE_DRAFT_KEY = 'sequence-new';

const hasContent = (s: Sequence) => !!(s.name.trim() || s.description?.trim() || s.steps.length > 0);

/** Choix d'un type d'étape : icône et libellé du catalogue, en neutre (revue design D-35). */
function StepTypeOption({ value, description, onPick }: { value: string; description: string; onPick: (value: string) => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={() => onPick(value)}
      className="h-auto justify-start gap-3 whitespace-normal p-3 text-left font-normal"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted text-foreground-secondary">
        <SequenceActionIcon type={value} className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{sequenceActionLabel(value)}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </Button>
  );
}

export const SequenceBuilder: React.FC<SequenceBuilderProps> = React.memo(({
  isOpen,
  onClose,
  onSave,
  initialSequence,
  canActivate = true,
}) => {
  const isEditing = !!initialSequence;
  // Une séquence sans identifiant (vierge, modèle ou copie) n'existe pas encore en base.
  const isNewSequence = !initialSequence?.id;
  // Brouillon d'une sequence en cours de creation. On ne conserve rien pour une
  // sequence existante : la verite y est cote base, et repousser une vieille
  // saisie par-dessus serait pire que de la perdre.
  const brouillonInitial = isEditing ? null : loadEditorDraft<Sequence>(SEQUENCE_DRAFT_KEY);
  const [sequence, setSequence] = useState<Sequence>(() => {
    // Une nouvelle séquence n'est active que si l'on choisit de l'activer (revue design D-34).
    const base = initialSequence || brouillonInitial || {
      name: '',
      description: '',
      steps: [],
      isActive: false,
    };
    // Les garde-fous affichés par défaut sont ceux qui seront enregistrés (revue design D-30).
    return { ...base, stopConditions: base.stopConditions ?? DEFAULT_STOP_CONDITIONS };
  });
  // État de départ, pour savoir si « Retour » perdrait des modifications (revue design D-31).
  const [initialSnapshot] = useState(() => JSON.stringify(sequence));
  const isDirty = useMemo(() => JSON.stringify(sequence) !== initialSnapshot, [sequence, initialSnapshot]);
  // Vrai tant que la sequence n'a pas ete enregistree : la fermeture conserve
  // alors le travail au lieu de l'effacer (audit UX du 09/09/2026, constat UX06).
  const enregistreeRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState<null | 'changes' | 'draft-lost'>(null);
  const [expandedStepId, setExpandedStepId] = useState<string | null>(
    initialSequence?.steps[0]?.id || null
  );
  const [showStepPicker, setShowStepPicker] = useState(!initialSequence || initialSequence.steps.length === 0);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const { signatures } = useEmailSignatures();
  const { displayName } = useCurrentProfile();
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  // Conservation a la sortie : le composant est demonte par son parent au clic
  // sur « Retour », donc c'est le nettoyage d'effet qui doit ecrire.
  const sequenceRef = useRef(sequence);
  sequenceRef.current = sequence;
  useEffect(() => {
    if (isEditing) return;
    return () => {
      if (enregistreeRef.current) return;
      const courante = sequenceRef.current;
      const aDuContenu =
        courante.name.trim() || courante.description?.trim() || courante.steps.length > 0;
      saveEditorDraft(SEQUENCE_DRAFT_KEY, aDuContenu ? courante : null);
    };
  }, [isEditing]);

  // Reprise annoncee : sans message, l'utilisateur croit a un bug d'affichage.
  useEffect(() => {
    if (isEditing || !brouillonInitial) return;
    const quand = editorDraftSavedAt(SEQUENCE_DRAFT_KEY);
    toast.info('Brouillon de séquence repris', {
      description: quand
        ? `Votre travail du ${quand.toLocaleDateString('fr-FR')} à ${quand.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} a été conservé.`
        : 'Votre travail précédent a été conservé.',
    });
    // Au seul montage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Une modification efface les erreurs d'un enregistrement refusé : la liste
  // de contrôle reste le guide en direct.
  useEffect(() => {
    setValidationErrors(prev => (prev.length ? [] : prev));
    setSaveFailed(false);
  }, [sequence]);

  // Wizard vs expert mode
  const [mode, setMode] = useState<'wizard' | 'expert'>(isEditing ? 'expert' : 'wizard');
  const [wizardStep, setWizardStep] = useState<WizardStep>('info');

  // Compute completed wizard steps
  const completedSteps = useMemo(() => {
    const completed = new Set<WizardStep>();
    if (sequence.name.trim()) completed.add('info');
    if (sequence.steps.length > 0) completed.add('steps');
    // Senders is "complete" even if not using multi-sender
    completed.add('senders');
    // Guardrails always pass if stop conditions exist
    if (sequence.stopConditions?.on_reply || sequence.stopConditions?.on_unsubscribe) completed.add('guardrails');
    return completed;
  }, [sequence]);

  // Compute wizard validation errors per step
  const wizardValidationErrors = useMemo(() => {
    const errors = new Map<WizardStep, string[]>();
    if (!sequence.name.trim()) errors.set('info', ['Nom requis']);
    if (sequence.steps.length === 0) errors.set('steps', ['Au moins une étape requise']);

    const messageSteps = sequence.steps.filter(s => needsMessage(s.actionType));
    const emptyMessages = messageSteps.filter(s => !s.useAiPersonalization && !s.messageTemplate?.trim());
    if (emptyMessages.length > 0) {
      const existing = errors.get('steps') || [];
      existing.push(`${plural(emptyMessages.length, 'message vide', 'messages vides')}`);
      errors.set('steps', existing);
    }
    return errors;
  }, [sequence]);

  const updateStep = useCallback((stepId: string, updates: Partial<SequenceStep>) => {
    setSequence(prev => ({
      ...prev,
      steps: prev.steps.map(step =>
        step.id === stepId ? { ...step, ...updates } : step
      ),
    }));
  }, []);

  const addStep = useCallback((actionType: string) => {
    const newStep = createEmptyStep(sequence.steps.length, actionType);
    setSequence(prev => ({
      ...prev,
      steps: [...prev.steps, newStep],
    }));
    setExpandedStepId(newStep.id);
    setShowStepPicker(false);
  }, [sequence.steps.length]);

  const removeStep = useCallback((stepId: string) => {
    if (sequence.steps.length <= 1) return;
    const newSteps = sequence.steps
      .filter(s => s.id !== stepId)
      .map((s, idx) => ({ ...s, order: idx }));
    setSequence(prev => ({ ...prev, steps: newSteps }));
    if (expandedStepId === stepId) {
      setExpandedStepId(newSteps[0]?.id || null);
    }
  }, [sequence.steps, expandedStepId]);

  const addVariant = useCallback((sourceStep: SequenceStep) => {
    const existingVariants = sequence.steps.filter(
      s => s.order === sourceStep.order && s.variantGroup
    );
    if (!sourceStep.variantGroup) {
      updateStep(sourceStep.id, { variantGroup: 'A', variantWeight: 50 });
    }
    const nextLetter = existingVariants.length <= 1 ? 'B' : 'C';
    if (existingVariants.length >= 3) return;

    const newStep: SequenceStep = {
      ...sourceStep,
      id: crypto.randomUUID(),
      variantGroup: nextLetter,
      variantWeight: Math.floor(100 / (existingVariants.length + 2)),
      messageTemplate: '',
      subjectTemplate: '',
    };
    const totalVariants = existingVariants.length + 2;
    const equalWeight = Math.floor(100 / totalVariants);

    setSequence(prev => ({
      ...prev,
      steps: [
        ...prev.steps.map(s => {
          if (s.order === sourceStep.order && (s.variantGroup || s.id === sourceStep.id)) {
            return { ...s, variantGroup: s.variantGroup || 'A', variantWeight: equalWeight };
          }
          return s;
        }),
        { ...newStep, variantWeight: equalWeight },
      ],
    }));
  }, [sequence.steps, updateStep]);

  const removeVariant = useCallback((variantStep: SequenceStep) => {
    const remainingVariants = sequence.steps.filter(
      s => s.order === variantStep.order && s.variantGroup && s.id !== variantStep.id
    );
    if (remainingVariants.length <= 1) {
      setSequence(prev => ({
        ...prev,
        steps: prev.steps
          .filter(s => s.id !== variantStep.id)
          .map(s => s.order === variantStep.order ? { ...s, variantGroup: undefined, variantWeight: undefined } : s),
      }));
    } else {
      const equalWeight = Math.floor(100 / remainingVariants.length);
      setSequence(prev => ({
        ...prev,
        steps: prev.steps
          .filter(s => s.id !== variantStep.id)
          .map(s => s.order === variantStep.order && s.variantGroup ? { ...s, variantWeight: equalWeight } : s),
      }));
    }
  }, [sequence.steps]);

  const variantGroups = useMemo(() => getVariantGroups(sequence.steps), [sequence.steps]);
  const primarySteps = useMemo(() => getPrimarySteps(sequence.steps), [sequence.steps]);

  /**
   * Enregistre la séquence. `activate` ne vaut que pour une nouvelle séquence :
   * une séquence existante garde son état, qui se change depuis la liste
   * (l'activation y relance aussi les inscriptions en pause).
   */
  const handleSave = async (activate = false) => {
    // Validation visible : les boutons restent actifs et disent ce qui manque (revue design D-34).
    if (!sequence.name.trim()) {
      toast.error('Donnez un nom à la séquence', { description: 'Le nom sert à la retrouver dans la liste.' });
      if (mode === 'wizard') setWizardStep('info');
      return;
    }
    if (sequence.steps.length === 0) {
      toast.error('Ajoutez au moins une étape', { description: 'Une séquence contient au moins une action.' });
      if (mode === 'wizard') setWizardStep('steps');
      return;
    }

    const errors: string[] = [];
    sequence.steps.forEach(s => {
      const stepLabel = `Étape ${s.order + 1}${s.variantGroup ? ` (variante ${s.variantGroup})` : ''}`;
      if (needsMessage(s.actionType) && !s.useAiPersonalization && !s.messageTemplate?.trim()) {
        errors.push(`${stepLabel} : message à rédiger`);
      }
      if (needsSubject(s.actionType) && !s.useAiPersonalization && !s.subjectTemplate?.trim()) {
        errors.push(`${stepLabel} : objet requis pour un e-mail ou un InMail`);
      }
      if (s.actionType === 'connection_request' && (s.messageTemplate?.length || 0) > 300) {
        errors.push(`${stepLabel} : note d'invitation trop longue (300 caractères au plus)`);
      }
      if (s.conditionType === 'if_score_above') {
        const scoreError = scoreThresholdError(s.conditionValue);
        if (scoreError) errors.push(`${stepLabel} : ${scoreError.charAt(0).toLowerCase()}${scoreError.slice(1, -1)}`);
      }
      // Audit Opus 2026-05-07 : sans timeoutDays, un wait_* peut bloquer
      // indéfiniment l'enrollment si l'événement attendu ne se produit jamais.
      if (['wait_connection', 'wait_reply', 'wait_profile_visit'].includes(s.actionType)
          && (!s.timeoutDays || s.timeoutDays <= 0)) {
        errors.push(`${stepLabel} : délai maximal requis pour une attente`);
      }
      // Délais hors-bornes (audit 2026-07, Builder M3) : le min={0} HTML
      // n'empêche pas la saisie clavier d'un négatif, et heures>23/minutes>59
      // donnent un scheduled_at incohérent (voire dans le passé = envoi
      // immédiat). On valide au save.
      const dDays = s.delayDays ?? 0, dHours = s.delayHours ?? 0, dMins = s.delayMinutes ?? 0;
      if (dDays < 0 || dHours < 0 || dMins < 0) {
        errors.push(`${stepLabel} : un délai ne peut pas être négatif`);
      }
      if (dHours > 23) errors.push(`${stepLabel} : les heures du délai vont de 0 à 23`);
      if (dMins > 59) errors.push(`${stepLabel} : les minutes du délai vont de 0 à 59`);
      // Fenêtre horaire préférée incohérente (début après fin)
      if (typeof s.preferredHourStart === 'number' && typeof s.preferredHourEnd === 'number'
          && s.preferredHourStart >= s.preferredHourEnd) {
        errors.push(`${stepLabel} : l'heure de début d'envoi doit précéder l'heure de fin`);
      }
    });

    // A/B variants : poids total doit faire 100% par groupe d'order partagé
    const variantsByOrder = new Map<number, SequenceStep[]>();
    sequence.steps.forEach(s => {
      if (s.variantGroup) {
        const list = variantsByOrder.get(s.order) || [];
        list.push(s);
        variantsByOrder.set(s.order, list);
      }
    });
    variantsByOrder.forEach((variants, order) => {
      if (variants.length < 2) return; // 1 seule variante = pas un A/B
      const total = variants.reduce((sum, v) => sum + (v.variantWeight || 0), 0);
      if (total !== 100) {
        errors.push(`Étape ${order + 1} : les variantes totalisent ${total} % au lieu de 100 %`);
      }
    });

    if (errors.length > 0) {
      setValidationErrors(errors);
      if (mode === 'wizard') setWizardStep('review');
      toast.error(`${plural(errors.length, 'point', 'points')} à corriger`, {
        description: errors[0] + (errors.length > 1 ? ` (et ${plural(errors.length - 1, 'autre', 'autres')})` : ''),
      });
      return;
    }

    setIsSaving(true);
    setSaveFailed(false);
    try {
      // Un seul message de succès, posé par la liste (revue design D-34).
      await onSave({ ...sequence, isActive: isNewSequence ? activate && canActivate : sequence.isActive });
      enregistreeRef.current = true;
      if (!isEditing) clearEditorDraft(SEQUENCE_DRAFT_KEY);
      onClose();
    } catch (err) {
      console.error('[SequenceBuilder] save failed:', err);
      setSaveFailed(true);
      toast.error("Impossible d'enregistrer la séquence", {
        description: 'Vos modifications sont toujours là. Vérifiez votre connexion, puis réessayez.',
      });
    } finally {
      setIsSaving(false);
    }
  };

  /**
   * « Retour », Échap : une séquence existante demande confirmation si des
   * modifications seraient perdues ; une nouvelle séquence part en brouillon
   * dans ce navigateur, et on le dit (revue design D-31).
   */
  const requestClose = () => {
    if (isSaving) return;
    if (isEditing) {
      if (isDirty) {
        setConfirmLeave('changes');
        return;
      }
      onClose();
      return;
    }
    const courante = sequenceRef.current;
    if (hasContent(courante)) {
      saveEditorDraft(SEQUENCE_DRAFT_KEY, courante);
      if (!loadEditorDraft<Sequence>(SEQUENCE_DRAFT_KEY)) {
        // Stockage du navigateur indisponible : la saisie serait perdue.
        setConfirmLeave('draft-lost');
        return;
      }
      toast.info('Brouillon conservé', {
        description: 'Vous le retrouverez à la prochaine création de séquence, dans ce navigateur.',
      });
    }
    onClose();
  };

  const goNextWizardStep = () => {
    const idx = WIZARD_ORDER.indexOf(wizardStep);
    if (idx < WIZARD_ORDER.length - 1) setWizardStep(WIZARD_ORDER[idx + 1]);
  };
  const goPrevWizardStep = () => {
    const idx = WIZARD_ORDER.indexOf(wizardStep);
    if (idx > 0) setWizardStep(WIZARD_ORDER[idx - 1]);
  };

  if (!isOpen) return null;

  const loadRecommendedSequence = () => {
    const steps = generateRecommendedSequence();
    setSequence(prev => ({ ...prev, steps }));
    setShowStepPicker(false);
    setExpandedStepId(steps[0]?.id || null);
  };

  const stepsCountLabel = sequence.steps.length > 0 ? plural(sequence.steps.length, 'étape') : "Aucune étape pour l'instant";

  // ── Erreurs d'un enregistrement refusé ──
  const validationErrorsBlock = validationErrors.length > 0 && (
    <div role="alert" className="rounded-lg border border-danger/25 bg-danger-muted p-3">
      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
        <AlertCircle className="h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
        {plural(validationErrors.length, 'point', 'points')} à corriger avant d'enregistrer
      </p>
      <ul className="mt-2 list-disc space-y-1 pl-6 text-xs text-foreground">
        {validationErrors.map((err, i) => (
          <li key={i}>{err}</li>
        ))}
      </ul>
    </div>
  );

  // ── Liste des étapes (assistant et mode expert) ──
  const renderStepsList = () => (
    <div className="space-y-3">
      <ol className="space-y-3">
        {primarySteps.map((step, index) => {
          const isExpanded = expandedStepId === step.id;
          const stepIsTrigger = isTrigger(step.actionType);
          const variants = variantGroups.get(step.order) || [];
          const hasVariants = variants.length > 1;
          const stepNumber = step.order + 1;
          const label = sequenceActionLabel(step.actionType);
          const delay = formatStepDelay(step.delayDays, step.delayHours, step.delayMinutes);
          const missing: string[] = [];
          if (needsMessage(step.actionType) && !step.useAiPersonalization && !step.messageTemplate?.trim()) missing.push('message');
          if (needsSubject(step.actionType) && !step.useAiPersonalization && !step.subjectTemplate?.trim()) missing.push('objet');
          if (step.actionType === 'connection_request' && (step.messageTemplate?.length || 0) > 300) missing.push('note trop longue');
          const scoreError = step.conditionType === 'if_score_above' ? scoreThresholdError(step.conditionValue) : null;
          const fieldId = (name: string) => `step-${step.id}-${name}`;

          return (
            <li key={step.id}>
              <Collapsible
                open={isExpanded}
                onOpenChange={(open) => setExpandedStepId(open ? step.id : null)}
                className={cn('overflow-hidden rounded-xl border bg-card transition-colors duration-150', isExpanded ? 'border-border-strong' : 'border-border')}
              >
                {/* En-tête d'étape : un bouton qui ouvre ou ferme le détail (revue design D-32) */}
                <div className="flex items-center gap-1 pr-2">
                  <CollapsibleTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      className="group h-auto min-w-0 flex-1 justify-start gap-3 whitespace-normal rounded-xl p-3 text-left font-normal hover:bg-accent/40"
                    >
                      <ChevronRight className="h-4 w-4 text-muted-foreground transition-transform duration-150 group-data-[state=open]:rotate-90" aria-hidden="true" />
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted text-foreground-secondary">
                        <SequenceActionIcon type={step.actionType} className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-xs text-muted-foreground">Étape {stepNumber}</span>
                          <Badge variant="muted" className="px-1.5 py-0 text-3xs">{stepIsTrigger ? 'Déclencheur' : 'Action'}</Badge>
                          <span className="text-sm font-medium text-foreground">{label}</span>
                          {missing.length > 0 && (
                            <Badge variant="danger" className="px-1.5 py-0 text-3xs">
                              <AlertCircle className="h-3 w-3" aria-hidden="true" />
                              À compléter : {missing.join(', ')}
                            </Badge>
                          )}
                          {hasVariants && (
                            <Badge variant="outline" className="px-1.5 py-0 text-3xs">
                              <FlaskConical className="h-3 w-3" aria-hidden="true" />
                              Test A/B
                            </Badge>
                          )}
                        </span>
                        {(delay || step.useAiPersonalization || (stepIsTrigger && step.timeoutDays)) && (
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                            {delay && (
                              <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3" aria-hidden="true" />Après {delay}</span>
                            )}
                            {step.useAiPersonalization && <span>Rédigé par l'IA</span>}
                            {stepIsTrigger && step.timeoutDays ? (
                              <span className="inline-flex items-center gap-1"><Hourglass className="h-3 w-3" aria-hidden="true" />Délai maximal : {step.timeoutDays} j</span>
                            ) : null}
                          </span>
                        )}
                      </span>
                    </Button>
                  </CollapsibleTrigger>
                  {canABTest(step.actionType) && !hasVariants && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => addVariant(step)}
                          className="shrink-0 text-muted-foreground max-md:h-11 max-md:w-11"
                          aria-label={`Créer un test A/B pour l'étape ${stepNumber}`}
                        >
                          <FlaskConical aria-hidden="true" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Tester deux versions du message</TooltipContent>
                    </Tooltip>
                  )}
                  {sequence.steps.length > 1 && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => removeStep(step.id)}
                          className="shrink-0 text-muted-foreground hover:text-danger max-md:h-11 max-md:w-11"
                          aria-label={`Supprimer l'étape ${stepNumber} : ${label}`}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Supprimer l'étape</TooltipContent>
                    </Tooltip>
                  )}
                </div>

                <CollapsibleContent className="space-y-4 border-t border-border px-3 pb-4 pt-3 sm:px-4">
                  {/* Délai */}
                  {index > 0 && (
                    <fieldset>
                      <legend className="mb-1.5 text-sm font-medium text-foreground">Délai avant l'étape</legend>
                      <div className="grid grid-cols-3 gap-3">
                        <div>
                          <Label htmlFor={fieldId('days')} className="text-xs font-normal text-muted-foreground">Jours</Label>
                          <Input id={fieldId('days')} type="number" min={0} value={step.delayDays} onChange={(e) => updateStep(step.id, { delayDays: Math.max(0, parseInt(e.target.value) || 0) })} className="mt-1.5" />
                        </div>
                        <div>
                          <Label htmlFor={fieldId('hours')} className="text-xs font-normal text-muted-foreground">Heures</Label>
                          <Input id={fieldId('hours')} type="number" min={0} max={23} value={step.delayHours} onChange={(e) => updateStep(step.id, { delayHours: Math.min(23, Math.max(0, parseInt(e.target.value) || 0)) })} className="mt-1.5" />
                        </div>
                        <div>
                          <Label htmlFor={fieldId('minutes')} className="text-xs font-normal text-muted-foreground">Minutes</Label>
                          <Input id={fieldId('minutes')} type="number" min={0} max={59} value={step.delayMinutes || 0} onChange={(e) => updateStep(step.id, { delayMinutes: Math.min(59, Math.max(0, parseInt(e.target.value) || 0)) })} className="mt-1.5" />
                        </div>
                      </div>
                    </fieldset>
                  )}

                  {/* Condition */}
                  {isAction(step.actionType) && (
                    <div>
                      <Label htmlFor={fieldId('condition')}>Condition d'exécution</Label>
                      <Select value={step.conditionType} onValueChange={(value) => updateStep(step.id, { conditionType: value as SequenceStep['conditionType'] })}>
                        <SelectTrigger id={fieldId('condition')} className="mt-1.5"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {getConditionsForActionType(step.actionType).map(cond => (
                            <SelectItem key={cond.value} value={cond.value}>{cond.label}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      {isCrossChannelCondition(step.actionType, step.conditionType) && (
                        <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warning">
                          <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                          Cette condition ne s'applique pas à ce type d'étape.
                        </p>
                      )}
                      {step.conditionType === 'if_score_above' && (
                        <div className="mt-3">
                          <Label htmlFor={fieldId('score')} className="text-xs font-normal text-muted-foreground">Seuil de score (0 à 100)</Label>
                          <Input
                            id={fieldId('score')}
                            type="number"
                            min={0}
                            max={100}
                            placeholder="70"
                            value={step.conditionValue ?? ''}
                            onChange={(e) => updateStep(step.id, { conditionValue: e.target.value })}
                            aria-invalid={scoreError ? true : undefined}
                            aria-describedby={scoreError ? fieldId('score-error') : undefined}
                            className={cn('mt-1.5 w-32', scoreError && 'border-danger')}
                          />
                          {scoreError && <p id={fieldId('score-error')} className="mt-1 text-xs text-danger">{scoreError}</p>}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Fenêtre d'envoi */}
                  <Collapsible>
                    <CollapsibleTrigger asChild>
                      <Button type="button" variant="ghost" size="xs" className="group -ml-2 gap-1 text-muted-foreground hover:text-foreground max-md:h-11">
                        <ChevronRight className="transition-transform duration-150 group-data-[state=open]:rotate-90" aria-hidden="true" />
                        Fenêtre d'envoi
                      </Button>
                    </CollapsibleTrigger>
                    <CollapsibleContent className="mt-2 grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor={fieldId('hour-start')} className="text-xs font-normal text-muted-foreground">Heure de début</Label>
                        <Input id={fieldId('hour-start')} type="number" min={0} max={23} value={step.preferredHourStart} onChange={(e) => updateStep(step.id, { preferredHourStart: parseInt(e.target.value) || 9 })} className="mt-1.5" />
                      </div>
                      <div>
                        <Label htmlFor={fieldId('hour-end')} className="text-xs font-normal text-muted-foreground">Heure de fin</Label>
                        <Input id={fieldId('hour-end')} type="number" min={0} max={23} value={step.preferredHourEnd} onChange={(e) => updateStep(step.id, { preferredHourEnd: parseInt(e.target.value) || 18 })} className="mt-1.5" />
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  {/* Déclencheur : délai d'attente */}
                  {isTrigger(step.actionType) && step.actionType !== 'check_connection' && (
                    <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
                      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <Hourglass className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        Délai d'attente
                      </p>
                      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                        <div>
                          <Label htmlFor={fieldId('timeout')} className="text-xs font-normal text-muted-foreground">Délai maximal (jours)</Label>
                          <Input id={fieldId('timeout')} type="number" min={1} value={step.timeoutDays || 3} onChange={(e) => updateStep(step.id, { timeoutDays: parseInt(e.target.value) || 3 })} className="mt-1.5" />
                        </div>
                        <div>
                          <Label htmlFor={fieldId('timeout-action')} className="text-xs font-normal text-muted-foreground">Si le délai est dépassé</Label>
                          <Select value={step.timeoutAction || 'skip'} onValueChange={(value) => updateStep(step.id, { timeoutAction: value as SequenceStep['timeoutAction'] })}>
                            <SelectTrigger id={fieldId('timeout-action')} className="mt-1.5"><SelectValue /></SelectTrigger>
                            <SelectContent>
                              {TIMEOUT_ACTIONS.map(action => (
                                <SelectItem key={action.value} value={action.value}>{action.label}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {step.timeoutAction === 'alternative_step' && (
                        <div>
                          <Label htmlFor={fieldId('fallback')} className="text-xs font-normal text-muted-foreground">Étape de repli</Label>
                          <Select value={step.timeoutBranchStepId || '__none__'} onValueChange={(value) => updateStep(step.id, { timeoutBranchStepId: value === '__none__' ? undefined : value })}>
                            <SelectTrigger id={fieldId('fallback')} className="mt-1.5"><SelectValue placeholder="Choisir une étape" /></SelectTrigger>
                            <SelectContent>
                              <SelectItem value="__none__">Choisir une étape</SelectItem>
                              {sequence.steps.filter(s => s.id !== step.id).map(s => (
                                <SelectItem key={s.id} value={s.id}>{stepOptionLabel(s)}</SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Vérification de la connexion */}
                  {step.actionType === 'check_connection' && (
                    <div className="space-y-4 rounded-lg border border-border bg-muted/40 p-3">
                      <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                        <GitBranch className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                        Vérification du degré de relation
                      </p>
                      <div>
                        <Label htmlFor={fieldId('if-true')} className="text-xs font-normal text-muted-foreground">Si connecté (1er degré), aller à</Label>
                        <Select value={step.ifTrueGotoStep || '__next__'} onValueChange={(value) => updateStep(step.id, { ifTrueGotoStep: value === '__next__' ? undefined : value })}>
                          <SelectTrigger id={fieldId('if-true')} className="mt-1.5"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__next__">Étape suivante</SelectItem>
                            {sequence.steps.filter(s => s.order > step.order).map(s => (
                              <SelectItem key={s.id} value={s.id}>{stepOptionLabel(s)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div>
                        <Label htmlFor={fieldId('if-false')} className="text-xs font-normal text-muted-foreground">Si non connecté, aller à</Label>
                        <Select value={step.ifFalseGotoStep || '__next__'} onValueChange={(value) => updateStep(step.id, { ifFalseGotoStep: value === '__next__' ? undefined : value })}>
                          <SelectTrigger id={fieldId('if-false')} className="mt-1.5"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__next__">Étape suivante</SelectItem>
                            {sequence.steps.filter(s => s.order > step.order).map(s => (
                              <SelectItem key={s.id} value={s.id}>{stepOptionLabel(s)}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  )}

                  {/* Message */}
                  {needsMessage(step.actionType) && (
                    <>
                      {hasVariants && (
                        <div className="overflow-hidden rounded-lg border border-border">
                          <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
                            <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                              <FlaskConical className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                              Test A/B
                            </p>
                            {variants.length < 3 && (
                              <Button type="button" variant="ghost" size="xs" className="max-md:h-11" onClick={() => addVariant(step)}>
                                <Plus aria-hidden="true" />
                                Ajouter une variante
                              </Button>
                            )}
                          </div>
                          <Tabs defaultValue={step.id} className="w-full p-3">
                            <TabsList className="w-full max-md:h-11" aria-label={`Variantes de l'étape ${stepNumber}`}>
                              {[...variants].sort((a, b) => (a.variantGroup || '').localeCompare(b.variantGroup || '')).map(v => (
                                <TabsTrigger key={v.id} value={v.id} className="flex-1 text-xs">
                                  Variante {v.variantGroup}<span className="ml-1 text-muted-foreground">· {v.variantWeight || 0} %</span>
                                </TabsTrigger>
                              ))}
                            </TabsList>
                            {variants.map(v => {
                              const variantId = (name: string) => `variant-${v.id}-${name}`;
                              return (
                                <TabsContent key={v.id} value={v.id} className="mt-3 space-y-3">
                                  <div className="flex items-center gap-3">
                                    <Label htmlFor={variantId('weight')} className="whitespace-nowrap text-xs font-normal text-muted-foreground">Part des envois (%)</Label>
                                    <Input id={variantId('weight')} type="number" min={1} max={100} value={v.variantWeight || 50} onChange={(e) => updateStep(v.id, { variantWeight: parseInt(e.target.value) || 50 })} className="h-8 w-20 text-xs" />
                                    {v.variantGroup !== 'A' && (
                                      <Tooltip>
                                        <TooltipTrigger asChild>
                                          <Button
                                            type="button"
                                            variant="ghost"
                                            size="icon-sm"
                                            className="ml-auto text-muted-foreground hover:text-danger max-md:h-11 max-md:w-11"
                                            onClick={() => removeVariant(v)}
                                            aria-label={`Supprimer la variante ${v.variantGroup}`}
                                          >
                                            <Trash2 aria-hidden="true" />
                                          </Button>
                                        </TooltipTrigger>
                                        <TooltipContent>Supprimer la variante</TooltipContent>
                                      </Tooltip>
                                    )}
                                  </div>
                                  <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
                                    <Label htmlFor={variantId('ai')} className="cursor-pointer text-xs">Rédaction par l'IA</Label>
                                    <Switch id={variantId('ai')} checked={v.useAiPersonalization} onCheckedChange={(checked) => updateStep(v.id, { useAiPersonalization: checked })} />
                                  </div>
                                  {!v.useAiPersonalization && (
                                    <>
                                      {needsSubject(v.actionType) && (
                                        <div>
                                          <Label htmlFor={variantId('subject')} className="text-xs font-normal text-muted-foreground">Objet</Label>
                                          <Input id={variantId('subject')} value={v.subjectTemplate || ''} onChange={(e) => updateStep(v.id, { subjectTemplate: e.target.value })} placeholder="Objet" className="mt-1 h-8 text-xs" />
                                        </div>
                                      )}
                                      <div>
                                        <Label htmlFor={variantId('message')} className="text-xs font-normal text-muted-foreground">Message</Label>
                                        <Textarea id={variantId('message')} value={v.messageTemplate || ''} onChange={(e) => updateStep(v.id, { messageTemplate: e.target.value })} placeholder="Bonjour {{first_name}}, …" rows={2} className="mt-1 text-xs" />
                                      </div>
                                    </>
                                  )}
                                </TabsContent>
                              );
                            })}
                            {(() => {
                              const totalWeight = variants.reduce((sum, v) => sum + (v.variantWeight || 0), 0);
                              return (
                                <p className={cn('mt-3 border-t border-border pt-2 text-xs font-medium', totalWeight === 100 ? 'text-success' : 'text-danger')}>
                                  Total : {totalWeight} %{totalWeight !== 100 && ' (doit faire 100 %)'}
                                </p>
                              );
                            })()}
                          </Tabs>
                        </div>
                      )}

                      {!hasVariants && (
                        <>
                          {isWhatsAppStep(step.actionType) && (
                            <Banner tone="info" icon={Info} className="rounded-lg border">
                              Message WhatsApp : les candidats sans numéro de téléphone sont ignorés.
                            </Banner>
                          )}
                          <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                            <div className="min-w-0">
                              <Label htmlFor={fieldId('ai')} className="cursor-pointer">Rédaction par l'IA</Label>
                              <p className="mt-1 text-xs text-muted-foreground">L'IA écrit le message pour chaque candidat au moment de l'envoi.</p>
                            </div>
                            <Switch id={fieldId('ai')} checked={step.useAiPersonalization} onCheckedChange={(checked) => updateStep(step.id, { useAiPersonalization: checked })} />
                          </div>

                          {step.useAiPersonalization ? (
                            <div>
                              <Label htmlFor={fieldId('tone')}>Ton du message</Label>
                              <Select value={step.aiTone || 'professional'} onValueChange={(value) => updateStep(step.id, { aiTone: value as SequenceStep['aiTone'] })}>
                                <SelectTrigger id={fieldId('tone')} className="mt-1.5"><SelectValue /></SelectTrigger>
                                <SelectContent>
                                  {MESSAGE_TONES.map(tone => <SelectItem key={tone.value} value={tone.value}>{tone.label}</SelectItem>)}
                                </SelectContent>
                              </Select>
                              <p className="mt-2 text-xs text-muted-foreground">Le message s'appuie sur le profil du candidat et le brief de la mission.</p>
                            </div>
                          ) : (
                            <>
                              {needsSubject(step.actionType) && (
                                <div>
                                  <div className="flex items-center justify-between">
                                    <Label htmlFor={fieldId('subject')}>Objet</Label>
                                    <VariableInserter targetRef={subjectRef} currentValue={step.subjectTemplate || ''} onInsert={(val) => updateStep(step.id, { subjectTemplate: val })} showEmailVariables={step.actionType === 'email'} fieldLabel="l'objet" />
                                  </div>
                                  <Input
                                    id={fieldId('subject')}
                                    ref={subjectRef}
                                    value={step.subjectTemplate || ''}
                                    onChange={(e) => updateStep(step.id, { subjectTemplate: e.target.value })}
                                    placeholder={step.actionType === 'email' ? "Objet de l'e-mail" : "Objet de l'InMail"}
                                    aria-invalid={!step.subjectTemplate?.trim() ? true : undefined}
                                    aria-describedby={!step.subjectTemplate?.trim() ? fieldId('subject-error') : undefined}
                                    className={cn('mt-1.5', !step.subjectTemplate?.trim() && 'border-danger')}
                                  />
                                  {!step.subjectTemplate?.trim() && <p id={fieldId('subject-error')} className="mt-1 text-xs text-danger">Objet requis.</p>}
                                </div>
                              )}
                              <div>
                                <div className="flex items-center justify-between">
                                  <Label htmlFor={fieldId('message')}>Message</Label>
                                  <div className="flex items-center gap-2">
                                    <VariableInserter targetRef={messageRef} currentValue={step.messageTemplate || ''} onInsert={(val) => updateStep(step.id, { messageTemplate: val })} showEmailVariables={step.actionType === 'email'} fieldLabel="le message" />
                                    {step.actionType === 'connection_request' && (
                                      <span className={cn('text-xs tabular-nums', (step.messageTemplate?.length || 0) > 300 ? 'font-medium text-danger' : 'text-muted-foreground')}>
                                        {step.messageTemplate?.length || 0}/300
                                      </span>
                                    )}
                                  </div>
                                </div>
                                <Textarea
                                  id={fieldId('message')}
                                  ref={messageRef}
                                  value={step.messageTemplate || ''}
                                  onChange={(e) => updateStep(step.id, { messageTemplate: e.target.value })}
                                  placeholder={step.actionType === 'connection_request' ? "Note d'invitation (300 caractères au plus)" : 'Bonjour {{first_name}}, …'}
                                  rows={step.actionType === 'connection_request' ? 2 : 3}
                                  maxLength={step.actionType === 'connection_request' ? 300 : undefined}
                                  className={cn('mt-1.5', step.actionType === 'connection_request' && (step.messageTemplate?.length || 0) > 300 && 'border-danger')}
                                />

                                {/* Aperçu avec un exemple neutre, jamais un vrai nom (revue design D-36) */}
                                {(step.messageTemplate || '').includes('{{') && (
                                  <details className="group mt-2">
                                    <summary className="flex w-fit cursor-pointer select-none list-none items-center gap-1 rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11 [&::-webkit-details-marker]:hidden">
                                      <ChevronRight className="h-3 w-3 transition-transform duration-150 group-open:rotate-90" aria-hidden="true" />
                                      <Eye className="h-3 w-3" aria-hidden="true" />
                                      Aperçu avec un exemple ({VARIABLE_EXAMPLE.first_name} {VARIABLE_EXAMPLE.last_name}, {VARIABLE_EXAMPLE.company})
                                    </summary>
                                    <div className="mt-2 whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-xs text-foreground">
                                      {previewMessageTemplate(step.messageTemplate || '', displayName)}
                                    </div>
                                  </details>
                                )}
                              </div>
                            </>
                          )}

                          {step.actionType === 'email' && !step.useAiPersonalization && (
                            <div className="space-y-3 border-t border-border pt-3">
                              <Collapsible>
                                <CollapsibleTrigger asChild>
                                  <Button type="button" variant="ghost" size="xs" className="group -ml-2 gap-1 text-muted-foreground hover:text-foreground max-md:h-11">
                                    <ChevronRight className="transition-transform duration-150 group-data-[state=open]:rotate-90" aria-hidden="true" />
                                    Copies (Cc, Cci)
                                  </Button>
                                </CollapsibleTrigger>
                                <CollapsibleContent className="space-y-2 pt-2">
                                  <div>
                                    <Label htmlFor={fieldId('cc')} className="text-xs font-normal text-muted-foreground">Cc</Label>
                                    <Input id={fieldId('cc')} value={(step.ccEmails || []).join(', ')} onChange={(e) => updateStep(step.id, { ccEmails: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="adresse@exemple.fr" className="mt-1 h-8 text-xs" />
                                  </div>
                                  <div>
                                    <Label htmlFor={fieldId('bcc')} className="text-xs font-normal text-muted-foreground">Cci</Label>
                                    <Input id={fieldId('bcc')} value={(step.bccEmails || []).join(', ')} onChange={(e) => updateStep(step.id, { bccEmails: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="adresse@exemple.fr" className="mt-1 h-8 text-xs" />
                                  </div>
                                </CollapsibleContent>
                              </Collapsible>
                              <div className="flex items-center justify-between gap-3">
                                <Label htmlFor={fieldId('unsubscribe')} className="cursor-pointer text-xs font-normal">Ajouter un lien de désinscription</Label>
                                <Switch id={fieldId('unsubscribe')} checked={step.includeUnsubscribe ?? false} onCheckedChange={(checked) => updateStep(step.id, { includeUnsubscribe: checked })} />
                              </div>
                              <div>
                                <Label htmlFor={fieldId('signature')} className="text-xs font-normal text-muted-foreground">Signature</Label>
                                <Select value={step.signatureId || '__none__'} onValueChange={(value) => updateStep(step.id, { signatureId: value === '__none__' ? undefined : value })}>
                                  <SelectTrigger id={fieldId('signature')} className="mt-1"><SelectValue placeholder="Aucune" /></SelectTrigger>
                                  <SelectContent>
                                    <SelectItem value="__none__">Aucune</SelectItem>
                                    {signatures.map(sig => <SelectItem key={sig.id} value={sig.id}>{sig.name}</SelectItem>)}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          )}
                        </>
                      )}
                    </>
                  )}
                </CollapsibleContent>
              </Collapsible>
            </li>
          );
        })}
      </ol>

      {/* Choix d'une étape */}
      {(showStepPicker || sequence.steps.length === 0) && (() => {
        const { availableActions, availableTriggers } = getAvailableStepTypes(sequence.steps);
        const hasNoOptions = availableActions.length === 0 && availableTriggers.length === 0;
        return (
          <div className="rounded-xl border border-dashed border-border bg-muted/20 p-4 sm:p-5">
            <div className="mb-4 flex items-center justify-between gap-2">
              <h4 className="text-sm font-medium text-foreground">{sequence.steps.length === 0 ? 'Commencez par ajouter une étape' : 'Ajouter une étape'}</h4>
              {sequence.steps.length > 0 && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button type="button" variant="ghost" size="icon-sm" className="max-md:h-11 max-md:w-11" onClick={() => setShowStepPicker(false)} aria-label="Fermer le choix d'étape">
                      <X aria-hidden="true" />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>Fermer</TooltipContent>
                </Tooltip>
              )}
            </div>
            {hasNoOptions ? (
              <p className="py-4 text-center text-sm text-muted-foreground">Aucune autre étape ne peut suivre celles de la séquence.</p>
            ) : (
              <>
                {availableActions.length > 0 && (
                  <div className="mb-4">
                    <p className="eyebrow mb-2">Actions</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {availableActions.map(action => (
                        <StepTypeOption key={action.value} value={action.value} description={action.description} onPick={addStep} />
                      ))}
                    </div>
                  </div>
                )}
                {availableTriggers.length > 0 && (
                  <div>
                    <p className="eyebrow mb-2">Déclencheurs</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {availableTriggers.map(trigger => (
                        <StepTypeOption key={trigger.value} value={trigger.value} description={trigger.description} onPick={addStep} />
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        );
      })()}

      {sequence.steps.length > 0 && !showStepPicker && (
        <Button type="button" variant="outline" onClick={() => setShowStepPicker(true)} className="w-full border-dashed max-md:h-11">
          <Plus aria-hidden="true" />
          Ajouter une étape
        </Button>
      )}
    </div>
  );

  // Dans l'assistant, le titre de l'étape « Étapes de la séquence » tient lieu d'intitulé.
  const renderStepsTabs = (withHeading: boolean) => (
    <Tabs defaultValue="list" className="w-full">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          {withHeading && <h3 className="text-md font-semibold text-foreground">Étapes</h3>}
          <p className={cn('text-xs text-muted-foreground', withHeading && 'mt-0.5')}>{stepsCountLabel}</p>
        </div>
        <TabsList aria-label="Affichage des étapes" className="max-md:h-11">
          <TabsTrigger value="list" className="gap-1.5 text-xs"><List className="h-3.5 w-3.5" aria-hidden="true" />Liste</TabsTrigger>
          <TabsTrigger value="visual" className="gap-1.5 text-xs"><Workflow className="h-3.5 w-3.5" aria-hidden="true" />Visuel</TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="visual" className="mt-0">
        <VisualSequenceEditor steps={sequence.steps} onStepsChange={(newSteps) => setSequence(prev => ({ ...prev, steps: newSteps }))} />
      </TabsContent>
      <TabsContent value="list" className="mt-0">
        {renderStepsList()}
      </TabsContent>
    </Tabs>
  );

  const nameFields = (prefix: string, descriptionPlaceholder: string) => (
    <div className="space-y-5">
      <div>
        <Label htmlFor={`${prefix}-name`}>Nom de la séquence <span className="text-muted-foreground" aria-hidden="true">*</span></Label>
        <Input id={`${prefix}-name`} required value={sequence.name} onChange={(e) => setSequence(prev => ({ ...prev, name: e.target.value }))} placeholder="Ex. : Approche développeurs React" className="mt-1.5" />
      </div>
      <div>
        <Label htmlFor={`${prefix}-desc`}>Description (facultative)</Label>
        <Input id={`${prefix}-desc`} value={sequence.description || ''} onChange={(e) => setSequence(prev => ({ ...prev, description: e.target.value }))} placeholder={descriptionPlaceholder} className="mt-1.5" />
      </div>
    </div>
  );

  const multiSender = (
    <MultiSenderSettings
      enabled={sequence.multiSenderEnabled || false}
      onEnabledChange={(multiSenderEnabled) => setSequence(prev => ({ ...prev, multiSenderEnabled }))}
      senderAccounts={sequence.senderAccounts || []}
      onSenderAccountsChange={(senderAccounts) => setSequence(prev => ({ ...prev, senderAccounts }))}
      rotationMode={sequence.rotationMode || 'round_robin'}
      onRotationModeChange={(rotationMode) => setSequence(prev => ({ ...prev, rotationMode }))}
    />
  );

  const stopConditions = (
    <StopConditionsSettings
      value={sequence.stopConditions || DEFAULT_STOP_CONDITIONS}
      onChange={(value) => setSequence(prev => ({ ...prev, stopConditions: value }))}
    />
  );

  const finalLabel = !isNewSequence
    ? 'Enregistrer les modifications'
    : canActivate ? 'Enregistrer et activer' : 'Enregistrer sans activer';

  // ── Contenu de chaque étape de l'assistant ──
  const renderWizardContent = () => {
    switch (wizardStep) {
      case 'info':
        return (
          <div className="max-w-lg space-y-8">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Informations</h3>
              <p className="mt-1 text-sm text-muted-foreground">Nommez la séquence et décrivez son objectif.</p>
            </div>
            {nameFields('wiz', "L'objectif de cette séquence")}
          </div>
        );

      case 'senders':
        return (
          <div className="max-w-2xl space-y-8">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Expéditeurs</h3>
              <p className="mt-1 text-sm text-muted-foreground">Choisissez qui envoie les messages : votre compte seul, ou plusieurs comptes de l'équipe.</p>
            </div>
            {multiSender}
          </div>
        );

      case 'steps':
        return (
          <div className="space-y-8">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <h3 className="text-lg font-semibold text-foreground">Étapes de la séquence</h3>
                <p className="mt-1 text-sm text-muted-foreground">Les actions à mener et les attentes entre elles.</p>
              </div>
              {sequence.steps.length === 0 && (
                <Button type="button" variant="outline" onClick={loadRecommendedSequence} className="max-md:h-11">
                  <Workflow aria-hidden="true" />
                  Charger la séquence recommandée
                </Button>
              )}
            </div>
            {renderStepsTabs(false)}
          </div>
        );

      case 'guardrails':
        return (
          <div className="max-w-2xl space-y-8">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Garde-fous</h3>
              <p className="mt-1 text-sm text-muted-foreground">Définissez quand arrêter la séquence et protégez vos comptes.</p>
            </div>
            {stopConditions}
            {/* Limites quotidiennes élevées */}
            {sequence.multiSenderEnabled && sequence.senderAccounts && sequence.senderAccounts.some(s => s.daily_limit > 80) && (
              <Banner tone="warning" icon={Shield} className="rounded-lg border">
                <strong className="font-semibold">Limites élevées.</strong> Au moins un expéditeur dépasse 80 envois par jour, ce qui expose son compte LinkedIn à une restriction. Comptez 30 à 50 envois par jour pour un compte récent, 50 à 80 pour un compte établi.
              </Banner>
            )}
            {/* Canaux qui demandent une donnée du candidat */}
            {sequence.steps.some(s => s.actionType === 'email') && (
              <Banner tone="info" icon={Info} className="rounded-lg border">
                Cette séquence envoie des e-mails : les candidats sans adresse e-mail sont ignorés.
              </Banner>
            )}
            {sequence.steps.some(s => s.actionType === 'whatsapp_message') && (
              <Banner tone="info" icon={Info} className="rounded-lg border">
                Cette séquence envoie des messages WhatsApp : les candidats sans numéro de téléphone sont ignorés.
              </Banner>
            )}
          </div>
        );

      case 'review':
        return (
          <div className="max-w-2xl space-y-8">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Vérification</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {isNewSequence
                  ? canActivate
                    ? "Vérifiez que tout est prêt. « Enregistrer et activer » met la séquence en service : les candidats que vous y inscrirez recevront les messages. « Enregistrer sans activer », en haut, la garde en préparation."
                    : "Vérifiez que tout est prêt. La séquence sera enregistrée sans être activée : votre offre ne permet pas encore de l'activer."
                  : 'Vérifiez vos modifications avant de les enregistrer.'}
              </p>
            </div>

            {validationErrorsBlock}

            {/* Récapitulatif */}
            <section className="space-y-4 rounded-xl border border-border bg-card p-5" aria-label="Récapitulatif">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 break-words text-md font-semibold text-foreground">{sequence.name.trim() || 'Sans nom'}</p>
                <Badge variant="outline" className="shrink-0">{sequence.steps.length > 0 ? plural(sequence.steps.length, 'étape') : 'Aucune étape'}</Badge>
              </div>
              {sequence.description && <p className="text-xs text-muted-foreground">{sequence.description}</p>}

              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="eyebrow mb-2">Aperçu du déroulé</p>
                {sequence.steps.length === 0 && <p className="text-xs text-muted-foreground">Aucune étape pour l'instant.</p>}
                <ol className="flex flex-wrap items-center gap-1" aria-label="Étapes dans l'ordre">
                  {sequence.steps.slice(0, 20).map((step, i) => (
                    <li key={step.id} className="flex items-center gap-1">
                      {i > 0 && <ArrowRight className="h-3 w-3 text-muted-foreground" aria-hidden="true" />}
                      <span className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-muted text-foreground-secondary" title={sequenceActionLabel(step.actionType)}>
                        <SequenceActionIcon type={step.actionType} className="h-3 w-3" />
                        <span className="sr-only">{sequenceActionLabel(step.actionType)}</span>
                      </span>
                    </li>
                  ))}
                  {sequence.steps.length > 20 && (
                    <li className="text-xs text-muted-foreground">et {plural(sequence.steps.length - 20, 'autre étape', 'autres étapes')}</li>
                  )}
                </ol>
              </div>
            </section>

            <SequenceValidationChecklist sequence={sequence} />
          </div>
        );
    }
  };

  const currentWizardIndex = WIZARD_ORDER.indexOf(wizardStep);
  const saveState: SaveState | null = isSaving
    ? 'saving'
    : saveFailed ? 'error'
      : isDirty ? 'unsaved'
        : isNewSequence ? null : 'saved';

  return (
    <Dialog open onOpenChange={(open) => { if (!open) requestClose(); }}>
      {/* Fenêtre plein écran du kit (rôle, focus piégé, Échap) : Échap et
          « Retour » passent par la même garde (revue design D-31, D-33). Les
          fenêtres qu'elle ouvre se posent au-dessus. */}
      <DialogContent
        variant="fullscreen"
        ref={contentRef}
        tabIndex={-1}
        aria-describedby={undefined}
        // Le focus va à la fenêtre (annoncée par son titre), pas au premier
        // bouton : son infobulle masquerait l'écran à chaque ouverture.
        onOpenAutoFocus={(event) => {
          event.preventDefault();
          contentRef.current?.focus();
        }}
        onEscapeKeyDown={(event) => {
          // Déjà pris par une liste de suggestions ouverte (garde du kit).
          if (event.defaultPrevented) return;
          event.preventDefault();
          requestClose();
        }}
        onInteractOutside={(event) => event.preventDefault()}
      >
        {/* Barre du haut */}
        <header className="flex h-14 shrink-0 items-center justify-between gap-2 border-b border-border px-2 sm:px-5">
          <div className="flex min-w-0 items-center gap-2 sm:gap-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={requestClose}
                  aria-label="Retour"
                  className="shrink-0 gap-1.5 px-2 text-muted-foreground hover:text-foreground max-md:h-11 max-sm:w-11 max-sm:px-0"
                >
                  <ArrowLeft aria-hidden="true" />
                  <span className="max-sm:hidden">Retour</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>Retour à la liste des séquences</TooltipContent>
            </Tooltip>
            <div className="hidden h-6 w-px bg-border sm:block" aria-hidden="true" />
            <div className="flex min-w-0 items-baseline gap-2">
              <DialogTitle className="truncate text-sm font-semibold max-sm:sr-only">
                {isNewSequence ? 'Nouvelle séquence' : 'Modifier la séquence'}
              </DialogTitle>
              {sequence.name && (
                <span className="hidden max-w-[240px] truncate text-sm text-muted-foreground md:inline">{sequence.name}</span>
              )}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2 sm:gap-3">
            {saveState && <SaveStatus state={saveState} className="hidden lg:inline-flex" />}
            <SegmentedControl
              aria-label="Mode d'édition"
              value={mode}
              onValueChange={(value) => setMode(value)}
              options={MODE_OPTIONS}
              className="max-md:h-11"
            />
            <Button
              type="button"
              variant={mode === 'expert' ? 'primary' : 'outline'}
              size="sm"
              onClick={() => handleSave(false)}
              loading={isSaving}
              className="shrink-0 max-md:h-11"
            >
              {!isSaving && <Save aria-hidden="true" />}
              {isSaving ? 'Enregistrement…' : (
                <span>
                  Enregistrer
                  {isNewSequence && <span className="max-sm:sr-only"> sans activer</span>}
                </span>
              )}
            </Button>
          </div>
        </header>

        {/* Corps */}
        <div className="flex min-h-0 flex-1">
          {/* Colonne de gauche (1 024 px et plus) */}
          <aside className="hidden w-60 shrink-0 flex-col overflow-y-auto border-r border-border bg-muted/20 p-4 lg:flex">
            {mode === 'wizard' ? (
              <SequenceWizardStepper
                currentStep={wizardStep}
                onStepChange={setWizardStep}
                completedSteps={completedSteps}
                validationErrors={wizardValidationErrors}
              />
            ) : (
              <>
                <h3 className="eyebrow mb-3">Liste de contrôle</h3>
                <SequenceValidationChecklist sequence={sequence} />
              </>
            )}
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* Sous 1 024 px : étapes de l'assistant en ligne et liste de contrôle toujours atteignable (revue design D-39) */}
            <div className="flex shrink-0 items-center justify-between gap-2 border-b border-border px-2 py-1 sm:px-5 lg:hidden">
              {mode === 'wizard' && (
                <SequenceWizardStepperCompact
                  currentStep={wizardStep}
                  onStepChange={setWizardStep}
                  completedSteps={completedSteps}
                  validationErrors={wizardValidationErrors}
                  className="min-w-0"
                />
              )}
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn('shrink-0 gap-1.5 px-2 max-md:h-11 max-md:min-w-11', mode === 'expert' && '-ml-1')}
                  >
                    <ListChecks aria-hidden="true" />
                    {/* En mode guidé sur téléphone, seule l'icône d'état reste visible : la ligne est prise par les étapes. */}
                    <span className={mode === 'wizard' ? 'sr-only' : 'text-foreground'}>Liste de contrôle : </span>
                    <SequenceValidationSummary sequence={sequence} labelClassName={mode === 'wizard' ? 'max-sm:sr-only' : undefined} />
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
                  <h3 className="eyebrow mb-3">Liste de contrôle</h3>
                  <SequenceValidationChecklist sequence={sequence} />
                </PopoverContent>
              </Popover>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mx-auto max-w-3xl p-4 sm:p-8">
                {mode === 'wizard' ? (
                  <div key={wizardStep} className="duration-150 animate-in fade-in-0">
                    {renderWizardContent()}
                  </div>
                ) : (
                  /* Mode expert : tout sur une seule page */
                  <div className="space-y-10">
                    {validationErrorsBlock}
                    {nameFields('expert', "L'objectif de cette séquence")}
                    {stopConditions}
                    {multiSender}

                    {sequence.steps.length === 0 && !initialSequence && (
                      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-dashed border-border bg-muted/20 p-5">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-foreground-secondary">
                          <Workflow className="h-5 w-5" aria-hidden="true" />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium text-foreground">Séquence recommandée</p>
                          <p className="mt-0.5 text-xs text-muted-foreground">Visite du profil, vérification de la connexion, puis messages et relances.</p>
                        </div>
                        <Button type="button" size="sm" variant="outline" onClick={loadRecommendedSequence} className="max-md:h-11">
                          Charger la séquence
                        </Button>
                      </div>
                    )}

                    {renderStepsTabs(true)}
                  </div>
                )}
              </div>
            </div>

            {/* Navigation de l'assistant */}
            {mode === 'wizard' && (
              <footer className="flex h-16 shrink-0 items-center justify-between gap-3 border-t border-border px-4 sm:px-8">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={goPrevWizardStep}
                  disabled={wizardStep === 'info'}
                  className="text-muted-foreground max-md:h-11"
                >
                  <ArrowLeft aria-hidden="true" />
                  Précédent
                </Button>
                <p className="text-xs text-muted-foreground max-sm:hidden">
                  Étape {currentWizardIndex + 1} sur {WIZARD_ORDER.length} · {WIZARD_STEPS[currentWizardIndex]?.label}
                </p>
                {wizardStep === 'review' ? (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => handleSave(isNewSequence && canActivate)}
                    loading={isSaving}
                    className="max-md:h-11"
                  >
                    {!isSaving && <CheckCircle aria-hidden="true" />}
                    {isSaving ? 'Enregistrement…' : finalLabel}
                  </Button>
                ) : (
                  <Button type="button" variant="primary" size="sm" onClick={goNextWizardStep} className="max-md:h-11">
                    Suivant
                    <ArrowRight aria-hidden="true" />
                  </Button>
                )}
              </footer>
            )}
          </div>
        </div>

        {/* Quitter sans enregistrer ? (revue design D-31) */}
        <AlertDialog open={confirmLeave !== null} onOpenChange={(open) => { if (!open) setConfirmLeave(null); }}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Quitter sans enregistrer ?</AlertDialogTitle>
              <AlertDialogDescription>
                {confirmLeave === 'draft-lost'
                  ? 'Ce navigateur ne peut pas conserver votre brouillon : votre saisie sera perdue.'
                  : `Vos modifications${sequence.name.trim() ? ` de « ${sequence.name.trim()} »` : ''} seront perdues.`}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>Continuer la modification</AlertDialogCancel>
              <AlertDialogAction
                className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                onClick={() => {
                  setConfirmLeave(null);
                  onClose();
                }}
              >
                Quitter sans enregistrer
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </DialogContent>
    </Dialog>
  );
});

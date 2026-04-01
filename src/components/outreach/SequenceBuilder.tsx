import React, { useState, useMemo, useRef, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { getConditionsForActionType, isEmailStep, isWhatsAppStep, isLinkedInStep, isCrossChannelCondition, ALL_CONDITION_TYPES } from './sequence/conditionTypes';
import { VariableInserter } from './sequence/VariableInserter';
import { useEmailSignatures } from '@/hooks/useEmailSignatures';
import { 
  Plus, 
  Trash2, 
  Mail,
  UserPlus,
  Eye,
  MessageSquare,
  Clock,
  Sparkles,
  Save,
  GripVertical,
  GitBranch,
  Timer,
  X,
  Zap,
  List,
  Workflow,
  FlaskConical,
  Copy,
  ArrowLeft,
  ArrowRight,
  CheckCircle,
  Shield,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { VisualSequenceEditor } from './sequence/VisualSequenceEditor';
import { StopConditionsSettings } from './sequence/StopConditionsSettings';
import { MultiSenderSettings } from './sequence/MultiSenderSettings';
import { SequenceWizardStepper, WizardStep, WIZARD_STEPS } from './sequence/SequenceWizardStepper';
import { SequenceValidationChecklist } from './sequence/SequenceValidationChecklist';
import type { StopConditions as StopConditionsType } from './sequence/StopConditionsSettings';
import type { SenderAccount } from './sequence/MultiSenderSettings';
import { motion, AnimatePresence } from 'framer-motion';

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
}

// ACTIONS = ce qu'on FAIT
const ACTIONS = [
  { value: 'connection_request', label: 'Invitation LinkedIn', icon: UserPlus, color: 'bg-muted text-foreground', description: 'Envoyer une demande de connexion', requiresPrevious: [], excludeIfPrevious: ['connection_request'], requiresConnection: false },
  { value: 'inmail', label: 'InMail', icon: Mail, color: 'bg-muted text-foreground', description: 'Envoyer un InMail (payant)', requiresPrevious: [], excludeIfPrevious: [], requiresConnection: false },
  { value: 'email', label: 'Email', icon: Mail, color: 'bg-muted text-foreground', description: 'Envoyer un email', requiresPrevious: [], excludeIfPrevious: [], requiresConnection: false },
  { value: 'profile_visit', label: 'Visite de profil', icon: Eye, color: 'bg-muted text-foreground', description: 'Visiter le profil du prospect', requiresPrevious: [], excludeIfPrevious: [], requiresConnection: false },
  { value: 'message', label: 'Message direct', icon: MessageSquare, color: 'bg-muted text-foreground', description: 'Envoyer un message (si connecté)', requiresPrevious: ['wait_connection'], excludeIfPrevious: [], requiresConnection: true },
  { value: 'smart_message', label: 'Smart Message (IA)', icon: Sparkles, color: 'bg-foreground text-background', description: 'Message personnalisé par IA', requiresPrevious: ['wait_connection'], excludeIfPrevious: [], requiresConnection: true },
  { value: 'whatsapp_message', label: 'WhatsApp', icon: MessageSquare, color: 'bg-emerald-100 text-emerald-800', description: 'Envoyer un message WhatsApp', requiresPrevious: [], excludeIfPrevious: [], requiresConnection: false },
];

// TRIGGERS = ce qu'on ATTEND
const TRIGGERS = [
  { value: 'check_connection', label: 'Vérifier connexion', icon: GitBranch, color: 'bg-muted text-foreground', description: 'Route selon le degré', requiresPrevious: [], excludeIfPrevious: [] },
  { value: 'wait_connection', label: 'Attendre connexion', icon: Timer, color: 'bg-brutal-accent/30 text-foreground', description: 'Pause jusqu\'à acceptation', waitEvent: 'connection_accepted', requiresPrevious: ['connection_request'], excludeIfPrevious: ['wait_connection'] },
  { value: 'wait_reply', label: 'Attendre réponse', icon: MessageSquare, color: 'bg-brutal-accent/30 text-foreground', description: 'Pause jusqu\'à réponse', waitEvent: 'reply_received', requiresPrevious: ['inmail', 'email', 'message', 'smart_message', 'whatsapp_message'], excludeIfPrevious: [] },
  { value: 'wait_profile_visit', label: 'Attendre visite retour', icon: Eye, color: 'bg-brutal-accent/30 text-foreground', description: 'Pause si visite profil', waitEvent: 'profile_visited', requiresPrevious: ['profile_visit'], excludeIfPrevious: [] },
];

const ALL_STEP_TYPES = [...ACTIONS, ...TRIGGERS];

const TIMEOUT_ACTIONS = [
  { value: 'skip', label: 'Passer à l\'étape suivante' },
  { value: 'alternative_step', label: 'Exécuter étape alternative' },
  { value: 'end_sequence', label: 'Terminer la séquence' },
];

const getAvailableStepTypes = (previousSteps: SequenceStep[]) => {
  const previousTypes = previousSteps.map(s => s.actionType);

  const availableActions = ACTIONS.filter(action => {
    if (action.excludeIfPrevious.some(ex => previousTypes.includes(ex as SequenceStep['actionType']))) return false;
    if (action.requiresConnection && !previousTypes.includes('wait_connection')) return false;
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

const AI_TONES = [
  { value: 'professional', label: 'Professionnel' },
  { value: 'casual', label: 'Décontracté' },
  { value: 'enthusiastic', label: 'Enthousiaste' },
];

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

export const SequenceBuilder: React.FC<SequenceBuilderProps> = React.memo(({
  isOpen,
  onClose,
  onSave,
  initialSequence,
}) => {
  const isEditing = !!initialSequence;
  const [sequence, setSequence] = useState<Sequence>(
    initialSequence || {
      name: '',
      description: '',
      steps: [],
      isActive: true,
    }
  );
  const [isSaving, setIsSaving] = useState(false);
  const [expandedStepId, setExpandedStepId] = useState<string | null>(
    initialSequence?.steps[0]?.id || null
  );
  const [showStepPicker, setShowStepPicker] = useState(!initialSequence || initialSequence.steps.length === 0);
  const [validationErrors, setValidationErrors] = useState<string[]>([]);
  const { signatures } = useEmailSignatures();
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);

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
      existing.push(`${emptyMessages.length} message(s) vide(s)`);
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

  const handleSave = async () => {
    if (!sequence.name.trim() || sequence.steps.length === 0) return;
    
    const errors: string[] = [];
    sequence.steps.forEach(s => {
      const stepLabel = `Étape ${s.order + 1}${s.variantGroup ? ` (${s.variantGroup})` : ''}`;
      if (needsMessage(s.actionType) && !s.useAiPersonalization && !s.messageTemplate?.trim()) {
        errors.push(`${stepLabel}: message requis`);
      }
      if (needsSubject(s.actionType) && !s.useAiPersonalization && !s.subjectTemplate?.trim()) {
        errors.push(`${stepLabel}: un objet est requis pour les steps email`);
      }
      if (s.actionType === 'connection_request' && (s.messageTemplate?.length || 0) > 300) {
        errors.push(`${stepLabel}: note d'invitation trop longue (max 300 caractères)`);
      }
      if (s.conditionType === 'if_score_above' && !s.conditionValue?.trim()) {
        errors.push(`${stepLabel}: le seuil de score est requis`);
      }
    });
    
    if (errors.length > 0) {
      setValidationErrors(errors);
      if (mode === 'wizard') setWizardStep('review');
      return;
    }
    
    setIsSaving(true);
    try {
      await onSave(sequence);
      onClose();
    } finally {
      setIsSaving(false);
    }
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

  // ── Step list renderer (shared between wizard steps view and expert mode) ──
  const renderStepsList = () => (
    <div className="space-y-3">
      {primarySteps.map((step, index) => {
        const isExpanded = expandedStepId === step.id;
        const stepConfig = ALL_STEP_TYPES.find(a => a.value === step.actionType);
        const StepIcon = stepConfig?.icon || Mail;
        const stepIsTrigger = isTrigger(step.actionType);
        const variants = variantGroups.get(step.order) || [];
        const hasVariants = variants.length > 1;

        return (
          <div
            key={step.id}
            className={cn(
              "border border-border rounded-lg transition-all overflow-hidden",
              isExpanded && "bg-muted/20 shadow-sm",
              stepIsTrigger && "border-l-[3px] border-l-amber-400"
            )}
          >
            {/* Step header */}
            <div
              className="flex items-center gap-3 p-3 cursor-pointer"
              onClick={() => setExpandedStepId(isExpanded ? null : step.id)}
            >
              <GripVertical className="w-4 h-4 text-muted-foreground" />
              <div className={cn("w-8 h-8 flex items-center justify-center", stepConfig?.color || "bg-muted")}>
                <StepIcon className="w-4 h-4" />
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-muted">
                    {stepIsTrigger ? 'TRIGGER' : 'ACTION'}
                  </span>
                  <span className="font-medium text-sm">{stepConfig?.label}</span>
                </div>
                <div className="text-xs text-muted-foreground flex items-center gap-2 mt-0.5">
                  {step.delayDays > 0 && (
                    <span className="flex items-center gap-1"><Clock className="w-3 h-3" />Après {step.delayDays}j</span>
                  )}
                  {step.useAiPersonalization && (
                    <span className="flex items-center gap-1 text-foreground"><Sparkles className="w-3 h-3" />IA</span>
                  )}
                  {stepIsTrigger && step.timeoutDays && (
                    <span className="flex items-center gap-1"><Timer className="w-3 h-3" />Timeout {step.timeoutDays}j</span>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {canABTest(step.actionType) && !hasVariants && (
                  <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); addVariant(step); }} className="text-muted-foreground hover:text-foreground" title="Créer un A/B test">
                    <FlaskConical className="w-4 h-4" />
                  </Button>
                )}
                {hasVariants && (
                  <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-5 rounded-none border-foreground/30">
                    <FlaskConical className="w-3 h-3 mr-0.5" />A/B
                  </Badge>
                )}
                <Button variant="ghost" size="sm" onClick={(e) => { e.stopPropagation(); removeStep(step.id); }} disabled={sequence.steps.length <= 1} className="text-muted-foreground hover:text-destructive">
                  <Trash2 className="w-4 h-4" />
                </Button>
              </div>
            </div>

            {/* Step details (expanded) */}
            {isExpanded && (
              <div className="px-4 pb-4 pt-2 border-t space-y-4">
                {/* Delay */}
                {index > 0 && (
                  <div className="grid grid-cols-3 gap-3">
                    <div>
                      <Label>Jours</Label>
                      <Input type="number" min={0} value={step.delayDays} onChange={(e) => updateStep(step.id, { delayDays: parseInt(e.target.value) || 0 })} className="mt-1.5" />
                    </div>
                    <div>
                      <Label>Heures</Label>
                      <Input type="number" min={0} max={23} value={step.delayHours} onChange={(e) => updateStep(step.id, { delayHours: parseInt(e.target.value) || 0 })} className="mt-1.5" />
                    </div>
                    <div>
                      <Label>Minutes</Label>
                      <Input type="number" min={0} max={59} value={step.delayMinutes || 0} onChange={(e) => updateStep(step.id, { delayMinutes: parseInt(e.target.value) || 0 })} className="mt-1.5" />
                    </div>
                  </div>
                )}

                {/* Condition */}
                {isAction(step.actionType) && (
                  <div>
                    <Label>Condition d'exécution</Label>
                    <Select value={step.conditionType} onValueChange={(value) => updateStep(step.id, { conditionType: value as SequenceStep['conditionType'] })}>
                      <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {getConditionsForActionType(step.actionType).map(cond => (
                          <SelectItem key={cond.value} value={cond.value}>{cond.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {isCrossChannelCondition(step.actionType, step.conditionType) && (
                      <p className="text-xs text-amber-600 mt-1">⚠️ Cette condition ne fonctionne qu'avec des steps email</p>
                    )}
                    {step.conditionType === 'if_score_above' && (
                      <div className="mt-2">
                        <Label>Seuil de score (0-100)</Label>
                        <Input type="number" min={0} max={100} value={step.conditionValue || '70'} onChange={(e) => updateStep(step.id, { conditionValue: e.target.value })} placeholder="70" className={cn("mt-1 w-32", !step.conditionValue?.trim() && "border-destructive")} />
                      </div>
                    )}
                  </div>
                )}

                {/* Send hours */}
                <Collapsible>
                  <CollapsibleTrigger className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1">
                    ▸ Fenêtre d'envoi
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 grid grid-cols-2 gap-3">
                    <div>
                      <Label className="text-xs">Heure début</Label>
                      <Input type="number" min={0} max={23} value={step.preferredHourStart} onChange={(e) => updateStep(step.id, { preferredHourStart: parseInt(e.target.value) || 9 })} className="mt-1 h-8 text-xs" />
                    </div>
                    <div>
                      <Label className="text-xs">Heure fin</Label>
                      <Input type="number" min={0} max={23} value={step.preferredHourEnd} onChange={(e) => updateStep(step.id, { preferredHourEnd: parseInt(e.target.value) || 18 })} className="mt-1 h-8 text-xs" />
                    </div>
                  </CollapsibleContent>
                </Collapsible>

                {/* Trigger config */}
                {isTrigger(step.actionType) && step.actionType !== 'check_connection' && (
                  <div className="space-y-3 p-3 bg-muted/20 border border-border rounded-md">
                    <div className="flex items-center gap-2"><Timer className="w-4 h-4 text-muted-foreground" /><span className="font-medium text-sm">Configuration du trigger</span></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label>Timeout (jours)</Label>
                        <Input type="number" min={1} value={step.timeoutDays || 3} onChange={(e) => updateStep(step.id, { timeoutDays: parseInt(e.target.value) || 3 })} className="mt-1.5" />
                      </div>
                      <div>
                        <Label>Si timeout</Label>
                        <Select value={step.timeoutAction || 'skip'} onValueChange={(value) => updateStep(step.id, { timeoutAction: value as SequenceStep['timeoutAction'] })}>
                          <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
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
                        <Label>Step alternatif</Label>
                        <Select value={step.timeoutBranchStepId || '__none__'} onValueChange={(value) => updateStep(step.id, { timeoutBranchStepId: value === '__none__' ? undefined : value })}>
                          <SelectTrigger className="mt-1.5"><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Sélectionner...</SelectItem>
                            {sequence.steps.filter(s => s.id !== step.id).map(s => {
                              const sc = ALL_STEP_TYPES.find(a => a.value === s.actionType);
                              return <SelectItem key={s.id} value={s.id}>Step {s.order + 1} — {sc?.label || s.actionType}</SelectItem>;
                            })}
                          </SelectContent>
                        </Select>
                      </div>
                    )}
                  </div>
                )}

                {/* Check connection */}
                {step.actionType === 'check_connection' && (
                  <div className="space-y-4 p-3 bg-muted/20 border border-border rounded-md">
                    <div className="flex items-center gap-2"><GitBranch className="w-4 h-4 text-muted-foreground" /><span className="font-medium text-sm">Vérification du degré</span></div>
                    <div>
                      <Label>Si connecté (1er degré) → aller à</Label>
                      <Select value={step.ifTrueGotoStep || '__next__'} onValueChange={(value) => updateStep(step.id, { ifTrueGotoStep: value === '__next__' ? undefined : value })}>
                        <SelectTrigger className="mt-1.5"><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__next__">Étape suivante</SelectItem>
                          {sequence.steps.filter(s => s.order > step.order).map(s => {
                            const sc = ALL_STEP_TYPES.find(a => a.value === s.actionType);
                            return <SelectItem key={s.id} value={s.id}>Étape {s.order + 1}: {sc?.label}</SelectItem>;
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label>Si non connecté → aller à</Label>
                      <Select value={step.ifFalseGotoStep || '__next__'} onValueChange={(value) => updateStep(step.id, { ifFalseGotoStep: value === '__next__' ? undefined : value })}>
                        <SelectTrigger className="mt-1.5"><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__next__">Étape suivante</SelectItem>
                          {sequence.steps.filter(s => s.order > step.order).map(s => {
                            const sc = ALL_STEP_TYPES.find(a => a.value === s.actionType);
                            return <SelectItem key={s.id} value={s.id}>Étape {s.order + 1}: {sc?.label}</SelectItem>;
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}

                {/* Message fields */}
                {needsMessage(step.actionType) && (
                  <>
                    {hasVariants && (
                      <div className="border border-foreground/20 bg-muted/20">
                        <div className="flex items-center justify-between px-3 py-2 border-b border-foreground/10">
                          <div className="flex items-center gap-2">
                            <FlaskConical className="w-3.5 h-3.5" />
                            <span className="text-xs font-bold uppercase tracking-wider">A/B Test</span>
                          </div>
                          {variants.length < 3 && (
                            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => addVariant(step)}>
                              <Copy className="w-3 h-3 mr-1" />+ Variante
                            </Button>
                          )}
                        </div>
                        <Tabs defaultValue={step.id} className="w-full">
                          <TabsList className="w-full rounded-none h-8 bg-muted/50">
                            {variants.sort((a, b) => (a.variantGroup || '').localeCompare(b.variantGroup || '')).map(v => (
                              <TabsTrigger key={v.id} value={v.id} className="flex-1 h-6 text-xs rounded-none">
                                Variante {v.variantGroup}<span className="ml-1 text-muted-foreground">({v.variantWeight || 0}%)</span>
                              </TabsTrigger>
                            ))}
                          </TabsList>
                          {variants.map(v => (
                            <TabsContent key={v.id} value={v.id} className="p-3 space-y-3 mt-0">
                              <div className="flex items-center gap-3">
                                <Label className="text-xs whitespace-nowrap">Poids (%)</Label>
                                <Input type="number" min={1} max={100} value={v.variantWeight || 50} onChange={(e) => updateStep(v.id, { variantWeight: parseInt(e.target.value) || 50 })} className="w-20 h-7 text-xs" />
                                {v.variantGroup !== 'A' && (
                                  <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground hover:text-destructive ml-auto" onClick={() => removeVariant(v)}>
                                    <Trash2 className="w-3 h-3" />
                                  </Button>
                                )}
                              </div>
                              <div className="flex items-center justify-between p-2 bg-muted/50 border border-foreground/10">
                                <div className="flex items-center gap-2"><Sparkles className="w-3.5 h-3.5" /><span className="text-xs font-medium">IA</span></div>
                                <Switch checked={v.useAiPersonalization} onCheckedChange={(checked) => updateStep(v.id, { useAiPersonalization: checked })} />
                              </div>
                              {!v.useAiPersonalization && (
                                <>
                                  {needsSubject(v.actionType) && (
                                    <div>
                                      <Label className="text-xs">Objet</Label>
                                      <Input value={v.subjectTemplate || ''} onChange={(e) => updateStep(v.id, { subjectTemplate: e.target.value })} placeholder="Objet" className="mt-1 h-8 text-xs" />
                                    </div>
                                  )}
                                  <div>
                                    <Label className="text-xs">Message</Label>
                                    <Textarea value={v.messageTemplate || ''} onChange={(e) => updateStep(v.id, { messageTemplate: e.target.value })} placeholder="Bonjour {{firstName}}, ..." rows={2} className="mt-1 text-xs" />
                                  </div>
                                </>
                              )}
                            </TabsContent>
                          ))}
                          {(() => {
                            const totalWeight = variants.reduce((sum, v) => sum + (v.variantWeight || 0), 0);
                            return (
                              <div className={cn("text-xs font-medium px-3 py-1.5 border-t border-foreground/10", totalWeight === 100 ? "text-green-600" : "text-destructive")}>
                                Total : {totalWeight}%{totalWeight !== 100 && " — doit être 100%"}
                              </div>
                            );
                          })()}
                        </Tabs>
                      </div>
                    )}

                    {!hasVariants && (
                      <>
                        {isWhatsAppStep(step.actionType) && (
                          <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded">
                            📱 Message WhatsApp. Les candidats sans numéro seront skippés.
                          </div>
                        )}
                        <div className="flex items-center justify-between p-3 bg-muted/30 border border-border rounded-md">
                          <div className="flex items-center gap-2"><Sparkles className="w-4 h-4" /><span className="text-sm font-medium">Personnalisation IA</span></div>
                          <Switch checked={step.useAiPersonalization} onCheckedChange={(checked) => updateStep(step.id, { useAiPersonalization: checked })} />
                        </div>

                        {step.useAiPersonalization ? (
                          <div>
                            <Label>Ton du message</Label>
                            <Select value={step.aiTone || 'professional'} onValueChange={(value) => updateStep(step.id, { aiTone: value as SequenceStep['aiTone'] })}>
                              <SelectTrigger className="mt-1.5"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {AI_TONES.map(tone => <SelectItem key={tone.value} value={tone.value}>{tone.label}</SelectItem>)}
                              </SelectContent>
                            </Select>
                            <p className="text-xs text-muted-foreground mt-2">L'IA générera un message personnalisé basé sur le profil LinkedIn et le brief.</p>
                          </div>
                        ) : (
                          <>
                            {needsSubject(step.actionType) && (
                              <div>
                                <div className="flex items-center justify-between">
                                  <Label>Objet</Label>
                                   <VariableInserter targetRef={subjectRef} currentValue={step.subjectTemplate || ''} onInsert={(val) => updateStep(step.id, { subjectTemplate: val })} showEmailVariables={step.actionType === 'email'} />
                                </div>
                                <Input ref={subjectRef} value={step.subjectTemplate || ''} onChange={(e) => updateStep(step.id, { subjectTemplate: e.target.value })} placeholder={step.actionType === 'email' ? "Objet de l'email" : "Objet de l'InMail"} className={cn("mt-1.5", needsSubject(step.actionType) && !step.subjectTemplate?.trim() && "border-destructive")} />
                                {needsSubject(step.actionType) && !step.subjectTemplate?.trim() && <p className="text-xs text-destructive mt-0.5">Objet requis</p>}
                              </div>
                            )}
                            <div>
                              <div className="flex items-center justify-between">
                                <Label>Message</Label>
                                <div className="flex items-center gap-2">
                                  <VariableInserter targetRef={messageRef} currentValue={step.messageTemplate || ''} onInsert={(val) => updateStep(step.id, { messageTemplate: val })} showEmailVariables={step.actionType === 'email'} />
                                  {step.actionType === 'connection_request' && (
                                    <span className={cn("text-xs", (step.messageTemplate?.length || 0) > 300 ? "text-destructive font-medium" : "text-muted-foreground")}>
                                      {step.messageTemplate?.length || 0}/300
                                    </span>
                                  )}
                                </div>
                              </div>
                              <Textarea ref={messageRef} value={step.messageTemplate || ''} onChange={(e) => updateStep(step.id, { messageTemplate: e.target.value })} placeholder={step.actionType === 'connection_request' ? "Note d'invitation (max 300 car.)" : "Bonjour {{first_name}}, ..."} rows={step.actionType === 'connection_request' ? 2 : 3} maxLength={step.actionType === 'connection_request' ? 300 : undefined} className={cn("mt-1.5", step.actionType === 'connection_request' && (step.messageTemplate?.length || 0) > 300 && "border-destructive")} />
                            </div>
                          </>
                        )}

                        {step.actionType === 'email' && !step.useAiPersonalization && (
                          <div className="space-y-3 pt-2 border-t border-foreground/10">
                            <Collapsible>
                              <CollapsibleTrigger className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1">▸ CC / BCC</CollapsibleTrigger>
                              <CollapsibleContent className="space-y-2 pt-2">
                                <div>
                                  <Label className="text-xs">CC</Label>
                                  <Input value={(step.ccEmails || []).join(', ')} onChange={(e) => updateStep(step.id, { ccEmails: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="email1@ex.com" className="mt-1 h-8 text-xs" />
                                </div>
                                <div>
                                  <Label className="text-xs">BCC</Label>
                                  <Input value={(step.bccEmails || []).join(', ')} onChange={(e) => updateStep(step.id, { bccEmails: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="email@ex.com" className="mt-1 h-8 text-xs" />
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
                            <div className="flex items-center justify-between">
                              <Label className="text-xs">Lien de désinscription</Label>
                              <Switch checked={step.includeUnsubscribe ?? false} onCheckedChange={(checked) => updateStep(step.id, { includeUnsubscribe: checked })} />
                            </div>
                            <div>
                              <Label className="text-xs">Signature</Label>
                              <Select value={step.signatureId || '__none__'} onValueChange={(value) => updateStep(step.id, { signatureId: value === '__none__' ? undefined : value })}>
                                <SelectTrigger className="mt-1"><SelectValue placeholder="Aucune" /></SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__none__">Aucune</SelectItem>
                                  {signatures.map(sig => <SelectItem key={sig.id} value={sig.id}>{sig.name}{sig.is_default ? ' ⭐' : ''}</SelectItem>)}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        )}
                      </>
                    )}
                  </>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Step picker */}
      {(showStepPicker || sequence.steps.length === 0) && (() => {
        const { availableActions, availableTriggers } = getAvailableStepTypes(sequence.steps);
        const hasNoOptions = availableActions.length === 0 && availableTriggers.length === 0;
        return (
          <div className={cn("mt-4 p-5 border-2 border-dashed rounded-lg", sequence.steps.length === 0 ? "border-foreground/20 bg-muted/20" : "border-border bg-muted/10")}>
            <div className="flex items-center justify-between mb-4">
              <span className="font-medium text-sm">{sequence.steps.length === 0 ? 'Commencer par ajouter une étape' : 'Ajouter une étape'}</span>
              {sequence.steps.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setShowStepPicker(false)}><X className="w-4 h-4" /></Button>
              )}
            </div>
            {hasNoOptions ? (
              <div className="text-center py-4 text-muted-foreground text-sm">Séquence complète !</div>
            ) : (
              <>
                {availableActions.length > 0 && (
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2"><Zap className="w-4 h-4" /><span className="text-xs font-semibold uppercase text-muted-foreground">Actions</span></div>
                    <div className="grid grid-cols-2 gap-2">
                      {availableActions.map(action => (
                        <button key={action.value} onClick={() => addStep(action.value)} className="flex items-center gap-2 p-3 border border-border rounded-lg hover:border-foreground/30 hover:bg-muted/30 transition-all text-left group">
                          <div className={cn("w-8 h-8 flex items-center justify-center shrink-0", action.color)}><action.icon className="w-4 h-4" /></div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{action.label}</div>
                            <div className="text-xs text-muted-foreground truncate">{action.description}</div>
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
                {availableTriggers.length > 0 && (
                  <div>
                    <div className="flex items-center gap-2 mb-2"><Timer className="w-4 h-4" /><span className="text-xs font-semibold uppercase text-muted-foreground">Triggers</span></div>
                    <div className="grid grid-cols-2 gap-2">
                      {availableTriggers.map(trigger => (
                        <button key={trigger.value} onClick={() => addStep(trigger.value)} className="flex items-center gap-2 p-3 border border-border rounded-lg hover:border-foreground/30 hover:bg-muted/30 transition-all text-left group">
                          <div className={cn("w-8 h-8 flex items-center justify-center shrink-0", trigger.color)}><trigger.icon className="w-4 h-4" /></div>
                          <div className="flex-1 min-w-0">
                            <div className="font-medium text-sm truncate">{trigger.label}</div>
                            <div className="text-xs text-muted-foreground truncate">{trigger.description}</div>
                          </div>
                        </button>
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
        <Button variant="outline" onClick={() => setShowStepPicker(true)} className="w-full mt-3 border-dashed">
          <Plus className="w-4 h-4 mr-2" />Ajouter une étape
        </Button>
      )}
    </div>
  );

  // ── Wizard content per step ──
  const renderWizardContent = () => {
    switch (wizardStep) {
      case 'info':
        return (
          <div className="space-y-8 max-w-lg">
            <div>
              <h2 className="text-xl font-semibold mb-1">Informations</h2>
              <p className="text-sm text-muted-foreground">Nommez votre séquence et décrivez son objectif.</p>
            </div>
            <div className="space-y-5">
              <div>
                <Label htmlFor="wiz-name">Nom de la séquence *</Label>
                <Input id="wiz-name" value={sequence.name} onChange={(e) => setSequence(prev => ({ ...prev, name: e.target.value }))} placeholder="Ex: Prospection développeurs React" className="mt-1.5" />
              </div>
              <div>
                <Label htmlFor="wiz-desc">Description (optionnel)</Label>
                <Input id="wiz-desc" value={sequence.description || ''} onChange={(e) => setSequence(prev => ({ ...prev, description: e.target.value }))} placeholder="Décrivez l'objectif de cette séquence" className="mt-1.5" />
              </div>
            </div>
          </div>
        );

      case 'senders':
        return (
          <div className="space-y-8 max-w-2xl">
            <div>
              <h2 className="text-xl font-semibold mb-1">Expéditeurs</h2>
              <p className="text-sm text-muted-foreground">Configurez qui envoie les messages. Activez le multi-sender pour répartir la charge.</p>
            </div>
            <MultiSenderSettings
              enabled={sequence.multiSenderEnabled || false}
              onEnabledChange={(multiSenderEnabled) => setSequence(prev => ({ ...prev, multiSenderEnabled }))}
              senderAccounts={sequence.senderAccounts || []}
              onSenderAccountsChange={(senderAccounts) => setSequence(prev => ({ ...prev, senderAccounts }))}
              rotationMode={sequence.rotationMode || 'round_robin'}
              onRotationModeChange={(rotationMode) => setSequence(prev => ({ ...prev, rotationMode }))}
            />
          </div>
        );

      case 'steps':
        return (
          <div className="space-y-8">
            <div className="flex items-center justify-between">
              <div>
                <h2 className="text-xl font-semibold mb-1">Étapes de la séquence</h2>
                <p className="text-sm text-muted-foreground">{sequence.steps.length} étape(s) configurée(s)</p>
              </div>
              {/* Template button */}
              {sequence.steps.length === 0 && (
                <Button
                  variant="outline"
                  onClick={() => {
                    const steps = generateRecommendedSequence();
                    setSequence(prev => ({ ...prev, steps }));
                    setShowStepPicker(false);
                    setExpandedStepId(steps[0]?.id || null);
                  }}
                  className="border-foreground"
                >
                  <Sparkles className="w-4 h-4 mr-2" />
                  Charger séquence recommandée
                </Button>
              )}
            </div>

            <Tabs defaultValue="list" className="w-full">
              <div className="flex justify-end mb-3">
                <TabsList className="h-8">
                  <TabsTrigger value="list" className="h-6 px-2 text-xs"><List className="w-3 h-3 mr-1" />Liste</TabsTrigger>
                  <TabsTrigger value="visual" className="h-6 px-2 text-xs"><Workflow className="w-3 h-3 mr-1" />Visuel</TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="visual" className="mt-0">
                <VisualSequenceEditor steps={sequence.steps} onStepsChange={(newSteps) => setSequence(prev => ({ ...prev, steps: newSteps }))} />
              </TabsContent>
              <TabsContent value="list" className="mt-0">
                {renderStepsList()}
              </TabsContent>
            </Tabs>
          </div>
        );

      case 'guardrails':
        return (
          <div className="space-y-8 max-w-2xl">
            <div>
              <h2 className="text-xl font-semibold mb-1">Garde-fous</h2>
              <p className="text-sm text-muted-foreground">Définissez quand arrêter la séquence et protégez vos comptes.</p>
            </div>
            <StopConditionsSettings
              value={sequence.stopConditions || { on_reply: true, on_click: false, on_unsubscribe: true, on_meeting_booked: false }}
              onChange={(stopConditions) => setSequence(prev => ({ ...prev, stopConditions }))}
            />
            {/* Daily limit warnings */}
            {sequence.multiSenderEnabled && sequence.senderAccounts && sequence.senderAccounts.some(s => s.daily_limit > 80) && (
              <div className="p-3 border border-amber-500/30 bg-amber-50 text-amber-800 text-xs">
                <div className="flex items-center gap-2 font-medium mb-1"><Shield className="w-3.5 h-3.5" />Limites élevées détectées</div>
                <p>Un ou plusieurs senders ont une limite quotidienne &gt; 80. Cela peut compromettre la sécurité de vos comptes LinkedIn. Nous recommandons 30-50 actions/jour pour les comptes récents, 50-80 pour les comptes établis.</p>
              </div>
            )}
            {/* Channel alerts */}
            {(() => {
              const hasEmail = sequence.steps.some(s => s.actionType === 'email');
              const hasWhatsapp = sequence.steps.some(s => s.actionType === 'whatsapp_message');
              if (!hasEmail && !hasWhatsapp) return null;
              return (
                <div className="p-3 border border-foreground/20 bg-muted/30 text-xs space-y-2">
                  <div className="flex items-center gap-2 font-medium"><Mail className="w-3.5 h-3.5" />Alertes canal</div>
                  {hasEmail && <p>📧 Cette séquence utilise des étapes <strong>Email</strong>. Les candidats sans adresse email seront automatiquement skippés.</p>}
                  {hasWhatsapp && <p>📱 Cette séquence utilise des étapes <strong>WhatsApp</strong>. Les candidats sans numéro de téléphone seront automatiquement skippés.</p>}
                </div>
              );
            })()}
          </div>
        );

      case 'review':
        return (
          <div className="space-y-8 max-w-2xl">
            <div>
              <h2 className="text-xl font-semibold mb-1">Vérification</h2>
              <p className="text-sm text-muted-foreground">Vérifiez que tout est prêt avant d'activer la séquence.</p>
            </div>

            {/* Summary card */}
            <div className="border border-border rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold uppercase">{sequence.name || '(Sans nom)'}</span>
                <Badge variant="outline" className="rounded-none">{sequence.steps.length} étapes</Badge>
              </div>
              {sequence.description && <p className="text-xs text-muted-foreground">{sequence.description}</p>}

              {/* Visual flow preview */}
              <div className="border border-foreground/10 p-3 bg-muted/20">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Aperçu du flux</div>
                <div className="flex flex-wrap items-center gap-1">
                  {sequence.steps.slice(0, 20).map((step, i) => {
                    const sc = ALL_STEP_TYPES.find(a => a.value === step.actionType);
                    const Icon = sc?.icon || Mail;
                    return (
                      <React.Fragment key={step.id}>
                        {i > 0 && <ArrowRight className="w-3 h-3 text-muted-foreground/50" />}
                        <div className={cn("w-6 h-6 flex items-center justify-center shrink-0", sc?.color || "bg-muted")} title={sc?.label}>
                          <Icon className="w-3 h-3" />
                        </div>
                      </React.Fragment>
                    );
                  })}
                  {sequence.steps.length > 20 && <span className="text-xs text-muted-foreground">+{sequence.steps.length - 20}</span>}
                </div>
              </div>
            </div>

            {/* Validation checklist */}
            <SequenceValidationChecklist sequence={sequence} />

            {/* Validation errors */}
            {validationErrors.length > 0 && (
              <div className="space-y-1 p-3 border border-destructive/30 bg-destructive/5">
                {validationErrors.map((err, i) => (
                  <p key={i} className="text-xs text-destructive">❌ {err}</p>
                ))}
              </div>
            )}
          </div>
        );
    }
  };

  // ── Full-screen portal ──
  const content = (
    <div className="fixed inset-0 z-[4000] bg-background flex flex-col">
      {/* Top bar — clean, minimal */}
      <div className="h-14 border-b border-border/60 flex items-center justify-between px-5 shrink-0 bg-background">
        <div className="flex items-center gap-4">
          <button
            onClick={onClose}
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">Retour</span>
          </button>
          <div className="w-px h-6 bg-border" />
          <div className="flex items-center gap-2">
            <span className="text-sm font-semibold">
              {isEditing ? 'Modifier la séquence' : 'Nouvelle séquence'}
            </span>
            {sequence.name && (
              <>
                <span className="text-muted-foreground/40">—</span>
                <span className="text-sm text-muted-foreground truncate max-w-[200px]">{sequence.name}</span>
              </>
            )}
          </div>
        </div>
        <div className="flex items-center gap-3">
          {/* Mode toggle — pill style */}
          <div className="flex items-center bg-muted rounded-full p-0.5">
            <button
              onClick={() => setMode('wizard')}
              className={cn(
                "px-3 py-1 text-[11px] font-medium rounded-full transition-all",
                mode === 'wizard'
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Guidé
            </button>
            <button
              onClick={() => setMode('expert')}
              className={cn(
                "px-3 py-1 text-[11px] font-medium rounded-full transition-all",
                mode === 'expert'
                  ? "bg-background text-foreground shadow-sm"
                  : "text-muted-foreground hover:text-foreground"
              )}
            >
              Expert
            </button>
          </div>
          <Button
            onClick={handleSave}
            disabled={isSaving || !sequence.name.trim() || sequence.steps.length === 0}
            size="sm"
            className="h-8 px-4 text-xs gap-1.5"
          >
            {isSaving ? 'Enregistrement...' : <><Save className="w-3.5 h-3.5" />Enregistrer</>}
          </Button>
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left sidebar */}
        <div className="w-56 border-r border-border/40 bg-muted/20 shrink-0 flex-col overflow-y-auto hidden lg:flex">
          <div className="p-4">
            {mode === 'wizard' ? (
              <SequenceWizardStepper
                currentStep={wizardStep}
                onStepChange={setWizardStep}
                completedSteps={completedSteps}
                validationErrors={wizardValidationErrors}
              />
            ) : (
              <>
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60 mb-3">
                  Validation
                </div>
                <SequenceValidationChecklist sequence={sequence} />
              </>
            )}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto bg-background">
          <div className="p-8 max-w-3xl mx-auto">
            {mode === 'wizard' ? (
              <AnimatePresence mode="wait">
                <motion.div
                  key={wizardStep}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                >
                  {renderWizardContent()}
                </motion.div>
              </AnimatePresence>
            ) : (
              /* Expert mode: everything in one scrollable view */
              <div className="space-y-10">
                <div className="space-y-4">
                  <div>
                    <Label htmlFor="name">Nom de la séquence *</Label>
                    <Input id="name" value={sequence.name} onChange={(e) => setSequence(prev => ({ ...prev, name: e.target.value }))} placeholder="Ex: Prospection développeurs React" className="mt-1.5" />
                  </div>
                  <div>
                    <Label htmlFor="description">Description (optionnel)</Label>
                    <Input id="description" value={sequence.description || ''} onChange={(e) => setSequence(prev => ({ ...prev, description: e.target.value }))} placeholder="Décrivez l'objectif" className="mt-1.5" />
                  </div>
                </div>

                <StopConditionsSettings
                  value={sequence.stopConditions || { on_reply: true, on_click: false, on_unsubscribe: true, on_meeting_booked: false }}
                  onChange={(stopConditions) => setSequence(prev => ({ ...prev, stopConditions }))}
                />

                <MultiSenderSettings
                  enabled={sequence.multiSenderEnabled || false}
                  onEnabledChange={(multiSenderEnabled) => setSequence(prev => ({ ...prev, multiSenderEnabled }))}
                  senderAccounts={sequence.senderAccounts || []}
                  onSenderAccountsChange={(senderAccounts) => setSequence(prev => ({ ...prev, senderAccounts }))}
                  rotationMode={sequence.rotationMode || 'round_robin'}
                  onRotationModeChange={(rotationMode) => setSequence(prev => ({ ...prev, rotationMode }))}
                />

                {/* Template */}
                {sequence.steps.length === 0 && !initialSequence && (
                  <div className="p-5 border border-dashed border-border bg-muted/20 flex items-center gap-4">
                    <div className="w-10 h-10 bg-foreground text-background flex items-center justify-center rounded-lg shrink-0">
                      <Sparkles className="w-5 h-5" />
                    </div>
                    <div className="flex-1">
                      <p className="font-medium text-sm">Séquence recommandée</p>
                      <p className="text-xs text-muted-foreground mt-0.5">Visite → Vérification → Messages + relances</p>
                    </div>
                    <Button size="sm" variant="outline" onClick={() => { const steps = generateRecommendedSequence(); setSequence(prev => ({ ...prev, steps })); setShowStepPicker(false); setExpandedStepId(steps[0]?.id || null); }}>
                      Charger
                    </Button>
                  </div>
                )}

                <Tabs defaultValue="list" className="w-full">
                  <div className="flex items-center justify-between mb-4">
                    <div>
                      <Label className="text-base font-semibold">Étapes</Label>
                      <p className="text-xs text-muted-foreground mt-0.5">{sequence.steps.length} étape(s) configurée(s)</p>
                    </div>
                    <TabsList className="h-8">
                      <TabsTrigger value="list" className="h-6 px-2 text-xs gap-1"><List className="w-3 h-3" />Liste</TabsTrigger>
                      <TabsTrigger value="visual" className="h-6 px-2 text-xs gap-1"><Workflow className="w-3 h-3" />Visuel</TabsTrigger>
                    </TabsList>
                  </div>
                  <TabsContent value="visual" className="mt-0">
                    <VisualSequenceEditor steps={sequence.steps} onStepsChange={(newSteps) => setSequence(prev => ({ ...prev, steps: newSteps }))} />
                  </TabsContent>
                  <TabsContent value="list" className="mt-0">
                    {renderStepsList()}
                  </TabsContent>
                </Tabs>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Bottom bar for wizard navigation — refined */}
      {mode === 'wizard' && (
        <div className="h-16 border-t border-border/60 flex items-center justify-between px-8 shrink-0 bg-background">
          <Button
            variant="ghost"
            onClick={goPrevWizardStep}
            disabled={wizardStep === 'info'}
            size="sm"
            className="h-8 text-xs gap-1.5 text-muted-foreground"
          >
            <ArrowLeft className="w-3.5 h-3.5" />
            Précédent
          </Button>

          {/* Step dots */}
          <div className="flex items-center gap-2">
            {WIZARD_ORDER.map((step, i) => (
              <button
                key={step}
                onClick={() => setWizardStep(step)}
                className="p-1"
              >
                <motion.div
                  className={cn(
                    "rounded-full transition-colors",
                    step === wizardStep
                      ? "bg-foreground"
                      : completedSteps.has(step)
                        ? "bg-foreground/30"
                        : "bg-border"
                  )}
                  animate={{
                    width: step === wizardStep ? 20 : 6,
                    height: 6,
                  }}
                  transition={{ duration: 0.2, ease: [0.4, 0, 0.2, 1] }}
                />
              </button>
            ))}
          </div>

          {wizardStep === 'review' ? (
            <Button
              onClick={handleSave}
              disabled={isSaving || !sequence.name.trim() || sequence.steps.length === 0}
              size="sm"
              className="h-8 px-5 text-xs gap-1.5"
            >
              {isSaving ? 'Enregistrement...' : <><CheckCircle className="w-3.5 h-3.5" />Activer</>}
            </Button>
          ) : (
            <Button
              onClick={goNextWizardStep}
              size="sm"
              className="h-8 text-xs gap-1.5"
            >
              Suivant
              <ArrowRight className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
      )}
    </div>
  );

  return createPortal(content, document.body);
});

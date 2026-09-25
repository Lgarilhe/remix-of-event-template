import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  saveEditorDraft,
  loadEditorDraft,
  clearEditorDraft,
  editorDraftSavedAt,
} from '@/lib/editorDraft';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
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
import { useUserTemplateVariables } from '@/hooks/useUserTemplateVariables';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { getConditionsForActionType, isEmailStep, isWhatsAppStep, isLinkedInStep, isCrossChannelCondition, ALL_CONDITION_TYPES, engagementConditionHint, retiredConditionNotice } from './sequence/conditionTypes';
import { VariableInserter, UnknownVariablesNotice } from './sequence/VariableInserter';
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
  Shield,
  ChevronDown,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { VisualSequenceEditor } from './sequence/VisualSequenceEditor';
import { StopConditionsSettings } from './sequence/StopConditionsSettings';
import { MultiSenderSettings } from './sequence/MultiSenderSettings';
import { SequenceWizardStepper, WizardStep, WIZARD_STEPS } from './sequence/SequenceWizardStepper';
import { SequenceValidationChecklist } from './sequence/SequenceValidationChecklist';
import type { StopConditions as StopConditionsType } from './sequence/StopConditionsSettings';
import type { SenderAccount } from './sequence/MultiSenderSettings';
import {
  isStepTypeOffered,
  unsupportedStepNotice,
  SMART_MESSAGE_INMAIL_HELP,
  effectiveTimeoutAction,
  timeoutActionUpdate,
  nextStepOrder,
  getPrimarySteps,
  removeStepFromSequence,
  chainAfterLastMainStep,
  validateStepGraph,
  findUnreachableSteps,
  unreachableStepWarning,
  findUnknownTemplateVariables,
  renderTemplatePreview,
  STEP_TYPE_LABELS,
  stepHasMessageField,
  stepRequiresMessage,
  stepNeedsSubject,
  stepAllowsAi,
  isManuallyWritten,
  withoutInvitationAi,
  withAlwaysOnStops,
  formatStepDelay,
  delaySentence,
  SEND_WINDOW_HELP,
  sequenceDraftKey,
  LEGACY_SEQUENCE_DRAFT_KEY,
  addVariantToSteps,
  timeoutTargetOptions,
  hasBackwardTimeoutTarget,
  validateSequence,
  branchBadgesByStep,
  HIGH_SENDER_DAILY_LIMIT,
  type SequenceArea,
} from './sequence/sequenceGraph';
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
  // « Terminer » au délai dépassé n'est pas proposé : rien ne l'enregistre et le
  // moteur passait à l'étape suivante. Seule l'étape de repli est persistée.
  timeoutAction?: 'skip' | 'alternative_step';
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
  /** Ancien champ, plus écrit : la rotation n'envoie que depuis des comptes LinkedIn. */
  email?: string;
  daily_limit: number;
  /** Nom affiché dans « Plusieurs expéditeurs », ignoré par le moteur. */
  label?: string;
  /** Canal du compte : la rotation ne sert qu'aux étapes LinkedIn. */
  channel?: 'linkedin';
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
   * Candidats en cours dans la séquence modifiée : bandeau sur l'effet des
   * changements, confirmation avant de supprimer une étape. Inconnu : la
   * confirmation est demandée par prudence.
   */
  activeEnrollmentCount?: number;
  /** Faux quand l'offre n'autorise pas l'envoi : une nouvelle séquence est créée désactivée. */
  canSendSequences?: boolean;
}

// ACTIONS = ce qu'on FAIT
const ACTIONS = [
  { value: 'connection_request', label: STEP_TYPE_LABELS.connection_request, icon: UserPlus, color: 'bg-muted text-foreground', description: 'Envoyer une demande de connexion', requiresPrevious: [], excludeIfPrevious: ['connection_request'], requiresConnection: false },
  { value: 'inmail', label: STEP_TYPE_LABELS.inmail, icon: Mail, color: 'bg-muted text-foreground', description: 'Envoyer un InMail (payant)', requiresPrevious: [], excludeIfPrevious: [], requiresConnection: false },
  { value: 'email', label: STEP_TYPE_LABELS.email, icon: Mail, color: 'bg-muted text-foreground', description: 'Envoyer un e-mail', requiresPrevious: [], excludeIfPrevious: [], requiresConnection: false },
  { value: 'profile_visit', label: STEP_TYPE_LABELS.profile_visit, icon: Eye, color: 'bg-muted text-foreground', description: 'Visiter le profil du candidat', requiresPrevious: [], excludeIfPrevious: [], requiresConnection: false },
  { value: 'message', label: STEP_TYPE_LABELS.message, icon: MessageSquare, color: 'bg-muted text-foreground', description: 'Message direct (1er degré requis)', requiresPrevious: [], excludeIfPrevious: [], requiresConnection: true },
  { value: 'smart_message', label: STEP_TYPE_LABELS.smart_message, icon: Sparkles, color: 'bg-foreground text-background', description: 'Message IA, InMail si non connecté', requiresPrevious: [], excludeIfPrevious: [], requiresConnection: true },
  { value: 'whatsapp_message', label: STEP_TYPE_LABELS.whatsapp_message, icon: MessageSquare, color: 'bg-success/10 text-success', description: 'Envoyer un message WhatsApp', requiresPrevious: [], excludeIfPrevious: [], requiresConnection: false },
];

// TRIGGERS = ce qu'on ATTEND
const TRIGGERS = [
  { value: 'check_connection', label: STEP_TYPE_LABELS.check_connection, icon: GitBranch, color: 'bg-muted text-foreground', description: 'Deux branches selon la relation', requiresPrevious: [], excludeIfPrevious: [] },
  { value: 'wait_connection', label: STEP_TYPE_LABELS.wait_connection, icon: Timer, color: 'bg-accent/30 text-foreground', description: 'Jusqu\'à l\'acceptation de l\'invitation', waitEvent: 'connection_accepted', requiresPrevious: ['connection_request'], excludeIfPrevious: ['wait_connection'] },
  { value: 'wait_reply', label: STEP_TYPE_LABELS.wait_reply, icon: MessageSquare, color: 'bg-accent/30 text-foreground', description: 'Jusqu\'à une réponse', waitEvent: 'reply_received', requiresPrevious: ['inmail', 'email', 'message', 'smart_message', 'whatsapp_message'], excludeIfPrevious: [] },
  { value: 'wait_profile_visit', label: STEP_TYPE_LABELS.wait_profile_visit, icon: Eye, color: 'bg-accent/30 text-foreground', description: 'Visite du profil en retour', waitEvent: 'profile_visited', requiresPrevious: ['profile_visit'], excludeIfPrevious: [] },
];

const ALL_STEP_TYPES = [...ACTIONS, ...TRIGGERS];
// Types plus proposés, encore présents dans des séquences existantes.
const LEGACY_STEP_LABELS: Record<string, string> = { condition_branch: STEP_TYPE_LABELS.condition_branch };

const TIMEOUT_ACTIONS = [
  { value: 'skip', label: 'Passer à l\'étape suivante' },
  { value: 'alternative_step', label: 'Aller à une étape de repli' },
];

const getAvailableStepTypes = (previousSteps: SequenceStep[]) => {
  const previousTypes = previousSteps.map(s => s.actionType);

  const availableActions = ACTIONS.filter(action => {
    // E-mail et WhatsApp masqués tant que le moteur ne sait pas les envoyer.
    if (!isStepTypeOffered(action.value)) return false;
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
    // « Attendre visite retour » : aucun événement de visite n'est détecté.
    if (!isStepTypeOffered(trigger.value)) return false;
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
// Champ texte présent (la note d'invitation reste facultative, voir validateSequence).
const needsMessage = stepHasMessageField;
// E-mail, InMail et Message IA (qui part en InMail hors relation).
const needsSubject = stepNeedsSubject;
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

// ── Wizard step order ──
const WIZARD_ORDER: WizardStep[] = ['info', 'senders', 'steps', 'guardrails', 'review'];

/** Séquence vide d'une création (et de « Repartir de zéro »). */
const EMPTY_SEQUENCE: Sequence = { name: '', description: '', steps: [], isActive: true };

/** Valeur affichée par défaut dans « Garde-fous » : c'est aussi celle qui est enregistrée. */
const DEFAULT_STOP_CONDITIONS: StopConditions = { on_reply: true, on_click: false, on_unsubscribe: true, on_meeting_booked: false };

/** Exécutions qui font partie de l'historique d'une étape (elle ne peut plus être supprimée). */
const HISTORY_EXECUTION_STATUSES = ['sent', 'opened', 'clicked', 'replied', 'bounced', 'failed', 'skipped'];

interface VariantEditorProps {
  variant: SequenceStep;
  onUpdate: (updates: Partial<SequenceStep>) => void;
  onRemove: () => void;
  removing: boolean;
  customKeys: string[];
}

/** Une variante A/B : poids, IA, objet et message, avec le menu Variables. */
const VariantEditor: React.FC<VariantEditorProps> = ({ variant: v, onUpdate, onRemove, removing, customKeys }) => {
  const subjectRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const aiAllowed = stepAllowsAi(v.actionType);
  const usesAi = aiAllowed && v.useAiPersonalization;
  const fieldId = (name: string) => `variant-${v.id}-${name}`;
  return (
    <div className="p-3 space-y-3">
      <div className="flex items-center gap-3">
        <Label htmlFor={fieldId('weight')} className="text-xs whitespace-nowrap">Poids (%)</Label>
        <Input
          id={fieldId('weight')}
          type="number"
          min={1}
          max={100}
          value={v.variantWeight ?? ''}
          onChange={(e) => { const n = parseInt(e.target.value); onUpdate({ variantWeight: Number.isFinite(n) ? n : undefined }); }}
          className="w-20 h-7 text-xs"
        />
        {v.variantGroup !== 'A' && (
          <Button variant="ghost" size="sm" className="h-6 text-xs text-muted-foreground hover:text-destructive ml-auto" onClick={onRemove} disabled={removing} aria-label={`Supprimer la variante ${v.variantGroup}`} title={`Supprimer la variante ${v.variantGroup}`}>
            <Trash2 className="w-3 h-3" aria-hidden="true" />
          </Button>
        )}
      </div>
      {aiAllowed && (
        <div className="flex items-center justify-between p-2 bg-muted/50 border border-border">
          <Label htmlFor={fieldId('ai')} className="flex items-center gap-2 cursor-pointer"><Sparkles className="w-3.5 h-3.5" aria-hidden="true" /><span className="text-xs font-medium">Personnalisation IA</span></Label>
          <Switch id={fieldId('ai')} checked={v.useAiPersonalization} onCheckedChange={(checked) => onUpdate({ useAiPersonalization: checked })} />
        </div>
      )}
      {!usesAi && (
        <>
          {needsSubject(v.actionType) && (
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor={fieldId('subject')} className="text-xs">Objet</Label>
                <VariableInserter targetRef={subjectRef} currentValue={v.subjectTemplate || ''} onInsert={(val) => onUpdate({ subjectTemplate: val })} />
              </div>
              <Input id={fieldId('subject')} ref={subjectRef} value={v.subjectTemplate || ''} onChange={(e) => onUpdate({ subjectTemplate: e.target.value })} placeholder={v.actionType === 'smart_message' ? 'Objet si le message part en InMail' : 'Objet'} className={cn("mt-1 h-8 text-xs", !v.subjectTemplate?.trim() && "border-destructive")} />
            </div>
          )}
          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor={fieldId('message')} className="text-xs">{v.actionType === 'connection_request' ? "Note d'invitation" : 'Message'}</Label>
              <VariableInserter targetRef={messageRef} currentValue={v.messageTemplate || ''} onInsert={(val) => onUpdate({ messageTemplate: val })} />
            </div>
            <Textarea id={fieldId('message')} ref={messageRef} value={v.messageTemplate || ''} onChange={(e) => onUpdate({ messageTemplate: e.target.value })} placeholder="Bonjour {{first_name}}, ..." rows={2} maxLength={v.actionType === 'connection_request' ? 300 : undefined} className="mt-1 text-xs" />
            <UnknownVariablesNotice text={`${v.subjectTemplate || ''} ${v.messageTemplate || ''}`} customKeys={customKeys} />
          </div>
        </>
      )}
    </div>
  );
};

export const SequenceBuilder: React.FC<SequenceBuilderProps> = React.memo(({
  isOpen,
  onClose,
  onSave,
  initialSequence,
  activeEnrollmentCount,
  canSendSequences = true,
}) => {
  // Modification = séquence déjà en base. Un modèle ou une copie arrive sans id :
  // c'est une création (brouillon conservé, mode Guidé, « Nouvelle séquence »).
  const isEditing = !!initialSequence?.id;
  // Brouillon rangé par utilisateur et par organisation : sur un poste partagé
  // ou après un changement d'organisation, le travail d'un autre ne revient pas.
  // Clé fixée à l'ouverture : si l'un des deux est encore inconnu, pas de
  // brouillon pour cette ouverture (on n'écrase pas un brouillon jamais relu).
  const { user } = useAuthReady();
  const { organizationId } = useOrganization();
  const navigate = useNavigate();
  const [draftKey] = useState(() => sequenceDraftKey(user?.id, organizationId));
  // Brouillon d'une sequence en cours de creation. On ne conserve rien pour une
  // sequence existante : la verite y est cote base, et repousser une vieille
  // saisie par-dessus serait pire que de la perdre. Un modèle ou une copie
  // s'affiche tel quel : son travail sera conservé à la sortie.
  const brouillonInitial = isEditing ? null : initialSequence ? null : draftKey ? loadEditorDraft<Sequence>(draftKey) : null;
  const [sequence, setSequence] = useState<Sequence>(() => {
    const base = initialSequence || brouillonInitial || EMPTY_SEQUENCE;
    const initial = { ...base, stopConditions: base.stopConditions ?? DEFAULT_STOP_CONDITIONS };
    return {
      ...initial,
      // Invitation « IA » (option retirée) : la note saisie est celle qui part.
      steps: withoutInvitationAi(initial.steps),
      // Réponse et désinscription arrêtent toujours la séquence.
      stopConditions: withAlwaysOnStops(initial.stopConditions),
    };
  });
  // État de départ, pour savoir en modification si « Retour » perd quelque chose.
  const etatInitialRef = useRef<string | null>(null);
  if (etatInitialRef.current === null) etatInitialRef.current = JSON.stringify(sequence);
  const [confirmLeave, setConfirmLeave] = useState(false);
  // Contenu gardé pendant la fermeture des dialogues (pas de texte vide pendant l'animation).
  const [pendingWarnings, setPendingWarnings] = useState<string[]>([]);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [historyBlock, setHistoryBlock] = useState<{ title: string; count: number } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [checkingRemoval, setCheckingRemoval] = useState(false);
  // Étapes déjà en base retirées : confirmation avant d'annuler leurs envois prévus.
  const [removalConfirmOpen, setRemovalConfirmOpen] = useState(false);
  const [pendingRemovedCount, setPendingRemovedCount] = useState(0);
  const [mobileChecklistOpen, setMobileChecklistOpen] = useState(false);
  // Vrai tant que la sequence n'a pas ete enregistree : la fermeture conserve
  // alors le travail au lieu de l'effacer (audit UX du 09/09/2026, constat UX06).
  const enregistreeRef = useRef(false);
  const [isSaving, setIsSaving] = useState(false);
  const [expandedStepId, setExpandedStepId] = useState<string | null>(
    initialSequence?.steps[0]?.id || null
  );
  const [showStepPicker, setShowStepPicker] = useState(!initialSequence || initialSequence.steps.length === 0);
  const { signatures } = useEmailSignatures();
  // Variables personnelles : le moteur les remplit aussi, elles ne sont pas « inconnues ».
  const { variables: customVariables } = useUserTemplateVariables();
  const customValues = useMemo(
    () => Object.fromEntries(customVariables.map(v => [v.key, v.value])),
    [customVariables],
  );
  const customKeyList = useMemo(() => Object.keys(customValues), [customValues]);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  // Étapes déjà en base (modification) : elles peuvent avoir un historique d'envoi.
  const persistedStepIds = useMemo(
    () => new Set(isEditing ? (initialSequence?.steps ?? []).map(s => s.id) : []),
    [isEditing, initialSequence],
  );

  // Conservation du travail : le composant est demonte par son parent au clic
  // sur « Retour », et un rechargement ou une fermeture d'onglet ne démonte
  // rien. Le brouillon est donc écrit au fil de la saisie (une seconde après
  // la dernière modification), à la sortie et avant de quitter la page.
  const sequenceRef = useRef(sequence);
  sequenceRef.current = sequence;
  // Modèle ou copie : conservé seulement s'il a été retouché, pour ne pas
  // remplacer un brouillon par un modèle ouvert puis refermé.
  const partDUnModeleRef = useRef(!isEditing && !!initialSequence);
  const writeDraftNow = useCallback(() => {
    const key = draftKey;
    if (isEditing || !key) return;
    if (enregistreeRef.current) return;
    const courante = sequenceRef.current;
    if (partDUnModeleRef.current && JSON.stringify(courante) === etatInitialRef.current) return;
    const aDuContenu =
      courante.name.trim() || courante.description?.trim() || courante.steps.length > 0;
    saveEditorDraft(key, aDuContenu ? courante : null);
  }, [isEditing, draftKey]);

  useEffect(() => {
    if (isEditing) return;
    const timer = window.setTimeout(writeDraftNow, 1000);
    return () => window.clearTimeout(timer);
  }, [sequence, isEditing, writeDraftNow]);

  useEffect(() => {
    if (isEditing) return;
    return () => writeDraftNow();
  }, [isEditing, writeDraftNow]);

  // Quitter la page (rechargement, onglet fermé) avec des changements non
  // enregistrés : le navigateur demande confirmation. En création, le
  // brouillon est écrit tout de suite, sans attendre la temporisation.
  useEffect(() => {
    const onBeforeUnload = (event: BeforeUnloadEvent) => {
      if (enregistreeRef.current) return;
      if (JSON.stringify(sequenceRef.current) === etatInitialRef.current) return;
      writeDraftNow();
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [writeDraftNow]);

  // L'ancienne clé, commune à tous les comptes du navigateur, est effacée.
  useEffect(() => {
    clearEditorDraft(LEGACY_SEQUENCE_DRAFT_KEY);
  }, []);

  // Wizard vs expert mode
  const [mode, setMode] = useState<'wizard' | 'expert'>(isEditing ? 'expert' : 'wizard');
  const [wizardStep, setWizardStep] = useState<WizardStep>('info');

  /** « Repartir de zéro » : brouillon effacé, éditeur vide. */
  const resetToBlank = useCallback(() => {
    if (draftKey) clearEditorDraft(draftKey);
    const blank: Sequence = { ...EMPTY_SEQUENCE, stopConditions: DEFAULT_STOP_CONDITIONS };
    etatInitialRef.current = JSON.stringify(blank);
    partDUnModeleRef.current = false;
    setSequence(blank);
    setExpandedStepId(null);
    setShowStepPicker(true);
    setWizardStep('info');
  }, [draftKey]);

  // Reprise annoncee : sans message, l'utilisateur croit a un bug d'affichage.
  // Le toast permet aussi d'écarter ce brouillon.
  useEffect(() => {
    if (isEditing || !brouillonInitial || !draftKey) return;
    const quand = editorDraftSavedAt(draftKey);
    toast.info('Brouillon de séquence repris', {
      description: quand
        ? `Votre travail du ${quand.toLocaleDateString('fr-FR')} à ${quand.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} a été conservé.`
        : 'Votre travail précédent a été conservé.',
      duration: 12000,
      action: { label: 'Repartir de zéro', onClick: resetToBlank },
    });
    // Au seul montage.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Vérification unique : liste de vérification, fil du mode Guidé et
  // enregistrement lisent la même fonction.
  const validation = useMemo(() => validateSequence(sequence), [sequence]);

  // Compute completed wizard steps
  const completedSteps = useMemo(() => {
    const completed = new Set<WizardStep>();
    if (sequence.name.trim()) completed.add('info');
    if (sequence.steps.length > 0) completed.add('steps');
    // Senders is "complete" even if not using multi-sender
    completed.add('senders');
    // La réponse et la désinscription arrêtent toujours la séquence.
    completed.add('guardrails');
    return completed;
  }, [sequence.name, sequence.steps.length]);

  // Bloquants par étape du mode Guidé, lus sur la vérification unique.
  const wizardValidationErrors = useMemo(() => {
    const errors = new Map<WizardStep, string[]>();
    for (const issue of validation.errors) {
      const area: SequenceArea = issue.area;
      const list = errors.get(area) ?? [];
      list.push(issue.message);
      errors.set(area, list);
    }
    return errors;
  }, [validation]);

  const updateStep = useCallback((stepId: string, updates: Partial<SequenceStep>) => {
    setSequence(prev => ({
      ...prev,
      steps: prev.steps.map(step =>
        step.id === stepId ? { ...step, ...updates } : step
      ),
    }));
  }, []);

  const addStep = useCallback((actionType: string) => {
    // Ordre = plus grand ordre + 1 : compter les lignes comptait aussi les
    // variantes A/B et laissait un trou que le moteur ne franchit pas.
    const newStep = createEmptyStep(nextStepOrder(sequence.steps), actionType);
    setSequence(prev => ({
      ...prev,
      // Séquence chaînée depuis l'onglet Visuel : la dernière étape est reliée
      // à la nouvelle, sinon le moteur s'arrêterait avant elle.
      steps: [...chainAfterLastMainStep(prev.steps, newStep.id), newStep],
    }));
    setExpandedStepId(newStep.id);
    setShowStepPicker(false);
  }, [sequence.steps]);

  const applyRemoveStep = useCallback((stepId: string) => {
    setSequence(prev => ({ ...prev, steps: removeStepFromSequence(prev.steps, stepId) }));
    setExpandedStepId(current => (current === stepId ? null : current));
  }, []);

  /**
   * Suppression demandée (liste, variante ou onglet Visuel). En modification,
   * une étape déjà exécutée garde son historique : on explique au lieu de
   * supprimer (l'enregistrement serait refusé).
   */
  const requestRemoveStep = useCallback(async (stepId: string) => {
    const target = sequence.steps.find(s => s.id === stepId);
    if (!target) return;
    const removedRows = target.variantGroup === 'A'
      ? sequence.steps.filter(s => s.order === target.order && s.variantGroup)
      : [target];
    const persisted = removedRows.map(s => s.id).filter(id => persistedStepIds.has(id));
    if (persisted.length === 0) {
      applyRemoveStep(stepId);
      return;
    }
    setCheckingRemoval(true);
    try {
      const { count, error } = await supabase
        .from('sequence_step_executions')
        .select('id', { count: 'exact', head: true })
        .in('step_id', persisted)
        .in('status', HISTORY_EXECUTION_STATUSES);
      if (error) throw error;
      if (count === null) throw new Error('Comptage indisponible');
      if (count > 0) {
        const isVariant = !!target.variantGroup && target.variantGroup !== 'A';
        setHistoryBlock({
          title: isVariant
            ? `Supprimer la variante ${target.variantGroup} de l'étape ${target.order + 1} ?`
            : `Supprimer l'étape ${target.order + 1} ?`,
          count,
        });
        setHistoryOpen(true);
        return;
      }
      applyRemoveStep(stepId);
    } catch (err) {
      console.error('[SequenceBuilder] history check failed:', err);
      toast.error('Impossible de vérifier l\'historique de cette étape', {
        description: 'Elle n\'a pas été supprimée. Réessayez dans un instant.',
      });
    } finally {
      setCheckingRemoval(false);
    }
  }, [sequence.steps, persistedStepIds, applyRemoveStep]);

  // Poids répartis sur le nombre réel de variantes après l'ajout, reste à A
  // (50/50, puis 34/33/33) : l'ancien calcul donnait 25 % à chacune des trois.
  const addVariant = useCallback((sourceStep: SequenceStep) => {
    const newId = crypto.randomUUID();
    setSequence(prev => ({ ...prev, steps: addVariantToSteps(prev.steps, sourceStep.id, newId) }));
  }, []);

  // Retirer une variante B ou C : même règle que la suppression d'étape (la
  // dernière variante restante redevient une étape simple, poids répartis).
  const removeVariant = useCallback((variantStep: SequenceStep) => {
    void requestRemoveStep(variantStep.id);
  }, [requestRemoveStep]);

  const variantGroups = useMemo(() => getVariantGroups(sequence.steps), [sequence.steps]);
  const primarySteps = useMemo(() => getPrimarySteps(sequence.steps), [sequence.steps]);
  // « Si connecté », « Si non connecté », « Si délai dépassé » : la branche de chaque étape.
  const branchBadges = useMemo(() => branchBadgesByStep(sequence.steps), [sequence.steps]);
  const typeLabel = useCallback(
    (actionType: string) => ALL_STEP_TYPES.find(t => t.value === actionType)?.label ?? LEGACY_STEP_LABELS[actionType],
    [],
  );

  // Retour : en modification, ne rien perdre sans le dire. Une création garde
  // son brouillon à la sortie, pas besoin de demander.
  const handleBack = () => {
    if (isEditing && JSON.stringify(sequence) !== etatInitialRef.current) {
      setConfirmLeave(true);
      return;
    }
    onClose();
  };

  /** Points non bloquants à confirmer avant d'enregistrer. */
  const computeSaveWarnings = (): string[] => {
    const warnings: string[] = [];
    for (const step of findUnreachableSteps(sequence.steps)) {
      warnings.push(unreachableStepWarning(step, typeLabel(step.actionType)));
    }
    // Condition retirée (« Si l'e-mail est revenu en erreur ») : jamais vraie.
    for (const issue of validation.warnings) {
      if (issue.check === 'retired_condition') warnings.push(issue.message);
    }
    const customKeys = Object.keys(customValues);
    for (const s of sequence.steps) {
      if (!needsMessage(s.actionType) || !isManuallyWritten(s)) continue;
      const unknown = [
        ...new Set([
          ...findUnknownTemplateVariables(s.messageTemplate, customKeys),
          ...(needsSubject(s.actionType) ? findUnknownTemplateVariables(s.subjectTemplate, customKeys) : []),
        ]),
      ];
      if (unknown.length === 0) continue;
      const label = `Étape ${s.order + 1}${s.variantGroup ? ` (${s.variantGroup})` : ''}`;
      warnings.push(unknown.length > 1
        ? `${label} : ${unknown.join(', ')} ne seront pas remplacées à l'envoi et seront retirées du message.`
        : `${label} : ${unknown[0]} ne sera pas remplacée à l'envoi et sera retirée du message.`);
    }
    return warnings;
  };

  /** Étapes déjà en base retirées dans l'éditeur (variantes comptées une fois) : leurs envois prévus seront annulés. */
  const removedPersistedStepCount = useMemo(() => {
    if (!isEditing) return 0;
    const current = new Set(sequence.steps.map(s => s.id));
    const orders = new Set<number>();
    for (const s of initialSequence?.steps ?? []) {
      if (!current.has(s.id)) orders.add(s.order);
    }
    return orders.size;
  }, [isEditing, initialSequence, sequence.steps]);

  const handleSave = async (options?: { skipWarnings?: boolean; removalConfirmed?: boolean }) => {
    // Validation user-visible : toast au lieu d'un return silencieux
    if (!sequence.name.trim()) {
      toast.error('Nom requis', { description: 'Donnez un nom à votre séquence avant de l\'enregistrer.' });
      if (mode === 'wizard') setWizardStep('info');
      return;
    }
    if (sequence.steps.length === 0) {
      toast.error('Ajoutez au moins une étape', { description: 'Une séquence doit contenir au moins une action.' });
      if (mode === 'wizard') setWizardStep('steps');
      return;
    }

    // Mêmes règles que la liste de vérification et le fil du mode Guidé
    // (validateSequence) : délais, seuil de score, fenêtre d'envoi, poids des
    // tests A/B, enchaînement des étapes (validateStepGraph), étapes de repli.
    const errors: string[] = validateSequence(sequence).errors.map(issue => issue.message);

    if (errors.length > 0) {
      if (mode === 'wizard') setWizardStep('review');
      else setMobileChecklistOpen(true);
      toast.error(`${errors.length} point${errors.length > 1 ? 's' : ''} à corriger`, {
        description: errors[0] + (errors.length > 1 ? ` (et ${errors.length - 1} autre${errors.length > 2 ? 's' : ''})` : ''),
      });
      return;
    }

    // Étapes supprimées alors que des candidats sont en cours : leurs envois
    // prévus sur ces étapes seront annulés. Nombre inconnu : on demande aussi.
    if (!options?.removalConfirmed && removedPersistedStepCount > 0 && (activeEnrollmentCount ?? 1) > 0) {
      setPendingRemovedCount(removedPersistedStepCount);
      setRemovalConfirmOpen(true);
      return;
    }

    if (!options?.skipWarnings) {
      const warnings = computeSaveWarnings();
      if (warnings.length > 0) {
        setPendingWarnings(warnings);
        setWarningsOpen(true);
        return;
      }
    }

    // Même condition que la liste des séquences (createInactiveForPlan) : sans
    // droit d'envoi, la nouvelle séquence est créée désactivée et la liste
    // n'affiche aucun message ; c'est l'éditeur qui l'annonce.
    const savedInactiveForPlan = !sequence.id && sequence.isActive && !canSendSequences;

    setIsSaving(true);
    try {
      await onSave(sequence);
      enregistreeRef.current = true;
      if (!isEditing && draftKey) clearEditorDraft(draftKey);
      // Le message de réussite vient de la liste des séquences, qui distingue
      // création et modification, sauf l'enregistrement désactivé faute d'offre.
      if (savedInactiveForPlan) {
        toast.warning('Séquence enregistrée et désactivée : l\'envoi nécessite un abonnement.', {
          action: { label: 'Voir les offres', onClick: () => navigate('/pricing') },
        });
      }
      onClose();
    } catch (err) {
      console.error('[SequenceBuilder] save failed:', err);
      toast.error('Erreur à l\'enregistrement', {
        description: err instanceof Error ? err.message : 'Réessayez dans un instant.',
      });
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
        const panelId = `step-panel-${step.id}`;
        const fieldId = (name: string) => `step-${step.id}-${name}`;
        const delayLabel = formatStepDelay(step);
        const badges = branchBadges.get(step.id) ?? [];
        // Invitation : pas de personnalisation IA, la note saisie est celle qui part.
        const aiAllowed = stepAllowsAi(step.actionType);
        const usesAi = aiAllowed && step.useAiPersonalization;
        const isInvite = step.actionType === 'connection_request';
        const backwardTimeout = hasBackwardTimeoutTarget(step, sequence.steps);
        const currentTimeoutTarget = backwardTimeout ? sequence.steps.find(s => s.id === step.timeoutBranchStepId) : undefined;
        // Badge « Incomplet » : mêmes règles que l'enregistrement (la note d'invitation est facultative).
        const incompleteReasons = (() => {
          const rows = hasVariants ? variants : [step];
          const reasons = new Set<string>();
          for (const row of rows) {
            const manual = isManuallyWritten(row);
            if (stepRequiresMessage(row.actionType) && manual && !row.messageTemplate?.trim()) reasons.add('message');
            if (needsSubject(row.actionType) && manual && !row.subjectTemplate?.trim()) reasons.add('objet');
            if (row.actionType === 'connection_request' && (row.messageTemplate?.length || 0) > 300) reasons.add('trop long');
          }
          return [...reasons];
        })();

        return (
          <div
            key={step.id}
            className={cn(
              "border border-border rounded-lg transition-all overflow-hidden",
              isExpanded && "bg-muted/20 shadow-sm",
              stepIsTrigger && "border-l-[3px] border-l-amber-400"
            )}
          >
            {/* En-tête : la zone titre est un vrai bouton (clavier, lecteur d'écran) ;
                les boutons A/B et suppression restent à côté, jamais imbriqués. */}
            <div className="flex items-center gap-2 sm:gap-3 p-2.5 sm:p-3">
              <button
                type="button"
                onClick={() => setExpandedStepId(isExpanded ? null : step.id)}
                aria-expanded={isExpanded}
                aria-controls={isExpanded ? panelId : undefined}
                className="flex flex-1 min-w-0 items-center gap-2 sm:gap-3 text-left rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <span className={cn("w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center shrink-0", stepConfig?.color || "bg-muted")}>
                  <StepIcon className="w-4 h-4" aria-hidden="true" />
                </span>
                <span className="block flex-1 min-w-0">
                  <span className="flex items-center gap-2 flex-wrap">
                    <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-muted">
                      Étape {step.order + 1}
                    </span>
                    <span className="text-[10px] font-medium px-1.5 py-0.5 rounded bg-muted/60 text-muted-foreground">
                      {!stepIsTrigger ? 'Action' : step.actionType === 'check_connection' ? 'Condition' : 'Attente'}
                    </span>
                    <span className="font-medium text-sm">{typeLabel(step.actionType)}</span>
                    {/* Branche réelle de l'étape : la liste montre sinon les branches à plat. */}
                    {badges.map(badge => (
                      <span key={badge} className="text-[10px] font-medium px-1.5 py-0.5 rounded-md border border-border bg-background text-muted-foreground">
                        {badge}
                      </span>
                    ))}
                    {hasVariants && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-medium px-1.5 py-0.5 rounded-full border border-border">
                        <FlaskConical className="w-3 h-3" aria-hidden="true" />
                        Variantes {variants.map(v => v.variantGroup).sort().join(', ')}
                      </span>
                    )}
                    {unsupportedStepNotice(step.actionType) && (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-warning/10 text-warning border border-warning/30"
                        title={unsupportedStepNotice(step.actionType) ?? undefined}
                      >
                        ⚠ Non pris en charge
                      </span>
                    )}
                    {step.variantGroup && !hasVariants && (
                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-destructive/10 text-destructive border border-destructive/30">
                        Variante {step.variantGroup} seule
                      </span>
                    )}
                    {incompleteReasons.length > 0 && (
                      <span
                        className="inline-flex items-center gap-1 text-[10px] font-semibold px-1.5 py-0.5 rounded-md bg-destructive/10 text-destructive border border-destructive/30"
                        title={`Manque : ${incompleteReasons.join(', ')}`}
                      >
                        ⚠ Incomplet ({incompleteReasons.join(' + ')})
                      </span>
                    )}
                  </span>
                  <span className="text-xs text-muted-foreground flex items-center gap-2 flex-wrap mt-0.5">
                    {delayLabel && (
                      <span className="flex items-center gap-1"><Clock className="w-3 h-3" aria-hidden="true" />Après {delayLabel}</span>
                    )}
                    {usesAi && (
                      <span className="flex items-center gap-1 text-foreground"><Sparkles className="w-3 h-3" aria-hidden="true" />IA</span>
                    )}
                    {stepIsTrigger && step.timeoutDays && (
                      <span className="flex items-center gap-1"><Timer className="w-3 h-3" aria-hidden="true" />Au plus {step.timeoutDays} j</span>
                    )}
                  </span>
                </span>
              </button>
              <div className="flex items-center gap-1 shrink-0">
                {step.variantGroup && !hasVariants && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-xs text-destructive"
                    onClick={() => updateStep(step.id, { variantGroup: undefined, variantWeight: undefined })}
                  >
                    Retirer le test A/B
                  </Button>
                )}
                {canABTest(step.actionType) && !hasVariants && !step.variantGroup && (
                  <Button variant="ghost" size="sm" onClick={() => addVariant(step)} className="text-muted-foreground hover:text-foreground" title="Créer un test A/B" aria-label={`Créer un test A/B sur l'étape ${step.order + 1}`}>
                    <FlaskConical className="w-4 h-4" aria-hidden="true" />
                  </Button>
                )}
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => { void requestRemoveStep(step.id); }}
                  disabled={checkingRemoval}
                  className="text-muted-foreground hover:text-destructive"
                  title={hasVariants ? 'Supprimer l\'étape et ses variantes' : 'Supprimer l\'étape'}
                  aria-label={`Supprimer l'étape ${step.order + 1}`}
                >
                  <Trash2 className="w-4 h-4" aria-hidden="true" />
                </Button>
              </div>
            </div>

            {/* Step details (expanded) */}
            {isExpanded && (
              <div id={panelId} className="px-3 sm:px-4 pb-3 sm:pb-4 pt-2 border-t space-y-4">
                {unsupportedStepNotice(step.actionType) && (
                  <div className="p-3 border border-warning/30 bg-warning/10 text-warning text-xs rounded-md">
                    ⚠ {unsupportedStepNotice(step.actionType)}
                  </div>
                )}
                {step.actionType === 'smart_message' && (
                  <p className="text-xs text-muted-foreground">{SMART_MESSAGE_INMAIL_HELP}</p>
                )}
                {/* Delay */}
                {index > 0 && (
                  <div>
                    <div className="grid grid-cols-3 gap-3">
                      <div>
                        <Label htmlFor={fieldId('delay-days')}>Jours</Label>
                        <Input id={fieldId('delay-days')} type="number" min={0} value={step.delayDays} onChange={(e) => updateStep(step.id, { delayDays: Math.max(0, parseInt(e.target.value) || 0) })} className="mt-1.5" />
                      </div>
                      <div>
                        <Label htmlFor={fieldId('delay-hours')}>Heures</Label>
                        <Input id={fieldId('delay-hours')} type="number" min={0} max={23} value={step.delayHours} onChange={(e) => updateStep(step.id, { delayHours: Math.min(23, Math.max(0, parseInt(e.target.value) || 0)) })} className="mt-1.5" />
                      </div>
                      <div>
                        <Label htmlFor={fieldId('delay-minutes')}>Minutes</Label>
                        <Input id={fieldId('delay-minutes')} type="number" min={0} max={59} value={step.delayMinutes || 0} onChange={(e) => updateStep(step.id, { delayMinutes: Math.min(59, Math.max(0, parseInt(e.target.value) || 0)) })} className="mt-1.5" />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground mt-1.5">{delaySentence(step)}</p>
                  </div>
                )}

                {/* Condition */}
                {isAction(step.actionType) && (
                  <div>
                    <Label htmlFor={fieldId('condition')}>Condition d'exécution</Label>
                    <Select
                      value={step.conditionType}
                      onValueChange={(value) => updateStep(
                        step.id,
                        // Seuil posé dans la même mise à jour : le champ affichait
                        // 70 sans rien enregistrer, et l'enregistrement le réclamait.
                        value === 'if_score_above' && !step.conditionValue?.trim()
                          ? { conditionType: 'if_score_above', conditionValue: '70' }
                          : { conditionType: value as SequenceStep['conditionType'] },
                      )}
                    >
                      <SelectTrigger id={fieldId('condition')} className="mt-1.5"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        {getConditionsForActionType(step.actionType, step.conditionType).map(cond => (
                          <SelectItem key={cond.value} value={cond.value}>{cond.label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    {isCrossChannelCondition(step.actionType, step.conditionType) && (
                      <p className="text-xs text-amber-600 mt-1">⚠️ Cette condition ne fonctionne qu'avec des étapes e-mail</p>
                    )}
                    {engagementConditionHint(step.conditionType) && (
                      <p className="text-xs text-muted-foreground mt-1">{engagementConditionHint(step.conditionType)}</p>
                    )}
                    {retiredConditionNotice(step.conditionType) && (
                      <p className="text-xs text-warning mt-1">⚠️ Cette condition n'est plus proposée : {retiredConditionNotice(step.conditionType)}</p>
                    )}
                    {step.conditionType === 'if_score_above' && (
                      <div className="mt-2">
                        <Label htmlFor={fieldId('score')}>Seuil de score (0-100)</Label>
                        <Input id={fieldId('score')} type="number" min={0} max={100} value={step.conditionValue ?? ''} onChange={(e) => updateStep(step.id, { conditionValue: e.target.value })} placeholder="70" className={cn("mt-1 w-32", !step.conditionValue?.trim() && "border-destructive")} />
                      </div>
                    )}
                  </div>
                )}

                {/* Send hours */}
                <Collapsible>
                  <CollapsibleTrigger className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1">
                    ▸ Fenêtre d'envoi
                  </CollapsibleTrigger>
                  <CollapsibleContent className="mt-2 space-y-2">
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor={fieldId('hour-start')} className="text-xs">Heure de début</Label>
                        <Input id={fieldId('hour-start')} type="number" min={0} max={23} value={step.preferredHourStart} onChange={(e) => updateStep(step.id, { preferredHourStart: parseInt(e.target.value) || 9 })} className="mt-1 h-8 text-xs" />
                      </div>
                      <div>
                        <Label htmlFor={fieldId('hour-end')} className="text-xs">Heure de fin</Label>
                        <Input id={fieldId('hour-end')} type="number" min={0} max={23} value={step.preferredHourEnd} onChange={(e) => updateStep(step.id, { preferredHourEnd: parseInt(e.target.value) || 18 })} className="mt-1 h-8 text-xs" />
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">{SEND_WINDOW_HELP}</p>
                  </CollapsibleContent>
                </Collapsible>

                {/* Trigger config */}
                {isTrigger(step.actionType) && step.actionType !== 'check_connection' && (
                  <div className="space-y-3 p-3 bg-muted/20 border border-border rounded-md">
                    <div className="flex items-center gap-2"><Timer className="w-4 h-4 text-muted-foreground" aria-hidden="true" /><span className="font-medium text-sm">Réglages de l'attente</span></div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <Label htmlFor={fieldId('timeout')}>Attendre au plus (jours)</Label>
                        {/* Valeur réelle affichée : vide si rien n'est enregistré. */}
                        <Input id={fieldId('timeout')} type="number" min={1} value={step.timeoutDays ?? ''} placeholder="3" onChange={(e) => { const n = parseInt(e.target.value); updateStep(step.id, { timeoutDays: n > 0 ? n : undefined }); }} className={cn("mt-1.5", !step.timeoutDays && "border-destructive")} />
                      </div>
                      <div>
                        <Label htmlFor={fieldId('timeout-action')}>Si rien ne se passe</Label>
                        {/* Valeur lue sur l'étape de repli enregistrée : c'est elle que le moteur applique. */}
                        <Select value={effectiveTimeoutAction(step)} onValueChange={(value) => updateStep(step.id, timeoutActionUpdate(value))}>
                          <SelectTrigger id={fieldId('timeout-action')} className="mt-1.5"><SelectValue /></SelectTrigger>
                          <SelectContent>
                            {TIMEOUT_ACTIONS.map(action => (
                              <SelectItem key={action.value} value={action.value}>{action.label}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    {effectiveTimeoutAction(step) === 'alternative_step' && (
                      <div>
                        <Label htmlFor={fieldId('timeout-target')}>Étape de repli</Label>
                        <Select value={step.timeoutBranchStepId || '__none__'} onValueChange={(value) => updateStep(step.id, { timeoutBranchStepId: value === '__none__' ? undefined : value })}>
                          <SelectTrigger id={fieldId('timeout-target')} className={cn("mt-1.5", (!step.timeoutBranchStepId || backwardTimeout) && "border-destructive")}><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="__none__">Sélectionner...</SelectItem>
                            {/* Seulement les étapes suivantes : une étape antérieure renverrait un message déjà parti. */}
                            {[...(currentTimeoutTarget ? [currentTimeoutTarget] : []), ...timeoutTargetOptions(step, sequence.steps)].map(s => (
                              <SelectItem key={s.id} value={s.id}>Étape {s.order + 1}{s.variantGroup ? ` (${s.variantGroup})` : ''} — {typeLabel(s.actionType) || s.actionType}</SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {!step.timeoutBranchStepId && (
                          <p className="text-xs text-destructive mt-0.5">Choisissez l'étape à exécuter si le délai est dépassé.</p>
                        )}
                        {backwardTimeout && (
                          <p className="text-xs text-destructive mt-0.5">Cette étape vient avant l'attente : un message déjà envoyé repartirait. Choisissez une étape suivante.</p>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {/* Check connection */}
                {step.actionType === 'check_connection' && (
                  <div className="space-y-4 p-3 bg-muted/20 border border-border rounded-md">
                    <div className="flex items-center gap-2"><GitBranch className="w-4 h-4 text-muted-foreground" aria-hidden="true" /><span className="font-medium text-sm">Selon la connexion</span></div>
                    <div>
                      <Label htmlFor={fieldId('if-true')}>Si connecté (1er degré), aller à</Label>
                      <Select value={step.ifTrueGotoStep || '__next__'} onValueChange={(value) => updateStep(step.id, { ifTrueGotoStep: value === '__next__' ? undefined : value })}>
                        <SelectTrigger id={fieldId('if-true')} className="mt-1.5"><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__next__">Étape suivante</SelectItem>
                          {sequence.steps.filter(s => s.order > step.order).map(s => (
                            <SelectItem key={s.id} value={s.id}>Étape {s.order + 1} : {typeLabel(s.actionType)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <Label htmlFor={fieldId('if-false')}>Si non connecté, aller à</Label>
                      <Select value={step.ifFalseGotoStep || '__next__'} onValueChange={(value) => updateStep(step.id, { ifFalseGotoStep: value === '__next__' ? undefined : value })}>
                        <SelectTrigger id={fieldId('if-false')} className="mt-1.5"><SelectValue placeholder="Sélectionner..." /></SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__next__">Étape suivante</SelectItem>
                          {sequence.steps.filter(s => s.order > step.order).map(s => (
                            <SelectItem key={s.id} value={s.id}>Étape {s.order + 1} : {typeLabel(s.actionType)}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    {!!step.ifTrueGotoStep !== !!step.ifFalseGotoStep && (
                      <p className="text-xs text-destructive">
                        La branche {step.ifTrueGotoStep ? 'Non connecté' : 'Connecté'} est vide : ces candidats partiraient dans l'autre branche. Choisissez une étape pour chaque cas, ou « Étape suivante » pour les deux.
                      </p>
                    )}
                  </div>
                )}

                {/* Message fields */}
                {needsMessage(step.actionType) && (
                  <>
                    {hasVariants && (
                      <div className="border border-border bg-muted/20">
                        <div className="flex items-center justify-between px-3 py-2 border-b border-border">
                          <div className="flex items-center gap-2">
                            <FlaskConical className="w-3.5 h-3.5" aria-hidden="true" />
                            <span className="text-xs font-bold uppercase tracking-wider">Test A/B</span>
                          </div>
                          {variants.length < 3 && (
                            <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={() => addVariant(step)}>
                              <Copy className="w-3 h-3 mr-1" aria-hidden="true" />Ajouter une variante
                            </Button>
                          )}
                        </div>
                        <Tabs defaultValue={step.id} className="w-full">
                          <TabsList className="w-full rounded-lg h-8 bg-muted/50">
                            {[...variants].sort((a, b) => (a.variantGroup || '').localeCompare(b.variantGroup || '')).map(v => (
                              <TabsTrigger key={v.id} value={v.id} className="flex-1 h-6 text-xs rounded-lg">
                                Variante {v.variantGroup}<span className="ml-1 text-muted-foreground">({v.variantWeight || 0} %)</span>
                              </TabsTrigger>
                            ))}
                          </TabsList>
                          {variants.map(v => (
                            <TabsContent key={v.id} value={v.id} className="mt-0">
                              <VariantEditor
                                variant={v}
                                onUpdate={(updates) => updateStep(v.id, updates)}
                                onRemove={() => removeVariant(v)}
                                removing={checkingRemoval}
                                customKeys={customKeyList}
                              />
                            </TabsContent>
                          ))}
                          {(() => {
                            const totalWeight = variants.reduce((sum, v) => sum + (v.variantWeight || 0), 0);
                            return (
                              <div className={cn("text-xs font-medium px-3 py-1.5 border-t border-border", totalWeight === 100 ? "text-green-600" : "text-destructive")}>
                                Total : {totalWeight} %{totalWeight !== 100 && " (doit faire 100 %)"}
                              </div>
                            );
                          })()}
                        </Tabs>
                      </div>
                    )}

                    {!hasVariants && (
                      <>
                        {aiAllowed && (
                          <div className="flex items-center justify-between p-3 bg-muted/30 border border-border rounded-md">
                            <Label htmlFor={fieldId('ai')} className="flex items-center gap-2 cursor-pointer"><Sparkles className="w-4 h-4" aria-hidden="true" /><span className="text-sm font-medium">Personnalisation IA</span></Label>
                            <Switch id={fieldId('ai')} checked={step.useAiPersonalization} onCheckedChange={(checked) => updateStep(step.id, { useAiPersonalization: checked })} />
                          </div>
                        )}

                        {usesAi ? (
                          <div>
                            <Label htmlFor={fieldId('tone')}>Ton du message</Label>
                            <Select value={step.aiTone || 'professional'} onValueChange={(value) => updateStep(step.id, { aiTone: value as SequenceStep['aiTone'] })}>
                              <SelectTrigger id={fieldId('tone')} className="mt-1.5"><SelectValue /></SelectTrigger>
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
                                  <Label htmlFor={fieldId('subject')}>Objet</Label>
                                  <VariableInserter targetRef={subjectRef} currentValue={step.subjectTemplate || ''} onInsert={(val) => updateStep(step.id, { subjectTemplate: val })} />
                                </div>
                                <Input id={fieldId('subject')} ref={subjectRef} value={step.subjectTemplate || ''} onChange={(e) => updateStep(step.id, { subjectTemplate: e.target.value })} placeholder={step.actionType === 'email' ? "Objet de l'e-mail" : step.actionType === 'smart_message' ? "Objet si le message part en InMail" : "Objet de l'InMail"} className={cn("mt-1.5", needsSubject(step.actionType) && !step.subjectTemplate?.trim() && "border-destructive")} />
                                {needsSubject(step.actionType) && !step.subjectTemplate?.trim() && <p className="text-xs text-destructive mt-0.5">Objet requis</p>}
                              </div>
                            )}
                            <div>
                              <div className="flex items-center justify-between">
                                <Label htmlFor={fieldId('message')}>{isInvite ? "Note d'invitation" : 'Message'}</Label>
                                <div className="flex items-center gap-2">
                                  <VariableInserter targetRef={messageRef} currentValue={step.messageTemplate || ''} onInsert={(val) => updateStep(step.id, { messageTemplate: val })} />
                                  {isInvite && (
                                    <span className={cn("text-xs", (step.messageTemplate?.length || 0) > 300 ? "text-destructive font-medium" : "text-muted-foreground")}>
                                      {step.messageTemplate?.length || 0}/300
                                    </span>
                                  )}
                                </div>
                              </div>
                              <Textarea id={fieldId('message')} ref={messageRef} value={step.messageTemplate || ''} onChange={(e) => updateStep(step.id, { messageTemplate: e.target.value })} placeholder={isInvite ? "Note d'invitation (300 caractères au plus)" : "Bonjour {{first_name}}, ..."} rows={isInvite ? 2 : 3} maxLength={isInvite ? 300 : undefined} className={cn("mt-1.5", isInvite && (step.messageTemplate?.length || 0) > 300 && "border-destructive")} />
                              {isInvite && (
                                <p className="text-xs text-muted-foreground mt-1">Note facultative. Sans note, l'invitation part seule.</p>
                              )}

                              <UnknownVariablesNotice text={`${needsSubject(step.actionType) ? step.subjectTemplate || '' : ''} ${step.messageTemplate || ''}`} customKeys={customKeyList} />

                              {/* Aperçu : mêmes variables que le moteur ; une variable qu'il ne connaît pas apparaît vide. */}
                              {(step.messageTemplate || '').includes('{{') && (
                                <details className="mt-2 group">
                                  <summary className="cursor-pointer text-xs text-muted-foreground hover:text-foreground select-none flex items-center gap-1">
                                    <Eye className="w-3 h-3" aria-hidden="true" />
                                    Aperçu (exemple « Laurent Garilhe / Konekt »)
                                  </summary>
                                  <div className="mt-2 p-3 bg-muted/30 border border-border rounded-lg text-xs whitespace-pre-wrap text-foreground">
                                    {renderTemplatePreview(step.messageTemplate || '', customValues)
                                      || 'Saisissez votre message ci-dessus pour voir l\'aperçu.'}
                                  </div>
                                </details>
                              )}
                            </div>
                          </>
                        )}

                        {step.actionType === 'email' && !usesAi && (
                          <div className="space-y-3 pt-2 border-t border-border">
                            <Collapsible>
                              <CollapsibleTrigger className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1">▸ Copie (CC / CCI)</CollapsibleTrigger>
                              <CollapsibleContent className="space-y-2 pt-2">
                                <div>
                                  <Label htmlFor={fieldId('cc')} className="text-xs">CC</Label>
                                  <Input id={fieldId('cc')} value={(step.ccEmails || []).join(', ')} onChange={(e) => updateStep(step.id, { ccEmails: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="email1@ex.com" className="mt-1 h-8 text-xs" />
                                </div>
                                <div>
                                  <Label htmlFor={fieldId('bcc')} className="text-xs">CCI</Label>
                                  <Input id={fieldId('bcc')} value={(step.bccEmails || []).join(', ')} onChange={(e) => updateStep(step.id, { bccEmails: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="email@ex.com" className="mt-1 h-8 text-xs" />
                                </div>
                              </CollapsibleContent>
                            </Collapsible>
                            <div className="flex items-center justify-between">
                              <Label htmlFor={fieldId('unsubscribe')} className="text-xs">Lien de désinscription</Label>
                              <Switch id={fieldId('unsubscribe')} checked={step.includeUnsubscribe ?? false} onCheckedChange={(checked) => updateStep(step.id, { includeUnsubscribe: checked })} />
                            </div>
                            <div>
                              <Label htmlFor={fieldId('signature')} className="text-xs">Signature</Label>
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
          <div className={cn("mt-4 p-5 border border-dashed rounded-lg", sequence.steps.length === 0 ? "border-border bg-muted/20" : "border-border bg-muted/10")}>
            <div className="flex items-center justify-between mb-4">
              <span className="font-medium text-sm">{sequence.steps.length === 0 ? 'Commencer par ajouter une étape' : 'Ajouter une étape'}</span>
              {sequence.steps.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setShowStepPicker(false)} aria-label="Fermer le choix d'étape"><X className="w-4 h-4" aria-hidden="true" /></Button>
              )}
            </div>
            {hasNoOptions ? (
              <div className="text-center py-4 text-muted-foreground text-sm">Toutes les étapes possibles sont ajoutées.</div>
            ) : (
              <>
                {availableActions.length > 0 && (
                  <div className="mb-4">
                    <div className="flex items-center gap-2 mb-2"><Zap className="w-4 h-4" aria-hidden="true" /><span className="text-xs font-semibold uppercase text-muted-foreground">Actions</span></div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {availableActions.map(action => (
                        <button type="button" key={action.value} onClick={() => addStep(action.value)} className="flex items-center gap-2 p-3 border border-border rounded-lg hover:border-border hover:bg-muted/30 transition-all text-left group">
                          <div className={cn("w-8 h-8 flex items-center justify-center shrink-0", action.color)}><action.icon className="w-4 h-4" aria-hidden="true" /></div>
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
                    <div className="flex items-center gap-2 mb-2"><Timer className="w-4 h-4" aria-hidden="true" /><span className="text-xs font-semibold uppercase text-muted-foreground">Attentes et conditions</span></div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                      {availableTriggers.map(trigger => (
                        <button type="button" key={trigger.value} onClick={() => addStep(trigger.value)} className="flex items-center gap-2 p-3 border border-border rounded-lg hover:border-border hover:bg-muted/30 transition-all text-left group">
                          <div className={cn("w-8 h-8 flex items-center justify-center shrink-0", trigger.color)}><trigger.icon className="w-4 h-4" aria-hidden="true" /></div>
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
          <Plus className="w-4 h-4 mr-2" aria-hidden="true" />Ajouter une étape
        </Button>
      )}
    </div>
  );

  // Offre sans envoi : la séquence créée sera désactivée (annoncé avant d'enregistrer).
  const renderPlanNotice = () => (!isEditing && !canSendSequences ? (
    <div className="p-3 border border-warning/30 bg-warning/10 text-warning text-xs rounded-md">
      L'envoi de séquences nécessite un abonnement : la séquence sera enregistrée désactivée. Vous pourrez l'activer après avoir choisi une offre.
    </div>
  ) : null);

  // Modification d'une séquence qui a des candidats en cours : effet des changements.
  const renderActiveEnrollmentsBanner = () => (isEditing && (activeEnrollmentCount ?? 0) > 0 ? (
    <div role="note" className="flex items-start gap-2 p-3 border border-info/30 bg-info/10 text-xs rounded-md">
      <Users className="w-4 h-4 shrink-0 text-info mt-0.5" aria-hidden="true" />
      <p>
        {activeEnrollmentCount === 1
          ? '1 candidat est en cours dans cette séquence.'
          : `${activeEnrollmentCount} candidats sont en cours dans cette séquence.`}
        {' '}Un texte modifié s'applique à leurs prochains envois. Un délai modifié ne s'applique qu'aux étapes pas encore programmées. Supprimer une étape annule les envois prévus sur cette étape.
      </p>
    </div>
  ) : null);

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
              <p className="text-sm text-muted-foreground">Choisissez qui envoie les messages. Avec plusieurs expéditeurs, les nouveaux candidats sont répartis entre leurs comptes LinkedIn.</p>
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
            {renderActiveEnrollmentsBanner()}
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
                  className="border-border"
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
                <VisualSequenceEditor steps={sequence.steps} onStepsChange={(newSteps) => setSequence(prev => ({ ...prev, steps: newSteps }))} onRemoveStep={requestRemoveStep} />
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
              value={sequence.stopConditions || DEFAULT_STOP_CONDITIONS}
              onChange={(stopConditions) => setSequence(prev => ({ ...prev, stopConditions }))}
            />
            {/* Attribution élevée : ce chiffre répartit les nouveaux candidats, les plafonds d'envoi restent ceux du compte. */}
            {sequence.multiSenderEnabled && sequence.senderAccounts && sequence.senderAccounts.some(s => s.daily_limit > HIGH_SENDER_DAILY_LIMIT) && (
              <div className="p-3 border border-amber-500/30 bg-warning/10 text-warning text-xs">
                <div className="flex items-center gap-2 font-medium mb-1"><Shield className="w-3.5 h-3.5" aria-hidden="true" />Attribution élevée</div>
                <p>Un ou plusieurs expéditeurs reçoivent de nouveaux candidats jusqu'à plus de {HIGH_SENDER_DAILY_LIMIT} actions LinkedIn par jour. Les plafonds d'envoi LinkedIn du compte (Paramètres, Équipe) s'appliquent quand même.</p>
              </div>
            )}
            {/* Channel alerts */}
            {(() => {
              const hasEmail = sequence.steps.some(s => s.actionType === 'email');
              const hasWhatsapp = sequence.steps.some(s => s.actionType === 'whatsapp_message');
              if (!hasEmail && !hasWhatsapp) return null;
              return (
                <div className="p-3 border border-warning/30 bg-warning/10 text-warning text-xs space-y-2">
                  <div className="flex items-center gap-2 font-medium"><Mail className="w-3.5 h-3.5" />Canaux non pris en charge</div>
                  {hasEmail && <p>{unsupportedStepNotice('email')}</p>}
                  {hasWhatsapp && <p>{unsupportedStepNotice('whatsapp_message')}</p>}
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
              <p className="text-sm text-muted-foreground">Vérifiez que tout est prêt avant d'enregistrer la séquence.</p>
            </div>
            {renderPlanNotice()}

            {/* Summary card */}
            <div className="border border-border rounded-lg p-5 space-y-4">
              <div className="flex items-center justify-between">
                <span className="text-sm font-bold uppercase">{sequence.name || '(Sans nom)'}</span>
                <Badge variant="outline" className="rounded-full">{sequence.steps.length} étapes</Badge>
              </div>
              {sequence.description && <p className="text-xs text-muted-foreground">{sequence.description}</p>}

              {/* Parcours : chaque étape avec sa branche et sa variante, au lieu d'une suite à plat. */}
              <div className="border border-border p-3 bg-muted/20">
                <div className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-2">Parcours</div>
                <ol className="space-y-1">
                  {[...sequence.steps]
                    .sort((a, b) => a.order - b.order || String(a.variantGroup ?? '').localeCompare(String(b.variantGroup ?? '')))
                    .slice(0, 30)
                    .map(step => {
                      const sc = ALL_STEP_TYPES.find(a => a.value === step.actionType);
                      const Icon = sc?.icon || Mail;
                      return (
                        <li key={step.id} className="flex items-center gap-2 flex-wrap text-xs">
                          <span className={cn("w-5 h-5 flex items-center justify-center shrink-0", sc?.color || "bg-muted")}>
                            <Icon className="w-3 h-3" aria-hidden="true" />
                          </span>
                          <span className="text-muted-foreground tabular-nums">Étape {step.order + 1}</span>
                          <span className="font-medium">{typeLabel(step.actionType) ?? step.actionType}</span>
                          {(branchBadges.get(step.id) ?? []).map(badge => (
                            <span key={badge} className="text-[10px] px-1.5 py-0.5 rounded-md border border-border bg-background text-muted-foreground">{badge}</span>
                          ))}
                          {step.variantGroup && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded-md border border-border bg-background text-muted-foreground">Variante {step.variantGroup}</span>
                          )}
                        </li>
                      );
                    })}
                </ol>
                {sequence.steps.length > 30 && <p className="text-xs text-muted-foreground mt-1">et {sequence.steps.length - 30} autres</p>}
              </div>
            </div>

            {/* Validation checklist : mêmes bloquants que l'enregistrement, recalculés à chaque modification. */}
            <SequenceValidationChecklist sequence={sequence} />
          </div>
        );
    }
  };

  // ── Full-screen portal ──
  const content = (
    <div className="fixed inset-0 z-[4000] bg-background flex flex-col">
      {/* Top bar — clean, minimal */}
      <div className="h-12 sm:h-14 border-b border-border/60 flex items-center justify-between px-3 sm:px-5 shrink-0 bg-background relative z-10">
        <div className="flex items-center gap-2 sm:gap-4 min-w-0">
          <button
            type="button"
            onClick={handleBack}
            aria-label="Retour à la liste"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors shrink-0 p-1 -m-1"
          >
            <ArrowLeft className="w-4 h-4" aria-hidden="true" />
            <span className="hidden sm:inline">Retour</span>
          </button>
          <div className="w-px h-6 bg-border hidden sm:block" />
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs sm:text-sm font-semibold truncate">
              {isEditing ? 'Modifier' : 'Nouvelle séquence'}
            </span>
            {sequence.name && (
              <span className="text-xs sm:text-sm text-muted-foreground truncate max-w-[100px] sm:max-w-[200px] hidden sm:inline">{sequence.name}</span>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2 sm:gap-3 shrink-0">
          {/* Mode toggle — pill style */}
          <div className="flex items-center bg-muted rounded-full p-0.5" role="group" aria-label="Mode d'édition">
            <button
              type="button"
              aria-pressed={mode === 'wizard'}
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
              type="button"
              aria-pressed={mode === 'expert'}
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
            onClick={() => { void handleSave(); }}
            disabled={isSaving || !sequence.name.trim() || sequence.steps.length === 0}
            size="sm"
            className="h-8 px-4 text-xs gap-1.5"
          >
            {isSaving ? 'Enregistrement...' : <><Save className="w-3.5 h-3.5" aria-hidden="true" />Enregistrer</>}
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
                  Vérification
                </div>
                <SequenceValidationChecklist sequence={sequence} />
              </>
            )}
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 overflow-y-auto bg-background">
          <div className="p-4 sm:p-8 max-w-3xl mx-auto">
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
                {/* Sous 1024 px, la colonne de vérification est masquée : volet repliable en tête. */}
                <Collapsible open={mobileChecklistOpen} onOpenChange={setMobileChecklistOpen} className="lg:hidden border border-border rounded-lg">
                  <CollapsibleTrigger className="w-full flex items-center justify-between gap-2 px-3 py-2.5 text-left text-xs font-medium">
                    <span className={cn(validation.errors.length > 0 ? "text-destructive" : "text-foreground")}>
                      {validation.errors.length > 0
                        ? `Vérification : ${validation.errors.length} point${validation.errors.length > 1 ? 's' : ''} à corriger`
                        : 'Vérification : prête à être enregistrée'}
                    </span>
                    <ChevronDown className={cn("w-4 h-4 shrink-0 transition-transform", mobileChecklistOpen && "rotate-180")} aria-hidden="true" />
                  </CollapsibleTrigger>
                  <CollapsibleContent className="px-3 pb-3">
                    <SequenceValidationChecklist sequence={sequence} />
                  </CollapsibleContent>
                </Collapsible>

                {renderActiveEnrollmentsBanner()}
                {renderPlanNotice()}

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
                  value={sequence.stopConditions || DEFAULT_STOP_CONDITIONS}
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
                {sequence.steps.length === 0 && !isEditing && (
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
                    <VisualSequenceEditor steps={sequence.steps} onStepsChange={(newSteps) => setSequence(prev => ({ ...prev, steps: newSteps }))} onRemoveStep={requestRemoveStep} />
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
        <div className="h-14 sm:h-16 border-t border-border/60 flex items-center justify-between px-4 sm:px-8 shrink-0 bg-background relative z-10">
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
            {WIZARD_ORDER.map((step) => (
              <button
                type="button"
                key={step}
                onClick={() => setWizardStep(step)}
                aria-label={`Aller à l'étape ${WIZARD_STEPS.find(w => w.id === step)?.label ?? step}`}
                aria-current={step === wizardStep ? 'step' : undefined}
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

          {/* Un seul geste : « Enregistrer », comme dans la barre du haut. L'ancien
              « Activer » faisait la même chose sous un autre nom. */}
          {wizardStep === 'review' ? (
            <Button
              onClick={() => { void handleSave(); }}
              disabled={isSaving || !sequence.name.trim() || sequence.steps.length === 0}
              size="sm"
              className="h-8 px-5 text-xs gap-1.5"
            >
              {isSaving ? 'Enregistrement...' : <><Save className="w-3.5 h-3.5" aria-hidden="true" />Enregistrer</>}
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

      {/* Retour avec des modifications non enregistrées */}
      <AlertDialog open={confirmLeave} onOpenChange={setConfirmLeave}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Quitter sans enregistrer ?</AlertDialogTitle>
            <AlertDialogDescription>
              {sequence.name.trim()
                ? `Vos modifications de « ${sequence.name.trim()} » seront perdues.`
                : 'Vos modifications seront perdues.'}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Continuer la modification</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={onClose}>
              Quitter sans enregistrer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Étape déjà exécutée : son historique est conservé, elle ne se supprime pas */}
      <AlertDialog open={historyOpen} onOpenChange={setHistoryOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{historyBlock?.title}</AlertDialogTitle>
            <AlertDialogDescription>
              {`Elle a déjà été envoyée ou traitée pour des candidats de cette séquence (${historyBlock?.count ?? 0} fois). Son historique doit être conservé : elle ne pourra pas être supprimée à l'enregistrement. Modifiez plutôt son contenu.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Garder l'étape</AlertDialogCancel>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Points non bloquants à confirmer avant d'enregistrer */}
      <AlertDialog open={warningsOpen} onOpenChange={setWarningsOpen}>
        <AlertDialogContent className="max-h-[85vh] overflow-y-auto">
          <AlertDialogHeader>
            <AlertDialogTitle>Enregistrer malgré ces points ?</AlertDialogTitle>
            <AlertDialogDescription>
              La séquence ne fera pas tout ce qui est affiché :
            </AlertDialogDescription>
          </AlertDialogHeader>
          <ul className="space-y-1.5 text-sm list-disc pl-5">
            {pendingWarnings.map((warning, i) => <li key={i}>{warning}</li>)}
          </ul>
          <AlertDialogFooter>
            <AlertDialogCancel>Revenir à la séquence</AlertDialogCancel>
            <AlertDialogAction onClick={() => { void handleSave({ skipWarnings: true, removalConfirmed: true }); }}>
              Enregistrer quand même
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Étapes supprimées alors que des candidats sont en cours */}
      <AlertDialog open={removalConfirmOpen} onOpenChange={setRemovalConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {pendingRemovedCount > 1 ? `Supprimer ${pendingRemovedCount} étapes ?` : 'Supprimer cette étape ?'}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {activeEnrollmentCount && activeEnrollmentCount > 0
                ? `${activeEnrollmentCount === 1 ? '1 candidat est en cours' : `${activeEnrollmentCount} candidats sont en cours`} dans cette séquence. `
                : ''}
              Les envois prévus sur {pendingRemovedCount > 1 ? 'ces étapes' : 'cette étape'} seront annulés. Les candidats qui l'attendaient reprendront à l'étape suivante.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Revenir à la séquence</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={() => { void handleSave({ removalConfirmed: true }); }}
            >
              Supprimer et enregistrer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );

  return createPortal(content, document.body);
});

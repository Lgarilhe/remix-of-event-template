import React, { useState, useMemo, useRef, useCallback, useEffect } from 'react';
import {
  saveEditorDraft,
  loadEditorDraft,
  clearEditorDraft,
  editorDraftSavedAt,
} from '@/lib/editorDraft';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
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
import { getConditionsForActionType, isCrossChannelCondition, engagementConditionHint, retiredConditionNotice } from './sequence/conditionTypes';
import { VariableInserter, UnknownVariablesNotice } from './sequence/VariableInserter';
import { useEmailSignatures } from '@/hooks/useEmailSignatures';
import { sequenceActionLabel, formatStepDelay } from '@/lib/sequenceCatalog';
import { AI_STEP_STYLE_NOTICE } from '@/lib/writingStyle';
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
  AlertCircle,
  AlertTriangle,
  CheckCircle2,
  ChevronRight,
  ListChecks,
  Shield,
  Users,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { VisualSequenceEditor } from './sequence/VisualSequenceEditor';
import { StopConditionsSettings } from './sequence/StopConditionsSettings';
import { MultiSenderSettings } from './sequence/MultiSenderSettings';
import { useMultiSenderTeam, linkedSenderIdsOf } from './sequence/useMultiSenderTeam';
import {
  SequenceWizardStepper,
  SequenceWizardStepperCompact,
  WizardStep,
  WIZARD_STEPS,
} from './sequence/SequenceWizardStepper';
import { SequenceValidationChecklist } from './sequence/SequenceValidationChecklist';
import { plural } from '@/lib/plural';
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
  delaySentence,
  SEND_WINDOW_HELP,
  sequenceDraftKey,
  LEGACY_SEQUENCE_DRAFT_KEY,
  addVariantToSteps,
  timeoutTargetOptions,
  hasBackwardTimeoutTarget,
  validateSequence,
  branchBadgesByStep,
  stepLabel,
  HIGH_SENDER_DAILY_LIMIT,
  type SequenceArea,
} from './sequence/sequenceGraph';

import type { SequenceStep, StopConditions, Sequence } from '@/types/sequence';
// « Séquence recommandée » : le modèle Konekt « Séquence longue (17 étapes) » (lot 5c-2).
import { generateRecommendedSequence } from '@/lib/sequenceStarterTemplates';

// Types sortis au lot 5c-1 dans src/types/sequence.ts, réexportés jusqu'au lot 5j
// pour les fichiers voués au retrait (StepEditor, WorkflowCanvas,
// nodes/WorkflowStepNode, VisualSequenceEditor, SequenceValidationChecklist).
export type { SequenceStep, StopConditions, SenderAccountConfig, Sequence } from '@/types/sequence';

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

// ACTIONS = ce qu'on FAIT. Noms : ceux de l'éditeur (sequenceGraph.ts), les mêmes
// en Liste et en Visuel ; icônes : catalogue des séquences (SequenceBadges).
const ACTIONS = [
  { value: 'connection_request', label: STEP_TYPE_LABELS.connection_request, description: 'Envoyer une demande de connexion', requiresPrevious: [], excludeIfPrevious: ['connection_request'], requiresConnection: false },
  { value: 'inmail', label: STEP_TYPE_LABELS.inmail, description: 'Envoyer un InMail (payant)', requiresPrevious: [], excludeIfPrevious: [], requiresConnection: false },
  { value: 'email', label: STEP_TYPE_LABELS.email, description: 'Envoyer un e-mail', requiresPrevious: [], excludeIfPrevious: [], requiresConnection: false },
  { value: 'profile_visit', label: STEP_TYPE_LABELS.profile_visit, description: 'Visiter le profil du candidat', requiresPrevious: [], excludeIfPrevious: [], requiresConnection: false },
  { value: 'message', label: STEP_TYPE_LABELS.message, description: 'Message direct (relation du 1er degré)', requiresPrevious: [], excludeIfPrevious: [], requiresConnection: true },
  { value: 'smart_message', label: STEP_TYPE_LABELS.smart_message, description: 'Message IA, InMail si non connecté', requiresPrevious: [], excludeIfPrevious: [], requiresConnection: true },
  { value: 'whatsapp_message', label: STEP_TYPE_LABELS.whatsapp_message, description: 'Envoyer un message WhatsApp', requiresPrevious: [], excludeIfPrevious: [], requiresConnection: false },
];

// TRIGGERS = ce qu'on ATTEND (attentes et conditions)
const TRIGGERS = [
  { value: 'check_connection', label: STEP_TYPE_LABELS.check_connection, description: 'Deux branches selon la relation', requiresPrevious: [], excludeIfPrevious: [] },
  { value: 'wait_connection', label: STEP_TYPE_LABELS.wait_connection, description: 'Jusqu\'à l\'acceptation de l\'invitation', waitEvent: 'connection_accepted', requiresPrevious: ['connection_request'], excludeIfPrevious: ['wait_connection'] },
  { value: 'wait_reply', label: STEP_TYPE_LABELS.wait_reply, description: 'Jusqu\'à une réponse', waitEvent: 'reply_received', requiresPrevious: ['inmail', 'email', 'message', 'smart_message', 'whatsapp_message'], excludeIfPrevious: [] },
  { value: 'wait_profile_visit', label: STEP_TYPE_LABELS.wait_profile_visit, description: 'Visite du profil en retour', waitEvent: 'profile_visited', requiresPrevious: ['profile_visit'], excludeIfPrevious: [] },
];

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

const isAction = (actionType: string) => ACTIONS.some(a => a.value === actionType);
const isTrigger = (actionType: string) => TRIGGERS.some(t => t.value === actionType);
// Champ texte présent (la note d'invitation reste facultative, voir validateSequence).
const needsMessage = stepHasMessageField;
// E-mail, InMail et Message IA (qui part en InMail hors relation).
const needsSubject = stepNeedsSubject;
const canABTest = (type: string) => ['inmail', 'email', 'message', 'smart_message', 'connection_request', 'whatsapp_message'].includes(type);

/** Nom d'un type d'étape dans l'éditeur (le même en Liste et en Visuel), jamais la clé technique. */
const typeLabel = (actionType: string): string => STEP_TYPE_LABELS[actionType] ?? sequenceActionLabel(actionType);

/** Seuil de score : un nombre de 0 à 100 (revue design D-40). */
const scoreThresholdError = (value?: string) => {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return 'Indiquez un seuil entre 0 et 100.';
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > 100) return 'Le seuil doit être compris entre 0 et 100.';
  return null;
};

const stepOptionLabel = (s: SequenceStep) => `Étape ${s.order + 1}${s.variantGroup ? ` (${s.variantGroup})` : ''} : ${typeLabel(s.actionType)}`;

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

const MODE_OPTIONS: SegmentedOption<'wizard' | 'expert'>[] = [
  { value: 'wizard', label: 'Guidé' },
  { value: 'expert', label: 'Expert' },
];

/** Séquence vide d'une création (et de « Repartir de zéro »). */
const EMPTY_SEQUENCE: Sequence = { name: '', description: '', steps: [], isActive: true };

/** Valeur affichée par défaut dans « Garde-fous » : c'est aussi celle qui est enregistrée. */
const DEFAULT_STOP_CONDITIONS: StopConditions = { on_reply: true, on_click: false, on_unsubscribe: true, on_meeting_booked: false };

/** Exécutions qui font partie de l'historique d'une étape (elle ne peut plus être supprimée). */
const HISTORY_EXECUTION_STATUSES = ['sent', 'opened', 'clicked', 'replied', 'bounced', 'failed', 'skipped'];

/** Exemple de l'aperçu (revue design D-36), tiré des mêmes valeurs que l'aperçu lui-même. */
const PREVIEW_EXAMPLE_LABEL = renderTemplatePreview('{{first_name}} {{last_name}}, {{company}}');

/** Sous 1 024 px, la colonne de vérification est masquée (classe lg:hidden de la barre d'outils). */
const SMALL_SCREEN_QUERY = '(max-width: 1023px)';

const hasContent = (s: Sequence) => !!(s.name.trim() || s.description?.trim() || s.steps.length > 0);

/** Choix d'un type d'étape : icône du catalogue et nom de l'éditeur, en neutre (revue design D-35). */
function StepTypeOption({ value, label, description, onPick }: { value: string; label: string; description: string; onPick: (value: string) => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => onPick(value)}
      className="h-auto justify-start gap-3 whitespace-normal rounded-xl border border-border p-3 text-left font-normal hover:border-foreground"
    >
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted text-foreground">
        <SequenceActionIcon type={value} className="h-4 w-4" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-foreground">{label}</span>
        <span className="block text-xs text-muted-foreground">{description}</span>
      </span>
    </Button>
  );
}

interface VariantEditorProps {
  variant: SequenceStep;
  onUpdate: (updates: Partial<SequenceStep>) => void;
  onRemove: () => void;
  removing: boolean;
  customKeys: string[];
}

/** Une variante A/B : part des envois, IA, objet et message, avec le menu Variables. */
const VariantEditor: React.FC<VariantEditorProps> = ({ variant: v, onUpdate, onRemove, removing, customKeys }) => {
  const subjectRef = useRef<HTMLInputElement>(null);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const aiAllowed = stepAllowsAi(v.actionType);
  const usesAi = aiAllowed && v.useAiPersonalization;
  const isInvite = v.actionType === 'connection_request';
  const fieldId = (name: string) => `variant-${v.id}-${name}`;
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3">
        <Label htmlFor={fieldId('weight')} className="whitespace-nowrap text-xs font-normal text-muted-foreground">Part des envois (%)</Label>
        <Input
          id={fieldId('weight')}
          type="number"
          min={1}
          max={100}
          value={v.variantWeight ?? ''}
          onChange={(e) => { const n = parseInt(e.target.value); onUpdate({ variantWeight: Number.isFinite(n) ? n : undefined }); }}
          className="h-8 w-20 text-xs"
        />
        {v.variantGroup !== 'A' && (
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                type="button"
                variant="ghost"
                size="icon-sm"
                className="ml-auto text-muted-foreground hover:text-danger max-md:h-11 max-md:w-11"
                onClick={onRemove}
                disabled={removing}
                aria-label={`Supprimer la variante ${v.variantGroup}`}
              >
                <Trash2 aria-hidden="true" />
              </Button>
            </TooltipTrigger>
            <TooltipContent>Supprimer la variante</TooltipContent>
          </Tooltip>
        )}
      </div>
      {aiAllowed && (
        <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
          <Label htmlFor={fieldId('ai')} className="cursor-pointer text-xs">Rédaction par l'IA</Label>
          <Switch id={fieldId('ai')} checked={v.useAiPersonalization} onCheckedChange={(checked) => onUpdate({ useAiPersonalization: checked })} />
        </div>
      )}
      {!usesAi && (
        <>
          {needsSubject(v.actionType) && (
            <div>
              <div className="flex items-center justify-between">
                <Label htmlFor={fieldId('subject')} className="text-xs font-normal text-muted-foreground">Objet</Label>
                <VariableInserter targetRef={subjectRef} currentValue={v.subjectTemplate || ''} onInsert={(val) => onUpdate({ subjectTemplate: val })} fieldLabel="l'objet" />
              </div>
              <Input
                id={fieldId('subject')}
                ref={subjectRef}
                value={v.subjectTemplate || ''}
                onChange={(e) => onUpdate({ subjectTemplate: e.target.value })}
                placeholder={v.actionType === 'smart_message' ? 'Objet si le message part en InMail' : 'Objet'}
                aria-invalid={!v.subjectTemplate?.trim() ? true : undefined}
                className={cn('mt-1 h-8 text-xs', !v.subjectTemplate?.trim() && 'border-danger')}
              />
            </div>
          )}
          <div>
            <div className="flex items-center justify-between">
              <Label htmlFor={fieldId('message')} className="text-xs font-normal text-muted-foreground">{isInvite ? "Note d'invitation" : 'Message'}</Label>
              <VariableInserter targetRef={messageRef} currentValue={v.messageTemplate || ''} onInsert={(val) => onUpdate({ messageTemplate: val })} fieldLabel={isInvite ? "la note d'invitation" : 'le message'} />
            </div>
            <Textarea id={fieldId('message')} ref={messageRef} value={v.messageTemplate || ''} onChange={(e) => onUpdate({ messageTemplate: e.target.value })} placeholder="Bonjour {{first_name}}, ..." rows={2} maxLength={isInvite ? 300 : undefined} className="mt-1 text-xs" />
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
    // Les garde-fous affichés par défaut sont ceux qui seront enregistrés (revue design D-30).
    const initial = { ...base, stopConditions: base.stopConditions ?? DEFAULT_STOP_CONDITIONS };
    return {
      ...initial,
      // Invitation « IA » (option retirée) : la note saisie est celle qui part.
      steps: withoutInvitationAi(initial.steps),
      // Réponse et désinscription arrêtent toujours la séquence.
      stopConditions: withAlwaysOnStops(initial.stopConditions),
    };
  });
  // État de départ, pour savoir si « Retour » perdrait quelque chose (revue design D-31).
  const etatInitialRef = useRef<string | null>(null);
  if (etatInitialRef.current === null) etatInitialRef.current = JSON.stringify(sequence);
  const isDirty = useMemo(() => JSON.stringify(sequence) !== etatInitialRef.current, [sequence]);
  const [confirmLeave, setConfirmLeave] = useState<null | 'changes' | 'draft-lost'>(null);
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
  const [saveFailed, setSaveFailed] = useState(false);
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
  const contentRef = useRef<HTMLDivElement>(null);
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

  // Une modification efface l'échec d'enregistrement affiché : la vérification
  // reste le guide en direct.
  useEffect(() => {
    setSaveFailed(false);
  }, [sequence]);

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

  // Comptes LinkedIn reliés à l'équipe, pour vérifier les expéditeurs de la
  // rotation (null tant que l'équipe n'est pas lue : rien n'est alors signalé).
  const senderTeam = useMultiSenderTeam(!!sequence.multiSenderEnabled && (sequence.senderAccounts?.length ?? 0) > 0);
  const linkedSenderIds = useMemo(
    () => (senderTeam.isSuccess ? linkedSenderIdsOf(senderTeam.data) : null),
    [senderTeam.isSuccess, senderTeam.data],
  );

  // Vérification unique : liste de vérification, fil du mode Guidé et
  // enregistrement lisent la même fonction.
  const validation = useMemo(() => validateSequence(sequence, linkedSenderIds), [sequence, linkedSenderIds]);

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

  // Retour : en modification, ne rien perdre sans le dire. Une création garde
  // son brouillon (écrit tout de suite) et l'annonce ; si le navigateur ne
  // peut pas le conserver, on demande avant de perdre la saisie.
  const handleBack = () => {
    if (isEditing && JSON.stringify(sequence) !== etatInitialRef.current) {
      setConfirmLeave('changes');
      return;
    }
    if (!isEditing && JSON.stringify(sequence) !== etatInitialRef.current && hasContent(sequence)) {
      if (draftKey) writeDraftNow();
      if (!draftKey || !loadEditorDraft<Sequence>(draftKey)) {
        setConfirmLeave('draft-lost');
        return;
      }
      toast.info('Brouillon conservé', {
        description: 'Vous le retrouverez à la prochaine création de séquence, dans ce navigateur.',
      });
    }
    onClose();
  };

  /** « Retour », Échap et fermeture de la fenêtre passent par la même garde (revue design D-31). */
  const requestClose = () => {
    if (isSaving) return;
    handleBack();
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

    // Mêmes règles que la liste de vérification et le fil du mode Guidé
    // (validateSequence) : délais, seuil de score, fenêtre d'envoi, poids des
    // tests A/B, enchaînement des étapes (validateStepGraph), étapes de repli.
    const errors: string[] = validateSequence(sequence, linkedSenderIds).errors.map(issue => issue.message);

    if (errors.length > 0) {
      if (mode === 'wizard') setWizardStep('review');
      // Sous 1 024 px, la vérification n'est pas à l'écran : on l'ouvre.
      else if (window.matchMedia(SMALL_SCREEN_QUERY).matches) setMobileChecklistOpen(true);
      toast.error(`${plural(errors.length, 'point')} à corriger`, {
        description: errors[0] + (errors.length > 1 ? ` (et ${plural(errors.length - 1, 'autre')})` : ''),
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
    setSaveFailed(false);
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
      setSaveFailed(true);
      // La liste des séquences traduit les refus de la base en phrases
      // (sequenceSaveError) : jamais le texte technique brut.
      const reason = err instanceof Error && err.message ? err.message : null;
      toast.error('Erreur à l\'enregistrement', {
        description: reason ?? 'Vos modifications sont toujours là. Vérifiez votre connexion, puis réessayez.',
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

  const loadRecommendedSequence = () => {
    const steps = generateRecommendedSequence();
    setSequence(prev => ({ ...prev, steps }));
    setShowStepPicker(false);
    setExpandedStepId(steps[0]?.id || null);
  };

  // Libellé lu par les tests de bout en bout de l'audit (« 2 étape(s) configurée(s) »).
  const stepsCountLabel = sequence.steps.length > 0 ? `${sequence.steps.length} étape(s) configurée(s)` : "Aucune étape pour l'instant";

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
          const label = typeLabel(step.actionType);
          const kindLabel = !stepIsTrigger ? 'Action' : step.actionType === 'check_connection' ? 'Condition' : 'Attente';
          const panelId = `step-panel-${step.id}`;
          const fieldId = (name: string) => `step-${step.id}-${name}`;
          const delayLabel = formatStepDelay(step.delayDays, step.delayHours, step.delayMinutes);
          const badges = branchBadges.get(step.id) ?? [];
          // Invitation : pas de personnalisation IA, la note saisie est celle qui part.
          const aiAllowed = stepAllowsAi(step.actionType);
          const usesAi = aiAllowed && step.useAiPersonalization;
          const isInvite = step.actionType === 'connection_request';
          const unsupported = unsupportedStepNotice(step.actionType);
          const retiredNotice = retiredConditionNotice(step.conditionType);
          const engagementHint = engagementConditionHint(step.conditionType);
          const backwardTimeout = hasBackwardTimeoutTarget(step, sequence.steps);
          const currentTimeoutTarget = backwardTimeout ? sequence.steps.find(s => s.id === step.timeoutBranchStepId) : undefined;
          const scoreError = step.conditionType === 'if_score_above' ? scoreThresholdError(step.conditionValue) : null;
          // Badge « À compléter » : mêmes règles que l'enregistrement (la note d'invitation est facultative).
          const incompleteReasons = (() => {
            const rows = hasVariants ? variants : [step];
            const reasons = new Set<string>();
            for (const row of rows) {
              const manual = isManuallyWritten(row);
              if (stepRequiresMessage(row.actionType) && manual && !row.messageTemplate?.trim()) reasons.add('message');
              if (needsSubject(row.actionType) && manual && !row.subjectTemplate?.trim()) reasons.add('objet');
              if (row.actionType === 'connection_request' && (row.messageTemplate?.length || 0) > 300) reasons.add('note trop longue');
            }
            return [...reasons];
          })();

          return (
            <li key={step.id}>
              <Collapsible
                open={isExpanded}
                onOpenChange={(open) => setExpandedStepId(open ? step.id : null)}
                className={cn('overflow-hidden rounded-xl border bg-card transition-colors duration-150', isExpanded ? 'border-border-strong' : 'border-border')}
              >
                {/* En-tête d'étape : un bouton qui ouvre ou ferme le détail (revue design D-32) ;
                    les boutons A/B et suppression restent à côté, jamais imbriqués. */}
                <div className="flex items-center gap-1 pr-2">
                  <CollapsibleTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      aria-expanded={isExpanded}
                      aria-controls={isExpanded ? panelId : undefined}
                      className="group h-auto min-w-0 flex-1 justify-start gap-3 whitespace-normal rounded-xl p-3 text-left font-normal hover:bg-accent/40"
                    >
                      <ChevronRight className="h-4 w-4 transition-transform duration-150 group-data-[state=open]:rotate-90" aria-hidden="true" />
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-muted text-foreground">
                        <SequenceActionIcon type={step.actionType} className="h-4 w-4" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                          <span className="text-xs text-muted-foreground">Étape {stepNumber}</span>
                          <Badge variant="muted" className="px-1.5 py-0 text-3xs">{kindLabel}</Badge>
                          <span className="text-sm font-medium text-foreground">{label}</span>
                          {/* Branche réelle de l'étape : la liste montre sinon les branches à plat. */}
                          {badges.map(badge => (
                            <Badge key={badge} variant="outline" className="px-1.5 py-0 text-3xs font-normal text-muted-foreground">{badge}</Badge>
                          ))}
                          {hasVariants && (
                            <Badge variant="outline" className="px-1.5 py-0 text-3xs">
                              <FlaskConical className="h-3 w-3" aria-hidden="true" />
                              Variantes {variants.map(v => v.variantGroup).sort().join(', ')}
                            </Badge>
                          )}
                          {unsupported && (
                            <Badge variant="warning" className="px-1.5 py-0 text-3xs" title={unsupported}>
                              <AlertTriangle className="h-3 w-3" aria-hidden="true" />
                              Non pris en charge
                            </Badge>
                          )}
                          {step.variantGroup && !hasVariants && (
                            <Badge variant="danger" className="px-1.5 py-0 text-3xs">
                              Variante {step.variantGroup} seule
                            </Badge>
                          )}
                          {incompleteReasons.length > 0 && (
                            <Badge variant="danger" className="px-1.5 py-0 text-3xs">
                              <AlertCircle className="h-3 w-3" aria-hidden="true" />
                              À compléter : {incompleteReasons.join(', ')}
                            </Badge>
                          )}
                        </span>
                        {(delayLabel || usesAi || (stepIsTrigger && step.timeoutDays)) && (
                          <span className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-muted-foreground">
                            {delayLabel && (
                              <span className="inline-flex items-center gap-1"><Clock className="h-3 w-3 text-foreground" aria-hidden="true" />Après {delayLabel}</span>
                            )}
                            {usesAi && <span>Rédigé par l'IA</span>}
                            {stepIsTrigger && step.timeoutDays ? (
                              <span className="inline-flex items-center gap-1"><Hourglass className="h-3 w-3 text-foreground" aria-hidden="true" />Au plus {step.timeoutDays} j</span>
                            ) : null}
                          </span>
                        )}
                      </span>
                    </Button>
                  </CollapsibleTrigger>
                  {step.variantGroup && !hasVariants && (
                    <Button
                      type="button"
                      variant="ghost"
                      size="xs"
                      className="shrink-0 text-danger max-md:h-11"
                      onClick={() => updateStep(step.id, { variantGroup: undefined, variantWeight: undefined })}
                    >
                      Retirer le test A/B
                    </Button>
                  )}
                  {canABTest(step.actionType) && !hasVariants && !step.variantGroup && (
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          onClick={() => addVariant(step)}
                          className="shrink-0 max-md:h-11 max-md:w-11"
                          aria-label={`Créer un test A/B sur l'étape ${stepNumber}`}
                        >
                          <FlaskConical aria-hidden="true" />
                        </Button>
                      </TooltipTrigger>
                      <TooltipContent>Tester deux versions du message</TooltipContent>
                    </Tooltip>
                  )}
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        onClick={() => { void requestRemoveStep(step.id); }}
                        disabled={checkingRemoval}
                        className="shrink-0 text-muted-foreground hover:text-danger max-md:h-11 max-md:w-11"
                        aria-label={`Supprimer l'étape ${stepNumber}`}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>{hasVariants ? 'Supprimer l\'étape et ses variantes' : 'Supprimer l\'étape'}</TooltipContent>
                  </Tooltip>
                </div>

                <CollapsibleContent className="border-t border-border px-3 pb-4 pt-3 sm:px-4">
                  <div id={panelId} className="space-y-4">
                    {unsupported && (
                      <Banner tone="warning" icon={AlertTriangle} className="rounded-lg border">
                        {unsupported}
                      </Banner>
                    )}
                    {step.actionType === 'smart_message' && (
                      <p className="text-xs text-muted-foreground">{SMART_MESSAGE_INMAIL_HELP}</p>
                    )}

                    {/* Délai */}
                    {index > 0 && (
                      <fieldset className="[&_label]:text-xs [&_label]:font-normal [&_label]:text-muted-foreground">
                        <legend className="mb-1.5 text-sm font-medium text-foreground">Délai avant l'étape</legend>
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
                        <p className="mt-1.5 text-xs text-muted-foreground">{delaySentence(step)}</p>
                      </fieldset>
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
                          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warning">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            Cette condition ne fonctionne qu'avec des étapes e-mail.
                          </p>
                        )}
                        {engagementHint && (
                          <p className="mt-1.5 text-xs text-muted-foreground">{engagementHint}</p>
                        )}
                        {retiredNotice && (
                          <p className="mt-1.5 flex items-start gap-1.5 text-xs text-warning">
                            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            Cette condition n'est plus proposée : {retiredNotice}
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
                        <Button type="button" variant="ghost" size="xs" className="group -ml-2 gap-1 max-md:h-11">
                          <ChevronRight className="transition-transform duration-150 group-data-[state=open]:rotate-90" aria-hidden="true" />
                          Fenêtre d'envoi
                        </Button>
                      </CollapsibleTrigger>
                      <CollapsibleContent className="mt-2 space-y-2">
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label htmlFor={fieldId('hour-start')} className="text-xs font-normal text-muted-foreground">Heure de début</Label>
                            <Input id={fieldId('hour-start')} type="number" min={0} max={23} value={step.preferredHourStart} onChange={(e) => updateStep(step.id, { preferredHourStart: parseInt(e.target.value) || 9 })} className="mt-1.5" />
                          </div>
                          <div>
                            <Label htmlFor={fieldId('hour-end')} className="text-xs font-normal text-muted-foreground">Heure de fin</Label>
                            <Input id={fieldId('hour-end')} type="number" min={0} max={23} value={step.preferredHourEnd} onChange={(e) => updateStep(step.id, { preferredHourEnd: parseInt(e.target.value) || 18 })} className="mt-1.5" />
                          </div>
                        </div>
                        <p className="text-xs text-muted-foreground">{SEND_WINDOW_HELP}</p>
                      </CollapsibleContent>
                    </Collapsible>

                    {/* Attente : délai maximal et suite si rien ne se passe */}
                    {isTrigger(step.actionType) && step.actionType !== 'check_connection' && (
                      <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
                        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <Hourglass className="h-4 w-4" aria-hidden="true" />
                          Réglages de l'attente
                        </p>
                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          <div>
                            <Label htmlFor={fieldId('timeout')} className="text-xs font-normal text-muted-foreground">Attendre au plus (jours)</Label>
                            {/* Valeur réelle affichée : vide si rien n'est enregistré. */}
                            <Input
                              id={fieldId('timeout')}
                              type="number"
                              min={1}
                              value={step.timeoutDays ?? ''}
                              placeholder="3"
                              onChange={(e) => { const n = parseInt(e.target.value); updateStep(step.id, { timeoutDays: n > 0 ? n : undefined }); }}
                              aria-invalid={!step.timeoutDays ? true : undefined}
                              className={cn('mt-1.5', !step.timeoutDays && 'border-danger')}
                            />
                          </div>
                          <div>
                            <Label htmlFor={fieldId('timeout-action')} className="text-xs font-normal text-muted-foreground">Si rien ne se passe</Label>
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
                            <Label htmlFor={fieldId('timeout-target')} className="text-xs font-normal text-muted-foreground">Étape de repli</Label>
                            <Select value={step.timeoutBranchStepId || '__none__'} onValueChange={(value) => updateStep(step.id, { timeoutBranchStepId: value === '__none__' ? undefined : value })}>
                              <SelectTrigger
                                id={fieldId('timeout-target')}
                                aria-invalid={!step.timeoutBranchStepId || backwardTimeout ? true : undefined}
                                className={cn('mt-1.5', (!step.timeoutBranchStepId || backwardTimeout) && 'border-danger')}
                              >
                                <SelectValue placeholder="Choisir une étape" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="__none__">Choisir une étape</SelectItem>
                                {/* Seulement les étapes suivantes : une étape antérieure renverrait un message déjà parti. */}
                                {[...(currentTimeoutTarget ? [currentTimeoutTarget] : []), ...timeoutTargetOptions(step, sequence.steps)].map(s => (
                                  <SelectItem key={s.id} value={s.id}>{stepLabel(s)} : {typeLabel(s.actionType)}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            {!step.timeoutBranchStepId && (
                              <p className="mt-1 text-xs text-danger">Choisissez l'étape à exécuter si le délai est dépassé.</p>
                            )}
                            {backwardTimeout && (
                              <p className="mt-1 text-xs text-danger">Cette étape vient avant l'attente : un message déjà envoyé repartirait. Choisissez une étape suivante.</p>
                            )}
                          </div>
                        )}
                      </div>
                    )}

                    {/* Vérification de la connexion */}
                    {step.actionType === 'check_connection' && (
                      <div className="space-y-4 rounded-lg border border-border bg-muted/40 p-3">
                        <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                          <GitBranch className="h-4 w-4" aria-hidden="true" />
                          Selon la connexion
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
                        {!!step.ifTrueGotoStep !== !!step.ifFalseGotoStep && (
                          <p className="flex items-start gap-1.5 text-xs text-danger">
                            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                            La branche {step.ifTrueGotoStep ? 'Non connecté' : 'Connecté'} est vide : ces candidats partiraient dans l'autre branche. Choisissez une étape pour chaque cas, ou « Étape suivante » pour les deux.
                          </p>
                        )}
                      </div>
                    )}

                    {/* Message */}
                    {needsMessage(step.actionType) && (
                      <>
                        {hasVariants && (
                          <div className="overflow-hidden rounded-lg border border-border">
                            <div className="flex items-center justify-between gap-2 border-b border-border bg-muted/40 px-3 py-2">
                              <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                                <FlaskConical className="h-3.5 w-3.5" aria-hidden="true" />
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
                              {variants.map(v => (
                                <TabsContent key={v.id} value={v.id} className="mt-3">
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
                            {aiAllowed && (
                              <div className="flex items-center justify-between gap-3 rounded-lg border border-border bg-muted/40 px-3 py-2.5">
                                <div className="min-w-0">
                                  <Label htmlFor={fieldId('ai')} className="cursor-pointer">Rédaction par l'IA</Label>
                                  <p className="mt-1 text-xs text-muted-foreground">L'IA écrit un message pour chaque candidat.</p>
                                </div>
                                <Switch id={fieldId('ai')} checked={step.useAiPersonalization} onCheckedChange={(checked) => updateStep(step.id, { useAiPersonalization: checked })} />
                              </div>
                            )}

                            {usesAi ? (
                              <div>
                                {/* Lot 5e-2 : plus de ton par étape ; aiTone reste dans la charge enregistrée. */}
                                <p className="text-sm text-foreground-secondary">{AI_STEP_STYLE_NOTICE}</p>
                                <p className="mt-2 text-xs text-muted-foreground">Le message s'appuie sur le profil du candidat et le brief de la mission.</p>
                              </div>
                            ) : (
                              <>
                                {needsSubject(step.actionType) && (
                                  <div>
                                    <div className="flex items-center justify-between">
                                      <Label htmlFor={fieldId('subject')}>Objet</Label>
                                      <VariableInserter targetRef={subjectRef} currentValue={step.subjectTemplate || ''} onInsert={(val) => updateStep(step.id, { subjectTemplate: val })} fieldLabel="l'objet" />
                                    </div>
                                    <Input
                                      id={fieldId('subject')}
                                      ref={subjectRef}
                                      value={step.subjectTemplate || ''}
                                      onChange={(e) => updateStep(step.id, { subjectTemplate: e.target.value })}
                                      placeholder={step.actionType === 'email' ? "Objet de l'e-mail" : step.actionType === 'smart_message' ? 'Objet si le message part en InMail' : "Objet de l'InMail"}
                                      aria-invalid={!step.subjectTemplate?.trim() ? true : undefined}
                                      aria-describedby={!step.subjectTemplate?.trim() ? fieldId('subject-error') : undefined}
                                      className={cn('mt-1.5', !step.subjectTemplate?.trim() && 'border-danger')}
                                    />
                                    {!step.subjectTemplate?.trim() && <p id={fieldId('subject-error')} className="mt-1 text-xs text-danger">Objet requis.</p>}
                                  </div>
                                )}
                                <div>
                                  <div className="flex items-center justify-between">
                                    <Label htmlFor={fieldId('message')}>{isInvite ? "Note d'invitation" : 'Message'}</Label>
                                    <div className="flex items-center gap-2">
                                      <VariableInserter targetRef={messageRef} currentValue={step.messageTemplate || ''} onInsert={(val) => updateStep(step.id, { messageTemplate: val })} fieldLabel={isInvite ? "la note d'invitation" : 'le message'} />
                                      {isInvite && (
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
                                    placeholder={isInvite ? "Note d'invitation (300 caractères au plus)" : 'Bonjour {{first_name}}, …'}
                                    rows={isInvite ? 2 : 3}
                                    maxLength={isInvite ? 300 : undefined}
                                    className={cn('mt-1.5', isInvite && (step.messageTemplate?.length || 0) > 300 && 'border-danger')}
                                  />
                                  {isInvite && (
                                    <p className="mt-1 text-xs text-muted-foreground">Note facultative. Sans note, l'invitation part seule.</p>
                                  )}

                                  <UnknownVariablesNotice text={`${needsSubject(step.actionType) ? step.subjectTemplate || '' : ''} ${step.messageTemplate || ''}`} customKeys={customKeyList} />

                                  {/* Aperçu : mêmes variables que le moteur ; une variable qu'il ne connaît pas apparaît vide. */}
                                  {(step.messageTemplate || '').includes('{{') && (
                                    <details className="group mt-2">
                                      <summary className="flex w-fit cursor-pointer select-none list-none items-center gap-1 rounded-sm text-xs text-foreground transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11 [&::-webkit-details-marker]:hidden">
                                        <ChevronRight className="h-3 w-3 transition-transform duration-150 group-open:rotate-90" aria-hidden="true" />
                                        <Eye className="h-3 w-3" aria-hidden="true" />
                                        Aperçu avec un exemple ({PREVIEW_EXAMPLE_LABEL})
                                      </summary>
                                      <div className="mt-2 whitespace-pre-wrap rounded-lg border border-border bg-muted/40 p-3 text-xs text-foreground">
                                        {renderTemplatePreview(step.messageTemplate || '', customValues)
                                          || 'Saisissez votre message ci-dessus pour voir l\'aperçu.'}
                                      </div>
                                    </details>
                                  )}
                                </div>
                              </>
                            )}

                            {step.actionType === 'email' && !usesAi && (
                              <div className="space-y-3 border-t border-border pt-3">
                                <Collapsible>
                                  <CollapsibleTrigger asChild>
                                    <Button type="button" variant="ghost" size="xs" className="group -ml-2 gap-1 max-md:h-11">
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
                  </div>
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
              <h4 className="text-sm font-medium text-foreground">{sequence.steps.length === 0 ? 'Commencer par ajouter une étape' : 'Ajouter une étape'}</h4>
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
              <p className="py-4 text-center text-sm text-muted-foreground">Toutes les étapes possibles sont ajoutées.</p>
            ) : (
              <>
                {availableActions.length > 0 && (
                  <div className="mb-4">
                    <p className="eyebrow mb-2">Actions</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {availableActions.map(action => (
                        <StepTypeOption key={action.value} value={action.value} label={action.label} description={action.description} onPick={addStep} />
                      ))}
                    </div>
                  </div>
                )}
                {availableTriggers.length > 0 && (
                  <div>
                    <p className="eyebrow mb-2">Attentes et conditions</p>
                    <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                      {availableTriggers.map(trigger => (
                        <StepTypeOption key={trigger.value} value={trigger.value} label={trigger.label} description={trigger.description} onPick={addStep} />
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
        <VisualSequenceEditor steps={sequence.steps} onStepsChange={(newSteps) => setSequence(prev => ({ ...prev, steps: newSteps }))} onRemoveStep={requestRemoveStep} />
      </TabsContent>
      <TabsContent value="list" className="mt-0">
        {renderStepsList()}
      </TabsContent>
    </Tabs>
  );

  const nameFields = (prefix: string, descriptionPlaceholder: string) => (
    <div className="space-y-5">
      <div>
        <Label htmlFor={`${prefix}-name`}>Nom de la séquence *</Label>
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

  // Offre sans envoi : la séquence créée sera désactivée (annoncé avant d'enregistrer).
  const renderPlanNotice = () => (!isEditing && !canSendSequences ? (
    <Banner tone="warning" icon={AlertTriangle} className="rounded-lg border">
      L'envoi de séquences nécessite un abonnement : la séquence sera enregistrée désactivée. Vous pourrez l'activer après avoir choisi une offre.
    </Banner>
  ) : null);

  // Modification d'une séquence qui a des candidats en cours : effet des changements.
  const renderActiveEnrollmentsBanner = () => (isEditing && (activeEnrollmentCount ?? 0) > 0 ? (
    <div role="note" className="flex items-start gap-3 rounded-lg border border-info/25 bg-info-muted px-4 py-3 text-sm">
      <Users className="mt-0.5 h-4 w-4 shrink-0 text-info" aria-hidden="true" />
      <p className="min-w-0 flex-1 text-foreground">
        {activeEnrollmentCount === 1
          ? '1 candidat est en cours dans cette séquence.'
          : `${activeEnrollmentCount} candidats sont en cours dans cette séquence.`}
        {' '}Un texte modifié s'applique à leurs prochains envois. Un délai modifié ne s'applique qu'aux étapes pas encore programmées. Supprimer une étape annule les envois prévus sur cette étape.
      </p>
    </div>
  ) : null);

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
              <p className="mt-1 text-sm text-muted-foreground">Choisissez qui envoie les messages. Avec plusieurs expéditeurs, les nouveaux candidats sont répartis entre leurs comptes LinkedIn.</p>
            </div>
            {multiSender}
          </div>
        );

      case 'steps':
        return (
          <div className="space-y-8">
            {renderActiveEnrollmentsBanner()}
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
            {/* Attribution élevée : ce chiffre répartit les nouveaux candidats, les plafonds d'envoi restent ceux du compte. */}
            {sequence.multiSenderEnabled && sequence.senderAccounts && sequence.senderAccounts.some(s => s.daily_limit > HIGH_SENDER_DAILY_LIMIT) && (
              <Banner tone="warning" icon={Shield} className="rounded-lg border">
                <strong className="font-semibold">Attribution élevée.</strong> Un ou plusieurs expéditeurs reçoivent de nouveaux candidats jusqu'à plus de {HIGH_SENDER_DAILY_LIMIT} actions LinkedIn par jour. Les plafonds d'envoi LinkedIn du compte (Paramètres, Équipe) s'appliquent quand même.
              </Banner>
            )}
            {/* Canaux que le moteur ne sait pas encore envoyer */}
            {(() => {
              const hasEmail = sequence.steps.some(s => s.actionType === 'email');
              const hasWhatsapp = sequence.steps.some(s => s.actionType === 'whatsapp_message');
              if (!hasEmail && !hasWhatsapp) return null;
              return (
                <Banner tone="warning" icon={AlertTriangle} className="rounded-lg border">
                  <strong className="font-semibold">Canaux non pris en charge.</strong>
                  {hasEmail && <> {unsupportedStepNotice('email')}</>}
                  {hasWhatsapp && <> {unsupportedStepNotice('whatsapp_message')}</>}
                </Banner>
              );
            })()}
          </div>
        );

      case 'review':
        return (
          <div className="max-w-2xl space-y-8">
            <div>
              <h3 className="text-lg font-semibold text-foreground">Vérification</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                {isEditing
                  ? 'Vérifiez vos modifications avant de les enregistrer.'
                  : "Vérifiez que tout est prêt avant d'enregistrer la séquence."}
              </p>
            </div>
            {renderPlanNotice()}

            {/* Récapitulatif */}
            <section className="space-y-4 rounded-xl border border-border bg-card p-5" aria-label="Récapitulatif">
              <div className="flex items-start justify-between gap-3">
                <p className="min-w-0 break-words text-md font-semibold text-foreground">{sequence.name.trim() || 'Sans nom'}</p>
                <Badge variant="outline" className="shrink-0">{sequence.steps.length > 0 ? plural(sequence.steps.length, 'étape') : 'Aucune étape'}</Badge>
              </div>
              {sequence.description && <p className="text-xs text-muted-foreground">{sequence.description}</p>}

              {/* Parcours : chaque étape avec sa branche et sa variante, au lieu d'une suite à plat. */}
              <div className="rounded-lg border border-border bg-muted/40 p-3">
                <p className="eyebrow mb-2">Parcours</p>
                {sequence.steps.length === 0 && <p className="text-xs text-muted-foreground">Aucune étape pour l'instant.</p>}
                <ol className="space-y-1">
                  {[...sequence.steps]
                    .sort((a, b) => a.order - b.order || String(a.variantGroup ?? '').localeCompare(String(b.variantGroup ?? '')))
                    .slice(0, 30)
                    .map(step => (
                      <li key={step.id} className="flex flex-wrap items-center gap-2 text-xs">
                        <span className="grid h-5 w-5 shrink-0 place-items-center rounded-md bg-muted text-foreground">
                          <SequenceActionIcon type={step.actionType} className="h-3 w-3" />
                        </span>
                        <span className="tabular-nums text-muted-foreground">Étape {step.order + 1}</span>
                        <span className="font-medium text-foreground">{typeLabel(step.actionType)}</span>
                        {(branchBadges.get(step.id) ?? []).map(badge => (
                          <span key={badge} className="rounded-md border border-border bg-background px-1.5 py-0.5 text-2xs text-muted-foreground">{badge}</span>
                        ))}
                        {step.variantGroup && (
                          <span className="rounded-md border border-border bg-background px-1.5 py-0.5 text-2xs text-muted-foreground">Variante {step.variantGroup}</span>
                        )}
                      </li>
                    ))}
                </ol>
                {sequence.steps.length > 30 && (
                  <p className="mt-1 text-xs text-muted-foreground">et {plural(sequence.steps.length - 30, 'autre étape', 'autres étapes')}</p>
                )}
              </div>
            </section>

            {/* Vérification : mêmes bloquants que l'enregistrement, recalculés à chaque modification. */}
            <SequenceValidationChecklist sequence={sequence} linkedSenderIds={linkedSenderIds} />
          </div>
        );
    }
  };

  const currentWizardIndex = WIZARD_ORDER.indexOf(wizardStep);
  const saveState: SaveState | null = isSaving
    ? 'saving'
    : saveFailed ? 'error'
      : isDirty ? 'unsaved'
        : isEditing ? 'saved' : null;
  const blockerCount = validation.errors.length;

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
                  aria-label="Retour à la liste"
                  className="shrink-0 gap-1.5 px-2 max-md:h-11 max-sm:w-11 max-sm:px-0"
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
                {isEditing ? 'Modifier' : 'Nouvelle séquence'}
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
              onClick={() => { void handleSave(); }}
              loading={isSaving}
              className="shrink-0 max-md:h-11"
            >
              {!isSaving && <Save aria-hidden="true" />}
              {isSaving ? 'Enregistrement…' : 'Enregistrer'}
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
                <h3 className="eyebrow mb-3">Vérification</h3>
                <SequenceValidationChecklist sequence={sequence} linkedSenderIds={linkedSenderIds} />
              </>
            )}
          </aside>

          <div className="flex min-w-0 flex-1 flex-col">
            {/* Sous 1 024 px : étapes de l'assistant en ligne et vérification toujours atteignable (revue design D-39) */}
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
              <Popover open={mobileChecklistOpen} onOpenChange={setMobileChecklistOpen}>
                <PopoverTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className={cn('shrink-0 gap-1.5 px-2 max-md:h-11 max-md:min-w-11', mode === 'expert' && '-ml-1')}
                  >
                    <ListChecks aria-hidden="true" />
                    <span className={cn('inline-flex items-center gap-1.5', blockerCount > 0 ? 'text-danger' : 'text-success')}>
                      {blockerCount > 0 ? <AlertCircle aria-hidden="true" /> : <CheckCircle2 aria-hidden="true" />}
                      {/* En mode guidé sur téléphone, seule l'icône d'état reste visible : la ligne est prise par les étapes. */}
                      <span className={mode === 'wizard' ? 'max-sm:sr-only' : undefined}>
                        {blockerCount > 0
                          ? `Vérification : ${plural(blockerCount, 'point')} à corriger`
                          : 'Vérification : prête à être enregistrée'}
                      </span>
                    </span>
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] overflow-y-auto">
                  <h3 className="eyebrow mb-3">Vérification</h3>
                  <SequenceValidationChecklist sequence={sequence} linkedSenderIds={linkedSenderIds} />
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
                    {renderActiveEnrollmentsBanner()}
                    {renderPlanNotice()}
                    {nameFields('expert', "L'objectif de cette séquence")}
                    {stopConditions}
                    {multiSender}

                    {sequence.steps.length === 0 && !isEditing && (
                      <div className="flex flex-wrap items-center gap-4 rounded-xl border border-dashed border-border bg-muted/20 p-5">
                        <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-foreground">
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
                  className="max-md:h-11"
                >
                  <ArrowLeft aria-hidden="true" />
                  Précédent
                </Button>
                <p className="text-xs text-muted-foreground max-sm:hidden">
                  Étape {currentWizardIndex + 1} sur {WIZARD_ORDER.length} · {WIZARD_STEPS[currentWizardIndex]?.label}
                </p>
                {/* Un seul geste : « Enregistrer », comme dans la barre du haut. L'ancien
                    « Activer » faisait la même chose sous un autre nom. */}
                {wizardStep === 'review' ? (
                  <Button
                    type="button"
                    variant="primary"
                    size="sm"
                    onClick={() => { void handleSave(); }}
                    loading={isSaving}
                    className="max-md:h-11"
                  >
                    {!isSaving && <Save aria-hidden="true" />}
                    {isSaving ? 'Enregistrement…' : 'Enregistrer'}
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
                  ? 'Votre brouillon ne peut pas être conservé dans ce navigateur : votre saisie sera perdue.'
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
            <ul className="list-disc space-y-1.5 pl-5 text-sm text-foreground">
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
      </DialogContent>
    </Dialog>
  );
});

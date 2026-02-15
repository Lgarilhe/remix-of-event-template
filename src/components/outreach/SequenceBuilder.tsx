import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
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
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { VisualSequenceEditor } from './sequence/VisualSequenceEditor';

export interface SequenceStep {
  id: string;
  order: number;
  actionType: 'inmail' | 'connection_request' | 'profile_visit' | 'message' | 'smart_message' | 'wait_connection' | 'wait_reply' | 'wait_profile_visit' | 'condition_branch' | 'check_connection';
  conditionType: 'always' | 'if_connected' | 'if_not_connected' | 'if_no_response';
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
  // Branching for check_connection
  ifTrueGotoStep?: string;
  ifFalseGotoStep?: string;
  // Generic next step for graph-based sequencing
  nextStepId?: string;
}

export interface Sequence {
  id?: string;
  name: string;
  description?: string;
  steps: SequenceStep[];
  isActive: boolean;
}

interface SequenceBuilderProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (sequence: Sequence) => Promise<void>;
  initialSequence?: Sequence;
}

// ACTIONS = ce qu'on FAIT
const ACTIONS = [
  { value: 'connection_request', label: 'Invitation LinkedIn', icon: UserPlus, color: 'bg-emerald-100 text-emerald-600', description: 'Envoyer une demande de connexion', requiresPrevious: [], excludeIfPrevious: ['connection_request'], requiresConnection: false },
  { value: 'inmail', label: 'InMail', icon: Mail, color: 'bg-blue-100 text-blue-600', description: 'Envoyer un InMail (payant)', requiresPrevious: [], excludeIfPrevious: [], requiresConnection: false },
  { value: 'profile_visit', label: 'Visite de profil', icon: Eye, color: 'bg-sky-100 text-sky-600', description: 'Visiter le profil du prospect', requiresPrevious: [], excludeIfPrevious: [], requiresConnection: false },
  { value: 'message', label: 'Message direct', icon: MessageSquare, color: 'bg-orange-100 text-orange-600', description: 'Envoyer un message (si connecté)', requiresPrevious: ['wait_connection'], excludeIfPrevious: [], requiresConnection: true },
  { value: 'smart_message', label: 'Smart Message (IA)', icon: Sparkles, color: 'bg-purple-100 text-purple-600', description: 'Message personnalisé par IA', requiresPrevious: ['wait_connection'], excludeIfPrevious: [], requiresConnection: true },
];

// TRIGGERS = ce qu'on ATTEND
const TRIGGERS = [
  { value: 'check_connection', label: 'Vérifier connexion', icon: GitBranch, color: 'bg-indigo-100 text-indigo-600', description: 'Route selon le degré', requiresPrevious: [], excludeIfPrevious: [] },
  { value: 'wait_connection', label: 'Attendre connexion', icon: Timer, color: 'bg-amber-100 text-amber-600', description: 'Pause jusqu\'à acceptation', waitEvent: 'connection_accepted', requiresPrevious: ['connection_request'], excludeIfPrevious: ['wait_connection'] },
  { value: 'wait_reply', label: 'Attendre réponse', icon: MessageSquare, color: 'bg-amber-100 text-amber-600', description: 'Pause jusqu\'à réponse', waitEvent: 'reply_received', requiresPrevious: ['inmail', 'message', 'smart_message'], excludeIfPrevious: [] },
  { value: 'wait_profile_visit', label: 'Attendre visite retour', icon: Eye, color: 'bg-amber-100 text-amber-600', description: 'Pause si visite profil', waitEvent: 'profile_visited', requiresPrevious: ['profile_visit'], excludeIfPrevious: [] },
  { value: 'condition_branch', label: 'Branchement', icon: GitBranch, color: 'bg-rose-100 text-rose-600', description: 'Si/Sinon conditionnel', requiresPrevious: [], excludeIfPrevious: [] },
];

const ALL_STEP_TYPES = [...ACTIONS, ...TRIGGERS];

const CONDITION_TYPES = [
  { value: 'always', label: 'Toujours exécuter' },
  { value: 'if_connected', label: 'Si connecté' },
  { value: 'if_not_connected', label: 'Si non connecté' },
  { value: 'if_no_response', label: 'Si pas de réponse' },
];

const TIMEOUT_ACTIONS = [
  { value: 'skip', label: 'Passer à l\'étape suivante' },
  { value: 'alternative_step', label: 'Exécuter étape alternative' },
  { value: 'end_sequence', label: 'Terminer la séquence' },
];

// Helper to get available actions/triggers based on previous steps
const getAvailableStepTypes = (previousSteps: SequenceStep[]) => {
  const previousTypes = previousSteps.map(s => s.actionType);
  const hasConnectionRequest = previousTypes.includes('connection_request');
  const hasWaitConnection = previousTypes.includes('wait_connection');
  const hasMessage = previousTypes.some(t => ['inmail', 'message', 'smart_message'].includes(t));
  const hasProfileVisit = previousTypes.includes('profile_visit');

  const availableActions = ACTIONS.filter(action => {
    // Check if excluded by previous steps
    if (action.excludeIfPrevious.some(ex => previousTypes.includes(ex as SequenceStep['actionType']))) {
      return false;
    }
    // Check if requires connection but no wait_connection happened
    if (action.requiresConnection && !hasWaitConnection) {
      return false;
    }
    return true;
  });

  const availableTriggers = TRIGGERS.filter(trigger => {
    // Check if excluded by previous steps
    if (trigger.excludeIfPrevious.some(ex => previousTypes.includes(ex as SequenceStep['actionType']))) {
      return false;
    }
    // Check if requires specific previous action
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

const isAction = (actionType: string) => ACTIONS.some(a => a.value === actionType);
const isTrigger = (actionType: string) => TRIGGERS.some(t => t.value === actionType);
const needsMessage = (type: string) => ['inmail', 'connection_request', 'message', 'smart_message'].includes(type);
const needsSubject = (type: string) => type === 'inmail';

export const SequenceBuilder: React.FC<SequenceBuilderProps> = ({
  isOpen,
  onClose,
  onSave,
  initialSequence,
}) => {
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
  // Show step picker immediately if no steps yet
  const [showStepPicker, setShowStepPicker] = useState(!initialSequence || initialSequence.steps.length === 0);

  const updateStep = (stepId: string, updates: Partial<SequenceStep>) => {
    setSequence(prev => ({
      ...prev,
      steps: prev.steps.map(step =>
        step.id === stepId ? { ...step, ...updates } : step
      ),
    }));
  };

  const addStep = (actionType: string) => {
    const newStep = createEmptyStep(sequence.steps.length, actionType);
    setSequence(prev => ({
      ...prev,
      steps: [...prev.steps, newStep],
    }));
    setExpandedStepId(newStep.id);
    setShowStepPicker(false);
  };

  const removeStep = (stepId: string) => {
    if (sequence.steps.length <= 1) return;
    const newSteps = sequence.steps
      .filter(s => s.id !== stepId)
      .map((s, idx) => ({ ...s, order: idx }));
    setSequence(prev => ({ ...prev, steps: newSteps }));
    if (expandedStepId === stepId) {
      setExpandedStepId(newSteps[0]?.id || null);
    }
  };

  const handleSave = async () => {
    if (!sequence.name.trim() || sequence.steps.length === 0) return;
    setIsSaving(true);
    try {
      await onSave(sequence);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-xl max-h-[85vh] overflow-hidden flex flex-col bg-white">
        <DialogHeader>
          <DialogTitle>
            {initialSequence ? 'Modifier la séquence' : 'Nouvelle séquence'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-6 py-4">
          {/* Sequence info */}
          <div className="space-y-4">
            <div>
              <Label htmlFor="name">Nom de la séquence *</Label>
              <Input
                id="name"
                value={sequence.name}
                onChange={(e) => setSequence(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Ex: Prospection développeurs React"
                className="mt-1.5"
              />
            </div>
            <div>
              <Label htmlFor="description">Description (optionnel)</Label>
              <Input
                id="description"
                value={sequence.description || ''}
                onChange={(e) => setSequence(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Décrivez l'objectif de cette séquence"
                className="mt-1.5"
              />
            </div>
          </div>

          {/* Steps with tabs for list/visual view */}
          <div>
            <Tabs defaultValue="list" className="w-full">
              <div className="flex items-center justify-between mb-3">
                <Label className="text-base font-medium">Étapes de la séquence</Label>
                <div className="flex items-center gap-2">
                  <span className="text-sm text-muted-foreground">{sequence.steps.length} étape(s)</span>
                  <TabsList className="h-8">
                    <TabsTrigger value="list" className="h-6 px-2 text-xs">
                      <List className="w-3 h-3 mr-1" />
                      Liste
                    </TabsTrigger>
                    <TabsTrigger value="visual" className="h-6 px-2 text-xs">
                      <Workflow className="w-3 h-3 mr-1" />
                      Visuel
                    </TabsTrigger>
                  </TabsList>
                </div>
              </div>

              <TabsContent value="visual" className="mt-0">
                <VisualSequenceEditor
                  steps={sequence.steps}
                  onStepsChange={(newSteps) => setSequence(prev => ({ ...prev, steps: newSteps }))}
                />
              </TabsContent>

              <TabsContent value="list" className="mt-0">
              <div className="space-y-3">
              {sequence.steps.map((step, index) => {
                const isExpanded = expandedStepId === step.id;
                const stepConfig = ALL_STEP_TYPES.find(a => a.value === step.actionType);
                const StepIcon = stepConfig?.icon || Mail;
                const stepIsTrigger = isTrigger(step.actionType);

                return (
                  <div
                    key={step.id}
                    className={cn(
                      "border rounded-lg transition-all",
                      isExpanded ? "border-primary bg-muted/30" : "border-border",
                      stepIsTrigger && "border-l-4 border-l-amber-400"
                    )}
                  >
                    {/* Step header */}
                    <div
                      className="flex items-center gap-3 p-3 cursor-pointer"
                      onClick={() => setExpandedStepId(isExpanded ? null : step.id)}
                    >
                      <GripVertical className="w-4 h-4 text-muted-foreground" />
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center",
                        stepConfig?.color || "bg-muted"
                      )}>
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
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              Après {step.delayDays}j
                            </span>
                          )}
                          {step.useAiPersonalization && (
                            <span className="flex items-center gap-1 text-purple-600">
                              <Sparkles className="w-3 h-3" />
                              IA
                            </span>
                          )}
                          {stepIsTrigger && step.timeoutDays && (
                            <span className="flex items-center gap-1 text-amber-600">
                              <Timer className="w-3 h-3" />
                              Timeout {step.timeoutDays}j
                            </span>
                          )}
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeStep(step.id);
                        }}
                        disabled={sequence.steps.length <= 1}
                        className="text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>

                    {/* Step details (expanded) */}
                    {isExpanded && (
                      <div className="px-4 pb-4 pt-2 border-t space-y-4">
                        {/* Delay (not for first step) */}
                        {index > 0 && (
                          <div className="grid grid-cols-3 gap-3">
                            <div>
                              <Label>Jours</Label>
                              <Input
                                type="number"
                                min={0}
                                value={step.delayDays}
                                onChange={(e) => updateStep(step.id, { delayDays: parseInt(e.target.value) || 0 })}
                                className="mt-1.5"
                              />
                            </div>
                            <div>
                              <Label>Heures</Label>
                              <Input
                                type="number"
                                min={0}
                                max={23}
                                value={step.delayHours}
                                onChange={(e) => updateStep(step.id, { delayHours: parseInt(e.target.value) || 0 })}
                                className="mt-1.5"
                              />
                            </div>
                            <div>
                              <Label>Minutes</Label>
                              <Input
                                type="number"
                                min={0}
                                max={59}
                                value={step.delayMinutes || 0}
                                onChange={(e) => updateStep(step.id, { delayMinutes: parseInt(e.target.value) || 0 })}
                                className="mt-1.5"
                              />
                            </div>
                          </div>
                        )}

                        {/* Condition for actions */}
                        {isAction(step.actionType) && (
                          <div>
                            <Label>Condition d'exécution</Label>
                            <Select
                              value={step.conditionType}
                              onValueChange={(value) => updateStep(step.id, { conditionType: value as SequenceStep['conditionType'] })}
                            >
                              <SelectTrigger className="mt-1.5">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {CONDITION_TYPES.map(cond => (
                                  <SelectItem key={cond.value} value={cond.value}>
                                    {cond.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}

                        {/* Trigger configuration */}
                        {stepIsTrigger && step.actionType !== 'condition_branch' && (
                          <div className="space-y-4 p-3 bg-amber-50 border border-amber-200 rounded-lg">
                            <div className="flex items-center gap-2 text-amber-700">
                              <Zap className="w-4 h-4" />
                              <span className="font-medium text-sm">Configuration du trigger</span>
                            </div>
                            
                            <div className="grid grid-cols-2 gap-4">
                              <div>
                                <Label>Timeout (jours max)</Label>
                                <Input
                                  type="number"
                                  min={1}
                                  value={step.timeoutDays || 3}
                                  onChange={(e) => updateStep(step.id, { timeoutDays: parseInt(e.target.value) || 3 })}
                                  className="mt-1.5"
                                />
                              </div>
                              <div>
                                <Label>Si timeout dépassé</Label>
                                <Select
                                  value={step.timeoutAction || 'skip'}
                                  onValueChange={(value) => updateStep(step.id, { timeoutAction: value as SequenceStep['timeoutAction'] })}
                                >
                                  <SelectTrigger className="mt-1.5">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {TIMEOUT_ACTIONS.map(action => (
                                      <SelectItem key={action.value} value={action.value}>
                                        {action.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>
                          </div>
                        )}

                        {/* Condition branch configuration */}
                        {step.actionType === 'condition_branch' && (
                          <div className="space-y-4 p-3 bg-rose-50 border border-rose-200 rounded-lg">
                            <div className="flex items-center gap-2 text-rose-700">
                              <GitBranch className="w-4 h-4" />
                              <span className="font-medium text-sm">Configuration du branchement</span>
                            </div>
                            
                            <div>
                              <Label>Condition à vérifier</Label>
                              <Select
                                value={step.conditionType}
                                onValueChange={(value) => updateStep(step.id, { conditionType: value as SequenceStep['conditionType'] })}
                              >
                                <SelectTrigger className="mt-1.5">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {CONDITION_TYPES.filter(c => c.value !== 'always').map(cond => (
                                    <SelectItem key={cond.value} value={cond.value}>
                                      {cond.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>

                            <div>
                              <Label>Si condition non remplie</Label>
                              <Select
                                value={step.timeoutAction || 'skip'}
                                onValueChange={(value) => updateStep(step.id, { timeoutAction: value as SequenceStep['timeoutAction'] })}
                              >
                                <SelectTrigger className="mt-1.5">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  {TIMEOUT_ACTIONS.map(action => (
                                    <SelectItem key={action.value} value={action.value}>
                                      {action.label}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        )}

                        {/* Check connection configuration */}
                        {step.actionType === 'check_connection' && (
                          <div className="space-y-4 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
                            <div className="flex items-center gap-2 text-indigo-700">
                              <GitBranch className="w-4 h-4" />
                              <span className="font-medium text-sm">Vérification du degré de connexion</span>
                            </div>
                            
                            <div>
                              <Label>Si connecté (1er degré) → aller à</Label>
                              <Select
                                value={step.ifTrueGotoStep || '__next__'}
                                onValueChange={(value) => updateStep(step.id, { ifTrueGotoStep: value === '__next__' ? undefined : value })}
                              >
                                <SelectTrigger className="mt-1.5">
                                  <SelectValue placeholder="Sélectionner une étape..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__next__">Étape suivante</SelectItem>
                                  {sequence.steps.filter(s => s.order > step.order && s.id).map(s => {
                                    const stepConfig = ALL_STEP_TYPES.find(a => a.value === s.actionType);
                                    return (
                                      <SelectItem key={s.id} value={s.id}>
                                        Étape {s.order + 1}: {stepConfig?.label || s.actionType}
                                      </SelectItem>
                                    );
                                  })}
                                </SelectContent>
                              </Select>
                            </div>

                            <div>
                              <Label>Si non connecté (2e/3e degré) → aller à</Label>
                              <Select
                                value={step.ifFalseGotoStep || '__next__'}
                                onValueChange={(value) => updateStep(step.id, { ifFalseGotoStep: value === '__next__' ? undefined : value })}
                              >
                                <SelectTrigger className="mt-1.5">
                                  <SelectValue placeholder="Sélectionner une étape..." />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="__next__">Étape suivante</SelectItem>
                                  {sequence.steps.filter(s => s.order > step.order && s.id).map(s => {
                                    const stepConfig = ALL_STEP_TYPES.find(a => a.value === s.actionType);
                                    return (
                                      <SelectItem key={s.id} value={s.id}>
                                        Étape {s.order + 1}: {stepConfig?.label || s.actionType}
                                      </SelectItem>
                                    );
                                  })}
                                </SelectContent>
                              </Select>
                            </div>
                          </div>
                        )}

                        {/* Message fields */}
                        {needsMessage(step.actionType) && (
                          <>
                            {/* AI toggle */}
                            <div className="flex items-center justify-between p-3 bg-muted/50 rounded-lg">
                              <div className="flex items-center gap-2">
                                <Sparkles className="w-4 h-4 text-purple-600" />
                                <span className="text-sm font-medium">Personnalisation IA</span>
                              </div>
                              <Switch
                                checked={step.useAiPersonalization}
                                onCheckedChange={(checked) => updateStep(step.id, { useAiPersonalization: checked })}
                              />
                            </div>

                            {step.useAiPersonalization ? (
                              <div>
                                <Label>Ton du message</Label>
                                <Select
                                  value={step.aiTone || 'professional'}
                                  onValueChange={(value) => updateStep(step.id, { aiTone: value as SequenceStep['aiTone'] })}
                                >
                                  <SelectTrigger className="mt-1.5">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {AI_TONES.map(tone => (
                                      <SelectItem key={tone.value} value={tone.value}>
                                        {tone.label}
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                                <p className="text-xs text-muted-foreground mt-2">
                                  Le message sera généré automatiquement par l'IA.
                                </p>
                              </div>
                            ) : (
                              <>
                                {needsSubject(step.actionType) && (
                                  <div>
                                    <Label>Objet</Label>
                                    <Input
                                      value={step.subjectTemplate || ''}
                                      onChange={(e) => updateStep(step.id, { subjectTemplate: e.target.value })}
                                      placeholder="Objet de l'InMail"
                                      className="mt-1.5"
                                    />
                                  </div>
                                )}
                                <div>
                                  <div className="flex items-center justify-between">
                                    <Label>Message</Label>
                                    {step.actionType === 'connection_request' && (
                                      <span className={cn(
                                        "text-xs",
                                        (step.messageTemplate?.length || 0) > 50 ? "text-red-500 font-medium" : "text-muted-foreground"
                                      )}>
                                        {step.messageTemplate?.length || 0}/50
                                      </span>
                                    )}
                                  </div>
                                  <Textarea
                                    value={step.messageTemplate || ''}
                                    onChange={(e) => updateStep(step.id, { messageTemplate: e.target.value })}
                                    placeholder={step.actionType === 'connection_request' ? "Note courte (max 50 car.)" : "Bonjour {{firstName}}, ..."}
                                    rows={step.actionType === 'connection_request' ? 2 : 3}
                                    className={cn(
                                      "mt-1.5",
                                      step.actionType === 'connection_request' && (step.messageTemplate?.length || 0) > 50 && "border-red-300 focus-visible:ring-red-300"
                                    )}
                                  />
                                  {step.actionType === 'connection_request' ? (
                                    <p className="text-xs text-muted-foreground mt-1">
                                      LinkedIn limite les notes d'invitation à 50 caractères.
                                    </p>
                                  ) : (
                                    <p className="text-xs text-muted-foreground mt-1">
                                      Variables: {'{{firstName}}'}, {'{{lastName}}'}, {'{{company}}'}, {'{{headline}}'}
                                    </p>
                                  )}
                                </div>
                              </>
                            )}
                          </>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}

            {/* Step picker - shows when no steps or user clicked add */}
            {(showStepPicker || sequence.steps.length === 0) && (() => {
              const { availableActions, availableTriggers } = getAvailableStepTypes(sequence.steps);
              const hasNoOptions = availableActions.length === 0 && availableTriggers.length === 0;

              return (
                <div className={cn(
                  "mt-4 p-4 border-2 border-dashed rounded-lg",
                  sequence.steps.length === 0 
                    ? "border-primary bg-primary/5" 
                    : "border-primary/30 bg-muted/20"
                )}>
                  <div className="flex items-center justify-between mb-4">
                    <span className="font-medium text-sm">
                      {sequence.steps.length === 0 ? 'Commencer par ajouter une étape' : 'Ajouter une étape'}
                    </span>
                    {sequence.steps.length > 0 && (
                      <Button variant="ghost" size="sm" onClick={() => setShowStepPicker(false)}>
                        <X className="w-4 h-4" />
                      </Button>
                    )}
                  </div>

                  {hasNoOptions ? (
                    <div className="text-center py-4 text-muted-foreground text-sm">
                      Séquence complète ! Aucune action supplémentaire disponible.
                    </div>
                  ) : (
                    <>
                      {/* Actions section */}
                      {availableActions.length > 0 && (
                        <div className="mb-4">
                          <div className="flex items-center gap-2 mb-2">
                            <Zap className="w-4 h-4 text-emerald-600" />
                            <span className="text-xs font-semibold uppercase text-muted-foreground">Actions</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            {availableActions.map(action => (
                              <button
                                key={action.value}
                                onClick={() => addStep(action.value)}
                                className="flex items-center gap-2 p-2.5 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors text-left"
                              >
                                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", action.color)}>
                                  <action.icon className="w-4 h-4" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm truncate">{action.label}</div>
                                  <div className="text-xs text-muted-foreground truncate">{action.description}</div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Triggers section */}
                      {availableTriggers.length > 0 && (
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <Timer className="w-4 h-4 text-amber-600" />
                            <span className="text-xs font-semibold uppercase text-muted-foreground">Triggers</span>
                          </div>
                          <div className="grid grid-cols-2 gap-2">
                            {availableTriggers.map(trigger => (
                              <button
                                key={trigger.value}
                                onClick={() => addStep(trigger.value)}
                                className="flex items-center gap-2 p-2.5 rounded-lg border border-border hover:border-amber-400 hover:bg-amber-50 transition-colors text-left"
                              >
                                <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", trigger.color)}>
                                  <trigger.icon className="w-4 h-4" />
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="font-medium text-sm truncate">{trigger.label}</div>
                                  <div className="text-xs text-muted-foreground truncate">{trigger.description}</div>
                                </div>
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Show hint when some options are hidden */}
                      {(availableActions.length < ACTIONS.length || availableTriggers.length < TRIGGERS.length) && (
                        <p className="text-xs text-muted-foreground mt-3 text-center italic">
                          Certaines options sont masquées car non pertinentes à cette étape
                        </p>
                      )}
                    </>
                  )}
                </div>
              );
            })()}

            {/* Add step button - only show when steps exist and picker is hidden */}
            {sequence.steps.length > 0 && !showStepPicker && (
              <Button
                variant="outline"
                onClick={() => setShowStepPicker(true)}
                className="w-full mt-3 border-dashed"
              >
                <Plus className="w-4 h-4 mr-2" />
                Ajouter une étape
              </Button>
            )}
            </div>
              </TabsContent>
            </Tabs>
          </div>
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 pt-4 border-t">
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button 
            onClick={handleSave} 
            disabled={isSaving || !sequence.name.trim() || sequence.steps.length === 0}
          >
            {isSaving ? 'Enregistrement...' : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Enregistrer
              </>
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

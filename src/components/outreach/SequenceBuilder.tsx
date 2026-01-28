import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
  GitBranch,
  Save,
  Timer,
  AlertTriangle,
  ChevronDown,
  ChevronUp,
  Zap,
  Settings2,
  MessageCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SequenceStep {
  id: string;
  order: number;
  actionType: 'inmail' | 'connection_request' | 'profile_visit' | 'message' | 'smart_message';
  conditionType: 'always' | 'if_connected' | 'if_not_connected' | 'if_no_response' | 'wait_until_connected' | 'wait_for_event';
  delayDays: number;
  delayHours: number;
  preferredHourStart: number;
  preferredHourEnd: number;
  subjectTemplate?: string;
  messageTemplate?: string;
  useAiPersonalization: boolean;
  aiTone?: 'professional' | 'casual' | 'enthusiastic';
  timeoutDays?: number;
  waitForEvent?: 'connection_accepted' | 'reply_received';
  timeoutBranchStepId?: string;
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

const ACTION_TYPES = [
  { value: 'smart_message', label: 'Message intelligent', shortLabel: 'Smart', icon: Sparkles, color: 'bg-gradient-to-br from-violet-500 to-purple-600', bgLight: 'bg-violet-50 dark:bg-violet-950/30', description: 'Auto-détecte InMail ou Direct' },
  { value: 'connection_request', label: 'Demande connexion', shortLabel: 'Connexion', icon: UserPlus, color: 'bg-gradient-to-br from-emerald-500 to-green-600', bgLight: 'bg-emerald-50 dark:bg-emerald-950/30', description: 'Envoie une invitation' },
  { value: 'profile_visit', label: 'Visite profil', shortLabel: 'Visite', icon: Eye, color: 'bg-gradient-to-br from-sky-500 to-blue-600', bgLight: 'bg-sky-50 dark:bg-sky-950/30', description: 'Visite le profil LinkedIn' },
  { value: 'inmail', label: 'InMail', shortLabel: 'InMail', icon: Mail, color: 'bg-gradient-to-br from-blue-500 to-indigo-600', bgLight: 'bg-blue-50 dark:bg-blue-950/30', description: 'Envoie un InMail LinkedIn' },
  { value: 'message', label: 'Message direct', shortLabel: 'Message', icon: MessageSquare, color: 'bg-gradient-to-br from-orange-500 to-amber-600', bgLight: 'bg-orange-50 dark:bg-orange-950/30', description: 'Message direct (si connecté)' },
];

const CONDITION_TYPES = [
  { value: 'always', label: 'Toujours exécuter', icon: Zap },
  { value: 'if_connected', label: 'Si connecté (1er degré)', icon: UserPlus },
  { value: 'if_not_connected', label: 'Si non connecté', icon: UserPlus },
  { value: 'if_no_response', label: 'Si pas de réponse', icon: MessageCircle },
  { value: 'wait_until_connected', label: 'Attendre connexion', icon: Timer },
  { value: 'wait_for_event', label: 'Attendre événement', icon: Clock },
];

const WAIT_EVENTS = [
  { value: 'connection_accepted', label: 'Connexion acceptée' },
  { value: 'reply_received', label: 'Réponse reçue' },
];

const createEmptyStep = (order: number): SequenceStep => ({
  id: crypto.randomUUID(),
  order,
  actionType: order === 0 ? 'profile_visit' : 'smart_message',
  conditionType: 'always',
  delayDays: order === 0 ? 0 : 2,
  delayHours: 0,
  preferredHourStart: 9,
  preferredHourEnd: 18,
  useAiPersonalization: true,
  aiTone: 'professional',
  timeoutDays: undefined,
  waitForEvent: undefined,
  timeoutBranchStepId: undefined,
});

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
      steps: [createEmptyStep(0)],
      isActive: true,
    }
  );
  const [isSaving, setIsSaving] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(sequence.steps[0]?.id || null);

  const selectedStep = sequence.steps.find(s => s.id === selectedStepId);

  const updateStep = (stepId: string, updates: Partial<SequenceStep>) => {
    setSequence(prev => ({
      ...prev,
      steps: prev.steps.map(step =>
        step.id === stepId ? { ...step, ...updates } : step
      ),
    }));
  };

  const addStep = () => {
    const newStep = createEmptyStep(sequence.steps.length);
    setSequence(prev => ({
      ...prev,
      steps: [...prev.steps, newStep],
    }));
    setSelectedStepId(newStep.id);
  };

  const removeStep = (stepId: string) => {
    if (sequence.steps.length <= 1) return;
    const newSteps = sequence.steps
      .filter(s => s.id !== stepId)
      .map((s, idx) => ({ ...s, order: idx }));
    setSequence(prev => ({ ...prev, steps: newSteps }));
    if (selectedStepId === stepId) {
      setSelectedStepId(newSteps[0]?.id || null);
    }
  };

  const moveStep = (stepId: string, direction: 'up' | 'down') => {
    const currentIndex = sequence.steps.findIndex(s => s.id === stepId);
    if (currentIndex === -1) return;
    
    const newIndex = direction === 'up' ? currentIndex - 1 : currentIndex + 1;
    if (newIndex < 0 || newIndex >= sequence.steps.length) return;

    const newSteps = [...sequence.steps];
    [newSteps[currentIndex], newSteps[newIndex]] = [newSteps[newIndex], newSteps[currentIndex]];
    
    setSequence(prev => ({
      ...prev,
      steps: newSteps.map((s, idx) => ({ ...s, order: idx })),
    }));
  };

  const handleSave = async () => {
    if (!sequence.name.trim()) return;
    setIsSaving(true);
    try {
      await onSave(sequence);
      onClose();
    } finally {
      setIsSaving(false);
    }
  };

  const getActionConfig = (type: string) => ACTION_TYPES.find(a => a.value === type) || ACTION_TYPES[0];
  const needsMessage = (type: string) => ['inmail', 'connection_request', 'message', 'smart_message'].includes(type);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0">
        {/* Header */}
        <DialogHeader className="px-6 py-4 border-b bg-gradient-to-r from-[#0077B5]/5 to-transparent">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-gradient-to-br from-[#0077B5] to-[#005E93] text-white shadow-lg shadow-[#0077B5]/20">
                <GitBranch className="w-5 h-5" />
              </div>
              <div>
                <DialogTitle className="text-xl font-semibold">
                  {initialSequence?.id ? 'Modifier la séquence' : 'Créer une séquence'}
                </DialogTitle>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Automatisez vos interactions LinkedIn
                </p>
              </div>
            </div>
          </div>
        </DialogHeader>

        {/* Main content - 2 columns */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Timeline */}
          <div className="w-80 border-r bg-muted/30 flex flex-col">
            {/* Sequence info */}
            <div className="p-4 border-b space-y-3">
              <Input
                value={sequence.name}
                onChange={(e) => setSequence(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Nom de la séquence..."
                className="font-medium bg-background"
              />
              <Input
                value={sequence.description || ''}
                onChange={(e) => setSequence(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Description (optionnel)"
                className="text-sm bg-background"
              />
            </div>

            {/* Steps timeline */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-1">
                {sequence.steps.map((step, index) => {
                  const actionConfig = getActionConfig(step.actionType);
                  const ActionIcon = actionConfig.icon;
                  const isSelected = selectedStepId === step.id;

                  return (
                    <div key={step.id} className="relative">
                      {/* Vertical connector */}
                      {index > 0 && (
                        <div className="absolute left-5 -top-1 w-0.5 h-2 bg-border" />
                      )}
                      {index < sequence.steps.length - 1 && (
                        <div className="absolute left-5 bottom-0 top-[calc(100%-4px)] w-0.5 bg-border" />
                      )}
                      
                      <button
                        onClick={() => setSelectedStepId(step.id)}
                        className={cn(
                          "w-full flex items-center gap-3 p-3 rounded-xl transition-all text-left group",
                          isSelected 
                            ? "bg-background shadow-md border-2 border-[#0077B5]" 
                            : "hover:bg-background/60 border-2 border-transparent"
                        )}
                      >
                        {/* Step number with icon */}
                        <div className={cn(
                          "relative w-10 h-10 rounded-xl flex items-center justify-center text-white shadow-lg transition-transform group-hover:scale-105",
                          actionConfig.color
                        )}>
                          <ActionIcon className="w-5 h-5" />
                          <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-background border-2 border-current text-[10px] font-bold flex items-center justify-center text-foreground">
                            {index + 1}
                          </span>
                        </div>

                        {/* Step info */}
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-sm truncate">
                            {actionConfig.shortLabel}
                          </div>
                          {index > 0 && (
                            <div className="flex items-center gap-1 text-xs text-muted-foreground">
                              <Clock className="w-3 h-3" />
                              J+{step.delayDays}
                              {step.delayHours > 0 && ` ${step.delayHours}h`}
                            </div>
                          )}
                          {step.conditionType !== 'always' && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 mt-1">
                              {CONDITION_TYPES.find(c => c.value === step.conditionType)?.label.split(' ')[0]}
                            </Badge>
                          )}
                        </div>

                        {/* AI badge */}
                        {step.useAiPersonalization && needsMessage(step.actionType) && (
                          <div className="p-1 rounded bg-purple-100 dark:bg-purple-900/30">
                            <Sparkles className="w-3 h-3 text-purple-600 dark:text-purple-400" />
                          </div>
                        )}
                      </button>
                    </div>
                  );
                })}
              </div>

              {/* Add step button */}
              <button
                onClick={addStep}
                className="w-full mt-4 p-3 rounded-xl border-2 border-dashed border-muted-foreground/30 hover:border-[#0077B5] hover:bg-[#0077B5]/5 transition-all flex items-center justify-center gap-2 text-muted-foreground hover:text-[#0077B5]"
              >
                <Plus className="w-4 h-4" />
                <span className="text-sm font-medium">Ajouter une étape</span>
              </button>
            </ScrollArea>
          </div>

          {/* Right: Step editor */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {selectedStep ? (
              <ScrollArea className="flex-1">
                <div className="p-6 space-y-6">
                  {/* Step header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "p-2.5 rounded-xl text-white shadow-lg",
                        getActionConfig(selectedStep.actionType).color
                      )}>
                        {React.createElement(getActionConfig(selectedStep.actionType).icon, { className: "w-5 h-5" })}
                      </div>
                      <div>
                        <h3 className="font-semibold text-lg">
                          Étape {selectedStep.order + 1}
                        </h3>
                        <p className="text-sm text-muted-foreground">
                          {getActionConfig(selectedStep.actionType).description}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => moveStep(selectedStep.id, 'up')}
                        disabled={selectedStep.order === 0}
                        className="h-8 w-8"
                      >
                        <ChevronUp className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => moveStep(selectedStep.id, 'down')}
                        disabled={selectedStep.order === sequence.steps.length - 1}
                        className="h-8 w-8"
                      >
                        <ChevronDown className="w-4 h-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => removeStep(selectedStep.id)}
                        disabled={sequence.steps.length <= 1}
                        className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      >
                        <Trash2 className="w-4 h-4" />
                      </Button>
                    </div>
                  </div>

                  {/* Action type selector */}
                  <Card>
                    <CardHeader className="pb-3">
                      <CardTitle className="text-sm font-medium flex items-center gap-2">
                        <Zap className="w-4 h-4 text-[#0077B5]" />
                        Type d'action
                      </CardTitle>
                    </CardHeader>
                    <CardContent>
                      <div className="grid grid-cols-5 gap-2">
                        {ACTION_TYPES.map((action) => {
                          const isActive = selectedStep.actionType === action.value;
                          return (
                            <button
                              key={action.value}
                              onClick={() => updateStep(selectedStep.id, { actionType: action.value as any })}
                              className={cn(
                                "flex flex-col items-center gap-2 p-3 rounded-xl border-2 transition-all",
                                isActive 
                                  ? "border-[#0077B5] bg-[#0077B5]/5" 
                                  : "border-transparent hover:border-muted-foreground/30 hover:bg-muted/50"
                              )}
                            >
                              <div className={cn(
                                "p-2 rounded-lg text-white",
                                action.color
                              )}>
                                <action.icon className="w-4 h-4" />
                              </div>
                              <span className={cn(
                                "text-xs font-medium text-center",
                                isActive ? "text-[#0077B5]" : "text-muted-foreground"
                              )}>
                                {action.shortLabel}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </CardContent>
                  </Card>

                  {/* Timing & Condition */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* Timing */}
                    {selectedStep.order > 0 && (
                      <Card>
                        <CardHeader className="pb-3">
                          <CardTitle className="text-sm font-medium flex items-center gap-2">
                            <Clock className="w-4 h-4 text-[#0077B5]" />
                            Timing
                          </CardTitle>
                        </CardHeader>
                        <CardContent className="space-y-4">
                          <div className="flex gap-3">
                            <div className="flex-1">
                              <Label className="text-xs text-muted-foreground">Jours</Label>
                              <Input
                                type="number"
                                min={0}
                                value={selectedStep.delayDays}
                                onChange={(e) => updateStep(selectedStep.id, { delayDays: parseInt(e.target.value) || 0 })}
                                className="mt-1"
                              />
                            </div>
                            <div className="flex-1">
                              <Label className="text-xs text-muted-foreground">Heures</Label>
                              <Input
                                type="number"
                                min={0}
                                max={23}
                                value={selectedStep.delayHours}
                                onChange={(e) => updateStep(selectedStep.id, { delayHours: parseInt(e.target.value) || 0 })}
                                className="mt-1"
                              />
                            </div>
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Fenêtre horaire</Label>
                            <div className="flex items-center gap-2 mt-1">
                              <Input
                                type="number"
                                min={0}
                                max={23}
                                value={selectedStep.preferredHourStart}
                                onChange={(e) => updateStep(selectedStep.id, { preferredHourStart: parseInt(e.target.value) || 9 })}
                                className="w-16 text-center"
                              />
                              <span className="text-muted-foreground text-sm">à</span>
                              <Input
                                type="number"
                                min={0}
                                max={23}
                                value={selectedStep.preferredHourEnd}
                                onChange={(e) => updateStep(selectedStep.id, { preferredHourEnd: parseInt(e.target.value) || 18 })}
                                className="w-16 text-center"
                              />
                            </div>
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Condition */}
                    <Card className={selectedStep.order === 0 ? "col-span-2" : ""}>
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium flex items-center gap-2">
                          <Settings2 className="w-4 h-4 text-[#0077B5]" />
                          Condition d'exécution
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <Select
                          value={selectedStep.conditionType}
                          onValueChange={(v) => updateStep(selectedStep.id, { conditionType: v as any })}
                        >
                          <SelectTrigger>
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {CONDITION_TYPES.map((cond) => (
                              <SelectItem key={cond.value} value={cond.value}>
                                <div className="flex items-center gap-2">
                                  <cond.icon className="w-4 h-4 text-muted-foreground" />
                                  {cond.label}
                                </div>
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>

                        {/* Wait event selector */}
                        {selectedStep.conditionType === 'wait_for_event' && (
                          <div className="mt-3">
                            <Label className="text-xs text-muted-foreground">Événement</Label>
                            <Select
                              value={selectedStep.waitForEvent || 'connection_accepted'}
                              onValueChange={(v) => updateStep(selectedStep.id, { waitForEvent: v as any })}
                            >
                              <SelectTrigger className="mt-1">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {WAIT_EVENTS.map((evt) => (
                                  <SelectItem key={evt.value} value={evt.value}>
                                    {evt.label}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  </div>

                  {/* Timeout branch configuration */}
                  {(selectedStep.conditionType === 'wait_until_connected' || selectedStep.conditionType === 'wait_for_event') && (
                    <Card className="border-amber-200 dark:border-amber-800 bg-amber-50/50 dark:bg-amber-950/20">
                      <CardHeader className="pb-3">
                        <CardTitle className="text-sm font-medium flex items-center gap-2 text-amber-700 dark:text-amber-300">
                          <Timer className="w-4 h-4" />
                          Branche de timeout
                        </CardTitle>
                      </CardHeader>
                      <CardContent className="space-y-4">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <Label className="text-xs text-muted-foreground">Timeout après (jours)</Label>
                            <Input
                              type="number"
                              min={1}
                              max={30}
                              value={selectedStep.timeoutDays || ''}
                              onChange={(e) => updateStep(selectedStep.id, { 
                                timeoutDays: e.target.value ? parseInt(e.target.value) : undefined 
                              })}
                              placeholder="Ex: 4"
                              className="mt-1 bg-background"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-muted-foreground">Branche alternative</Label>
                            <Select
                              value={selectedStep.timeoutBranchStepId || 'none'}
                              onValueChange={(v) => updateStep(selectedStep.id, { 
                                timeoutBranchStepId: v === 'none' ? undefined : v 
                              })}
                            >
                              <SelectTrigger className="mt-1 bg-background">
                                <SelectValue placeholder="Sélectionner" />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="none">Étape suivante</SelectItem>
                                {sequence.steps
                                  .filter(s => s.id !== selectedStep.id && s.order > selectedStep.order)
                                  .map((s) => {
                                    const cfg = getActionConfig(s.actionType);
                                    return (
                                      <SelectItem key={s.id} value={s.id}>
                                        <div className="flex items-center gap-2">
                                          <cfg.icon className="w-3 h-3" />
                                          Étape {s.order + 1}: {cfg.shortLabel}
                                        </div>
                                      </SelectItem>
                                    );
                                  })}
                              </SelectContent>
                            </Select>
                          </div>
                        </div>

                        {selectedStep.timeoutDays && (
                          <div className="flex items-start gap-2 text-xs text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-900/40 p-3 rounded-lg">
                            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
                            <span>
                              Si {selectedStep.conditionType === 'wait_until_connected' ? 'la connexion n\'est pas acceptée' : 'l\'événement ne se produit pas'} après <strong>{selectedStep.timeoutDays} jours</strong>, 
                              {selectedStep.timeoutBranchStepId 
                                ? ` basculer vers l'étape ${sequence.steps.find(s => s.id === selectedStep.timeoutBranchStepId)?.order !== undefined ? sequence.steps.find(s => s.id === selectedStep.timeoutBranchStepId)!.order + 1 : '?'}`
                                : ' passer à l\'étape suivante'}.
                            </span>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}

                  {/* Message content */}
                  {needsMessage(selectedStep.actionType) && (
                    <Card>
                      <CardHeader className="pb-3">
                        <div className="flex items-center justify-between">
                          <CardTitle className="text-sm font-medium flex items-center gap-2">
                            <MessageCircle className="w-4 h-4 text-[#0077B5]" />
                            Contenu du message
                          </CardTitle>
                          <div className="flex items-center gap-3">
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={selectedStep.useAiPersonalization}
                                onCheckedChange={(v) => updateStep(selectedStep.id, { useAiPersonalization: v })}
                                id="ai-toggle"
                              />
                              <Label htmlFor="ai-toggle" className="text-sm cursor-pointer flex items-center gap-1">
                                <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                                IA
                              </Label>
                            </div>
                            {selectedStep.useAiPersonalization && (
                              <Select
                                value={selectedStep.aiTone || 'professional'}
                                onValueChange={(v) => updateStep(selectedStep.id, { aiTone: v as any })}
                              >
                                <SelectTrigger className="w-36 h-8">
                                  <SelectValue />
                                </SelectTrigger>
                                <SelectContent>
                                  <SelectItem value="professional">👔 Professionnel</SelectItem>
                                  <SelectItem value="casual">😊 Décontracté</SelectItem>
                                  <SelectItem value="enthusiastic">🚀 Enthousiaste</SelectItem>
                                </SelectContent>
                              </Select>
                            )}
                          </div>
                        </div>
                      </CardHeader>
                      <CardContent>
                        {selectedStep.useAiPersonalization ? (
                          <div className="flex items-center gap-3 p-4 rounded-xl bg-gradient-to-br from-purple-50 to-violet-50 dark:from-purple-950/30 dark:to-violet-950/30 border border-purple-100 dark:border-purple-800">
                            <div className="p-2 rounded-lg bg-purple-100 dark:bg-purple-900/50">
                              <Sparkles className="w-5 h-5 text-purple-600 dark:text-purple-400" />
                            </div>
                            <div>
                              <p className="font-medium text-purple-900 dark:text-purple-100">Message personnalisé par IA</p>
                              <p className="text-sm text-purple-700 dark:text-purple-300">
                                Le message sera généré automatiquement en fonction du profil du candidat et du poste
                              </p>
                            </div>
                          </div>
                        ) : (
                          <div className="space-y-4">
                            {selectedStep.actionType === 'inmail' && (
                              <div>
                                <Label className="text-xs text-muted-foreground">Objet</Label>
                                <Input
                                  value={selectedStep.subjectTemplate || ''}
                                  onChange={(e) => updateStep(selectedStep.id, { subjectTemplate: e.target.value })}
                                  placeholder="Objet du message..."
                                  className="mt-1"
                                />
                              </div>
                            )}
                            <div>
                              <Label className="text-xs text-muted-foreground">Message</Label>
                              <Textarea
                                value={selectedStep.messageTemplate || ''}
                                onChange={(e) => updateStep(selectedStep.id, { messageTemplate: e.target.value })}
                                placeholder="Rédigez votre message..."
                                className="mt-1 min-h-[120px] resize-none"
                              />
                              <p className="text-xs text-muted-foreground mt-2">
                                Variables : <code className="bg-muted px-1 py-0.5 rounded">{'{prenom}'}</code> <code className="bg-muted px-1 py-0.5 rounded">{'{entreprise}'}</code> <code className="bg-muted px-1 py-0.5 rounded">{'{poste}'}</code>
                              </p>
                            </div>
                          </div>
                        )}
                      </CardContent>
                    </Card>
                  )}
                </div>
              </ScrollArea>
            ) : (
              <div className="flex-1 flex items-center justify-center text-muted-foreground">
                <p>Sélectionnez une étape pour la modifier</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t bg-muted/30">
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button 
            onClick={handleSave} 
            disabled={isSaving || !sequence.name.trim()}
            className="bg-gradient-to-r from-[#0077B5] to-[#005E93] hover:from-[#005E93] hover:to-[#004E7A] shadow-lg shadow-[#0077B5]/20"
          >
            {isSaving ? (
              <>Enregistrement...</>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Enregistrer la séquence
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

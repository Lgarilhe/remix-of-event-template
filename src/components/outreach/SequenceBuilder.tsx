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
  { value: 'connection_request', label: 'Invitation LinkedIn', icon: UserPlus, color: 'text-emerald-600' },
  { value: 'inmail', label: 'InMail', icon: Mail, color: 'text-blue-600' },
  { value: 'message', label: 'Message direct', icon: MessageSquare, color: 'text-orange-600' },
  { value: 'profile_visit', label: 'Visite de profil', icon: Eye, color: 'text-sky-600' },
  { value: 'smart_message', label: 'Smart Message (IA)', icon: Sparkles, color: 'text-purple-600' },
];

const CONDITION_TYPES = [
  { value: 'always', label: 'Toujours exécuter' },
  { value: 'if_connected', label: 'Si connecté' },
  { value: 'if_not_connected', label: 'Si non connecté' },
  { value: 'if_no_response', label: 'Si pas de réponse' },
];

const AI_TONES = [
  { value: 'professional', label: 'Professionnel' },
  { value: 'casual', label: 'Décontracté' },
  { value: 'enthusiastic', label: 'Enthousiaste' },
];

const createEmptyStep = (order: number): SequenceStep => ({
  id: crypto.randomUUID(),
  order,
  actionType: 'connection_request',
  conditionType: 'always',
  delayDays: order === 0 ? 0 : 2,
  delayHours: 0,
  preferredHourStart: 9,
  preferredHourEnd: 18,
  useAiPersonalization: false,
  aiTone: 'professional',
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
  const [expandedStepId, setExpandedStepId] = useState<string | null>(
    initialSequence?.steps[0]?.id || sequence.steps[0]?.id || null
  );

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
    setExpandedStepId(newStep.id);
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

  const needsMessage = (type: string) => ['inmail', 'connection_request', 'message', 'smart_message'].includes(type);
  const needsSubject = (type: string) => type === 'inmail';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-hidden flex flex-col bg-white">
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

          {/* Steps */}
          <div>
            <div className="flex items-center justify-between mb-3">
              <Label className="text-base font-medium">Étapes de la séquence</Label>
              <span className="text-sm text-muted-foreground">{sequence.steps.length} étape(s)</span>
            </div>

            <div className="space-y-3">
              {sequence.steps.map((step, index) => {
                const isExpanded = expandedStepId === step.id;
                const actionConfig = ACTION_TYPES.find(a => a.value === step.actionType);
                const ActionIcon = actionConfig?.icon || Mail;

                return (
                  <div
                    key={step.id}
                    className={cn(
                      "border rounded-lg transition-all",
                      isExpanded ? "border-primary bg-muted/30" : "border-border"
                    )}
                  >
                    {/* Step header */}
                    <div
                      className="flex items-center gap-3 p-3 cursor-pointer"
                      onClick={() => setExpandedStepId(isExpanded ? null : step.id)}
                    >
                      <GripVertical className="w-4 h-4 text-muted-foreground" />
                      <div className={cn(
                        "w-8 h-8 rounded-lg flex items-center justify-center bg-muted",
                      )}>
                        <ActionIcon className={cn("w-4 h-4", actionConfig?.color)} />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">
                          Étape {index + 1}: {actionConfig?.label}
                        </div>
                        <div className="text-xs text-muted-foreground flex items-center gap-2">
                          {step.delayDays > 0 && (
                            <span className="flex items-center gap-1">
                              <Clock className="w-3 h-3" />
                              {step.delayDays}j
                            </span>
                          )}
                          {step.useAiPersonalization && (
                            <span className="flex items-center gap-1 text-purple-600">
                              <Sparkles className="w-3 h-3" />
                              IA
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
                        <div className="grid grid-cols-2 gap-4">
                          {/* Action type */}
                          <div>
                            <Label>Type d'action</Label>
                            <Select
                              value={step.actionType}
                              onValueChange={(value) => updateStep(step.id, { actionType: value as any })}
                            >
                              <SelectTrigger className="mt-1.5">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {ACTION_TYPES.map(action => (
                                  <SelectItem key={action.value} value={action.value}>
                                    <div className="flex items-center gap-2">
                                      <action.icon className={cn("w-4 h-4", action.color)} />
                                      {action.label}
                                    </div>
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          {/* Condition */}
                          <div>
                            <Label>Condition</Label>
                            <Select
                              value={step.conditionType}
                              onValueChange={(value) => updateStep(step.id, { conditionType: value as any })}
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
                        </div>

                        {/* Delay (not for first step) */}
                        {index > 0 && (
                          <div className="grid grid-cols-2 gap-4">
                            <div>
                              <Label>Délai (jours)</Label>
                              <Input
                                type="number"
                                min={0}
                                value={step.delayDays}
                                onChange={(e) => updateStep(step.id, { delayDays: parseInt(e.target.value) || 0 })}
                                className="mt-1.5"
                              />
                            </div>
                            <div>
                              <Label>Délai (heures)</Label>
                              <Input
                                type="number"
                                min={0}
                                max={23}
                                value={step.delayHours}
                                onChange={(e) => updateStep(step.id, { delayHours: parseInt(e.target.value) || 0 })}
                                className="mt-1.5"
                              />
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
                                  onValueChange={(value) => updateStep(step.id, { aiTone: value as any })}
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
                                  Le message sera généré automatiquement par l'IA en fonction du profil du candidat.
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
                                  <Label>Message</Label>
                                  <Textarea
                                    value={step.messageTemplate || ''}
                                    onChange={(e) => updateStep(step.id, { messageTemplate: e.target.value })}
                                    placeholder="Bonjour {{firstName}}, ..."
                                    rows={4}
                                    className="mt-1.5"
                                  />
                                  <p className="text-xs text-muted-foreground mt-1">
                                    Variables: {'{{firstName}}'}, {'{{lastName}}'}, {'{{company}}'}, {'{{headline}}'}
                                  </p>
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
            </div>

            {/* Add step button */}
            <Button
              variant="outline"
              onClick={addStep}
              className="w-full mt-3 border-dashed"
            >
              <Plus className="w-4 h-4 mr-2" />
              Ajouter une étape
            </Button>
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

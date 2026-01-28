import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
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
import { 
  Plus, 
  Trash2, 
  GripVertical,
  Mail,
  UserPlus,
  Eye,
  MessageSquare,
  Clock,
  Sparkles,
  ArrowRight,
  GitBranch,
  Save,
} from 'lucide-react';
import { cn } from '@/lib/utils';

export interface SequenceStep {
  id: string;
  order: number;
  actionType: 'inmail' | 'connection_request' | 'profile_visit' | 'message' | 'smart_message';
  conditionType: 'always' | 'if_connected' | 'if_not_connected' | 'if_no_response' | 'wait_until_connected';
  delayDays: number;
  delayHours: number;
  preferredHourStart: number;
  preferredHourEnd: number;
  subjectTemplate?: string;
  messageTemplate?: string;
  useAiPersonalization: boolean;
  aiTone?: 'professional' | 'casual' | 'enthusiastic';
  timeoutDays?: number;
  waitForEvent?: string;
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
  { value: 'smart_message', label: 'Message intelligent', icon: Sparkles, color: 'text-violet-600 bg-violet-100', description: 'Auto-détecte InMail ou Direct selon le niveau de connexion' },
  { value: 'inmail', label: 'InMail', icon: Mail, color: 'text-blue-600 bg-blue-100', description: 'Envoie un InMail LinkedIn' },
  { value: 'connection_request', label: 'Demande connexion', icon: UserPlus, color: 'text-green-600 bg-green-100', description: 'Envoie une demande de connexion' },
  { value: 'profile_visit', label: 'Visite profil', icon: Eye, color: 'text-purple-600 bg-purple-100', description: 'Visite le profil LinkedIn' },
  { value: 'message', label: 'Message direct', icon: MessageSquare, color: 'text-orange-600 bg-orange-100', description: 'Message direct (si connecté)' },
];

const CONDITION_TYPES = [
  { value: 'always', label: 'Toujours', description: 'Exécuter cette étape systématiquement' },
  { value: 'if_connected', label: 'Si connecté', description: 'Uniquement si la demande de connexion a été acceptée' },
  { value: 'if_not_connected', label: 'Si non connecté', description: 'Uniquement si pas encore connecté (1er niveau)' },
  { value: 'if_no_response', label: 'Si pas de réponse', description: 'Uniquement si aucune réponse reçue' },
  { value: 'wait_until_connected', label: 'Attendre connexion', description: 'Pause jusqu\'à ce que la demande soit acceptée' },
];

const createEmptyStep = (order: number): SequenceStep => ({
  id: crypto.randomUUID(),
  order,
  actionType: order === 0 ? 'profile_visit' : 'smart_message',
  conditionType: 'always',
  delayDays: order === 0 ? 0 : 2,
  delayHours: 0,
  preferredHourStart: 9,
  preferredHourEnd: 12,
  useAiPersonalization: true,
  aiTone: 'professional',
  timeoutDays: undefined,
  waitForEvent: undefined,
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
  const [expandedStepId, setExpandedStepId] = useState<string | null>(sequence.steps[0]?.id || null);

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
    setSequence(prev => ({
      ...prev,
      steps: prev.steps
        .filter(s => s.id !== stepId)
        .map((s, idx) => ({ ...s, order: idx })),
    }));
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
    if (!sequence.name.trim()) {
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

  const getActionConfig = (type: string) => ACTION_TYPES.find(a => a.value === type) || ACTION_TYPES[0];
  const needsMessage = (type: string) => ['inmail', 'connection_request', 'message', 'smart_message'].includes(type);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-hidden flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <GitBranch className="w-5 h-5 text-[#0077B5]" />
            {initialSequence?.id ? 'Modifier la séquence' : 'Créer une séquence'}
          </DialogTitle>
          <DialogDescription>
            Créez une séquence d'actions automatisées avec conditions et délais
          </DialogDescription>
        </DialogHeader>

        <div className="flex-1 overflow-hidden flex flex-col gap-4">
          {/* Sequence metadata */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <Label htmlFor="seq-name">Nom de la séquence *</Label>
              <Input
                id="seq-name"
                value={sequence.name}
                onChange={(e) => setSequence(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Ex: Outreach Dev Senior"
                className="mt-1"
              />
            </div>
            <div>
              <Label htmlFor="seq-desc">Description</Label>
              <Input
                id="seq-desc"
                value={sequence.description || ''}
                onChange={(e) => setSequence(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Description optionnelle"
                className="mt-1"
              />
            </div>
          </div>

          {/* Steps timeline */}
          <div className="flex-1 overflow-hidden">
            <div className="flex items-center justify-between mb-3">
              <Label className="text-base font-semibold">Étapes de la séquence</Label>
              <Button variant="outline" size="sm" onClick={addStep} className="gap-1">
                <Plus className="w-4 h-4" />
                Ajouter une étape
              </Button>
            </div>

            <ScrollArea className="h-[400px] pr-4">
              <div className="space-y-3">
                {sequence.steps.map((step, index) => {
                  const actionConfig = getActionConfig(step.actionType);
                  const ActionIcon = actionConfig.icon;
                  const isExpanded = expandedStepId === step.id;
                  const condition = CONDITION_TYPES.find(c => c.value === step.conditionType);

                  return (
                    <div key={step.id} className="relative">
                      {/* Connector line */}
                      {index > 0 && (
                        <div className="absolute left-6 -top-3 w-0.5 h-3 bg-muted-foreground/30" />
                      )}
                      
                      <div
                        className={cn(
                          "border rounded-lg transition-all",
                          isExpanded ? "border-[#0077B5] shadow-sm" : "border-border hover:border-muted-foreground/50"
                        )}
                      >
                        {/* Step header */}
                        <div
                          className="flex items-center gap-3 p-3 cursor-pointer"
                          onClick={() => setExpandedStepId(isExpanded ? null : step.id)}
                        >
                          <div className="flex items-center gap-2 text-muted-foreground">
                            <GripVertical className="w-4 h-4" />
                            <span className="w-6 h-6 rounded-full bg-muted flex items-center justify-center text-xs font-medium">
                              {index + 1}
                            </span>
                          </div>
                          
                          <div className={cn("p-1.5 rounded", actionConfig.color)}>
                            <ActionIcon className="w-4 h-4" />
                          </div>
                          
                          <div className="flex-1 min-w-0">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{actionConfig.label}</span>
                              {step.conditionType !== 'always' && (
                                <Badge variant="outline" className="text-xs">
                                  {condition?.label}
                                </Badge>
                              )}
                            </div>
                            {index > 0 && (
                              <div className="flex items-center gap-1 text-xs text-muted-foreground mt-0.5">
                                <Clock className="w-3 h-3" />
                                J+{step.delayDays}{step.delayHours > 0 && ` ${step.delayHours}h`}
                                {step.preferredHourStart !== undefined && (
                                  <span> • {step.preferredHourStart}h-{step.preferredHourEnd}h</span>
                                )}
                              </div>
                            )}
                          </div>

                          {step.useAiPersonalization && (
                            <Badge variant="secondary" className="gap-1">
                              <Sparkles className="w-3 h-3" />
                              IA
                            </Badge>
                          )}

                          <Button
                            variant="ghost"
                            size="icon"
                            className="h-8 w-8 text-muted-foreground hover:text-destructive"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeStep(step.id);
                            }}
                            disabled={sequence.steps.length <= 1}
                          >
                            <Trash2 className="w-4 h-4" />
                          </Button>
                        </div>

                        {/* Expanded content */}
                        {isExpanded && (
                          <div className="border-t p-4 space-y-4 bg-muted/30">
                            <div className="grid grid-cols-2 gap-4">
                              {/* Action type */}
                              <div>
                                <Label>Type d'action</Label>
                                <Select
                                  value={step.actionType}
                                  onValueChange={(v) => updateStep(step.id, { actionType: v as any })}
                                >
                                  <SelectTrigger className="mt-1">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {ACTION_TYPES.map((action) => (
                                      <SelectItem key={action.value} value={action.value}>
                                        <div className="flex items-center gap-2">
                                          <action.icon className="w-4 h-4" />
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
                                  onValueChange={(v) => updateStep(step.id, { conditionType: v as any })}
                                >
                                  <SelectTrigger className="mt-1">
                                    <SelectValue />
                                  </SelectTrigger>
                                  <SelectContent>
                                    {CONDITION_TYPES.map((cond) => (
                                      <SelectItem key={cond.value} value={cond.value}>
                                        <div>
                                          <div>{cond.label}</div>
                                          <div className="text-xs text-muted-foreground">{cond.description}</div>
                                        </div>
                                      </SelectItem>
                                    ))}
                                  </SelectContent>
                                </Select>
                              </div>
                            </div>

                            {/* Delay (not for first step) */}
                            {index > 0 && (
                              <div className="grid grid-cols-3 gap-4">
                                <div>
                                  <Label>Délai (jours)</Label>
                                  <Input
                                    type="number"
                                    min={0}
                                    value={step.delayDays}
                                    onChange={(e) => updateStep(step.id, { delayDays: parseInt(e.target.value) || 0 })}
                                    className="mt-1"
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
                                    className="mt-1"
                                  />
                                </div>
                                <div>
                                  <Label>Fenêtre horaire</Label>
                                  <div className="flex items-center gap-2 mt-1">
                                    <Input
                                      type="number"
                                      min={0}
                                      max={23}
                                      value={step.preferredHourStart}
                                      onChange={(e) => updateStep(step.id, { preferredHourStart: parseInt(e.target.value) || 9 })}
                                      className="w-16"
                                    />
                                    <span className="text-muted-foreground">à</span>
                                    <Input
                                      type="number"
                                      min={0}
                                      max={23}
                                      value={step.preferredHourEnd}
                                      onChange={(e) => updateStep(step.id, { preferredHourEnd: parseInt(e.target.value) || 18 })}
                                      className="w-16"
                                    />
                                  </div>
                                </div>
                              </div>
                            )}

                            {/* Message content (for types that need it) */}
                            {needsMessage(step.actionType) && (
                              <>
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2">
                                    <Switch
                                      checked={step.useAiPersonalization}
                                      onCheckedChange={(v) => updateStep(step.id, { useAiPersonalization: v })}
                                    />
                                    <Label className="cursor-pointer">
                                      <Sparkles className="w-4 h-4 inline mr-1 text-purple-500" />
                                      Personnalisation IA
                                    </Label>
                                  </div>
                                  
                                  {step.useAiPersonalization && (
                                    <Select
                                      value={step.aiTone || 'professional'}
                                      onValueChange={(v) => updateStep(step.id, { aiTone: v as any })}
                                    >
                                      <SelectTrigger className="w-40">
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

                                {!step.useAiPersonalization && (
                                  <>
                                    {step.actionType === 'inmail' && (
                                      <div>
                                        <Label>Objet</Label>
                                        <Input
                                          value={step.subjectTemplate || ''}
                                          onChange={(e) => updateStep(step.id, { subjectTemplate: e.target.value })}
                                          placeholder="Objet du message"
                                          className="mt-1"
                                        />
                                      </div>
                                    )}
                                    <div>
                                      <Label>Message</Label>
                                      <Textarea
                                        value={step.messageTemplate || ''}
                                        onChange={(e) => updateStep(step.id, { messageTemplate: e.target.value })}
                                        placeholder="Corps du message. Utilisez {prenom}, {entreprise}, {poste} pour la personnalisation."
                                        className="mt-1 min-h-[100px]"
                                      />
                                      <p className="text-xs text-muted-foreground mt-1">
                                        Variables disponibles : {'{prenom}'}, {'{nom}'}, {'{entreprise}'}, {'{poste}'}, {'{job_title}'}
                                      </p>
                                    </div>
                                  </>
                                )}
                              </>
                            )}
                          </div>
                        )}
                      </div>

                      {/* Arrow to next step */}
                      {index < sequence.steps.length - 1 && (
                        <div className="flex justify-center py-1">
                          <ArrowRight className="w-4 h-4 text-muted-foreground/50 rotate-90" />
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </ScrollArea>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button 
            onClick={handleSave} 
            disabled={isSaving || !sequence.name.trim()}
            className="bg-[#0077B5] hover:bg-[#005E93]"
          >
            {isSaving ? (
              <>Enregistrement...</>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Enregistrer
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

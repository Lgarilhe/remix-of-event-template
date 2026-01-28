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
import { ScrollArea } from '@/components/ui/scroll-area';
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
  Timer,
  AlertCircle,
  GripVertical,
  Zap,
  Send,
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

const ACTION_CONFIG: Record<string, { label: string; icon: typeof Mail; color: string }> = {
  smart_message: { label: 'Smart Message', icon: Sparkles, color: 'text-purple-600 bg-purple-100' },
  connection_request: { label: 'Invitation', icon: UserPlus, color: 'text-emerald-600 bg-emerald-100' },
  profile_visit: { label: 'Visite profil', icon: Eye, color: 'text-blue-600 bg-blue-100' },
  inmail: { label: 'InMail', icon: Mail, color: 'text-indigo-600 bg-indigo-100' },
  message: { label: 'Message', icon: MessageSquare, color: 'text-orange-600 bg-orange-100' },
};

const CONDITION_OPTIONS = [
  { value: 'always', label: 'Toujours' },
  { value: 'if_connected', label: 'Si connecté' },
  { value: 'if_not_connected', label: 'Si non connecté' },
  { value: 'if_no_response', label: 'Si pas de réponse' },
  { value: 'wait_until_connected', label: 'Attendre connexion' },
  { value: 'wait_for_event', label: 'Attendre événement' },
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

  const needsMessage = (type: string) => ['inmail', 'connection_request', 'message', 'smart_message'].includes(type);

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-4xl max-h-[85vh] overflow-hidden flex flex-col p-0 gap-0 bg-white">
        {/* Header */}
        <DialogHeader className="px-6 py-4 border-b border-gray-100">
          <DialogTitle className="text-lg font-semibold text-gray-900">
            {initialSequence?.id ? 'Modifier la séquence' : 'Nouvelle séquence'}
          </DialogTitle>
        </DialogHeader>

        {/* Sequence name */}
        <div className="px-6 py-4 border-b border-gray-100 bg-gray-50/50">
          <div className="flex gap-4">
            <div className="flex-1">
              <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Nom</Label>
              <Input
                value={sequence.name}
                onChange={(e) => setSequence(prev => ({ ...prev, name: e.target.value }))}
                placeholder="Ex: Outreach développeurs React"
                className="mt-1.5 border-gray-200 bg-white focus:border-blue-500 focus:ring-blue-500/20"
              />
            </div>
            <div className="flex-1">
              <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Description (optionnel)</Label>
              <Input
                value={sequence.description || ''}
                onChange={(e) => setSequence(prev => ({ ...prev, description: e.target.value }))}
                placeholder="Brève description..."
                className="mt-1.5 border-gray-200 bg-white focus:border-blue-500 focus:ring-blue-500/20"
              />
            </div>
          </div>
        </div>

        {/* Main content */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Steps list */}
          <div className="w-72 border-r border-gray-100 flex flex-col bg-gray-50/30">
            <div className="px-4 py-3 border-b border-gray-100">
              <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">Étapes</span>
            </div>
            
            <ScrollArea className="flex-1">
              <div className="p-3 space-y-2">
                {sequence.steps.map((step, index) => {
                  const config = ACTION_CONFIG[step.actionType];
                  const Icon = config.icon;
                  const isSelected = selectedStepId === step.id;

                  return (
                    <button
                      key={step.id}
                      onClick={() => setSelectedStepId(step.id)}
                      className={cn(
                        "w-full flex items-center gap-3 p-3 rounded-lg text-left transition-all",
                        isSelected 
                          ? "bg-white shadow-sm ring-1 ring-blue-500" 
                          : "bg-white/60 hover:bg-white hover:shadow-sm"
                      )}
                    >
                      <div className="flex items-center gap-2">
                        <GripVertical className="w-4 h-4 text-gray-300" />
                        <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", config.color)}>
                          <Icon className="w-4 h-4" />
                        </div>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="text-sm font-medium text-gray-900 truncate">
                          {config.label}
                        </div>
                        <div className="text-xs text-gray-500">
                          {index === 0 ? 'Immédiat' : `J+${step.delayDays}`}
                          {step.conditionType !== 'always' && ` · ${CONDITION_OPTIONS.find(c => c.value === step.conditionType)?.label}`}
                        </div>
                      </div>
                      {step.useAiPersonalization && needsMessage(step.actionType) && (
                        <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                      )}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>

            <div className="p-3 border-t border-gray-100">
              <Button
                onClick={addStep}
                variant="outline"
                className="w-full border-dashed border-gray-300 text-gray-600 hover:text-blue-600 hover:border-blue-400 hover:bg-blue-50/50"
              >
                <Plus className="w-4 h-4 mr-2" />
                Ajouter une étape
              </Button>
            </div>
          </div>

          {/* Right: Step editor */}
          <div className="flex-1 flex flex-col overflow-hidden bg-white">
            {selectedStep ? (
              <ScrollArea className="flex-1">
                <div className="p-6 space-y-6">
                  {/* Step header */}
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      <div className={cn(
                        "w-10 h-10 rounded-lg flex items-center justify-center",
                        ACTION_CONFIG[selectedStep.actionType].color
                      )}>
                        {React.createElement(ACTION_CONFIG[selectedStep.actionType].icon, { className: "w-5 h-5" })}
                      </div>
                      <div>
                        <h3 className="font-semibold text-gray-900">Étape {selectedStep.order + 1}</h3>
                        <p className="text-sm text-gray-500">{ACTION_CONFIG[selectedStep.actionType].label}</p>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => removeStep(selectedStep.id)}
                      disabled={sequence.steps.length <= 1}
                      className="text-gray-400 hover:text-red-600 hover:bg-red-50"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>

                  {/* Action type */}
                  <div>
                    <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Action</Label>
                    <div className="grid grid-cols-5 gap-2 mt-2">
                      {Object.entries(ACTION_CONFIG).map(([value, config]) => {
                        const Icon = config.icon;
                        const isActive = selectedStep.actionType === value;
                        return (
                          <button
                            key={value}
                            onClick={() => updateStep(selectedStep.id, { actionType: value as any })}
                            className={cn(
                              "flex flex-col items-center gap-1.5 p-3 rounded-lg border transition-all",
                              isActive 
                                ? "border-blue-500 bg-blue-50" 
                                : "border-gray-200 hover:border-gray-300 hover:bg-gray-50"
                            )}
                          >
                            <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", config.color)}>
                              <Icon className="w-4 h-4" />
                            </div>
                            <span className={cn(
                              "text-xs font-medium",
                              isActive ? "text-blue-700" : "text-gray-600"
                            )}>
                              {config.label}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Timing & Condition */}
                  <div className="grid grid-cols-2 gap-4">
                    {/* Timing */}
                    {selectedStep.order > 0 && (
                      <div className="space-y-4 p-4 rounded-lg bg-gray-50 border border-gray-100">
                        <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                          <Clock className="w-4 h-4 text-gray-400" />
                          Délai
                        </div>
                        <div className="grid grid-cols-2 gap-3">
                          <div>
                            <Label className="text-xs text-gray-500">Jours</Label>
                            <Input
                              type="number"
                              min={0}
                              value={selectedStep.delayDays}
                              onChange={(e) => updateStep(selectedStep.id, { delayDays: parseInt(e.target.value) || 0 })}
                              className="mt-1 bg-white border-gray-200"
                            />
                          </div>
                          <div>
                            <Label className="text-xs text-gray-500">Heures</Label>
                            <Input
                              type="number"
                              min={0}
                              max={23}
                              value={selectedStep.delayHours}
                              onChange={(e) => updateStep(selectedStep.id, { delayHours: parseInt(e.target.value) || 0 })}
                              className="mt-1 bg-white border-gray-200"
                            />
                          </div>
                        </div>
                        <div>
                          <Label className="text-xs text-gray-500">Fenêtre horaire</Label>
                          <div className="flex items-center gap-2 mt-1">
                            <Input
                              type="number"
                              min={0}
                              max={23}
                              value={selectedStep.preferredHourStart}
                              onChange={(e) => updateStep(selectedStep.id, { preferredHourStart: parseInt(e.target.value) || 9 })}
                              className="w-16 text-center bg-white border-gray-200"
                            />
                            <span className="text-gray-400 text-sm">à</span>
                            <Input
                              type="number"
                              min={0}
                              max={23}
                              value={selectedStep.preferredHourEnd}
                              onChange={(e) => updateStep(selectedStep.id, { preferredHourEnd: parseInt(e.target.value) || 18 })}
                              className="w-16 text-center bg-white border-gray-200"
                            />
                          </div>
                        </div>
                      </div>
                    )}

                    {/* Condition */}
                    <div className={cn(
                      "space-y-4 p-4 rounded-lg bg-gray-50 border border-gray-100",
                      selectedStep.order === 0 && "col-span-2"
                    )}>
                      <div className="flex items-center gap-2 text-sm font-medium text-gray-700">
                        <Zap className="w-4 h-4 text-gray-400" />
                        Condition
                      </div>
                      <Select
                        value={selectedStep.conditionType}
                        onValueChange={(v) => updateStep(selectedStep.id, { conditionType: v as any })}
                      >
                        <SelectTrigger className="bg-white border-gray-200">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {CONDITION_OPTIONS.map((opt) => (
                            <SelectItem key={opt.value} value={opt.value}>
                              {opt.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>

                      {selectedStep.conditionType === 'wait_for_event' && (
                        <div>
                          <Label className="text-xs text-gray-500">Événement</Label>
                          <Select
                            value={selectedStep.waitForEvent || 'connection_accepted'}
                            onValueChange={(v) => updateStep(selectedStep.id, { waitForEvent: v as any })}
                          >
                            <SelectTrigger className="mt-1 bg-white border-gray-200">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="connection_accepted">Connexion acceptée</SelectItem>
                              <SelectItem value="reply_received">Réponse reçue</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      )}
                    </div>
                  </div>

                  {/* Timeout branch */}
                  {(selectedStep.conditionType === 'wait_until_connected' || selectedStep.conditionType === 'wait_for_event') && (
                    <div className="p-4 rounded-lg bg-amber-50 border border-amber-200">
                      <div className="flex items-center gap-2 mb-3">
                        <Timer className="w-4 h-4 text-amber-600" />
                        <span className="text-sm font-medium text-amber-800">Timeout</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs text-amber-700">Après (jours)</Label>
                          <Input
                            type="number"
                            min={1}
                            max={30}
                            value={selectedStep.timeoutDays || ''}
                            onChange={(e) => updateStep(selectedStep.id, { 
                              timeoutDays: e.target.value ? parseInt(e.target.value) : undefined 
                            })}
                            placeholder="4"
                            className="mt-1 bg-white border-amber-200"
                          />
                        </div>
                        <div>
                          <Label className="text-xs text-amber-700">Alors aller à</Label>
                          <Select
                            value={selectedStep.timeoutBranchStepId || 'none'}
                            onValueChange={(v) => updateStep(selectedStep.id, { 
                              timeoutBranchStepId: v === 'none' ? undefined : v 
                            })}
                          >
                            <SelectTrigger className="mt-1 bg-white border-amber-200">
                              <SelectValue placeholder="Étape suivante" />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="none">Étape suivante</SelectItem>
                              {sequence.steps
                                .filter(s => s.id !== selectedStep.id && s.order > selectedStep.order)
                                .map((s) => (
                                  <SelectItem key={s.id} value={s.id}>
                                    Étape {s.order + 1}: {ACTION_CONFIG[s.actionType].label}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      {selectedStep.timeoutDays && (
                        <div className="flex items-start gap-2 mt-3 text-xs text-amber-700">
                          <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                          <span>
                            Si pas de réponse après {selectedStep.timeoutDays}j → {selectedStep.timeoutBranchStepId 
                              ? `étape ${sequence.steps.find(s => s.id === selectedStep.timeoutBranchStepId)?.order !== undefined ? sequence.steps.find(s => s.id === selectedStep.timeoutBranchStepId)!.order + 1 : '?'}`
                              : 'étape suivante'}
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Message content */}
                  {needsMessage(selectedStep.actionType) && (
                    <div className="space-y-4">
                      <div className="flex items-center justify-between">
                        <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Message</Label>
                        <div className="flex items-center gap-3">
                          <div className="flex items-center gap-2">
                            <Switch
                              checked={selectedStep.useAiPersonalization}
                              onCheckedChange={(v) => updateStep(selectedStep.id, { useAiPersonalization: v })}
                              id="ai-toggle"
                              className="data-[state=checked]:bg-purple-600"
                            />
                            <Label htmlFor="ai-toggle" className="text-sm cursor-pointer flex items-center gap-1 text-gray-600">
                              <Sparkles className="w-3.5 h-3.5 text-purple-500" />
                              IA
                            </Label>
                          </div>
                          {selectedStep.useAiPersonalization && (
                            <Select
                              value={selectedStep.aiTone || 'professional'}
                              onValueChange={(v) => updateStep(selectedStep.id, { aiTone: v as any })}
                            >
                              <SelectTrigger className="w-32 h-8 text-xs border-gray-200">
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectItem value="professional">Professionnel</SelectItem>
                                <SelectItem value="casual">Décontracté</SelectItem>
                                <SelectItem value="enthusiastic">Enthousiaste</SelectItem>
                              </SelectContent>
                            </Select>
                          )}
                        </div>
                      </div>

                      {selectedStep.useAiPersonalization ? (
                        <div className="flex items-center gap-3 p-4 rounded-lg bg-purple-50 border border-purple-100">
                          <div className="w-10 h-10 rounded-lg bg-purple-100 flex items-center justify-center">
                            <Sparkles className="w-5 h-5 text-purple-600" />
                          </div>
                          <div>
                            <p className="font-medium text-purple-900 text-sm">Personnalisation IA activée</p>
                            <p className="text-xs text-purple-700">
                              Message généré selon le profil et le poste
                            </p>
                          </div>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {selectedStep.actionType === 'inmail' && (
                            <div>
                              <Label className="text-xs text-gray-500">Objet</Label>
                              <Input
                                value={selectedStep.subjectTemplate || ''}
                                onChange={(e) => updateStep(selectedStep.id, { subjectTemplate: e.target.value })}
                                placeholder="Objet du message..."
                                className="mt-1 border-gray-200"
                              />
                            </div>
                          )}
                          <div>
                            <Label className="text-xs text-gray-500">Corps du message</Label>
                            <Textarea
                              value={selectedStep.messageTemplate || ''}
                              onChange={(e) => updateStep(selectedStep.id, { messageTemplate: e.target.value })}
                              placeholder="Rédigez votre message..."
                              className="mt-1 min-h-[100px] resize-none border-gray-200"
                            />
                            <p className="text-xs text-gray-400 mt-1.5">
                              Variables: <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-600">{'{prenom}'}</code> <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-600">{'{entreprise}'}</code> <code className="bg-gray-100 px-1 py-0.5 rounded text-gray-600">{'{poste}'}</code>
                            </p>
                          </div>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </ScrollArea>
            ) : (
              <div className="flex-1 flex items-center justify-center text-gray-400">
                <p>Sélectionnez une étape</p>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <DialogFooter className="px-6 py-4 border-t border-gray-100 bg-gray-50/50">
          <Button variant="outline" onClick={onClose} className="border-gray-200">
            Annuler
          </Button>
          <Button 
            onClick={handleSave} 
            disabled={isSaving || !sequence.name.trim()}
            className="bg-blue-600 hover:bg-blue-700 text-white"
          >
            {isSaving ? (
              'Enregistrement...'
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

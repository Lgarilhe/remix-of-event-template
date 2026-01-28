import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { ScrollArea } from '@/components/ui/scroll-area';
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
  X,
  Play,
  ChevronRight,
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

const NODE_TYPES = [
  { type: 'connection_request', label: 'Invitation', icon: UserPlus, color: 'bg-emerald-500', bgLight: 'bg-emerald-50', textColor: 'text-emerald-700' },
  { type: 'inmail', label: 'InMail', icon: Mail, color: 'bg-blue-500', bgLight: 'bg-blue-50', textColor: 'text-blue-700' },
  { type: 'message', label: 'Message', icon: MessageSquare, color: 'bg-orange-500', bgLight: 'bg-orange-50', textColor: 'text-orange-700' },
  { type: 'profile_visit', label: 'Visite profil', icon: Eye, color: 'bg-sky-500', bgLight: 'bg-sky-50', textColor: 'text-sky-700' },
  { type: 'smart_message', label: 'Smart IA', icon: Sparkles, color: 'bg-purple-500', bgLight: 'bg-purple-50', textColor: 'text-purple-700' },
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

const createEmptyStep = (order: number, actionType: string = 'connection_request'): SequenceStep => ({
  id: crypto.randomUUID(),
  order,
  actionType: actionType as any,
  conditionType: 'always',
  delayDays: order === 0 ? 0 : 2,
  delayHours: 0,
  preferredHourStart: 9,
  preferredHourEnd: 18,
  useAiPersonalization: actionType === 'smart_message',
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
      steps: [],
      isActive: true,
    }
  );
  const [isSaving, setIsSaving] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);

  const selectedStep = sequence.steps.find(s => s.id === selectedStepId);

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
    setSelectedStepId(newStep.id);
  };

  const insertStepAfter = (afterIndex: number, actionType: string) => {
    const newStep = createEmptyStep(afterIndex + 1, actionType);
    const newSteps = [...sequence.steps];
    newSteps.splice(afterIndex + 1, 0, newStep);
    // Reorder
    const reordered = newSteps.map((s, idx) => ({ ...s, order: idx }));
    setSequence(prev => ({ ...prev, steps: reordered }));
    setSelectedStepId(newStep.id);
  };

  const removeStep = (stepId: string) => {
    const newSteps = sequence.steps
      .filter(s => s.id !== stepId)
      .map((s, idx) => ({ ...s, order: idx }));
    setSequence(prev => ({ ...prev, steps: newSteps }));
    if (selectedStepId === stepId) {
      setSelectedStepId(newSteps[0]?.id || null);
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

  const getNodeConfig = (actionType: string) => NODE_TYPES.find(n => n.type === actionType) || NODE_TYPES[0];

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-6xl h-[85vh] overflow-hidden flex flex-col p-0 gap-0 bg-[#1a1a2e]">
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 bg-[#1a1a2e]">
          <div className="flex items-center gap-4">
            <Input
              value={sequence.name}
              onChange={(e) => setSequence(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Nom de la séquence..."
              className="w-64 bg-white/5 border-white/10 text-white placeholder:text-white/40 focus-visible:ring-purple-500"
            />
          </div>
          <div className="flex items-center gap-2">
            <Button 
              variant="ghost" 
              size="sm" 
              onClick={onClose}
              className="text-white/60 hover:text-white hover:bg-white/10"
            >
              Annuler
            </Button>
            <Button 
              onClick={handleSave} 
              disabled={isSaving || !sequence.name.trim() || sequence.steps.length === 0}
              size="sm"
              className="bg-purple-600 hover:bg-purple-700 text-white"
            >
              <Save className="w-4 h-4 mr-2" />
              {isSaving ? 'Sauvegarde...' : 'Enregistrer'}
            </Button>
          </div>
        </div>

        <div className="flex-1 flex overflow-hidden">
          {/* Left sidebar - Node palette */}
          <div className="w-56 border-r border-white/10 bg-[#16162a] p-3 flex flex-col">
            <div className="text-xs font-medium text-white/40 uppercase tracking-wider mb-3">
              Actions
            </div>
            <div className="space-y-2">
              {NODE_TYPES.map((node) => {
                const Icon = node.icon;
                return (
                  <button
                    key={node.type}
                    onClick={() => addStep(node.type)}
                    className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg bg-white/5 hover:bg-white/10 border border-white/10 hover:border-white/20 transition-all text-left group"
                  >
                    <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", node.color)}>
                      <Icon className="w-4 h-4 text-white" />
                    </div>
                    <span className="text-sm text-white/80 group-hover:text-white">{node.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Canvas */}
          <div className="flex-1 bg-[#0d0d1a] overflow-auto relative">
            {/* Grid pattern */}
            <div 
              className="absolute inset-0 opacity-20"
              style={{
                backgroundImage: `
                  linear-gradient(rgba(255,255,255,.03) 1px, transparent 1px),
                  linear-gradient(90deg, rgba(255,255,255,.03) 1px, transparent 1px)
                `,
                backgroundSize: '20px 20px',
              }}
            />

            <div className="relative p-8 min-h-full">
              {sequence.steps.length === 0 ? (
                /* Empty state */
                <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
                  <div className="w-16 h-16 rounded-2xl bg-purple-500/20 flex items-center justify-center mb-4">
                    <Play className="w-8 h-8 text-purple-400" />
                  </div>
                  <h3 className="text-lg font-medium text-white mb-2">Créez votre workflow</h3>
                  <p className="text-white/50 text-sm max-w-xs">
                    Cliquez sur une action dans le panneau de gauche pour commencer
                  </p>
                </div>
              ) : (
                /* Workflow nodes */
                <div className="flex flex-col items-center gap-0">
                  {/* Start node */}
                  <div className="flex items-center justify-center w-10 h-10 rounded-full bg-green-500/20 border-2 border-green-500 mb-2">
                    <Play className="w-4 h-4 text-green-400" />
                  </div>

                  {sequence.steps.map((step, index) => {
                    const config = getNodeConfig(step.actionType);
                    const Icon = config.icon;
                    const isSelected = selectedStepId === step.id;

                    return (
                      <React.Fragment key={step.id}>
                        {/* Connector line */}
                        <div className="flex flex-col items-center">
                          <div className="w-0.5 h-6 bg-white/20" />
                          
                          {/* Delay badge on connector */}
                          {step.delayDays > 0 || step.delayHours > 0 ? (
                            <div className="flex items-center gap-1 px-2 py-1 rounded-full bg-white/10 text-xs text-white/60 my-1">
                              <Clock className="w-3 h-3" />
                              {step.delayDays > 0 && `${step.delayDays}j`}
                              {step.delayDays > 0 && step.delayHours > 0 && ' '}
                              {step.delayHours > 0 && `${step.delayHours}h`}
                            </div>
                          ) : null}
                          
                          <div className="w-0.5 h-6 bg-white/20" />
                        </div>

                        {/* Node */}
                        <div
                          onClick={() => setSelectedStepId(step.id)}
                          className={cn(
                            "relative w-64 rounded-xl border-2 transition-all cursor-pointer",
                            "bg-[#1e1e3a] hover:bg-[#252550]",
                            isSelected 
                              ? "border-purple-500 shadow-lg shadow-purple-500/20" 
                              : "border-white/10 hover:border-white/20"
                          )}
                        >
                          {/* Node header */}
                          <div className={cn("flex items-center gap-3 px-4 py-3 rounded-t-xl", config.color + '/20')}>
                            <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", config.color)}>
                              <Icon className="w-4 h-4 text-white" />
                            </div>
                            <div className="flex-1 min-w-0">
                              <div className="text-sm font-medium text-white">{config.label}</div>
                              {step.useAiPersonalization && (
                                <div className="flex items-center gap-1 text-xs text-purple-400">
                                  <Sparkles className="w-3 h-3" />
                                  Personnalisation IA
                                </div>
                              )}
                            </div>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                removeStep(step.id);
                              }}
                              className="p-1 rounded hover:bg-white/10 text-white/40 hover:text-red-400"
                            >
                              <X className="w-4 h-4" />
                            </button>
                          </div>

                          {/* Node body - condition info */}
                          <div className="px-4 py-2 text-xs text-white/50">
                            {CONDITION_TYPES.find(c => c.value === step.conditionType)?.label}
                          </div>

                          {/* Add node button (between nodes) */}
                          <div className="absolute -bottom-10 left-1/2 -translate-x-1/2 opacity-0 hover:opacity-100 transition-opacity z-10">
                            <div className="relative group">
                              <button className="w-6 h-6 rounded-full bg-purple-500 hover:bg-purple-400 flex items-center justify-center text-white shadow-lg">
                                <Plus className="w-3 h-3" />
                              </button>
                              {/* Dropdown */}
                              <div className="absolute top-full left-1/2 -translate-x-1/2 mt-1 hidden group-hover:block">
                                <div className="bg-[#1e1e3a] border border-white/10 rounded-lg shadow-xl py-1 min-w-[140px]">
                                  {NODE_TYPES.map((node) => {
                                    const NodeIcon = node.icon;
                                    return (
                                      <button
                                        key={node.type}
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          insertStepAfter(index, node.type);
                                        }}
                                        className="w-full flex items-center gap-2 px-3 py-2 hover:bg-white/10 text-white/80 text-sm"
                                      >
                                        <NodeIcon className="w-4 h-4" />
                                        {node.label}
                                      </button>
                                    );
                                  })}
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </React.Fragment>
                    );
                  })}

                  {/* End connector & add button */}
                  <div className="flex flex-col items-center mt-2">
                    <div className="w-0.5 h-8 bg-white/20" />
                    <button
                      onClick={() => addStep('connection_request')}
                      className="w-8 h-8 rounded-full border-2 border-dashed border-white/30 hover:border-purple-500 flex items-center justify-center text-white/30 hover:text-purple-400 transition-colors"
                    >
                      <Plus className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Right panel - Node configuration */}
          {selectedStep && (
            <div className="w-80 border-l border-white/10 bg-[#16162a] flex flex-col">
              <div className="px-4 py-3 border-b border-white/10">
                <div className="flex items-center gap-2">
                  {React.createElement(getNodeConfig(selectedStep.actionType).icon, { 
                    className: cn("w-5 h-5", getNodeConfig(selectedStep.actionType).textColor) 
                  })}
                  <span className="font-medium text-white">
                    {getNodeConfig(selectedStep.actionType).label}
                  </span>
                </div>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-4 space-y-5">
                  {/* Timing */}
                  {selectedStep.order > 0 && (
                    <div className="space-y-3">
                      <Label className="text-white/60 text-xs uppercase tracking-wide">Timing</Label>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-white/80 text-sm">Jours</Label>
                          <Input
                            type="number"
                            min={0}
                            value={selectedStep.delayDays}
                            onChange={(e) => updateStep(selectedStep.id, { delayDays: parseInt(e.target.value) || 0 })}
                            className="mt-1 bg-white/5 border-white/10 text-white"
                          />
                        </div>
                        <div>
                          <Label className="text-white/80 text-sm">Heures</Label>
                          <Input
                            type="number"
                            min={0}
                            max={23}
                            value={selectedStep.delayHours}
                            onChange={(e) => updateStep(selectedStep.id, { delayHours: parseInt(e.target.value) || 0 })}
                            className="mt-1 bg-white/5 border-white/10 text-white"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Condition */}
                  <div className="space-y-3">
                    <Label className="text-white/60 text-xs uppercase tracking-wide">Condition</Label>
                    <Select
                      value={selectedStep.conditionType}
                      onValueChange={(value) => updateStep(selectedStep.id, { conditionType: value as any })}
                    >
                      <SelectTrigger className="bg-white/5 border-white/10 text-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-[#1e1e3a] border-white/10">
                        {CONDITION_TYPES.map(cond => (
                          <SelectItem key={cond.value} value={cond.value} className="text-white hover:bg-white/10">
                            {cond.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Message fields */}
                  {needsMessage(selectedStep.actionType) && (
                    <>
                      {/* AI toggle */}
                      <div className="flex items-center justify-between p-3 rounded-lg bg-purple-500/10 border border-purple-500/20">
                        <div className="flex items-center gap-2">
                          <Sparkles className="w-4 h-4 text-purple-400" />
                          <span className="text-sm text-white">IA Personnalisation</span>
                        </div>
                        <Switch
                          checked={selectedStep.useAiPersonalization}
                          onCheckedChange={(checked) => updateStep(selectedStep.id, { useAiPersonalization: checked })}
                        />
                      </div>

                      {selectedStep.useAiPersonalization ? (
                        <div className="space-y-3">
                          <Label className="text-white/60 text-xs uppercase tracking-wide">Ton du message</Label>
                          <Select
                            value={selectedStep.aiTone || 'professional'}
                            onValueChange={(value) => updateStep(selectedStep.id, { aiTone: value as any })}
                          >
                            <SelectTrigger className="bg-white/5 border-white/10 text-white">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-[#1e1e3a] border-white/10">
                              {AI_TONES.map(tone => (
                                <SelectItem key={tone.value} value={tone.value} className="text-white hover:bg-white/10">
                                  {tone.label}
                                </SelectItem>
                              ))}
                            </SelectContent>
                          </Select>
                          <p className="text-xs text-white/40">
                            Le message sera généré automatiquement selon le profil du candidat.
                          </p>
                        </div>
                      ) : (
                        <>
                          {needsSubject(selectedStep.actionType) && (
                            <div className="space-y-2">
                              <Label className="text-white/80 text-sm">Objet</Label>
                              <Input
                                value={selectedStep.subjectTemplate || ''}
                                onChange={(e) => updateStep(selectedStep.id, { subjectTemplate: e.target.value })}
                                placeholder="Objet de l'InMail"
                                className="bg-white/5 border-white/10 text-white placeholder:text-white/30"
                              />
                            </div>
                          )}
                          <div className="space-y-2">
                            <Label className="text-white/80 text-sm">Message</Label>
                            <Textarea
                              value={selectedStep.messageTemplate || ''}
                              onChange={(e) => updateStep(selectedStep.id, { messageTemplate: e.target.value })}
                              placeholder="Bonjour {{firstName}}, ..."
                              rows={5}
                              className="bg-white/5 border-white/10 text-white placeholder:text-white/30 resize-none"
                            />
                            <p className="text-xs text-white/40">
                              Variables: {'{{firstName}}'}, {'{{lastName}}'}, {'{{company}}'}
                            </p>
                          </div>
                        </>
                      )}
                    </>
                  )}
                </div>
              </ScrollArea>
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

import React, { useState } from 'react';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs';
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
  MoreHorizontal,
  Pencil,
  X,
  ArrowLeft,
  Linkedin,
  Lock,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

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

// Step picker actions
const STEP_ACTIONS = {
  automatic: [
    { type: 'smart_message', label: 'Smart Message', description: 'Message auto-adapté', icon: Sparkles, color: 'text-purple-600 bg-purple-50', available: true },
    { type: 'inmail', label: 'InMail', description: 'Envoyer un InMail LinkedIn', icon: Mail, color: 'text-blue-600 bg-blue-50', available: true },
    { type: 'connection_request', label: 'Invitation', description: 'Envoyer sur LinkedIn', icon: UserPlus, color: 'text-emerald-600 bg-emerald-50', available: true },
    { type: 'message', label: 'Message direct', description: 'Envoyer sur LinkedIn', icon: MessageSquare, color: 'text-orange-600 bg-orange-50', available: true },
    { type: 'profile_visit', label: 'Visiter le profil', description: 'Visiter le profil', icon: Eye, color: 'text-sky-600 bg-sky-50', available: true },
  ],
};

const ACTION_CONFIG: Record<string, { label: string; icon: typeof Mail; bgColor: string; iconColor: string }> = {
  smart_message: { label: 'Smart Message', icon: Sparkles, bgColor: 'bg-purple-50', iconColor: 'text-purple-500' },
  connection_request: { label: 'Invitation', icon: UserPlus, bgColor: 'bg-emerald-50', iconColor: 'text-emerald-500' },
  profile_visit: { label: 'Visite profil', icon: Eye, bgColor: 'bg-sky-50', iconColor: 'text-sky-500' },
  inmail: { label: 'InMail', icon: Mail, bgColor: 'bg-blue-50', iconColor: 'text-blue-500' },
  message: { label: 'Message direct', icon: MessageSquare, bgColor: 'bg-orange-50', iconColor: 'text-orange-500' },
};

const CONDITION_OPTIONS = [
  { value: 'always', label: 'Toujours' },
  { value: 'if_connected', label: 'Si connecté' },
  { value: 'if_not_connected', label: 'Si non connecté' },
  { value: 'if_no_response', label: 'Si pas de réponse' },
  { value: 'wait_until_connected', label: 'Attendre connexion' },
  { value: 'wait_for_event', label: 'Attendre événement' },
];

const createEmptyStep = (order: number, actionType: string = 'smart_message'): SequenceStep => ({
  id: crypto.randomUUID(),
  order,
  actionType: actionType as any,
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
      steps: [],
      isActive: true,
    }
  );
  const [isSaving, setIsSaving] = useState(false);
  const [selectedStepId, setSelectedStepId] = useState<string | null>(null);
  const [showStepPicker, setShowStepPicker] = useState(!initialSequence && sequence.steps.length === 0);

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
    setShowStepPicker(false);
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

  // Step picker view
  if (showStepPicker) {
    return (
      <Dialog open={isOpen} onOpenChange={onClose}>
        <DialogContent className="max-w-2xl p-0 gap-0 bg-white overflow-hidden">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
            <div className="flex items-center gap-3">
              {sequence.steps.length > 0 && (
                <button 
                  onClick={() => setShowStepPicker(false)}
                  className="p-1 rounded hover:bg-gray-100 text-gray-400"
                >
                  <ArrowLeft className="w-5 h-5" />
                </button>
              )}
              <div>
                <h2 className="text-lg font-semibold text-gray-900">Construire ma séquence</h2>
                <p className="text-sm text-gray-500">Choisir les étapes</p>
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Tabs defaultValue="steps">
                <TabsList className="bg-gray-100">
                  <TabsTrigger value="steps" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
                    Étapes
                  </TabsTrigger>
                  <TabsTrigger value="conditions" className="data-[state=active]:bg-blue-600 data-[state=active]:text-white">
                    Conditions
                  </TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>

          {/* Content */}
          <div className="p-6">
            <div className="mb-6">
              <h3 className="text-sm font-medium text-gray-700 mb-3">Étapes automatiques</h3>
              <div className="space-y-2">
                {STEP_ACTIONS.automatic.map((action) => {
                  const Icon = action.icon;
                  return (
                    <button
                      key={action.type}
                      onClick={() => action.available && addStep(action.type)}
                      disabled={!action.available}
                      className={cn(
                        "w-full flex items-center gap-4 p-4 rounded-xl border-2 border-gray-100 hover:border-blue-200 hover:bg-blue-50/30 transition-all text-left",
                        !action.available && "opacity-50 cursor-not-allowed"
                      )}
                    >
                      <div className={cn("w-10 h-10 rounded-lg flex items-center justify-center", action.color)}>
                        <Icon className="w-5 h-5" />
                        <Linkedin className="w-3 h-3 absolute bottom-0 right-0 text-[#0077B5]" style={{display: 'none'}} />
                      </div>
                      <div className="flex-1">
                        <div className="font-medium text-gray-900">{action.label}</div>
                        <div className="text-sm text-gray-500">{action.description}</div>
                      </div>
                      {!action.available && (
                        <div className="flex items-center gap-1 text-sm text-gray-400">
                          <Lock className="w-4 h-4" />
                          Accès
                        </div>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-5xl max-h-[90vh] overflow-hidden flex flex-col p-0 gap-0 bg-[#f8fafc]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-200 bg-white">
          <div className="flex items-center gap-4 flex-1">
            <Input
              value={sequence.name}
              onChange={(e) => setSequence(prev => ({ ...prev, name: e.target.value }))}
              placeholder="Nom de la séquence..."
              className="max-w-md border-0 bg-transparent text-lg font-medium placeholder:text-gray-400 focus-visible:ring-0 px-0"
            />
          </div>
          <div className="flex items-center gap-3">
            <Button variant="outline" onClick={onClose} className="border-gray-200">
              Annuler
            </Button>
            <Button 
              onClick={handleSave} 
              disabled={isSaving || !sequence.name.trim() || sequence.steps.length === 0}
              className="bg-blue-600 hover:bg-blue-700"
            >
              {isSaving ? 'Enregistrement...' : (
                <>
                  <Save className="w-4 h-4 mr-2" />
                  Enregistrer
                </>
              )}
            </Button>
          </div>
        </div>

        {/* Main content - 2 columns */}
        <div className="flex-1 flex overflow-hidden">
          {/* Left: Visual workflow */}
          <div className="flex-1 overflow-auto">
            <div className="p-8 min-h-full">
              <div className="flex flex-col items-center">
                {sequence.steps.map((step, index) => {
                  const config = ACTION_CONFIG[step.actionType];
                  const Icon = config.icon;
                  const isSelected = selectedStepId === step.id;

                  return (
                    <div key={step.id} className="flex flex-col items-center">
                      {/* Connector line + Add button */}
                      {index > 0 && (
                        <div className="flex flex-col items-center">
                          <div className="w-px h-4 bg-gray-300" />
                          <button
                            onClick={() => setShowStepPicker(true)}
                            className="w-6 h-6 rounded-full border-2 border-gray-300 bg-white hover:border-blue-400 hover:bg-blue-50 flex items-center justify-center text-gray-400 hover:text-blue-500 transition-colors"
                          >
                            <Plus className="w-3 h-3" />
                          </button>
                          <div className="w-px h-4 bg-gray-300" />
                        </div>
                      )}

                      {/* Step card */}
                      <div
                        className={cn(
                          "relative w-[280px] bg-white rounded-xl border-2 transition-all cursor-pointer",
                          isSelected 
                            ? "border-blue-500 shadow-lg shadow-blue-500/10" 
                            : "border-gray-200 hover:border-gray-300 hover:shadow-md"
                        )}
                        onClick={() => setSelectedStepId(step.id)}
                      >
                        {/* Delay badge */}
                        {step.order > 0 && (
                          <div className="absolute -top-3 left-4 flex items-center gap-1.5 px-2.5 py-1 bg-white border border-gray-200 rounded-full text-xs">
                            <Clock className="w-3 h-3 text-gray-400" />
                            <span className="text-gray-500">Délai de</span>
                            <span className="text-blue-600 font-medium">
                              {step.delayDays} jour{step.delayDays > 1 ? 's' : ''}
                            </span>
                          </div>
                        )}

                        {/* Card content */}
                        <div className="p-4 pt-5">
                          <div className="flex items-start gap-3">
                            <div className={cn(
                              "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
                              config.bgColor
                            )}>
                              <Icon className={cn("w-4.5 h-4.5", config.iconColor)} />
                            </div>

                            <div className="flex-1 min-w-0">
                              <div className="font-medium text-gray-900 text-sm">
                                {config.label}
                              </div>
                              {step.useAiPersonalization && needsMessage(step.actionType) ? (
                                <div className="flex items-center gap-1 text-xs text-purple-600 mt-0.5">
                                  <Sparkles className="w-3 h-3" />
                                  Message IA
                                </div>
                              ) : step.conditionType !== 'always' ? (
                                <div className="text-xs text-gray-500 mt-0.5">
                                  {CONDITION_OPTIONS.find(c => c.value === step.conditionType)?.label}
                                </div>
                              ) : null}
                            </div>

                            <DropdownMenu>
                              <DropdownMenuTrigger asChild>
                                <button 
                                  onClick={(e) => e.stopPropagation()}
                                  className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600"
                                >
                                  <MoreHorizontal className="w-4 h-4" />
                                </button>
                              </DropdownMenuTrigger>
                              <DropdownMenuContent align="end" className="bg-white">
                                <DropdownMenuItem onClick={() => setSelectedStepId(step.id)}>
                                  <Pencil className="w-4 h-4 mr-2" />
                                  Modifier
                                </DropdownMenuItem>
                                <DropdownMenuItem 
                                  onClick={() => removeStep(step.id)}
                                  disabled={sequence.steps.length <= 1}
                                  className="text-red-600"
                                >
                                  <Trash2 className="w-4 h-4 mr-2" />
                                  Supprimer
                                </DropdownMenuItem>
                              </DropdownMenuContent>
                            </DropdownMenu>
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}

                {/* Add step at end */}
                <div className="flex flex-col items-center mt-2">
                  <div className="w-px h-6 bg-gray-300" />
                  <button
                    onClick={() => setShowStepPicker(true)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg border-2 border-dashed border-gray-300 text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 transition-colors text-sm font-medium"
                  >
                    <Plus className="w-4 h-4" />
                    Ajouter une étape
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Right: Editor panel */}
          {selectedStep && (
            <div className="w-[380px] border-l border-gray-200 bg-white flex flex-col">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className={cn(
                    "w-8 h-8 rounded-lg flex items-center justify-center",
                    ACTION_CONFIG[selectedStep.actionType].bgColor
                  )}>
                    {React.createElement(ACTION_CONFIG[selectedStep.actionType].icon, { 
                      className: cn("w-4 h-4", ACTION_CONFIG[selectedStep.actionType].iconColor)
                    })}
                  </div>
                  <span className="font-medium text-gray-900">
                    {ACTION_CONFIG[selectedStep.actionType].label}
                  </span>
                </div>
                <button 
                  onClick={() => setSelectedStepId(null)}
                  className="p-1 rounded hover:bg-gray-100 text-gray-400"
                >
                  <X className="w-4 h-4" />
                </button>
              </div>

              <ScrollArea className="flex-1">
                <div className="p-5 space-y-5">
                  {/* Action type */}
                  <div>
                    <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Type d'action</Label>
                    <Select
                      value={selectedStep.actionType}
                      onValueChange={(v) => updateStep(selectedStep.id, { actionType: v as any })}
                    >
                      <SelectTrigger className="mt-2 bg-white">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white">
                        {Object.entries(ACTION_CONFIG).map(([value, config]) => (
                          <SelectItem key={value} value={value}>
                            <div className="flex items-center gap-2">
                              <config.icon className={cn("w-4 h-4", config.iconColor)} />
                              {config.label}
                            </div>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Delay */}
                  {selectedStep.order > 0 && (
                    <div>
                      <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Délai</Label>
                      <div className="grid grid-cols-2 gap-3 mt-2">
                        <div>
                          <Label className="text-xs text-gray-500">Jours</Label>
                          <Input
                            type="number"
                            min={0}
                            value={selectedStep.delayDays}
                            onChange={(e) => updateStep(selectedStep.id, { delayDays: parseInt(e.target.value) || 0 })}
                            className="mt-1"
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
                            className="mt-1"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Condition */}
                  <div>
                    <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Condition</Label>
                    <Select
                      value={selectedStep.conditionType}
                      onValueChange={(v) => updateStep(selectedStep.id, { conditionType: v as any })}
                    >
                      <SelectTrigger className="mt-2">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="bg-white">
                        {CONDITION_OPTIONS.map((opt) => (
                          <SelectItem key={opt.value} value={opt.value}>
                            {opt.label}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>

                  {/* Wait event */}
                  {selectedStep.conditionType === 'wait_for_event' && (
                    <div>
                      <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Événement</Label>
                      <Select
                        value={selectedStep.waitForEvent || 'connection_accepted'}
                        onValueChange={(v) => updateStep(selectedStep.id, { waitForEvent: v as any })}
                      >
                        <SelectTrigger className="mt-2">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent className="bg-white">
                          <SelectItem value="connection_accepted">Connexion acceptée</SelectItem>
                          <SelectItem value="reply_received">Réponse reçue</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                  )}

                  {/* Timeout */}
                  {(selectedStep.conditionType === 'wait_until_connected' || selectedStep.conditionType === 'wait_for_event') && (
                    <div className="p-4 rounded-lg bg-amber-50 border border-amber-100">
                      <div className="flex items-center gap-2 mb-3">
                        <Timer className="w-4 h-4 text-amber-600" />
                        <span className="text-sm font-medium text-amber-800">Timeout</span>
                      </div>
                      <div className="grid grid-cols-2 gap-3">
                        <div>
                          <Label className="text-xs text-amber-700">Jours max</Label>
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
                          <Label className="text-xs text-amber-700">Aller à</Label>
                          <Select
                            value={selectedStep.timeoutBranchStepId || 'none'}
                            onValueChange={(v) => updateStep(selectedStep.id, { 
                              timeoutBranchStepId: v === 'none' ? undefined : v 
                            })}
                          >
                            <SelectTrigger className="mt-1 bg-white border-amber-200">
                              <SelectValue placeholder="Suivante" />
                            </SelectTrigger>
                            <SelectContent className="bg-white">
                              <SelectItem value="none">Étape suivante</SelectItem>
                              {sequence.steps
                                .filter(s => s.id !== selectedStep.id && s.order > selectedStep.order)
                                .map((s) => (
                                  <SelectItem key={s.id} value={s.id}>
                                    Étape {s.order + 1}
                                  </SelectItem>
                                ))}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Message content */}
                  {needsMessage(selectedStep.actionType) && (
                    <div>
                      <div className="flex items-center justify-between mb-2">
                        <Label className="text-xs font-medium text-gray-500 uppercase tracking-wide">Contenu</Label>
                        <div className="flex items-center gap-2">
                          <Switch
                            checked={selectedStep.useAiPersonalization}
                            onCheckedChange={(v) => updateStep(selectedStep.id, { useAiPersonalization: v })}
                            id="ai-toggle"
                            className="data-[state=checked]:bg-purple-600"
                          />
                          <Label htmlFor="ai-toggle" className="text-xs cursor-pointer text-gray-500">
                            IA
                          </Label>
                        </div>
                      </div>

                      {selectedStep.useAiPersonalization ? (
                        <div className="p-4 rounded-lg bg-purple-50 border border-purple-100">
                          <div className="flex items-center gap-2 mb-2">
                            <Sparkles className="w-4 h-4 text-purple-600" />
                            <span className="text-sm font-medium text-purple-900">IA activée</span>
                          </div>
                          <p className="text-xs text-purple-700 mb-3">
                            Message personnalisé selon le profil
                          </p>
                          <Select
                            value={selectedStep.aiTone || 'professional'}
                            onValueChange={(v) => updateStep(selectedStep.id, { aiTone: v as any })}
                          >
                            <SelectTrigger className="bg-white border-purple-200 text-sm">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent className="bg-white">
                              <SelectItem value="professional">Professionnel</SelectItem>
                              <SelectItem value="casual">Décontracté</SelectItem>
                              <SelectItem value="enthusiastic">Enthousiaste</SelectItem>
                            </SelectContent>
                          </Select>
                        </div>
                      ) : (
                        <div className="space-y-3">
                          {selectedStep.actionType === 'inmail' && (
                            <Input
                              value={selectedStep.subjectTemplate || ''}
                              onChange={(e) => updateStep(selectedStep.id, { subjectTemplate: e.target.value })}
                              placeholder="Objet..."
                            />
                          )}
                          <Textarea
                            value={selectedStep.messageTemplate || ''}
                            onChange={(e) => updateStep(selectedStep.id, { messageTemplate: e.target.value })}
                            placeholder="Votre message..."
                            className="min-h-[100px] resize-none"
                          />
                          <p className="text-xs text-gray-400">
                            Variables: {'{prenom}'}, {'{entreprise}'}, {'{poste}'}
                          </p>
                        </div>
                      )}
                    </div>
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

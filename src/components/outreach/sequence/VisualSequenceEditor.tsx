import React, { useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { 
  Plus, 
  X,
  Mail,
  UserPlus,
  Eye,
  MessageSquare,
  Sparkles,
  Timer,
  GitBranch,
  Zap,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SequenceStep } from '../SequenceBuilder';
import { InteractiveFlowDiagram } from './InteractiveFlowDiagram';
import { StepEditor } from './StepEditor';

interface VisualSequenceEditorProps {
  steps: SequenceStep[];
  onStepsChange: (steps: SequenceStep[]) => void;
}

// ACTIONS = ce qu'on FAIT
const ACTIONS = [
  { value: 'connection_request', label: 'Invitation LinkedIn', icon: UserPlus, color: 'bg-emerald-100 text-emerald-600', description: 'Envoyer une demande de connexion' },
  { value: 'inmail', label: 'InMail', icon: Mail, color: 'bg-blue-100 text-blue-600', description: 'Envoyer un InMail (payant)' },
  { value: 'profile_visit', label: 'Visite de profil', icon: Eye, color: 'bg-sky-100 text-sky-600', description: 'Visiter le profil du prospect' },
  { value: 'message', label: 'Message direct', icon: MessageSquare, color: 'bg-orange-100 text-orange-600', description: 'Envoyer un message (si connecté)' },
  { value: 'smart_message', label: 'Smart Message (IA)', icon: Sparkles, color: 'bg-purple-100 text-purple-600', description: 'Message personnalisé par IA' },
];

// TRIGGERS = ce qu'on ATTEND
const TRIGGERS = [
  { value: 'check_connection', label: 'Vérifier connexion', icon: GitBranch, color: 'bg-indigo-100 text-indigo-600', description: 'Route selon le degré' },
  { value: 'wait_connection', label: 'Attendre connexion', icon: Timer, color: 'bg-amber-100 text-amber-600', description: 'Pause jusqu\'à acceptation' },
  { value: 'wait_reply', label: 'Attendre réponse', icon: MessageSquare, color: 'bg-amber-100 text-amber-600', description: 'Pause jusqu\'à réponse' },
  { value: 'wait_profile_visit', label: 'Attendre visite retour', icon: Eye, color: 'bg-amber-100 text-amber-600', description: 'Pause si visite profil' },
  { value: 'condition_branch', label: 'Branchement', icon: GitBranch, color: 'bg-rose-100 text-rose-600', description: 'Si/Sinon conditionnel' },
];

const ALL_STEP_TYPES = [...ACTIONS, ...TRIGGERS];

const createEmptyStep = (order: number, actionType: string): SequenceStep => ({
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
  timeoutDays: 7,
  timeoutAction: 'skip',
});

export const VisualSequenceEditor: React.FC<VisualSequenceEditorProps> = ({
  steps,
  onStepsChange,
}) => {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(steps[0]?.id || null);
  const [showStepPicker, setShowStepPicker] = useState(false);

  const selectedStep = steps.find(s => s.id === selectedStepId);
  const selectedStepIndex = steps.findIndex(s => s.id === selectedStepId);

  const handleAddStep = (actionType: string) => {
    const newStep = createEmptyStep(steps.length, actionType);
    onStepsChange([...steps, newStep]);
    setSelectedStepId(newStep.id);
    setShowStepPicker(false);
  };

  const handleRemoveStep = (stepId: string) => {
    if (steps.length <= 1) return;
    const newSteps = steps
      .filter(s => s.id !== stepId)
      .map((s, idx) => ({ ...s, order: idx }));
    onStepsChange(newSteps);
    if (selectedStepId === stepId) {
      setSelectedStepId(newSteps[0]?.id || null);
    }
  };

  const handleUpdateStep = (updates: Partial<SequenceStep>) => {
    if (!selectedStepId) return;
    onStepsChange(
      steps.map(s => s.id === selectedStepId ? { ...s, ...updates } : s)
    );
  };

  return (
    <div className="flex h-[450px] border rounded-lg overflow-hidden bg-white">
      {/* Left: Visual Flow */}
      <div className="flex-1 border-r bg-gray-50/50">
        <div className="p-2 border-b bg-white">
          <span className="text-xs font-semibold text-muted-foreground uppercase">
            Workflow visuel
          </span>
        </div>
        <ScrollArea className="h-[calc(100%-36px)]">
          <InteractiveFlowDiagram
            steps={steps}
            onStepClick={(stepId) => {
              setSelectedStepId(stepId);
              setShowStepPicker(false);
            }}
            onAddStep={() => setShowStepPicker(true)}
            onRemoveStep={handleRemoveStep}
            selectedStepId={selectedStepId}
          />
        </ScrollArea>
      </div>

      {/* Right: Step Editor / Step Picker */}
      <div className="w-[280px] flex flex-col">
        <div className="p-2 border-b bg-white flex items-center justify-between">
          <span className="text-xs font-semibold text-muted-foreground uppercase">
            {showStepPicker ? 'Nouvelle étape' : 'Configuration'}
          </span>
          {showStepPicker && (
            <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => setShowStepPicker(false)}>
              <X className="w-4 h-4" />
            </Button>
          )}
        </div>
        
        <ScrollArea className="flex-1 p-3">
          {showStepPicker ? (
            <div className="space-y-4">
              {/* Actions */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Zap className="w-4 h-4 text-emerald-600" />
                  <span className="text-xs font-semibold uppercase text-muted-foreground">Actions</span>
                </div>
                <div className="space-y-2">
                  {ACTIONS.map(action => (
                    <button
                      key={action.value}
                      onClick={() => handleAddStep(action.value)}
                      className="flex items-center gap-3 w-full p-2 rounded-lg border border-border hover:border-primary hover:bg-primary/5 transition-colors text-left"
                    >
                      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", action.color)}>
                        <action.icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{action.label}</div>
                        <div className="text-xs text-muted-foreground truncate">{action.description}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>

              {/* Triggers */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <Timer className="w-4 h-4 text-amber-600" />
                  <span className="text-xs font-semibold uppercase text-muted-foreground">Triggers</span>
                </div>
                <div className="space-y-2">
                  {TRIGGERS.map(trigger => (
                    <button
                      key={trigger.value}
                      onClick={() => handleAddStep(trigger.value)}
                      className="flex items-center gap-3 w-full p-2 rounded-lg border border-border hover:border-amber-400 hover:bg-amber-50 transition-colors text-left"
                    >
                      <div className={cn("w-8 h-8 rounded-lg flex items-center justify-center", trigger.color)}>
                        <trigger.icon className="w-4 h-4" />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="font-medium text-sm">{trigger.label}</div>
                        <div className="text-xs text-muted-foreground truncate">{trigger.description}</div>
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            </div>
          ) : selectedStep ? (
            <StepEditor
              step={selectedStep}
              stepIndex={selectedStepIndex}
              allSteps={steps}
              onUpdate={handleUpdateStep}
              allStepTypes={ALL_STEP_TYPES}
            />
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-center text-muted-foreground">
              <p className="text-sm">Sélectionnez une étape pour la configurer</p>
            </div>
          )}
        </ScrollArea>
      </div>
    </div>
  );
};

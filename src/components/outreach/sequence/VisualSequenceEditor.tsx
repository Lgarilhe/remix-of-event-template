import React, { useCallback, useState } from 'react';
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
  ChevronRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SequenceStep } from '../SequenceBuilder';
import { WorkflowCanvas } from './WorkflowCanvas';
import { StepEditor } from './StepEditor';
import whatsappLogo from '@/assets/whatsapp-logo.svg';
import { AnimatePresence, motion } from 'framer-motion';

interface VisualSequenceEditorProps {
  steps: SequenceStep[];
  onStepsChange: (steps: SequenceStep[]) => void;
}

interface PendingBranch {
  parentStepId: string;
  branch: 'true' | 'false';
  afterStepId?: string;
}

const ACTIONS = [
  { value: 'connection_request', label: 'Invitation LinkedIn', icon: UserPlus, color: 'bg-emerald-50 text-emerald-600', description: 'Demande de connexion' },
  { value: 'inmail', label: 'InMail', icon: Mail, color: 'bg-blue-50 text-blue-600', description: 'InMail payant' },
  { value: 'email', label: 'Email', icon: Mail, color: 'bg-violet-50 text-violet-600', description: 'Envoyer un email' },
  { value: 'profile_visit', label: 'Visite de profil', icon: Eye, color: 'bg-sky-50 text-sky-600', description: 'Visiter le profil' },
  { value: 'message', label: 'Message direct', icon: MessageSquare, color: 'bg-orange-50 text-orange-600', description: 'Si connecté' },
  { value: 'smart_message', label: 'Smart Message', icon: Sparkles, color: 'bg-purple-50 text-purple-600', description: 'Personnalisé par IA' },
  { value: 'whatsapp_message', label: 'WhatsApp', icon: null, customIcon: whatsappLogo, color: 'bg-green-50 text-green-600', description: 'Si numéro dispo' },
];

const TRIGGERS = [
  { value: 'check_connection', label: 'Vérifier connexion', icon: GitBranch, color: 'bg-indigo-50 text-indigo-600', description: 'Route par degré' },
  { value: 'wait_connection', label: 'Attendre connexion', icon: Timer, color: 'bg-amber-50 text-amber-600', description: 'Pause acceptation' },
  { value: 'wait_reply', label: 'Attendre réponse', icon: MessageSquare, color: 'bg-amber-50 text-amber-600', description: 'Pause réponse' },
  { value: 'wait_profile_visit', label: 'Attendre visite', icon: Eye, color: 'bg-amber-50 text-amber-600', description: 'Pause visite' },
  { value: 'condition_branch', label: 'Branchement', icon: GitBranch, color: 'bg-rose-50 text-rose-600', description: 'Si/Sinon' },
];

const ALL_STEP_TYPES = [...ACTIONS, ...TRIGGERS];

const createEmptyStep = (order: number, actionType: string): SequenceStep => ({
  id: crypto.randomUUID(),
  order,
  actionType: actionType as SequenceStep['actionType'],
  conditionType: 'always',
  delayDays: 0,
  delayHours: 0,
  delayMinutes: 0,
  preferredHourStart: 9,
  preferredHourEnd: 18,
  useAiPersonalization: false,
  aiTone: 'professional',
  timeoutDays: 3,
  timeoutAction: 'skip',
});

export const VisualSequenceEditor: React.FC<VisualSequenceEditorProps> = ({
  steps,
  onStepsChange,
}) => {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(steps[0]?.id || null);
  const [showStepPicker, setShowStepPicker] = useState(false);
  const [pendingBranch, setPendingBranch] = useState<PendingBranch | null>(null);

  const selectedStep = steps.find(s => s.id === selectedStepId);
  const selectedStepIndex = steps.findIndex(s => s.id === selectedStepId);

  const handleAddStep = useCallback((actionType: string) => {
    const newStep = createEmptyStep(steps.length, actionType);
    
    if (pendingBranch) {
      const { parentStepId, branch, afterStepId } = pendingBranch;
      if (afterStepId) {
        const updatedSteps = [...steps, newStep].map(s =>
          s.id === afterStepId ? { ...s, nextStepId: newStep.id } : s
        );
        onStepsChange(updatedSteps);
      } else {
        const updatedSteps = [...steps, newStep].map(s => {
          if (s.id === parentStepId) {
            return branch === 'true'
              ? { ...s, ifTrueGotoStep: newStep.id }
              : { ...s, ifFalseGotoStep: newStep.id };
          }
          return s;
        });
        onStepsChange(updatedSteps);
      }
      setPendingBranch(null);
    } else {
      const lastMainStep = steps.filter(s => {
        const isInBranch = steps.some(parent => 
          parent.actionType === 'check_connection' && 
          (parent.ifTrueGotoStep === s.id || parent.ifFalseGotoStep === s.id)
        );
        return !isInBranch && !s.nextStepId;
      }).pop();
      
      if (lastMainStep && lastMainStep.actionType !== 'check_connection') {
        const updatedSteps = [...steps, newStep].map(s =>
          s.id === lastMainStep.id ? { ...s, nextStepId: newStep.id } : s
        );
        onStepsChange(updatedSteps);
      } else {
        onStepsChange([...steps, newStep]);
      }
    }
    
    setSelectedStepId(newStep.id);
    setShowStepPicker(false);
  }, [onStepsChange, pendingBranch, steps]);

  const handleOpenStepPicker = useCallback((branchTarget?: PendingBranch) => {
    setPendingBranch(branchTarget || null);
    setShowStepPicker(true);
  }, []);

  const handleSelectStep = useCallback((stepId: string) => {
    setSelectedStepId(stepId);
    setShowStepPicker(false);
    setPendingBranch(null);
  }, []);

  const handleRemoveStep = useCallback((stepId: string) => {
    if (steps.length <= 1) return;
    const newSteps = steps
      .filter(s => s.id !== stepId)
      .map((s, idx) => ({
        ...s,
        order: idx,
        ...(s.ifTrueGotoStep === stepId ? { ifTrueGotoStep: undefined } : {}),
        ...(s.ifFalseGotoStep === stepId ? { ifFalseGotoStep: undefined } : {}),
        ...(s.nextStepId === stepId ? { nextStepId: undefined } : {}),
        ...(s.timeoutBranchStepId === stepId ? { timeoutBranchStepId: undefined } : {}),
      }));
    onStepsChange(newSteps);
    if (selectedStepId === stepId) setSelectedStepId(newSteps[0]?.id || null);
  }, [onStepsChange, selectedStepId, steps]);

  const handleUpdateStep = useCallback((updates: Partial<SequenceStep>) => {
    if (!selectedStepId) return;
    onStepsChange(steps.map(s => s.id === selectedStepId ? { ...s, ...updates } : s));
  }, [onStepsChange, selectedStepId, steps]);

  const handleCancelStepPicker = useCallback(() => {
    setShowStepPicker(false);
    setPendingBranch(null);
  }, []);

  const getFilteredActions = () => {
    if (pendingBranch?.branch === 'true') {
      return ACTIONS.filter(a => ['message', 'smart_message', 'email', 'profile_visit', 'whatsapp_message'].includes(a.value));
    }
    if (pendingBranch?.branch === 'false') {
      return ACTIONS.filter(a => ['connection_request', 'inmail', 'email', 'profile_visit', 'whatsapp_message'].includes(a.value));
    }
    return ACTIONS;
  };

  const getFilteredTriggers = () => {
    if (pendingBranch) return TRIGGERS.filter(t => ['wait_connection', 'wait_reply'].includes(t.value));
    return TRIGGERS;
  };

  const filteredActions = getFilteredActions();
  const filteredTriggers = getFilteredTriggers();

  return (
    <div className="flex flex-col sm:flex-row h-[400px] sm:h-[560px] border border-border rounded-lg overflow-hidden bg-background">
      {/* Left: Visual Flow Canvas */}
      <div className="flex-1 border-b sm:border-b-0 sm:border-r border-border/60 bg-muted/5 flex flex-col min-w-0 min-h-[200px] sm:min-h-0">
        <div className="px-3 sm:px-4 py-2 sm:py-2.5 border-b border-border/40 flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground">
            Workflow
          </span>
          <span className="text-[10px] text-muted-foreground/60">
            {steps.length} étape{steps.length !== 1 ? 's' : ''}
          </span>
        </div>
        <div className="flex-1 min-h-0">
          <WorkflowCanvas
            steps={steps}
            onStepClick={handleSelectStep}
            onAddStep={handleOpenStepPicker}
            onRemoveStep={handleRemoveStep}
            selectedStepId={selectedStepId}
          />
        </div>
      </div>

      {/* Right: Step Editor / Step Picker */}
      <div className="w-full sm:w-[300px] flex flex-col bg-background min-h-0 flex-shrink-0 max-h-[200px] sm:max-h-none">
        <div className="px-3 sm:px-4 py-2 sm:py-2.5 border-b border-border/40 flex items-center justify-between">
          <span className="text-[11px] font-medium text-muted-foreground">
            {showStepPicker 
              ? pendingBranch 
                ? `Ajouter ${pendingBranch.branch === 'true' ? '(1er degré)' : '(2e/3e degré)'}`
                : 'Ajouter une étape' 
              : 'Configuration'}
          </span>
          {showStepPicker && (
            <Button variant="ghost" size="sm" className="h-5 w-5 p-0" onClick={handleCancelStepPicker}>
              <X className="w-3.5 h-3.5" />
            </Button>
          )}
        </div>
        
        <ScrollArea className="flex-1">
          <div className="p-4">
            <AnimatePresence mode="wait">
              {showStepPicker ? (
                <motion.div
                  key="picker"
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.15 }}
                  className="space-y-5"
                >
                  {/* Branch context */}
                  {pendingBranch && (
                    <div className={cn(
                      "px-3 py-2 rounded-md text-xs font-medium flex items-center gap-2",
                      pendingBranch.branch === 'true' 
                        ? "bg-emerald-50 text-emerald-700 border border-emerald-200/60" 
                        : "bg-orange-50 text-orange-700 border border-orange-200/60"
                    )}>
                      <GitBranch className="w-3.5 h-3.5" />
                      {pendingBranch.branch === 'true' ? "Connecté (1er degré)" : "Non connecté (2e/3e)"}
                    </div>
                  )}
                  
                  {/* Actions */}
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Zap className="w-3 h-3 text-muted-foreground" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Actions</span>
                    </div>
                    <div className="space-y-1">
                      {filteredActions.map(action => (
                        <button
                          key={action.value}
                          onClick={() => handleAddStep(action.value)}
                          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-md hover:bg-muted/60 transition-colors text-left group"
                        >
                          <div className={cn("w-7 h-7 rounded-md flex items-center justify-center shrink-0", action.color)}>
                            {(action as any).customIcon ? (
                              <img src={(action as any).customIcon} alt={action.label} className="w-3.5 h-3.5" />
                            ) : action.icon ? (
                              <action.icon className="w-3.5 h-3.5" />
                            ) : null}
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium leading-tight">{action.label}</div>
                            <div className="text-[10px] text-muted-foreground/60 leading-tight">{action.description}</div>
                          </div>
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Triggers */}
                  <div>
                    <div className="flex items-center gap-1.5 mb-2">
                      <Timer className="w-3 h-3 text-muted-foreground" />
                      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Triggers</span>
                    </div>
                    <div className="space-y-1">
                      {filteredTriggers.map(trigger => (
                        <button
                          key={trigger.value}
                          onClick={() => handleAddStep(trigger.value)}
                          className="flex items-center gap-3 w-full px-3 py-2.5 rounded-md hover:bg-muted/60 transition-colors text-left group"
                        >
                          <div className={cn("w-7 h-7 rounded-md flex items-center justify-center shrink-0", trigger.color)}>
                            <trigger.icon className="w-3.5 h-3.5" />
                          </div>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium leading-tight">{trigger.label}</div>
                            <div className="text-[10px] text-muted-foreground/60 leading-tight">{trigger.description}</div>
                          </div>
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground/30 group-hover:text-muted-foreground/60 transition-colors" />
                        </button>
                      ))}
                    </div>
                  </div>
                </motion.div>
              ) : selectedStep ? (
                <motion.div
                  key={`editor-${selectedStepId}`}
                  initial={{ opacity: 0, x: 10 }}
                  animate={{ opacity: 1, x: 0 }}
                  exit={{ opacity: 0, x: -10 }}
                  transition={{ duration: 0.15 }}
                >
                  <StepEditor
                    step={selectedStep}
                    stepIndex={selectedStepIndex}
                    allSteps={steps}
                    onUpdate={handleUpdateStep}
                    allStepTypes={ALL_STEP_TYPES}
                  />
                </motion.div>
              ) : (
                <motion.div
                  key="empty"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex flex-col items-center justify-center py-12 text-center"
                >
                  <div className="w-10 h-10 rounded-full bg-muted/50 flex items-center justify-center mb-3">
                    <ChevronRight className="w-4 h-4 text-muted-foreground/40" />
                  </div>
                  <p className="text-xs text-muted-foreground/60">Sélectionnez une étape</p>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </ScrollArea>
      </div>
    </div>
  );
};

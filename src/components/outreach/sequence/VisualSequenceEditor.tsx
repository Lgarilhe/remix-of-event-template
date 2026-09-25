import React, { useCallback, useEffect, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
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
import { isStepTypeOffered, nextStepOrder, removeStepFromSequence, waitEventFor, STEP_TYPE_LABELS } from './sequenceGraph';
import whatsappLogo from '@/assets/whatsapp-logo.svg';
import { AnimatePresence, motion } from 'framer-motion';

interface VisualSequenceEditorProps {
  steps: SequenceStep[];
  onStepsChange: (steps: SequenceStep[]) => void;
  /** Suppression confiée au parent (contrôle de l'historique d'envoi). */
  onRemoveStep?: (stepId: string) => void;
}

interface PendingBranch {
  parentStepId: string;
  branch: 'true' | 'false';
  afterStepId?: string;
}

const ACTIONS = [
  { value: 'connection_request', label: STEP_TYPE_LABELS.connection_request, icon: UserPlus, color: 'bg-success/10 text-success', description: 'Demande de connexion' },
  { value: 'inmail', label: STEP_TYPE_LABELS.inmail, icon: Mail, color: 'bg-info/10 text-info', description: 'InMail payant' },
  { value: 'email', label: STEP_TYPE_LABELS.email, icon: Mail, color: 'bg-brand-purple/10 text-brand-purple', description: 'Envoyer un e-mail' },
  { value: 'profile_visit', label: STEP_TYPE_LABELS.profile_visit, icon: Eye, color: 'bg-info/10 text-info', description: 'Visiter le profil' },
  { value: 'message', label: STEP_TYPE_LABELS.message, icon: MessageSquare, color: 'bg-warning/10 text-warning', description: 'Message direct, si connecté' },
  { value: 'smart_message', label: STEP_TYPE_LABELS.smart_message, icon: Sparkles, color: 'bg-brand-purple/10 text-brand-purple', description: 'Message IA, InMail si non connecté' },
  { value: 'whatsapp_message', label: STEP_TYPE_LABELS.whatsapp_message, icon: null, customIcon: whatsappLogo, color: 'bg-whatsapp/10 text-whatsapp', description: 'Si numéro disponible' },
];

// « Attendre visite » et « Branchement » restent listés pour afficher les
// séquences existantes, mais ne sont plus proposés (isStepTypeOffered) : le
// moteur ne détecte pas les visites et ne route pas un Branchement.
const TRIGGERS = [
  { value: 'check_connection', label: STEP_TYPE_LABELS.check_connection, icon: GitBranch, color: 'bg-info/10 text-info', description: 'Deux branches selon la relation' },
  { value: 'wait_connection', label: STEP_TYPE_LABELS.wait_connection, icon: Timer, color: 'bg-warning/10 text-warning', description: "Jusqu'à l'acceptation de l'invitation" },
  { value: 'wait_reply', label: STEP_TYPE_LABELS.wait_reply, icon: MessageSquare, color: 'bg-warning/10 text-warning', description: "Jusqu'à une réponse" },
  { value: 'wait_profile_visit', label: STEP_TYPE_LABELS.wait_profile_visit, icon: Eye, color: 'bg-warning/10 text-warning', description: 'Visite du profil en retour' },
  { value: 'condition_branch', label: STEP_TYPE_LABELS.condition_branch, icon: GitBranch, color: 'bg-destructive/10 text-destructive', description: 'Si/Sinon' },
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
  // Sans événement, le moteur franchissait l'attente aussitôt : « Attendre
  // réponse » clôturait en « a répondu », « Attendre connexion » déclarait le
  // candidat connecté.
  waitForEvent: waitEventFor(actionType),
});

const SMALL_SCREEN_QUERY = '(max-width: 639px)';

/** Moins de 640 px : les réglages d'une étape s'ouvrent en plein écran. */
function useIsSmallScreen(): boolean {
  const [small, setSmall] = useState(() => typeof window !== 'undefined' && window.matchMedia(SMALL_SCREEN_QUERY).matches);
  useEffect(() => {
    const mql = window.matchMedia(SMALL_SCREEN_QUERY);
    const onChange = () => setSmall(mql.matches);
    onChange();
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);
  return small;
}

export const VisualSequenceEditor: React.FC<VisualSequenceEditorProps> = ({
  steps,
  onStepsChange,
  onRemoveStep,
}) => {
  const [selectedStepId, setSelectedStepId] = useState<string | null>(steps[0]?.id || null);
  const [showStepPicker, setShowStepPicker] = useState(false);
  const [pendingBranch, setPendingBranch] = useState<PendingBranch | null>(null);
  const isSmallScreen = useIsSmallScreen();
  // Sur téléphone, le panneau de réglage s'ouvre à la demande (choix d'une étape ou « + »).
  const [mobilePanelOpen, setMobilePanelOpen] = useState(false);

  const selectedStep = steps.find(s => s.id === selectedStepId);
  const selectedStepIndex = steps.findIndex(s => s.id === selectedStepId);

  const handleAddStep = useCallback((actionType: string) => {
    // Plus grand ordre + 1 : le nombre de lignes compte aussi les variantes A/B.
    const newStep = createEmptyStep(nextStepOrder(steps), actionType);
    
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
    setMobilePanelOpen(true);
  }, []);

  const handleSelectStep = useCallback((stepId: string) => {
    setSelectedStepId(stepId);
    setShowStepPicker(false);
    setPendingBranch(null);
    setMobilePanelOpen(true);
  }, []);

  // Suppression : variantes emportées avec leur étape principale, renvois
  // reportés sur l'étape qui suivait (A → B → C devient A → C), ordres
  // renumérotés par groupe. Voir removeStepFromSequence.
  const handleRemoveStep = useCallback((stepId: string) => {
    if (selectedStepId === stepId) setSelectedStepId(null);
    if (onRemoveStep) {
      onRemoveStep(stepId);
      return;
    }
    onStepsChange(removeStepFromSequence(steps, stepId));
  }, [onRemoveStep, onStepsChange, selectedStepId, steps]);

  const handleUpdateStep = useCallback((updates: Partial<SequenceStep>) => {
    if (!selectedStepId) return;
    onStepsChange(steps.map(s => s.id === selectedStepId ? { ...s, ...updates } : s));
  }, [onStepsChange, selectedStepId, steps]);

  const handleCancelStepPicker = useCallback(() => {
    setShowStepPicker(false);
    setPendingBranch(null);
  }, []);

  const handleMobilePanelChange = useCallback((open: boolean) => {
    setMobilePanelOpen(open);
    if (!open) {
      setShowStepPicker(false);
      setPendingBranch(null);
    }
  }, []);

  const getFilteredActions = () => {
    const offered = ACTIONS.filter(a => isStepTypeOffered(a.value));
    if (pendingBranch?.branch === 'true') {
      return offered.filter(a => ['message', 'smart_message', 'email', 'profile_visit', 'whatsapp_message'].includes(a.value));
    }
    if (pendingBranch?.branch === 'false') {
      return offered.filter(a => ['connection_request', 'inmail', 'email', 'profile_visit', 'whatsapp_message'].includes(a.value));
    }
    return offered;
  };

  const getFilteredTriggers = () => {
    const offered = TRIGGERS.filter(t => isStepTypeOffered(t.value));
    if (pendingBranch) return offered.filter(t => ['wait_connection', 'wait_reply'].includes(t.value));
    return offered;
  };

  const filteredActions = getFilteredActions();
  const filteredTriggers = getFilteredTriggers();

  const panelTitle = showStepPicker
    ? pendingBranch
      ? `Ajouter une étape (${pendingBranch.branch === 'true' ? 'connecté' : 'non connecté'})`
      : 'Ajouter une étape'
    : "Réglages de l'étape";

  const panelContent = (
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
                  ? "bg-success/10 text-success border border-success/30"
                  : "bg-warning/10 text-warning border border-warning/30"
              )}>
                <GitBranch className="w-3.5 h-3.5" />
                {pendingBranch.branch === 'true' ? "Si connecté (1er degré)" : "Si non connecté (2e ou 3e degré)"}
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
                <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/60">Attentes et conditions</span>
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
  );

  return (
    <>
      <div className="flex flex-col sm:flex-row h-[420px] sm:h-[560px] border border-border rounded-lg overflow-hidden bg-background">
        {/* Left: Visual Flow Canvas */}
        <div className="flex-1 sm:border-r border-border/60 bg-muted/5 flex flex-col min-w-0 min-h-0">
          <div className="px-3 sm:px-4 py-2 sm:py-2.5 border-b border-border/40 flex items-center justify-between">
            <span className="text-[11px] font-medium text-muted-foreground">
              Parcours
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

        {/* Right: Step Editor / Step Picker (au-delà de 640 px) */}
        {!isSmallScreen && (
          <div className="w-[300px] flex flex-col bg-background min-h-0 flex-shrink-0">
            <div className="px-4 py-2.5 border-b border-border/40 flex items-center justify-between">
              <span className="text-[11px] font-medium text-muted-foreground">{panelTitle}</span>
              {showStepPicker && (
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={handleCancelStepPicker} aria-label="Fermer le choix d'étape">
                  <X className="w-3.5 h-3.5" aria-hidden="true" />
                </Button>
              )}
            </div>
            <ScrollArea className="flex-1">
              {panelContent}
            </ScrollArea>
          </div>
        )}
      </div>

      {/* Sous 640 px : réglages en plein écran, pour rédiger le message à l'aise. */}
      {isSmallScreen && (
        <Sheet open={mobilePanelOpen} onOpenChange={handleMobilePanelChange}>
          <SheetContent side="bottom" className="h-[92vh] p-0 gap-0 flex flex-col">
            <SheetHeader className="px-4 py-3 pr-12 border-b border-border/40 text-left">
              <SheetTitle className="text-sm">{panelTitle}</SheetTitle>
            </SheetHeader>
            <div className="flex-1 overflow-y-auto">
              {panelContent}
            </div>
          </SheetContent>
        </Sheet>
      )}
    </>
  );
};

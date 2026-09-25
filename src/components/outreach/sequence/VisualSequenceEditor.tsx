import React, { useCallback, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { X, GitBranch, ChevronRight } from 'lucide-react';
import { sequenceActionLabel } from '@/lib/sequenceCatalog';
import { SequenceActionIcon } from '@/components/outreach/SequenceBadges';
import { SequenceStep } from '../SequenceBuilder';
import { WorkflowCanvas } from './WorkflowCanvas';
import { StepEditor } from './StepEditor';

interface VisualSequenceEditorProps {
  steps: SequenceStep[];
  onStepsChange: (steps: SequenceStep[]) => void;
}

interface PendingBranch {
  parentStepId: string;
  branch: 'true' | 'false';
  afterStepId?: string;
}

// Libellés et icônes : catalogue des séquences (src/lib/sequenceCatalog.ts).
const ACTIONS = [
  { value: 'connection_request', description: 'Demande de connexion' },
  { value: 'inmail', description: 'Message payant, sans connexion' },
  { value: 'email', description: 'Envoyer un e-mail' },
  { value: 'profile_visit', description: 'Visiter le profil' },
  { value: 'message', description: 'Si connecté' },
  { value: 'smart_message', description: "Rédigé par l'IA pour chaque candidat" },
  { value: 'whatsapp_message', description: 'Si le numéro est connu' },
];

const TRIGGERS = [
  { value: 'check_connection', description: 'Oriente selon le degré' },
  { value: 'wait_connection', description: "Jusqu'à l'acceptation" },
  { value: 'wait_reply', description: "Jusqu'à la réponse" },
  { value: 'wait_profile_visit', description: "Jusqu'à une visite en retour" },
  { value: 'condition_branch', description: 'Si, sinon' },
];

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

const BRANCH_LABELS = { true: 'Connecté (1er degré)', false: 'Non connecté (2e ou 3e degré)' } as const;

function PickerOption({ value, description, onPick }: { value: string; description: string; onPick: (value: string) => void }) {
  return (
    <Button
      type="button"
      variant="ghost"
      onClick={() => onPick(value)}
      className="group h-auto w-full justify-start gap-3 whitespace-normal px-3 py-2.5 text-left"
    >
      <span className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-muted text-foreground-secondary">
        <SequenceActionIcon type={value} />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium leading-tight text-foreground">{sequenceActionLabel(value)}</span>
        <span className="block text-2xs leading-tight text-muted-foreground">{description}</span>
      </span>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
    </Button>
  );
}

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

  const panelTitle = showStepPicker
    ? pendingBranch
      ? `Ajouter une étape : ${pendingBranch.branch === 'true' ? 'branche Connecté' : 'branche Non connecté'}`
      : 'Ajouter une étape'
    : "Réglages de l'étape";

  return (
    <div className="flex h-[400px] flex-col overflow-hidden rounded-xl border border-border bg-background sm:h-[560px] sm:flex-row">
      {/* Déroulé */}
      <div className="flex min-h-[200px] min-w-0 flex-1 flex-col border-b border-border bg-muted/20 sm:min-h-0 sm:border-b-0 sm:border-r">
        <div className="flex items-center justify-between border-b border-border px-3 py-2 sm:px-4 sm:py-2.5">
          <span className="text-xs font-medium text-muted-foreground">Déroulé</span>
          <span className="text-2xs text-muted-foreground">
            {steps.length} étape{steps.length > 1 ? 's' : ''}
          </span>
        </div>
        <div className="min-h-0 flex-1">
          <WorkflowCanvas
            steps={steps}
            onStepClick={handleSelectStep}
            onAddStep={handleOpenStepPicker}
            onRemoveStep={handleRemoveStep}
            selectedStepId={selectedStepId}
          />
        </div>
      </div>

      {/* Réglages de l'étape ou choix d'une étape */}
      <div className="flex max-h-[200px] min-h-0 w-full flex-shrink-0 flex-col bg-background sm:max-h-none sm:w-[300px]">
        <div className="flex min-h-9 items-center justify-between gap-2 border-b border-border px-3 py-1 sm:px-4">
          <h4 className="truncate text-xs font-medium text-muted-foreground">{panelTitle}</h4>
          {showStepPicker && (
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-xs"
                  className="shrink-0 max-md:h-11 max-md:w-11"
                  onClick={handleCancelStepPicker}
                  aria-label="Fermer le choix d'étape"
                >
                  <X aria-hidden="true" />
                </Button>
              </TooltipTrigger>
              <TooltipContent>Fermer</TooltipContent>
            </Tooltip>
          )}
        </div>

        <ScrollArea className="flex-1">
          <div className="p-4">
            {showStepPicker ? (
              <div key="picker" className="space-y-5 duration-150 animate-in fade-in-0">
                {pendingBranch && (
                  <p className="flex items-center gap-2 rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs font-medium text-foreground">
                    <GitBranch className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
                    {BRANCH_LABELS[pendingBranch.branch]}
                  </p>
                )}

                <div>
                  <p className="eyebrow mb-2">Actions</p>
                  <div className="space-y-1">
                    {filteredActions.map(action => (
                      <PickerOption key={action.value} value={action.value} description={action.description} onPick={handleAddStep} />
                    ))}
                  </div>
                </div>

                <div>
                  <p className="eyebrow mb-2">Déclencheurs</p>
                  <div className="space-y-1">
                    {filteredTriggers.map(trigger => (
                      <PickerOption key={trigger.value} value={trigger.value} description={trigger.description} onPick={handleAddStep} />
                    ))}
                  </div>
                </div>
              </div>
            ) : selectedStep ? (
              <div key={`editor-${selectedStepId}`} className="duration-150 animate-in fade-in-0">
                <StepEditor
                  step={selectedStep}
                  stepIndex={selectedStepIndex}
                  allSteps={steps}
                  onUpdate={handleUpdateStep}
                />
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <span className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-muted">
                  <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                </span>
                <p className="text-xs text-muted-foreground">Sélectionnez une étape dans le déroulé.</p>
              </div>
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
};

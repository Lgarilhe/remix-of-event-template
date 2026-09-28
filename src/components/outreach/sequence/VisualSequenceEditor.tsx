import React, { useCallback, useEffect, useState } from 'react';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Button } from '@/components/ui/button';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { X, GitBranch, ChevronRight } from 'lucide-react';
import { sequenceActionLabel } from '@/lib/sequenceCatalog';
import { SequenceActionIcon } from '@/components/outreach/SequenceBadges';
import { SequenceStep } from '../SequenceBuilder';
import { WorkflowCanvas } from './WorkflowCanvas';
import { StepEditor } from './StepEditor';
import { isStepTypeOffered, nextStepOrder, removeStepFromSequence, waitEventFor, STEP_TYPE_LABELS } from './sequenceGraph';

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

// Noms : ceux de la liste (STEP_TYPE_LABELS). Icônes : catalogue des séquences
// (src/lib/sequenceCatalog.ts), neutres, sans couleur par type.
const ACTIONS = [
  { value: 'connection_request', label: STEP_TYPE_LABELS.connection_request, description: 'Demande de connexion' },
  { value: 'inmail', label: STEP_TYPE_LABELS.inmail, description: 'Message payant, sans connexion' },
  { value: 'email', label: STEP_TYPE_LABELS.email, description: 'Envoyer un e-mail' },
  { value: 'profile_visit', label: STEP_TYPE_LABELS.profile_visit, description: 'Visiter le profil' },
  { value: 'message', label: STEP_TYPE_LABELS.message, description: 'Message direct, si connecté' },
  { value: 'smart_message', label: STEP_TYPE_LABELS.smart_message, description: 'Message IA, InMail si non connecté' },
  { value: 'whatsapp_message', label: STEP_TYPE_LABELS.whatsapp_message, description: 'Si le numéro est connu' },
];

// « Attendre visite » et « Branchement » restent listés pour afficher les
// séquences existantes, mais ne sont plus proposés (isStepTypeOffered) : le
// moteur ne détecte pas les visites et ne route pas un Branchement.
const TRIGGERS = [
  { value: 'check_connection', label: STEP_TYPE_LABELS.check_connection, description: 'Deux branches selon la relation' },
  { value: 'wait_connection', label: STEP_TYPE_LABELS.wait_connection, description: "Jusqu'à l'acceptation de l'invitation" },
  { value: 'wait_reply', label: STEP_TYPE_LABELS.wait_reply, description: "Jusqu'à une réponse" },
  { value: 'wait_profile_visit', label: STEP_TYPE_LABELS.wait_profile_visit, description: "Jusqu'à une visite en retour" },
  { value: 'condition_branch', label: STEP_TYPE_LABELS.condition_branch, description: 'Si, sinon' },
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
  // Sans événement, le moteur franchissait l'attente aussitôt : « Attendre
  // réponse » clôturait en « a répondu », « Attendre connexion » déclarait le
  // candidat connecté.
  waitForEvent: waitEventFor(actionType),
});

const BRANCH_LABELS = { true: 'Si connecté (1er degré)', false: 'Si non connecté (2e ou 3e degré)' } as const;

function PickerOption({ value, label, description, onPick }: { value: string; label: string; description: string; onPick: (value: string) => void }) {
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
        {/* Nom de la liste ; à défaut, celui du catalogue (jamais la clé technique). */}
        <span className="block text-sm font-medium leading-tight text-foreground">{label || sequenceActionLabel(value)}</span>
        <span className="block text-2xs leading-tight text-muted-foreground">{description}</span>
      </span>
      <ChevronRight className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
    </Button>
  );
}

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
      ? `Ajouter une étape : ${pendingBranch.branch === 'true' ? 'branche Connecté' : 'branche Non connecté'}`
      : 'Ajouter une étape'
    : "Réglages de l'étape";

  // Pas d'animation de sortie : le nouveau panneau attendait la fin de la
  // sortie de l'ancien, et un clic rapide sur une autre étape laissait affichés
  // les réglages de la précédente. Chaque panneau entre seul, par sa clé.
  const panelContent = (
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
                <PickerOption key={action.value} value={action.value} label={action.label} description={action.description} onPick={handleAddStep} />
              ))}
            </div>
          </div>

          <div>
            <p className="eyebrow mb-2">Attentes et conditions</p>
            <div className="space-y-1">
              {filteredTriggers.map(trigger => (
                <PickerOption key={trigger.value} value={trigger.value} label={trigger.label} description={trigger.description} onPick={handleAddStep} />
              ))}
            </div>
          </div>
        </div>
      ) : selectedStep ? (
        <div key={`editor-${selectedStepId}`} className="duration-150 animate-in fade-in-0">
          <StepEditor
            step={selectedStep}
            allSteps={steps}
            onUpdate={handleUpdateStep}
          />
        </div>
      ) : (
        <div className="flex flex-col items-center justify-center py-12 text-center">
          <span className="mb-3 grid h-10 w-10 place-items-center rounded-full bg-muted">
            <ChevronRight className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          </span>
          <p className="text-xs text-muted-foreground">Sélectionnez une étape dans le parcours.</p>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="flex h-[420px] flex-col overflow-hidden rounded-xl border border-border bg-background sm:h-[560px] sm:flex-row">
        {/* Parcours */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col border-border bg-muted/20 sm:border-r">
          <div className="flex items-center justify-between border-b border-border px-3 py-2 sm:px-4 sm:py-2.5">
            <span className="text-xs font-medium text-muted-foreground">Parcours</span>
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

        {/* Réglages de l'étape ou choix d'une étape (à partir de 640 px) */}
        {!isSmallScreen && (
          <div className="flex min-h-0 w-[300px] flex-shrink-0 flex-col bg-background">
            <div className="flex min-h-9 items-center justify-between gap-2 border-b border-border px-4 py-1">
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
              {panelContent}
            </ScrollArea>
          </div>
        )}
      </div>

      {/* Sous 640 px : réglages en plein écran, pour rédiger le message à l'aise. */}
      {isSmallScreen && (
        <Sheet open={mobilePanelOpen} onOpenChange={handleMobilePanelChange}>
          <SheetContent side="bottom" className="flex h-[92vh] flex-col gap-0 p-0">
            <SheetHeader className="border-b border-border px-4 py-3 pr-12 text-left">
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

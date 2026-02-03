import React from 'react';
import { 
  Mail,
  UserPlus,
  Eye,
  MessageSquare,
  Sparkles,
  GitBranch,
  Timer,
  ArrowDown,
  Check,
  X,
  Plus,
  Trash2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { SequenceStep } from '../SequenceBuilder';

interface InteractiveFlowDiagramProps {
  steps: SequenceStep[];
  onStepClick: (stepId: string) => void;
  onAddStep: () => void;
  onRemoveStep: (stepId: string) => void;
  selectedStepId: string | null;
}

const STEP_ICONS: Record<string, React.ElementType> = {
  inmail: Mail,
  connection_request: UserPlus,
  profile_visit: Eye,
  message: MessageSquare,
  smart_message: Sparkles,
  wait_connection: Timer,
  wait_reply: MessageSquare,
  wait_profile_visit: Eye,
  condition_branch: GitBranch,
  check_connection: GitBranch,
};

const STEP_COLORS: Record<string, string> = {
  inmail: 'bg-blue-100 text-blue-600 border-blue-300',
  connection_request: 'bg-emerald-100 text-emerald-600 border-emerald-300',
  profile_visit: 'bg-sky-100 text-sky-600 border-sky-300',
  message: 'bg-orange-100 text-orange-600 border-orange-300',
  smart_message: 'bg-purple-100 text-purple-600 border-purple-300',
  wait_connection: 'bg-amber-100 text-amber-600 border-amber-300',
  wait_reply: 'bg-amber-100 text-amber-600 border-amber-300',
  wait_profile_visit: 'bg-amber-100 text-amber-600 border-amber-300',
  condition_branch: 'bg-rose-100 text-rose-600 border-rose-300',
  check_connection: 'bg-indigo-100 text-indigo-600 border-indigo-300',
};

const STEP_LABELS: Record<string, string> = {
  inmail: 'InMail',
  connection_request: 'Invitation',
  profile_visit: 'Visite profil',
  message: 'Message',
  smart_message: 'Smart Msg',
  wait_connection: 'Attendre connexion',
  wait_reply: 'Attendre réponse',
  wait_profile_visit: 'Attendre visite',
  condition_branch: 'Branchement',
  check_connection: 'Vérifier connexion',
};

const StepNode: React.FC<{
  step: SequenceStep;
  index: number;
  onClick: () => void;
  onRemove: () => void;
  isSelected: boolean;
  canRemove: boolean;
}> = ({ step, index, onClick, onRemove, isSelected, canRemove }) => {
  const Icon = STEP_ICONS[step.actionType] || Mail;
  const colorClass = STEP_COLORS[step.actionType] || 'bg-gray-100 text-gray-600 border-gray-300';
  
  return (
    <div 
      className={cn(
        "relative group cursor-pointer transition-all",
        isSelected && "scale-105"
      )}
      onClick={onClick}
    >
      <div
        className={cn(
          "flex items-center gap-3 px-4 py-3 rounded-xl border-2 transition-all min-w-[180px]",
          colorClass,
          isSelected && "ring-2 ring-primary ring-offset-2 shadow-lg"
        )}
      >
        <div className="flex items-center justify-center w-8 h-8 rounded-full bg-white/50">
          <Icon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs text-muted-foreground">Étape {index + 1}</div>
          <div className="font-medium text-sm truncate">
            {STEP_LABELS[step.actionType]}
          </div>
          {step.delayDays > 0 || step.delayHours > 0 || (step.delayMinutes && step.delayMinutes > 0) ? (
            <div className="text-xs opacity-70 mt-0.5">
              ⏱ {step.delayDays > 0 ? `${step.delayDays}j` : ''} 
              {step.delayHours > 0 ? `${step.delayHours}h` : ''} 
              {step.delayMinutes && step.delayMinutes > 0 ? `${step.delayMinutes}min` : ''}
            </div>
          ) : null}
        </div>
      </div>
      
      {/* Remove button */}
      {canRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-md hover:bg-red-600"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
};

const Arrow: React.FC<{ className?: string }> = ({ className }) => (
  <div className={cn("flex justify-center py-2", className)}>
    <ArrowDown className="w-5 h-5 text-muted-foreground" />
  </div>
);

const BranchSplit: React.FC<{
  step: SequenceStep;
  allSteps: SequenceStep[];
  onStepClick: (stepId: string) => void;
  selectedStepId: string | null;
}> = ({ step, allSteps, onStepClick, selectedStepId }) => {
  const trueStep = allSteps.find(s => s.id === step.ifTrueGotoStep);
  const falseStep = allSteps.find(s => s.id === step.ifFalseGotoStep);
  
  return (
    <div className="flex flex-col items-center w-full mt-2">
      {/* Branch lines */}
      <div className="flex items-center justify-center w-full gap-1">
        <div className="flex-1 h-px bg-emerald-300 max-w-[100px]" />
        <div className="w-2 h-2 rounded-full bg-muted-foreground" />
        <div className="flex-1 h-px bg-orange-300 max-w-[100px]" />
      </div>
      
      {/* Two branches */}
      <div className="flex justify-center gap-6 w-full mt-3">
        {/* Left branch (if connected) */}
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-emerald-100 text-emerald-700 mb-2">
            <Check className="w-3 h-3" />
            1er degré
          </div>
          <div className="w-px h-4 bg-emerald-300" />
          {trueStep ? (
            <div 
              onClick={() => onStepClick(trueStep.id)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg border-2 cursor-pointer transition-all",
                STEP_COLORS[trueStep.actionType],
                selectedStepId === trueStep.id && "ring-2 ring-primary ring-offset-1"
              )}
            >
              {(() => {
                const Icon = STEP_ICONS[trueStep.actionType];
                return <Icon className="w-4 h-4" />;
              })()}
              <span className="text-xs font-medium">{STEP_LABELS[trueStep.actionType]}</span>
            </div>
          ) : (
            <div className="px-3 py-2 rounded-lg border-2 border-dashed border-emerald-300 text-xs text-emerald-600">
              Étape suivante
            </div>
          )}
        </div>
        
        {/* Right branch (if not connected) */}
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-1 text-xs font-medium px-2 py-1 rounded-full bg-orange-100 text-orange-700 mb-2">
            <X className="w-3 h-3" />
            2e/3e degré
          </div>
          <div className="w-px h-4 bg-orange-300" />
          {falseStep ? (
            <div 
              onClick={() => onStepClick(falseStep.id)}
              className={cn(
                "flex items-center gap-2 px-3 py-2 rounded-lg border-2 cursor-pointer transition-all",
                STEP_COLORS[falseStep.actionType],
                selectedStepId === falseStep.id && "ring-2 ring-primary ring-offset-1"
              )}
            >
              {(() => {
                const Icon = STEP_ICONS[falseStep.actionType];
                return <Icon className="w-4 h-4" />;
              })()}
              <span className="text-xs font-medium">{STEP_LABELS[falseStep.actionType]}</span>
            </div>
          ) : (
            <div className="px-3 py-2 rounded-lg border-2 border-dashed border-orange-300 text-xs text-orange-600">
              Étape suivante
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export const InteractiveFlowDiagram: React.FC<InteractiveFlowDiagramProps> = ({
  steps,
  onStepClick,
  onAddStep,
  onRemoveStep,
  selectedStepId,
}) => {
  const renderFlow = () => {
    const elements: React.ReactNode[] = [];
    const renderedStepIds = new Set<string>();
    
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      
      // Skip if already rendered as part of a branch
      if (renderedStepIds.has(step.id)) continue;
      
      // Add arrow before step (except first)
      if (i > 0 && !renderedStepIds.has(steps[i-1]?.id)) {
        elements.push(<Arrow key={`arrow-${step.id}`} />);
      }
      
      // Render step node
      elements.push(
        <StepNode
          key={step.id}
          step={step}
          index={i}
          onClick={() => onStepClick(step.id)}
          onRemove={() => onRemoveStep(step.id)}
          isSelected={selectedStepId === step.id}
          canRemove={steps.length > 1}
        />
      );
      
      // If this is a check_connection step, render branches
      if (step.actionType === 'check_connection') {
        elements.push(
          <BranchSplit
            key={`branch-${step.id}`}
            step={step}
            allSteps={steps}
            onStepClick={onStepClick}
            selectedStepId={selectedStepId}
          />
        );
        
        // Mark branch targets as rendered
        if (step.ifTrueGotoStep) renderedStepIds.add(step.ifTrueGotoStep);
        if (step.ifFalseGotoStep) renderedStepIds.add(step.ifFalseGotoStep);
      }
    }
    
    return elements;
  };

  return (
    <div className="flex flex-col items-center py-4 px-2">
      {steps.length === 0 ? (
        <div className="flex flex-col items-center justify-center p-8 text-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
            <Plus className="w-8 h-8 text-muted-foreground" />
          </div>
          <p className="text-sm text-muted-foreground mb-4">
            Aucune étape dans la séquence
          </p>
          <Button onClick={onAddStep} size="sm">
            <Plus className="w-4 h-4 mr-2" />
            Ajouter une étape
          </Button>
        </div>
      ) : (
        <>
          {renderFlow()}
          
          {/* Add step button */}
          <Arrow />
          <Button
            variant="outline"
            size="sm"
            onClick={onAddStep}
            className="border-dashed border-2 hover:border-primary hover:bg-primary/5"
          >
            <Plus className="w-4 h-4 mr-2" />
            Ajouter une étape
          </Button>
        </>
      )}
    </div>
  );
};

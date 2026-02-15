import React from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { 
  Sparkles,
  GitBranch,
  Zap,
  Timer,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SequenceStep } from '../SequenceBuilder';

interface StepEditorProps {
  step: SequenceStep;
  stepIndex: number;
  allSteps: SequenceStep[];
  onUpdate: (updates: Partial<SequenceStep>) => void;
  allStepTypes: Array<{ value: string; label: string; icon: React.ElementType; color: string }>;
}

const CONDITION_TYPES = [
  { value: 'always', label: 'Toujours exécuter' },
  { value: 'if_connected', label: 'Si connecté' },
  { value: 'if_not_connected', label: 'Si non connecté' },
  { value: 'if_no_response', label: 'Si pas de réponse' },
];

const TIMEOUT_ACTIONS = [
  { value: 'skip', label: 'Passer à l\'étape suivante' },
  { value: 'alternative_step', label: 'Exécuter étape alternative' },
  { value: 'end_sequence', label: 'Terminer la séquence' },
];

const AI_TONES = [
  { value: 'professional', label: 'Professionnel' },
  { value: 'casual', label: 'Décontracté' },
  { value: 'enthusiastic', label: 'Enthousiaste' },
];

const ACTIONS = ['connection_request', 'inmail', 'profile_visit', 'message', 'smart_message'];
const TRIGGERS = ['check_connection', 'wait_connection', 'wait_reply', 'wait_profile_visit', 'condition_branch'];

const isAction = (actionType: string) => ACTIONS.includes(actionType);
const isTrigger = (actionType: string) => TRIGGERS.includes(actionType);
const needsMessage = (type: string) => ['inmail', 'connection_request', 'message', 'smart_message'].includes(type);
const needsSubject = (type: string) => type === 'inmail';

export const StepEditor: React.FC<StepEditorProps> = ({
  step,
  stepIndex,
  allSteps,
  onUpdate,
  allStepTypes,
}) => {
  const stepConfig = allStepTypes.find(a => a.value === step.actionType);
  const StepIcon = stepConfig?.icon || Sparkles;
  const stepIsTrigger = isTrigger(step.actionType);

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center gap-3 pb-3 border-b mb-4">
        <div className={cn(
          "w-10 h-10 rounded-lg flex items-center justify-center",
          stepConfig?.color || "bg-muted"
        )}>
          <StepIcon className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-xs font-medium px-1.5 py-0.5 rounded bg-muted">
              {stepIsTrigger ? 'TRIGGER' : 'ACTION'}
            </span>
            <span className="font-semibold">{stepConfig?.label}</span>
          </div>
          <div className="text-xs text-muted-foreground">
            Étape {stepIndex + 1}
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto space-y-4">
        {/* Delay (not for first step) */}
        {stepIndex > 0 && (
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Délai</Label>
            <div className="grid grid-cols-3 gap-2">
              <div>
                <Label className="text-xs">Jours</Label>
                <Input
                  type="number"
                  min={0}
                  value={step.delayDays}
                  onChange={(e) => onUpdate({ delayDays: parseInt(e.target.value) || 0 })}
                  className="mt-1 h-8"
                />
              </div>
              <div>
                <Label className="text-xs">Heures</Label>
                <Input
                  type="number"
                  min={0}
                  max={23}
                  value={step.delayHours}
                  onChange={(e) => onUpdate({ delayHours: parseInt(e.target.value) || 0 })}
                  className="mt-1 h-8"
                />
              </div>
              <div>
                <Label className="text-xs">Minutes</Label>
                <Input
                  type="number"
                  min={0}
                  max={59}
                  value={step.delayMinutes || 0}
                  onChange={(e) => onUpdate({ delayMinutes: parseInt(e.target.value) || 0 })}
                  className="mt-1 h-8"
                />
              </div>
            </div>
          </div>
        )}

        {/* Condition for actions */}
        {isAction(step.actionType) && (
          <div>
            <Label className="text-xs">Condition d'exécution</Label>
            <Select
              value={step.conditionType}
              onValueChange={(value) => onUpdate({ conditionType: value as SequenceStep['conditionType'] })}
            >
              <SelectTrigger className="mt-1 h-8">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CONDITION_TYPES.map(cond => (
                  <SelectItem key={cond.value} value={cond.value}>
                    {cond.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        )}

        {/* Trigger configuration */}
        {stepIsTrigger && step.actionType !== 'condition_branch' && step.actionType !== 'check_connection' && (
          <div className="space-y-3 p-3 bg-amber-50 border border-amber-200 rounded-lg">
            <div className="flex items-center gap-2 text-amber-700">
              <Zap className="w-4 h-4" />
              <span className="font-medium text-xs">Configuration du trigger</span>
            </div>
            
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-xs">Timeout (jours)</Label>
                <Input
                  type="number"
                  min={1}
                  value={step.timeoutDays || 3}
                  onChange={(e) => onUpdate({ timeoutDays: parseInt(e.target.value) || 3 })}
                  className="mt-1 h-8"
                />
              </div>
              <div>
                <Label className="text-xs">Si timeout</Label>
                <Select
                  value={step.timeoutAction || 'skip'}
                  onValueChange={(value) => onUpdate({ timeoutAction: value as SequenceStep['timeoutAction'] })}
                >
                  <SelectTrigger className="mt-1 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {TIMEOUT_ACTIONS.map(action => (
                      <SelectItem key={action.value} value={action.value}>
                        {action.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        {/* Check connection configuration */}
        {step.actionType === 'check_connection' && (
          <div className="space-y-3 p-3 bg-indigo-50 border border-indigo-200 rounded-lg">
            <div className="flex items-center gap-2 text-indigo-700">
              <GitBranch className="w-4 h-4" />
              <span className="font-medium text-xs">Branchement conditionnel</span>
            </div>
            
            <div className="space-y-3">
              <div>
                <Label className="text-xs flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                  Si connecté (1er degré)
                </Label>
                <Select
                  value={step.ifTrueGotoStep || '__next__'}
                  onValueChange={(value) => onUpdate({ ifTrueGotoStep: value === '__next__' ? undefined : value })}
                >
                  <SelectTrigger className="mt-1 h-8">
                    <SelectValue placeholder="Sélectionner..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__next__">Étape suivante</SelectItem>
                    {allSteps.filter(s => s.order > step.order && s.id).map(s => {
                      const config = allStepTypes.find(a => a.value === s.actionType);
                      return (
                        <SelectItem key={s.id} value={s.id}>
                          {s.order + 1}. {config?.label || s.actionType}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <Label className="text-xs flex items-center gap-1">
                  <span className="w-2 h-2 rounded-full bg-orange-500"></span>
                  Si non connecté (2e/3e degré)
                </Label>
                <Select
                  value={step.ifFalseGotoStep || '__next__'}
                  onValueChange={(value) => onUpdate({ ifFalseGotoStep: value === '__next__' ? undefined : value })}
                >
                  <SelectTrigger className="mt-1 h-8">
                    <SelectValue placeholder="Sélectionner..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__next__">Étape suivante</SelectItem>
                    {allSteps.filter(s => s.order > step.order && s.id).map(s => {
                      const config = allStepTypes.find(a => a.value === s.actionType);
                      return (
                        <SelectItem key={s.id} value={s.id}>
                          {s.order + 1}. {config?.label || s.actionType}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        )}

        {/* Condition branch configuration */}
        {step.actionType === 'condition_branch' && (
          <div className="space-y-3 p-3 bg-rose-50 border border-rose-200 rounded-lg">
            <div className="flex items-center gap-2 text-rose-700">
              <GitBranch className="w-4 h-4" />
              <span className="font-medium text-xs">Configuration du branchement</span>
            </div>
            
            <div>
              <Label className="text-xs">Condition à vérifier</Label>
              <Select
                value={step.conditionType}
                onValueChange={(value) => onUpdate({ conditionType: value as SequenceStep['conditionType'] })}
              >
                <SelectTrigger className="mt-1 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {CONDITION_TYPES.filter(c => c.value !== 'always').map(cond => (
                    <SelectItem key={cond.value} value={cond.value}>
                      {cond.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <Label className="text-xs">Si condition non remplie</Label>
              <Select
                value={step.timeoutAction || 'skip'}
                onValueChange={(value) => onUpdate({ timeoutAction: value as SequenceStep['timeoutAction'] })}
              >
                <SelectTrigger className="mt-1 h-8">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {TIMEOUT_ACTIONS.map(action => (
                    <SelectItem key={action.value} value={action.value}>
                      {action.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
        )}

        {/* Next Step selector for graph-based sequencing (for non-branching steps) */}
        {step.actionType !== 'check_connection' && step.actionType !== 'condition_branch' && (
          <div className="space-y-2">
            <Label className="text-xs font-semibold uppercase text-muted-foreground flex items-center gap-1">
              <Timer className="w-3 h-3" />
              Étape suivante
            </Label>
            <Select
              value={step.nextStepId || '__auto__'}
              onValueChange={(value) => onUpdate({ nextStepId: value === '__auto__' ? undefined : value })}
            >
              <SelectTrigger className="h-8">
                <SelectValue placeholder="Automatique" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__auto__">Automatique (ordre)</SelectItem>
                <SelectItem value="__end__">Fin de séquence</SelectItem>
                {allSteps.filter(s => s.id !== step.id && s.id).map(s => {
                  const config = allStepTypes.find(a => a.value === s.actionType);
                  return (
                    <SelectItem key={s.id} value={s.id}>
                      {s.order + 1}. {config?.label || s.actionType}
                    </SelectItem>
                  );
                })}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Vers quelle étape aller après celle-ci
            </p>
          </div>
        )}

        {/* Message fields */}
        {needsMessage(step.actionType) && (
          <div className="space-y-3">
            {/* AI toggle */}
            <div className="flex items-center justify-between p-2 bg-muted/50 rounded-lg">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-purple-600" />
                <span className="text-xs font-medium">Personnalisation IA</span>
              </div>
              <Switch
                checked={step.useAiPersonalization}
                onCheckedChange={(checked) => onUpdate({ useAiPersonalization: checked })}
              />
            </div>

            {step.useAiPersonalization ? (
              <div>
                <Label className="text-xs">Ton du message</Label>
                <Select
                  value={step.aiTone || 'professional'}
                  onValueChange={(value) => onUpdate({ aiTone: value as SequenceStep['aiTone'] })}
                >
                  <SelectTrigger className="mt-1 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {AI_TONES.map(tone => (
                      <SelectItem key={tone.value} value={tone.value}>
                        {tone.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground mt-1">
                  Message généré par IA.
                </p>
              </div>
            ) : (
              <>
                {needsSubject(step.actionType) && (
                  <div>
                    <Label className="text-xs">Objet</Label>
                    <Input
                      value={step.subjectTemplate || ''}
                      onChange={(e) => onUpdate({ subjectTemplate: e.target.value })}
                      placeholder="Objet de l'InMail"
                      className="mt-1 h-8"
                    />
                  </div>
                )}
                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Message</Label>
                    {step.actionType === 'connection_request' && (
                      <span className={cn(
                        "text-xs",
                        (step.messageTemplate?.length || 0) > 50 ? "text-red-500 font-medium" : "text-muted-foreground"
                      )}>
                        {step.messageTemplate?.length || 0}/50
                      </span>
                    )}
                  </div>
                  <Textarea
                    value={step.messageTemplate || ''}
                    onChange={(e) => onUpdate({ messageTemplate: e.target.value })}
                    placeholder={step.actionType === 'connection_request' ? "Note courte (max 50 car.)" : "Bonjour {{firstName}}, ..."}
                    rows={step.actionType === 'connection_request' ? 2 : 3}
                    className={cn(
                      "mt-1 text-sm",
                      step.actionType === 'connection_request' && (step.messageTemplate?.length || 0) > 50 && "border-red-300 focus-visible:ring-red-300"
                    )}
                  />
                  {step.actionType === 'connection_request' ? (
                    <p className="text-xs text-muted-foreground mt-1">
                      Limite LinkedIn : 50 caractères.
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground mt-1">
                      {'{{firstName}}, {{lastName}}, {{company}}'}
                    </p>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

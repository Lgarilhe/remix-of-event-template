import React, { useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { 
  Sparkles,
  GitBranch,
  Zap,
  Timer,
  MessageSquare,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { SequenceStep } from '../SequenceBuilder';
import { getStepMessageType } from './messageTypeUtils';
import { getConditionsForActionType, ALL_CONDITION_TYPES, isEmailStep, isWhatsAppStep, isCrossChannelCondition } from './conditionTypes';
import { VariableInserter } from './VariableInserter';
import { useEmailSignatures } from '@/hooks/useEmailSignatures';

interface StepEditorProps {
  step: SequenceStep;
  stepIndex: number;
  allSteps: SequenceStep[];
  onUpdate: (updates: Partial<SequenceStep>) => void;
  allStepTypes: Array<{ value: string; label: string; icon: React.ElementType; color: string }>;
}

const TIMEOUT_ACTIONS = [
  { value: 'skip', label: 'Passer à l\'étape suivante' },
  { value: 'alternative_step', label: 'Exécuter étape alternative' },
  { value: 'end_sequence', label: 'Terminer la séquence' },
];

const HOURS = Array.from({ length: 24 }, (_, i) => ({ value: i, label: `${i}h` }));

const AI_TONES = [
  { value: 'professional', label: 'Professionnel' },
  { value: 'casual', label: 'Décontracté' },
  { value: 'enthusiastic', label: 'Enthousiaste' },
];

const ACTIONS = ['connection_request', 'inmail', 'email', 'profile_visit', 'message', 'smart_message', 'whatsapp_message'];
const TRIGGERS = ['check_connection', 'wait_connection', 'wait_reply', 'wait_profile_visit', 'condition_branch'];

const isAction = (actionType: string) => ACTIONS.includes(actionType);
const isTrigger = (actionType: string) => TRIGGERS.includes(actionType);
const needsMessage = (type: string) => ['inmail', 'email', 'connection_request', 'message', 'smart_message', 'whatsapp_message'].includes(type);
const needsSubject = (type: string) => ['inmail', 'email'].includes(type);

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
  const msgType = getStepMessageType(step, allSteps);
  const { signatures } = useEmailSignatures();
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);

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
          {msgType && (
            <div className={cn("text-xs font-medium px-2 py-0.5 rounded-full w-fit mt-0.5 flex items-center gap-1", msgType.color)}>
              <MessageSquare className="w-3 h-3" />
              {msgType.label}
            </div>
          )}
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

        {/* Send hours */}
        <Collapsible>
          <CollapsibleTrigger className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1">
            ▸ Créneau d'envoi
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-2 pt-2">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label className="text-xs">Pas avant</Label>
                <Select
                  value={String(step.preferredHourStart ?? 9)}
                  onValueChange={(value) => onUpdate({ preferredHourStart: parseInt(value) })}
                >
                  <SelectTrigger className="mt-1 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOURS.map(h => (
                      <SelectItem key={h.value} value={String(h.value)}>{h.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <Label className="text-xs">Pas après</Label>
                <Select
                  value={String(step.preferredHourEnd ?? 18)}
                  onValueChange={(value) => onUpdate({ preferredHourEnd: parseInt(value) })}
                >
                  <SelectTrigger className="mt-1 h-8">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HOURS.map(h => (
                      <SelectItem key={h.value} value={String(h.value)}>{h.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <p className="text-xs text-muted-foreground">Le message sera envoyé uniquement dans ce créneau horaire (fuseau du candidat)</p>
          </CollapsibleContent>
        </Collapsible>

        {/* Condition for actions — filtered by channel */}
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
                {getConditionsForActionType(step.actionType).map(cond => (
                  <SelectItem key={cond.value} value={cond.value}>
                    {cond.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {/* Cross-channel inline warning */}
            {isCrossChannelCondition(step.actionType, step.conditionType) && (
              <p className="text-xs text-amber-600 mt-1">⚠️ Cette condition ne fonctionne qu'avec des steps email</p>
            )}
            {/* Score threshold */}
            {step.conditionType === 'if_score_above' && (
              <div className="mt-2">
                <Label className="text-xs">Seuil de score (0-100)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={step.conditionValue || '70'}
                  onChange={(e) => onUpdate({ conditionValue: e.target.value })}
                  placeholder="70"
                  className={cn("mt-1 w-32 h-8", !step.conditionValue?.trim() && "border-destructive")}
                />
                {!step.conditionValue?.trim() && (
                  <p className="text-xs text-destructive mt-1">Seuil requis</p>
                )}
              </div>
            )}
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

            {/* Alternative step selector */}
            {step.timeoutAction === 'alternative_step' && (
              <div>
                <Label className="text-xs">Step alternatif</Label>
                <Select
                  value={step.timeoutBranchStepId || '__none__'}
                  onValueChange={(value) => onUpdate({ timeoutBranchStepId: value === '__none__' ? undefined : value })}
                >
                  <SelectTrigger className="mt-1 h-8">
                    <SelectValue placeholder="Sélectionner..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Sélectionner...</SelectItem>
                    {allSteps.filter(s => s.id !== step.id).map(s => {
                      const config = allStepTypes.find(a => a.value === s.actionType);
                      return (
                        <SelectItem key={s.id} value={s.id}>
                          Step {s.order + 1} — {config?.label || s.actionType}
                        </SelectItem>
                      );
                    })}
                  </SelectContent>
                </Select>
              </div>
            )}
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
                  {ALL_CONDITION_TYPES.filter(c => c.value !== 'always').map(cond => (
                    <SelectItem key={cond.value} value={cond.value}>
                      {cond.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Score threshold for condition_branch */}
            {step.conditionType === 'if_score_above' && (
              <div>
                <Label className="text-xs">Seuil de score (0-100)</Label>
                <Input
                  type="number"
                  min={0}
                  max={100}
                  value={step.conditionValue || '70'}
                  onChange={(e) => onUpdate({ conditionValue: e.target.value })}
                  placeholder="70"
                  className="mt-1 w-32 h-8"
                />
              </div>
            )}

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
                {allSteps.filter(s => s.id !== step.id && s.id && s.order > step.order).map(s => {
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
            {/* WhatsApp indicator */}
            {isWhatsAppStep(step.actionType) && (
              <div className="flex items-start gap-2 p-3 bg-emerald-50 border border-emerald-200 text-emerald-800 text-xs rounded">
                📱 Message envoyé via WhatsApp au numéro du candidat. Texte brut uniquement. Les candidats sans numéro seront automatiquement passés au step suivant.
              </div>
            )}

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
                  L'IA générera un message personnalisé pour chaque candidat au moment de l'envoi, basé sur son profil LinkedIn, l'historique CRM et le brief du poste. Vous pouvez ajouter une instruction spécifique ci-dessous.
                </p>
              </div>
            ) : (
              <>
                {/* Subject for email/inmail */}
                {needsSubject(step.actionType) && (
                  <div>
                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Objet</Label>
                      <VariableInserter
                        targetRef={subjectRef}
                        currentValue={step.subjectTemplate || ''}
                        onInsert={(val) => onUpdate({ subjectTemplate: val })}
                        showEmailVariables={isEmailStep(step.actionType)}
                      />
                    </div>
                    <Input
                      ref={subjectRef}
                      value={step.subjectTemplate || ''}
                      onChange={(e) => onUpdate({ subjectTemplate: e.target.value })}
                      placeholder={isEmailStep(step.actionType) ? "Objet de l'email" : "Objet de l'InMail"}
                      className={cn("mt-1 h-8", isEmailStep(step.actionType) && !step.subjectTemplate?.trim() && "border-destructive")}
                    />
                    {isEmailStep(step.actionType) && !step.subjectTemplate?.trim() && (
                      <p className="text-xs text-destructive mt-0.5">Objet requis</p>
                    )}
                  </div>
                )}
                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-xs">Message</Label>
                    <div className="flex items-center gap-2">
                      <VariableInserter
                        targetRef={messageRef}
                        currentValue={step.messageTemplate || ''}
                        onInsert={(val) => onUpdate({ messageTemplate: val })}
                        showEmailVariables={isEmailStep(step.actionType)}
                      />
                      {step.actionType === 'connection_request' && (
                        <span className={cn(
                          "text-xs",
                          (step.messageTemplate?.length || 0) > 300 ? "text-red-500 font-medium" : "text-muted-foreground"
                        )}>
                          {step.messageTemplate?.length || 0}/300
                        </span>
                      )}
                    </div>
                  </div>
                  <Textarea
                    ref={messageRef}
                    value={step.messageTemplate || ''}
                    onChange={(e) => onUpdate({ messageTemplate: e.target.value })}
                    placeholder={step.actionType === 'connection_request' ? "Note d'invitation (max 300 car.)" : "Bonjour {{first_name}}, ..."}
                    rows={step.actionType === 'connection_request' ? 2 : 3}
                    maxLength={step.actionType === 'connection_request' ? 300 : undefined}
                    className={cn(
                      "mt-1 text-sm",
                      step.actionType === 'connection_request' && (step.messageTemplate?.length || 0) > 300 && "border-red-300 focus-visible:ring-red-300"
                    )}
                  />
                  {step.actionType === 'connection_request' && (
                    <p className="text-xs text-muted-foreground mt-1">
                      LinkedIn limite les notes d'invitation à 300 caractères.
                    </p>
                  )}
                </div>

                {/* Email-specific fields */}
                {isEmailStep(step.actionType) && (
                  <div className="space-y-3 pt-2 border-t border-foreground/10">
                    <Collapsible>
                      <CollapsibleTrigger className="text-xs font-medium text-muted-foreground hover:text-foreground flex items-center gap-1">
                        ▸ CC / BCC
                      </CollapsibleTrigger>
                      <CollapsibleContent className="space-y-2 pt-2">
                        <div>
                          <Label className="text-xs">CC</Label>
                          <Input
                            value={(step.ccEmails || []).join(', ')}
                            onChange={(e) => onUpdate({ ccEmails: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                            placeholder="email1@ex.com, email2@ex.com"
                            className="mt-1 h-8 text-xs"
                          />
                        </div>
                        <div>
                          <Label className="text-xs">BCC</Label>
                          <Input
                            value={(step.bccEmails || []).join(', ')}
                            onChange={(e) => onUpdate({ bccEmails: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })}
                            placeholder="email@ex.com"
                            className="mt-1 h-8 text-xs"
                          />
                        </div>
                      </CollapsibleContent>
                    </Collapsible>

                    <div className="flex items-center justify-between">
                      <Label className="text-xs">Lien de désinscription</Label>
                      <Switch
                        checked={step.includeUnsubscribe ?? false}
                        onCheckedChange={(checked) => onUpdate({ includeUnsubscribe: checked })}
                      />
                    </div>

                    <div>
                      <Label className="text-xs">Signature</Label>
                      <Select
                        value={step.signatureId || '__none__'}
                        onValueChange={(value) => onUpdate({ signatureId: value === '__none__' ? undefined : value })}
                      >
                        <SelectTrigger className="mt-1 h-8 text-xs">
                          <SelectValue placeholder="Aucune" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Aucune</SelectItem>
                          {signatures.map(sig => (
                            <SelectItem key={sig.id} value={sig.id}>
                              {sig.name}{sig.is_default ? ' ⭐' : ''}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

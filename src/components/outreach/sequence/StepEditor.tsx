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
  ChevronRight,
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
  { value: 'skip', label: 'Passer à la suivante' },
  { value: 'alternative_step', label: 'Étape alternative' },
  { value: 'end_sequence', label: 'Terminer' },
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
const isTriggerStep = (actionType: string) => TRIGGERS.includes(actionType);
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
  const stepIsTrigger = isTriggerStep(step.actionType);
  const msgType = getStepMessageType(step, allSteps);
  const { signatures } = useEmailSignatures();
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex items-center gap-3">
        <div className={cn(
          "w-9 h-9 rounded-lg flex items-center justify-center shrink-0",
          stepConfig?.color || "bg-muted"
        )}>
          <StepIcon className="w-4 h-4" />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className={cn(
              "text-3xs font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded",
              stepIsTrigger ? "bg-warning/10 text-warning" : "bg-muted text-muted-foreground"
            )}>
              {stepIsTrigger ? 'trigger' : 'action'}
            </span>
            <span className="text-xs font-semibold">{stepConfig?.label}</span>
          </div>
          <div className="text-3xs text-muted-foreground/60 mt-0.5">
            Étape {stepIndex + 1}
            {msgType && (
              <> · <span className="font-medium">{msgType.label}</span></>
            )}
          </div>
        </div>
      </div>

      {/* Delay */}
      {stepIndex > 0 && (
        <Section label="Délai">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label className="text-3xs text-muted-foreground">Jours</Label>
              <Input type="number" min={0} value={step.delayDays} onChange={(e) => onUpdate({ delayDays: parseInt(e.target.value) || 0 })} className="mt-0.5 h-7 text-xs" />
            </div>
            <div>
              <Label className="text-3xs text-muted-foreground">Heures</Label>
              <Input type="number" min={0} max={23} value={step.delayHours} onChange={(e) => onUpdate({ delayHours: parseInt(e.target.value) || 0 })} className="mt-0.5 h-7 text-xs" />
            </div>
            <div>
              <Label className="text-3xs text-muted-foreground">Min</Label>
              <Input type="number" min={0} max={59} value={step.delayMinutes || 0} onChange={(e) => onUpdate({ delayMinutes: parseInt(e.target.value) || 0 })} className="mt-0.5 h-7 text-xs" />
            </div>
          </div>
        </Section>
      )}

      {/* Send hours */}
      <Collapsible>
        <CollapsibleTrigger className="text-2xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
          <ChevronRight className="w-3 h-3" />
          Créneau d'envoi
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-3xs text-muted-foreground">Pas avant</Label>
              <Select value={String(step.preferredHourStart ?? 9)} onValueChange={(value) => onUpdate({ preferredHourStart: parseInt(value) })}>
                <SelectTrigger className="mt-0.5 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{HOURS.map(h => <SelectItem key={h.value} value={String(h.value)}>{h.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label className="text-3xs text-muted-foreground">Pas après</Label>
              <Select value={String(step.preferredHourEnd ?? 18)} onValueChange={(value) => onUpdate({ preferredHourEnd: parseInt(value) })}>
                <SelectTrigger className="mt-0.5 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{HOURS.map(h => <SelectItem key={h.value} value={String(h.value)}>{h.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Condition */}
      {isAction(step.actionType) && (
        <Section label="Condition d'exécution">
          <Select value={step.conditionType} onValueChange={(value) => onUpdate({ conditionType: value as SequenceStep['conditionType'] })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {getConditionsForActionType(step.actionType).map(cond => (
                <SelectItem key={cond.value} value={cond.value}>{cond.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isCrossChannelCondition(step.actionType, step.conditionType) && (
            <p className="text-3xs text-warning mt-1">⚠️ Condition email uniquement</p>
          )}
          {step.conditionType === 'if_score_above' && (
            <div className="mt-2">
              <Label className="text-3xs text-muted-foreground">Seuil (0-100)</Label>
              <Input type="number" min={0} max={100} value={step.conditionValue || '70'} onChange={(e) => onUpdate({ conditionValue: e.target.value })} className={cn("mt-0.5 w-24 h-7 text-xs", !step.conditionValue?.trim() && "border-destructive")} />
            </div>
          )}
        </Section>
      )}

      {/* Next step selector */}
      {step.actionType !== 'check_connection' && step.actionType !== 'condition_branch' && (
        <Section label="Étape suivante" icon={<Timer className="w-3 h-3" />}>
          <Select value={step.nextStepId || '__auto__'} onValueChange={(value) => onUpdate({ nextStepId: value === '__auto__' ? undefined : value })}>
            <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Automatique" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__auto__">Automatique (ordre)</SelectItem>
              <SelectItem value="__end__">Fin de séquence</SelectItem>
              {allSteps.filter(s => s.id !== step.id && s.order > step.order).map(s => {
                const config = allStepTypes.find(a => a.value === s.actionType);
                return <SelectItem key={s.id} value={s.id}>{s.order + 1}. {config?.label || s.actionType}</SelectItem>;
              })}
            </SelectContent>
          </Select>
          <p className="text-3xs text-muted-foreground/60 mt-1">Vers quelle étape aller après celle-ci</p>
        </Section>
      )}

      {/* Trigger config */}
      {stepIsTrigger && step.actionType !== 'condition_branch' && step.actionType !== 'check_connection' && (
        <div className="space-y-3 p-3 bg-warning/10 border border-warning/30 rounded-lg">
          <div className="flex items-center gap-1.5 text-warning">
            <Zap className="w-3 h-3" />
            <span className="text-2xs font-semibold">Trigger</span>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label className="text-3xs text-muted-foreground">Timeout (j)</Label>
              <Input type="number" min={1} value={step.timeoutDays || 3} onChange={(e) => onUpdate({ timeoutDays: parseInt(e.target.value) || 3 })} className="mt-0.5 h-7 text-xs" />
            </div>
            <div>
              <Label className="text-3xs text-muted-foreground">Si timeout</Label>
              <Select value={step.timeoutAction || 'skip'} onValueChange={(value) => onUpdate({ timeoutAction: value as SequenceStep['timeoutAction'] })}>
                <SelectTrigger className="mt-0.5 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{TIMEOUT_ACTIONS.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {step.timeoutAction === 'alternative_step' && (
            <div>
              <Label className="text-3xs text-muted-foreground">Step alternatif</Label>
              <Select value={step.timeoutBranchStepId || '__none__'} onValueChange={(value) => onUpdate({ timeoutBranchStepId: value === '__none__' ? undefined : value })}>
                <SelectTrigger className="mt-0.5 h-7 text-xs"><SelectValue placeholder="Choisir..." /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Choisir...</SelectItem>
                  {allSteps.filter(s => s.id !== step.id).map(s => {
                    const config = allStepTypes.find(a => a.value === s.actionType);
                    return <SelectItem key={s.id} value={s.id}>{s.order + 1}. {config?.label || s.actionType}</SelectItem>;
                  })}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      {/* Check connection */}
      {step.actionType === 'check_connection' && (
        <div className="space-y-3 p-3 bg-info/10 border border-info/30 rounded-lg">
          <div className="flex items-center gap-1.5 text-info">
            <GitBranch className="w-3 h-3" />
            <span className="text-2xs font-semibold">Branchement</span>
          </div>
          <div>
            <Label className="text-3xs text-muted-foreground flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-success" />Si connecté
            </Label>
            <Select value={step.ifTrueGotoStep || '__next__'} onValueChange={(value) => onUpdate({ ifTrueGotoStep: value === '__next__' ? undefined : value })}>
              <SelectTrigger className="mt-0.5 h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__next__">Étape suivante</SelectItem>
                {allSteps.filter(s => s.order > step.order).map(s => {
                  const config = allStepTypes.find(a => a.value === s.actionType);
                  return <SelectItem key={s.id} value={s.id}>{s.order + 1}. {config?.label}</SelectItem>;
                })}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-3xs text-muted-foreground flex items-center gap-1">
              <span className="w-1.5 h-1.5 rounded-full bg-warning" />Si non connecté
            </Label>
            <Select value={step.ifFalseGotoStep || '__next__'} onValueChange={(value) => onUpdate({ ifFalseGotoStep: value === '__next__' ? undefined : value })}>
              <SelectTrigger className="mt-0.5 h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__next__">Étape suivante</SelectItem>
                {allSteps.filter(s => s.order > step.order).map(s => {
                  const config = allStepTypes.find(a => a.value === s.actionType);
                  return <SelectItem key={s.id} value={s.id}>{s.order + 1}. {config?.label}</SelectItem>;
                })}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Condition branch */}
      {step.actionType === 'condition_branch' && (
        <div className="space-y-3 p-3 bg-destructive/10 border border-destructive/30 rounded-lg">
          <div className="flex items-center gap-1.5 text-destructive">
            <GitBranch className="w-3 h-3" />
            <span className="text-2xs font-semibold">Branchement</span>
          </div>
          <div>
            <Label className="text-3xs text-muted-foreground">Condition</Label>
            <Select value={step.conditionType} onValueChange={(value) => onUpdate({ conditionType: value as SequenceStep['conditionType'] })}>
              <SelectTrigger className="mt-0.5 h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{ALL_CONDITION_TYPES.filter(c => c.value !== 'always').map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {step.conditionType === 'if_score_above' && (
            <div>
              <Label className="text-3xs text-muted-foreground">Seuil (0-100)</Label>
              <Input type="number" min={0} max={100} value={step.conditionValue || '70'} onChange={(e) => onUpdate({ conditionValue: e.target.value })} className="mt-0.5 w-24 h-7 text-xs" />
            </div>
          )}
          <div>
            <Label className="text-3xs text-muted-foreground">Si faux</Label>
            <Select value={step.timeoutAction || 'skip'} onValueChange={(value) => onUpdate({ timeoutAction: value as SequenceStep['timeoutAction'] })}>
              <SelectTrigger className="mt-0.5 h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{TIMEOUT_ACTIONS.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Message fields */}
      {needsMessage(step.actionType) && (
        <div className="space-y-4">
          {isWhatsAppStep(step.actionType) && (
            <div className="text-3xs text-success bg-success/10 border border-success/30 rounded-md px-3 py-2">
              📱 WhatsApp — candidats sans numéro skippés.
            </div>
          )}

          {/* AI toggle */}
          <div className="flex items-center justify-between px-3 py-2 bg-muted/30 rounded-md">
            <div className="flex items-center gap-2">
              <Sparkles className="w-3.5 h-3.5 text-purple-500" />
              <span className="text-2xs font-medium">Personnalisation IA</span>
            </div>
            <Switch
              checked={step.useAiPersonalization}
              onCheckedChange={(checked) => onUpdate({ useAiPersonalization: checked })}
            />
          </div>

          {step.useAiPersonalization ? (
            <div>
              <Label className="text-3xs text-muted-foreground">Ton</Label>
              <Select value={step.aiTone || 'professional'} onValueChange={(value) => onUpdate({ aiTone: value as SequenceStep['aiTone'] })}>
                <SelectTrigger className="mt-0.5 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{AI_TONES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
              <p className="text-3xs text-muted-foreground/60 mt-1.5">Message généré au moment de l'envoi, basé sur le profil et le brief.</p>
            </div>
          ) : (
            <>
              {needsSubject(step.actionType) && (
                <div>
                  <div className="flex items-center justify-between">
                    <Label className="text-3xs text-muted-foreground">Objet</Label>
                    <VariableInserter targetRef={subjectRef} currentValue={step.subjectTemplate || ''} onInsert={(val) => onUpdate({ subjectTemplate: val })} showEmailVariables={step.actionType === 'email'} />
                  </div>
                  <Input ref={subjectRef} value={step.subjectTemplate || ''} onChange={(e) => onUpdate({ subjectTemplate: e.target.value })} placeholder={step.actionType === 'email' ? "Objet de l'email" : "Objet de l'InMail"} className={cn("mt-0.5 h-7 text-xs", needsSubject(step.actionType) && !step.subjectTemplate?.trim() && "border-destructive")} />
                  {needsSubject(step.actionType) && !step.subjectTemplate?.trim() && <p className="text-3xs text-destructive mt-0.5">Objet requis</p>}
                </div>
              )}
              <div>
                <div className="flex items-center justify-between">
                  <Label className="text-3xs text-muted-foreground">Message</Label>
                  <div className="flex items-center gap-1.5">
                    <VariableInserter targetRef={messageRef} currentValue={step.messageTemplate || ''} onInsert={(val) => onUpdate({ messageTemplate: val })} showEmailVariables={step.actionType === 'email'} />
                    {step.actionType === 'connection_request' && (
                      <span className={cn("text-3xs", (step.messageTemplate?.length || 0) > 300 ? "text-destructive font-medium" : "text-muted-foreground/50")}>
                        {step.messageTemplate?.length || 0}/300
                      </span>
                    )}
                  </div>
                </div>
                <Textarea
                  ref={messageRef}
                  value={step.messageTemplate || ''}
                  onChange={(e) => onUpdate({ messageTemplate: e.target.value })}
                  placeholder={step.actionType === 'connection_request' ? "Note d'invitation (max 300)" : "Bonjour {{first_name}}, ..."}
                  rows={step.actionType === 'connection_request' ? 2 : 3}
                  maxLength={step.actionType === 'connection_request' ? 300 : undefined}
                  className={cn("mt-0.5 text-xs", step.actionType === 'connection_request' && (step.messageTemplate?.length || 0) > 300 && "border-destructive")}
                />
              </div>

              {/* Email extras — only for real email, not InMail */}
              {step.actionType === 'email' && (
                <div className="space-y-3 pt-3 border-t border-border/30">
                  <Collapsible>
                    <CollapsibleTrigger className="text-2xs text-muted-foreground hover:text-foreground flex items-center gap-1 transition-colors">
                      <ChevronRight className="w-3 h-3" />CC / BCC
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-2 pt-2">
                      <div>
                        <Label className="text-3xs text-muted-foreground">CC</Label>
                        <Input value={(step.ccEmails || []).join(', ')} onChange={(e) => onUpdate({ ccEmails: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="email@ex.com" className="mt-0.5 h-7 text-xs" />
                      </div>
                      <div>
                        <Label className="text-3xs text-muted-foreground">BCC</Label>
                        <Input value={(step.bccEmails || []).join(', ')} onChange={(e) => onUpdate({ bccEmails: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="email@ex.com" className="mt-0.5 h-7 text-xs" />
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  <div className="flex items-center justify-between">
                    <Label className="text-3xs text-muted-foreground">Désinscription</Label>
                    <Switch checked={step.includeUnsubscribe ?? false} onCheckedChange={(checked) => onUpdate({ includeUnsubscribe: checked })} />
                  </div>

                  <div>
                    <Label className="text-3xs text-muted-foreground">Signature</Label>
                    <Select value={step.signatureId || '__none__'} onValueChange={(value) => onUpdate({ signatureId: value === '__none__' ? undefined : value })}>
                      <SelectTrigger className="mt-0.5 h-7 text-xs"><SelectValue placeholder="Aucune" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Aucune</SelectItem>
                        {signatures.map(sig => <SelectItem key={sig.id} value={sig.id}>{sig.name}{sig.is_default ? ' ⭐' : ''}</SelectItem>)}
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
  );
};

// ── Section helper ──
const Section: React.FC<{ label: string; icon?: React.ReactNode; children: React.ReactNode }> = ({ label, icon, children }) => (
  <div className="space-y-1.5">
    <div className="flex items-center gap-1.5">
      {icon}
      <Label className="text-3xs font-medium uppercase tracking-wider text-muted-foreground/60">{label}</Label>
    </div>
    {children}
  </div>
);

import React, { useId, useRef } from 'react';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Banner } from '@/components/ui/banner';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Switch } from '@/components/ui/switch';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { AlertTriangle, ChevronRight, GitBranch, Hourglass, Info } from 'lucide-react';
import { cn } from '@/lib/utils';
import { sequenceActionLabel, MESSAGE_TONES } from '@/lib/sequenceCatalog';
import { SequenceActionIcon } from '@/components/outreach/SequenceBadges';
import { SequenceStep } from '../SequenceBuilder';
import { getStepMessageType } from './messageTypeUtils';
import { getConditionsForActionType, ALL_CONDITION_TYPES, isWhatsAppStep, isCrossChannelCondition } from './conditionTypes';
import { VariableInserter } from './VariableInserter';
import { useEmailSignatures } from '@/hooks/useEmailSignatures';

interface StepEditorProps {
  step: SequenceStep;
  stepIndex: number;
  allSteps: SequenceStep[];
  onUpdate: (updates: Partial<SequenceStep>) => void;
}

const TIMEOUT_ACTIONS = [
  { value: 'skip', label: "Passer à l'étape suivante" },
  { value: 'alternative_step', label: 'Aller à une autre étape' },
  { value: 'end_sequence', label: 'Terminer la séquence' },
];

const HOURS = Array.from({ length: 24 }, (_, i) => ({ value: i, label: `${i} h` }));

const ACTIONS = ['connection_request', 'inmail', 'email', 'profile_visit', 'message', 'smart_message', 'whatsapp_message'];
const TRIGGERS = ['check_connection', 'wait_connection', 'wait_reply', 'wait_profile_visit', 'condition_branch'];

const isAction = (actionType: string) => ACTIONS.includes(actionType);
const isTriggerStep = (actionType: string) => TRIGGERS.includes(actionType);
const needsMessage = (type: string) => ['inmail', 'email', 'connection_request', 'message', 'smart_message', 'whatsapp_message'].includes(type);
const needsSubject = (type: string) => ['inmail', 'email'].includes(type);

/** Seuil de score : un nombre entier de 0 à 100. */
const scoreThresholdError = (value?: string) => {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return 'Indiquez un seuil entre 0 et 100.';
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > 100) return 'Le seuil doit être compris entre 0 et 100.';
  return null;
};

const stepOptionLabel = (s: SequenceStep) => `Étape ${s.order + 1} : ${sequenceActionLabel(s.actionType)}`;

export const StepEditor: React.FC<StepEditorProps> = ({
  step,
  stepIndex,
  allSteps,
  onUpdate,
}) => {
  const stepIsTrigger = isTriggerStep(step.actionType);
  const msgType = getStepMessageType(step, allSteps);
  const { signatures } = useEmailSignatures();
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const scoreError = step.conditionType === 'if_score_above' ? scoreThresholdError(step.conditionValue) : null;

  return (
    <div className="flex flex-col gap-5">
      {/* En-tête */}
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground-secondary">
          <SequenceActionIcon type={step.actionType} className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="muted" className="px-1.5 py-0 text-3xs">{stepIsTrigger ? 'Déclencheur' : 'Action'}</Badge>
            <span className="text-xs font-semibold text-foreground">{sequenceActionLabel(step.actionType)}</span>
          </div>
          <p className="mt-0.5 text-2xs text-muted-foreground">
            Étape {stepIndex + 1}
            {msgType && <> · {msgType.label}</>}
          </p>
        </div>
      </div>

      {/* Délai */}
      {stepIndex > 0 && (
        <fieldset>
          <legend className="eyebrow mb-1.5">Délai avant l'étape</legend>
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label htmlFor={`${id}-days`} className="text-2xs font-normal text-muted-foreground">Jours</Label>
              <Input id={`${id}-days`} type="number" min={0} value={step.delayDays} onChange={(e) => onUpdate({ delayDays: parseInt(e.target.value) || 0 })} className="mt-1 h-7 text-xs" />
            </div>
            <div>
              <Label htmlFor={`${id}-hours`} className="text-2xs font-normal text-muted-foreground">Heures</Label>
              <Input id={`${id}-hours`} type="number" min={0} max={23} value={step.delayHours} onChange={(e) => onUpdate({ delayHours: parseInt(e.target.value) || 0 })} className="mt-1 h-7 text-xs" />
            </div>
            <div>
              <Label htmlFor={`${id}-minutes`} className="text-2xs font-normal text-muted-foreground">Minutes</Label>
              <Input id={`${id}-minutes`} type="number" min={0} max={59} value={step.delayMinutes || 0} onChange={(e) => onUpdate({ delayMinutes: parseInt(e.target.value) || 0 })} className="mt-1 h-7 text-xs" />
            </div>
          </div>
        </fieldset>
      )}

      {/* Créneau d'envoi */}
      <Collapsible>
        <CollapsibleTrigger className="group flex items-center gap-1 rounded-md text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11">
          <ChevronRight className="h-3.5 w-3.5 transition-transform duration-150 group-data-[state=open]:rotate-90" aria-hidden="true" />
          Créneau d'envoi
        </CollapsibleTrigger>
        <CollapsibleContent className="pt-2">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor={`${id}-start`} className="text-2xs font-normal text-muted-foreground">Pas avant</Label>
              <Select value={String(step.preferredHourStart ?? 9)} onValueChange={(value) => onUpdate({ preferredHourStart: parseInt(value) })}>
                <SelectTrigger id={`${id}-start`} className="mt-1 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{HOURS.map(h => <SelectItem key={h.value} value={String(h.value)}>{h.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
            <div>
              <Label htmlFor={`${id}-end`} className="text-2xs font-normal text-muted-foreground">Pas après</Label>
              <Select value={String(step.preferredHourEnd ?? 18)} onValueChange={(value) => onUpdate({ preferredHourEnd: parseInt(value) })}>
                <SelectTrigger id={`${id}-end`} className="mt-1 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{HOURS.map(h => <SelectItem key={h.value} value={String(h.value)}>{h.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Condition */}
      {isAction(step.actionType) && (
        <div>
          <Label htmlFor={`${id}-condition`} className="eyebrow text-2xs font-semibold">Condition d'exécution</Label>
          <Select value={step.conditionType} onValueChange={(value) => onUpdate({ conditionType: value as SequenceStep['conditionType'] })}>
            <SelectTrigger id={`${id}-condition`} className="mt-1.5 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {getConditionsForActionType(step.actionType).map(cond => (
                <SelectItem key={cond.value} value={cond.value}>{cond.label}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {isCrossChannelCondition(step.actionType, step.conditionType) && (
            <p className="mt-1.5 flex items-start gap-1.5 text-2xs text-warning">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
              Cette condition ne s'applique pas à ce type d'étape.
            </p>
          )}
          {step.conditionType === 'if_score_above' && (
            <div className="mt-2">
              <Label htmlFor={`${id}-score`} className="text-2xs font-normal text-muted-foreground">Seuil de score (0 à 100)</Label>
              <Input
                id={`${id}-score`}
                type="number"
                min={0}
                max={100}
                placeholder="70"
                value={step.conditionValue ?? ''}
                onChange={(e) => onUpdate({ conditionValue: e.target.value })}
                aria-invalid={scoreError ? true : undefined}
                aria-describedby={scoreError ? `${id}-score-error` : undefined}
                className={cn('mt-1 h-7 w-24 text-xs', scoreError && 'border-danger')}
              />
              {scoreError && <p id={`${id}-score-error`} className="mt-1 text-2xs text-danger">{scoreError}</p>}
            </div>
          )}
        </div>
      )}

      {/* Étape suivante */}
      {step.actionType !== 'check_connection' && step.actionType !== 'condition_branch' && (
        <div>
          <Label htmlFor={`${id}-next`} className="eyebrow text-2xs font-semibold">Étape suivante</Label>
          <Select value={step.nextStepId || '__auto__'} onValueChange={(value) => onUpdate({ nextStepId: value === '__auto__' ? undefined : value })}>
            <SelectTrigger id={`${id}-next`} aria-describedby={`${id}-next-help`} className="mt-1.5 h-8 text-xs"><SelectValue placeholder="Automatique" /></SelectTrigger>
            <SelectContent>
              <SelectItem value="__auto__">Automatique (ordre des étapes)</SelectItem>
              <SelectItem value="__end__">Fin de la séquence</SelectItem>
              {allSteps.filter(s => s.id !== step.id && s.order > step.order).map(s => (
                <SelectItem key={s.id} value={s.id}>{stepOptionLabel(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id={`${id}-next-help`} className="mt-1 text-2xs text-muted-foreground">L'étape qui suit celle-ci.</p>
        </div>
      )}

      {/* Déclencheur : délai d'attente */}
      {stepIsTrigger && step.actionType !== 'condition_branch' && step.actionType !== 'check_connection' && (
        <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Hourglass className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            Délai d'attente
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor={`${id}-timeout`} className="text-2xs font-normal text-muted-foreground">Délai maximal (jours)</Label>
              <Input id={`${id}-timeout`} type="number" min={1} value={step.timeoutDays || 3} onChange={(e) => onUpdate({ timeoutDays: parseInt(e.target.value) || 3 })} className="mt-1 h-7 text-xs" />
            </div>
            <div>
              <Label htmlFor={`${id}-timeout-action`} className="text-2xs font-normal text-muted-foreground">Si le délai est dépassé</Label>
              <Select value={step.timeoutAction || 'skip'} onValueChange={(value) => onUpdate({ timeoutAction: value as SequenceStep['timeoutAction'] })}>
                <SelectTrigger id={`${id}-timeout-action`} className="mt-1 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{TIMEOUT_ACTIONS.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {step.timeoutAction === 'alternative_step' && (
            <div>
              <Label htmlFor={`${id}-fallback`} className="text-2xs font-normal text-muted-foreground">Étape de repli</Label>
              <Select value={step.timeoutBranchStepId || '__none__'} onValueChange={(value) => onUpdate({ timeoutBranchStepId: value === '__none__' ? undefined : value })}>
                <SelectTrigger id={`${id}-fallback`} className="mt-1 h-7 text-xs"><SelectValue placeholder="Choisir une étape" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Choisir une étape</SelectItem>
                  {allSteps.filter(s => s.id !== step.id).map(s => (
                    <SelectItem key={s.id} value={s.id}>{stepOptionLabel(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
        </div>
      )}

      {/* Vérification de la connexion */}
      {step.actionType === 'check_connection' && (
        <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <GitBranch className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            Vérification de la connexion
          </p>
          <div>
            <Label htmlFor={`${id}-if-true`} className="text-2xs font-normal text-muted-foreground">Si connecté (1er degré), aller à</Label>
            <Select value={step.ifTrueGotoStep || '__next__'} onValueChange={(value) => onUpdate({ ifTrueGotoStep: value === '__next__' ? undefined : value })}>
              <SelectTrigger id={`${id}-if-true`} className="mt-1 h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__next__">Étape suivante</SelectItem>
                {allSteps.filter(s => s.order > step.order).map(s => (
                  <SelectItem key={s.id} value={s.id}>{stepOptionLabel(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label htmlFor={`${id}-if-false`} className="text-2xs font-normal text-muted-foreground">Si non connecté, aller à</Label>
            <Select value={step.ifFalseGotoStep || '__next__'} onValueChange={(value) => onUpdate({ ifFalseGotoStep: value === '__next__' ? undefined : value })}>
              <SelectTrigger id={`${id}-if-false`} className="mt-1 h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="__next__">Étape suivante</SelectItem>
                {allSteps.filter(s => s.order > step.order).map(s => (
                  <SelectItem key={s.id} value={s.id}>{stepOptionLabel(s)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Condition */}
      {step.actionType === 'condition_branch' && (
        <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <GitBranch className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            Condition
          </p>
          <div>
            <Label htmlFor={`${id}-branch-condition`} className="text-2xs font-normal text-muted-foreground">Condition</Label>
            <Select value={step.conditionType} onValueChange={(value) => onUpdate({ conditionType: value as SequenceStep['conditionType'] })}>
              <SelectTrigger id={`${id}-branch-condition`} className="mt-1 h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{ALL_CONDITION_TYPES.filter(c => c.value !== 'always').map(c => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
          {step.conditionType === 'if_score_above' && (
            <div>
              <Label htmlFor={`${id}-branch-score`} className="text-2xs font-normal text-muted-foreground">Seuil de score (0 à 100)</Label>
              <Input
                id={`${id}-branch-score`}
                type="number"
                min={0}
                max={100}
                placeholder="70"
                value={step.conditionValue ?? ''}
                onChange={(e) => onUpdate({ conditionValue: e.target.value })}
                aria-invalid={scoreError ? true : undefined}
                aria-describedby={scoreError ? `${id}-branch-score-error` : undefined}
                className={cn('mt-1 h-7 w-24 text-xs', scoreError && 'border-danger')}
              />
              {scoreError && <p id={`${id}-branch-score-error`} className="mt-1 text-2xs text-danger">{scoreError}</p>}
            </div>
          )}
          <div>
            <Label htmlFor={`${id}-branch-else`} className="text-2xs font-normal text-muted-foreground">Si la condition n'est pas remplie</Label>
            <Select value={step.timeoutAction || 'skip'} onValueChange={(value) => onUpdate({ timeoutAction: value as SequenceStep['timeoutAction'] })}>
              <SelectTrigger id={`${id}-branch-else`} className="mt-1 h-7 text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>{TIMEOUT_ACTIONS.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
            </Select>
          </div>
        </div>
      )}

      {/* Message */}
      {needsMessage(step.actionType) && (
        <div className="space-y-4">
          {isWhatsAppStep(step.actionType) && (
            <Banner tone="info" icon={Info} className="rounded-lg border px-3 text-xs">
              Les candidats sans numéro de téléphone sont ignorés.
            </Banner>
          )}

          <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
            <Label htmlFor={`${id}-ai`} className="cursor-pointer text-xs">Rédaction par l'IA</Label>
            <Switch
              id={`${id}-ai`}
              checked={step.useAiPersonalization}
              onCheckedChange={(checked) => onUpdate({ useAiPersonalization: checked })}
            />
          </div>

          {step.useAiPersonalization ? (
            <div>
              <Label htmlFor={`${id}-tone`} className="text-2xs font-normal text-muted-foreground">Ton</Label>
              <Select value={step.aiTone || 'professional'} onValueChange={(value) => onUpdate({ aiTone: value as SequenceStep['aiTone'] })}>
                <SelectTrigger id={`${id}-tone`} className="mt-1 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{MESSAGE_TONES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
              <p className="mt-1.5 text-2xs text-muted-foreground">L'IA rédige le message au moment de l'envoi, à partir du profil du candidat et du brief.</p>
            </div>
          ) : (
            <>
              {needsSubject(step.actionType) && (
                <div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor={`${id}-subject`} className="text-2xs font-normal text-muted-foreground">Objet</Label>
                    <VariableInserter targetRef={subjectRef} currentValue={step.subjectTemplate || ''} onInsert={(val) => onUpdate({ subjectTemplate: val })} showEmailVariables={step.actionType === 'email'} fieldLabel="l'objet" />
                  </div>
                  <Input
                    id={`${id}-subject`}
                    ref={subjectRef}
                    value={step.subjectTemplate || ''}
                    onChange={(e) => onUpdate({ subjectTemplate: e.target.value })}
                    placeholder={step.actionType === 'email' ? "Objet de l'e-mail" : "Objet de l'InMail"}
                    aria-invalid={!step.subjectTemplate?.trim() ? true : undefined}
                    aria-describedby={!step.subjectTemplate?.trim() ? `${id}-subject-error` : undefined}
                    className={cn('mt-1 h-7 text-xs', !step.subjectTemplate?.trim() && 'border-danger')}
                  />
                  {!step.subjectTemplate?.trim() && <p id={`${id}-subject-error`} className="mt-1 text-2xs text-danger">Objet requis.</p>}
                </div>
              )}
              <div>
                <div className="flex items-center justify-between">
                  <Label htmlFor={`${id}-message`} className="text-2xs font-normal text-muted-foreground">Message</Label>
                  <div className="flex items-center gap-1.5">
                    <VariableInserter targetRef={messageRef} currentValue={step.messageTemplate || ''} onInsert={(val) => onUpdate({ messageTemplate: val })} showEmailVariables={step.actionType === 'email'} fieldLabel="le message" />
                    {step.actionType === 'connection_request' && (
                      <span className={cn('text-2xs tabular-nums', (step.messageTemplate?.length || 0) > 300 ? 'font-medium text-danger' : 'text-muted-foreground')}>
                        {step.messageTemplate?.length || 0}/300
                      </span>
                    )}
                  </div>
                </div>
                <Textarea
                  id={`${id}-message`}
                  ref={messageRef}
                  value={step.messageTemplate || ''}
                  onChange={(e) => onUpdate({ messageTemplate: e.target.value })}
                  placeholder={step.actionType === 'connection_request' ? "Note d'invitation (300 caractères au plus)" : 'Bonjour {{first_name}}, …'}
                  rows={step.actionType === 'connection_request' ? 2 : 3}
                  maxLength={step.actionType === 'connection_request' ? 300 : undefined}
                  className={cn('mt-1 text-xs', step.actionType === 'connection_request' && (step.messageTemplate?.length || 0) > 300 && 'border-danger')}
                />
              </div>

              {/* Options d'un e-mail (pas d'un InMail) */}
              {step.actionType === 'email' && (
                <div className="space-y-3 border-t border-border pt-3">
                  <Collapsible>
                    <CollapsibleTrigger className="group flex items-center gap-1 rounded-md text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11">
                      <ChevronRight className="h-3.5 w-3.5 transition-transform duration-150 group-data-[state=open]:rotate-90" aria-hidden="true" />
                      Copies (Cc, Cci)
                    </CollapsibleTrigger>
                    <CollapsibleContent className="space-y-2 pt-2">
                      <div>
                        <Label htmlFor={`${id}-cc`} className="text-2xs font-normal text-muted-foreground">Cc</Label>
                        <Input id={`${id}-cc`} value={(step.ccEmails || []).join(', ')} onChange={(e) => onUpdate({ ccEmails: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="adresse@exemple.fr" className="mt-1 h-7 text-xs" />
                      </div>
                      <div>
                        <Label htmlFor={`${id}-bcc`} className="text-2xs font-normal text-muted-foreground">Cci</Label>
                        <Input id={`${id}-bcc`} value={(step.bccEmails || []).join(', ')} onChange={(e) => onUpdate({ bccEmails: e.target.value.split(',').map(s => s.trim()).filter(Boolean) })} placeholder="adresse@exemple.fr" className="mt-1 h-7 text-xs" />
                      </div>
                    </CollapsibleContent>
                  </Collapsible>

                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor={`${id}-unsubscribe`} className="cursor-pointer text-xs font-normal">Lien de désinscription</Label>
                    <Switch id={`${id}-unsubscribe`} checked={step.includeUnsubscribe ?? false} onCheckedChange={(checked) => onUpdate({ includeUnsubscribe: checked })} />
                  </div>

                  <div>
                    <Label htmlFor={`${id}-signature`} className="text-2xs font-normal text-muted-foreground">Signature</Label>
                    <Select value={step.signatureId || '__none__'} onValueChange={(value) => onUpdate({ signatureId: value === '__none__' ? undefined : value })}>
                      <SelectTrigger id={`${id}-signature`} className="mt-1 h-7 text-xs"><SelectValue placeholder="Aucune" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Aucune</SelectItem>
                        {signatures.map(sig => <SelectItem key={sig.id} value={sig.id}>{sig.name}</SelectItem>)}
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

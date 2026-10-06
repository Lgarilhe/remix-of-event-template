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
import { getConditionsForActionType, isCrossChannelCondition, engagementConditionHint, retiredConditionNotice } from './conditionTypes';
import { VariableInserter, UnknownVariablesNotice } from './VariableInserter';
import { useEmailSignatures } from '@/hooks/useEmailSignatures';
import { useUserTemplateVariables } from '@/hooks/useUserTemplateVariables';
import {
  effectiveTimeoutAction,
  timeoutActionUpdate,
  unsupportedStepNotice,
  SMART_MESSAGE_INMAIL_HELP,
  stepHasMessageField,
  stepNeedsSubject,
  stepAllowsAi,
  timeoutTargetOptions,
  hasBackwardTimeoutTarget,
  delaySentence,
  SEND_WINDOW_HELP,
  stepLabel,
  STEP_TYPE_LABELS,
} from './sequenceGraph';

interface StepEditorProps {
  step: SequenceStep;
  allSteps: SequenceStep[];
  onUpdate: (updates: Partial<SequenceStep>) => void;
}

// « Terminer » n'est pas proposé : rien ne l'enregistrait et le moteur passait
// à l'étape suivante. Pour arrêter au délai dépassé, choisir une étape de
// repli marquée « Fin de séquence ».
const TIMEOUT_ACTIONS = [
  { value: 'skip', label: "Passer à l'étape suivante" },
  { value: 'alternative_step', label: 'Aller à une étape de repli' },
];

const HOURS = Array.from({ length: 24 }, (_, i) => ({ value: i, label: `${i} h` }));

const ACTIONS = ['connection_request', 'inmail', 'email', 'profile_visit', 'message', 'smart_message', 'whatsapp_message'];
const TRIGGERS = ['check_connection', 'wait_connection', 'wait_reply', 'wait_profile_visit', 'condition_branch'];

const isAction = (actionType: string) => ACTIONS.includes(actionType);
const isTriggerStep = (actionType: string) => TRIGGERS.includes(actionType);
const needsMessage = stepHasMessageField;
// Message IA : l'objet sert quand le message part en InMail.
const needsSubject = stepNeedsSubject;

/** Seuil de score : un nombre entier de 0 à 100. */
const scoreThresholdError = (value?: string) => {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return 'Indiquez un seuil entre 0 et 100.';
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > 100) return 'Le seuil doit être compris entre 0 et 100.';
  return null;
};

/** Nom d'un type d'étape : celui de la liste, sinon celui du catalogue (jamais la clé technique). */
const typeLabel = (actionType: string) => STEP_TYPE_LABELS[actionType] ?? sequenceActionLabel(actionType);

/** Même numérotation que la liste : ordre + 1, lettre de variante. */
const stepOptionLabel = (s: SequenceStep) => `${stepLabel(s)} : ${typeLabel(s.actionType)}`;

/** Groupe de champs titré, intitulé en capitales discrètes (classe eyebrow). */
const Section: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
  <fieldset>
    <legend className="eyebrow mb-1.5">{label}</legend>
    {children}
  </fieldset>
);

export const StepEditor: React.FC<StepEditorProps> = ({
  step,
  allSteps,
  onUpdate,
}) => {
  const stepIsTrigger = isTriggerStep(step.actionType);
  const stepKind = !stepIsTrigger
    ? 'Action'
    : step.actionType === 'check_connection' || step.actionType === 'condition_branch' ? 'Condition' : 'Attente';
  const msgType = getStepMessageType(step, allSteps);
  const { signatures } = useEmailSignatures();
  const { variables: customVariables } = useUserTemplateVariables();
  const customKeys = customVariables.map(v => v.key);
  const notice = unsupportedStepNotice(step.actionType);
  const messageRef = useRef<HTMLTextAreaElement>(null);
  const subjectRef = useRef<HTMLInputElement>(null);
  const id = useId();
  // Invitation : pas de personnalisation IA, la note saisie est celle qui part.
  const aiAllowed = stepAllowsAi(step.actionType);
  const usesAi = aiAllowed && step.useAiPersonalization;
  const isInvite = step.actionType === 'connection_request';
  const scoreError = step.conditionType === 'if_score_above' ? scoreThresholdError(step.conditionValue) : null;
  const timeoutOptions = timeoutTargetOptions(step, allSteps);
  const backwardTimeout = hasBackwardTimeoutTarget(step, allSteps);
  const currentTimeoutTarget = backwardTimeout ? allSteps.find(s => s.id === step.timeoutBranchStepId) : undefined;

  return (
    <div className="flex flex-col gap-5">
      {/* En-tête */}
      <div className="flex items-center gap-3">
        <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted text-foreground-secondary">
          <SequenceActionIcon type={step.actionType} className="h-4 w-4" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <Badge variant="muted" className="px-1.5 py-0 text-3xs">{stepKind}</Badge>
            <span className="text-xs font-semibold text-foreground">{typeLabel(step.actionType)}</span>
          </div>
          {/* Même numérotation que la liste et la vérification (ordre, lettre de variante). */}
          <p className="mt-0.5 text-2xs text-muted-foreground">
            {stepLabel(step)}
            {msgType && <> · {msgType.label}</>}
          </p>
        </div>
      </div>

      {notice && (
        <Banner tone="warning" icon={AlertTriangle} className="rounded-lg border px-3 text-xs">
          {notice}
        </Banner>
      )}
      {step.actionType === 'smart_message' && (
        <p className="flex items-start gap-1.5 text-2xs text-muted-foreground">
          <Info className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
          {SMART_MESSAGE_INMAIL_HELP}
        </p>
      )}

      {/* Délai : aucun avant la première étape (ordre 0, variantes comprises). */}
      {step.order > 0 && (
        <Section label="Délai">
          <div className="grid grid-cols-3 gap-2">
            <div>
              <Label htmlFor={`${id}-days`} className="text-2xs font-normal text-muted-foreground">Jours</Label>
              <Input id={`${id}-days`} type="number" min={0} value={step.delayDays} onChange={(e) => onUpdate({ delayDays: Math.max(0, parseInt(e.target.value) || 0) })} className="mt-1 h-7 text-xs" />
            </div>
            <div>
              <Label htmlFor={`${id}-hours`} className="text-2xs font-normal text-muted-foreground">Heures</Label>
              <Input id={`${id}-hours`} type="number" min={0} max={23} value={step.delayHours} onChange={(e) => onUpdate({ delayHours: Math.min(23, Math.max(0, parseInt(e.target.value) || 0)) })} className="mt-1 h-7 text-xs" />
            </div>
            <div>
              <Label htmlFor={`${id}-minutes`} className="text-2xs font-normal text-muted-foreground">Minutes</Label>
              <Input id={`${id}-minutes`} type="number" min={0} max={59} value={step.delayMinutes || 0} onChange={(e) => onUpdate({ delayMinutes: Math.min(59, Math.max(0, parseInt(e.target.value) || 0)) })} className="mt-1 h-7 text-xs" />
            </div>
          </div>
          <p className="mt-1.5 text-2xs text-muted-foreground">{delaySentence(step)}</p>
        </Section>
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
          <p className="mt-1.5 text-2xs text-muted-foreground">{SEND_WINDOW_HELP}</p>
        </CollapsibleContent>
      </Collapsible>

      {/* Condition */}
      {isAction(step.actionType) && (
        <div>
          <Label htmlFor={`${id}-condition`} className="eyebrow text-2xs font-semibold">Condition d'exécution</Label>
          <Select
            value={step.conditionType}
            onValueChange={(value) => onUpdate(
              // Seuil posé dans la même mise à jour : le champ affichait 70
              // sans rien enregistrer, et l'enregistrement le réclamait.
              value === 'if_score_above' && !step.conditionValue?.trim()
                ? { conditionType: 'if_score_above', conditionValue: '70' }
                : { conditionType: value as SequenceStep['conditionType'] },
            )}
          >
            <SelectTrigger id={`${id}-condition`} className="mt-1.5 h-8 text-xs"><SelectValue /></SelectTrigger>
            <SelectContent>
              {getConditionsForActionType(step.actionType, step.conditionType).map(cond => (
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
          {engagementConditionHint(step.conditionType) && (
            <p className="mt-1.5 text-2xs text-muted-foreground">{engagementConditionHint(step.conditionType)}</p>
          )}
          {retiredConditionNotice(step.conditionType) && (
            <p className="mt-1.5 flex items-start gap-1.5 text-2xs text-warning">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
              Cette condition n'est plus proposée : {retiredConditionNotice(step.conditionType)}
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
              <SelectItem value="__end__">Fin de séquence</SelectItem>
              {allSteps.filter(s => s.id !== step.id && s.order > step.order).map(s => (
                <SelectItem key={s.id} value={s.id}>{stepOptionLabel(s)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p id={`${id}-next-help`} className="mt-1 text-2xs text-muted-foreground">Vers quelle étape aller après celle-ci.</p>
        </div>
      )}

      {/* Attente : délai maximal et suite si rien ne se passe */}
      {stepIsTrigger && step.actionType !== 'condition_branch' && step.actionType !== 'check_connection' && (
        <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <Hourglass className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            Réglages de l'attente
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <Label htmlFor={`${id}-timeout`} className="text-2xs font-normal text-muted-foreground">Attendre au plus (jours)</Label>
              {/* Valeur réelle affichée : vide si rien n'est enregistré. */}
              <Input
                id={`${id}-timeout`}
                type="number"
                min={1}
                placeholder="3"
                value={step.timeoutDays ?? ''}
                onChange={(e) => { const n = parseInt(e.target.value); onUpdate({ timeoutDays: n > 0 ? n : undefined }); }}
                aria-invalid={!step.timeoutDays ? true : undefined}
                className={cn('mt-1 h-7 text-xs', !step.timeoutDays && 'border-danger')}
              />
            </div>
            <div>
              <Label htmlFor={`${id}-timeout-action`} className="text-2xs font-normal text-muted-foreground">Si rien ne se passe</Label>
              {/* Lu sur l'étape de repli enregistrée ; quitter « Étape de repli » l'efface. */}
              <Select value={effectiveTimeoutAction(step)} onValueChange={(value) => onUpdate(timeoutActionUpdate(value))}>
                <SelectTrigger id={`${id}-timeout-action`} className="mt-1 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{TIMEOUT_ACTIONS.map(a => <SelectItem key={a.value} value={a.value}>{a.label}</SelectItem>)}</SelectContent>
              </Select>
            </div>
          </div>
          {effectiveTimeoutAction(step) === 'alternative_step' && (
            <div>
              <Label htmlFor={`${id}-fallback`} className="text-2xs font-normal text-muted-foreground">Étape de repli</Label>
              <Select value={step.timeoutBranchStepId || '__none__'} onValueChange={(value) => onUpdate({ timeoutBranchStepId: value === '__none__' ? undefined : value })}>
                <SelectTrigger
                  id={`${id}-fallback`}
                  aria-invalid={!step.timeoutBranchStepId || backwardTimeout ? true : undefined}
                  aria-describedby={backwardTimeout ? `${id}-fallback-error` : undefined}
                  className={cn('mt-1 h-7 text-xs', (!step.timeoutBranchStepId || backwardTimeout) && 'border-danger')}
                >
                  <SelectValue placeholder="Choisir une étape" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">Choisir une étape</SelectItem>
                  {/* Seulement les étapes suivantes : une étape antérieure renverrait un message déjà parti. */}
                  {[...(currentTimeoutTarget ? [currentTimeoutTarget] : []), ...timeoutOptions].map(s => (
                    <SelectItem key={s.id} value={s.id}>{stepOptionLabel(s)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {backwardTimeout && (
                <p id={`${id}-fallback-error`} className="mt-1 text-2xs text-danger">
                  Cette étape vient avant l'attente : un message déjà envoyé repartirait. Choisissez une étape suivante.
                </p>
              )}
            </div>
          )}
        </div>
      )}

      {/* Vérification de la connexion */}
      {step.actionType === 'check_connection' && (
        <div className="space-y-3 rounded-lg border border-border bg-muted/40 p-3">
          <p className="flex items-center gap-1.5 text-xs font-semibold text-foreground">
            <GitBranch className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            Selon la connexion
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
          {!!step.ifTrueGotoStep !== !!step.ifFalseGotoStep && (
            <p className="flex items-start gap-1.5 text-2xs text-danger">
              <AlertTriangle className="mt-px h-3 w-3 shrink-0" aria-hidden="true" />
              La branche {step.ifTrueGotoStep ? 'Non connecté' : 'Connecté'} est vide : ces candidats partiraient dans l'autre branche. Ajoutez-y une étape, ou choisissez « Étape suivante » pour les deux cas.
            </p>
          )}
        </div>
      )}

      {/* Branchement (étapes existantes) : plus de choix pour le cas contraire, il
          n'était jamais enregistré et le moteur continuait dans les deux cas.
          L'avertissement est affiché en tête du panneau. */}

      {/* Message */}
      {needsMessage(step.actionType) && (
        <div className="space-y-4">
          {/* Rédaction par l'IA : pas pour l'invitation, dont le moteur ne génère pas la note. */}
          {aiAllowed && (
            <div className="flex items-center justify-between gap-3 rounded-lg bg-muted/40 px-3 py-2">
              <Label htmlFor={`${id}-ai`} className="cursor-pointer text-xs">Rédaction par l'IA</Label>
              <Switch
                id={`${id}-ai`}
                checked={step.useAiPersonalization}
                onCheckedChange={(checked) => onUpdate({ useAiPersonalization: checked })}
              />
            </div>
          )}

          {usesAi ? (
            <div>
              <Label htmlFor={`${id}-tone`} className="text-2xs font-normal text-muted-foreground">Ton</Label>
              <Select value={step.aiTone || 'professional'} onValueChange={(value) => onUpdate({ aiTone: value as SequenceStep['aiTone'] })}>
                <SelectTrigger id={`${id}-tone`} className="mt-1 h-7 text-xs"><SelectValue /></SelectTrigger>
                <SelectContent>{MESSAGE_TONES.map(t => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
              </Select>
              <p className="mt-1.5 text-2xs text-muted-foreground">L'IA rédige un message pour chaque candidat, à partir de son profil et du brief.</p>
            </div>
          ) : (
            <>
              {needsSubject(step.actionType) && (
                <div>
                  <div className="flex items-center justify-between">
                    <Label htmlFor={`${id}-subject`} className="text-2xs font-normal text-muted-foreground">Objet</Label>
                    <VariableInserter targetRef={subjectRef} currentValue={step.subjectTemplate || ''} onInsert={(val) => onUpdate({ subjectTemplate: val })} fieldLabel="l'objet" />
                  </div>
                  <Input
                    id={`${id}-subject`}
                    ref={subjectRef}
                    value={step.subjectTemplate || ''}
                    onChange={(e) => onUpdate({ subjectTemplate: e.target.value })}
                    placeholder={step.actionType === 'email' ? "Objet de l'e-mail" : step.actionType === 'smart_message' ? 'Objet si le message part en InMail' : "Objet de l'InMail"}
                    aria-invalid={!step.subjectTemplate?.trim() ? true : undefined}
                    aria-describedby={!step.subjectTemplate?.trim() ? `${id}-subject-error` : undefined}
                    className={cn('mt-1 h-7 text-xs', !step.subjectTemplate?.trim() && 'border-danger')}
                  />
                  {!step.subjectTemplate?.trim() && <p id={`${id}-subject-error`} className="mt-1 text-2xs text-danger">Objet requis.</p>}
                </div>
              )}
              <div>
                <div className="flex items-center justify-between">
                  <Label htmlFor={`${id}-message`} className="text-2xs font-normal text-muted-foreground">{isInvite ? "Note d'invitation" : 'Message'}</Label>
                  <div className="flex items-center gap-1.5">
                    <VariableInserter targetRef={messageRef} currentValue={step.messageTemplate || ''} onInsert={(val) => onUpdate({ messageTemplate: val })} fieldLabel={isInvite ? 'la note' : 'le message'} />
                    {isInvite && (
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
                  placeholder={isInvite ? "Note d'invitation (300 caractères au plus)" : 'Bonjour {{first_name}}, …'}
                  rows={isInvite ? 2 : 3}
                  maxLength={isInvite ? 300 : undefined}
                  className={cn('mt-1 text-xs', isInvite && (step.messageTemplate?.length || 0) > 300 && 'border-danger')}
                />
                {isInvite && (
                  <p className="mt-1 text-2xs text-muted-foreground">Note facultative. Sans note, l'invitation part seule.</p>
                )}
                <UnknownVariablesNotice text={`${needsSubject(step.actionType) ? step.subjectTemplate || '' : ''} ${step.messageTemplate || ''}`} customKeys={customKeys} />
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

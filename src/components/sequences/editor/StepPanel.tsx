// Panneau d'une étape, à droite du fil (440 px en bureau, plein écran sous
// 768 px) : versions A, B et C, « Je rédige » ou « L'IA rédige pour chaque
// candidat », champs selon le type d'étape (repris de l'ancien éditeur : objet
// d'InMail, note d'invitation, Cc et Cci, signature, attente et repli,
// branches de la vérification), puis « Plus d'options » : Délai, Créneau
// d'envoi, Faire cette étape seulement si, Après cette étape, Répartition A/B.
//
// Les champs propres à une version (texte, objet, IA, ton, part des envois)
// s'écrivent sur cette version ; les autres réglages sur toutes les versions
// de l'étape. Le message passe par MessageEditor (variables en puces
// françaises, textes de secours, variable inconnue signalée), avec l'aperçu
// réel dessous (MessagePreview).
//
// Lot 5e : « Demander à l'IA » au-dessus du texte (AskAIMenu, proposition dans
// AIProposal, remplacée seulement au clic) et, pour une séquence rédigée par
// l'IA, les notes de l'étape : « À rédiger » (texte retiré par les contrôles)
// et « À relire » (formulation signalée, tant que le texte n'a pas changé).
import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { AlertCircle, AlertTriangle, ChevronRight, Info, Plus, Trash2, X } from 'lucide-react';
import type { SequenceStep } from '@/types/sequence';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { MESSAGE_TONES } from '@/lib/sequenceCatalog';
import { useEmailSignatures } from '@/hooks/useEmailSignatures';
import {
  SMART_MESSAGE_INMAIL_HELP,
  effectiveTimeoutAction,
  hasBackwardTimeoutTarget,
  isWaitStep,
  stepAllowsAi,
  stepHasMessageField,
  stepNeedsSubject,
  stepTypeLabel,
  timeoutActionUpdate,
  timeoutTargetOptions,
  unsupportedStepNotice,
} from '@/components/outreach/sequence/sequenceGraph';
import {
  engagementConditionHint,
  getConditionsForActionType,
  isCrossChannelCondition,
  retiredConditionNotice,
} from '@/components/outreach/sequence/conditionTypes';
import {
  MAX_VERSIONS,
  afterStepValue,
  canHaveVersions,
  continueTarget,
  placementText,
  SEND_WINDOW_TEXT,
  primaryOf,
  versionsOf,
  type EditorFlow,
  type StepIssues,
} from '@/lib/sequenceEditor';
import { cn } from '@/lib/utils';
import type { SequencePreview } from '@/hooks/useSequencePreview';
import { ASK_AI_STEP_TYPES, stepNotes, type AiDraftNotes } from '@/lib/sequenceDraft';
import { AskAIMenu, type AskAIContext, type AskAIProposal } from '../ai/AskAIMenu';
import { AIProposal } from '../ai/AIProposal';
import { DelayFields } from './DelayPill';
import { MessageEditor } from './MessageEditor';
import { MessagePreview } from './MessagePreview';

/** Phrase imposée sous « L'IA rédige pour chaque candidat » (plan 5d-2, décision 5). */
export const AI_WRITES_NOTICE = 'Chaque message sera généré et relu avant l’inscription. Un message non relu ne part pas.';

const INVITE_NOTE_MAX = 300;
const HOURS = Array.from({ length: 24 }, (_, i) => i);
const ACTION_TYPES = new Set(['connection_request', 'inmail', 'email', 'profile_visit', 'message', 'smart_message', 'whatsapp_message', 'condition_branch']);
const FIELD = 'max-md:h-11';
/** Lignes de validateSequence (sans le numéro d'étape) que le cadre « À rédiger » remplace. */
const TO_WRITE_CHECKS = new Set(['message à rédiger.', "note d'invitation à rédiger.", 'objet à renseigner.']);

type Step = SequenceStep;
type Writer = 'manual' | 'ai';

/** Seuil de note : un entier de 0 à 100 (ancien éditeur). */
function scoreThresholdError(value?: string): string | null {
  const trimmed = value?.trim() ?? '';
  if (!trimmed) return 'Indiquez un seuil entre 0 et 100.';
  const n = Number(trimmed);
  if (!Number.isFinite(n) || n < 0 || n > 100) return 'Le seuil doit être compris entre 0 et 100.';
  return null;
}

function Field({ label, htmlFor, children, help, error, aside }: { label: string; htmlFor?: string; children: ReactNode; help?: ReactNode; error?: string | null; aside?: ReactNode }) {
  return (
    <div className="space-y-1.5">
      {aside ? (
        <div className="flex items-center justify-between gap-2">
          <Label htmlFor={htmlFor} className="text-sm">{label}</Label>
          {aside}
        </div>
      ) : (
        <Label htmlFor={htmlFor} className="text-sm">{label}</Label>
      )}
      {children}
      {error && <p className="text-xs text-danger">{error}</p>}
      {help && <p className="text-xs text-muted-foreground">{help}</p>}
    </div>
  );
}

/** Options d'un e-mail (type fermé, gardé lisible et modifiable sur une séquence existante). */
function EmailOptions({ step, onChange }: { step: Step; onChange: (updates: Partial<Step>) => void }) {
  const { signatures } = useEmailSignatures();
  const id = useId();
  const list = (raw: string) => raw.split(',').map((s) => s.trim()).filter(Boolean);
  return (
    <div className="space-y-4 border-t border-border pt-4">
      <Field label="Cc" htmlFor={`${id}-cc`}>
        <Input id={`${id}-cc`} value={(step.ccEmails ?? []).join(', ')} onChange={(e) => onChange({ ccEmails: list(e.target.value) })} placeholder="adresse@exemple.fr" className={FIELD} />
      </Field>
      <Field label="Cci" htmlFor={`${id}-bcc`}>
        <Input id={`${id}-bcc`} value={(step.bccEmails ?? []).join(', ')} onChange={(e) => onChange({ bccEmails: list(e.target.value) })} placeholder="adresse@exemple.fr" className={FIELD} />
      </Field>
      <div className="flex items-center justify-between gap-3">
        <Label htmlFor={`${id}-unsubscribe`} className="text-sm font-normal">Lien de désinscription</Label>
        <Switch id={`${id}-unsubscribe`} checked={step.includeUnsubscribe ?? false} onCheckedChange={(checked) => onChange({ includeUnsubscribe: checked })} />
      </div>
      <Field label="Signature" htmlFor={`${id}-signature`}>
        <Select value={step.signatureId || '__none__'} onValueChange={(value) => onChange({ signatureId: value === '__none__' ? undefined : value })}>
          <SelectTrigger id={`${id}-signature`} className={FIELD}><SelectValue placeholder="Aucune" /></SelectTrigger>
          <SelectContent>
            <SelectItem value="__none__">Aucune</SelectItem>
            {signatures.map((sig) => <SelectItem key={sig.id} value={sig.id}>{sig.name}</SelectItem>)}
          </SelectContent>
        </Select>
      </Field>
    </div>
  );
}

export interface StepPanelProps {
  steps: Step[];
  /** Étape ouverte (une version quelconque). */
  stepId: string;
  flow: EditorFlow;
  issues?: StepIssues;
  onClose: () => void;
  onUpdateVersion: (versionId: string, updates: Partial<Step>) => void;
  onUpdateStep: (stepId: string, updates: Partial<Step>) => void;
  onSetAfter: (stepId: string, value: 'continue' | 'end' | string) => void;
  onAddVersion: (stepId: string) => string | null;
  onRemove: (stepId: string) => void;
  removing: boolean;
  /** Titre du panneau (en plein écran, le titre de la fenêtre). */
  renderTitle?: (text: string) => ReactNode;
  /** Bouton « Fermer » propre au panneau (la fenêtre plein écran a le sien). */
  showClose?: boolean;
  /** Aperçu réel (inscrits, Retenus de la mission, exemple). */
  preview: SequencePreview;
  previewIndex: number;
  onPreviewIndexChange: (index: number) => void;
  /** Variables personnelles de l'expéditeur, connues du moteur. */
  extraKeys: readonly string[];
  /** « Demander à l'IA » (lot 5e) ; absent, pas de menu. */
  askAI?: AskAIContext;
  /** Notes d'une séquence rédigée par l'IA (lot 5e). */
  aiNotes?: AiDraftNotes;
}

export function StepPanel({
  steps,
  stepId,
  flow,
  issues,
  onClose,
  onUpdateVersion,
  onUpdateStep,
  onSetAfter,
  onAddVersion,
  onRemove,
  removing,
  renderTitle,
  showClose = true,
  preview,
  previewIndex,
  onPreviewIndexChange,
  extraKeys,
  askAI,
  aiNotes,
}: StepPanelProps) {
  const id = useId();
  const primary = primaryOf(steps, stepId);
  const versions = versionsOf(steps, stepId);
  const [activeId, setActiveId] = useState(stepId);
  // Autre étape ouverte : le panneau suit sa version choisie.
  useEffect(() => setActiveId(stepId), [stepId]);
  const active = versions.find((v) => v.id === activeId) ?? versions[0] ?? primary;
  // Proposition de l'IA : celle de la version affichée seulement.
  const [proposal, setProposal] = useState<AskAIProposal | null>(null);
  const activeVersionId = active?.id ?? null;
  useEffect(() => setProposal(null), [activeVersionId]);
  // « Remplacer » ou « Garder ma version » retire la proposition : le focus revient au texte de l'étape.
  const panelRef = useRef<HTMLDivElement>(null);
  const focusMessageRef = useRef(false);
  useEffect(() => {
    if (!focusMessageRef.current || proposal) return;
    focusMessageRef.current = false;
    panelRef.current?.querySelector<HTMLElement>('#message')?.focus();
  }, [proposal]);
  const closeProposal = () => {
    focusMessageRef.current = true;
    setProposal(null);
  };
  if (!primary || !active) return null;

  const number = flow.numbers.get(primary.id) ?? primary.order + 1;
  const title = `Étape ${number} · ${stepTypeLabel(primary.actionType)}`;
  const type = primary.actionType;
  const isInvite = type === 'connection_request';
  const aiAllowed = stepAllowsAi(type);
  const usesAi = aiAllowed && active.useAiPersonalization;
  const notice = unsupportedStepNotice(type);
  const updateActive = (updates: Partial<Step>) => onUpdateVersion(active.id, updates);
  const updateShared = (updates: Partial<Step>) => onUpdateStep(primary.id, updates);
  const optionLabel = (s: Step) => `Étape ${flow.numbers.get(s.id) ?? s.order + 1} : ${stepTypeLabel(s.actionType)}`;
  const laterPrimaries = steps.filter((s) => s.order > primary.order && primaryOf(steps, s.id)?.id === s.id);
  const optionsWith = (currentId: string | undefined) => {
    const current = currentId ? steps.find((s) => s.id === currentId) : undefined;
    return current && !laterPrimaries.some((s) => s.id === current.id) ? [current, ...laterPrimaries] : laterPrimaries;
  };
  const totalWeight = versions.reduce((sum, v) => sum + (v.variantWeight || 0), 0);
  const textLength = active.messageTemplate?.length ?? 0;
  const subjectMissing = stepNeedsSubject(type) && !usesAi && !active.subjectTemplate?.trim();
  const isFork = type === 'check_connection' || type === 'condition_branch';
  const scoreError = primary.conditionType === 'if_score_above' ? scoreThresholdError(primary.conditionValue) : null;
  const backwardTimeout = hasBackwardTimeoutTarget(primary, steps);
  const afterValue = afterStepValue(primary);
  const continueTo = continueTarget(steps, primary.id);
  const notes = aiNotes ? stepNotes(aiNotes, active) : null;
  const toWrite = !!notes && notes.toWrite.length > 0;
  // Le cadre « À rédiger » dit déjà ce qui manque et pourquoi : la ligne générique de la vérification n'est pas répétée.
  const shownErrors = (issues?.errors ?? []).filter((text) => !(toWrite && TO_WRITE_CHECKS.has(text.toLowerCase())));
  const shownProposal = proposal && proposal.versionId === active.id ? proposal : null;
  const askMenu = askAI && ASK_AI_STEP_TYPES.has(type) && !usesAi ? (
    <AskAIMenu context={askAI} steps={steps} version={active} onProposal={setProposal} busy={shownProposal?.status === 'loading'} />
  ) : undefined;

  const addVersion = () => {
    const created = onAddVersion(primary.id);
    if (created) setActiveId(created);
  };

  return (
    <div ref={panelRef} className="flex h-full min-h-0 flex-col">
      <div className="flex items-start gap-3 border-b border-border px-5 py-4">
        <div className="min-w-0 flex-1">
          {renderTitle ? renderTitle(title) : <h2 className="text-md font-semibold text-foreground">{title}</h2>}
          <p className="mt-0.5 text-sm text-muted-foreground">{placementText(flow.placements.get(primary.id))}</p>
        </div>
        {showClose && (
          <Button type="button" variant="ghost" size="icon-sm" aria-label="Fermer le panneau de l’étape" onClick={onClose} className="max-md:h-11 max-md:w-11">
            <X aria-hidden="true" />
          </Button>
        )}
      </div>

      <div className="min-h-0 flex-1 space-y-6 overflow-y-auto px-5 py-5">
        {notice && (
          <p role="note" className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning-muted px-3 py-2 text-sm text-foreground">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-warning" aria-hidden="true" />
            {notice}
          </p>
        )}
        {shownErrors.length > 0 && (
          <ul className="space-y-1" aria-label="Points à corriger">
            {shownErrors.map((text) => (
              <li key={text} className="flex items-start gap-1.5 text-sm text-danger">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
                {text}
              </li>
            ))}
          </ul>
        )}

        {notes && toWrite && (
          <div role="note" className="space-y-1 rounded-lg border border-warning/25 bg-warning-muted px-3 py-2 text-sm text-foreground">
            <p className="font-medium">À rédiger</p>
            <ul className="space-y-0.5 text-foreground-secondary">
              {notes.toWrite.map((text) => <li key={text}>{text}</li>)}
            </ul>
          </div>
        )}
        {notes && notes.toReview.length > 0 && (
          <div role="note" className="space-y-1 rounded-lg border border-warning/25 bg-warning-muted px-3 py-2 text-sm text-foreground">
            <p className="font-medium">À relire</p>
            <ul className="space-y-0.5 text-foreground-secondary">
              {notes.toReview.map((text) => <li key={text}>{text.replace(/^À relire\s*:\s*/, '')}</li>)}
            </ul>
          </div>
        )}

        {type === 'profile_visit' && (
          <p className="text-sm text-foreground-secondary">Le candidat est notifié de votre visite. Aucun message.</p>
        )}

        {canHaveVersions(type) && (
          <div className="flex flex-wrap items-center gap-1.5">
            <SegmentedControl
              aria-label="Versions de l’étape"
              variant="quiet"
              value={active.id}
              onValueChange={setActiveId}
              options={versions.map((v) => ({ value: v.id, label: `Version ${v.variantGroup ?? 'A'}` }))}
            />
            {versions.length < MAX_VERSIONS && (
              <Button type="button" variant="ghost" size="icon-sm" aria-label="Ajouter une version" title="Ajouter une version" onClick={addVersion} className="max-md:h-11 max-md:w-11">
                <Plus aria-hidden="true" />
              </Button>
            )}
          </div>
        )}

        {stepHasMessageField(type) && (
          <div className="space-y-4">
            {aiAllowed && (
              <div className="space-y-2">
                <p className="text-sm font-medium text-foreground" id={`${id}-writer`}>Rédaction</p>
                <SegmentedControl<Writer>
                  aria-label="Rédaction"
                  variant="quiet"
                  value={usesAi ? 'ai' : 'manual'}
                  onValueChange={(value) => updateActive({ useAiPersonalization: value === 'ai' })}
                  options={[
                    { value: 'manual', label: 'Je rédige' },
                    { value: 'ai', label: 'L’IA rédige pour chaque candidat' },
                  ]}
                  // Sous 640 px, les deux options l'une sous l'autre, en pleine largeur : le choix reste lisible.
                  className="max-sm:grid max-sm:w-full max-sm:grid-cols-1"
                />
                {usesAi && <p className="text-sm text-foreground-secondary">{AI_WRITES_NOTICE}</p>}
              </div>
            )}
            {usesAi && (
              <Field label="Ton" htmlFor={`${id}-tone`}>
                <Select value={active.aiTone || 'professional'} onValueChange={(value) => updateActive({ aiTone: value as Step['aiTone'] })}>
                  <SelectTrigger id={`${id}-tone`} className={FIELD}><SelectValue /></SelectTrigger>
                  <SelectContent>{MESSAGE_TONES.map((t) => <SelectItem key={t.value} value={t.value}>{t.label}</SelectItem>)}</SelectContent>
                </Select>
              </Field>
            )}
            {type === 'smart_message' && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                {SMART_MESSAGE_INMAIL_HELP}
              </p>
            )}
            {stepNeedsSubject(type) && (
              <Field label={usesAi ? 'Objet (modèle)' : 'Objet *'} htmlFor="subject" error={subjectMissing ? 'Objet requis.' : null}>
                <Input
                  id="subject"
                  value={active.subjectTemplate ?? ''}
                  onChange={(e) => updateActive({ subjectTemplate: e.target.value })}
                  placeholder={type === 'email' ? 'Objet de l’e-mail' : type === 'smart_message' ? 'Objet si le message part en InMail' : 'Objet de l’InMail'}
                  aria-invalid={subjectMissing || undefined}
                  className={cn(FIELD, subjectMissing && 'border-danger')}
                />
              </Field>
            )}
            <Field label={isInvite ? 'Note d’invitation' : usesAi ? 'Modèle du message' : 'Message *'} htmlFor="message" aside={askMenu}>
              <MessageEditor
                id="message"
                value={active.messageTemplate ?? ''}
                onChange={(messageTemplate) => updateActive({ messageTemplate })}
                placeholder={isInvite ? 'Note d’invitation (300 caractères au plus)' : 'Bonjour {{prenom}}, …'}
                rows={isInvite ? 4 : 7}
                maxLength={isInvite ? INVITE_NOTE_MAX : undefined}
                describedBy={isInvite ? `${id}-count ${id}-message-help` : usesAi ? `${id}-message-help` : undefined}
                invalid={isInvite && textLength > INVITE_NOTE_MAX}
                extraKeys={extraKeys}
                // Aide et compteur juste sous le champ, avant « + Variable » et les textes de secours.
                belowField={(isInvite || usesAi) && (
                  <div className="flex items-start justify-between gap-3 text-xs">
                    <p id={`${id}-message-help`} className="text-muted-foreground">
                      {isInvite
                        ? (toWrite ? 'Note à rédiger avant d’enregistrer.' : 'Note facultative. Sans note, l’invitation part seule.')
                        : 'L’IA Konekt s’en sert comme structure pour chaque candidat.'}
                    </p>
                    {isInvite && (
                      <p id={`${id}-count`} className={cn('shrink-0 tabular-nums', textLength > INVITE_NOTE_MAX ? 'font-medium text-danger' : 'text-muted-foreground')}>
                        {textLength} sur {INVITE_NOTE_MAX} caractères
                      </p>
                    )}
                  </div>
                )}
              />
            </Field>
            {shownProposal && (
              <AIProposal
                proposal={shownProposal}
                onDismiss={closeProposal}
                onReplace={({ text, subject }) => {
                  updateActive(subject !== null ? { messageTemplate: text, subjectTemplate: subject } : { messageTemplate: text });
                  closeProposal();
                }}
              />
            )}
            {(!isInvite || !!active.messageTemplate?.trim()) && (
              <MessagePreview
                preview={preview}
                index={previewIndex}
                onIndexChange={onPreviewIndexChange}
                template={active.messageTemplate ?? ''}
                subject={stepNeedsSubject(type) ? active.subjectTemplate ?? '' : null}
                isInvite={isInvite}
                usesAi={usesAi}
              />
            )}
            {active.variantGroup && active.variantGroup !== 'A' && (
              <Button type="button" variant="ghost" size="sm" disabled={removing} onClick={() => onRemove(active.id)} className="text-muted-foreground hover:text-danger max-md:h-11">
                <Trash2 aria-hidden="true" />
                Retirer la version {active.variantGroup}
              </Button>
            )}
            {type === 'email' && <EmailOptions step={primary} onChange={updateShared} />}
          </div>
        )}

        {type === 'check_connection' && (
          <div className="space-y-4">
            <p className="text-sm text-foreground-secondary">Les candidats déjà en relation (1er degré) prennent la branche « Connecté », les autres la branche « Non connecté ».</p>
            <Field label="Si connecté (1er degré), aller à" htmlFor={`${id}-if-true`}>
              <Select value={primary.ifTrueGotoStep || '__next__'} onValueChange={(value) => updateShared({ ifTrueGotoStep: value === '__next__' ? undefined : value })}>
                <SelectTrigger id={`${id}-if-true`} className={FIELD}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__next__">Étape suivante</SelectItem>
                  {optionsWith(primary.ifTrueGotoStep).map((s) => <SelectItem key={s.id} value={s.id}>{optionLabel(s)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
            <Field label="Si non connecté, aller à" htmlFor={`${id}-if-false`}>
              <Select value={primary.ifFalseGotoStep || '__next__'} onValueChange={(value) => updateShared({ ifFalseGotoStep: value === '__next__' ? undefined : value })}>
                <SelectTrigger id={`${id}-if-false`} className={FIELD}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__next__">Étape suivante</SelectItem>
                  {optionsWith(primary.ifFalseGotoStep).map((s) => <SelectItem key={s.id} value={s.id}>{optionLabel(s)}</SelectItem>)}
                </SelectContent>
              </Select>
            </Field>
          </div>
        )}

        {isWaitStep(type) && (
          <div className="space-y-4">
            <Field label="Attendre au plus (jours)" htmlFor={`${id}-timeout`} error={!primary.timeoutDays ? 'Indiquez combien de jours attendre au plus.' : null}>
              <Input
                id={`${id}-timeout`}
                type="number"
                inputMode="numeric"
                min={1}
                placeholder="3"
                value={primary.timeoutDays ?? ''}
                onChange={(e) => { const n = parseInt(e.target.value, 10); updateShared({ timeoutDays: n > 0 ? n : undefined }); }}
                aria-invalid={!primary.timeoutDays || undefined}
                className={cn('w-28', FIELD, !primary.timeoutDays && 'border-danger')}
              />
            </Field>
            <Field label="Si rien ne se passe" htmlFor={`${id}-timeout-action`}>
              <Select value={effectiveTimeoutAction(primary)} onValueChange={(value) => updateShared(timeoutActionUpdate(value))}>
                <SelectTrigger id={`${id}-timeout-action`} className={FIELD}><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="skip">Passer à l’étape suivante</SelectItem>
                  <SelectItem value="alternative_step">Aller à une étape de repli</SelectItem>
                </SelectContent>
              </Select>
            </Field>
            {effectiveTimeoutAction(primary) === 'alternative_step' && (
              <Field
                label="Étape de repli"
                htmlFor={`${id}-fallback`}
                error={backwardTimeout ? 'Cette étape vient avant l’attente : un message déjà envoyé repartirait. Choisissez une étape suivante.' : null}
                help={!primary.timeoutBranchStepId ? 'Choisissez une étape, ou ajoutez-en une dans la branche « Pas acceptée » du fil.' : undefined}
              >
                <Select value={primary.timeoutBranchStepId || '__none__'} onValueChange={(value) => updateShared({ timeoutBranchStepId: value === '__none__' ? undefined : value })}>
                  <SelectTrigger id={`${id}-fallback`} aria-invalid={!primary.timeoutBranchStepId || backwardTimeout || undefined} className={cn(FIELD, (!primary.timeoutBranchStepId || backwardTimeout) && 'border-danger')}>
                    <SelectValue placeholder="Choisir une étape" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">Choisir une étape</SelectItem>
                    {[
                      ...(backwardTimeout ? steps.filter((s) => s.id === primary.timeoutBranchStepId) : []),
                      ...timeoutTargetOptions(primary, steps).filter((s) => primaryOf(steps, s.id)?.id === s.id),
                    ].map((s) => <SelectItem key={s.id} value={s.id}>{optionLabel(s)}</SelectItem>)}
                  </SelectContent>
                </Select>
              </Field>
            )}
          </div>
        )}

        <Collapsible className="border-t border-border pt-4">
          <CollapsibleTrigger className="group flex items-center gap-1.5 rounded-md text-sm font-medium text-foreground transition-colors hover:text-foreground-secondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11">
            <ChevronRight className="h-4 w-4 transition-transform duration-150 group-data-[state=open]:rotate-90 motion-reduce:transition-none" aria-hidden="true" />
            Plus d’options
          </CollapsibleTrigger>
          <CollapsibleContent className="space-y-6 pt-4">
            {primary.order > 0 && (
              <section aria-labelledby={`${id}-delay`} className="space-y-2">
                <h3 id={`${id}-delay`} className="text-sm font-medium text-foreground">Délai</h3>
                <DelayFields value={primary} onChange={updateShared} showWindowHelp={false} />
              </section>
            )}

            <section aria-labelledby={`${id}-window`} className="space-y-2">
              <h3 id={`${id}-window`} className="text-sm font-medium text-foreground">Créneau d’envoi</h3>
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label htmlFor={`${id}-start`} className="text-xs font-normal text-muted-foreground">Pas avant</Label>
                  <Select value={String(primary.preferredHourStart ?? 9)} onValueChange={(value) => updateShared({ preferredHourStart: parseInt(value, 10) })}>
                    <SelectTrigger id={`${id}-start`} className={FIELD}><SelectValue /></SelectTrigger>
                    <SelectContent>{HOURS.map((h) => <SelectItem key={h} value={String(h)}>{h} h</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <Label htmlFor={`${id}-end`} className="text-xs font-normal text-muted-foreground">Pas après</Label>
                  <Select value={String(primary.preferredHourEnd ?? 18)} onValueChange={(value) => updateShared({ preferredHourEnd: parseInt(value, 10) })}>
                    <SelectTrigger id={`${id}-end`} className={FIELD}><SelectValue /></SelectTrigger>
                    <SelectContent>{HOURS.map((h) => <SelectItem key={h} value={String(h)}>{h} h</SelectItem>)}</SelectContent>
                  </Select>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">{SEND_WINDOW_TEXT}</p>
            </section>

            {ACTION_TYPES.has(type) && (
              <section className="space-y-2">
                <Field label="Faire cette étape seulement si" htmlFor={`${id}-condition`}>
                  <Select
                    value={primary.conditionType}
                    onValueChange={(value) => updateShared(
                      // Seuil posé dans la même mise à jour (ancien éditeur).
                      value === 'if_score_above' && !primary.conditionValue?.trim()
                        ? { conditionType: 'if_score_above', conditionValue: '70' }
                        : { conditionType: value as Step['conditionType'] },
                    )}
                  >
                    <SelectTrigger id={`${id}-condition`} className={FIELD}><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {getConditionsForActionType(type, primary.conditionType).map((c) => <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </Field>
                {isCrossChannelCondition(type, primary.conditionType) && (
                  <p className="flex items-start gap-1.5 text-xs text-warning">
                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    Cette condition ne s’applique pas à ce type d’étape.
                  </p>
                )}
                {engagementConditionHint(primary.conditionType) && <p className="text-xs text-muted-foreground">{engagementConditionHint(primary.conditionType)}</p>}
                {retiredConditionNotice(primary.conditionType) && (
                  <p className="flex items-start gap-1.5 text-xs text-warning">
                    <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                    Cette condition n’est plus proposée : {retiredConditionNotice(primary.conditionType)}
                  </p>
                )}
                {primary.conditionType === 'if_score_above' && (
                  <Field label="Seuil de note (0 à 100)" htmlFor={`${id}-score`} error={scoreError}>
                    <Input
                      id={`${id}-score`}
                      type="number"
                      inputMode="numeric"
                      min={0}
                      max={100}
                      placeholder="70"
                      value={primary.conditionValue ?? ''}
                      onChange={(e) => updateShared({ conditionValue: e.target.value })}
                      aria-invalid={scoreError ? true : undefined}
                      className={cn('w-28', FIELD, scoreError && 'border-danger')}
                    />
                  </Field>
                )}
              </section>
            )}

            {!isFork && (
              <Field label="Après cette étape" htmlFor={`${id}-after`}>
                <Select value={afterValue} onValueChange={(value) => onSetAfter(primary.id, value)}>
                  <SelectTrigger id={`${id}-after`} className={FIELD}><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {/* Sans étape qui suive pour le moteur, « Continuer » arrête la séquence : une seule entrée « Terminer la séquence ». */}
                    {continueTo ? (
                      <SelectItem value="continue">Continuer vers l’étape {flow.numbers.get(continueTo) ?? ''}</SelectItem>
                    ) : afterValue === 'continue' ? (
                      <SelectItem value="continue">Terminer la séquence</SelectItem>
                    ) : null}
                    {(continueTo || afterValue !== 'continue') && <SelectItem value="end">Terminer la séquence</SelectItem>}
                    {optionsWith(primary.nextStepId && primary.nextStepId !== '__end__' ? primary.nextStepId : undefined)
                      .filter((s) => s.id !== continueTo || s.id === primary.nextStepId)
                      .map((s) => (
                        <SelectItem key={s.id} value={s.id}>Aller à l’{optionLabel(s).charAt(0).toLowerCase()}{optionLabel(s).slice(1)}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </Field>
            )}

            {versions.length > 1 && (
              <section aria-labelledby={`${id}-split`} className="space-y-2">
                <h3 id={`${id}-split`} className="text-sm font-medium text-foreground">Répartition A/B</h3>
                <div className="flex flex-wrap items-center gap-3">
                  {versions.map((v) => (
                    <div key={v.id} className="flex items-center gap-1.5">
                      <Label htmlFor={`${id}-weight-${v.id}`} className="text-sm font-normal">Version {v.variantGroup}</Label>
                      <Input
                        id={`${id}-weight-${v.id}`}
                        type="number"
                        inputMode="numeric"
                        min={1}
                        max={100}
                        value={v.variantWeight ?? ''}
                        onChange={(e) => { const n = parseInt(e.target.value, 10); onUpdateVersion(v.id, { variantWeight: Number.isFinite(n) ? n : undefined }); }}
                        className={cn('w-20', FIELD)}
                      />
                      <span className="text-sm text-muted-foreground" aria-hidden="true">%</span>
                    </div>
                  ))}
                </div>
                <p className={cn('text-xs', totalWeight === 100 ? 'text-muted-foreground' : 'font-medium text-danger')}>
                  Total : {totalWeight} %{totalWeight !== 100 && ' (doit faire 100 %)'}
                </p>
              </section>
            )}
          </CollapsibleContent>
        </Collapsible>

        <div className="border-t border-border pt-4">
          <Button type="button" variant="ghost" size="sm" disabled={removing} onClick={() => onRemove(primary.id)} className="text-danger hover:text-danger max-md:h-11">
            <Trash2 aria-hidden="true" />
            Supprimer l’étape {number}
          </Button>
        </div>
      </div>
    </div>
  );
}

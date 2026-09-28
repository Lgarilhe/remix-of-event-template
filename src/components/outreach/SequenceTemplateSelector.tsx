import React, { useState, useEffect, useId } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Spinner } from '@/components/ui/spinner';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { EmptyState } from '@/components/layout/EmptyState';
import { ErrorState } from '@/components/layout/ErrorState';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  ArrowLeft,
  Copy,
  FilePlus2,
  FileText,
  LayoutTemplate,
} from 'lucide-react';
import { toast } from 'sonner';
import { sequenceActionLabel } from '@/lib/sequenceCatalog';
import { SequenceActionIcon } from './SequenceBadges';
import { Sequence, SequenceStep } from './SequenceBuilder';
import {
  renumberByOrderGroup,
  templateStepOrders,
  rowToSequenceStep,
  asStopConditions,
  asSenderAccounts,
  STEP_TYPE_LABELS,
  type SequenceStepRow,
} from './sequence/sequenceGraph';

/** Séquence existante proposée à la copie (ligne outreach_sequences et ses étapes). */
interface ExistingSequence {
  id: string;
  name: string;
  /** Organisation propriétaire : la liste montre aussi les séquences d'une autre organisation (équipe de mission). */
  organization_id?: string | null;
  description?: string | null;
  steps: SequenceStepRow[];
  stop_conditions?: unknown;
  sender_accounts?: unknown;
  rotation_mode?: string | null;
  multi_sender_enabled?: boolean | null;
}

interface SequenceTemplateSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectBlank: () => void;
  onSelectTemplate: (sequence: Sequence) => void;
  existingSequences: ExistingSequence[];
}

interface Template {
  id: string;
  name: string;
  description: string | null;
  steps_config: any[];
  category: string | null;
  is_system: boolean;
  created_at: string;
}

// Libellés affichés ; la valeur enregistrée ne change pas.
const TEMPLATE_CATEGORIES = [
  { value: 'sourcing', label: 'Sourcing' },
  { value: 'nurturing', label: 'Entretien du vivier' },
  { value: 'reactivation', label: 'Réactivation' },
  { value: 'custom', label: 'Personnalisé' },
];

const stepCountLabel = (n: number) => `${n} étape${n > 1 ? 's' : ''}`;

/** Nom d'une étape, le même que dans l'éditeur ; jamais la clé technique. */
const stepName = (type: string | null | undefined) => (type && STEP_TYPE_LABELS[type]) || sequenceActionLabel(type);

/** Aperçu d'un déroulé : les icônes du catalogue, lues comme une liste d'étapes. */
function StepsPreview({ types, total }: { types: (string | null | undefined)[]; total: number }) {
  return (
    <span className="mt-2 flex items-center gap-1">
      {types.map((type, i) => (
        <span key={i} className="grid h-5 w-5 place-items-center rounded-sm bg-muted text-foreground-secondary" title={stepName(type)}>
          <SequenceActionIcon type={type} className="h-3 w-3" />
          <span className="sr-only">{stepName(type)}</span>
        </span>
      ))}
      <span className="ml-1 text-2xs text-muted-foreground">{stepCountLabel(total)}</span>
    </span>
  );
}

function ChoiceButton({ icon: Icon, title, description, onClick }: { icon: React.ElementType; title: string; description: string; onClick: () => void }) {
  return (
    <Button
      type="button"
      variant="outline"
      onClick={onClick}
      className="h-auto w-full justify-start gap-4 whitespace-normal p-4 text-left font-normal"
    >
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-muted text-foreground-secondary">
        <Icon className="h-5 w-5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{description}</span>
      </span>
    </Button>
  );
}

export const SequenceTemplateSelector: React.FC<SequenceTemplateSelectorProps> = ({
  isOpen,
  onClose,
  onSelectBlank,
  onSelectTemplate,
  existingSequences,
}) => {
  const { organizationId } = useOrganization();
  const [step, setStep] = useState<'choice' | 'templates' | 'duplicate'>('choice');
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(false);
  // Échec de chargement distinct d'une liste vide : sinon une coupure réseau
  // faisait croire que les modèles avaient disparu.
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setStep('choice');
    }
  }, [isOpen]);

  const fetchTemplates = async () => {
    setLoading(true);
    setLoadError(false);
    try {
      const { data, error } = await (supabase
        .from('sequence_templates') as any)
        .select('*')
        .order('is_system', { ascending: false })
        .order('name');
      if (error) throw error;
      setTemplates(data || []);
    } catch (err) {
      console.error('Error fetching templates:', err);
      setTemplates([]);
      setLoadError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleSelectTemplate = (template: Template) => {
    // Remap des ids : chaque step reçoit un nouvel uuid, donc les refs de
    // branchement (nextStepId, if_true/false, timeout_branch) qui pointaient
    // vers les ANCIENS ids du template doivent être traduites — sinon elles
    // sont pendantes et silencieusement nullées au save → routage
    // « automatique » inattendu (audit 2026-07, Builder H4).
    const idMap = new Map<string, string>();
    for (const s of (template.steps_config || []) as any[]) {
      const oldId = s.id;
      if (oldId) idMap.set(String(oldId), crypto.randomUUID());
    }
    const remap = (ref: unknown): string | undefined => {
      if (!ref) return undefined;
      if (ref === '__end__') return '__end__';
      return idMap.get(String(ref)); // ref inconnue → undefined (purge propre)
    };

    // Ordre enregistré dans le modèle : les variantes A/B d'une étape le
    // partagent. Un ancien modèle sans step_order est relu par position, ses
    // variantes voisines regroupées sur un même ordre (templateStepOrders).
    const orders = templateStepOrders(template.steps_config || []);
    const steps: SequenceStep[] = (template.steps_config || []).map((s: any, idx: number) => ({
      id: (s.id && idMap.get(String(s.id))) || crypto.randomUUID(),
      order: orders[idx],
      actionType: s.action_type || s.actionType || 'message',
      conditionType: s.condition_type || s.conditionType || 'always',
      conditionValue: s.condition_value || s.conditionValue,
      delayDays: s.delay_days ?? s.delayDays ?? (idx === 0 ? 0 : 2),
      delayHours: s.delay_hours ?? s.delayHours ?? 0,
      delayMinutes: s.delay_minutes ?? s.delayMinutes ?? 0,
      preferredHourStart: s.preferred_hour_start ?? s.preferredHourStart ?? 9,
      preferredHourEnd: s.preferred_hour_end ?? s.preferredHourEnd ?? 18,
      subjectTemplate: s.subject_template || s.subjectTemplate || '',
      messageTemplate: s.message_template || s.messageTemplate || '',
      useAiPersonalization: s.use_ai_personalization ?? s.useAiPersonalization ?? false,
      aiTone: s.ai_tone || s.aiTone || 'professional',
      timeoutDays: s.timeout_days ?? s.timeoutDays ?? 3,
      waitForEvent: s.wait_for_event || s.waitForEvent,
      // Seule l'étape de repli est enregistrée : c'est elle qui dit ce que fera le moteur.
      timeoutAction: remap(s.timeout_branch_step_id || s.timeoutBranchStepId) ? 'alternative_step' : 'skip',
      ifTrueGotoStep: remap(s.if_true_goto_step || s.ifTrueGotoStep),
      ifFalseGotoStep: remap(s.if_false_goto_step || s.ifFalseGotoStep),
      nextStepId: s.ends_sequence ? '__end__' : remap(s.next_step_id || s.nextStepId),
      timeoutBranchStepId: remap(s.timeout_branch_step_id || s.timeoutBranchStepId),
      variantGroup: s.variant_group || s.variantGroup,
      variantWeight: s.variant_weight ?? s.variantWeight,
      ccEmails: s.cc_emails || s.ccEmails,
      bccEmails: s.bcc_emails || s.bccEmails,
      includeUnsubscribe: s.include_unsubscribe ?? s.includeUnsubscribe,
      signatureId: s.signature_id || s.signatureId,
    }));

    const sequence: Sequence = {
      name: template.name,
      description: template.description || undefined,
      steps: renumberByOrderGroup(steps),
      isActive: true,
    };

    onSelectTemplate(sequence);
  };

  // Copie complète : branches, variantes, conditions, fin de séquence, options
  // e-mail et réglages d'envoi. Les ids d'étapes d'origine sont gardés comme ids
  // provisoires : la séquence copiée n'ayant pas d'id, save_sequence_steps
  // insère de nouvelles étapes et remappe elle-même tous les renvois. Avant, la
  // copie perdait tout routage et chaque candidat recevait toutes les branches.
  const handleDuplicate = (seq: ExistingSequence) => {
    const steps: SequenceStep[] = renumberByOrderGroup((seq.steps || []).map(rowToSequenceStep));
    // Les expéditeurs d'une autre organisation ne sont pas reliés à la nôtre :
    // le moteur les écarte tous et la rotation n'aurait aucun compte. On ne
    // recopie la rotation que depuis une séquence de notre organisation.
    const sameOrganization = !!organizationId && seq.organization_id === organizationId;

    const sequence: Sequence = {
      name: `Copie de ${seq.name}`,
      description: seq.description || undefined,
      steps,
      isActive: true,
      stopConditions: asStopConditions(seq.stop_conditions),
      senderAccounts: sameOrganization ? asSenderAccounts(seq.sender_accounts) : [],
      rotationMode: seq.rotation_mode || 'round_robin',
      multiSenderEnabled: sameOrganization && !!seq.multi_sender_enabled,
    };

    onSelectTemplate(sequence);
  };

  const title = step === 'choice' ? 'Nouvelle séquence' : step === 'templates' ? 'Choisir un modèle' : 'Dupliquer une séquence';

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="flex max-h-[85vh] w-[calc(100%-1rem)] max-w-lg flex-col overflow-hidden sm:w-full">
        <DialogHeader>
          <div className="flex items-center gap-2 pr-8">
            {step !== 'choice' && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    onClick={() => setStep('choice')}
                    aria-label="Retour au choix de départ"
                    className="-ml-2 max-md:h-11 max-md:w-11"
                  >
                    <ArrowLeft aria-hidden="true" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>Retour</TooltipContent>
              </Tooltip>
            )}
            <DialogTitle>{title}</DialogTitle>
          </div>
          {step === 'choice' && <DialogDescription>Comment voulez-vous commencer ?</DialogDescription>}
        </DialogHeader>

        <div className="-mx-1 flex-1 overflow-y-auto px-1 py-1">
          {step === 'choice' && (
            <div className="grid grid-cols-1 gap-3">
              <ChoiceButton
                icon={FilePlus2}
                title="Partir de zéro"
                description="Une séquence vide, à laquelle vous ajoutez vos étapes."
                onClick={onSelectBlank}
              />
              <ChoiceButton
                icon={LayoutTemplate}
                title="Depuis un modèle"
                description="Un déroulé prêt à l'emploi, à adapter à la mission."
                onClick={() => { setStep('templates'); void fetchTemplates(); }}
              />
              <ChoiceButton
                icon={Copy}
                title="Dupliquer une existante"
                description="Une copie d'une séquence existante comme point de départ."
                onClick={() => setStep('duplicate')}
              />
            </div>
          )}

          {step === 'templates' && (
            <div className="space-y-3">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <Spinner label="Chargement des modèles" />
                </div>
              ) : loadError ? (
                <ErrorState
                  variant="compact"
                  title="Impossible de charger les modèles."
                  description="Vérifiez votre connexion, puis réessayez."
                  onRetry={() => { void fetchTemplates(); }}
                />
              ) : templates.length === 0 ? (
                <EmptyState
                  variant="compact"
                  icon={FileText}
                  title="Aucun modèle disponible"
                  description="Enregistrez une séquence comme modèle depuis son menu d'actions : elle apparaîtra ici."
                />
              ) : (
                templates.map(template => {
                  const cat = TEMPLATE_CATEGORIES.find(c => c.value === template.category);
                  const stepsConfig = template.steps_config || [];
                  return (
                    <Button
                      key={template.id}
                      type="button"
                      variant="outline"
                      onClick={() => handleSelectTemplate(template)}
                      className="h-auto w-full flex-col items-start gap-0 whitespace-normal p-4 text-left font-normal"
                    >
                      <span className="flex w-full flex-wrap items-center gap-2">
                        <span className="min-w-0 truncate text-sm font-semibold text-foreground">{template.name}</span>
                        {template.is_system && <Badge variant="muted">Modèle Konekt</Badge>}
                        {cat && <Badge variant="outline">{cat.label}</Badge>}
                      </span>
                      {template.description && (
                        <span className="mt-1 line-clamp-2 text-xs text-muted-foreground">{template.description}</span>
                      )}
                      <StepsPreview
                        types={stepsConfig.slice(0, 6).map((s: { action_type?: string; actionType?: string }) => s.action_type || s.actionType)}
                        total={stepsConfig.length}
                      />
                    </Button>
                  );
                })
              )}
            </div>
          )}

          {step === 'duplicate' && (
            <div className="space-y-3">
              {existingSequences.length === 0 ? (
                <EmptyState
                  variant="compact"
                  icon={Copy}
                  title="Aucune séquence à dupliquer"
                  description="Les séquences de la mission apparaîtront ici."
                />
              ) : (
                existingSequences.map(seq => (
                  <Button
                    key={seq.id}
                    type="button"
                    variant="outline"
                    onClick={() => handleDuplicate(seq)}
                    className="h-auto w-full flex-col items-start gap-0 whitespace-normal p-4 text-left font-normal"
                  >
                    <span className="text-sm font-semibold text-foreground">{seq.name}</span>
                    <StepsPreview types={(seq.steps || []).slice(0, 6).map(s => s.action_type)} total={(seq.steps || []).length} />
                  </Button>
                ))
              )}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};

// ── Save as Template Modal ──

interface SaveAsTemplateModalProps {
  isOpen: boolean;
  onClose: () => void;
  sequenceId: string;
  sequenceName: string;
  /** Ignoré : les étapes sont relues en base à l'enregistrement (celles de la liste peuvent manquer ou dater). */
  steps?: unknown[];
}

export const SaveAsTemplateModal: React.FC<SaveAsTemplateModalProps> = ({
  isOpen,
  onClose,
  sequenceId,
  sequenceName,
}) => {
  const { organizationId } = useOrganization();
  const [name, setName] = useState(sequenceName);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('custom');
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState(false);
  const id = useId();

  useEffect(() => {
    if (isOpen) {
      setName(sequenceName);
      setDescription('');
      setCategory('custom');
      setNameError(false);
    }
  }, [isOpen, sequenceName]);

  const handleSave = async () => {
    if (!name.trim()) {
      setNameError(true);
      return;
    }
    if (!organizationId) {
      toast.error('Le modèle n’a pas pu être enregistré', { description: "L'organisation n'est pas encore chargée : réessayez dans un instant." });
      return;
    }
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');

      // Étapes relues en base, comme à l'ouverture de l'éditeur : celles de la
      // liste valent [] quand leur lecture a échoué, ou datent de l'arrivée sur
      // la page. Un modèle sans étape n'est jamais enregistré.
      const { data: steps, error: stepsError } = await supabase
        .from('sequence_steps')
        .select('*')
        .eq('sequence_id', sequenceId)
        .order('step_order', { ascending: true })
        .order('id', { ascending: true });
      if (stepsError) throw stepsError;
      if (!steps || steps.length === 0) {
        toast.error('Le modèle n’a pas été enregistré', { description: 'Cette séquence n’a aucune étape à reprendre.' });
        return;
      }

      // Serialize steps to steps_config — inclut id + refs de branchement +
      // variantes + options email. Avant, un template créé depuis une séquence
      // branchée perdait toute sa structure (branches, A/B, condition_value)
      // — audit 2026-07, Builder H4. Les ids sont remappés vers de nouveaux
      // uuids à l'instanciation (handleSelectTemplate). step_order garde les
      // variantes A/B sur le même ordre ; ends_sequence garde « Fin de séquence ».
      // L'étape de repli (timeout_branch_step_id) est la seule suite au délai
      // dépassé qui soit enregistrée.
      const stepsConfig = steps.map((s) => ({
        id: s.id,
        step_order: s.step_order,
        action_type: s.action_type,
        condition_type: s.condition_type,
        condition_value: s.condition_value ?? null,
        delay_days: s.delay_days,
        delay_hours: s.delay_hours,
        delay_minutes: s.delay_minutes,
        preferred_hour_start: s.preferred_hour_start,
        preferred_hour_end: s.preferred_hour_end,
        subject_template: s.subject_template,
        message_template: s.message_template,
        use_ai_personalization: s.use_ai_personalization,
        ai_tone: s.ai_tone,
        timeout_days: s.timeout_days,
        wait_for_event: s.wait_for_event,
        ends_sequence: s.ends_sequence ?? false,
        next_step_id: s.next_step_id ?? null,
        if_true_goto_step: s.if_true_goto_step ?? null,
        if_false_goto_step: s.if_false_goto_step ?? null,
        timeout_branch_step_id: s.timeout_branch_step_id ?? null,
        variant_group: s.variant_group ?? null,
        variant_weight: s.variant_weight ?? null,
        cc_emails: s.cc_emails ?? null,
        bcc_emails: s.bcc_emails ?? null,
        include_unsubscribe: s.include_unsubscribe ?? null,
        signature_id: s.signature_id ?? null,
      }));

      const { data: inserted, error } = await (supabase
        .from('sequence_templates') as any)
        .insert({
          organization_id: organizationId,
          name,
          description: description || null,
          steps_config: stepsConfig,
          category,
          is_system: false,
          created_by: user.id,
        })
        .select('id');

      if (error) throw error;
      if (!inserted || inserted.length === 0) throw new Error('Modèle non enregistré');
      toast.success('Modèle enregistré', {
        description: `« ${name.trim()} » est proposé dans « Nouvelle séquence », depuis un modèle.`,
      });
      onClose();
    } catch (err) {
      console.error('Error saving template:', err);
      toast.error('Le modèle n’a pas pu être enregistré', { description: 'Réessayez dans un instant.' });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Enregistrer comme modèle</DialogTitle>
          <DialogDescription>Le modèle reprend les étapes de « {sequenceName} ».</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <Label htmlFor={`${id}-name`}>Nom du modèle *</Label>
            <Input
              id={`${id}-name`}
              required
              value={name}
              onChange={(e) => { setName(e.target.value); if (e.target.value.trim()) setNameError(false); }}
              aria-invalid={nameError ? true : undefined}
              aria-describedby={nameError ? `${id}-name-error` : undefined}
              className="mt-1.5"
            />
            {nameError && <p id={`${id}-name-error`} className="mt-1 text-xs text-danger">Donnez un nom au modèle.</p>}
          </div>
          <div>
            <Label htmlFor={`${id}-description`}>Description (facultative)</Label>
            <Textarea id={`${id}-description`} value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="mt-1.5" placeholder="À quoi sert ce modèle ?" />
          </div>
          <div>
            <Label htmlFor={`${id}-category`}>Catégorie</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger id={`${id}-category`} className="mt-1.5">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {TEMPLATE_CATEGORIES.map(c => (
                  <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={onClose}>Annuler</Button>
          <Button type="button" variant="primary" onClick={handleSave} loading={saving}>
            {saving ? 'Enregistrement…' : 'Enregistrer'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

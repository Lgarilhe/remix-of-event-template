import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Plus,
  FileText,
  Copy,
  Sparkles,
  Mail,
  UserPlus,
  MessageSquare,
  Eye,
  ArrowLeft,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Sequence, SequenceStep } from './SequenceBuilder';

interface SequenceTemplateSelectorProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectBlank: () => void;
  onSelectTemplate: (sequence: Sequence) => void;
  existingSequences: { id: string; name: string; steps: any[] }[];
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

const TEMPLATE_CATEGORIES = [
  { value: 'sourcing', label: 'Sourcing', emoji: '🎯' },
  { value: 'nurturing', label: 'Nurturing', emoji: '🌱' },
  { value: 'reactivation', label: 'Réactivation', emoji: '🔄' },
  { value: 'custom', label: 'Personnalisé', emoji: '⚙️' },
];

const ACTION_ICONS: Record<string, React.ReactNode> = {
  connection_request: <UserPlus className="w-3 h-3" />,
  inmail: <Mail className="w-3 h-3" />,
  message: <MessageSquare className="w-3 h-3" />,
  smart_message: <Sparkles className="w-3 h-3" />,
  profile_visit: <Eye className="w-3 h-3" />,
  email: <Mail className="w-3 h-3" />,
};

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

  useEffect(() => {
    if (isOpen) {
      setStep('choice');
    }
  }, [isOpen]);

  const fetchTemplates = async () => {
    setLoading(true);
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

    const steps: SequenceStep[] = (template.steps_config || []).map((s: any, idx: number) => ({
      id: (s.id && idMap.get(String(s.id))) || crypto.randomUUID(),
      order: idx,
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
      timeoutAction: s.timeout_action || s.timeoutAction || 'skip',
      ifTrueGotoStep: remap(s.if_true_goto_step || s.ifTrueGotoStep),
      ifFalseGotoStep: remap(s.if_false_goto_step || s.ifFalseGotoStep),
      nextStepId: remap(s.next_step_id || s.nextStepId),
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
      steps,
      isActive: true,
    };

    onSelectTemplate(sequence);
  };

  const handleDuplicate = (seq: { id: string; name: string; steps: any[] }) => {
    const steps: SequenceStep[] = (seq.steps || []).map((s: any, idx: number) => ({
      id: crypto.randomUUID(),
      order: idx,
      actionType: s.action_type || 'message',
      conditionType: s.condition_type || 'always',
      delayDays: s.delay_days ?? (idx === 0 ? 0 : 2),
      delayHours: s.delay_hours ?? 0,
      delayMinutes: s.delay_minutes ?? 0,
      preferredHourStart: s.preferred_hour_start ?? 9,
      preferredHourEnd: s.preferred_hour_end ?? 18,
      subjectTemplate: s.subject_template || '',
      messageTemplate: s.message_template || '',
      useAiPersonalization: s.use_ai_personalization ?? false,
      aiTone: s.ai_tone || 'professional',
      timeoutDays: s.timeout_days ?? 3,
      waitForEvent: s.wait_for_event,
      timeoutAction: 'skip',
    }));

    const sequence: Sequence = {
      name: `Copie de ${seq.name}`,
      steps,
      isActive: true,
    };

    onSelectTemplate(sequence);
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-hidden flex flex-col bg-background border-border rounded-lg w-[calc(100%-1rem)] sm:w-full">
        <DialogHeader>
          <DialogTitle className="uppercase tracking-wide text-sm flex items-center gap-2">
            {step !== 'choice' && (
              <button onClick={() => setStep('choice')} className="p-1 hover:bg-muted">
                <ArrowLeft className="w-4 h-4" />
              </button>
            )}
            {step === 'choice' && 'Nouvelle séquence'}
            {step === 'templates' && 'Choisir un template'}
            {step === 'duplicate' && 'Dupliquer une séquence'}
          </DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto py-4">
          {step === 'choice' && (
            <div className="grid grid-cols-1 gap-3">
              <button
                onClick={onSelectBlank}
                className="flex items-start gap-4 p-4 border border-border hover:bg-muted/30 transition-colors text-left group"
              >
                <div className="w-10 h-10 bg-foreground text-background flex items-center justify-center text-lg shrink-0">
                  🆕
                </div>
                <div>
                  <p className="font-bold text-sm text-foreground">Partir de zéro</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Créer une séquence vide et ajouter vos étapes manuellement</p>
                </div>
              </button>
              <button
                onClick={() => { setStep('templates'); fetchTemplates(); }}
                className="flex items-start gap-4 p-4 border border-border hover:bg-muted/30 transition-colors text-left group"
              >
                <div className="w-10 h-10 bg-foreground text-background flex items-center justify-center text-lg shrink-0">
                  📋
                </div>
                <div>
                  <p className="font-bold text-sm text-foreground">Depuis un template</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Utiliser un modèle prédéfini et l'adapter à votre besoin</p>
                </div>
              </button>
              <button
                onClick={() => setStep('duplicate')}
                className="flex items-start gap-4 p-4 border border-border hover:bg-muted/30 transition-colors text-left group"
              >
                <div className="w-10 h-10 bg-foreground text-background flex items-center justify-center text-lg shrink-0">
                  🔄
                </div>
                <div>
                  <p className="font-bold text-sm text-foreground">Dupliquer une existante</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Copier une séquence existante comme point de départ</p>
                </div>
              </button>
            </div>
          )}

          {step === 'templates' && (
            <div className="space-y-3">
              {loading ? (
                <div className="flex items-center justify-center py-12">
                  <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-border" />
                </div>
              ) : templates.length === 0 ? (
                <div className="text-center py-12">
                  <FileText className="w-10 h-10 text-muted-foreground mx-auto mb-3" />
                  <p className="text-sm text-muted-foreground">Aucun template disponible</p>
                  <p className="text-xs text-muted-foreground mt-1">Sauvegardez une séquence comme template pour la retrouver ici</p>
                </div>
              ) : (
                templates.map(template => {
                  const cat = TEMPLATE_CATEGORIES.find(c => c.value === template.category);
                  const stepsPreview = (template.steps_config || []).slice(0, 6);
                  return (
                    <button
                      key={template.id}
                      onClick={() => handleSelectTemplate(template)}
                      className="w-full text-left p-4 border border-border hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <p className="font-bold text-sm text-foreground truncate">{template.name}</p>
                            {template.is_system && (
                              <Badge className="text-3xs bg-primary/10 text-primary border-primary/30 rounded-full">Konekt</Badge>
                            )}
                            {cat && (
                              <Badge variant="outline" className="text-3xs rounded-full border-border">
                                {cat.emoji} {cat.label}
                              </Badge>
                            )}
                          </div>
                          {template.description && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{template.description}</p>
                          )}
                          <div className="flex items-center gap-1 mt-2">
                            {stepsPreview.map((s: any, i: number) => (
                              <div key={i} className="w-5 h-5 bg-muted flex items-center justify-center" title={s.action_type || s.actionType}>
                                {ACTION_ICONS[s.action_type || s.actionType] || <MessageSquare className="w-3 h-3" />}
                              </div>
                            ))}
                            <span className="text-3xs text-muted-foreground ml-1">
                              {(template.steps_config || []).length} étapes
                            </span>
                          </div>
                        </div>
                      </div>
                    </button>
                  );
                })
              )}
            </div>
          )}

          {step === 'duplicate' && (
            <div className="space-y-3">
              {existingSequences.length === 0 ? (
                <div className="text-center py-12">
                  <p className="text-sm text-muted-foreground">Aucune séquence existante à dupliquer</p>
                </div>
              ) : (
                existingSequences.map(seq => (
                  <button
                    key={seq.id}
                    onClick={() => handleDuplicate(seq)}
                    className="w-full text-left p-4 border border-border hover:bg-muted/30 transition-colors"
                  >
                    <p className="font-bold text-sm text-foreground">{seq.name}</p>
                    <div className="flex items-center gap-1 mt-2">
                      {seq.steps.slice(0, 6).map((s: any, i: number) => (
                        <div key={i} className="w-5 h-5 bg-muted flex items-center justify-center">
                          {ACTION_ICONS[s.action_type] || <MessageSquare className="w-3 h-3" />}
                        </div>
                      ))}
                      <span className="text-3xs text-muted-foreground ml-1">
                        {seq.steps.length} étapes
                      </span>
                    </div>
                  </button>
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
  steps: any[];
}

export const SaveAsTemplateModal: React.FC<SaveAsTemplateModalProps> = ({
  isOpen,
  onClose,
  sequenceId,
  sequenceName,
  steps,
}) => {
  const { organizationId } = useOrganization();
  const [name, setName] = useState(sequenceName);
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('custom');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setName(sequenceName);
      setDescription('');
      setCategory('custom');
    }
  }, [isOpen, sequenceName]);

  const handleSave = async () => {
    if (!name.trim() || !organizationId) return;
    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');

      // Serialize steps to steps_config — inclut id + refs de branchement +
      // variantes + options email. Avant, un template créé depuis une séquence
      // branchée perdait toute sa structure (branches, A/B, condition_value,
      // timeout_action) — audit 2026-07, Builder H4. Les ids sont remappés
      // vers de nouveaux uuids à l'instanciation (handleSelectTemplate).
      const stepsConfig = steps.map((s: any) => ({
        id: s.id,
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
        timeout_action: s.timeout_action ?? null,
        wait_for_event: s.wait_for_event,
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

      const { error } = await (supabase
        .from('sequence_templates') as any)
        .insert({
          organization_id: organizationId,
          name,
          description: description || null,
          steps_config: stepsConfig,
          category,
          is_system: false,
          created_by: user.id,
        });

      if (error) throw error;
      toast.success('Template sauvegardé !');
      onClose();
    } catch (err) {
      console.error('Error saving template:', err);
      toast.error('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="bg-background border-border rounded-lg max-w-md">
        <DialogHeader>
          <DialogTitle className="uppercase tracking-wide text-sm">Sauvegarder comme template</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div>
            <Label>Nom du template *</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} className="mt-1.5 border-border rounded-lg" />
          </div>
          <div>
            <Label>Description</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={3} className="mt-1.5 border-border rounded-lg" placeholder="Décrivez l'usage de ce template..." />
          </div>
          <div>
            <Label>Catégorie</Label>
            <Select value={category} onValueChange={setCategory}>
              <SelectTrigger className="mt-1.5 border-border rounded-lg">
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="bg-background border-border rounded-lg">
                {TEMPLATE_CATEGORIES.map(c => (
                  <SelectItem key={c.value} value={c.value}>{c.emoji} {c.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="outline" onClick={onClose} className="border-border rounded-lg">Annuler</Button>
          <Button onClick={handleSave} disabled={saving || !name.trim()} className="bg-foreground text-background rounded-lg">
            {saving ? 'Sauvegarde...' : 'Sauvegarder'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

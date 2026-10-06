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
import { toast } from 'sonner';
import { TEMPLATE_CATEGORIES } from './sequence/sequenceGraph';

// « Enregistrer comme modèle » : sorti de SequenceTemplateSelector.tsx au lot
// 5c-1. Gardé après le lot 5j (menu « … » de la page séquence et liste).

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

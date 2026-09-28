import React, { useState, useEffect, useId } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { sequenceActionLabel } from '@/lib/sequenceCatalog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';
import { sequenceWriteRefusal } from '@/lib/sequenceErrorMessages';

interface EditScheduledMessageModalProps {
  isOpen: boolean;
  onClose: () => void;
  execution: {
    id: string;
    scheduled_at: string;
    final_subject: string | null;
    final_message: string | null;
    step?: {
      action_type: string;
      message_template: string | null;
      subject_template: string | null;
    };
    enrollment?: {
      profile_name: string | null;
    };
    /** Texte affiché dans le Journal (modification, aperçu validé à l'inscription ou modèle). */
    preview?: {
      message: string | null;
      subject: string | null;
    };
  } | null;
  onSaved: () => void;
}

export const EditScheduledMessageModal: React.FC<EditScheduledMessageModalProps> = ({
  isOpen,
  onClose,
  execution,
  onSaved,
}) => {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const subjectId = useId();
  const messageId = useId();
  const helpId = useId();

  const actionType = execution?.step?.action_type;
  // Un e-mail a un objet comme un InMail : sans ce champ, l'enregistrement
  // écrivait final_subject = null et l'objet personnalisé était perdu.
  const needsSubject = actionType === 'inmail' || actionType === 'email';

  useEffect(() => {
    if (execution) {
      // Même valeur que celle affichée dans le Journal : on corrige le message
      // qui partira, pas le modèle de l'étape.
      setSubject(
        execution.final_subject || execution.preview?.subject || execution.step?.subject_template || '',
      );
      setMessage(
        execution.final_message || execution.preview?.message || execution.step?.message_template || '',
      );
    }
  }, [execution]);

  const handleSave = async () => {
    if (!execution) return;

    if (!message.trim()) {
      toast.error('Le message ne peut pas être vide');
      return;
    }

    if (needsSubject && !subject.trim()) {
      toast.error("L'objet ne peut pas être vide pour un InMail ou un e-mail");
      return;
    }

    setSaving(true);
    try {
      // Garde anti-race : on ne met à jour QUE si l'exécution est encore
      // 'scheduled'. Si le moteur l'a déjà passée en 'sending'/'sent' pendant
      // que le modal était ouvert, l'UPDATE n'affecte 0 ligne → on prévient
      // l'user au lieu de falsifier silencieusement un message déjà parti.
      const { data: updated, error } = await supabase
        .from('sequence_step_executions')
        .update({
          final_subject: needsSubject ? subject.trim() : null,
          final_message: message.trim(),
        })
        .eq('id', execution.id)
        .eq('status', 'scheduled')
        .select('id');

      if (error) throw error;

      if (!updated || updated.length === 0) {
        toast.error("Ce message est déjà en cours d'envoi ou envoyé : modification impossible.");
        onSaved();
        onClose();
        return;
      }

      toast.success('Message mis à jour', { description: 'La nouvelle version partira à l’heure prévue.' });
      onSaved();
      onClose();
    } catch (err) {
      console.error('Error updating message:', err);
      // Refus de la base (étape déjà partie, plus programmée…) : sa raison en
      // français plutôt qu'un « réessayez » qui échouerait encore.
      toast.error(sequenceWriteRefusal(err) ?? "La modification n'a pas été enregistrée. Réessayez.");
    } finally {
      setSaving(false);
    }
  };

  if (!execution) return null;

  const scheduledAt = new Date(execution.scheduled_at);

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Modifier le message planifié</DialogTitle>
          <DialogDescription>
            {sequenceActionLabel(actionType)} · envoi prévu pour {execution.enrollment?.profile_name || 'le candidat'} le{' '}
            {format(scheduledAt, 'EEEE d MMMM', { locale: fr })} à {format(scheduledAt, 'HH:mm')}.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {/* Objet (InMail et e-mail) */}
          {needsSubject && (
            <div className="space-y-2">
              <Label htmlFor={subjectId}>Objet</Label>
              <Input
                id={subjectId}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Ex. : Lead Backend Go chez Nova Pay"
              />
            </div>
          )}

          {/* Message */}
          <div className="space-y-2">
            <Label htmlFor={messageId}>Message</Label>
            <Textarea
              id={messageId}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              aria-describedby={helpId}
              rows={8}
              className="resize-none"
            />
            <p id={helpId} className="text-xs text-muted-foreground">
              Les variables comme {'{{first_name}}'} ou {'{{prenom}}'} sont remplacées à l'envoi.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button variant="primary" onClick={handleSave} loading={saving}>
            Enregistrer le message
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

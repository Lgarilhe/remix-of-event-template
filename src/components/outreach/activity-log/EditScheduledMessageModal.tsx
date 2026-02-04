import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Save, Loader2, Calendar, Clock as ClockIcon } from 'lucide-react';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { toast } from 'sonner';

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

  const actionType = execution?.step?.action_type;
  const needsSubject = actionType === 'inmail';

  useEffect(() => {
    if (execution) {
      setSubject(execution.final_subject || execution.step?.subject_template || '');
      setMessage(execution.final_message || execution.step?.message_template || '');
    }
  }, [execution]);

  const handleSave = async () => {
    if (!execution) return;
    
    if (!message.trim()) {
      toast.error('Le message ne peut pas être vide');
      return;
    }

    if (needsSubject && !subject.trim()) {
      toast.error("L'objet ne peut pas être vide pour un InMail");
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase
        .from('sequence_step_executions')
        .update({
          final_subject: needsSubject ? subject.trim() : null,
          final_message: message.trim(),
        })
        .eq('id', execution.id);

      if (error) throw error;

      toast.success('Message mis à jour');
      onSaved();
      onClose();
    } catch (err) {
      console.error('Error updating message:', err);
      toast.error('Erreur lors de la mise à jour');
    } finally {
      setSaving(false);
    }
  };

  if (!execution) return null;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[550px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Save className="w-5 h-5 text-blue-600" />
            Modifier le message planifié
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* Recipient info */}
          <div className="p-3 bg-muted/50 rounded-lg">
            <div className="text-sm font-medium">
              {execution.enrollment?.profile_name || 'Candidat'}
            </div>
            <div className="flex items-center gap-3 text-xs text-muted-foreground mt-1">
              <div className="flex items-center gap-1">
                <Calendar className="w-3 h-3" />
                <span>{format(new Date(execution.scheduled_at), 'EEEE d MMMM', { locale: fr })}</span>
              </div>
              <div className="flex items-center gap-1">
                <ClockIcon className="w-3 h-3" />
                <span>{format(new Date(execution.scheduled_at), 'HH:mm')}</span>
              </div>
            </div>
          </div>

          {/* Subject (for InMail) */}
          {needsSubject && (
            <div className="space-y-2">
              <Label htmlFor="subject">Objet</Label>
              <Input
                id="subject"
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
                placeholder="Objet de l'InMail..."
              />
            </div>
          )}

          {/* Message */}
          <div className="space-y-2">
            <Label htmlFor="message">Message</Label>
            <Textarea
              id="message"
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Contenu du message..."
              rows={8}
              className="resize-none"
            />
            <p className="text-xs text-muted-foreground">
              Les variables comme {'{firstName}'} seront remplacées automatiquement.
            </p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Annuler
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <>
                <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                Enregistrement...
              </>
            ) : (
              <>
                <Save className="w-4 h-4 mr-2" />
                Enregistrer
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

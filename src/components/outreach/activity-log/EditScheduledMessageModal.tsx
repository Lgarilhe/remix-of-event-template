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
import { Sparkles } from 'lucide-react';
import { sequenceWriteRefusal } from '@/lib/sequenceErrorMessages';
import { plural } from '@/lib/plural';
import { useSenderFirstName } from '@/hooks/useEnrollmentPreview';
import { useWritingPreferences } from '@/hooks/useWritingPreferences';
import { WritingSettingsLine, type WritingSettingsValue } from '@/components/ai/WritingSettingsLine';
import { DEFAULT_AI_LEVEL, clampLevel, levelCredits, writingRefusalMessage } from '@/lib/writingStyle';
import { proposeAiMessage } from './proposeAiMessage';

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
  /**
   * Lot 5a-2 : « Relire le message » d'une étape rédigée par l'IA reportée
   * par le moteur. Prérempli avec le modèle de l'étape, « Proposer avec
   * l'IA » (coût annoncé, résultat modifiable) ; « Enregistrer » n'écrit que
   * final_message et final_subject d'une étape encore programmée, et le
   * moteur l'envoie au premier passage, au plus une heure plus tard.
   */
  aiReview?: boolean;
}

export const EditScheduledMessageModal: React.FC<EditScheduledMessageModalProps> = ({
  isOpen,
  onClose,
  execution,
  onSaved,
  aiReview = false,
}) => {
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [saving, setSaving] = useState(false);
  const [proposing, setProposing] = useState(false);
  const subjectId = useId();
  const messageId = useId();
  const helpId = useId();
  const senderName = useSenderFirstName();
  // Lot 5e-2 : style et niveau de « Proposer avec l'IA », pour cette proposition seulement.
  const { prefs: writingPrefs, choices: writingChoices, refetch: refetchWritingPrefs } = useWritingPreferences();
  const [writingOverride, setWritingOverride] = useState<WritingSettingsValue | null>(null);
  const writing: WritingSettingsValue | null = writingOverride
    ? { style: writingOverride.style, level: writingPrefs ? clampLevel(writingOverride.level, writingPrefs) : writingOverride.level }
    : writingPrefs ? { style: writingPrefs.style, level: writingPrefs.defaultLevel } : null;

  const actionType = execution?.step?.action_type;
  // Un e-mail a un objet comme un InMail : sans ce champ, l'enregistrement
  // écrivait final_subject = null et l'objet personnalisé était perdu.
  const needsSubject = actionType === 'inmail' || actionType === 'email';
  // Message IA (smart_message) : il part en InMail hors relation directe, qui
  // exige un objet. Champ proposé, facultatif.
  const showsSubject = needsSubject || actionType === 'smart_message';

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

  // Lot 5a-2 : même génération que l'aperçu de la préparation, pour ce
  // candidat et cette étape. Rien n'est écrit avant « Enregistrer ».
  const handlePropose = async () => {
    if (!execution) return;
    setProposing(true);
    try {
      const proposal = await proposeAiMessage(execution.id, senderName, writing);
      setMessage(proposal.message);
      if (showsSubject && proposal.subject) setSubject(proposal.subject);
    } catch (err) {
      // Niveau refusé (plafond abaissé entre-temps) : réglages relus, le niveau affiché redescend.
      if (writingRefusalMessage(err)) void refetchWritingPrefs();
      toast.error(err instanceof Error ? err.message : "La proposition de l'IA a échoué. Réessayez, ou écrivez le message vous-même.");
    } finally {
      setProposing(false);
    }
  };

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
          final_subject: showsSubject ? subject.trim() || null : null,
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

      if (aiReview) {
        toast.success('Message relu', { description: 'Il partira au prochain passage, dans l’heure.' });
      } else {
        toast.success('Message mis à jour', { description: 'La nouvelle version partira à l’heure prévue.' });
      }
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
          <DialogTitle>{aiReview ? 'Relire le message' : 'Modifier le message planifié'}</DialogTitle>
          <DialogDescription>
            {aiReview ? (
              <>
                {sequenceActionLabel(actionType)} pour {execution.enrollment?.profile_name || 'le candidat'} : ce message est
                rédigé par l'IA pour chaque candidat. Relisez-le, faites-le proposer par l'IA ou écrivez-le : il partira tel
                quel au prochain passage, dans l'heure.
              </>
            ) : (
              <>
                {sequenceActionLabel(actionType)} · envoi prévu pour {execution.enrollment?.profile_name || 'le candidat'} le{' '}
                {format(scheduledAt, 'EEEE d MMMM', { locale: fr })} à {format(scheduledAt, 'HH:mm')}.
              </>
            )}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          {aiReview && (
            <div className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={handlePropose} loading={proposing} disabled={saving} className="max-md:h-11">
                  {!proposing && <Sparkles aria-hidden="true" />}
                  Proposer avec l'IA
                </Button>
                {/* Coût au niveau choisi ; la ligne de réglages le répète quand elle est lue. */}
                {!writing && (
                  <span className="text-xs tabular-nums text-muted-foreground">
                    environ {plural(levelCredits('outreach_message', DEFAULT_AI_LEVEL), 'crédit')}
                  </span>
                )}
              </div>
              {writing && writingPrefs && (
                <WritingSettingsLine
                  value={writing}
                  onChange={setWritingOverride}
                  defaultStyle={writingPrefs.style}
                  choices={writingChoices('outreach_message')}
                  maxLevel={writingPrefs.maxLevel}
                  disabled={proposing}
                />
              )}
            </div>
          )}

          {/* Objet (InMail et e-mail ; Message IA, facultatif) */}
          {showsSubject && (
            <div className="space-y-2">
              <Label htmlFor={subjectId}>{needsSubject ? 'Objet' : 'Objet, si le message part en InMail'}</Label>
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
          <Button variant="primary" onClick={handleSave} loading={saving} disabled={proposing}>
            Enregistrer le message
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

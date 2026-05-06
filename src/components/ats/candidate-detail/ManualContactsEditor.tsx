/**
 * ManualContactsEditor — popover pour saisir email + phone d'un candidat
 * manuellement (en complément de l'enrichissement auto).
 *
 * Usage : rendu dans le header de la modale candidat (pipeline mode),
 * à côté ou entre les chips email/phone existants.
 *
 * Persiste dans candidate_contacts table (1 row par org+candidat).
 * Email + phone sont partagés entre toutes les missions du candidat
 * dans la même organisation.
 */

import React, { useEffect, useState } from 'react';
import { Mail, Phone, Pencil, Loader2, Check, X } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import {
  getCandidateContacts, upsertCandidateContacts,
  type CandidateContacts,
} from '@/lib/candidateContacts';

interface Props {
  candidateId: string;
  organizationId: string | null;
  /** Callback notifié quand les contacts sont mis à jour, pour que la
   *  modale parente puisse rafraîchir l'affichage des chips. */
  onContactsUpdated?: (contacts: CandidateContacts | null) => void;
  /** Existing contacts (depuis linkedin_profile_data ou autre source).
   *  Affichés en read-only au-dessus des inputs pour info. */
  existingEmails?: string[];
  existingPhones?: string[];
}

export const ManualContactsEditor: React.FC<Props> = ({
  candidateId, organizationId, onContactsUpdated,
  existingEmails = [], existingPhones = [],
}) => {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [contacts, setContacts] = useState<CandidateContacts | null>(null);

  // Form state
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [notes, setNotes] = useState('');

  // Fetch existing manual contacts when popover opens
  useEffect(() => {
    if (!open || !organizationId) return;
    setLoading(true);
    getCandidateContacts(candidateId, organizationId)
      .then(c => {
        setContacts(c);
        setEmail(c?.email || '');
        setPhone(c?.phone || '');
        setNotes(c?.notes || '');
      })
      .finally(() => setLoading(false));
  }, [open, candidateId, organizationId]);

  const handleSave = async () => {
    if (!organizationId) {
      toast.error('Organisation non détectée');
      return;
    }
    setSaving(true);
    try {
      const updated = await upsertCandidateContacts(candidateId, organizationId, {
        email, phone, notes, source: 'manual',
      });
      setContacts(updated);
      toast.success('Contacts enregistrés');
      onContactsUpdated?.(updated);
      setOpen(false);
    } catch (err: any) {
      console.error('[ManualContactsEditor] save error:', err);
      toast.error(err?.message || "Erreur d'enregistrement");
    } finally {
      setSaving(false);
    }
  };

  const handleClear = async () => {
    if (!organizationId) return;
    setSaving(true);
    try {
      await upsertCandidateContacts(candidateId, organizationId, {
        email: null, phone: null, notes: null, source: 'manual',
      });
      setContacts(null);
      setEmail('');
      setPhone('');
      setNotes('');
      toast.success('Contacts effacés');
      onContactsUpdated?.(null);
    } catch (err: any) {
      toast.error(err?.message || 'Erreur');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="inline-flex items-center gap-1.5 h-7 px-2.5 rounded-full text-[11px] font-medium border border-border bg-background hover:bg-accent transition-colors"
          title="Ajouter ou modifier email / téléphone manuellement"
        >
          <Pencil className="w-3 h-3" />
          {(contacts?.email || contacts?.phone) ? 'Modifier' : 'Ajouter contacts'}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4 space-y-3" align="start">
        <div>
          <p className="text-[10px] uppercase tracking-wider font-bold text-muted-foreground mb-0.5">
            Contacts manuels
          </p>
          <p className="text-[11px] text-muted-foreground leading-snug">
            Saisis l'email ou le téléphone du candidat. Sauvegardé pour
            <span className="font-semibold"> toutes les missions</span> de ce candidat dans ton organisation.
          </p>
        </div>

        {/* Existing contacts (info read-only) */}
        {(existingEmails.length > 0 || existingPhones.length > 0) && (
          <div className="rounded-lg bg-muted/30 border border-border/60 px-2.5 py-2 space-y-1">
            <p className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/80">
              Déjà connu (LinkedIn / enrichissement)
            </p>
            {existingEmails.map(e => (
              <p key={e} className="text-[11px] text-foreground/80 inline-flex items-center gap-1">
                <Mail className="w-2.5 h-2.5" /> {e}
              </p>
            ))}
            {existingPhones.map(p => (
              <p key={p} className="text-[11px] text-foreground/80 inline-flex items-center gap-1">
                <Phone className="w-2.5 h-2.5" /> {p}
              </p>
            ))}
          </div>
        )}

        {/* Form */}
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
          </div>
        ) : (
          <div className="space-y-2.5">
            <div>
              <Label htmlFor="manual-email" className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/80 flex items-center gap-1 mb-1">
                <Mail className="w-3 h-3" /> Email
              </Label>
              <Input
                id="manual-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="prenom.nom@example.com"
                className="h-8 text-[12.5px]"
              />
            </div>
            <div>
              <Label htmlFor="manual-phone" className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/80 flex items-center gap-1 mb-1">
                <Phone className="w-3 h-3" /> Téléphone
              </Label>
              <Input
                id="manual-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+33 6 12 34 56 78"
                className="h-8 text-[12.5px]"
              />
            </div>
            <div>
              <Label htmlFor="manual-notes" className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground/80 mb-1 block">
                Note (optionnelle)
              </Label>
              <Textarea
                id="manual-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Ex: email pro, téléphone perso, pas de SMS le soir…"
                className="min-h-[50px] text-[12px]"
              />
            </div>

            {contacts?.updatedAt && (
              <p className="text-[10px] text-muted-foreground italic">
                Dernière mise à jour : {new Date(contacts.updatedAt).toLocaleString('fr-FR')}
                {contacts.source !== 'manual' && ` (source : ${contacts.source})`}
              </p>
            )}

            <div className="flex items-center gap-2 pt-1">
              {(contacts?.email || contacts?.phone || contacts?.notes) && (
                <button
                  type="button"
                  onClick={handleClear}
                  disabled={saving}
                  className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-destructive transition-colors px-2 py-1.5"
                  title="Effacer tous les contacts manuels"
                >
                  <X className="w-3 h-3" />
                  Effacer
                </button>
              )}
              <div className="flex-1" />
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="text-[11px] text-muted-foreground hover:text-foreground transition-colors px-2.5 py-1.5"
              >
                Annuler
              </button>
              <button
                type="button"
                onClick={handleSave}
                disabled={saving}
                className="inline-flex items-center gap-1 text-[11px] font-semibold bg-foreground text-background px-3 py-1.5 rounded-md hover:bg-foreground/90 transition-colors disabled:opacity-50"
              >
                {saving ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                Enregistrer
              </button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

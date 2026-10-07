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
import { cn } from '@/lib/utils';
import { HEADER_ACTION_CLASS } from '@/components/outreach/result-card/headerActions';
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

  // Origine des contacts, sans exposer la valeur brute de `source`
  // ('manual' → Saisi, 'enriched*' → Enrichi, autre → rien).
  const sourceLabel = contacts?.source === 'manual'
    ? 'Saisi'
    : contacts?.source?.startsWith('enriched')
      ? 'Enrichi'
      : null;

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
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={cn('shrink-0 max-sm:min-h-11', HEADER_ACTION_CLASS)}
          title="Ajouter ou modifier l'e-mail et le téléphone à la main"
        >
          <Pencil aria-hidden="true" />
          {(contacts?.email || contacts?.phone) ? 'Modifier' : 'Ajouter contacts'}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-80 p-4 space-y-3" align="start">
        <div>
          <p className="text-sm font-semibold text-foreground">Contacts saisis à la main</p>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">
            Saisissez l'e-mail ou le téléphone du candidat. Ils sont enregistrés pour toutes ses missions dans votre organisation.
          </p>
        </div>

        {/* Contacts déjà connus (lecture seule) */}
        {(existingEmails.length > 0 || existingPhones.length > 0) && (
          <div className="space-y-1 rounded-lg bg-muted px-3 py-2">
            <p className="text-xs font-medium text-muted-foreground">
              Déjà connus (LinkedIn ou recherche automatique)
            </p>
            {existingEmails.map(e => (
              <p key={e} className="flex items-center gap-1.5 text-sm text-foreground-secondary">
                <Mail className="h-3.5 w-3.5 shrink-0 text-foreground" aria-hidden="true" /> {e}
              </p>
            ))}
            {existingPhones.map(p => (
              <p key={p} className="flex items-center gap-1.5 text-sm text-foreground-secondary">
                <Phone className="h-3.5 w-3.5 shrink-0 text-foreground" aria-hidden="true" /> {p}
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
              <Label htmlFor="manual-email" className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Mail className="w-3 h-3 text-foreground" /> E-mail
              </Label>
              <Input
                id="manual-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="prenom.nom@example.com"
                className="h-9 text-sm"
              />
            </div>
            <div>
              <Label htmlFor="manual-phone" className="mb-1 flex items-center gap-1 text-xs font-medium text-muted-foreground">
                <Phone className="w-3 h-3 text-foreground" /> Téléphone
              </Label>
              <Input
                id="manual-phone"
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="+33 6 12 34 56 78"
                className="h-9 text-sm"
              />
            </div>
            <div>
              <Label htmlFor="manual-notes" className="mb-1 block text-xs font-medium text-muted-foreground">
                Note (optionnelle)
              </Label>
              <Textarea
                id="manual-notes"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Exemple : e-mail pro, téléphone perso, pas de SMS le soir"
                className="min-h-[56px] text-sm"
              />
            </div>

            {contacts?.updatedAt && (
              <p className="text-xs text-muted-foreground">
                Dernière mise à jour : {new Date(contacts.updatedAt).toLocaleString('fr-FR')}
                {sourceLabel && ` (${sourceLabel})`}
              </p>
            )}

            <div className="flex items-center gap-2 pt-1">
              {(contacts?.email || contacts?.phone || contacts?.notes) && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={handleClear}
                  disabled={saving}
                  className="text-foreground-secondary hover:bg-danger-muted hover:text-danger"
                  title="Effacer tous les contacts saisis à la main"
                >
                  <X aria-hidden="true" />
                  Effacer
                </Button>
              )}
              <div className="flex-1" />
              <Button type="button" variant="ghost" size="sm" onClick={() => setOpen(false)}>
                Annuler
              </Button>
              <Button type="button" variant="primary" size="sm" onClick={handleSave} loading={saving}>
                {!saving && <Check aria-hidden="true" />}
                Enregistrer
              </Button>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
};

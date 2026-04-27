/**
 * EnrichContactButton — Bouton pour récupérer email + téléphone d'un candidat.
 *
 * Workflow :
 *   1. Clic → modal de confirmation (informer du coût)
 *   2. Confirmation → useCandidateEnrichment.enrich()
 *   3. Pendant le polling → spinner + texte "Recherche en cours..."
 *   4. Résultat → affichage email + téléphone (cliquables) ou "Non trouvé"
 *
 * Usage :
 *   <EnrichContactButton profile={profile} compact />
 */

import React, { useState } from 'react';
import { LinkedInProfile } from '../types';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Mail, Phone, Loader2, Sparkles, Copy, Check } from 'lucide-react';
import { useCandidateEnrichment } from '@/hooks/useCandidateEnrichment';
import { toast } from 'sonner';

interface EnrichContactButtonProps {
  profile: LinkedInProfile;
  compact?: boolean;
  className?: string;
}

function getCurrentCompany(profile: LinkedInProfile): string | undefined {
  const current = profile.work_experience?.find((j: any) => j.current || !j.end)
    || profile.work_experience?.[0];
  return current?.company || undefined;
}

export const EnrichContactButton: React.FC<EnrichContactButtonProps> = ({
  profile,
  compact = false,
  className = '',
}) => {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);
  const [phoneCopied, setPhoneCopied] = useState(false);
  const { enrich, status, contact, isLoading } = useCandidateEnrichment();

  const linkedinUrl = profile.profile_url || profile.public_profile_url;
  const fullName = profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
  const company = getCurrentCompany(profile);

  // Pre-existing emails/phones from profile (Unipile contact_info)
  const existingEmail = profile.contact_info?.emails?.[0];
  const existingPhone = profile.contact_info?.phones?.[0];

  // Si on a déjà des contacts dans le profil, on les affiche directement (pas besoin d'enrich)
  const hasExisting = !!(existingEmail || existingPhone);

  // Si enrichment terminé, on affiche le résultat enrichi
  const enrichedEmail = contact?.email || existingEmail;
  const enrichedPhone = contact?.phone || existingPhone;
  const hasEnrichedResult = status === 'terminated' && (contact?.email || contact?.phone);

  const handleConfirm = async () => {
    setConfirmOpen(false);
    if (!linkedinUrl) {
      toast.error('URL LinkedIn manquante pour cet enrichment');
      return;
    }
    await enrich({
      linkedinUrl,
      firstName: profile.first_name,
      lastName: profile.last_name,
      company,
    });
  };

  const copy = async (value: string, type: 'email' | 'phone') => {
    try {
      await navigator.clipboard.writeText(value);
      if (type === 'email') {
        setEmailCopied(true);
        setTimeout(() => setEmailCopied(false), 1500);
      } else {
        setPhoneCopied(true);
        setTimeout(() => setPhoneCopied(false), 1500);
      }
      toast.success(`${type === 'email' ? 'Email' : 'Téléphone'} copié`);
    } catch {
      toast.error('Impossible de copier');
    }
  };

  // ─── Affichage : si on a déjà email/phone (cache ou Unipile), on les montre direct
  if (hasExisting || hasEnrichedResult) {
    return (
      <div className={`flex items-center gap-1.5 ${className}`}>
        {enrichedEmail && (
          <button
            type="button"
            onClick={() => copy(enrichedEmail, 'email')}
            className="inline-flex items-center gap-1 text-[11px] text-info hover:text-info/80 transition-colors"
            title={`Copier ${enrichedEmail}`}
          >
            {emailCopied ? <Check className="w-3 h-3" /> : <Mail className="w-3 h-3" />}
            <span className="truncate max-w-[180px]">{enrichedEmail}</span>
          </button>
        )}
        {enrichedPhone && (
          <button
            type="button"
            onClick={() => copy(enrichedPhone, 'phone')}
            className="inline-flex items-center gap-1 text-[11px] text-info hover:text-info/80 transition-colors"
            title={`Copier ${enrichedPhone}`}
          >
            {phoneCopied ? <Check className="w-3 h-3" /> : <Phone className="w-3 h-3" />}
            <span>{enrichedPhone}</span>
          </button>
        )}
      </div>
    );
  }

  // ─── Affichage : pendant l'enrichment (polling)
  if (isLoading) {
    return (
      <Button
        variant="outline"
        size={compact ? 'sm' : 'default'}
        disabled
        className={`gap-1.5 ${className}`}
      >
        <Loader2 className={compact ? 'w-3 h-3 animate-spin' : 'w-4 h-4 animate-spin'} aria-hidden="true" />
        <span className="text-xs">Recherche en cours…</span>
      </Button>
    );
  }

  // ─── Affichage : résultat vide après enrichment
  if (status === 'terminated' && !hasEnrichedResult) {
    return (
      <span className={`text-[11px] text-muted-foreground italic ${className}`}>
        Aucun contact trouvé
      </span>
    );
  }

  // ─── Affichage : bouton initial
  if (!linkedinUrl) return null;

  return (
    <>
      <Button
        variant="outline"
        size={compact ? 'sm' : 'default'}
        onClick={() => setConfirmOpen(true)}
        className={`gap-1.5 ${compact ? 'h-7 px-2 text-xs' : 'text-xs'} ${className}`}
        title={`Récupérer email/téléphone de ${fullName}`}
      >
        <Sparkles className={compact ? 'w-3 h-3' : 'w-4 h-4'} aria-hidden="true" />
        <span>{compact ? 'Contact' : 'Récupérer email/tél.'}</span>
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Récupérer le contact de {fullName} ?</AlertDialogTitle>
            <AlertDialogDescription className="space-y-2">
              <span className="block">
                Konekt va rechercher l'email professionnel et le numéro de téléphone
                de ce candidat via plusieurs sources de données vérifiées.
              </span>
              <span className="block text-xs text-muted-foreground">
                💳 Coût : 1 crédit Konekt par email trouvé · 10 crédits par mobile trouvé.
                Aucun crédit consommé si rien n'est trouvé.
              </span>
              <span className="block text-xs text-muted-foreground">
                ⏱️ La recherche peut prendre 30 secondes à 2 minutes.
              </span>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirm}>
              Lancer la recherche
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

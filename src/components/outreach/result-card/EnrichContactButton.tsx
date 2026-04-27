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

import React, { useState, useEffect } from 'react';
import { LinkedInProfile } from '../types';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Mail, Phone, Loader2, Sparkles, Check, X } from 'lucide-react';
import { useCandidateEnrichment } from '@/hooks/useCandidateEnrichment';
import { toast } from 'sonner';

/** Compteur de temps écoulé qui re-render chaque seconde. */
function useElapsed(active: boolean): number {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    if (!active) {
      setSeconds(0);
      return;
    }
    const start = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(id);
  }, [active]);
  return seconds;
}

function formatDuration(s: number): string {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const r = s % 60;
  return `${m}m${r > 0 ? ` ${r}s` : ''}`;
}

/** Message adaptatif selon la durée du polling. */
function progressMessage(s: number): string {
  if (s < 15) return 'Lancement de la recherche…';
  if (s < 45) return 'Cascade des sources de données…';
  if (s < 90) return 'Vérification des emails trouvés…';
  if (s < 150) return 'Recherche du téléphone mobile…';
  if (s < 240) return 'Encore un instant, presque fini…';
  return 'La recherche prend plus de temps que prévu…';
}

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
  /** True si user a cliqué "Continuer en arrière-plan" — masque le spinner mais garde le polling. */
  const [backgrounded, setBackgrounded] = useState(false);
  const { enrich, status, contact, isLoading } = useCandidateEnrichment();
  const elapsed = useElapsed(isLoading);

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
    setBackgrounded(false);
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

  // Quand l'enrichment se termine en arrière-plan, on remet le bouton visible
  // (avec le résultat affiché). Si l'user était backgrounded, toast notification.
  useEffect(() => {
    if (status === 'terminated' && backgrounded) {
      const found = contact?.email || contact?.phone;
      if (found) {
        toast.success(`Contact de ${fullName} récupéré`, {
          description: contact?.email || contact?.phone || '',
        });
      }
      setBackgrounded(false);
    }
  }, [status, backgrounded, contact, fullName]);

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

  // ─── Affichage : pendant l'enrichment (polling) ──
  // Si l'user a cliqué "Continuer en arrière-plan" → on affiche le bouton initial
  // mais avec un petit indicateur que le polling continue (pour qu'il puisse
  // garder un œil sur le profil).
  if (isLoading && backgrounded) {
    return (
      <button
        type="button"
        onClick={() => setBackgrounded(false)}
        className={`inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors ${className}`}
        title="Recherche en arrière-plan, cliquer pour rouvrir"
      >
        <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
        <span>En cours · {formatDuration(elapsed)}</span>
      </button>
    );
  }

  if (isLoading) {
    return (
      <div className={`inline-flex items-center gap-1.5 ${className}`}>
        <Button
          variant="outline"
          size={compact ? 'sm' : 'default'}
          disabled
          className="gap-1.5"
        >
          <Loader2 className={compact ? 'w-3 h-3 animate-spin' : 'w-4 h-4 animate-spin'} aria-hidden="true" />
          <span className="text-xs">{progressMessage(elapsed)}</span>
          <span className="text-[10px] text-muted-foreground tabular-nums ml-1">
            {formatDuration(elapsed)}
          </span>
        </Button>
        <Button
          variant="ghost"
          size={compact ? 'sm' : 'default'}
          onClick={() => setBackgrounded(true)}
          className="h-7 px-2 text-[10px] text-muted-foreground hover:text-foreground"
          title="Continuer en arrière-plan (vous pouvez fermer cette card)"
        >
          <X className="w-3 h-3" aria-hidden="true" />
          Background
        </Button>
      </div>
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

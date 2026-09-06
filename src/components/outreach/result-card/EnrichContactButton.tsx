/**
 * EnrichContactButton — Bouton pour récupérer email + téléphone d'un candidat.
 *
 * Workflow :
 *   1. Clic → modal de confirmation (forfait de contacts inclus, coût hors forfait)
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
import { Checkbox } from '@/components/ui/checkbox';
import { Mail, Phone, Loader2, Sparkles, Check, X, AlertTriangle } from 'lucide-react';
import { useCandidateEnrichment } from '@/hooks/useCandidateEnrichment';
import { useAICredits } from '@/hooks/useAICredits';
import { useEnrichmentPermission, formatResetDay } from '@/hooks/useEnrichmentPermission';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import type { PipelineProfile } from '@/lib/atsCandidateToProfile';
import { useNavigate } from 'react-router-dom';
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
  /**
   * 'auto' (default) : si email/phone déjà dans contact_info, affiche les
   * contacts en mode display avec Copy. Sinon affiche le bouton "Récupérer".
   *
   * 'button-only' : affiche TOUJOURS le bouton, peu importe les contacts
   * existants. Utile dans le ProfileDetailSheet où l'affichage des contacts
   * est déjà géré ailleurs (block CONTACT INFO).
   */
  mode?: 'auto' | 'button-only';
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
  mode = 'auto',
}) => {
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [emailCopied, setEmailCopied] = useState(false);
  const [phoneCopied, setPhoneCopied] = useState(false);
  /** True si user a cliqué "Continuer en arrière-plan" — masque le spinner mais garde le polling. */
  const [backgrounded, setBackgrounded] = useState(false);
  /** Choix dans la modale : email seul / phone seul / les 2. Default email seul. */
  const [withEmail, setWithEmail] = useState(true);
  const [withPhone, setWithPhone] = useState(false);
  const { enrich, status, contact, isLoading } = useCandidateEnrichment();
  const elapsed = useElapsed(isLoading);
  const { creditsRemaining, invalidateBalance } = useAICredits();
  const {
    canEnrich, quotaMonthly, quotaUsed, isQuotaExhausted,
    includedMonthly, includedUsed, includedRemaining, periodEnd, refetchQuota,
  } = useEnrichmentPermission();
  // Plan effectif gratuit : l'enrichissement de contact nécessite un abonnement.
  const { isFree: isFreePlan } = useSubscriptionState();
  const navigate = useNavigate();

  // Invalidate balance + quota cache après settle (quand le service retourne terminated avec contact trouvé)
  useEffect(() => {
    if (status === 'terminated' && (contact?.email || contact?.phone)) {
      invalidateBalance();
      refetchQuota();
    }
  }, [status, contact, invalidateBalance, refetchQuota]);

  // Forfait : un email = 1 contact inclus, un téléphone = 1 contact inclus.
  // Le serveur couvre la demande entière ou pas du tout (reste >= unités demandées).
  const requestedUnits = (withEmail ? 1 : 0) + (withPhone ? 1 : 0);
  const coveredByPlan = requestedUnits > 0 && includedRemaining >= requestedUnits;
  // Coût en crédits, seulement pour la part hors forfait
  const totalCost = coveredByPlan ? 0 : (withEmail ? 1 : 0) + (withPhone ? 10 : 0);
  const insufficientCredits = totalCost > creditsRemaining;
  const resetDay = formatResetDay(periodEnd);

  const linkedinUrl = profile.profile_url || profile.public_profile_url;
  const fullName = profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
  const company = getCurrentCompany(profile);
  // Profil issu du pipeline : identifiant candidat pour rattacher le résultat à la fiche
  const candidateId = (profile as PipelineProfile).candidateId;

  // Pre-existing emails/phones from profile (Unipile contact_info)
  const existingEmail = profile.contact_info?.emails?.[0];
  const existingPhone = profile.contact_info?.phones?.[0];

  // Si on a déjà des contacts dans le profil, on les affiche directement (pas besoin d'enrich)
  const hasExisting = !!(existingEmail || existingPhone);

  // Si enrichissement terminé, on affiche le résultat enrichi
  const enrichedEmail = contact?.email || existingEmail;
  const enrichedPhone = contact?.phone || existingPhone;
  const hasEnrichedResult = status === 'terminated' && (contact?.email || contact?.phone);

  const handleConfirm = async () => {
    if (submitting) return; // Guard double-clic
    setSubmitting(true);
    setConfirmOpen(false);
    setBackgrounded(false);
    try {
      if (!linkedinUrl) {
        toast.error("URL LinkedIn manquante pour cet enrichissement de contact");
        return;
      }
      if (!withEmail && !withPhone) {
        toast.error('Sélectionnez au moins email ou téléphone');
        return;
      }
      await enrich({
        linkedinUrl,
        firstName: profile.first_name,
        lastName: profile.last_name,
        company,
        withEmail,
        withPhone,
        contactInfoHint: profile.contact_info ? {
          emails: profile.contact_info.emails || [],
          phones: profile.contact_info.phones || [],
        } : null,
        candidateId,
      });
    } finally {
      setSubmitting(false);
    }
  };

  // Quand l'enrichissement se termine en arrière-plan, on remet le bouton visible
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
  // En mode 'button-only', on saute cette branche pour TOUJOURS afficher le bouton
  // (utile dans ProfileDetailSheet où le block CONTACT INFO gère déjà l'affichage).
  if (mode === 'auto' && (hasExisting || hasEnrichedResult)) {
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

  // ─── Affichage : pendant l'enrichissement (polling) ──
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
          Arrière-plan
        </Button>
      </div>
    );
  }

  // ─── Affichage : résultat vide après enrichissement
  if (status === 'terminated' && !hasEnrichedResult) {
    return (
      <span className={`text-[11px] text-muted-foreground italic ${className}`}>
        Aucun contact trouvé
      </span>
    );
  }

  // ─── Affichage : bouton initial
  if (!linkedinUrl) return null;

  // Si pas la permission → bouton grisé avec tooltip
  if (!canEnrich) {
    return (
      <Button
        variant="outline"
        size={compact ? 'sm' : 'default'}
        disabled
        className={`gap-1.5 ${compact ? 'h-7 px-2.5 text-xs rounded-lg' : 'text-xs'} opacity-50 ${className}`}
        title="Demandez à votre administrateur d'activer la récupération de coordonnées"
      >
        <Sparkles className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} aria-hidden="true" />
        <span>Coordonnées</span>
      </Button>
    );
  }

  return (
    <>
      <Button
        variant="outline"
        size={compact ? 'sm' : 'default'}
        onClick={() => setConfirmOpen(true)}
        className={`gap-1.5 font-medium bg-muted border-foreground/30 shadow-sm hover:bg-accent hover:border-foreground/50 hover:shadow-md transition-all ${compact ? 'h-7 px-2.5 text-xs rounded-lg border-2' : 'text-xs'} ${className}`}
        title={`Récupérer email & téléphone de ${fullName}`}
      >
        <Sparkles className={compact ? 'w-3.5 h-3.5' : 'w-4 h-4'} aria-hidden="true" />
        <span>{compact ? 'Coordonnées' : 'Récupérer email & téléphone'}</span>
      </Button>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>Récupérer le contact de {fullName}</AlertDialogTitle>
            <AlertDialogDescription>
              Sélectionnez les données à rechercher. Konekt va consulter
              plusieurs sources de données vérifiées pour les trouver.
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Choix email / phone */}
          <div className="space-y-2 py-2">
            <label className="flex items-center gap-3 px-3 py-2.5 border border-border rounded-lg cursor-pointer hover:bg-muted/30 transition-colors">
              <Checkbox
                checked={withEmail}
                onCheckedChange={(c) => setWithEmail(c === true)}
                aria-label="Email professionnel"
              />
              <Mail className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">Email professionnel</div>
                <div className="text-[11px] text-muted-foreground">
                  {coveredByPlan ? 'Inclus dans votre forfait' : '1 crédit si trouvé'} · ~30 s à 1 min
                </div>
              </div>
            </label>

            <label className="flex items-center gap-3 px-3 py-2.5 border border-border rounded-lg cursor-pointer hover:bg-muted/30 transition-colors">
              <Checkbox
                checked={withPhone}
                onCheckedChange={(c) => setWithPhone(c === true)}
                aria-label="Téléphone mobile"
              />
              <Phone className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">Téléphone mobile</div>
                <div className="text-[11px] text-muted-foreground">
                  {coveredByPlan ? 'Inclus dans votre forfait' : '10 crédits si trouvé'} · jusqu'à 3 min · plus rare
                </div>
              </div>
            </label>
          </div>

          {/* Forfait + coût hors forfait + solde + plafond membre */}
          <div className={`border rounded-lg px-3 py-2 text-xs space-y-1 ${
            insufficientCredits || isQuotaExhausted ? 'border-destructive/50 bg-destructive/5' : 'border-border bg-muted/40'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Contacts inclus ce mois :</span>
              <span className="font-bold tabular-nums text-foreground">
                {includedUsed} / {includedMonthly}
                {resetDay && <span className="font-normal text-muted-foreground"> (reset le {resetDay})</span>}
              </span>
            </div>
            {!coveredByPlan && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Coût hors forfait :</span>
                  <span className="font-bold tabular-nums text-foreground">
                    {totalCost} crédit{totalCost > 1 ? 's' : ''}
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Solde Konekt :</span>
                  <span className={`font-bold tabular-nums ${
                    insufficientCredits ? 'text-destructive' : 'text-foreground'
                  }`}>
                    {creditsRemaining} crédit{creditsRemaining > 1 ? 's' : ''}
                  </span>
                </div>
              </>
            )}
            {quotaMonthly !== null && (
              <div className="flex items-center justify-between">
                <span className="text-muted-foreground">Plafond de votre compte :</span>
                <span className={`font-bold tabular-nums ${
                  isQuotaExhausted ? 'text-destructive' : 'text-foreground'
                }`}>
                  {quotaUsed} / {quotaMonthly}
                </span>
              </div>
            )}
            {isQuotaExhausted ? (
              <div className="flex items-start gap-1.5 text-destructive pt-1 border-t border-destructive/30">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" />
                <span>Plafond mensuel de votre compte atteint. Demandez à un administrateur de l'augmenter dans Paramètres &gt; Équipe.</span>
              </div>
            ) : insufficientCredits ? (
              <div className="flex items-start gap-1.5 text-destructive pt-1 border-t border-destructive/30">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" />
                <span>Forfait du mois épuisé et crédits insuffisants. Achetez un pack ou changez de forfait dans Paramètres &gt; Abonnement.</span>
              </div>
            ) : coveredByPlan ? (
              <div className="text-[10px] text-muted-foreground">
                Cette recherche est comprise dans votre forfait, aucun crédit ne sera débité.
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground">
                Forfait du mois épuisé : la recherche est facturée en crédits, seulement si un contact est trouvé.
              </div>
            )}
          </div>

          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            {isQuotaExhausted ? (
              <AlertDialogAction
                onClick={() => setConfirmOpen(false)}
                disabled
              >
                Plafond mensuel atteint
              </AlertDialogAction>
            ) : insufficientCredits ? (
              <AlertDialogAction
                onClick={() => { setConfirmOpen(false); navigate('/settings?tab=credits'); }}
                className="bg-info hover:bg-info/90"
              >
                Acheter des crédits
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                onClick={handleConfirm}
                disabled={(!withEmail && !withPhone) || isFreePlan}
                title={isFreePlan ? "L'enrichissement de contact nécessite un abonnement" : undefined}
              >
                Lancer la recherche
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

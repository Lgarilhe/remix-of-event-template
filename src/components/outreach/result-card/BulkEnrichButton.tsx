/**
 * BulkEnrichButton — Bouton bulk pour enrichir N profils sélectionnés.
 *
 * Apparait dans la bulk action bar de SearchResultsPanel quand
 * selectedProfiles.size > 0.
 *
 * Workflow :
 *   1. Clic → modale de confirmation enrichie :
 *      - Nombre de profils sélectionnés
 *      - Choix email/phone/les 2
 *      - Forfait de contacts inclus restant + coût maximum hors forfait
 *      - Solde Konekt actuel
 *      - Confirmation FORTE si > 25 profils (checkbox obligatoire)
 *   2. Confirme → POST enrich-candidate-contact pour chaque profil
 *      (3 en parallèle pour ne pas saturer le backend)
 *   3. Toast "N enrichissements de contact lancés"
 *   4. Cascade lookup gratuit côté backend pour chaque profil
 *      → seuls les inconnus déclenchent la recherche payante
 *   5. L'user voit les contacts apparaître au fur et à mesure (via le
 *      EnrichContactButton individuel sur chaque card)
 *
 * Le lot s'arrête dès qu'une réponse porte INSUFFICIENT_CREDITS,
 * QUOTA_EXCEEDED, PERMISSION_DENIED, PLAN_REQUIRED ou RATE_LIMITED : inutile
 * de continuer, les suivants échoueraient pareil.
 *
 * IMPORTANT : pas de polling groupé en v1 (simplification). Si l'user
 * veut tracker précisément, il peut regarder Settings > Crédits > Historique.
 */

import React, { useState } from 'react';
import { LinkedInProfile } from '../types';
import { Button } from '@/components/ui/button';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Checkbox } from '@/components/ui/checkbox';
import { Mail, Phone, Sparkles, AlertTriangle, Loader2 } from 'lucide-react';
import { useAICredits } from '@/hooks/useAICredits';
import { useEnrichmentPermission, formatResetDay } from '@/hooks/useEnrichmentPermission';
import { useSubscriptionState } from '@/hooks/useSubscriptionState';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

interface BulkEnrichButtonProps {
  profiles: LinkedInProfile[];
  /** Hard limit (default 100, limite par lot du service) */
  maxBatch?: number;
  /** Au-delà de ce seuil, on demande une confirmation forte (checkbox) */
  strongConfirmThreshold?: number;
  onComplete?: (enrichedCount: number) => void;
}

/** Codes d'erreur qui arrêtent le lot entier (les suivants échoueraient pareil). */
const ABORT_CODES = new Set(['INSUFFICIENT_CREDITS', 'QUOTA_EXCEEDED', 'PERMISSION_DENIED', 'PLAN_REQUIRED']);
/** Limite serveur : 30 demandes par minute et par utilisateur ; on attend puis on reprend. */
const RATE_LIMIT_WAIT_MS = 60_000;

const ABORT_MESSAGES: Record<string, string> = {
  INSUFFICIENT_CREDITS: 'Lot arrêté : crédits insuffisants',
  QUOTA_EXCEEDED: 'Lot arrêté : plafond mensuel de votre compte atteint',
  PERMISSION_DENIED: "Lot arrêté : l'enrichissement de contact n'est pas autorisé pour votre compte",
  PLAN_REQUIRED: 'Lot arrêté : un abonnement est nécessaire (Paramètres > Abonnement)',
};

function getCurrentCompany(profile: LinkedInProfile): string | undefined {
  const current = profile.work_experience?.find((j: any) => j.current || !j.end)
    || profile.work_experience?.[0];
  return current?.company || undefined;
}

/** Helper : exécute une liste d'opérations async en limitant la concurrence */
async function pMapConcurrent<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = 3,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = Array(Math.min(concurrency, items.length)).fill(0).map(async () => {
    while (cursor < items.length) {
      const i = cursor++;
      try {
        results[i] = await fn(items[i], i);
      } catch (e) {
        results[i] = e as R;
      }
    }
  });
  await Promise.all(workers);
  return results;
}

export const BulkEnrichButton: React.FC<BulkEnrichButtonProps> = ({
  profiles,
  maxBatch = 100,
  strongConfirmThreshold = 25,
  onComplete,
}) => {
  const [open, setOpen] = useState(false);
  const [withEmail, setWithEmail] = useState(true);
  const [withPhone, setWithPhone] = useState(false);
  const [strongConfirmChecked, setStrongConfirmChecked] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const { creditsRemaining, invalidateBalance } = useAICredits();
  const { includedMonthly, includedUsed, includedRemaining, periodEnd, refetchQuota } = useEnrichmentPermission();
  // Plan effectif gratuit : l'enrichissement de contact nécessite un abonnement.
  const { isFree: isFreePlan } = useSubscriptionState();
  const navigate = useNavigate();

  const eligibleProfiles = profiles.filter(p => p.profile_url || p.public_profile_url);
  const count = Math.min(eligibleProfiles.length, maxBatch);
  const tooMany = eligibleProfiles.length > maxBatch;

  // Forfait : un email = 1 contact inclus, un téléphone = 1 contact inclus,
  // couverture par profil entière ou nulle (comme côté serveur).
  const unitsPerProfile = (withEmail ? 1 : 0) + (withPhone ? 1 : 0);
  const coveredProfiles = unitsPerProfile > 0
    ? Math.min(count, Math.floor(includedRemaining / unitsPerProfile))
    : 0;
  const beyondProfiles = Math.max(0, count - coveredProfiles);
  const costPerProfile = (withEmail ? 1 : 0) + (withPhone ? 10 : 0);
  // Coût maximum en crédits, seulement pour les profils hors forfait
  const maxCost = costPerProfile * beyondProfiles;
  const insufficientCredits = maxCost > creditsRemaining;
  const requireStrongConfirm = count > strongConfirmThreshold;
  const canSubmit = (withEmail || withPhone)
    && !insufficientCredits
    && (!requireStrongConfirm || strongConfirmChecked)
    && count > 0;
  const resetDay = formatResetDay(periodEnd);

  const handleConfirm = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);

    const targets = eligibleProfiles.slice(0, maxBatch);
    let started = 0;
    let cached = 0;
    let blocked = 0;
    let failed = 0;
    let processed = 0;
    let abortCode: string | null = null; // CRITIQUE : crédits/plafond/droits épuisés → on stoppe le lot

    // Toast de démarrage avec progress
    toast.loading(`0 / ${targets.length} enrichissements de contact en cours…`, { id: 'bulk-enrich' });

    await pMapConcurrent(targets, async (profile) => {
      // Si un code d'arrêt a été détecté ailleurs, on skip les workers restants
      if (abortCode) return;

      try {
        const linkedinUrl = profile.profile_url || profile.public_profile_url;
        if (!linkedinUrl) { failed++; return; }
        const company = getCurrentCompany(profile);

        const requestOnce = () => invokeEdgeFunction<{
          success: boolean;
          cached?: boolean;
          included?: boolean;
          source?: string;
          error?: string;
          error_code?: string;
        }>('enrich-candidate-contact', {
          linkedin_url: linkedinUrl,
          first_name: profile.first_name,
          last_name: profile.last_name,
          company,
          with_email: withEmail,
          with_phone: withPhone,
          contact_info_hint: profile.contact_info ? {
            emails: profile.contact_info.emails || [],
            phones: profile.contact_info.phones || [],
          } : null,
        });

        let { data } = await requestOnce();
        if (!data?.success && data?.error_code === 'RATE_LIMITED' && !abortCode) {
          // Limite par minute atteinte : on attend, puis on réessaie une fois ce profil.
          toast.loading('En attente du service, reprise dans une minute…', { id: 'bulk-enrich' });
          await new Promise(resolve => setTimeout(resolve, RATE_LIMIT_WAIT_MS));
          if (abortCode) return;
          ({ data } = await requestOnce());
        }

        if (!data?.success) {
          const code = data?.error_code;
          if (code && ABORT_CODES.has(code)) {
            // STOP le lot entier — futile de continuer
            abortCode = abortCode || code;
            blocked++;
            return;
          }
          if (code === 'GDPR_ERASED') {
            blocked++;
            return;
          }
          failed++;
          return;
        }

        if (data.cached) cached++;
        else started++;
      } catch {
        failed++;
      } finally {
        processed++;
        // Update progress toast every 5 profils ou à la fin
        if (processed % 5 === 0 || processed === targets.length) {
          toast.loading(`${processed} / ${targets.length} enrichissements de contact en cours…`, { id: 'bulk-enrich' });
        }
      }
    }, 3);

    setSubmitting(false);
    setOpen(false);
    setStrongConfirmChecked(false);

    invalidateBalance();
    refetchQuota();
    onComplete?.(started + cached);

    // Toast récapitulatif final
    const parts: string[] = [];
    if (cached > 0) parts.push(`${cached} déjà connu${cached > 1 ? 's' : ''} (gratuit)`);
    if (started > 0) parts.push(`${started} en cours (~30 s à 3 min)`);
    if (blocked > 0) parts.push(`${blocked} bloqué${blocked > 1 ? 's' : ''} (forfait, crédits, droits ou RGPD)`);
    if (failed > 0) parts.push(`${failed} erreur${failed > 1 ? 's' : ''}`);

    if (abortCode) {
      const reason = ABORT_MESSAGES[abortCode] || 'Lot arrêté';
      toast.error(`${reason} (${started + cached} traités sur ${targets.length})`, {
        id: 'bulk-enrich',
        description: parts.join(' · '),
      });
    } else {
      toast.success(`${started + cached} enrichissement${started + cached > 1 ? 's' : ''} de contact lancé${started + cached > 1 ? 's' : ''}`, {
        id: 'bulk-enrich',
        description: parts.join(' · '),
      });
    }
  };

  // Si moins de 1 profil eligible, on cache le bouton
  if (eligibleProfiles.length === 0) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        disabled={isFreePlan}
        className="p-1 hover:bg-muted rounded-sm text-muted-foreground hover:text-foreground disabled:opacity-50 disabled:cursor-not-allowed"
        title={isFreePlan
          ? "L'enrichissement de contact nécessite un abonnement"
          : `Récupérer email/téléphone des ${count} profil${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''}`}
      >
        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
      </button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Récupérer les contacts de {count} profil{count > 1 ? 's' : ''}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {tooMany ? (
                <>
                  Vous avez sélectionné <strong>{eligibleProfiles.length}</strong> profils.
                  Seuls les <strong>{maxBatch}</strong> premiers seront traités (limite par lot).
                </>
              ) : (
                <>
                  Konekt va rechercher les contacts via plusieurs sources.
                  Les sources gratuites (LinkedIn, contacts déjà connus, pipeline)
                  sont tentées en premier.
                </>
              )}
            </AlertDialogDescription>
          </AlertDialogHeader>

          {/* Choix email / phone */}
          <div className="space-y-2 py-2">
            <label className="flex items-center gap-3 px-3 py-2.5 border border-border rounded-lg cursor-pointer hover:bg-muted/30 transition-colors">
              <Checkbox
                checked={withEmail}
                onCheckedChange={(c) => setWithEmail(c === true)}
              />
              <Mail className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">Email professionnel</div>
                <div className="text-[11px] text-muted-foreground">
                  1 contact inclus par profil, sinon 1 crédit si trouvé
                </div>
              </div>
            </label>

            <label className="flex items-center gap-3 px-3 py-2.5 border border-border rounded-lg cursor-pointer hover:bg-muted/30 transition-colors">
              <Checkbox
                checked={withPhone}
                onCheckedChange={(c) => setWithPhone(c === true)}
              />
              <Phone className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium text-foreground">Téléphone mobile</div>
                <div className="text-[11px] text-muted-foreground">
                  1 contact inclus par profil, sinon 10 crédits si trouvé
                </div>
              </div>
            </label>
          </div>

          {/* Forfait restant + coût hors forfait + solde */}
          <div className={`border rounded-lg px-3 py-2 text-xs space-y-1 ${
            insufficientCredits ? 'border-destructive/50 bg-destructive/5' : 'border-border bg-muted/40'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Contacts inclus ce mois :</span>
              <span className="font-bold tabular-nums text-foreground">
                {includedUsed} / {includedMonthly}
                {resetDay && <span className="font-normal text-muted-foreground"> (reset le {resetDay})</span>}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Profils couverts par le forfait :</span>
              <span className="font-bold tabular-nums text-foreground">{coveredProfiles} / {count}</span>
            </div>
            {beyondProfiles > 0 && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Coût maximum hors forfait :</span>
                  <span className="font-bold tabular-nums text-foreground">
                    {maxCost} crédit{maxCost > 1 ? 's' : ''} ({beyondProfiles} profil{beyondProfiles > 1 ? 's' : ''})
                  </span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground">Votre solde :</span>
                  <span className={`font-bold tabular-nums ${insufficientCredits ? 'text-destructive' : 'text-foreground'}`}>
                    {creditsRemaining} crédit{creditsRemaining > 1 ? 's' : ''}
                  </span>
                </div>
              </>
            )}
            {insufficientCredits ? (
              <div className="flex items-start gap-1.5 text-destructive pt-1 border-t border-destructive/30">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" />
                <span>Solde insuffisant pour la part hors forfait. Achetez un pack ou changez de forfait dans Paramètres &gt; Abonnement.</span>
              </div>
            ) : beyondProfiles === 0 ? (
              <div className="text-[10px] text-muted-foreground">
                Tout est compris dans votre forfait, aucun crédit ne sera débité.
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground">
                Aucun crédit consommé pour les profils dont l'email ou le téléphone est déjà connu, ni si rien n'est trouvé.
              </div>
            )}
          </div>

          {/* Confirmation FORTE si > seuil */}
          {requireStrongConfirm && !insufficientCredits && (
            <label className="flex items-start gap-2.5 px-3 py-2.5 border-2 border-warning/50 bg-warning/5 rounded-lg cursor-pointer">
              <Checkbox
                checked={strongConfirmChecked}
                onCheckedChange={(c) => setStrongConfirmChecked(c === true)}
                className="mt-0.5"
              />
              <div className="flex-1 text-xs">
                <div className="font-bold text-foreground flex items-center gap-1.5">
                  <AlertTriangle className="w-3.5 h-3.5 text-warning" aria-hidden="true" />
                  Action volumineuse
                </div>
                <div className="text-muted-foreground mt-0.5">
                  Je comprends que cette action concerne {count} profils
                  {maxCost > 0
                    ? ` et peut consommer jusqu'à ${maxCost} crédits Konekt en plus du forfait.`
                    : ' et consomme le forfait de contacts inclus.'}
                </div>
              </div>
            </label>
          )}

          <AlertDialogFooter>
            <AlertDialogCancel disabled={submitting}>Annuler</AlertDialogCancel>
            {insufficientCredits ? (
              <AlertDialogAction
                onClick={() => { setOpen(false); navigate('/settings?tab=credits'); }}
                className="bg-info hover:bg-info/90"
              >
                Acheter des crédits
              </AlertDialogAction>
            ) : (
              <AlertDialogAction
                onClick={handleConfirm}
                disabled={!canSubmit || submitting || isFreePlan}
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin mr-1.5" aria-hidden="true" />
                    Démarrage…
                  </>
                ) : (
                  `Lancer pour ${count} profil${count > 1 ? 's' : ''}`
                )}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

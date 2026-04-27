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
 *      - Coût total maximum (avec breakdown)
 *      - Solde Konekt actuel
 *      - Confirmation FORTE si > 25 profils (checkbox obligatoire)
 *   2. Confirme → POST enrich-candidate-contact pour chaque profil en parallèle
 *      (max 10 concurrent pour ne pas tuer le backend)
 *   3. Toast "N enrichments démarrés"
 *   4. Cascade lookup gratuit côté backend pour chaque profil
 *      → seuls les inconnus déclenchent BC payant
 *   5. L'user voit les contacts apparaître au fur et à mesure (via le
 *      EnrichContactButton individuel sur chaque card)
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
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { useNavigate } from 'react-router-dom';
import { toast } from 'sonner';

interface BulkEnrichButtonProps {
  profiles: LinkedInProfile[];
  /** Hard limit (default 100, matche la limite Better Contact) */
  maxBatch?: number;
  /** Au-delà de ce seuil, on demande une confirmation forte (checkbox) */
  strongConfirmThreshold?: number;
  onComplete?: (enrichedCount: number) => void;
}

function getCurrentCompany(profile: LinkedInProfile): string | undefined {
  const current = profile.work_experience?.find((j: any) => j.current || !j.end)
    || profile.work_experience?.[0];
  return current?.company || undefined;
}

/** Helper : exécute une liste d'opérations async en limitant la concurrence */
async function pMapConcurrent<T, R>(
  items: T[],
  fn: (item: T, index: number) => Promise<R>,
  concurrency = 10,
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
  const navigate = useNavigate();

  const eligibleProfiles = profiles.filter(p => p.profile_url || p.public_profile_url);
  const count = Math.min(eligibleProfiles.length, maxBatch);
  const tooMany = eligibleProfiles.length > maxBatch;

  const costPerProfile = (withEmail ? 1 : 0) + (withPhone ? 10 : 0);
  const maxCost = costPerProfile * count;
  const insufficientCredits = maxCost > creditsRemaining;
  const requireStrongConfirm = count > strongConfirmThreshold;
  const canSubmit = (withEmail || withPhone)
    && !insufficientCredits
    && (!requireStrongConfirm || strongConfirmChecked)
    && count > 0;

  const handleConfirm = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);

    const targets = eligibleProfiles.slice(0, maxBatch);
    let started = 0;
    let cached = 0;
    let blocked = 0;
    let failed = 0;

    // Toast de démarrage
    toast.info(`Démarrage de ${targets.length} enrichments…`, { id: 'bulk-enrich' });

    await pMapConcurrent(targets, async (profile) => {
      try {
        const linkedinUrl = profile.profile_url || profile.public_profile_url;
        if (!linkedinUrl) return;
        const company = getCurrentCompany(profile);

        const { data } = await invokeEdgeFunction<{
          success: boolean;
          cached?: boolean;
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

        if (!data?.success) {
          if (data?.error_code === 'INSUFFICIENT_CREDITS') {
            // On stop la suite (futile)
            blocked++;
            throw new Error('insufficient_credits');
          }
          if (data?.error_code === 'GDPR_ERASED') {
            blocked++;
            return;
          }
          failed++;
          return;
        }

        if (data.cached) {
          cached++;
        } else {
          started++;
        }
      } catch {
        failed++;
      }
    }, 10);

    setSubmitting(false);
    setOpen(false);
    setStrongConfirmChecked(false);

    invalidateBalance();
    onComplete?.(started + cached);

    // Toast récapitulatif
    const parts: string[] = [];
    if (cached > 0) parts.push(`${cached} déjà connus (gratuit)`);
    if (started > 0) parts.push(`${started} en cours (~30s à 3min)`);
    if (blocked > 0) parts.push(`${blocked} bloqués`);
    if (failed > 0) parts.push(`${failed} erreurs`);

    toast.success(`${started + cached} enrichments lancés`, {
      id: 'bulk-enrich',
      description: parts.join(' · '),
    });
  };

  // Si moins de 1 profil eligible, on cache le bouton
  if (eligibleProfiles.length === 0) return null;

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="p-1 hover:bg-muted rounded-sm text-muted-foreground hover:text-foreground"
        title={`Enrichir email/téléphone des ${count} profil${count > 1 ? 's' : ''} sélectionné${count > 1 ? 's' : ''}`}
      >
        <Sparkles className="w-3.5 h-3.5" aria-hidden="true" />
      </button>

      <AlertDialog open={open} onOpenChange={setOpen}>
        <AlertDialogContent className="max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle>
              Enrichir {count} profil{count > 1 ? 's' : ''}
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
                  Sources gratuites (LinkedIn, cache, ATS) tentées en premier
                  pour économiser des crédits.
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
                  1 crédit × {count} profil{count > 1 ? 's' : ''} = max <span className="font-bold">{count}</span> crédits
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
                  10 crédits × {count} profil{count > 1 ? 's' : ''} = max <span className="font-bold">{count * 10}</span> crédits
                </div>
              </div>
            </label>
          </div>

          {/* Coût total + solde */}
          <div className={`border rounded-lg px-3 py-2 text-xs space-y-1 ${
            insufficientCredits ? 'border-destructive/50 bg-destructive/5' : 'border-border bg-muted/40'
          }`}>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Coût maximum total :</span>
              <span className="font-bold tabular-nums text-foreground">{maxCost} crédits</span>
            </div>
            <div className="flex items-center justify-between">
              <span className="text-muted-foreground">Votre solde :</span>
              <span className={`font-bold tabular-nums ${insufficientCredits ? 'text-destructive' : 'text-foreground'}`}>
                {creditsRemaining} crédits
              </span>
            </div>
            {insufficientCredits ? (
              <div className="flex items-start gap-1.5 text-destructive pt-1 border-t border-destructive/30">
                <AlertTriangle className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" />
                <span>Solde insuffisant. Achetez un pack pour continuer.</span>
              </div>
            ) : (
              <div className="text-[10px] text-muted-foreground">
                ✓ Aucun crédit consommé pour les profils dont l'email/phone est déjà connu
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
                  Je comprends que cette action enrichira {count} profils
                  et consommera jusqu'à {maxCost} crédits Konekt.
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
                disabled={!canSubmit || submitting}
              >
                {submitting ? (
                  <>
                    <Loader2 className="w-3 h-3 animate-spin mr-1.5" aria-hidden="true" />
                    Démarrage…
                  </>
                ) : (
                  `Lancer l'enrichment de ${count} profil${count > 1 ? 's' : ''}`
                )}
              </AlertDialogAction>
            )}
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

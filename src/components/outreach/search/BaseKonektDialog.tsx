/**
 * BaseKonektDialog : présentation et activation de la Base Konekt depuis le
 * panneau de recherche (lot K).
 *
 * Affiché quand la Base Konekt n'est pas encore activée : c'est le seul endroit
 * où un membre découvre la source, son quota inclus et son coût. L'activation
 * elle-même est refaite côté serveur par set_base_konekt_enabled (rôle et plan).
 */

import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Database } from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { useBaseKonektState } from '@/hooks/useBaseKonekt';

interface BaseKonektDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Appelé après une activation réussie : la source passe sur la Base Konekt. */
  onActivated?: () => void;
}

export const BaseKonektDialog = ({ open, onOpenChange, onActivated }: BaseKonektDialogProps) => {
  const navigate = useNavigate();
  const {
    state, isLoading, planAllows, canActivate, includedMonthly, isTrialing, setEnabled, isSaving,
  } = useBaseKonektState();
  const [activating, setActivating] = useState(false);

  const creditsPerSearch = state?.credits_per_search ?? 2;
  const creditsPerProfile = state?.credits_per_profile ?? 2;

  const handleActivate = async () => {
    setActivating(true);
    try {
      await setEnabled(true);
      onActivated?.();
      onOpenChange(false);
    } catch {
      // Le hook a déjà affiché le refus (rôle ou plan) : la boîte reste ouverte.
    } finally {
      setActivating(false);
    }
  };

  // Ce à quoi la formule en cours donne droit, avant même de parler de crédits.
  // Tant que l'état n'est pas chargé, ne rien affirmer sur le plan.
  let planLine: string;
  if (isLoading) {
    planLine = 'Chargement de votre formule.';
  } else if (!planAllows) {
    planLine = 'La Base Konekt est disponible à partir de la formule Solo.';
  } else if (includedMonthly > 0) {
    planLine = isTrialing
      ? `Pendant l'essai, ${includedMonthly} recherches sont incluses. Le forfait complet de votre formule s'applique dès le premier paiement.`
      : `Votre formule comprend ${includedMonthly} recherches incluses par mois.`;
  } else {
    planLine = 'Votre formule ne comprend pas de recherche incluse : la Base Konekt est facturée en crédits.';
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Database className="w-4 h-4" />
            Base Konekt
          </DialogTitle>
          <DialogDescription>
            Une base de profils professionnels que vous consultez sans compte LinkedIn. Elle prend le
            relais quand la recherche LinkedIn est limitée.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 text-sm text-muted-foreground">
          <p>{planLine}</p>
          <p>
            {includedMonthly > 0
              ? `Page de 20 profils : ${creditsPerSearch} crédits une fois vos recherches incluses épuisées.`
              : `Page de 20 profils : ${creditsPerSearch} crédits.`}
          </p>
          <p>
            Fiche complète : {creditsPerProfile} crédits, qu'il reste ou non des recherches incluses.
          </p>
          <p className="text-xs">
            Les profils viennent de sources professionnelles publiques. Le sous-traitant qui les fournit
            figure sur la{' '}
            <Link to="/privacy" className="underline underline-offset-2 hover:text-foreground">
              page confidentialité
            </Link>
            .
          </p>
          {planAllows && !canActivate && (
            <p className="text-xs">Demandez à un administrateur de votre organisation.</p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Fermer
          </Button>
          {canActivate && (
            <Button onClick={handleActivate} disabled={activating || isSaving}>
              Activer la Base Konekt
            </Button>
          )}
          {!isLoading && !planAllows && (
            <Button onClick={() => navigate('/pricing')}>Voir les plans</Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};

/**
 * WelcomeOnboardingModal — modale 3 étapes pour les users qui viennent
 * d'accepter une invitation team Konekt.
 *
 * Trigger : flag `konekt_welcome_pending` en localStorage, set par Auth.tsx
 * juste après une acceptInvitation réussie.
 *
 * Affichée par AppLayout au mount de l'app. Dismiss → flag retiré.
 *
 * Étapes :
 *   1. Bienvenue dans l'équipe (org name + nom de l'inviter si dispo)
 *   2. Connectez votre LinkedIn (CTA → Paramètres › Connexions)
 *   3. Découvrez les missions actives (CTA → /missions)
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/IconTile';
import { Linkedin, Target, Users, ArrowRight, ChevronLeft, Check } from 'lucide-react';
import { useOrganization } from '@/hooks/useOrganization';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { cn } from '@/lib/utils';

const WELCOME_PENDING_KEY = 'konekt_welcome_pending';

/** Marque qu'un user vient d'accepter une invitation — appelé par Auth.tsx */
export function markWelcomePending() {
  try {
    localStorage.setItem(WELCOME_PENDING_KEY, '1');
  } catch {
    // localStorage indispo (private mode) : on ignore, l'user verra pas l'onboarding
  }
}

/** Vérifie si on doit afficher l'onboarding (et clear le flag) */
export function shouldShowWelcome(): boolean {
  try {
    const v = localStorage.getItem(WELCOME_PENDING_KEY);
    return v === '1';
  } catch {
    return false;
  }
}

/** Clear le flag (à appeler quand user dismiss / finish la modale) */
export function clearWelcomePending() {
  try {
    localStorage.removeItem(WELCOME_PENDING_KEY);
  } catch {
    // noop
  }
}

interface WelcomeOnboardingModalProps {
  /** Si non fourni, le composant lit lui-même le flag localStorage au mount */
  forceOpen?: boolean;
}

export const WelcomeOnboardingModal: React.FC<WelcomeOnboardingModalProps> = ({
  forceOpen,
}) => {
  const [open, setOpen] = useState<boolean>(() => forceOpen ?? shouldShowWelcome());
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const navigate = useNavigate();
  const { organization } = useOrganization();
  const { accounts } = useLinkedInAccounts();

  // Step 2 : si l'user a déjà un compte LinkedIn connecté (case rare premier login
  // mais possible si compte préexistant), on saute au step 3 automatiquement
  const hasLinkedIn = accounts.length > 0;

  const handleClose = () => {
    setOpen(false);
    clearWelcomePending();
  };

  const handleConnectLinkedIn = () => {
    handleClose();
    // Paramètres › Connexions (où se trouve MyLinkedInAccount)
    navigate('/settings/account/connections');
  };

  const handleGoToMissions = () => {
    handleClose();
    navigate('/missions');
  };

  const handleNext = () => {
    if (step === 1) setStep(hasLinkedIn ? 3 : 2);
    else if (step === 2) setStep(3);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) handleClose(); }}>
      <DialogContent className="max-w-md p-0">
        {/* Visually hidden title for a11y */}
        <DialogTitle className="sr-only">Bienvenue sur Konekt</DialogTitle>

        {/* Progression : trois étapes, l'étape en cours en accent */}
        <div className="flex items-center justify-center gap-2 pt-6" aria-hidden="true">
          {[1, 2, 3].map((n) => (
            <span
              key={n}
              className={cn(
                'h-1.5 rounded-full transition-[width,background-color] duration-200',
                n === step ? 'w-8 bg-brand' : n < step ? 'w-1.5 bg-foreground-secondary' : 'w-1.5 bg-border-strong',
              )}
            />
          ))}
        </div>
        <p className="sr-only" aria-live="polite">Étape {step} sur 3</p>

        {/* Step 1 : Bienvenue */}
        {step === 1 && (
          <div className="space-y-4 px-6 py-8 text-center">
            <IconTile icon={Users} size="lg" className="mx-auto" aria-hidden="true" />
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-foreground">
                Bienvenue dans l'équipe {organization?.name || 'Konekt'}
              </h2>
              <p className="text-sm text-muted-foreground">
                Vous venez de rejoindre Konekt. En 2 minutes, on vous montre comment
                lancer votre premier sourcing.
              </p>
            </div>
            <Button variant="primary" onClick={handleNext} className="mt-4 w-full min-h-11 md:min-h-0">
              Commencer
              <ArrowRight aria-hidden="true" />
            </Button>
            <Button variant="ghost" size="sm" onClick={handleClose} className="text-muted-foreground min-h-11 md:min-h-0">
              Passer le tutoriel
            </Button>
          </div>
        )}

        {/* Step 2 : Connecter LinkedIn */}
        {step === 2 && (
          <div className="space-y-4 px-6 py-8 text-center">
            <IconTile icon={Linkedin} size="lg" className="mx-auto" aria-hidden="true" />
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-foreground">
                Connectez votre LinkedIn
              </h2>
              <p className="text-sm text-muted-foreground">
                Konekt utilise <strong className="font-semibold text-foreground">votre compte LinkedIn</strong> pour
                le sourcing. Aucun coût supplémentaire : vous gardez toutes vos connexions et vos messages.
              </p>
              <p className="text-xs text-muted-foreground">
                LinkedIn Recruiter ou Sales Navigator est recommandé pour les filtres avancés. LinkedIn Classic
                fonctionne aussi.
              </p>
            </div>
            <Button variant="primary" onClick={handleConnectLinkedIn} className="mt-4 w-full min-h-11 md:min-h-0">
              Connecter mon LinkedIn
              <ArrowRight aria-hidden="true" />
            </Button>
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={() => setStep(1)} className="text-muted-foreground min-h-11 md:min-h-0">
                <ChevronLeft aria-hidden="true" />
                Retour
              </Button>
              <Button variant="ghost" size="sm" onClick={handleNext} className="text-muted-foreground min-h-11 md:min-h-0">
                Plus tard
              </Button>
            </div>
          </div>
        )}

        {/* Step 3 : Découvrir les missions */}
        {step === 3 && (
          <div className="space-y-4 px-6 py-8 text-center">
            <IconTile icon={Target} size="lg" className="mx-auto" aria-hidden="true" />
            <div className="space-y-2">
              <h2 className="text-xl font-semibold text-foreground">
                {hasLinkedIn ? 'Tout est prêt' : 'Vous y êtes presque'}
              </h2>
              <p className="text-sm text-muted-foreground">
                Découvrez les missions actives de votre équipe. Ouvrez-en une pour
                lancer votre première recherche de candidats.
              </p>
              {hasLinkedIn && (
                <Badge variant="success">
                  <Check className="h-3 w-3" aria-hidden="true" />
                  LinkedIn connecté
                </Badge>
              )}
            </div>
            <Button variant="primary" onClick={handleGoToMissions} className="mt-4 w-full min-h-11 md:min-h-0">
              Voir les missions
              <ArrowRight aria-hidden="true" />
            </Button>
            <div className="flex items-center justify-between">
              <Button variant="ghost" size="sm" onClick={() => setStep(hasLinkedIn ? 1 : 2)} className="text-muted-foreground min-h-11 md:min-h-0">
                <ChevronLeft aria-hidden="true" />
                Retour
              </Button>
              <Button variant="ghost" size="sm" onClick={handleClose} className="text-muted-foreground min-h-11 md:min-h-0">
                Fermer
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

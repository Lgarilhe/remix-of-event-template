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
 *   2. Connectez votre LinkedIn (CTA → Settings > Connecteurs)
 *   3. Découvrez les missions actives (CTA → /missions)
 */

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Linkedin, Target, Sparkles, ArrowRight, ChevronLeft, X, Check } from 'lucide-react';
import { useOrganization } from '@/hooks/useOrganization';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';

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
    // Settings > Connecteurs (où se trouve MyLinkedInAccount)
    navigate('/settings?tab=connectors');
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
      <DialogContent className="max-w-md p-0 overflow-hidden">
        {/* Visually hidden title for a11y */}
        <DialogTitle className="sr-only">Bienvenue sur Konekt</DialogTitle>

        {/* Progress dots */}
        <div className="flex items-center justify-center gap-2 pt-6">
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              className={`h-1.5 rounded-full transition-all ${
                n === step ? 'w-8 bg-foreground' : 'w-1.5 bg-muted'
              }`}
            />
          ))}
        </div>

        {/* Step 1 — Bienvenue */}
        {step === 1 && (
          <div className="px-6 py-8 text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-foreground text-background flex items-center justify-center">
              <Sparkles className="w-7 h-7" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-foreground">
                Bienvenue dans l'équipe {organization?.name || 'Konekt'} 👋
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Vous venez de rejoindre Konekt. En 2 minutes, on vous montre comment
                lancer votre premier sourcing.
              </p>
            </div>
            <Button onClick={handleNext} className="w-full mt-4">
              Commencer
              <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
            <button
              onClick={handleClose}
              className="text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              Passer le tutoriel
            </button>
          </div>
        )}

        {/* Step 2 — Connecter LinkedIn */}
        {step === 2 && (
          <div className="px-6 py-8 text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-info/10 text-info flex items-center justify-center">
              <Linkedin className="w-7 h-7" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-foreground">
                Connectez votre LinkedIn
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Konekt utilise <strong>votre compte LinkedIn</strong> pour faire le
                sourcing. Aucun coût supplémentaire — vous gardez toutes vos
                connexions et messages.
              </p>
              <p className="text-xs text-muted-foreground italic">
                LinkedIn Recruiter ou Sales Navigator recommandé pour les filtres
                avancés. Classic fonctionne aussi.
              </p>
            </div>
            <Button onClick={handleConnectLinkedIn} className="w-full mt-4">
              Connecter mon LinkedIn
              <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
            <div className="flex items-center justify-between text-xs">
              <button
                onClick={() => setStep(1)}
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                <ChevronLeft className="w-3 h-3" />
                Retour
              </button>
              <button
                onClick={handleNext}
                className="text-muted-foreground hover:text-foreground"
              >
                Plus tard →
              </button>
            </div>
          </div>
        )}

        {/* Step 3 — Découvrir les missions */}
        {step === 3 && (
          <div className="px-6 py-8 text-center space-y-4">
            <div className="w-14 h-14 mx-auto rounded-2xl bg-success/10 text-success flex items-center justify-center">
              <Target className="w-7 h-7" />
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-foreground">
                {hasLinkedIn ? 'Vous êtes prêt·e !' : 'Vous y êtes presque'}
              </h2>
              <p className="text-sm text-muted-foreground leading-relaxed">
                Découvrez les missions actives de votre équipe. Ouvrez-en une pour
                lancer votre première recherche de candidats.
              </p>
              {hasLinkedIn && (
                <div className="inline-flex items-center gap-1.5 text-xs text-success bg-success/10 px-2.5 py-1 rounded-full">
                  <Check className="w-3 h-3" />
                  LinkedIn connecté
                </div>
              )}
            </div>
            <Button onClick={handleGoToMissions} className="w-full mt-4">
              Voir les missions
              <ArrowRight className="w-4 h-4 ml-1.5" />
            </Button>
            <div className="flex items-center justify-between text-xs">
              <button
                onClick={() => setStep(hasLinkedIn ? 1 : 2)}
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                <ChevronLeft className="w-3 h-3" />
                Retour
              </button>
              <button
                onClick={handleClose}
                className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1"
              >
                <X className="w-3 h-3" />
                Fermer
              </button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

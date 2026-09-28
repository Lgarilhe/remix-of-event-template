import React, { Suspense } from 'react';
import { useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { AppHeader } from '@/components/AppHeader';
import { WelcomeOnboardingModal } from '@/components/onboarding/WelcomeOnboardingModal';
import { GoShortcuts } from '@/components/layout/GoShortcuts';
import { Spinner } from '@/components/ui/spinner';
import { LowCreditBanner } from '@/components/ai/LowCreditBanner';
import { TrialBanner } from '@/components/billing/TrialBanner';

// État replié de la barre, écrit par SidebarProvider dans le cookie sidebar:state.
function readSidebarOpen(): boolean {
  try {
    const match = document.cookie.match(/(?:^|;\s*)sidebar:state=(true|false)/);
    return match ? match[1] === 'true' : true;
  } catch {
    return true;
  }
}

// Chargement d'une page : seule la zone principale attend, la barre et
// l'en-tête restent affichés (le Suspense global d'App.tsx remplaçait tout l'écran).
const pageFallback = (
  <div className="flex flex-1 items-center justify-center py-24">
    <Spinner label="Chargement de la page" />
  </div>
);

export const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const reduceMotion = useReducedMotion();
  const [sidebarDefaultOpen] = React.useState(readSidebarOpen);
  // Les rubriques des Paramètres partagent une clé : changer de rubrique ne remonte ni la coquille ni sa navigation.
  const transitionKey = location.pathname.startsWith('/settings/') ? '/settings' : location.pathname;

  return (
    <SidebarProvider defaultOpen={sidebarDefaultOpen}>
      <a href="#main-content" className="skip-to-content">
        Aller au contenu principal
      </a>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <AppHeader />
          <main id="main-content" className="flex-1 min-h-0 flex flex-col">
            {/* Bandeaux de compte (essai, crédits IA) : sous l'en-tête, à côté de la barre latérale */}
            <div className="shrink-0">
              <LowCreditBanner />
              <TrialBanner />
            </div>
            {/* Transition de route enter-only : le contenu fade + glisse de 6px
                à chaque changement de pathname, la sidebar/header restent
                stables (AppLayout n'est pas remonté entre les routes). Pas
                d'AnimatePresence : une exit-animation remonterait la page
                sortante et coûterait un aller-retour de layout. */}
            <motion.div
              key={transitionKey}
              initial={reduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="flex-1 min-h-0 flex flex-col"
            >
              <Suspense fallback={pageFallback}>{children}</Suspense>
            </motion.div>
          </main>
        </div>
      </div>
      {/* Onboarding 3 étapes pour les users qui viennent d'accepter une invitation.
          Auto-detect via flag localStorage konekt_welcome_pending (set par Auth.tsx). */}
      <WelcomeOnboardingModal />

      {/* G puis une lettre (G D, G M…) : navigation au clavier dans l'application */}
      <GoShortcuts />
    </SidebarProvider>
  );
};

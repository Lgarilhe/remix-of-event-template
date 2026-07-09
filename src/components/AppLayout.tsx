import React from 'react';
import { useLocation } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { AppHeader } from '@/components/AppHeader';
import { WelcomeOnboardingModal } from '@/components/onboarding/WelcomeOnboardingModal';
import { GlobalTaskShortcut } from '@/components/tasks/GlobalTaskShortcut';

export const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const location = useLocation();
  const reduceMotion = useReducedMotion();

  return (
    <SidebarProvider>
      <a href="#main-content" className="skip-to-content">
        Aller au contenu principal
      </a>
      <div className="min-h-screen flex w-full">
        <AppSidebar />
        <div className="flex-1 flex flex-col min-w-0">
          <AppHeader />
          <main id="main-content" className="flex-1 min-h-0 flex flex-col">
            {/* Transition de route enter-only : le contenu fade + glisse de 6px
                à chaque changement de pathname, la sidebar/header restent
                stables (AppLayout n'est pas remonté entre les routes). Pas
                d'AnimatePresence : une exit-animation remonterait la page
                sortante et coûterait un aller-retour de layout. */}
            <motion.div
              key={location.pathname}
              initial={reduceMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.22, ease: [0.22, 1, 0.36, 1] }}
              className="flex-1 min-h-0 flex flex-col"
            >
              {children}
            </motion.div>
          </main>
        </div>
      </div>
      {/* Onboarding 3 étapes pour les users qui viennent d'accepter une invitation.
          Auto-detect via flag localStorage konekt_welcome_pending (set par Auth.tsx). */}
      <WelcomeOnboardingModal />

      {/* Cmd+T / Ctrl+T global → ouvre CreateTaskModal n'importe où dans l'app */}
      <GlobalTaskShortcut />
    </SidebarProvider>
  );
};

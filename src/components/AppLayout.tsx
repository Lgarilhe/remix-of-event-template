import React from 'react';
import { SidebarProvider } from '@/components/ui/sidebar';
import { AppSidebar } from '@/components/AppSidebar';
import { AppHeader } from '@/components/AppHeader';
import { WelcomeOnboardingModal } from '@/components/onboarding/WelcomeOnboardingModal';

export const AppLayout: React.FC<{ children: React.ReactNode }> = ({ children }) => {
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
            {children}
          </main>
        </div>
      </div>
      {/* Onboarding 3 étapes pour les users qui viennent d'accepter une invitation.
          Auto-detect via flag localStorage konekt_welcome_pending (set par Auth.tsx). */}
      <WelcomeOnboardingModal />
    </SidebarProvider>
  );
};

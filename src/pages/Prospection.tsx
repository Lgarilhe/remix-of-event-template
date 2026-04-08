import React from 'react';
import { SEOHead } from '@/components/SEOHead';
import { VivierList } from '@/components/prospection/VivierList';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';

export default function Prospection() {
  return (
    <div className="w-full max-w-full bg-background">
      <SEOHead
        title="Prospection | Skalr"
        description="Retrouvez vos contacts et sociétés de prospection"
      />

      <div className="py-6 w-full max-w-full">
        <div className="max-w-[1600px] mx-auto w-full min-w-0 px-3 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="mb-5 sm:mb-6">
            <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
              Prospection
            </h1>
            <p className="text-xs sm:text-sm text-muted-foreground mt-1">
              Retrouvez vos contacts, sociétés et historique d'interactions.
            </p>
          </div>

          <SectionErrorBoundary fallbackTitle="Erreur dans la prospection">
            <VivierList />
          </SectionErrorBoundary>
        </div>
      </div>
    </div>
  );
}

import React from 'react';
import { SEOHead } from '@/components/SEOHead';
import { VivierList } from '@/components/prospection/VivierList';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { Building2 } from 'lucide-react';

export default function Prospection() {
  return (
    <div className="w-full max-w-full bg-background">
      <SEOHead
        title="Prospection | Skalr"
        description="Retrouvez vos contacts et sociétés de prospection"
      />

      <div className="py-6 w-full max-w-full">
        <div className="max-w-[1600px] mx-auto w-full min-w-0 px-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5 mb-4 sm:mb-6">
            <Building2 className="w-7 h-7 text-foreground" strokeWidth={1.5} />
            <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
              Prospection
            </h1>
          </div>

          <div className="bg-background border border-border p-3 sm:p-6 overflow-hidden">
            <SectionErrorBoundary fallbackTitle="Erreur dans la prospection">
              <VivierList />
            </SectionErrorBoundary>
          </div>
        </div>
      </div>
    </div>
  );
}

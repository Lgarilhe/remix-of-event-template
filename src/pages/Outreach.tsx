import React from 'react';
import { useSearchParams } from 'react-router-dom';
import { SEOHead } from '@/components/SEOHead';
import { ProjectsList } from '@/components/outreach/projects';
import { AnimatedCompass } from '@/components/ui/AnimatedCompass';
import { SectionErrorBoundary } from '@/components/SectionErrorBoundary';
import { VivierList } from '@/components/prospection/VivierList';

// ═══ Types exportés — utilisés par d'autres composants, NE PAS SUPPRIMER ═══

export interface LinkedInAccountSubscriptions {
  classic: boolean;
  recruiter: boolean;
  sales_navigator: boolean;
}

export interface LinkedInAccount {
  id: string;
  name: string;
  identifier: string;
  status: string;
  profile_picture_url?: string | null;
  subscriptions?: LinkedInAccountSubscriptions;
}

// ═══ Page ═══

export default function Outreach() {
  const [searchParams] = useSearchParams();
  const isProspectionView = searchParams.get('tab') === 'prospection';
  const pageTitle = isProspectionView ? 'Prospection' : 'Missions';
  const pageDescription = isProspectionView
    ? 'Retrouvez vos contacts et sociétés de prospection'
    : 'Gérez vos missions de recrutement et de sourcing';

  return (
    <div className="w-full max-w-full bg-background">
      <SEOHead
        title={`${pageTitle} | Skalr`}
        description={pageDescription}
      />

      <div className="py-6 w-full max-w-full">
        <div className="max-w-[1600px] mx-auto w-full min-w-0 px-3 sm:px-6 lg:px-8">
          <div className="flex items-center gap-2.5 mb-4 sm:mb-6">
            <AnimatedCompass size={32} speed={0.8} />
            <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
              {pageTitle}
            </h1>
          </div>

          <div className="bg-background border border-border p-3 sm:p-6 overflow-hidden">
            {isProspectionView ? (
              <SectionErrorBoundary fallbackTitle="Erreur dans la prospection">
                <VivierList />
              </SectionErrorBoundary>
            ) : (
              <ProjectsList />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

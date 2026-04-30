import React from 'react';
import { SEOHead } from '@/components/SEOHead';
import { ProjectsList } from '@/components/outreach/projects';
import { ProjectsListV2 } from '@/components/outreach/projects/ProjectsListV2';
import { AnimatedCompass } from '@/components/ui/AnimatedCompass';
import { useFlag } from '@/lib/featureFlags';

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
  // Feature flag : nouvelle liste cohérente avec la DA v2.
  // Pour activer : localStorage.setItem('konekt:flag:mission_v2', 'true')
  const useV2 = useFlag('mission_v2');

  return (
    <div className="w-full max-w-full bg-background">
      <SEOHead
        title="Missions | Skalr"
        description="Gérez vos missions de recrutement et de sourcing"
      />

      <div className="py-6 w-full max-w-full">
        <div className="max-w-[1600px] mx-auto w-full min-w-0 px-3 sm:px-6 lg:px-8">
          {useV2 ? (
            <ProjectsListV2 />
          ) : (
            <>
              <div className="flex items-center gap-2.5 mb-4 sm:mb-6">
                <AnimatedCompass size={32} speed={0.8} />
                <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">
                  Missions
                </h1>
              </div>
              <div className="bg-background border border-border p-3 sm:p-6 overflow-hidden">
                <ProjectsList />
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

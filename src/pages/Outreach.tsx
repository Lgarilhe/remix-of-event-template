import React from 'react';
import { SEOHead } from '@/components/SEOHead';
import { ProjectsListV2 } from '@/components/outreach/projects/ProjectsListV2';

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
//
// Refonte 2026-05-06 : suppression du feature flag `mission_v2`.
// ProjectsListV2 (la DA v2 cohérente avec le reste de l'app) devient
// le default. L'ancien ProjectsList v0 brutaliste est retiré.

export default function Outreach() {
  return (
    <div className="w-full max-w-full bg-background">
      <SEOHead
        title="Missions | Skalr"
        description="Gérez vos missions de recrutement et de sourcing"
      />

      <div className="py-6 w-full max-w-full">
        <div className="max-w-[1600px] mx-auto w-full min-w-0 px-3 sm:px-6 lg:px-8">
          <ProjectsListV2 />
        </div>
      </div>
    </div>
  );
}

/**
 * Marketplace : cercle fermé de recruteurs partenaires (lot M, 2026-09-07).
 *
 * Quatre cas selon le type d'organisation et le statut partenaire :
 *   - cabinet ou indépendant non partenaire : carte « Cercle partenaires » (demande) ;
 *   - partenaire actif : missions ouvertes, mes candidatures, missions en cours ;
 *   - entreprise : ses missions publiées et leurs candidatures ;
 *   - organisation sans type : message neutre.
 * En bas, le panneau d'administration du cercle pour l'équipe Konekt.
 */

import React from 'react';
import { Target } from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { useOrganization } from '@/hooks/useOrganization';
import { usePartnerState } from '@/hooks/useMarketplace';
import { PartnerCircleCard } from '@/components/marketplace/PartnerCircleCard';
import { PartnerMarketplace } from '@/components/marketplace/PartnerMarketplace';
import { EnterpriseHuntMissions } from '@/components/marketplace/EnterpriseHuntMissions';
import { PlatformAdminPanel } from '@/components/marketplace/PlatformAdminPanel';

export default function Marketplace() {
  const { orgType, isLoading: orgLoading } = useOrganization();
  const { isPartner, isLoading: partnerLoading } = usePartnerState();

  const isRecruiterOrg = orgType === 'agency' || orgType === 'freelance';
  const isEnterprise = orgType === 'enterprise';

  const subtitle = isEnterprise
    ? 'Vos missions proposées aux recruteurs partenaires'
    : isRecruiterOrg
      ? (isPartner ? 'Missions confiées par les entreprises' : 'Cercle de recruteurs partenaires')
      : 'Missions en mode chasse';

  let body: React.ReactNode;
  if (orgLoading || (isRecruiterOrg && partnerLoading)) {
    body = (
      <div className="flex items-center justify-center py-20">
        <div className="w-5 h-5 border border-border border-t-foreground animate-spin" />
      </div>
    );
  } else if (isEnterprise) {
    body = <EnterpriseHuntMissions />;
  } else if (isRecruiterOrg && isPartner) {
    body = <PartnerMarketplace />;
  } else if (isRecruiterOrg) {
    body = (
      <div className="max-w-2xl">
        <PartnerCircleCard />
      </div>
    );
  } else {
    body = (
      <div className="border border-border p-12 text-center">
        <Target className="w-8 h-8 text-muted-foreground mx-auto mb-4" />
        <p className="text-xs text-muted-foreground">
          La marketplace n'est pas disponible pour cette organisation.
        </p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <SEOHead title="Marketplace | Konekt" description="Missions en mode chasse et cercle de recruteurs partenaires" />

      <div className="py-6 pb-14">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-3">
              <Target className="w-6 h-6 text-foreground" />
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">Marketplace</h1>
                <p className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">{subtitle}</p>
              </div>
            </div>
          </div>

          {body}

          <PlatformAdminPanel />
        </div>
      </div>
    </div>
  );
}

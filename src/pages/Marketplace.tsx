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
import { Link } from 'react-router-dom';
import { Target } from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { useOrganization } from '@/hooks/useOrganization';
import { usePartnerState } from '@/hooks/useMarketplace';
import { PartnerCircleCard } from '@/components/marketplace/PartnerCircleCard';
import { PartnerMarketplace } from '@/components/marketplace/PartnerMarketplace';
import { PartnerMissionsSection } from '@/components/marketplace/PartnerMissionsSection';
import { EnterpriseHuntMissions } from '@/components/marketplace/EnterpriseHuntMissions';
import { PlatformAdminPanel } from '@/components/marketplace/PlatformAdminPanel';

export default function Marketplace() {
  const { orgType, isLoading: orgLoading } = useOrganization();
  const { state: partnerState, isPartner, isLoading: partnerLoading } = usePartnerState();
  const isSuspended = partnerState?.status === 'suspended';

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
  } else if (isRecruiterOrg && isSuspended) {
    body = (
      <div className="space-y-6">
        <div className="max-w-2xl">
          <PartnerCircleCard />
        </div>
        <PartnerMissionsSection />
      </div>
    );
  } else if (isRecruiterOrg) {
    body = (
      <div className="max-w-2xl">
        <PartnerCircleCard />
      </div>
    );
  } else {
    // Organisation sans type : le choix fait à l'inscription manque ou n'a pas
    // été enregistré. Le réglage est dans Paramètres, on y renvoie.
    body = (
      <div className="border border-border p-12 text-center max-w-2xl mx-auto space-y-3">
        <Target className="w-8 h-8 text-muted-foreground mx-auto" />
        <p className="text-sm text-foreground">
          Indiquez le type de votre organisation pour utiliser la marketplace.
        </p>
        <p className="text-xs text-muted-foreground">
          Une entreprise publie ses missions, un cabinet ou un indépendant rejoint le cercle
          de recruteurs partenaires.
        </p>
        <Link
          to="/settings"
          className="inline-flex items-center h-9 px-4 border border-border text-xs font-medium uppercase tracking-wider hover:bg-muted"
        >
          Ouvrir les paramètres
        </Link>
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

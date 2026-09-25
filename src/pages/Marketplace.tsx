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
import { EmptyState, PageHeader, PageLayout } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';
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
        <Spinner label="Chargement de la marketplace" />
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
      <EmptyState
        icon={Target}
        title="Indiquez le type de votre organisation"
        description="Une entreprise publie ses missions, un cabinet ou un indépendant rejoint le cercle de recruteurs partenaires. Le type se choisit dans les paramètres de l'organisation."
        action={
          <Button asChild variant="outline" className="min-h-11 md:min-h-0">
            <Link to="/settings/org/general">Ouvrir les paramètres</Link>
          </Button>
        }
        className="max-w-2xl"
      />
    );
  }

  return (
    <PageLayout>
      <SEOHead title="Marketplace | Konekt" description="Missions en mode chasse et cercle de recruteurs partenaires" />
      <PageHeader title="Marketplace" subtitle={subtitle} />
      {body}
      <PlatformAdminPanel />
    </PageLayout>
  );
}

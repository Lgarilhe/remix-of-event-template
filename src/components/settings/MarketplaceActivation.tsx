/**
 * MarketplaceActivation : onglet Paramètres > Marketplace.
 * Entreprise : explication du mode chasse et lien vers /marketplace.
 * Cabinet ou indépendant : carte « Cercle partenaires » (demande et statut).
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { Target, ArrowRight, Loader2 } from 'lucide-react';
import { useOrganization } from '@/hooks/useOrganization';
import { IconTile } from '@/components/ui/IconTile';
import { PartnerCircleCard } from '@/components/marketplace/PartnerCircleCard';

const HuntModeCard: React.FC = () => (
  <div className="rounded-xl border border-border bg-card p-4 sm:p-6 space-y-4">
    <div className="flex items-center gap-3">
      <IconTile icon={Target} size="md" />
      <div>
        <h3 className="font-display text-sm font-bold tracking-tight text-foreground">Mode chasse</h3>
        <p className="text-xs text-muted-foreground mt-0.5">Proposez vos missions aux recruteurs partenaires</p>
      </div>
    </div>
    <div className="space-y-2 text-sm text-foreground/90 leading-relaxed">
      <p>
        Le mode chasse propose une mission aux recruteurs du cercle partenaires Konekt, contre un pourcentage
        du salaire annuel que vous fixez et qu'ils vous facturent directement à l'embauche.
      </p>
      <p>
        Vous l'activez dans la configuration de chaque mission (onglet Configuration), puis vous publiez.
        Vous acceptez ou refusez chaque candidature de recruteur.
      </p>
      <p>
        Le recruteur voit le titre du poste, le client, le lieu, le contrat, les compétences attendues et la
        rémunération. Une fois accepté, il travaille dans l'espace de la mission avec vous.
      </p>
    </div>
    <Link
      to="/marketplace"
      className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline underline-offset-4"
    >
      Voir mes missions publiées <ArrowRight className="w-3 h-3" />
    </Link>
  </div>
);

export const MarketplaceActivation: React.FC = () => {
  const { orgType, isLoading } = useOrganization();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center py-10">
        <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (orgType === 'enterprise') return <HuntModeCard />;
  if (orgType === 'agency' || orgType === 'freelance') return <PartnerCircleCard />;

  // Espace sans type : le réglage est juste au-dessus, dans l'onglet Général.
  return (
    <div className="rounded-xl border border-border bg-card p-6 space-y-2">
      <p className="text-sm text-foreground">
        Indiquez le type de votre organisation pour utiliser la marketplace.
      </p>
      <p className="text-xs text-muted-foreground">
        Une entreprise publie ses missions, un cabinet ou un indépendant rejoint le cercle de
        recruteurs partenaires. Le type se règle dans l'onglet Général.
      </p>
      <Link
        to="/settings"
        className="inline-flex items-center gap-1 text-xs font-medium text-foreground underline underline-offset-4"
      >
        Ouvrir l'onglet Général <ArrowRight className="w-3 h-3" />
      </Link>
    </div>
  );
};

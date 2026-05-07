import React from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { hasFeature, getOrgTypeLabel } from '@/lib/featureGates';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { Target, Shield, CheckCircle2, Circle, Link2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/IconTile';

interface FeatureActivation {
  id: string;
  feature: string;
  status: 'inactive' | 'pending_validation' | 'active' | 'suspended';
  contract_signed_at: string | null;
  checklist: Record<string, boolean>;
}

const STATUS_CONFIG: Record<string, { label: string; color: string }> = {
  inactive: { label: 'Non activé', color: 'text-muted-foreground' },
  pending_validation: { label: 'En attente de validation', color: 'text-warning' },
  active: { label: 'Activé', color: 'text-success' },
  suspended: { label: 'Suspendu', color: 'text-destructive' },
};

const HUNT_CHECKLIST = [
  { key: 'cgu_accepted', label: 'Accepter les CGU Marketplace Konekt' },
  { key: 'clauses_validated', label: 'Valider les clauses (paiement, garantie, confidentialité, RGPD)' },
  { key: 'payment_method', label: 'Ajouter un mode de paiement' },
  { key: 'contract_signed', label: 'Signer le contrat cadre' },
];

const RECRUIT_CHECKLIST = [
  { key: 'profile_complete', label: 'Compléter le profil agence/recruteur' },
  { key: 'cgu_accepted', label: 'Accepter les CGU Recruteur Marketplace' },
  { key: 'clauses_validated', label: 'Valider les clauses (non-sollicitation, confidentialité, qualité, RGPD)' },
  { key: 'verification', label: 'Vérification Konekt (SIRET, LinkedIn, références)' },
  { key: 'contract_signed', label: 'Signer le contrat' },
];

const PORTAL_CHECKLIST = [
  { key: 'data_sharing_accepted', label: 'Accepter les conditions de partage de données' },
  { key: 'permissions_configured', label: 'Configurer les permissions par défaut' },
];

interface ActivationCardProps {
  title: string;
  description: string;
  icon: typeof Target;
  feature: string;
  checklist: Array<{ key: string; label: string }>;
  activation: FeatureActivation | undefined;
  available: boolean;
}

const ActivationCard: React.FC<ActivationCardProps> = ({
  title, description, icon: Icon, checklist, activation, available,
}) => {
  const status = activation?.status || 'inactive';
  const cl = activation?.checklist || {};
  const completedCount = checklist.filter(c => cl[c.key]).length;

  if (!available) return null;

  return (
    <div className="rounded-xl border border-border bg-card p-4 sm:p-6">
      <div className="flex items-center justify-between mb-4">
        <div className="flex items-center gap-3">
          <IconTile icon={Icon} size="md" />
          <div>
            <h3 className="font-display text-sm font-bold tracking-tight text-foreground">{title}</h3>
            <p className="text-xs text-muted-foreground mt-0.5">{description}</p>
          </div>
        </div>
        <span className={cn(
          "px-2 py-0.5 rounded-full text-[10px] font-medium uppercase tracking-wider border",
          status === 'active' ? "bg-success/10 text-success border-success/30" :
          status === 'pending_validation' ? "bg-warning/10 text-warning border-warning/30" :
          "bg-muted text-muted-foreground border-border"
        )}>
          {STATUS_CONFIG[status]?.label || status}
        </span>
      </div>

      {/* Checklist */}
      <div className="space-y-1.5">
        {checklist.map(item => {
          const done = !!cl[item.key];
          return (
            <div key={item.key} className="flex items-center gap-3 px-3 py-2 rounded-lg border border-border bg-background">
              {done ? (
                <CheckCircle2 className="w-4 h-4 text-success shrink-0" />
              ) : (
                <Circle className="w-4 h-4 text-muted-foreground shrink-0" />
              )}
              <span className={cn(
                "text-xs",
                done ? "text-foreground" : "text-muted-foreground"
              )}>
                {item.label}
              </span>
            </div>
          );
        })}
      </div>

      {/* Progress */}
      <div className="mt-4 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {completedCount}/{checklist.length} étapes
        </p>
        {status !== 'active' && (
          <Button size="sm" className="rounded-full">
            {completedCount === 0 ? "Commencer l'activation" : 'Continuer'}
          </Button>
        )}
      </div>
    </div>
  );
};

export const MarketplaceActivation: React.FC = () => {
  const { organizationId, orgType } = useOrganization();

  const { data: activations = [] } = useQuery({
    queryKey: ['feature-activations', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from('feature_activations')
        .select('*')
        .eq('organization_id', organizationId);
      if (error) return [];
      return (data || []) as FeatureActivation[];
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  const getActivation = (feature: string) => activations.find(a => a.feature === feature);
  const canPublish = hasFeature(orgType, 'marketplace_publish');
  const canBrowse = hasFeature(orgType, 'marketplace_browse');
  const canPortal = hasFeature(orgType, 'client_portal');

  return (
    <div className="space-y-6">
      <ActivationCard
        title="Mode chasse"
        description="Publiez vos missions sur le réseau Konekt"
        icon={Target}
        feature="marketplace_publish"
        checklist={HUNT_CHECKLIST}
        activation={getActivation('marketplace_publish')}
        available={canPublish}
      />
      <ActivationCard
        title="Rejoindre le réseau"
        description="Accédez aux missions en mode chasse"
        icon={Shield}
        feature="marketplace_recruit"
        checklist={RECRUIT_CHECKLIST}
        activation={getActivation('marketplace_recruit')}
        available={canBrowse}
      />
      <ActivationCard
        title="Portail client"
        description="Donnez accès à vos clients pour suivre les candidatures"
        icon={Link2}
        feature="client_portal"
        checklist={PORTAL_CHECKLIST}
        activation={getActivation('client_portal')}
        available={canPortal}
      />
    </div>
  );
};

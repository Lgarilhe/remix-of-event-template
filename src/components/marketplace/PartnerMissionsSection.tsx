/**
 * PartnerMissionsSection : « Missions partenaires » sous la liste /missions
 * d'un cabinet ou d'un indépendant. Missions d'une autre organisation où
 * l'utilisateur a été accepté comme recruteur partenaire. Rien n'est rendu
 * pour une entreprise ou sans mission partenaire.
 */

import React, { useId } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Building2, Handshake, RefreshCw } from 'lucide-react';
import { useOrganization } from '@/hooks/useOrganization';
import { usePartnerMissions } from '@/hooks/useMarketplace';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { huntStatusLabel, huntStatusVariant } from './huntLabels';

export const PartnerMissionsSection: React.FC = () => {
  const { orgType } = useOrganization();
  const isRecruiterOrg = orgType === 'agency' || orgType === 'freelance';
  const { missions, isError, refetch } = usePartnerMissions(isRecruiterOrg);
  const titleId = useId();

  if (!isRecruiterOrg) return null;

  // Un échec de lecture ne doit pas faire disparaître la section en silence :
  // le partenaire perdrait l'accès à ses missions sans le savoir.
  if (isError) {
    return (
      <div role="alert" className="mb-6 flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
        <AlertTriangle className="h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
        <span>Vos missions partenaires n'ont pas pu être chargées.</span>
        <Button variant="outline" size="xs" onClick={refetch} className="min-h-11 md:min-h-0">
          <RefreshCw aria-hidden="true" />
          Réessayer
        </Button>
      </div>
    );
  }

  if (missions.length === 0) return null;

  return (
    <section aria-labelledby={titleId} className="mb-6">
      <div className="mb-3 flex items-center gap-2">
        <Handshake className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <div>
          <h2 id={titleId} className="eyebrow">Missions partenaires</h2>
          <p className="text-xs text-muted-foreground">
            {missions.length} mission{missions.length > 1 ? 's' : ''} confiée{missions.length > 1 ? 's' : ''} par une entreprise
          </p>
        </div>
      </div>
      <ul className="space-y-2">
        {missions.map((m) => (
          <li key={m.id}>
            <Link
              to={`/missions/${m.id}`}
              className="block rounded-xl border border-border bg-card p-4 ring-offset-background transition-colors duration-150 hover:border-border-strong hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
            >
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <h3 className="truncate text-md font-semibold text-foreground">{m.job_title || m.name}</h3>
                <Badge variant={huntStatusVariant(m.hunt_status)}>{huntStatusLabel(m.hunt_status)}</Badge>
              </div>
              <p className="inline-flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1">
                  <Building2 className="h-3 w-3" aria-hidden="true" /> {m.client_name || m.organization_name || 'Entreprise'}
                </span>
                {m.hunt_bounty_percent ? (
                  <>
                    <span aria-hidden="true">·</span>
                    <span>{m.hunt_bounty_percent} % du salaire annuel</span>
                  </>
                ) : null}
              </p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
};

export default PartnerMissionsSection;

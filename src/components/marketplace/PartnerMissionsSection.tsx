/**
 * PartnerMissionsSection : « Missions partenaires » sous la liste /missions
 * d'un cabinet ou d'un indépendant. Missions d'une autre organisation où
 * l'utilisateur a été accepté comme recruteur partenaire. Rien n'est rendu
 * pour une entreprise ou sans mission partenaire.
 */

import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Building2, Handshake } from 'lucide-react';
import { useOrganization } from '@/hooks/useOrganization';
import { usePartnerMissions } from '@/hooks/useMarketplace';
import { huntStatusLabel } from './huntLabels';

export const PartnerMissionsSection: React.FC = () => {
  const navigate = useNavigate();
  const { orgType } = useOrganization();
  const isRecruiterOrg = orgType === 'agency' || orgType === 'freelance';
  const { missions } = usePartnerMissions(isRecruiterOrg);

  if (!isRecruiterOrg || missions.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center gap-2 mb-3">
        <Handshake className="w-4 h-4 text-muted-foreground" />
        <div>
          <p className="text-[11px] text-muted-foreground uppercase tracking-wider font-semibold">
            Missions partenaires
          </p>
          <p className="text-[10px] text-muted-foreground/70">
            {missions.length} mission{missions.length > 1 ? 's' : ''} confiée{missions.length > 1 ? 's' : ''} par une entreprise
          </p>
        </div>
      </div>
      <div className="space-y-2">
        {missions.map((m) => (
          <button
            key={m.id}
            type="button"
            onClick={() => navigate(`/missions/${m.id}`)}
            className="w-full text-left bg-card border border-border rounded-xl p-4 transition-all duration-200 hover:border-foreground/30 hover:shadow-md hover:-translate-y-px"
          >
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h3 className="font-semibold text-[14px] truncate">{m.job_title || m.name}</h3>
              <span className="inline-flex items-center text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground">
                {huntStatusLabel(m.hunt_status)}
              </span>
            </div>
            <p className="text-[12px] text-muted-foreground inline-flex items-center gap-2 flex-wrap">
              <span className="inline-flex items-center gap-1">
                <Building2 className="w-3 h-3" /> {m.client_name || m.organization_name || 'Entreprise'}
              </span>
              {m.hunt_bounty_percent ? (
                <>
                  <span className="text-muted-foreground/40">·</span>
                  <span>{m.hunt_bounty_percent} % du salaire annuel</span>
                </>
              ) : null}
            </p>
          </button>
        ))}
      </div>
    </div>
  );
};

export default PartnerMissionsSection;

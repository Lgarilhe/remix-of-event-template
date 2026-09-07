/**
 * EnterpriseHuntMissions : « Vos missions sur la marketplace » pour une
 * entreprise. Deux groupes : les missions proposées aux recruteurs et celles
 * encore en préparation. Chaque ligne montre les candidatures en attente et
 * les recruteurs acceptés.
 */

import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Target, Users, Clock, Calendar, ArrowRight } from 'lucide-react';
import { useMyHuntMissions, type MyHuntMission } from '@/hooks/useMarketplace';
import { huntStatusLabel, formatDate } from './huntLabels';
import { ErrorBox } from './ErrorBox';

const OPEN_STATUSES = new Set(['published', 'in_progress', 'filled', 'cancelled']);

const MissionRow: React.FC<{ mission: MyHuntMission; onOpen: () => void }> = ({ mission: m, onOpen }) => {
  const max = m.hunt_max_recruiters ?? 3;
  const deadlinePassed = !!m.hunt_deadline
    && m.hunt_deadline.slice(0, 10) < new Date().toISOString().slice(0, 10)
    && (m.hunt_status === 'published' || m.hunt_status === 'in_progress');

  return (
    <div className="p-4 flex items-center gap-4 flex-wrap">
      <div className="flex-1 min-w-[200px]">
        <p className="text-sm font-bold uppercase tracking-wider text-foreground">
          {m.job_title || m.name}
        </p>
        <p className="text-xs text-muted-foreground mt-0.5 flex items-center gap-3 flex-wrap">
          {m.client_name && <span>{m.client_name}</span>}
          {m.hunt_bounty_percent != null ? <span>{m.hunt_bounty_percent} % du salaire annuel</span> : null}
          {m.hunt_deadline && (
            <span className="flex items-center gap-1">
              <Calendar className="w-3 h-3" /> {formatDate(m.hunt_deadline)}
            </span>
          )}
        </p>
        {deadlinePassed && (
          <p className="text-xs text-warning mt-1">
            Date limite dépassée : la mission n'est plus proposée aux recruteurs.
          </p>
        )}
      </div>
      <span className="px-2 py-0.5 text-xs font-bold uppercase tracking-wider border border-border text-muted-foreground">
        {huntStatusLabel(m.hunt_status)}
      </span>
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="w-3 h-3" />
        {m.pending_count} en attente
      </span>
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Users className="w-3 h-3" />
        {m.accepted_count}/{max} recruteurs
      </span>
      <button
        type="button"
        onClick={onOpen}
        className="h-8 px-3 border border-border text-xs font-medium uppercase tracking-wider bg-foreground text-background inline-flex items-center gap-1"
      >
        Gérer <ArrowRight className="w-3 h-3" />
      </button>
    </div>
  );
};

export const EnterpriseHuntMissions: React.FC = () => {
  const navigate = useNavigate();
  const { missions, isLoading, isError, errorText, refetch } = useMyHuntMissions(true);

  const { proposed, drafts } = useMemo(() => ({
    proposed: missions.filter((m) => OPEN_STATUSES.has(m.hunt_status ?? '')),
    drafts: missions.filter((m) => !OPEN_STATUSES.has(m.hunt_status ?? '')),
  }), [missions]);

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
          Proposées aux recruteurs
        </h2>

        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <div className="w-5 h-5 border border-border border-t-foreground animate-spin" />
          </div>
        ) : isError ? (
          <ErrorBox
            title="Impossible de charger vos missions publiées."
            detail={errorText}
            onRetry={refetch}
          />
        ) : proposed.length === 0 ? (
          <div className="border border-dashed border-border p-12 text-center">
            <Target className="w-8 h-8 text-muted-foreground mx-auto mb-3" />
            <h3 className="text-sm font-bold uppercase tracking-wider mb-2">Aucune mission publiée</h3>
            <p className="text-xs text-muted-foreground">
              Activez le mode chasse dans la configuration d'une mission, puis publiez-la pour la
              proposer aux recruteurs partenaires.
            </p>
          </div>
        ) : (
          <div className="border border-border divide-y divide-border">
            {proposed.map((m) => (
              <MissionRow key={m.id} mission={m} onOpen={() => navigate(`/missions/${m.id}?tab=config`)} />
            ))}
          </div>
        )}
      </div>

      {drafts.length > 0 && (
        <div>
          <h2 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3">
            En préparation
          </h2>
          <div className="border border-border divide-y divide-border">
            {drafts.map((m) => (
              <MissionRow key={m.id} mission={m} onOpen={() => navigate(`/missions/${m.id}?tab=config`)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

export default EnterpriseHuntMissions;

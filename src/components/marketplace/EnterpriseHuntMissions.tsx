/**
 * EnterpriseHuntMissions : « Vos missions sur la marketplace » pour une
 * entreprise. Deux groupes : les missions proposées aux recruteurs et celles
 * encore en préparation. Chaque ligne montre les candidatures en attente et
 * les recruteurs acceptés.
 */

import React, { useId, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, ArrowRight, Calendar, Clock, Target, Users } from 'lucide-react';
import { useMyHuntMissions, type MyHuntMission } from '@/hooks/useMarketplace';
import { EmptyState } from '@/components/layout/EmptyState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { huntStatusLabel, huntStatusVariant, formatDate } from './huntLabels';
import { ErrorBox } from './ErrorBox';
import { RowsSkeleton } from './MarketplaceSkeleton';

const OPEN_STATUSES = new Set(['published', 'in_progress', 'filled', 'cancelled']);

const MissionRow: React.FC<{ mission: MyHuntMission }> = ({ mission: m }) => {
  const max = m.hunt_max_recruiters ?? 3;
  const deadlinePassed = !!m.hunt_deadline
    && m.hunt_deadline.slice(0, 10) < new Date().toISOString().slice(0, 10)
    && (m.hunt_status === 'published' || m.hunt_status === 'in_progress');

  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 p-4">
      <div className="min-w-52 flex-1">
        <p className="text-md font-semibold text-foreground">{m.job_title || m.name}</p>
        <p className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
          {m.client_name && <span>{m.client_name}</span>}
          {m.hunt_bounty_percent != null ? <span>{m.hunt_bounty_percent} % du salaire annuel</span> : null}
          {m.hunt_deadline && (
            <span className="flex items-center gap-1">
              <Calendar className="h-3 w-3" aria-hidden="true" />
              <span className="sr-only">Date limite : </span>
              {formatDate(m.hunt_deadline)}
            </span>
          )}
        </p>
        {deadlinePassed && (
          <p className="mt-1 flex items-center gap-1 text-xs text-warning">
            <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
            Date limite dépassée : la mission n'est plus proposée aux recruteurs.
          </p>
        )}
      </div>
      <Badge variant={huntStatusVariant(m.hunt_status)}>{huntStatusLabel(m.hunt_status)}</Badge>
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="h-3 w-3" aria-hidden="true" />
        {m.pending_count} en attente
      </span>
      <span className="flex items-center gap-1 text-xs text-muted-foreground">
        <Users className="h-3 w-3" aria-hidden="true" />
        {m.accepted_count}/{max} recruteurs
      </span>
      <Button asChild variant="outline" size="sm" className="min-h-11 md:min-h-0">
        <Link to={`/missions/${m.id}?tab=config`}>
          Gérer la mission
          <ArrowRight aria-hidden="true" />
        </Link>
      </Button>
    </li>
  );
};

export const EnterpriseHuntMissions: React.FC = () => {
  const { missions, isLoading, isError, errorText, refetch } = useMyHuntMissions(true);
  const proposedId = useId();
  const draftsId = useId();

  const { proposed, drafts } = useMemo(() => ({
    proposed: missions.filter((m) => OPEN_STATUSES.has(m.hunt_status ?? '')),
    drafts: missions.filter((m) => !OPEN_STATUSES.has(m.hunt_status ?? '')),
  }), [missions]);

  return (
    <div className="space-y-6">
      <section aria-labelledby={proposedId}>
        <h2 id={proposedId} className="eyebrow mb-3">Proposées aux recruteurs</h2>

        {isLoading ? (
          <RowsSkeleton label="Chargement de vos missions" />
        ) : isError ? (
          <ErrorBox
            title="Impossible de charger vos missions publiées."
            detail={errorText}
            onRetry={refetch}
          />
        ) : proposed.length === 0 ? (
          <EmptyState
            icon={Target}
            title="Aucune mission publiée"
            description="Activez le mode chasse dans la configuration d'une mission, puis publiez-la pour la proposer aux recruteurs partenaires."
            action={
              <Button asChild variant="outline" size="sm" className="min-h-11 md:min-h-0">
                <Link to="/missions">Ouvrir mes missions</Link>
              </Button>
            }
          />
        ) : (
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {proposed.map((m) => (
              <MissionRow key={m.id} mission={m} />
            ))}
          </ul>
        )}
      </section>

      {drafts.length > 0 && (
        <section aria-labelledby={draftsId}>
          <h2 id={draftsId} className="eyebrow mb-3">En préparation</h2>
          <ul className="divide-y divide-border rounded-xl border border-border bg-card">
            {drafts.map((m) => (
              <MissionRow key={m.id} mission={m} />
            ))}
          </ul>
        </section>
      )}
    </div>
  );
};

export default EnterpriseHuntMissions;

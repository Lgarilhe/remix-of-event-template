/**
 * DashboardConnections — état des canaux d'envoi (LinkedIn, e-mail).
 *
 * Une carte par canal : logo, nom, statut en texte avec un point de couleur,
 * et une action visible quand le canal demande quelque chose (« Connecter »,
 * « Reconnecter »). Pas d'animation : un statut se lit, il ne clignote pas.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import linkedinLogo from '@/assets/linkedin-logo.webp';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';
import type { ChannelConnection, ConnectionStatus } from '@/hooks/useDashboardConnections';

interface DashboardConnectionsProps {
  linkedin: ChannelConnection;
  email: ChannelConnection;
  isLoading?: boolean;
}

const CONNECTIONS_PATH = '/settings/account/connections';

const STATUS: Record<ConnectionStatus, { label: string; dot: string; action: string | null }> = {
  connected: { label: 'Connecté', dot: 'bg-success', action: null },
  connecting: { label: 'Connexion en cours', dot: 'bg-warning', action: null },
  error: { label: 'À reconnecter', dot: 'bg-danger', action: 'Reconnecter' },
  disconnected: { label: 'Non connecté', dot: 'bg-muted-foreground', action: 'Connecter' },
};

const ChannelCard: React.FC<{
  channel: ChannelConnection;
  name: string;
  logo: React.ReactNode;
}> = ({ channel, name, logo }) => {
  const status = STATUS[channel.status];
  const detail = channel.status === 'connected' && channel.label ? ` · ${channel.label}` : '';

  return (
    <div className="flex items-center gap-3 rounded-xl border border-border bg-card p-3">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-muted">{logo}</span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-foreground">{name}</p>
        <p className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn('h-1.5 w-1.5 shrink-0 rounded-full', status.dot)} aria-hidden="true" />
          <span className="truncate">
            {status.label}
            {detail}
          </span>
        </p>
      </div>
      {status.action && (
        <Button asChild variant="outline" size="sm">
          <Link to={CONNECTIONS_PATH} aria-label={`${status.action} ${name}`}>
            {status.action}
          </Link>
        </Button>
      )}
    </div>
  );
};

export const DashboardConnections: React.FC<DashboardConnectionsProps> = ({ linkedin, email, isLoading }) => (
  <section aria-labelledby="dashboard-channels">
    <h2 id="dashboard-channels" className="eyebrow mb-3">
      Vos canaux
    </h2>
    {isLoading ? (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2" role="status" aria-label="Chargement des canaux">
        <Skeleton className="h-16 rounded-xl" />
        <Skeleton className="h-16 rounded-xl" />
      </div>
    ) : (
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <ChannelCard
          channel={linkedin}
          name="LinkedIn"
          logo={<img src={linkedinLogo} alt="" aria-hidden="true" className="h-5 w-5 object-contain" />}
        />
        <ChannelCard channel={email} name="E-mail" logo={<Mail className="h-4 w-4 text-foreground-secondary" aria-hidden="true" />} />
      </div>
    )}
  </section>
);

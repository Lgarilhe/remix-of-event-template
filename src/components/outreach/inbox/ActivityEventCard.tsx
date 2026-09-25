/**
 * ActivityEventCard — événement de la frise d'une conversation : étape de
 * séquence exécutée, rendez-vous pris, appel téléphonique.
 *
 * Les étapes et leurs statuts viennent du catalogue des séquences : jamais un
 * identifiant technique (« connection_request »), jamais un message d'erreur
 * brut (revue design D-01). Icônes neutres ; l'appel prend l'icône du canal
 * (ChannelIcon), sans couleur propre (D-16, D-65).
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck } from 'lucide-react';
import { ActivityEvent } from '@/hooks/useProfileActivity';
import { formatMessageTime } from '@/hooks/useMessagesInboxHelpers';
import { ChannelIcon } from '@/components/ui/ChannelIcon';
import { ExecutionStatusBadge, SequenceActionIcon } from '@/components/outreach/SequenceBadges';
import { sequenceActionLabel, skipReasonLabel } from '@/lib/sequenceCatalog';

/** Durée d'appel : « 45 s », « 3 min », « 3 min 20 s ». */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m} min ${s} s` : `${m} min`;
}

const Separator = () => (
  <span aria-hidden="true" className="text-muted-foreground">
    ·
  </span>
);

export const ActivityEventCard: React.FC<{ event: ActivityEvent }> = ({ event }) => {
  const isBooking = event.type === 'booking';
  const isCall = event.type === 'aircall';
  const time = formatMessageTime(event.timestamp);

  let icon: React.ReactNode;
  let label: React.ReactNode;
  const details: React.ReactNode[] = [];

  if (isCall) {
    // Décorative : le libellé dit déjà « Appel »
    icon = <ChannelIcon channel="call" size="xs" decorative className="shrink-0" />;
    label = event.callDirection === 'inbound' ? 'Appel entrant' : 'Appel sortant';
    if (event.callDuration != null && event.callDuration > 0) details.push(formatDuration(event.callDuration));
    if (event.callUserName) details.push(event.callUserName);
  } else if (isBooking) {
    icon = <CalendarCheck className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />;
    label = event.qualificationSessionId ? (
      <Link
        to={`/qualification/${event.qualificationSessionId}`}
        className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        Rendez-vous planifié
      </Link>
    ) : (
      'Rendez-vous planifié'
    );
    if (event.eventName) details.push(event.eventName);
  } else {
    icon = <SequenceActionIcon type={event.actionType} className="text-muted-foreground" />;
    label = sequenceActionLabel(event.actionType);
    const reason = event.status === 'skipped' ? skipReasonLabel(event.skipReason) : null;
    details.push(<ExecutionStatusBadge key="status" status={event.status} className="px-1.5 py-0 text-2xs" />);
    if (reason) details.push(reason);
  }

  return (
    <div className="my-2 flex justify-center">
      <div className="inline-flex max-w-[85%] flex-wrap items-center justify-center gap-x-1.5 gap-y-1 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-foreground-secondary">
        {icon}
        <span className="font-medium text-foreground">{label}</span>
        {details.map((detail, i) => (
          <React.Fragment key={i}>
            <Separator />
            {typeof detail === 'string' ? <span className="text-muted-foreground">{detail}</span> : detail}
          </React.Fragment>
        ))}
        {time && (
          <>
            <Separator />
            <span className="whitespace-nowrap tabular-nums text-muted-foreground">{time}</span>
          </>
        )}
      </div>
    </div>
  );
};

/**
 * ActivityEventCard — événement de la frise d'une conversation : étape de
 * séquence exécutée, rendez-vous pris, appel téléphonique.
 *
 * Une étape prend le même titre que dans la fiche candidat (dictionnaire
 * partagé src/lib/sequenceActionLabels.ts) : « InMail envoyé », « InMail :
 * échec », « Invitation : étape sautée ». Jamais un identifiant technique
 * (« connection_request »), jamais un message d'erreur brut : raisons et
 * erreurs sont traduites (revue design D-01). Icônes neutres ; l'appel prend
 * l'icône du canal (ChannelIcon), sans couleur propre (D-16, D-65).
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { CalendarCheck } from 'lucide-react';
import { ActivityEvent } from '@/hooks/useProfileActivity';
import { formatMessageTime } from '@/hooks/useMessagesInboxHelpers';
import { ChannelIcon } from '@/components/ui/ChannelIcon';
import { ExecutionStatusBadge, SequenceActionIcon } from '@/components/outreach/SequenceBadges';
import { STEP_TYPE_LABELS, stepTypeLabel } from '@/components/outreach/sequence/sequenceGraph';
import { sequenceActionLabel } from '@/lib/sequenceCatalog';
import { formatSequenceError, formatSkipReason } from '@/lib/sequenceErrorMessages';
import {
  isInternalSequenceAction,
  sequenceExecutionStatusMention,
  sequenceExecutionTitle,
} from '@/lib/sequenceActionLabels';
import { cn } from '@/lib/utils';

/** Durée d'appel : « 45 s », « 3 min », « 3 min 20 s ». */
function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return s > 0 ? `${m} min ${s} s` : `${m} min`;
}

/**
 * Titre d'une étape de séquence exécutée, identique à la fiche candidat :
 * « InMail envoyé », « InMail : échec », « Invitation : étape sautée ». Une
 * étape interne (attente, vérification) prend le nom de son type dans
 * l'éditeur de séquence, suivi de son statut s'il n'est pas « faite ».
 */
function sequenceStepTitle(actionType: string, status: string): string {
  if (!isInternalSequenceAction(actionType)) return sequenceExecutionTitle(actionType, status);
  // Sans nom dans l'éditeur (attente d'un événement), celui du catalogue :
  // jamais l'identifiant technique.
  const name = actionType in STEP_TYPE_LABELS ? stepTypeLabel(actionType) : sequenceActionLabel(actionType);
  const mention = sequenceExecutionStatusMention(status);
  return mention ? `${name} : ${mention.toLowerCase()}` : name;
}

/** Réaction du candidat à un envoi : le titre dit « envoyé », le badge précise. */
const REACTION_STATUSES = new Set(['opened', 'clicked', 'replied']);

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
  let stepFailed = false;
  const details: React.ReactNode[] = [];

  if (isCall) {
    // Décorative : le libellé dit déjà « Appel »
    icon = <ChannelIcon channel="call" size="xs" decorative className="shrink-0" />;
    label = event.callDirection === 'inbound' ? 'Appel entrant' : 'Appel sortant';
    if (event.callDuration != null && event.callDuration > 0) details.push(formatDuration(event.callDuration));
    if (event.callUserName) details.push(event.callUserName);
  } else if (isBooking) {
    icon = <CalendarCheck className="h-3.5 w-3.5 shrink-0 text-foreground" aria-hidden="true" />;
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
    icon = <SequenceActionIcon type={event.actionType} className="text-foreground" />;
    // Étape non partie : le statut fait partie du titre (« Invitation : échec »),
    // jamais présentée comme envoyée.
    label = sequenceStepTitle(event.actionType, event.status);
    stepFailed = event.status === 'failed' || event.status === 'bounced';
    if (REACTION_STATUSES.has(event.status)) {
      details.push(<ExecutionStatusBadge key="status" status={event.status} className="px-1.5 py-0 text-2xs" />);
    }
    if (event.status === 'skipped' && event.skipReason) details.push(formatSkipReason(event.skipReason));
    if (event.status === 'failed' && event.errorMessage) details.push(formatSequenceError(event.errorMessage));
  }

  return (
    <div className="my-2 flex justify-center">
      <div className="inline-flex max-w-[85%] flex-wrap items-center justify-center gap-x-1.5 gap-y-1 rounded-lg border border-dashed border-border px-3 py-1.5 text-xs text-foreground-secondary">
        {icon}
        <span className={cn('font-medium', stepFailed ? 'text-danger' : 'text-foreground')}>{label}</span>
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

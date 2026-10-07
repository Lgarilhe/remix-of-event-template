/**
 * ActivityEventCard — événement de la frise d'une conversation : étape de
 * séquence exécutée, rendez-vous pris, appel téléphonique.
 *
 * Une étape prend le même titre que dans la fiche candidat (dictionnaire
 * partagé src/lib/sequenceActionLabels.ts) : « InMail envoyé », « InMail :
 * échec », « Invitation : étape sautée ». Jamais un identifiant technique
 * (« connection_request »), jamais un message d'erreur brut : raisons et
 * erreurs sont traduites (revue design D-01). Le logo identifie le service
 * connu ; le canal reste générique quand son fournisseur n'est pas enregistré.
 */

import React from 'react';
import { Link } from 'react-router-dom';
import { ActivityEvent } from '@/hooks/useProfileActivity';
import { formatMessageTime } from '@/hooks/useMessagesInboxHelpers';
import { ChannelIcon } from '@/components/ui/ChannelIcon';
import { ExecutionStatusBadge } from '@/components/outreach/SequenceBadges';
import { ServiceLogo } from '@/components/ui/ServiceLogo';
import { activityService, meetingService, SERVICE_LABELS } from '@/lib/messagingServices';
import { STEP_TYPE_LABELS, stepTypeLabel } from '@/components/outreach/sequence/sequenceGraph';
import { sequenceActionLabel } from '@/lib/sequenceCatalog';
import { formatSequenceError, formatSkipReason } from '@/lib/sequenceErrorMessages';
import {
  isInternalSequenceAction,
  sequenceExecutionStatusMention,
  sequenceExecutionTitle,
} from '@/lib/sequenceActionLabels';
import { cn } from '@/lib/utils';
import { activityActionType, activityChannel, activityMessageText } from '@/lib/inboxTimeline';

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
    icon = event.service ? <ServiceLogo service={event.service} decorative /> : <ChannelIcon channel="call" size="xs" decorative className="shrink-0" />;
    label = event.callDirection === 'inbound' ? 'Appel entrant' : 'Appel sortant';
    if (event.callDuration != null && event.callDuration > 0) details.push(formatDuration(event.callDuration));
    if (event.callUserName) details.push(event.callUserName);
  } else if (isBooking) {
    icon = <ServiceLogo service={activityService(event)} decorative />;
    const bookingLabel = ['cancelled', 'canceled'].includes(event.status) ? 'Entretien annulé' : ['completed', 'done'].includes(event.status) ? 'Entretien terminé' : 'Entretien planifié';
    label = event.qualificationSessionId ? (
      <Link
        to={`/qualification/${event.qualificationSessionId}`}
        className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {bookingLabel}
      </Link>
    ) : (
      bookingLabel
    );
    if (event.eventName) details.push(event.eventName);
  } else {
    icon = <ServiceLogo service={activityService(event)} decorative />;
    // Étape non partie : le statut fait partie du titre (« Invitation : échec »),
    // jamais présentée comme envoyée.
    label = event.type === 'message'
      ? `${activityChannel(event) === 'email' ? 'E-mail' : 'Message'} ${event.direction === 'inbound' ? 'reçu' : 'envoyé'}`
      : sequenceStepTitle(activityActionType(event), event.status);
    stepFailed = event.status === 'failed' || event.status === 'bounced';
    if (REACTION_STATUSES.has(event.status)) {
      details.push(<ExecutionStatusBadge key="status" status={event.status} className="px-1.5 py-0 text-2xs" />);
    }
    if (event.status === 'skipped' && event.skipReason) details.push(formatSkipReason(event.skipReason));
    if (event.status === 'failed' && event.errorMessage) details.push(formatSequenceError(event.errorMessage));
  }

  const message = activityMessageText(event.finalMessage);
  const hasContent = !!message || !!event.finalSubject || isBooking;
  return (
    <div className="my-4 flex justify-center">
      <article className={cn('w-full min-w-0 rounded-lg border border-border bg-muted p-3 text-xs text-foreground-secondary md:p-4', hasContent ? 'max-w-2xl' : 'max-w-xl')}>
      <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
        {icon}
        <span className={cn('font-medium', stepFailed ? 'text-danger' : 'text-foreground')}>{label}</span>
        {event.service && <><Separator /><span>{SERVICE_LABELS[event.service]}</span></>}
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
      {event.sequenceName && <p className="mt-1 break-words text-muted-foreground">{event.sequenceName} · Étape {event.stepOrder + 1}</p>}
      {event.recipient && <p className="mt-1 break-all text-muted-foreground">{event.direction === 'inbound' ? 'De' : 'À'} : {event.recipient}</p>}
      {event.finalSubject && <p className="mt-3 break-words text-sm font-medium text-foreground">{event.finalSubject}</p>}
      {message && (message.length > 280 ? (
        <details className="group/content mt-2">
          <summary className="cursor-pointer py-2 marker:text-muted-foreground max-md:min-h-11"><span className="font-medium text-foreground">Lire le message</span><p className="mt-2 whitespace-pre-wrap break-words text-sm font-normal leading-relaxed text-foreground-secondary group-open/content:hidden [overflow-wrap:anywhere]">{message.slice(0, 280)}…</p></summary>
          <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground-secondary [overflow-wrap:anywhere]">{message}</p>
        </details>
      ) : <p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground-secondary [overflow-wrap:anywhere]">{message}</p>)}
      {isBooking && Number.isFinite(Date.parse(event.timestamp)) && (
        <p className="mt-3 text-sm font-medium text-foreground">
          {new Date(event.timestamp).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          {' à '}{new Date(event.timestamp).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
          {event.eventEndAt && Number.isFinite(Date.parse(event.eventEndAt)) && <> · Jusqu'à {new Date(event.eventEndAt).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</>}
        </p>
      )}
      {isBooking && event.eventLocation && <p className="mt-2 flex items-start gap-2 break-words text-muted-foreground [overflow-wrap:anywhere]">{meetingService(event.eventLocation) && <ServiceLogo service="google_meet" decorative />}<span>{event.eventLocation}</span></p>}
      </article>
    </div>
  );
};

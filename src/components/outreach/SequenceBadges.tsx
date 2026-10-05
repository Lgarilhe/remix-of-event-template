/**
 * Affichage commun des séquences : icône d'une étape, badge de statut d'une
 * inscription ou d'une étape. Tons et libellés viennent de
 * `src/lib/sequenceCatalog.ts`, qui reprend les libellés de l'audit des
 * séquences (`sequenceLabels.ts`) ; un même statut se peint de la même façon
 * dans la messagerie, le suivi, le journal et la fiche candidat (revue design
 * D-55).
 *
 * Les icônes restent neutres : la couleur d'un canal est portée par son logo
 * (`ChannelIcon`), jamais par l'étape.
 */

import React from 'react';
import {
  Eye,
  GitBranch,
  Hourglass,
  Mail,
  MessageCircle,
  MessageSquare,
  MessageSquareText,
  Send,
  UserPlus,
  Workflow,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';
import {
  enrollmentStatusMeta,
  executionStatusMeta,
  normalizeActionType,
  sequenceActionLabel,
  sequenceActionMeta,
} from '@/lib/sequenceCatalog';
import { manualStopLabel, pausedLabel, type ManualStopInfo } from '@/lib/sequenceLabels';

const ACTION_ICONS: Record<string, React.ElementType> = {
  connection_request: UserPlus,
  message: MessageSquare,
  smart_message: MessageSquareText,
  inmail: Send,
  profile_visit: Eye,
  email: Mail,
  whatsapp_message: MessageCircle,
};

/** Icône d'une étape : l'action pour un envoi, un sablier pour une attente, une branche pour une condition. */
function sequenceActionIcon(type: string | null | undefined): React.ElementType {
  const key = normalizeActionType(type);
  if (key && ACTION_ICONS[key]) return ACTION_ICONS[key];
  const kind = sequenceActionMeta(type)?.kind;
  if (kind === 'wait') return Hourglass;
  if (kind === 'condition') return GitBranch;
  return Workflow;
}

export function SequenceActionIcon({ type, className }: { type: string | null | undefined; className?: string }) {
  const Icon = sequenceActionIcon(type);
  return <Icon className={cn('h-3.5 w-3.5 shrink-0', className)} aria-hidden="true" />;
}

/** Icône et libellé d'une étape, en ligne (« Invitation LinkedIn »). */
export function SequenceActionLabel({ type, className }: { type: string | null | undefined; className?: string }) {
  return (
    <span className={cn('inline-flex min-w-0 items-center gap-1.5', className)}>
      <SequenceActionIcon type={type} className="text-muted-foreground" />
      <span className="truncate">{sequenceActionLabel(type)}</span>
    </span>
  );
}

/**
 * Statut d'une inscription ; une pause dit sa raison quand elle est connue
 * (« En pause (limite d’envoi atteinte) ») ; un arrêt manuel (lot 5b) dit qui
 * l'a posé et quand (« Arrêtée par Guillaume Martin le 29/09 »), lu par
 * readManualStop (tracking_data.completion_reason et tracking_data.manual_stop)
 * dans le suivi, la fiche, la messagerie, le Pipeline et la chronologie.
 */
export function EnrollmentStatusBadge({
  status,
  pauseReason,
  manualStop: manualStopInfo,
  stoppedByName,
  className,
}: {
  status: string | null | undefined;
  pauseReason?: string | null;
  /** Arrêt manuel lu sur l'inscription (readManualStop), null sinon. */
  manualStop?: ManualStopInfo | null;
  /** Nom de l'auteur de l'arrêt manuel, s'il est connu. */
  stoppedByName?: string | null;
  className?: string;
}) {
  const meta = enrollmentStatusMeta(status);
  const manualStop = status === 'completed' ? manualStopInfo ?? null : null;
  return (
    <Badge variant={meta.tone} className={className}>
      {manualStop ? manualStopLabel(manualStop, stoppedByName) : status === 'paused' ? pausedLabel(pauseReason) : meta.label}
    </Badge>
  );
}

/** Statut d'une étape exécutée ou prévue. */
export function ExecutionStatusBadge({ status, className }: { status: string | null | undefined; className?: string }) {
  const meta = executionStatusMeta(status);
  return (
    <Badge variant={meta.tone} className={className}>
      {meta.label}
    </Badge>
  );
}

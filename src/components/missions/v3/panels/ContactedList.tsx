// Refonte mission, lot 5f-2b : onglet « Contactés » du panneau Prise de contact.
// Une ligne par candidat de la mission, en quatre groupes (A répondu, Bloqués,
// En attente, Sans suite), avec le statut de sa séquence et un seul geste.
//
// Lecture d'abord : les gestes d'écriture sont ceux du lot 5b, sans nouvelle
// logique. « Mettre en pause » passe par createEnrollmentActions (écriture gardée
// sur le statut, toast « Annuler »), « Arrêter pour ce candidat » par
// stop_enrollments. Tout le reste (relire, reprendre, réessayer, réactiver)
// se fait sur la page de la séquence, que la ligne ouvre. Ce composant n'écrit
// ni l'étape d'un candidat, ni une exécution.
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { toast } from 'sonner';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { PersonAvatar } from '@/components/ui/person-avatar';
import { Skeleton } from '@/components/ui/skeleton';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { CONTACTED_ENROLLMENT_LIMIT } from '@/hooks/useMissionContacted';
import { useSequencesBeta } from '@/hooks/useSequencesBeta';
import { useUndoableEnrollmentAction } from '@/hooks/useUndoableEnrollmentAction';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { createEnrollmentActions } from '@/lib/sequenceActions';
import { sequencePath } from '@/lib/sequencesBeta';
import type { ContactedEntry, ContactedGroupKey, ContactedView } from '@/lib/contactedGroups';
import type { EnrollmentStatusLine } from '@/lib/enrollmentStatusLine';
import { cn } from '@/lib/utils';
import { useMissionV3 } from '../MissionV3Context';

export type ContactedListStatus = 'loading' | 'error' | 'ready';

interface ContactedListProps {
  projectId: string;
  status: ContactedListStatus;
  view: ContactedView | null;
  chatByEnrollment: ReadonlyMap<string, string>;
  /** La mission a plus de contacts que la lecture n'en rend. */
  truncated: boolean;
  /** Relit la liste (après un geste, ou sur « Réessayer »). */
  onRefresh: () => void | Promise<unknown>;
}

const TONE_CLASS: Record<EnrollmentStatusLine['tone'], string> = {
  default: 'text-foreground',
  muted: 'text-muted-foreground',
  brand: 'text-brand',
  warning: 'text-warning',
  danger: 'text-danger',
};

/** Groupe replié au départ : les candidats sans suite ne demandent rien. */
const COLLAPSED_AT_START: ReadonlySet<ContactedGroupKey> = new Set(['closed']);

const TOUCH = 'max-lg:min-h-11';

export function ContactedList({ projectId, status, view, chatByEnrollment, truncated, onRefresh }: ContactedListProps): JSX.Element {
  const { openCandidate } = useMissionV3();
  const { isCollaborator } = useOrganization();
  const { user } = useAuthReady();
  const userId = user?.id ?? null;
  const { offerUndoPause, stopEnrollments } = useUndoableEnrollmentAction();
  const sequencesBeta = useSequencesBeta();
  const [collapsed, setCollapsed] = useState<ReadonlySet<ContactedGroupKey>>(COLLAPSED_AT_START);
  // Ligne dont un geste est en cours : ses boutons attendent la relecture (un second clic donnerait un échec trompeur).
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set());
  const runGesture = async (entryKey: string, gesture: () => Promise<unknown>) => {
    setBusy((prev) => new Set(prev).add(entryKey));
    try {
      await gesture();
    } finally {
      setBusy((prev) => {
        const next = new Set(prev);
        next.delete(entryKey);
        return next;
      });
    }
  };

  if (status === 'loading') {
    return (
      <div className="space-y-3" aria-busy="true" aria-label="Chargement des candidats contactés">
        <Skeleton className="h-5 w-28" />
        <Skeleton className="h-14 w-full" />
        <Skeleton className="h-14 w-full" />
      </div>
    );
  }

  if (status === 'error' || !view) {
    return (
      <div role="alert" className="space-y-2 text-sm">
        <p className="text-foreground">Les candidats contactés n’ont pas pu être chargés.</p>
        <Button type="button" variant="outline" size="sm" className={TOUCH} onClick={() => { void onRefresh(); }}>
          Réessayer
        </Button>
      </div>
    );
  }

  if (view.total === 0) {
    return (
      <div className="space-y-1 text-sm">
        <p className="text-foreground">Aucun candidat contacté pour l’instant.</p>
        <p className="text-muted-foreground">
          Cochez des candidats retenus dans la liste, puis « Contacter » : ils apparaîtront ici avec leur statut.
        </p>
      </div>
    );
  }

  const sequenceCount = new Set(view.entries.map((entry) => entry.enrollment?.sequenceId).filter(Boolean)).size;

  // Un collaborateur n'agit que sur ses inscriptions (même règle que le serveur).
  const isOwn = (entry: ContactedEntry) => !isCollaborator || (!!userId && entry.enrollment?.createdBy === userId);

  const pause = (entry: ContactedEntry) => {
    const enrollment = entry.enrollment;
    if (!enrollment) return;
    const { stopEnrollment } = createEnrollmentActions({
      supabase,
      invokeEdgeFunction,
      toast,
      sequenceId: enrollment.sequenceId,
      nameOf: () => entry.name,
      fetchEnrollments: async () => { await onRefresh(); },
      // Appelé juste après l'écriture réussie : la ligne se relit tout de suite, sans attendre « Annuler ».
      fetchStatusCounts: async () => { await onRefresh(); },
      setEnrollments: () => {},
      offerUndoPause,
      setBulkResuming: () => {},
    });
    void runGesture(entry.key, () => stopEnrollment(enrollment.id));
  };

  const stop = (entry: ContactedEntry) => {
    const enrollment = entry.enrollment;
    if (!enrollment) return;
    void runGesture(entry.key, () => stopEnrollments({
      enrollmentIds: [enrollment.id],
      candidateName: entry.name,
      onSettled: async () => { await onRefresh(); },
    }));
  };

  const actionFor = (entry: ContactedEntry): ReactNode => {
    const enrollment = entry.enrollment;
    const action = entry.line?.action;
    if (!enrollment || !action) return null;
    const small = { variant: 'ghost' as const, size: 'xs' as const, disabled: busy.has(entry.key), className: cn('shrink-0 text-muted-foreground', TOUCH) };
    switch (action.kind) {
      case 'pause':
        return isOwn(entry) ? <Button type="button" {...small} onClick={() => pause(entry)}>{action.label}</Button> : null;
      case 'stop':
        return isOwn(entry) ? <Button type="button" {...small} onClick={() => stop(entry)}>{action.label}</Button> : null;
      case 'conversation': {
        const chat = chatByEnrollment.get(enrollment.id);
        return (
          <Button asChild variant="outline" size="xs" className={cn('shrink-0', TOUCH)}>
            <Link to={chat ? `/inbox?chatId=${encodeURIComponent(chat)}` : '/inbox'}>{action.label}</Link>
          </Button>
        );
      }
      case 'reconnect':
        return <Button asChild variant="outline" size="xs" className={cn('shrink-0', TOUCH)}><Link to="/settings/account/connections">{action.label}</Link></Button>;
      case 'pricing':
        return <Button asChild variant="outline" size="xs" className={cn('shrink-0', TOUCH)}><Link to="/pricing">{action.label}</Link></Button>;
      default:
        // Relire, reprendre, réessayer, réactiver, voir l'erreur : sur la page de la séquence
        // (pages Séquences : interrupteur allumé seulement, comme les autres accès).
        return sequencesBeta ? (
          <Button asChild variant="outline" size="xs" className={cn('shrink-0', TOUCH)}>
            <Link to={`${sequencePath(enrollment.sequenceId, projectId)}&onglet=candidats`}>Ouvrir la séquence</Link>
          </Button>
        ) : null;
    }
  };

  const toggle = (key: ContactedGroupKey) => setCollapsed((prev) => {
    const next = new Set(prev);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    return next;
  });

  return (
    <div className="space-y-5">
      {view.groups.filter((group) => group.entries.length > 0).map((group) => {
        const headingId = `contacted-${group.key}`;
        const open = !collapsed.has(group.key);
        const Chevron = open ? ChevronDown : ChevronRight;
        return (
          <section key={group.key} aria-labelledby={headingId} data-contacted-group={group.key}>
            <h3 id={headingId} className="text-sm font-semibold text-foreground">
              <Button
                type="button"
                variant="ghost"
                size="xs"
                aria-expanded={open}
                onClick={() => toggle(group.key)}
                className={cn('-ml-2.5 h-auto justify-start gap-1.5 text-sm font-semibold', TOUCH)}
              >
                <Chevron className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <span>{group.label}</span>
                <span className="font-normal tabular-nums text-muted-foreground">{group.entries.length}</span>
              </Button>
            </h3>
            {open && (
              <ul className="mt-1 divide-y divide-border">
                {group.entries.map((entry) => (
                  <li key={entry.key} data-contacted-row={entry.key} className="flex items-start gap-3 py-3">
                    <PersonAvatar name={entry.name} src={entry.pictureUrl} candidateId={entry.candidateId} size={32} className="mt-0.5 shrink-0" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          {entry.rowId ? (
                            <Button
                              type="button"
                              variant="link"
                              onClick={() => openCandidate(entry.rowId as string)}
                              className="block h-auto max-w-full truncate rounded-sm p-0 text-left text-sm font-medium"
                            >
                              {entry.name}
                            </Button>
                          ) : (
                            <p className="truncate text-sm font-medium text-foreground">{entry.name}</p>
                          )}
                          {entry.headline && <p className="truncate text-xs text-muted-foreground">{entry.headline}</p>}
                        </div>
                        {actionFor(entry)}
                      </div>
                      {entry.line ? (
                        <p className={cn('mt-1 text-xs', TONE_CLASS[entry.line.tone])}>
                          {entry.line.label}
                          {entry.line.next && <span className="text-muted-foreground">{` · ${entry.line.next}`}</span>}
                        </p>
                      ) : (
                        <p className="mt-1 text-xs text-muted-foreground">{entry.manualLabel}</p>
                      )}
                      {sequenceCount > 1 && entry.enrollment?.sequenceName && (
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{entry.enrollment.sequenceName}</p>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        );
      })}
      {truncated && (
        <p className="text-xs text-muted-foreground">
          {`Seuls les ${CONTACTED_ENROLLMENT_LIMIT} contacts les plus récents de la mission sont affichés.`}
        </p>
      )}
    </div>
  );
}

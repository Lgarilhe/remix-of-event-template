/**
 * DashboardActivityFeed — les huit derniers mouvements sur vos candidats :
 * placement, candidat perdu, réponse, avancée d'étape, prise de contact,
 * ajout, note. Chaque ligne ouvre la fiche du candidat.
 */

import React, { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { formatDistanceToNowStrict, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Activity,
  ArrowRight,
  UserPlus,
  MessageCircle,
  TrendingUp,
  StickyNote,
  CheckCircle2,
  XCircle,
  Send,
  type LucideIcon,
} from 'lucide-react';
import { Section, EmptyState } from '@/components/layout';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { ATSCandidate } from '@/hooks/useATSData';
import { useCandidateAvatars } from '@/hooks/useCandidateAvatars';
import { CandidateAvatar } from './CandidateAvatar';

interface DashboardActivityFeedProps {
  candidates: ATSCandidate[];
  onCandidateClick: (candidate: ATSCandidate) => void;
}

interface ActivityEntry {
  candidate: ATSCandidate;
  date: Date;
  verb: string;
  description: string;
  icon: LucideIcon;
  /** Seuls un placement et un candidat perdu portent une couleur de statut. */
  tone?: 'success' | 'danger';
}

const buildActivityEntries = (candidates: ATSCandidate[]): ActivityEntry[] => {
  const entries: ActivityEntry[] = [];

  candidates.forEach((c) => {
    const lastDate = c.lastActivity || c.createdAt;
    if (!lastDate) return;

    let date: Date;
    try {
      date = parseISO(lastDate);
    } catch {
      return;
    }

    let entry: ActivityEntry | null = null;

    if (c.stage === 'Gagné') {
      entry = {
        candidate: c,
        date,
        verb: 'placé',
        description: c.jobTitle ? `Sur ${c.jobTitle}` : 'Placement confirmé',
        icon: CheckCircle2,
        tone: 'success',
      };
    } else if (c.stage === 'Perdu') {
      entry = {
        candidate: c,
        date,
        verb: 'perdu',
        description: c.jobTitle ? `Sur ${c.jobTitle}` : 'Candidat fermé',
        icon: XCircle,
        tone: 'danger',
      };
    } else if (
      ['replied', 'interested'].includes(c.outreachStatus || '') ||
      c.stage === 'Répondu' ||
      c.sequenceStatus === 'replied'
    ) {
      entry = {
        candidate: c,
        date,
        verb: 'a répondu',
        description: c.headline || c.jobTitle || 'Nouvelle réponse',
        icon: MessageCircle,
      };
    } else if (['ITW en cours', 'Pré-qualif', 'CV envoyé', 'Offre'].includes(c.stage)) {
      entry = {
        candidate: c,
        date,
        verb: 'avance',
        description: `Étape : ${c.stage}`,
        icon: TrendingUp,
      };
    } else if (c.outreachStatus === 'messaged' || c.stage === 'Contacté') {
      entry = {
        candidate: c,
        date,
        verb: 'contacté',
        description: c.sequenceName ? c.sequenceName : c.jobTitle || 'Premier message envoyé',
        icon: Send,
      };
    } else if (c.stage === 'Nouveau' && c.createdAt === lastDate) {
      entry = {
        candidate: c,
        date,
        verb: 'sourcé',
        description: c.jobTitle ? `Pour ${c.jobTitle}` : 'Ajouté au pipeline',
        icon: UserPlus,
      };
    } else if ((c.notesCount || 0) > 0) {
      entry = {
        candidate: c,
        date,
        verb: 'commenté',
        description: `${c.notesCount} note${(c.notesCount || 0) > 1 ? 's' : ''}`,
        icon: StickyNote,
      };
    }

    if (entry) entries.push(entry);
  });

  return entries.sort((a, b) => b.date.getTime() - a.date.getTime()).slice(0, 8);
};

export const DashboardActivityFeed: React.FC<DashboardActivityFeedProps> = ({
  candidates,
  onCandidateClick,
}) => {
  const entries = useMemo(() => buildActivityEntries(candidates), [candidates]);

  // Batch-fetch les photos LinkedIn des candidats du feed (≤8 IDs).
  // Le sourceId pour les candidats locaux est `local-{uuid}` → on extrait l'uuid.
  const sourceIds = useMemo(() => {
    return entries
      .map((e) => {
        if (e.candidate.source === 'local' && e.candidate.id.startsWith('local-')) {
          return e.candidate.id.replace(/^local-/, '');
        }
        return e.candidate.sourceId;
      })
      .filter(Boolean);
  }, [entries]);
  const avatarMap = useCandidateAvatars(sourceIds);

  const getAvatarUrl = (candidate: ATSCandidate): string | null => {
    const key =
      candidate.source === 'local' && candidate.id.startsWith('local-')
        ? candidate.id.replace(/^local-/, '')
        : candidate.sourceId;
    return avatarMap.get(key) || null;
  };

  return (
    <Section
      headingLevel={2}
      title="Activité récente"
      subtitle="Derniers mouvements sur vos candidats"
      action={
        <Button asChild variant="ghost" size="xs">
          <Link to="/pipeline?view=timeline">
            Voir tout
            <ArrowRight aria-hidden="true" />
          </Link>
        </Button>
      }
    >
      <div className="p-2">
        {entries.length === 0 ? (
          <EmptyState
            variant="compact"
            className="border-0"
            icon={Activity}
            title="Aucune activité récente"
            description="Les mouvements de vos candidats (réponses, étapes, placements) s'afficheront ici."
          />
        ) : (
          <ul className="space-y-0.5">
            {entries.map((entry, i) => {
              const Icon = entry.icon;
              const relTime = (() => {
                try {
                  return `il y a ${formatDistanceToNowStrict(entry.date, { locale: fr })}`;
                } catch {
                  return null;
                }
              })();
              return (
                <li key={`${entry.candidate.id}-${i}`}>
                  <button
                    type="button"
                    onClick={() => onCandidateClick(entry.candidate)}
                    className="flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <CandidateAvatar name={entry.candidate.name} avatarUrl={getAvatarUrl(entry.candidate)} size={32} />
                    <span className="min-w-0 flex-1">
                      <span className="flex min-w-0 items-center gap-1.5 text-sm text-foreground">
                        <span className="truncate font-medium">{entry.candidate.name}</span>
                        <span
                          className={cn(
                            'inline-flex shrink-0 items-center gap-1',
                            entry.tone === 'success' ? 'text-success' : entry.tone === 'danger' ? 'text-danger' : 'text-muted-foreground',
                          )}
                        >
                          <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                          {entry.verb}
                        </span>
                      </span>
                      <span className="block truncate text-xs text-muted-foreground">{entry.description}</span>
                    </span>
                    {relTime && <span className="shrink-0 whitespace-nowrap text-xs tabular-nums text-muted-foreground">{relTime}</span>}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </Section>
  );
};

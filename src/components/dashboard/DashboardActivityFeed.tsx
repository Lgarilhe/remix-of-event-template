/**
 * DashboardActivityFeed — feed d'activité récente type Linear/Notion.
 *
 * Affiche les 8 derniers événements détectés sur les candidats :
 * - Mouvement de stage (Nouveau → Contacté, etc.)
 * - Réponse reçue
 * - Note ajoutée
 * - Nouveau candidat sourcé
 *
 * V2 anim : stagger entrance, ligne timeline animée (path draw), live pulse
 * sur les events <5min, hover smooth.
 */

import React, { useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useNavigate } from 'react-router-dom';
import { differenceInMinutes, formatDistanceToNowStrict, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  Activity,
  ArrowRight,
  UserPlus,
  MessageCircle,
  TrendingUp,
  Clock,
  StickyNote,
  CheckCircle2,
  XCircle,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import type { ATSCandidate } from '@/hooks/useATSData';
import { useCandidateAvatars } from '@/hooks/useCandidateAvatars';
import { LivePulse } from './LivePulse';
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
  icon: React.ReactNode;
  iconBg: string;
  iconColor: string;
  isLive?: boolean;
}

const buildActivityEntries = (candidates: ATSCandidate[]): ActivityEntry[] => {
  const entries: ActivityEntry[] = [];
  const now = new Date();

  candidates.forEach((c) => {
    const lastDate = c.lastActivity || c.createdAt;
    if (!lastDate) return;

    let date: Date;
    try {
      date = parseISO(lastDate);
    } catch {
      return;
    }

    const minutesAgo = differenceInMinutes(now, date);
    const isLive = minutesAgo >= 0 && minutesAgo < 30; // <30min = "live"

    let entry: ActivityEntry | null = null;

    if (c.stage === 'Gagné') {
      entry = {
        candidate: c,
        date,
        verb: 'placé',
        description: c.jobTitle ? `Sur ${c.jobTitle}` : 'Placement confirmé',
        icon: <CheckCircle2 className="w-3.5 h-3.5" />,
        iconBg: 'bg-success/10',
        iconColor: 'text-success',
        isLive,
      };
    } else if (c.stage === 'Perdu') {
      entry = {
        candidate: c,
        date,
        verb: 'perdu',
        description: c.jobTitle ? `Sur ${c.jobTitle}` : 'Candidat fermé',
        icon: <XCircle className="w-3.5 h-3.5" />,
        iconBg: 'bg-destructive/10',
        iconColor: 'text-destructive',
        isLive,
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
        icon: <MessageCircle className="w-3.5 h-3.5" />,
        iconBg: 'bg-info/10',
        iconColor: 'text-info',
        isLive,
      };
    } else if (['ITW en cours', 'Pré-qualif', 'CV envoyé', 'Offre'].includes(c.stage)) {
      entry = {
        candidate: c,
        date,
        verb: 'avance',
        description: `Étape : ${c.stage}`,
        icon: <TrendingUp className="w-3.5 h-3.5" />,
        iconBg: 'bg-foreground/[0.06]',
        iconColor: 'text-foreground',
        isLive,
      };
    } else if (c.outreachStatus === 'messaged' || c.stage === 'Contacté') {
      entry = {
        candidate: c,
        date,
        verb: 'contacté',
        description: c.sequenceName ? c.sequenceName : c.jobTitle || 'Outreach lancé',
        icon: <ArrowRight className="w-3.5 h-3.5" />,
        iconBg: 'bg-foreground/[0.06]',
        iconColor: 'text-foreground',
        isLive,
      };
    } else if (c.stage === 'Nouveau' && c.createdAt === lastDate) {
      entry = {
        candidate: c,
        date,
        verb: 'sourcé',
        description: c.jobTitle ? `Pour ${c.jobTitle}` : 'Ajouté au pipeline',
        icon: <UserPlus className="w-3.5 h-3.5" />,
        iconBg: 'bg-foreground/[0.06]',
        iconColor: 'text-muted-foreground',
        isLive,
      };
    } else if ((c.notesCount || 0) > 0) {
      entry = {
        candidate: c,
        date,
        verb: 'commenté',
        description: `${c.notesCount} note${(c.notesCount || 0) > 1 ? 's' : ''}`,
        icon: <StickyNote className="w-3.5 h-3.5" />,
        iconBg: 'bg-foreground/[0.06]',
        iconColor: 'text-muted-foreground',
        isLive,
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
  const navigate = useNavigate();
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
    <motion.div
      className="rounded-xl bg-card border border-border overflow-hidden"
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, ease: 'easeOut', delay: 0.25 }}
    >
      <div className="flex items-center justify-between gap-3 px-5 py-4 border-b border-border bg-muted/20">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-foreground/[0.06] text-foreground flex items-center justify-center shrink-0">
            <Activity className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <h2 className="font-display font-bold text-foreground text-[15px] tracking-tight leading-none">
              Activité récente
            </h2>
            <p className="text-xs text-muted-foreground mt-1">
              Derniers mouvements sur vos candidats
            </p>
          </div>
        </div>
        <button
          onClick={() => navigate('/pipeline?view=timeline')}
          className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground font-medium transition-colors shrink-0"
        >
          Tout voir
          <ArrowRight className="w-3 h-3" />
        </button>
      </div>

      <div className="p-2">
        {entries.length === 0 ? (
          <motion.div
            className="rounded-xl border border-dashed border-border py-10 px-6 text-center mx-1"
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ duration: 0.4 }}
          >
            <div className="h-10 w-10 rounded-full bg-foreground/[0.06] text-muted-foreground flex items-center justify-center mx-auto mb-3">
              <Clock className="w-5 h-5" />
            </div>
            <p className="text-sm text-foreground font-medium">Aucune activité récente</p>
            <p className="text-xs text-muted-foreground mt-1">
              Les mouvements de candidats s'afficheront ici.
            </p>
          </motion.div>
        ) : (
          <motion.div
            className="space-y-0.5 relative"
            initial="hidden"
            animate="visible"
            variants={{
              hidden: {},
              visible: { transition: { staggerChildren: 0.04, delayChildren: 0.3 } },
            }}
          >
            <AnimatePresence>
              {entries.map((entry, i) => {
                const relTime = (() => {
                  try {
                    return formatDistanceToNowStrict(entry.date, { locale: fr, addSuffix: false });
                  } catch {
                    return '—';
                  }
                })();
                return (
                  <motion.button
                    key={`${entry.candidate.id}-${i}`}
                    variants={{
                      hidden: { opacity: 0, x: -6 },
                      visible: { opacity: 1, x: 0, transition: { duration: 0.3, ease: 'easeOut' } },
                    }}
                    exit={{ opacity: 0 }}
                    whileHover={{ x: 2, transition: { duration: 0.15 } }}
                    onClick={() => onCandidateClick(entry.candidate)}
                    className="w-full text-left rounded-lg px-3 py-2.5 transition-colors flex items-center gap-3 hover:bg-muted/40 group relative"
                  >
                    {/* Avatar candidat (photo LinkedIn) + badge action en bas-droite */}
                    <div className="relative shrink-0">
                      <CandidateAvatar
                        name={entry.candidate.name}
                        avatarUrl={getAvatarUrl(entry.candidate)}
                        size={36}
                      />
                      <div
                        className={cn(
                          'absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full flex items-center justify-center ring-2 ring-card',
                          entry.iconBg,
                          entry.iconColor,
                        )}
                      >
                        {React.cloneElement(entry.icon as React.ReactElement, {
                          className: 'w-2.5 h-2.5',
                        })}
                      </div>
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-xs text-foreground truncate">
                        <span className="font-display font-semibold tracking-tight">
                          {entry.candidate.name}
                        </span>
                        <span className="text-muted-foreground"> {entry.verb}</span>
                      </p>
                      <p className="text-xs text-muted-foreground truncate">{entry.description}</p>
                    </div>
                    {entry.isLive && (
                      <LivePulse
                        tone={
                          entry.iconColor.includes('success')
                            ? 'success'
                            : entry.iconColor.includes('destructive')
                            ? 'destructive'
                            : 'info'
                        }
                      />
                    )}
                    <span className="text-[10.5px] text-muted-foreground tabular-nums whitespace-nowrap shrink-0">
                      il y a {relTime}
                    </span>
                  </motion.button>
                );
              })}
            </AnimatePresence>
          </motion.div>
        )}
      </div>
    </motion.div>
  );
};

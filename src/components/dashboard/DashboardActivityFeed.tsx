/**
 * DashboardActivityFeed — feed d'activité récente type Linear/Notion.
 *
 * Affiche les 8 derniers événements détectés sur les candidats :
 * - Mouvement de stage (Nouveau → Contacté, etc.)
 * - Réponse reçue
 * - Note ajoutée
 * - Nouveau candidat sourcé
 *
 * Format ligne ultra-condensé avec icon + verbe d'action + sujet + temps relatif.
 * Click → ouvre le candidat (callback du parent).
 */

import React, { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { formatDistanceToNowStrict, parseISO } from 'date-fns';
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
}

const buildActivityEntries = (candidates: ATSCandidate[]): ActivityEntry[] => {
  const entries: ActivityEntry[] = [];

  candidates.forEach(c => {
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
        icon: <CheckCircle2 className="w-3.5 h-3.5" />,
        iconBg: 'bg-success/10',
        iconColor: 'text-success',
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

  return (
    <div className="rounded-xl bg-card border border-border overflow-hidden">
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
          <div className="rounded-xl border border-dashed border-border py-10 px-6 text-center mx-1">
            <div className="h-10 w-10 rounded-full bg-foreground/[0.06] text-muted-foreground flex items-center justify-center mx-auto mb-3">
              <Clock className="w-5 h-5" />
            </div>
            <p className="text-sm text-foreground font-medium">Aucune activité récente</p>
            <p className="text-xs text-muted-foreground mt-1">
              Les mouvements de candidats s'afficheront ici.
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {entries.map((entry, i) => {
              const relTime = (() => {
                try {
                  return formatDistanceToNowStrict(entry.date, { locale: fr, addSuffix: false });
                } catch {
                  return '—';
                }
              })();
              return (
                <button
                  key={`${entry.candidate.id}-${i}`}
                  onClick={() => onCandidateClick(entry.candidate)}
                  className="w-full text-left rounded-lg px-3 py-2.5 transition-colors flex items-center gap-3 hover:bg-muted/40 group"
                >
                  <div
                    className={cn(
                      'h-8 w-8 rounded-lg flex items-center justify-center shrink-0',
                      entry.iconBg,
                      entry.iconColor,
                    )}
                  >
                    {entry.icon}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-xs text-foreground truncate">
                      <span className="font-display font-semibold tracking-tight">{entry.candidate.name}</span>
                      <span className="text-muted-foreground"> {entry.verb}</span>
                    </p>
                    <p className="text-xs text-muted-foreground truncate">{entry.description}</p>
                  </div>
                  <span className="text-[10.5px] text-muted-foreground tabular-nums whitespace-nowrap shrink-0">
                    il y a {relTime}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};

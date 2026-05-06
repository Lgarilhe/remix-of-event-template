import React, { useMemo } from 'react';
import { ATSCandidate } from '@/pages/ATS';
import { ScrollArea } from '@/components/ui/scroll-area';
import {
  GitBranch,
  FileText,
  Send,
  Bell,
  StickyNote,
  Calendar,
} from 'lucide-react';
import linkedinLogo from '@/assets/linkedin-logo.webp';
import { format, isToday, isYesterday, isThisWeek, isThisMonth, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';

interface ATSTimelineProps {
  candidates: ATSCandidate[];
  onCandidateClick: (candidate: ATSCandidate) => void;
  onJobClick?: (jobId: string) => void;
}

interface TimelineGroup {
  label: string;
  candidates: ATSCandidate[];
}

const SOURCE_CONFIG: Record<string, { icon: React.ReactNode }> = {
  shortlist: { icon: <FileText className="w-3 h-3" /> },
  sequence: { icon: <GitBranch className="w-3 h-3" /> },
  inmail: { icon: <Send className="w-3 h-3" /> },
};

export const ATSTimeline: React.FC<ATSTimelineProps> = ({ candidates, onCandidateClick, onJobClick }) => {
  const timelineGroups = useMemo(() => {
    const groups: TimelineGroup[] = [];
    const today: ATSCandidate[] = [];
    const yesterday: ATSCandidate[] = [];
    const thisWeek: ATSCandidate[] = [];
    const thisMonth: ATSCandidate[] = [];
    const older: ATSCandidate[] = [];

    const sorted = [...candidates].sort((a, b) => {
      const dateA = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
      const dateB = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
      return dateB - dateA;
    });

    sorted.forEach(candidate => {
      if (!candidate.lastActivity) { older.push(candidate); return; }
      const date = parseISO(candidate.lastActivity);
      if (isToday(date)) today.push(candidate);
      else if (isYesterday(date)) yesterday.push(candidate);
      else if (isThisWeek(date)) thisWeek.push(candidate);
      else if (isThisMonth(date)) thisMonth.push(candidate);
      else older.push(candidate);
    });

    if (today.length > 0) groups.push({ label: "Aujourd'hui", candidates: today });
    if (yesterday.length > 0) groups.push({ label: 'Hier', candidates: yesterday });
    if (thisWeek.length > 0) groups.push({ label: 'Cette semaine', candidates: thisWeek });
    if (thisMonth.length > 0) groups.push({ label: 'Ce mois', candidates: thisMonth });
    if (older.length > 0) groups.push({ label: 'Plus ancien', candidates: older });

    return groups;
  }, [candidates]);

  if (candidates.length === 0) {
    return (
      <div className="rounded-xl bg-card border border-border p-12 text-center">
        <Calendar className="w-12 h-12 mx-auto text-muted-foreground/40 mb-4" />
        <p className="text-sm text-muted-foreground">Aucune activité à afficher</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-card border border-border overflow-hidden">
      <ScrollArea className="h-[600px]">
        <div className="p-4">
          {timelineGroups.map((group, groupIndex) => (
            <div key={group.label} className={groupIndex > 0 ? 'mt-8' : ''}>
              {/* Group header */}
              <div className="flex items-center gap-3 mb-4">
                <h3 className="font-display font-bold text-foreground text-[13px] tracking-tight">
                  {group.label}
                </h3>
                <div className="flex-1 h-px bg-border" />
                <span className="inline-flex items-center justify-center min-w-[22px] h-5 px-1.5 rounded-full text-[11px] text-foreground bg-foreground/10 font-bold tabular-nums">
                  {group.candidates.length}
                </span>
              </div>

              {/* Timeline items */}
              <div className="relative pl-6 space-y-3">
                {/* Timeline line */}
                <div className="absolute left-[9px] top-2 bottom-2 w-px bg-border" />

                {group.candidates.map(candidate => {
                  const sourceConfig = SOURCE_CONFIG[candidate.source] || { icon: <FileText className="w-3 h-3" /> };

                  return (
                    <div
                      key={candidate.id}
                      onClick={() => onCandidateClick(candidate)}
                      className="relative cursor-pointer group"
                    >
                      {/* Timeline dot */}
                      <div className="absolute -left-[26px] top-3.5 w-5 h-5 rounded-full bg-foreground flex items-center justify-center text-background ring-4 ring-card">
                        {sourceConfig.icon}
                      </div>

                      {/* Card */}
                      <div className="rounded-xl bg-card border border-border p-3 transition-all hover:shadow-md hover:border-foreground/20">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-display font-bold text-foreground text-[14px] tracking-tight leading-tight">
                                {candidate.name}
                              </span>
                              {candidate.hasReminder && <Bell className="w-3.5 h-3.5 text-primary" />}
                              {(candidate.notesCount || 0) > 0 && (
                                <div className="flex items-center gap-0.5 text-muted-foreground">
                                  <StickyNote className="w-3.5 h-3.5" />
                                  <span className="text-xs">{candidate.notesCount}</span>
                                </div>
                              )}
                            </div>

                            {candidate.headline && (
                              <p className="text-xs text-muted-foreground truncate mb-2">{candidate.headline}</p>
                            )}

                            <div className="flex flex-wrap items-center gap-1.5">
                              <span className="inline-flex items-center text-[10.5px] px-2 py-0.5 rounded-full border border-border bg-foreground/[0.06] uppercase tracking-wider font-semibold text-foreground/85">
                                {candidate.stage}
                              </span>

                              {candidate.jobTitle && (
                                <span
                                  className={`inline-flex items-center text-[10.5px] px-2 py-0.5 rounded-full border border-border bg-background text-muted-foreground truncate max-w-[200px] ${candidate.jobId && onJobClick ? 'cursor-pointer hover:bg-accent hover:text-foreground transition-colors' : ''}`}
                                  onClick={(e) => {
                                    if (candidate.jobId && onJobClick) {
                                      e.stopPropagation();
                                      onJobClick(candidate.jobId);
                                    }
                                  }}
                                >
                                  {candidate.jobTitle}
                                </span>
                              )}

                              {candidate.sequenceName && (
                                <span className="inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full border border-border bg-background text-muted-foreground">
                                  <GitBranch className="w-3 h-3" />
                                  {candidate.sequenceName}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-2 shrink-0">
                            {candidate.lastActivity && (
                              <span className="text-xs text-muted-foreground tabular-nums">
                                {format(parseISO(candidate.lastActivity), 'HH:mm', { locale: fr })}
                              </span>
                            )}
                            {candidate.linkedin && <img src={linkedinLogo} alt="LinkedIn" className="w-3.5 h-3.5 object-contain" />}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </ScrollArea>
    </div>
  );
};

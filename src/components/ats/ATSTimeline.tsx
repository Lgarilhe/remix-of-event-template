import React, { useMemo } from 'react';
import { ATSCandidate } from '@/pages/ATS';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  GitBranch, 
  FileText, 
  Send,
  Bell,
  StickyNote,
  Calendar
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

    if (today.length > 0) groups.push({ label: "AUJOURD'HUI", candidates: today });
    if (yesterday.length > 0) groups.push({ label: 'HIER', candidates: yesterday });
    if (thisWeek.length > 0) groups.push({ label: 'CETTE SEMAINE', candidates: thisWeek });
    if (thisMonth.length > 0) groups.push({ label: 'CE MOIS', candidates: thisMonth });
    if (older.length > 0) groups.push({ label: 'PLUS ANCIEN', candidates: older });

    return groups;
  }, [candidates]);

  if (candidates.length === 0) {
    return (
      <div className="bg-background border border-foreground p-12 text-center">
        <Calendar className="w-12 h-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-muted-foreground text-xs uppercase tracking-wider">Aucune activité à afficher</p>
      </div>
    );
  }

  return (
    <div className="bg-background border border-foreground overflow-hidden">
      <ScrollArea className="h-[600px]">
        <div className="p-4">
          {timelineGroups.map((group, groupIndex) => (
            <div key={group.label} className={groupIndex > 0 ? 'mt-8' : ''}>
              {/* Group header */}
              <div className="flex items-center gap-3 mb-4">
                <h3 className="font-medium text-foreground text-xs uppercase tracking-wider">{group.label}</h3>
                <div className="flex-1 h-px bg-foreground/20" />
                <span className="text-xs text-muted-foreground bg-foreground/10 px-2 py-0.5 font-bold">{group.candidates.length}</span>
              </div>

              {/* Timeline items */}
              <div className="relative pl-6 space-y-3">
                {/* Timeline line */}
                <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-foreground/20" />

                {group.candidates.map(candidate => {
                  const sourceConfig = SOURCE_CONFIG[candidate.source] || { icon: <FileText className="w-3 h-3" /> };
                  
                  return (
                    <div 
                      key={candidate.id}
                      onClick={() => onCandidateClick(candidate)}
                      className="relative cursor-pointer group"
                    >
                      {/* Timeline dot */}
                      <div className="absolute -left-6 top-3 w-4 h-4 bg-foreground flex items-center justify-center text-background">
                        {sourceConfig.icon}
                      </div>

                      {/* Card */}
                      <div className="bg-foreground/5 p-4 border border-transparent group-hover:border-foreground group-hover:shadow-[2px_2px_0px_0px_hsl(var(--foreground))] transition-all">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-foreground text-sm">
                                {candidate.name}
                              </span>
                              {candidate.hasReminder && <Bell className="w-3.5 h-3.5 text-brutal-accent" />}
                              {(candidate.notesCount || 0) > 0 && (
                                <div className="flex items-center gap-0.5 text-muted-foreground">
                                  <StickyNote className="w-3.5 h-3.5" />
                                  <span className="text-xs">{candidate.notesCount}</span>
                                </div>
                              )}
                            </div>

                            {candidate.headline && (
                              <p className="text-sm text-muted-foreground truncate mb-2">{candidate.headline}</p>
                            )}

                            <div className="flex flex-wrap items-center gap-2">
                              <span className="text-xs px-2 py-0.5 border border-foreground/30 uppercase tracking-wider font-medium">
                                {candidate.stage}
                              </span>
                              
                              {candidate.jobTitle && (
                                <span
                                  className={`text-xs px-2 py-0.5 border border-foreground/20 text-muted-foreground ${candidate.jobId && onJobClick ? 'cursor-pointer hover:border-foreground hover:text-foreground transition-colors' : ''}`}
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
                                <span className="text-xs px-2 py-0.5 border border-foreground/20 flex items-center gap-1 text-muted-foreground">
                                  <GitBranch className="w-3 h-3" />
                                  {candidate.sequenceName}
                                </span>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-2">
                            {candidate.lastActivity && (
                              <span className="text-xs text-muted-foreground font-medium">
                                {format(parseISO(candidate.lastActivity), 'HH:mm', { locale: fr })}
                              </span>
                            )}
                            {candidate.linkedin && <img src={linkedinLogo} alt="LinkedIn" className="w-4 h-4 object-contain" />}
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
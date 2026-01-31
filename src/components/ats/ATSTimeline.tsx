import React, { useMemo } from 'react';
import { ATSCandidate } from '@/pages/ATS';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { 
  Linkedin, 
  GitBranch, 
  FileText, 
  Send,
  Bell,
  StickyNote,
  Calendar
} from 'lucide-react';
import { format, isToday, isYesterday, isThisWeek, isThisMonth, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';

interface ATSTimelineProps {
  candidates: ATSCandidate[];
  onCandidateClick: (candidate: ATSCandidate) => void;
}

interface TimelineGroup {
  label: string;
  candidates: ATSCandidate[];
}

const SOURCE_CONFIG: Record<string, { icon: React.ReactNode; color: string }> = {
  shortlist: { icon: <FileText className="w-3 h-3" />, color: 'bg-purple-500' },
  sequence: { icon: <GitBranch className="w-3 h-3" />, color: 'bg-blue-500' },
  inmail: { icon: <Send className="w-3 h-3" />, color: 'bg-cyan-500' },
};

export const ATSTimeline: React.FC<ATSTimelineProps> = ({ candidates, onCandidateClick }) => {
  // Group candidates by date
  const timelineGroups = useMemo(() => {
    const groups: TimelineGroup[] = [];
    const today: ATSCandidate[] = [];
    const yesterday: ATSCandidate[] = [];
    const thisWeek: ATSCandidate[] = [];
    const thisMonth: ATSCandidate[] = [];
    const older: ATSCandidate[] = [];

    // Sort by lastActivity descending
    const sorted = [...candidates].sort((a, b) => {
      const dateA = a.lastActivity ? new Date(a.lastActivity).getTime() : 0;
      const dateB = b.lastActivity ? new Date(b.lastActivity).getTime() : 0;
      return dateB - dateA;
    });

    sorted.forEach(candidate => {
      if (!candidate.lastActivity) {
        older.push(candidate);
        return;
      }

      const date = parseISO(candidate.lastActivity);
      
      if (isToday(date)) {
        today.push(candidate);
      } else if (isYesterday(date)) {
        yesterday.push(candidate);
      } else if (isThisWeek(date)) {
        thisWeek.push(candidate);
      } else if (isThisMonth(date)) {
        thisMonth.push(candidate);
      } else {
        older.push(candidate);
      }
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
      <div className="bg-white rounded-xl border border-[#1A1A1A]/10 p-12 text-center">
        <Calendar className="w-12 h-12 mx-auto text-[#1A1A1A]/20 mb-4" />
        <p className="text-[#1A1A1A]/50">Aucune activité à afficher</p>
      </div>
    );
  }

  return (
    <div className="bg-white rounded-xl border border-[#1A1A1A]/10 overflow-hidden">
      <ScrollArea className="h-[600px]">
        <div className="p-4">
          {timelineGroups.map((group, groupIndex) => (
            <div key={group.label} className={groupIndex > 0 ? 'mt-8' : ''}>
              {/* Group header */}
              <div className="flex items-center gap-3 mb-4">
                <h3 className="font-semibold text-[#1A1A1A]">{group.label}</h3>
                <div className="flex-1 h-px bg-[#1A1A1A]/10" />
                <span className="text-sm text-[#1A1A1A]/50">{group.candidates.length}</span>
              </div>

              {/* Timeline items */}
              <div className="relative pl-6 space-y-4">
                {/* Timeline line */}
                <div className="absolute left-[9px] top-2 bottom-2 w-0.5 bg-[#1A1A1A]/10" />

                {group.candidates.map(candidate => {
                  const sourceConfig = SOURCE_CONFIG[candidate.source];
                  
                  return (
                    <div 
                      key={candidate.id}
                      onClick={() => onCandidateClick(candidate)}
                      className="relative cursor-pointer group"
                    >
                      {/* Timeline dot */}
                      <div className={`absolute -left-6 top-3 w-4 h-4 rounded-full ${sourceConfig.color} flex items-center justify-center text-white`}>
                        {sourceConfig.icon}
                      </div>

                      {/* Card */}
                      <div className="bg-[#FAFAFA] rounded-lg p-4 border border-transparent group-hover:border-[#1A1A1A]/20 group-hover:shadow-sm transition-all">
                        <div className="flex items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 mb-1">
                              <span className="font-medium text-[#1A1A1A]">
                                {candidate.name}
                              </span>
                              {candidate.hasReminder && (
                                <Bell className="w-3.5 h-3.5 text-amber-500" />
                              )}
                              {(candidate.notesCount || 0) > 0 && (
                                <div className="flex items-center gap-0.5 text-[#1A1A1A]/50">
                                  <StickyNote className="w-3.5 h-3.5" />
                                  <span className="text-[10px]">{candidate.notesCount}</span>
                                </div>
                              )}
                            </div>

                            {candidate.headline && (
                              <p className="text-sm text-[#1A1A1A]/60 truncate mb-2">
                                {candidate.headline}
                              </p>
                            )}

                            <div className="flex flex-wrap items-center gap-2">
                              <Badge variant="outline" className="text-xs">
                                {candidate.stage}
                              </Badge>
                              
                              {candidate.jobTitle && (
                                <Badge variant="outline" className="text-xs bg-gray-50">
                                  {candidate.jobTitle}
                                </Badge>
                              )}

                              {candidate.sequenceName && (
                                <Badge variant="outline" className="text-xs gap-1 bg-blue-50 text-blue-700">
                                  <GitBranch className="w-3 h-3" />
                                  {candidate.sequenceName}
                                </Badge>
                              )}
                            </div>
                          </div>

                          <div className="flex flex-col items-end gap-2">
                            {candidate.lastActivity && (
                              <span className="text-xs text-[#1A1A1A]/50">
                                {format(parseISO(candidate.lastActivity), 'HH:mm', { locale: fr })}
                              </span>
                            )}
                            
                            {candidate.linkedin && (
                              <Linkedin className="w-4 h-4 text-[#0077B5]" />
                            )}
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

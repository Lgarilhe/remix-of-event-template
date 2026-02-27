import React from 'react';
import { ATSCandidate } from '@/pages/ATS';
import { 
  Linkedin, 
  Mail, 
  StickyNote, 
  Bell, 
  GitBranch, 
  FileText,
  Send,
  Target
} from 'lucide-react';

interface ATSCandidateCardProps {
  candidate: ATSCandidate;
  isDragging?: boolean;
  onClick: () => void;
}

const SOURCE_CONFIG: Record<string, { icon: React.ReactNode; label: string }> = {
  shortlist: { icon: <FileText className="w-3 h-3" />, label: 'Pipeline' },
  sequence: { icon: <GitBranch className="w-3 h-3" />, label: 'Séquence' },
  inmail: { icon: <Send className="w-3 h-3" />, label: 'InMail' },
  outreach: { icon: <Target className="w-3 h-3" />, label: 'Outreach' },
};

export const ATSCandidateCard: React.FC<ATSCandidateCardProps> = ({
  candidate,
  isDragging,
  onClick,
}) => {
  const sourceConfig = SOURCE_CONFIG[candidate.source] || SOURCE_CONFIG.shortlist;

  return (
    <div
      onClick={onClick}
      className={`
        bg-background border border-foreground/20 p-3 cursor-pointer transition-all
        hover:shadow-[3px_3px_0px_0px_hsl(var(--foreground))] hover:border-foreground
        ${isDragging ? 'shadow-[4px_4px_0px_0px_hsl(var(--brutal-accent))] border-foreground' : ''}
      `}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <h4 className="font-medium text-foreground truncate text-sm uppercase tracking-tight">
            {candidate.name}
          </h4>
          {candidate.headline && (
            <p className="text-xs text-muted-foreground truncate">
              {candidate.headline}
            </p>
          )}
        </div>
        
        {/* Indicators */}
        <div className="flex items-center gap-1 flex-shrink-0">
          {candidate.score != null && (
            <span className={`text-[10px] font-bold px-1.5 py-0.5 border ${
              candidate.score >= 70 ? 'border-foreground bg-brutal-accent text-foreground' : 
              candidate.score >= 40 ? 'border-foreground/50 bg-background text-foreground' : 'border-destructive text-destructive'
            }`}>
              {candidate.score}%
            </span>
          )}
          {candidate.hasReminder && (
            <Bell className="w-3.5 h-3.5 text-brutal-accent" />
          )}
          {(candidate.notesCount || 0) > 0 && (
            <div className="flex items-center gap-0.5 text-muted-foreground">
              <StickyNote className="w-3.5 h-3.5" />
              <span className="text-[10px]">{candidate.notesCount}</span>
            </div>
          )}
        </div>
      </div>

      {/* Source & Job */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <span className="text-[10px] px-1.5 py-0.5 border border-foreground/30 bg-foreground/5 flex items-center gap-1 uppercase tracking-wider font-medium text-foreground">
          {sourceConfig.icon}
          {sourceConfig.label}
        </span>
        
        {candidate.jobTitle && (
          <span className="text-[10px] px-1.5 py-0.5 border border-foreground/20 bg-background text-muted-foreground truncate max-w-[140px]">
            {candidate.jobTitle.length > 20 
              ? candidate.jobTitle.slice(0, 20) + '...' 
              : candidate.jobTitle}
          </span>
        )}
      </div>

      {/* Sequence info */}
      {candidate.sequenceName && (
        <div className="text-[10px] text-muted-foreground mb-2 flex items-center gap-1">
          <GitBranch className="w-3 h-3" />
          {candidate.sequenceName}
          {candidate.sequenceStatus && (
            <span className="border border-foreground/20 px-1 py-0 text-[8px] uppercase tracking-wider">
              {candidate.sequenceStatus}
            </span>
          )}
        </div>
      )}

      {/* Expertise tags */}
      {candidate.expertise.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {candidate.expertise.slice(0, 3).map(skill => (
            <span 
              key={skill} 
              className="text-[10px] px-1.5 py-0 bg-foreground/5 text-muted-foreground border border-foreground/10"
            >
              {skill}
            </span>
          ))}
          {candidate.expertise.length > 3 && (
            <span className="text-[10px] px-1.5 py-0 bg-foreground/5 text-muted-foreground border border-foreground/10">
              +{candidate.expertise.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-muted-foreground">
        <div className="flex items-center gap-2">
          {candidate.linkedin && (
            <Linkedin className="w-3 h-3 text-[#0077B5]" />
          )}
          {candidate.email && (
            <Mail className="w-3 h-3" />
          )}
        </div>
        
        {candidate.lastActivity && (
          <span>
            {new Date(candidate.lastActivity).toLocaleDateString('fr-FR', {
              day: 'numeric',
              month: 'short',
            })}
          </span>
        )}
      </div>
    </div>
  );
};
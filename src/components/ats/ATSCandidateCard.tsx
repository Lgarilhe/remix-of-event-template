import React from 'react';
import { Badge } from '@/components/ui/badge';
import { ATSCandidate } from '@/pages/ATS';
import { 
  Linkedin, 
  Mail, 
  StickyNote, 
  Bell, 
  GitBranch, 
  FileText,
  Send
} from 'lucide-react';

interface ATSCandidateCardProps {
  candidate: ATSCandidate;
  isDragging?: boolean;
  onClick: () => void;
}

const SOURCE_CONFIG: Record<string, { icon: React.ReactNode; label: string; color: string }> = {
  shortlist: { 
    icon: <FileText className="w-3 h-3" />, 
    label: 'Pipeline', 
    color: 'bg-purple-100 text-purple-700' 
  },
  sequence: { 
    icon: <GitBranch className="w-3 h-3" />, 
    label: 'Séquence', 
    color: 'bg-blue-100 text-blue-700' 
  },
  inmail: { 
    icon: <Send className="w-3 h-3" />, 
    label: 'InMail', 
    color: 'bg-cyan-100 text-cyan-700' 
  },
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
        bg-white rounded-lg border p-3 cursor-pointer transition-all
        hover:shadow-md hover:border-[#1A1A1A]/20
        ${isDragging ? 'shadow-lg border-primary/40' : 'border-[#1A1A1A]/10'}
      `}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <h4 className="font-medium text-[#1A1A1A] truncate text-sm">
            {candidate.name}
          </h4>
          {candidate.headline && (
            <p className="text-xs text-[#1A1A1A]/60 truncate">
              {candidate.headline}
            </p>
          )}
        </div>
        
        {/* Indicators */}
        <div className="flex items-center gap-1 flex-shrink-0">
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
      </div>

      {/* Source & Job */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <Badge variant="outline" className={`text-[10px] px-1.5 py-0 gap-1 ${sourceConfig.color}`}>
          {sourceConfig.icon}
          {sourceConfig.label}
        </Badge>
        
        {candidate.jobTitle && (
          <Badge variant="outline" className="text-[10px] px-1.5 py-0 bg-gray-50">
            {candidate.jobTitle.length > 20 
              ? candidate.jobTitle.slice(0, 20) + '...' 
              : candidate.jobTitle}
          </Badge>
        )}
      </div>

      {/* Sequence info */}
      {candidate.sequenceName && (
        <div className="text-[10px] text-[#1A1A1A]/50 mb-2 flex items-center gap-1">
          <GitBranch className="w-3 h-3" />
          {candidate.sequenceName}
          {candidate.sequenceStatus && (
            <Badge variant="outline" className="text-[8px] px-1 py-0">
              {candidate.sequenceStatus}
            </Badge>
          )}
        </div>
      )}

      {/* Expertise tags */}
      {candidate.expertise.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {candidate.expertise.slice(0, 3).map(skill => (
            <Badge 
              key={skill} 
              variant="secondary" 
              className="text-[10px] px-1.5 py-0 bg-[#1A1A1A]/5"
            >
              {skill}
            </Badge>
          ))}
          {candidate.expertise.length > 3 && (
            <Badge variant="secondary" className="text-[10px] px-1.5 py-0 bg-[#1A1A1A]/5">
              +{candidate.expertise.length - 3}
            </Badge>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-[10px] text-[#1A1A1A]/40">
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

import React from 'react';
import { ATSCandidate } from '@/hooks/useATSData';
import { differenceInDays, parseISO } from 'date-fns';
import linkedinLogo from '@/assets/linkedin-logo.webp';
import { 
  Mail, 
  StickyNote, 
  Bell, 
  GitBranch, 
  FileText,
  Send,
  Target,
  ThumbsUp,
  ThumbsDown,
  MessageCircle,
  AlertTriangle,
  Tag
} from 'lucide-react';

interface ATSCandidateCardProps {
  candidate: ATSCandidate;
  isDragging?: boolean;
  onClick: () => void;
  onJobClick?: (jobId: string) => void;
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
  onJobClick,
}) => {
  const sourceConfig = SOURCE_CONFIG[candidate.source] || SOURCE_CONFIG.shortlist;

  // Stagnation detection: guide times per stage (days)
  const GUIDE_TIMES: Record<string, number> = {
    'Nouveau': 3, 'Contacté': 5, 'Répondu': 3, 'Pressenti': 5,
    'Pré-qualif': 7, 'CV envoyé': 5, 'ITW en cours': 10, 'Offre': 7,
  };
  const guideTime = GUIDE_TIMES[candidate.stage];
  const daysSince = candidate.lastActivity
    ? differenceInDays(new Date(), parseISO(candidate.lastActivity))
    : null;
  const isStagnant = guideTime != null && daysSince != null && daysSince > guideTime;

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
            <span className={`text-xs font-bold px-1.5 py-0.5 border ${
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
              <span className="text-xs">{candidate.notesCount}</span>
            </div>
          )}
        </div>
      </div>

      {/* Source & Job & Outreach Status */}
      <div className="flex flex-wrap items-center gap-1.5 mb-2">
        <span className="text-xs px-1.5 py-0.5 border border-foreground/30 bg-foreground/5 flex items-center gap-1 uppercase tracking-wider font-medium text-foreground">
          {sourceConfig.icon}
          {sourceConfig.label}
        </span>
        
        {candidate.outreachStatus === 'interested' && (
          <span className="text-xs px-1.5 py-0.5 border border-green-500 bg-green-50 text-green-700 flex items-center gap-1 uppercase tracking-wider font-bold">
            <ThumbsUp className="w-3 h-3" />
            Intéressé
          </span>
        )}
        {candidate.outreachStatus === 'not_interested' && (
          <span className="text-xs px-1.5 py-0.5 border border-red-400 bg-red-50 text-red-600 flex items-center gap-1 uppercase tracking-wider font-bold">
            <ThumbsDown className="w-3 h-3" />
            Pas intéressé
          </span>
        )}
        {candidate.outreachStatus === 'replied' && (
          <span className="text-xs px-1.5 py-0.5 border border-blue-400 bg-blue-50 text-blue-600 flex items-center gap-1 uppercase tracking-wider font-bold">
            <MessageCircle className="w-3 h-3" />
            Répondu
          </span>
        )}

        {candidate.jobTitle && (
          <span
            className={`text-xs px-1.5 py-0.5 border border-foreground/20 bg-background text-muted-foreground truncate max-w-[140px] ${candidate.jobId && onJobClick ? 'cursor-pointer hover:border-foreground hover:text-foreground transition-colors' : ''}`}
            onClick={(e) => {
              if (candidate.jobId && onJobClick) {
                e.stopPropagation();
                onJobClick(candidate.jobId);
              }
            }}
          >
            {candidate.jobTitle.length > 20 
              ? candidate.jobTitle.slice(0, 20) + '...' 
              : candidate.jobTitle}
          </span>
        )}
      </div>

      {/* Sequence info */}
      {candidate.sequenceName && (
        <div className="text-xs text-muted-foreground mb-2 flex items-center gap-1">
          <GitBranch className="w-3 h-3" />
          {candidate.sequenceName}
          {candidate.sequenceStatus && (
            <span className="border border-foreground/20 px-1 py-0 text-[8px] uppercase tracking-wider">
              {candidate.sequenceStatus}
            </span>
          )}
        </div>
      )}

      {/* Tags */}
      {(candidate.tags || []).length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {(candidate.tags || []).slice(0, 3).map(tag => (
            <span key={tag} className="text-xs px-1.5 py-0 bg-brutal-accent/20 text-foreground border border-brutal-accent/40 font-medium">
              {tag}
            </span>
          ))}
          {(candidate.tags || []).length > 3 && (
            <span className="text-xs px-1.5 py-0 bg-foreground/5 text-muted-foreground border border-foreground/10">
              +{(candidate.tags || []).length - 3}
            </span>
          )}
        </div>
      )}

      {/* Stagnation alert */}
      {isStagnant && (
        <div className="flex items-center gap-1 text-xs text-destructive font-medium mb-2">
          <AlertTriangle className="w-3 h-3" />
          Inactif depuis {daysSince}j (max {guideTime}j)
        </div>
      )}

      {/* Expertise tags */}
      {candidate.expertise.length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {candidate.expertise.slice(0, 3).map(skill => (
            <span 
              key={skill} 
              className="text-xs px-1.5 py-0 bg-foreground/5 text-muted-foreground border border-foreground/10"
            >
              {skill}
            </span>
          ))}
          {candidate.expertise.length > 3 && (
            <span className="text-xs px-1.5 py-0 bg-foreground/5 text-muted-foreground border border-foreground/10">
              +{candidate.expertise.length - 3}
            </span>
          )}
        </div>
      )}

      {/* Footer */}
      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          {candidate.linkedin && (
            <img src={linkedinLogo} alt="LinkedIn" className="w-3 h-3 object-contain" />
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
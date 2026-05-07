import React from 'react';
import { ATSCandidate } from '@/hooks/useATSData';
import { differenceInDays, parseISO, formatDistanceToNowStrict } from 'date-fns';
import { fr } from 'date-fns/locale';
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
  /** Si défini, affiche une checkbox (bulk select) */
  selected?: boolean;
  onToggleSelect?: () => void;
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
  selected,
  onToggleSelect,
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
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); } }}
      aria-label={`Candidat ${candidate.name}${candidate.score != null ? ', score ' + candidate.score + '%' : ''}, étape ${candidate.stage}`}
      className={`
        group rounded-xl bg-card border p-3 cursor-pointer transition-all hover:shadow-md hover:border-foreground/20 relative
        ${selected ? 'border-foreground/40 ring-2 ring-foreground/20 bg-accent/30' : 'border-border'}
        ${isDragging ? 'shadow-lg border-foreground/30' : ''}
        ${isStagnant ? 'border-l-4 border-l-destructive' : ''}
      `}
    >
      {/* Bulk select checkbox — visible au hover ou si déjà sélectionné */}
      {onToggleSelect && (
        <button
          type="button"
          role="checkbox"
          aria-checked={!!selected}
          aria-label={`Sélectionner ${candidate.name} pour action groupée`}
          onClick={(e) => { e.stopPropagation(); onToggleSelect(); }}
          onPointerDown={(e) => e.stopPropagation()}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onToggleSelect();
            }
          }}
          className={`absolute top-1.5 left-1.5 w-4 h-4 rounded-md border-2 flex items-center justify-center transition-opacity z-10 ${
            selected
              ? 'opacity-100 bg-foreground border-foreground'
              : 'opacity-0 group-hover:opacity-100 hover:opacity-100 border-foreground/40 bg-background'
          }`}
        >
          {selected && (
            <svg className="w-3 h-3 text-background" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" aria-hidden="true">
              <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          )}
        </button>
      )}
      {/* Header */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="min-w-0 flex-1">
          <h4 className="font-display font-bold text-foreground truncate text-[14px] tracking-tight leading-tight">
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
          {candidate.score != null && candidate.score > 0 && (
            <span
              className={`inline-flex items-center text-2xs font-bold tabular-nums px-1.5 py-0.5 rounded-full border ${
                candidate.score >= 70 ? 'border-success/40 bg-success/10 text-success' :
                candidate.score >= 40 ? 'border-warning/40 bg-warning/10 text-warning' :
                'border-destructive/40 bg-destructive/10 text-destructive'
              }`}
              title={`Score IA : ${candidate.score}/100`}
            >
              {candidate.score}
            </span>
          )}
          {candidate.hasReminder && (
            <Bell className="w-3.5 h-3.5 text-primary" />
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
        <span className="inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded-full border border-border bg-foreground/[0.06] uppercase tracking-wider font-semibold text-foreground/85">
          {sourceConfig.icon}
          {sourceConfig.label}
        </span>

        {candidate.outreachStatus === 'interested' && (
          <span className="inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded-full border border-success/40 bg-success/10 text-success uppercase tracking-wider font-bold">
            <ThumbsUp className="w-3 h-3" />
            Intéressé
          </span>
        )}
        {candidate.outreachStatus === 'not_interested' && (
          <span className="inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded-full border border-destructive/40 bg-destructive/5 text-destructive uppercase tracking-wider font-bold">
            <ThumbsDown className="w-3 h-3" />
            Pas intéressé
          </span>
        )}
        {candidate.outreachStatus === 'replied' && (
          <span className="inline-flex items-center gap-1 text-2xs px-1.5 py-0.5 rounded-full border border-info/40 bg-info/10 text-info uppercase tracking-wider font-bold">
            <MessageCircle className="w-3 h-3" />
            Répondu
          </span>
        )}

        {candidate.jobTitle && (
          <span
            className={`inline-flex items-center text-2xs px-2 py-0.5 rounded-full border border-border bg-background text-muted-foreground truncate max-w-[140px] ${candidate.jobId && onJobClick ? 'cursor-pointer hover:bg-accent hover:text-foreground transition-colors' : ''}`}
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
            <span className="inline-flex items-center rounded-full border border-border bg-foreground/[0.06] px-1.5 py-0 text-3xs uppercase tracking-wider font-semibold">
              {candidate.sequenceStatus}
            </span>
          )}
        </div>
      )}

      {/* Tags */}
      {(candidate.tags || []).length > 0 && (
        <div className="flex flex-wrap gap-1 mb-2">
          {(candidate.tags || []).slice(0, 3).map(tag => (
            <span key={tag} className="inline-flex items-center text-2xs px-2 py-0.5 rounded-full bg-accent/20 text-foreground border border-accent/40 font-medium">
              {tag}
            </span>
          ))}
          {(candidate.tags || []).length > 3 && (
            <span className="inline-flex items-center text-2xs px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground border border-border">
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
              className="inline-flex items-center text-2xs px-2 py-0.5 rounded-full bg-foreground/[0.06] text-foreground/85 border border-border"
            >
              {skill}
            </span>
          ))}
          {candidate.expertise.length > 3 && (
            <span className="inline-flex items-center text-2xs px-2 py-0.5 rounded-full bg-muted/40 text-muted-foreground border border-border">
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
            <Mail className="w-3 h-3" aria-label="Email disponible" />
          )}
        </div>

        {candidate.lastActivity && (() => {
          // Affichage temps relatif "il y a Xj/h" — plus parlant qu'une date sèche.
          // Si > 30j, on bascule sur la date pour éviter "il y a 234 jours".
          const days = daysSince ?? 0;
          let label: string;
          try {
            label = days > 30
              ? new Date(candidate.lastActivity).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' })
              : `il y a ${formatDistanceToNowStrict(parseISO(candidate.lastActivity), { locale: fr })}`;
          } catch {
            label = '—';
          }
          return (
            <span
              className={`tabular-nums ${isStagnant ? 'text-destructive font-medium' : ''}`}
              title={new Date(candidate.lastActivity).toLocaleString('fr-FR')}
            >
              {label}
            </span>
          );
        })()}
      </div>
    </div>
  );
};
import React from 'react';
import { RecruiterProfile, RecruiterMatchScore } from '@/lib/recruiterMatching';
import { Star, Briefcase, Clock, TrendingUp, MapPin } from 'lucide-react';
import { cn } from '@/lib/utils';

interface RecruiterMatchCardProps {
  recruiter: RecruiterProfile;
  score: RecruiterMatchScore;
  onInvite: (userId: string) => void;
  isInviting?: boolean;
}

export const RecruiterMatchCard: React.FC<RecruiterMatchCardProps> = ({
  recruiter, score, onInvite, isInviting,
}) => {
  const name = recruiter.display_name || 'Recruteur';
  const initials = name.split(/\s+/).slice(0, 2).map(w => w[0]?.toUpperCase() || '').join('');

  return (
    <div className="border border-foreground/20 bg-background hover:border-foreground hover:shadow-[3px_3px_0px_0px_hsl(var(--foreground))] transition-all">
      <div className="p-4 space-y-3">
        {/* Header */}
        <div className="flex items-start gap-3">
          <div
            className="w-10 h-10 flex items-center justify-center text-sm font-bold text-white border border-foreground shrink-0"
            style={{ background: 'linear-gradient(135deg, hsl(var(--skalr-purple)), hsl(var(--skalr-pink)))' }}
          >
            {initials}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-bold uppercase tracking-wider text-foreground truncate">{name}</p>
            <div className="flex items-center gap-2 mt-0.5">
              {recruiter.years_experience && (
                <span className="text-[9px] text-muted-foreground flex items-center gap-0.5">
                  <Briefcase className="w-2.5 h-2.5" /> {recruiter.years_experience} ans
                </span>
              )}
              {recruiter.rating != null && recruiter.rating > 0 && (
                <span className="text-[9px] text-foreground font-bold flex items-center gap-0.5">
                  <Star className="w-2.5 h-2.5" /> {recruiter.rating.toFixed(1)}
                </span>
              )}
            </div>
          </div>
          {/* Match score */}
          <div className={cn(
            "w-10 h-10 flex items-center justify-center text-sm font-bold border-2 shrink-0",
            score.overall >= 80 ? "border-foreground bg-foreground text-background" :
            score.overall >= 60 ? "border-foreground/60 text-foreground" :
            "border-foreground/30 text-muted-foreground"
          )}>
            {score.overall}
          </div>
        </div>

        {/* Badges */}
        {score.badges.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {score.badges.slice(0, 3).map((badge, i) => (
              <span key={i} className="px-1.5 py-0.5 text-[8px] font-bold uppercase tracking-wider border border-foreground/20 text-foreground">
                {badge}
              </span>
            ))}
          </div>
        )}

        {/* Score breakdown */}
        <div className="grid grid-cols-3 gap-2 text-center">
          <div>
            <div className="h-1 bg-foreground/10 mb-1">
              <div className="h-full bg-foreground transition-all" style={{ width: `${score.specialization_match}%` }} />
            </div>
            <p className="text-[8px] text-muted-foreground uppercase tracking-wider">Skills</p>
          </div>
          <div>
            <div className="h-1 bg-foreground/10 mb-1">
              <div className="h-full bg-foreground transition-all" style={{ width: `${score.performance}%` }} />
            </div>
            <p className="text-[8px] text-muted-foreground uppercase tracking-wider">Perf.</p>
          </div>
          <div>
            <div className="h-1 bg-foreground/10 mb-1">
              <div className="h-full bg-foreground transition-all" style={{ width: `${score.availability}%` }} />
            </div>
            <p className="text-[8px] text-muted-foreground uppercase tracking-wider">Dispo</p>
          </div>
        </div>

        {/* Stats */}
        <div className="flex items-center gap-3 text-[9px] text-muted-foreground">
          {recruiter.placements_count != null && recruiter.placements_count > 0 && (
            <span className="flex items-center gap-0.5">
              <TrendingUp className="w-2.5 h-2.5" /> {recruiter.placements_count} placements
            </span>
          )}
          {recruiter.avg_time_to_fill_days != null && recruiter.avg_time_to_fill_days > 0 && (
            <span className="flex items-center gap-0.5">
              <Clock className="w-2.5 h-2.5" /> {recruiter.avg_time_to_fill_days}j avg
            </span>
          )}
        </div>

        {/* Specializations */}
        {recruiter.specializations && recruiter.specializations.length > 0 && (
          <div className="flex flex-wrap gap-1">
            {recruiter.specializations.slice(0, 4).map((spec, i) => (
              <span key={i} className="px-1.5 py-0.5 text-[8px] font-medium border border-foreground/10 text-muted-foreground">
                {spec}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Invite button */}
      <div className="border-t border-foreground/10 p-3">
        <button
          onClick={() => onInvite(recruiter.user_id)}
          disabled={isInviting}
          className="relative overflow-hidden w-full h-[34px] bg-foreground text-background border border-foreground text-[10px] font-medium uppercase tracking-wider group disabled:opacity-50"
        >
          <span className="relative z-10">{isInviting ? 'Envoi...' : 'Inviter sur la mission'}</span>
          <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
        </button>
      </div>
    </div>
  );
};

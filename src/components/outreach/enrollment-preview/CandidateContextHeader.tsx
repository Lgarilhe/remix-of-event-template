import React, { useMemo, useState } from 'react';
import { LinkedInProfile } from '@/components/outreach/types';
import { computeYearsOfExperience } from './types';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MapPin, Briefcase, GraduationCap, ChevronRight, Mail, Sparkles } from 'lucide-react';
import { useCandidateFullProfile } from '@/hooks/useCandidateFullProfile';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { motion } from 'framer-motion';
import { CandidateAvatar } from '@/components/candidates/shared/CandidateAvatar';

interface Props {
  profile: LinkedInProfile;
  score?: { score: number | null; recommendation: string | null } | null;
  linkedinUrl: string | null;
}

export function CandidateContextHeader({ profile, score, linkedinUrl }: Props) {
  const yearsXP = useMemo(() => computeYearsOfExperience(profile), [profile]);
  const isOpenToWork = profile.open_to_work || (profile as any).is_open_to_work;

  const workSummary = useMemo(() => {
    const exps = profile.work_experience?.slice(0, 3) || [];
    return exps.map(e => e.company).filter(Boolean).join(' → ');
  }, [profile.work_experience]);

  const education = useMemo(() => {
    const edu = profile.education?.[0];
    if (!edu) return null;
    return [edu.school, edu.degree, edu.field_of_study].filter(Boolean).join(' — ');
  }, [profile.education]);

  const skills = useMemo(() => {
    return (profile.skills || []).slice(0, 6).map(s => typeof s === 'string' ? s : s.name).filter(Boolean);
  }, [profile.skills]);

  const hasEmail = profile.contact_info?.emails?.length;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
      className="rounded-2xl border border-border bg-gradient-to-br from-card to-muted/20 p-5 sm:p-6 shadow-sm"
    >
      {/* Hero row : avatar XL + identité forte */}
      <div className="flex items-start gap-4 sm:gap-5">
        <div className="relative shrink-0">
          <CandidateAvatar
            name={profile.name}
            imageUrl={profile.profile_picture_url}
            size="lg"
            className="!w-16 !h-16 sm:!w-20 sm:!h-20 ring-2 ring-background shadow-md"
          />
          {isOpenToWork && (
            <span
              className="absolute -bottom-1 -right-1 h-5 w-5 rounded-full bg-success border-2 border-background grid place-items-center shadow-sm"
              title="Open to Work"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-white" style={{ animation: 'konektPulseDot 1.6s ease-in-out infinite' }} />
            </span>
          )}
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-3 flex-wrap">
            <div className="min-w-0 flex-1">
              <h2 className="font-display text-[20px] sm:text-[22px] font-bold leading-tight tracking-tight text-foreground">
                {profile.name}
              </h2>
              <p className="text-[13px] text-muted-foreground mt-1 line-clamp-2 leading-snug">
                {profile.headline || '—'}
              </p>
            </div>
            {score?.score != null && (
              <ScoreCircle score={score.score} recommendation={score.recommendation} />
            )}
          </div>

          {/* Meta row : location + xp + email status */}
          <div className="flex items-center gap-3 mt-3 flex-wrap text-[12px]">
            {profile.location && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <MapPin className="w-3.5 h-3.5" />
                <span>{profile.location.split(',')[0]}</span>
              </span>
            )}
            {yearsXP != null && (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Briefcase className="w-3.5 h-3.5" />
                <span><strong className="text-foreground tabular-nums">{yearsXP}</strong> ans XP</span>
              </span>
            )}
            {hasEmail && (
              <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-info/10 text-info border border-info/30 text-[11px] font-medium">
                <Mail className="w-3 h-3" />
                Email
              </span>
            )}
            {isOpenToWork && (
              <span className="inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/30 text-[11px] font-medium">
                <span className="h-1.5 w-1.5 rounded-full bg-success" style={{ animation: 'konektPulseDot 1.6s ease-in-out infinite' }} />
                Open to Work
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Parcours + Formation : visuel plus aéré */}
      {(workSummary || education) && (
        <div className="mt-5 space-y-2 pt-4 border-t border-border/60">
          {workSummary && (
            <div className="flex items-start gap-2.5">
              <div className="h-7 w-7 rounded-lg bg-foreground/5 grid place-items-center shrink-0 mt-0.5">
                <Briefcase className="w-3.5 h-3.5 text-foreground/70" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-0.5">
                  Parcours
                </p>
                <p className="text-[13px] text-foreground leading-snug">
                  {workSummary}
                  <span className="text-muted-foreground/70 ml-1.5 text-[11.5px]">
                    ({profile.work_experience?.length || 0} postes)
                  </span>
                </p>
              </div>
            </div>
          )}
          {education && (
            <div className="flex items-start gap-2.5">
              <div className="h-7 w-7 rounded-lg bg-foreground/5 grid place-items-center shrink-0 mt-0.5">
                <GraduationCap className="w-3.5 h-3.5 text-foreground/70" />
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-[10px] uppercase tracking-wider text-muted-foreground/70 font-semibold mb-0.5">
                  Formation
                </p>
                <p className="text-[13px] text-foreground leading-snug">
                  {education}
                </p>
              </div>
            </div>
          )}
        </div>
      )}

      {/* Skills tags — plus visibles, plus présents */}
      {skills.length > 0 && (
        <div className="mt-4 flex items-center gap-1.5 flex-wrap">
          {skills.map(s => (
            <span
              key={s}
              className="text-[11.5px] px-2.5 py-1 rounded-full bg-foreground/5 border border-border text-foreground/80 font-medium hover:bg-foreground/10 transition-colors"
            >
              {s}
            </span>
          ))}
        </div>
      )}

      {/* Lazy-loaded history */}
      <CandidateHistorySection candidateId={profile.id} linkedinUrl={linkedinUrl} />
    </motion.div>
  );
}

// ─── Score Circle (gauge visuelle au lieu d'une pill plate) ─────────
function ScoreCircle({ score, recommendation }: { score: number; recommendation: string | null }) {
  const tone = score >= 70 ? 'success' : score >= 50 ? 'warning' : 'destructive';
  const colors = {
    success: { ring: 'hsl(var(--status-success))', bg: 'hsl(var(--status-success-muted))', text: 'hsl(var(--status-success))' },
    warning: { ring: 'hsl(var(--status-warning))', bg: 'hsl(var(--status-warning-muted))', text: 'hsl(var(--status-warning))' },
    destructive: { ring: 'hsl(var(--destructive))', bg: 'hsl(var(--destructive) / 0.1)', text: 'hsl(var(--destructive))' },
  }[tone];

  // Circle dimensions
  const size = 56;
  const stroke = 4;
  const radius = (size - stroke) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (Math.min(score, 100) / 100) * circumference;

  return (
    <div className="flex flex-col items-center shrink-0" title={recommendation || `Score ${score}/100`}>
      <div className="relative" style={{ width: size, height: size }}>
        <svg width={size} height={size} className="-rotate-90">
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke="hsl(var(--border))"
            strokeWidth={stroke}
            fill="none"
          />
          <motion.circle
            cx={size / 2}
            cy={size / 2}
            r={radius}
            stroke={colors.ring}
            strokeWidth={stroke}
            fill="none"
            strokeLinecap="round"
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset: offset }}
            transition={{ duration: 0.8, ease: [0.22, 1, 0.36, 1], delay: 0.15 }}
            style={{ strokeDasharray: circumference }}
          />
        </svg>
        <div className="absolute inset-0 grid place-items-center">
          <span className="font-display font-bold text-[14px] tabular-nums" style={{ color: colors.text }}>
            {score}
          </span>
        </div>
      </div>
      {recommendation && (
        <span className="text-[10px] uppercase tracking-wider font-semibold mt-1" style={{ color: colors.text }}>
          {recommendation}
        </span>
      )}
    </div>
  );
}

function CandidateHistorySection({ candidateId, linkedinUrl }: { candidateId: string; linkedinUrl: string | null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const handleOpen = (open: boolean) => {
    setIsOpen(open);
    if (open && !loaded) setLoaded(true);
  };

  return (
    <div className="mt-4 pt-3 border-t border-border/60">
      {loaded ? (
        <CandidateHistoryLoaded candidateId={candidateId} linkedinUrl={linkedinUrl} isOpen={isOpen} onOpenChange={handleOpen} />
      ) : (
        <Collapsible open={isOpen} onOpenChange={handleOpen}>
          <CollapsibleTrigger className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground hover:text-foreground transition-colors font-medium">
            <ChevronRight className="w-3.5 h-3.5" />
            Historique des interactions
          </CollapsibleTrigger>
        </Collapsible>
      )}
    </div>
  );
}

function CandidateHistoryLoaded({ candidateId, linkedinUrl, isOpen, onOpenChange }: {
  candidateId: string; linkedinUrl: string | null; isOpen: boolean; onOpenChange: (open: boolean) => void;
}) {
  const { timeline, loading } = useCandidateFullProfile(candidateId, linkedinUrl);
  const recentTimeline = timeline.slice(0, 5);

  if (!loading && recentTimeline.length === 0) return null;

  return (
    <Collapsible open={isOpen} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground hover:text-foreground transition-colors font-medium">
        <ChevronRight className={`w-3.5 h-3.5 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
        Historique <span className="opacity-70 tabular-nums">({loading ? '…' : `${timeline.length} interaction${timeline.length > 1 ? 's' : ''}`})</span>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pl-4 mt-2 space-y-1.5 border-l-2 border-border/60 ml-1.5">
          {loading ? (
            <>
              <Skeleton className="h-3 w-48" />
              <Skeleton className="h-3 w-40" />
            </>
          ) : (
            recentTimeline.map((item, i) => (
              <div key={i} className="text-[11.5px] text-muted-foreground leading-snug">
                <span className="font-semibold text-foreground/80 tabular-nums">
                  {item.date ? format(new Date(item.date), 'dd MMM', { locale: fr }) : '—'}
                </span>
                <span className="mx-1.5 opacity-50">·</span>
                {item.title}
                {item.detail && <span className="italic opacity-70"> — {item.detail}</span>}
              </div>
            ))
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

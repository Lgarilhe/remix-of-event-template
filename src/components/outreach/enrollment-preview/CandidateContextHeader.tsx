import React, { useMemo, useState } from 'react';
import { LinkedInProfile } from '@/components/outreach/types';
import { computeYearsOfExperience } from './types';
import { Badge } from '@/components/ui/badge';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MapPin, Briefcase, GraduationCap, Tag, ChevronRight, Mail } from 'lucide-react';
import { useCandidateFullProfile, CandidateActivity } from '@/hooks/useCandidateFullProfile';
import { Skeleton } from '@/components/ui/skeleton';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
// I3 — primitive partagée pour avatar candidat uniforme
import { CandidateAvatar } from '@/components/candidates/shared/CandidateAvatar';

interface Props {
  profile: LinkedInProfile;
  score?: { score: number | null; recommendation: string | null } | null;
  linkedinUrl: string | null;
}

export function CandidateContextHeader({ profile, score, linkedinUrl }: Props) {
  const yearsXP = useMemo(() => computeYearsOfExperience(profile), [profile]);
  const isOpenToWork = profile.open_to_work || (profile as any).is_open_to_work;

  // Work history summary
  const workSummary = useMemo(() => {
    const exps = profile.work_experience?.slice(0, 3) || [];
    return exps.map(e => e.company).filter(Boolean).join(' → ');
  }, [profile.work_experience]);

  // Education
  const education = useMemo(() => {
    const edu = profile.education?.[0];
    if (!edu) return null;
    return [edu.school, edu.degree, edu.field_of_study].filter(Boolean).join(' — ');
  }, [profile.education]);

  // Skills
  const skills = useMemo(() => {
    return (profile.skills || []).slice(0, 6).map(s => typeof s === 'string' ? s : s.name).filter(Boolean);
  }, [profile.skills]);

  return (
    <div className="pb-4 border-b border-border space-y-3">
      {/* Header row */}
      <div className="flex items-start gap-3">
        <CandidateAvatar
          name={profile.name}
          imageUrl={profile.profile_picture_url}
          size="lg"
        />
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-semibold">{profile.name}</h3>
          <p className="text-xs text-muted-foreground truncate">{profile.headline}</p>
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            {profile.location && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <MapPin className="w-3 h-3" /> {profile.location}
              </span>
            )}
            {yearsXP != null && (
              <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                <Briefcase className="w-3 h-3" /> {yearsXP} ans d'expérience
              </span>
            )}
          </div>
        </div>
        {profile.contact_info?.emails?.length ? (
          <Badge variant="outline" className="text-[10px] gap-1 shrink-0">
            <Mail className="w-2.5 h-2.5" /> Email
          </Badge>
        ) : null}
      </div>

      {/* Quick info — refonte avec icons Lucide propres au lieu d'emojis */}
      <div className="space-y-1.5 pl-1">
        {workSummary && (
          <p className="text-[11.5px] text-muted-foreground flex items-start gap-1.5">
            <Briefcase className="w-3 h-3 mt-0.5 text-muted-foreground/70 shrink-0" />
            <span>
              {workSummary}{' '}
              <span className="text-muted-foreground/60">({profile.work_experience?.length || 0} postes)</span>
            </span>
          </p>
        )}
        {education && (
          <p className="text-[11.5px] text-muted-foreground flex items-start gap-1.5">
            <GraduationCap className="w-3 h-3 mt-0.5 text-muted-foreground/70 shrink-0" />
            <span>{education}</span>
          </p>
        )}
        {skills.length > 0 && (
          <div className="flex items-center gap-1 flex-wrap pt-0.5">
            <Tag className="w-3 h-3 text-muted-foreground/70 shrink-0" />
            {skills.map(s => (
              <span
                key={s}
                className="text-[10px] px-1.5 py-0.5 rounded-md bg-muted/40 border border-border text-foreground/80 hover:bg-muted/60 transition-colors"
              >
                {s}
              </span>
            ))}
          </div>
        )}
        <div className="flex items-center gap-2 flex-wrap pt-1">
          {isOpenToWork && (
            <span className="inline-flex items-center gap-1.5 text-[10.5px] px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/30 font-medium">
              <span className="h-1.5 w-1.5 rounded-full bg-success" style={{ animation: 'konektPulseDot 1.6s ease-in-out infinite' }} />
              Open to Work
            </span>
          )}
          {score?.score != null && (
            <span className={`inline-flex items-center gap-1.5 text-[10.5px] px-2 py-0.5 rounded-full font-medium border ${
              score.score >= 70 ? 'bg-success/10 text-success border-success/30'
              : score.score >= 50 ? 'bg-warning/10 text-warning border-warning/30'
              : 'bg-destructive/10 text-destructive border-destructive/30'
            }`}>
              Score {score.score}/100
              {score.recommendation && <span className="opacity-70">· {score.recommendation}</span>}
            </span>
          )}
        </div>
      </div>

      {/* Lazy-loaded history */}
      <CandidateHistorySection candidateId={profile.id} linkedinUrl={linkedinUrl} />
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

  return loaded ? (
    <CandidateHistoryLoaded candidateId={candidateId} linkedinUrl={linkedinUrl} isOpen={isOpen} onOpenChange={handleOpen} />
  ) : (
    <Collapsible open={isOpen} onOpenChange={handleOpen}>
      <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors py-1">
        <ChevronRight className="w-3 h-3" />
        Historique des interactions
      </CollapsibleTrigger>
    </Collapsible>
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
      <CollapsibleTrigger className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground transition-colors py-1">
        <ChevronRight className={`w-3 h-3 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
        Historique ({loading ? '…' : `${timeline.length} interaction${timeline.length > 1 ? 's' : ''}`})
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="pl-4 mt-1 space-y-1 border-l border-border ml-1">
          {loading ? (
            <>
              <Skeleton className="h-3 w-48" />
              <Skeleton className="h-3 w-40" />
            </>
          ) : (
            recentTimeline.map((item, i) => (
              <div key={i} className="text-[10px] text-muted-foreground">
                <span className="font-medium text-foreground/70">
                  {item.date ? format(new Date(item.date), 'dd/MM', { locale: fr }) : '—'}
                </span>
                {' — '}{item.title}
                {item.detail && <span className="italic"> · {item.detail}</span>}
              </div>
            ))
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

import React, { useMemo, useState } from 'react';
import { LinkedInProfile } from '@/components/outreach/types';
import { computeYearsOfExperience } from './types';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { MapPin, Briefcase, GraduationCap, ChevronRight } from 'lucide-react';
import { useCandidateFullProfile } from '@/hooks/useCandidateFullProfile';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { ScoreBadge } from '@/components/ui/score-badge';
import { ChannelIcon } from '@/components/ui/ChannelIcon';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';
import { CandidateAvatar } from '@/components/candidates/shared/CandidateAvatar';

interface Props {
  profile: LinkedInProfile;
  score?: { score: number | null; recommendation: string | null } | null;
  linkedinUrl: string | null;
}

/**
 * En-tête du candidat affiché dans la préparation : surface plate, aucun
 * mouvement, score au barème commun (revue design D-50).
 */
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
    return [edu.school, edu.degree, edu.field_of_study].filter(Boolean).join(', ');
  }, [profile.education]);

  const skills = useMemo(() => {
    return (profile.skills || []).slice(0, 6).map(s => typeof s === 'string' ? s : s.name).filter(Boolean);
  }, [profile.skills]);

  const hasEmail = !!profile.contact_info?.emails?.length;
  const positions = profile.work_experience?.length || 0;

  return (
    <section aria-label={`Profil de ${profile.name || 'ce candidat'}`} className="rounded-xl border border-border bg-card p-4 sm:p-5">
      <div className="flex items-start gap-4">
        <CandidateAvatar name={profile.name} imageUrl={profile.profile_picture_url} size="lg" className="sm:h-14 sm:w-14" />

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
            <div className="min-w-0 flex-1">
              <h3 className="text-lg font-semibold leading-tight text-foreground">{profile.name}</h3>
              {profile.headline && (
                <p className="mt-1 line-clamp-2 text-sm leading-snug text-foreground-secondary">{profile.headline}</p>
              )}
            </div>
            <ScoreBadge score={score?.score} showLevel className="shrink-0" />
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
            {profile.location && (
              <span className="inline-flex items-center gap-1">
                <MapPin className="h-3.5 w-3.5" aria-hidden="true" />
                {profile.location.split(',')[0]}
              </span>
            )}
            {yearsXP != null && (
              <span className="inline-flex items-center gap-1">
                <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
                <span className="tabular-nums">{yearsXP} ans d'expérience</span>
              </span>
            )}
            {hasEmail && (
              <span className="inline-flex items-center gap-1">
                <span aria-hidden="true" className="inline-flex"><ChannelIcon channel="email" size="xs" /></span>
                Adresse e-mail connue
              </span>
            )}
            {isOpenToWork && <Badge variant="success">Ouvert aux opportunités</Badge>}
          </div>
        </div>
      </div>

      {(workSummary || education) && (
        <div className="mt-4 space-y-2 border-t border-border pt-4">
          {workSummary && (
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                <Briefcase className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="eyebrow">Parcours</p>
                <p className="text-sm leading-snug text-foreground">
                  {workSummary}
                  <span className="ml-1.5 text-xs text-muted-foreground">
                    ({positions} {positions > 1 ? 'postes' : 'poste'})
                  </span>
                </p>
              </div>
            </div>
          )}
          {education && (
            <div className="flex items-start gap-2.5">
              <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">
                <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" />
              </span>
              <div className="min-w-0 flex-1">
                <p className="eyebrow">Formation</p>
                <p className="text-sm leading-snug text-foreground">{education}</p>
              </div>
            </div>
          )}
        </div>
      )}

      {skills.length > 0 && (
        <ul className="mt-4 flex flex-wrap items-center gap-1.5" aria-label="Compétences">
          {skills.map(s => (
            <li key={s}>
              <Badge variant="muted" className="font-normal">{s}</Badge>
            </li>
          ))}
        </ul>
      )}

      {/* Lazy-loaded history */}
      <CandidateHistorySection candidateId={profile.id} linkedinUrl={linkedinUrl} />
    </section>
  );
}

const triggerClass =
  'inline-flex items-center gap-1.5 rounded-md text-xs font-medium text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-md:min-h-11';

function CandidateHistorySection({ candidateId, linkedinUrl }: { candidateId: string; linkedinUrl: string | null }) {
  const [isOpen, setIsOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);

  const handleOpen = (open: boolean) => {
    setIsOpen(open);
    if (open && !loaded) setLoaded(true);
  };

  return (
    <div className="mt-4 border-t border-border pt-3">
      {loaded ? (
        <CandidateHistoryLoaded candidateId={candidateId} linkedinUrl={linkedinUrl} isOpen={isOpen} onOpenChange={handleOpen} />
      ) : (
        <Collapsible open={isOpen} onOpenChange={handleOpen}>
          <CollapsibleTrigger className={triggerClass}>
            <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
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

  return (
    <Collapsible open={isOpen} onOpenChange={onOpenChange}>
      <CollapsibleTrigger className={triggerClass}>
        <ChevronRight className={cn('h-3.5 w-3.5 transition-transform duration-150', isOpen && 'rotate-90')} aria-hidden="true" />
        Historique des interactions
        {!loading && (
          <span className="tabular-nums">({timeline.length})</span>
        )}
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="ml-1.5 mt-2 space-y-1.5 border-l border-border pl-4">
          {loading ? (
            <>
              <Skeleton className="h-3 w-48" />
              <Skeleton className="h-3 w-40" />
            </>
          ) : recentTimeline.length === 0 ? (
            <p className="text-xs text-muted-foreground">Aucune interaction avec ce candidat pour le moment.</p>
          ) : (
            recentTimeline.map((item, i) => (
              <p key={i} className="text-xs leading-snug text-muted-foreground">
                {item.date && (
                  <span className="font-medium tabular-nums text-foreground">
                    {format(new Date(item.date), 'd MMM', { locale: fr })}
                  </span>
                )}
                {item.date && <span aria-hidden="true"> · </span>}
                {item.title}
                {item.detail && <span> · {item.detail}</span>}
              </p>
            ))
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

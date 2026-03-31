import { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { ScorecardTab } from '@/components/ats/ScorecardTab';
import { ATSCandidate } from '@/hooks/useATSData';
import { EnrichedProfile } from '@/hooks/useProfileEnrichment';
import { ArrowLeft, User, ChevronUp, ChevronDown, ExternalLink, MapPin, Building2, Briefcase, GraduationCap, Wrench, X } from 'lucide-react';
import { JobDetailSheet } from '@/components/ats/JobDetailSheet';
import iconProfile3d from '@/assets/icon-profile-3d.webp';
import iconJob3d from '@/assets/icon-job-3d.webp';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function ScorecardFullPage() {
  const { candidateId } = useParams<{ candidateId: string }>();
  const [searchParams] = useSearchParams();
  const autoCoaching = searchParams.get('coaching') === '1';
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<ATSCandidate | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSection, setProfileSection] = useState<'exp' | 'edu' | 'skills'>('exp');
  const [expandedExp, setExpandedExp] = useState<Set<number>>(new Set());
  const [logoErrors, setLogoErrors] = useState<Set<string>>(new Set());
  const [jobOpen, setJobOpen] = useState(false);

  useEffect(() => {
    if (!candidateId) return;
    const load = async () => {
      setLoading(true);
      const { data, error } = await supabase
        .from('job_candidate_status')
        .select('*')
        .eq('candidate_id', candidateId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (error || !data) {
        toast.error('Candidat introuvable');
        navigate(-1);
        return;
      }

      const c: ATSCandidate = {
        id: data.id,
        candidateId: data.candidate_id,
        name: data.candidate_name || 'Candidat',
        email: null,
        phone: null,
        linkedin: data.linkedin_profile_url || null,
        headline: data.candidate_headline || null,
        expertise: [],
        stage: data.pipeline_stage || 'Nouveau',
        entity: null,
        source: 'local',
        sourceId: data.id,
        jobId: data.job_id,
        jobTitle: null,
        lastActivity: data.updated_at,
        createdAt: data.created_at,
        score: data.score,
        recommendation: data.recommendation,
        scoringDetails: data.scoring_details as any,
        linkedinProfileData: data.linkedin_profile_data,
        tags: data.tags || [],
      };

      if (data.job_id) {
        const { data: proj } = await supabase
          .from('sourcing_projects')
          .select('job_title')
          .eq('job_id', data.job_id)
          .limit(1)
          .maybeSingle();
        if (proj?.job_title) c.jobTitle = proj.job_title;
      }

      setCandidate(c);
      setLoading(false);
    };
    load();
  }, [candidateId]);

  const enrichedProfile = useMemo<EnrichedProfile | null>(() => {
    if (!candidate?.linkedinProfileData) return null;
    const p = candidate.linkedinProfileData as any;

    const workExperience = p.work_experience || p.experiences || p.positions || [];
    const currentJob = workExperience.find((exp: any) => !exp.end) || workExperience[0];

    let yearsOfExperience: number | undefined = p.years_of_experience;
    if (!yearsOfExperience) {
      const allStartYears = workExperience
        .map((exp: any) => exp.start?.year)
        .filter(Boolean) as number[];
      if (allStartYears.length > 0) {
        yearsOfExperience = new Date().getFullYear() - Math.min(...allStartYears);
      }
    }

    return {
      name: p.name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || candidate.name,
      headline: p.headline || p.occupation,
      summary: p.summary || p.about,
      currentRole: currentJob?.role || currentJob?.title,
      currentCompany: currentJob?.company || currentJob?.company_name,
      location: typeof p.location === 'string' ? p.location : p.location?.name || p.city,
      skills: p.skills?.map((s: any) => typeof s === 'string' ? s : s.name).filter(Boolean) || [],
      experiences: workExperience.map((exp: any) => ({
        title: exp.role || exp.title || '',
        company: exp.company || exp.company_name || '',
        logo: exp.company_logo || exp.logo_url || exp.logo || undefined,
        description: exp.description || '',
        startDate: exp.start ? `${exp.start.year || ''}${exp.start.month ? `-${String(exp.start.month).padStart(2, '0')}` : ''}` : (exp.start_date || ''),
        endDate: exp.end ? `${exp.end.year || ''}${exp.end.month ? `-${String(exp.end.month).padStart(2, '0')}` : ''}` : (exp.end_date || ''),
        isCurrent: !exp.end && !exp.end_date,
      })),
      education: (p.education || []).map((edu: any) => {
        const schoolName = typeof edu.school === 'string'
          ? edu.school
          : edu.school?.name || edu.school_name || edu.school_details?.name || '';
        const schoolLogo =
          edu.school_logo || edu.logo_url || edu.logo ||
          edu.school_details?.logo || edu.school_details?.logo_url ||
          (typeof edu.school === 'object' ? edu.school?.logo : undefined);
        return {
          school: schoolName,
          logo: schoolLogo || undefined,
          degree: edu.degree || edu.degree_name || '',
          field: edu.field_of_study || edu.field || '',
        };
      }),
      yearsOfExperience,
    };
  }, [candidate]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-foreground/20 border-t-foreground rounded-full animate-spin" />
      </div>
    );
  }

  if (!candidate) return null;

  const profileData = candidate.linkedinProfileData as any;

  return (
    <div className="min-h-screen bg-background text-foreground pb-16">
      {/* Sticky header */}
      <div className="sticky top-0 z-10 bg-background border-b-2 border-foreground px-4 py-3">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3 min-w-0">
            <button
              onClick={() => navigate(-1)}
              className="h-8 w-8 flex items-center justify-center border-2 border-foreground text-foreground hover:bg-foreground hover:text-background transition-colors shrink-0"
            >
              <ArrowLeft className="w-4 h-4" />
            </button>
            <div className="min-w-0">
              <h1 className="text-sm font-bold uppercase tracking-wider truncate">
                Scorecard — {candidate.name}
              </h1>
              <p className="text-xs text-muted-foreground truncate">
                {candidate.jobTitle || 'Poste non spécifié'}
                {candidate.headline && ` · ${candidate.headline}`}
              </p>
            </div>
          </div>
          {autoCoaching && (
            <div className="flex items-center gap-1.5 shrink-0">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-red-400 opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-red-500" />
              </span>
              <span className="text-xs text-red-500 uppercase tracking-wider font-bold hidden sm:inline">Coaching Live</span>
            </div>
          )}
        </div>
      </div>

      {/* Scorecard content */}
      <div className="max-w-3xl mx-auto px-4 py-6">
        <ScorecardTab
          candidate={candidate}
          enrichedProfile={enrichedProfile}
          onOpenProfile={() => setProfileOpen(true)}
          autoStartCoaching={autoCoaching}
        />
      </div>

      {/* Fixed bottom toolbar */}
      <div className="fixed inset-x-0 bottom-0 z-30 bg-background/70 backdrop-blur-xl border-t border-foreground/10 px-4 py-2 flex items-center justify-between">
        <button
          onClick={() => { setJobOpen(!jobOpen); if (!jobOpen) setProfileOpen(false); }}
          className={cn(
            "h-9 flex items-center gap-2 px-4 border-2 border-foreground shadow-[3px_3px_0px_0px_hsl(var(--brutal-accent))] transition-all text-xs font-bold uppercase tracking-wider",
            jobOpen
              ? "bg-foreground text-background shadow-none translate-x-[1px] translate-y-[1px]"
              : "bg-background text-foreground hover:bg-foreground hover:text-background"
          )}
        >
          <img src={iconJob3d} alt="" className="w-5 h-5 object-contain" />
          Poste
          {jobOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
        </button>
        <button
          onClick={() => { setProfileOpen(!profileOpen); if (!profileOpen) setJobOpen(false); }}
          className={cn(
            "h-9 flex items-center gap-2 px-4 border-2 border-foreground shadow-[3px_3px_0px_0px_hsl(var(--brutal-accent))] transition-all text-xs font-bold uppercase tracking-wider",
            profileOpen
              ? "bg-foreground text-background shadow-none translate-x-[1px] translate-y-[1px]"
              : "bg-background text-foreground hover:bg-foreground hover:text-background"
          )}
        >
          <img src={iconProfile3d} alt="" className="w-5 h-5 object-contain" />
          Profil
          {profileOpen ? <ChevronDown className="w-3 h-3" /> : <ChevronUp className="w-3 h-3" />}
        </button>
      </div>

      {/* Profile preview drawer (bottom sheet) */}
      {profileOpen && (
        <div className="fixed inset-x-0 bottom-[52px] z-20 bg-background border-t-2 border-foreground shadow-[0_-4px_20px_rgba(0,0,0,0.15)] max-h-[50vh] flex flex-col animate-in slide-in-from-bottom duration-200">
          {/* Sticky profile header + nav */}
          <div className="shrink-0 border-b border-foreground/10">
            <div className="max-w-3xl mx-auto px-4 pt-4 pb-3">
              {/* Identity row */}
              <div className="flex items-start justify-between gap-3 mb-3">
                <div className="min-w-0">
                  <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">{candidate.name}</h3>
                  {enrichedProfile?.headline && (
                    <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{enrichedProfile.headline}</p>
                  )}
                  <div className="flex items-center gap-3 mt-1 flex-wrap">
                    {enrichedProfile?.location && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <MapPin className="w-3 h-3" /> {enrichedProfile.location}
                      </span>
                    )}
                    {enrichedProfile?.currentCompany && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground">
                        <Building2 className="w-3 h-3" /> {enrichedProfile.currentCompany}
                      </span>
                    )}
                    {enrichedProfile?.yearsOfExperience && (
                      <span className="text-xs text-muted-foreground">{enrichedProfile.yearsOfExperience} ans d'XP</span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1.5 shrink-0">
                  {candidate.linkedin && (
                    <a href={candidate.linkedin} target="_blank" rel="noopener noreferrer"
                      className="h-7 px-2.5 flex items-center gap-1 border border-foreground text-foreground text-xs font-bold uppercase tracking-wider hover:bg-foreground hover:text-background transition-colors">
                      <ExternalLink className="w-3 h-3" /> LinkedIn
                    </a>
                  )}
                  <button onClick={() => setProfileOpen(false)}
                    className="h-7 w-7 flex items-center justify-center border border-foreground/20 text-muted-foreground hover:text-foreground transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              </div>

              {/* Section nav tabs */}
              <div className="flex gap-0">
                {([
                  { key: 'exp' as const, label: 'Experience', icon: Briefcase, count: enrichedProfile?.experiences?.length || 0 },
                  { key: 'edu' as const, label: 'Education', icon: GraduationCap, count: enrichedProfile?.education?.length || 0 },
                  { key: 'skills' as const, label: 'Skills', icon: Wrench, count: enrichedProfile?.skills?.length || 0 },
                ]).map(tab => (
                  <button key={tab.key} onClick={() => setProfileSection(tab.key)}
                    className={cn(
                      "flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold uppercase tracking-wider border transition-colors -mr-px",
                      profileSection === tab.key
                        ? "bg-foreground text-background border-foreground"
                        : "border-foreground/20 text-muted-foreground hover:border-foreground/40"
                    )}>
                    <tab.icon className="w-3 h-3" />
                    {tab.label}
                    {tab.count > 0 && <span className="text-[8px] opacity-60">{tab.count}</span>}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Scrollable content */}
          <div className="flex-1 overflow-y-auto">
            <div className="max-w-3xl mx-auto px-4 py-4">

              {/* Experience section */}
              {profileSection === 'exp' && (
                <div className="space-y-1">
                  {(!enrichedProfile?.experiences || enrichedProfile.experiences.length === 0) ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">Aucune expérience disponible</p>
                  ) : (
                    enrichedProfile.experiences.map((exp, i) => {
                      const isExpanded = expandedExp.has(i);
                      const companySlug = (exp.company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                      const logoKey = `exp-${companySlug}`;
                      const dataLogo = (exp as any).logo;
                      const clearbitUrl = companySlug ? `https://logo.clearbit.com/${companySlug}.com` : null;
                      const hasLogoError = logoErrors.has(logoKey);
                      const logoSrc = dataLogo || (!hasLogoError && clearbitUrl ? clearbitUrl : null);

                      return (
                        <div key={i} className={cn(
                          "border-l-2 pl-3 py-2 cursor-pointer hover:bg-foreground/[0.02] transition-colors",
                          exp.isCurrent ? "border-emerald-400" : "border-foreground/15"
                        )}
                          onClick={() => setExpandedExp(prev => {
                            const next = new Set(prev);
                            next.has(i) ? next.delete(i) : next.add(i);
                            return next;
                          })}
                        >
                          <div className="flex items-start gap-2.5">
                            <div className="w-8 h-8 shrink-0 border border-foreground/10 bg-foreground/[0.03] flex items-center justify-center overflow-hidden">
                              {logoSrc ? (
                                <img src={logoSrc} alt="" className="w-6 h-6 object-contain"
                                  onError={() => setLogoErrors(prev => new Set(prev).add(logoKey))} />
                              ) : (
                                <Building2 className="w-3.5 h-3.5 text-muted-foreground/40" />
                              )}
                            </div>
                            <div className="min-w-0 flex-1">
                              <p className="text-xs font-bold text-foreground leading-tight">{exp.title}</p>
                              <p className="text-xs text-muted-foreground">{exp.company}</p>
                              {exp.startDate && (
                                <p className="text-xs text-muted-foreground/60 mt-0.5">
                                  {typeof exp.startDate === 'string' ? exp.startDate : ''}
                                  {exp.endDate ? ` → ${typeof exp.endDate === 'string' ? exp.endDate : ''}` : ' → Présent'}
                                </p>
                              )}
                            </div>
                            {exp.description && (
                              <ChevronDown className={cn("w-3 h-3 text-muted-foreground/40 shrink-0 mt-1 transition-transform", isExpanded && "rotate-180")} />
                            )}
                          </div>
                          {isExpanded && exp.description && (
                            <p className="text-xs text-muted-foreground leading-relaxed mt-2 ml-[42px] whitespace-pre-line">
                              {exp.description}
                            </p>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* Education section */}
              {profileSection === 'edu' && (
                <div className="space-y-1">
                  {(!enrichedProfile?.education || enrichedProfile.education.length === 0) ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">Aucune formation disponible</p>
                  ) : (
                    enrichedProfile.education.map((edu, i) => {
                      const schoolSlug = (edu.school || '').toLowerCase().replace(/[^a-z0-9]/g, '');
                      const logoKey = `edu-${schoolSlug}`;
                      const dataLogo = (edu as any).logo;
                      const clearbitUrl = schoolSlug ? `https://logo.clearbit.com/${schoolSlug}.com` : null;
                      const hasLogoError = logoErrors.has(logoKey);
                      const logoSrc = dataLogo || (!hasLogoError && clearbitUrl ? clearbitUrl : null);

                      return (
                        <div key={i} className="border-l-2 border-foreground/15 pl-3 py-2">
                          <div className="flex items-start gap-2.5">
                            <div className="w-8 h-8 shrink-0 border border-foreground/10 bg-foreground/[0.03] flex items-center justify-center overflow-hidden">
                              {logoSrc ? (
                                <img src={logoSrc} alt="" className="w-6 h-6 object-contain"
                                  onError={() => setLogoErrors(prev => new Set(prev).add(logoKey))} />
                              ) : (
                                <GraduationCap className="w-3.5 h-3.5 text-muted-foreground/40" />
                              )}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-bold text-foreground">{edu.school}</p>
                              {edu.degree && <p className="text-xs text-muted-foreground">{edu.degree}</p>}
                              {edu.field && <p className="text-xs text-muted-foreground/60">{edu.field}</p>}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              )}

              {/* Skills section */}
              {profileSection === 'skills' && (
                <div>
                  {(!enrichedProfile?.skills || enrichedProfile.skills.length === 0) ? (
                    <p className="text-xs text-muted-foreground py-4 text-center">Aucune compétence disponible</p>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {enrichedProfile.skills.map((skill, i) => {
                        const name = typeof skill === 'string' ? skill : (skill as any).name || '';
                        return (
                          <span key={i} className="px-2.5 py-1 border border-foreground/15 text-xs font-medium text-muted-foreground hover:border-foreground/30 transition-colors">
                            {name}
                          </span>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

            </div>
          </div>
        </div>
      )}

      {/* Job detail sheet */}
      <JobDetailSheet
        jobId={candidate.jobId}
        open={jobOpen}
        onOpenChange={setJobOpen}
      />
    </div>
  );
}

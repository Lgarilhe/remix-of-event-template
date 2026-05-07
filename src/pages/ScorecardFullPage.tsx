/**
 * ScorecardFullPage — vue plein écran de la scorecard d'évaluation.
 *
 * V3 (mai 2026) : refonte workspace pro
 * - max-width supprimée → utilise toute la largeur (suppression max-w-5xl)
 * - Header riche avec progress bar visuelle + score running + recommendation
 *   compacts en pill
 * - Sidebar collapsible (bouton Réduire/Étendre) pour donner du focus au
 *   workspace si besoin
 * - Live progress de la scorecard chargée depuis la DB pour pré-render le
 *   header avec X/Y critères évalués + score moyen avant même que ScorecardTab
 *   finisse son load (UX plus snappy)
 * - Mobile : tabs en haut comme avant
 */

import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate, useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { ScorecardTab } from '@/components/ats/ScorecardTab';
import { ATSCandidate } from '@/hooks/useATSData';
import { EnrichedProfile } from '@/hooks/useProfileEnrichment';
import {
  ArrowLeft,
  ExternalLink,
  MapPin,
  Building2,
  Briefcase,
  GraduationCap,
  Mic,
  Loader2,
  User,
  Target,
  Sparkles,
  PanelLeftClose,
  PanelLeftOpen,
  CheckCircle2,
} from 'lucide-react';
import { JobDetailSheet } from '@/components/ats/JobDetailSheet';
import { useNotionJobs } from '@/hooks/useNotionJobs';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { ScrollArea } from '@/components/ui/scroll-area';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

type SidebarTab = 'candidate' | 'job';

interface QuickEval {
  criteriaCount: number;
  ratedCount: number;
  overallScore: number | null;
  recommendation: string | null;
}

export default function ScorecardFullPage() {
  const { candidateId } = useParams<{ candidateId: string }>();
  const [searchParams] = useSearchParams();
  const autoCoaching = searchParams.get('coaching') === '1';
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<ATSCandidate | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobOpen, setJobOpen] = useState(false);
  const [logoErrors, setLogoErrors] = useState<Set<string>>(new Set());
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('candidate');
  const [mobilePane, setMobilePane] = useState<'sidebar' | 'scorecard'>('scorecard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [quickEval, setQuickEval] = useState<QuickEval | null>(null);

  const { data: notionJobs } = useNotionJobs();

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
  }, [candidateId, navigate]);

  // Load quick eval stats (for header progress bar)
  useEffect(() => {
    if (!candidateId) return;
    const loadEval = async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;
      const { data } = await supabase
        .from('candidate_evaluations')
        .select('criteria, ratings, overall_score, recommendation')
        .eq('candidate_id', candidateId)
        .eq('created_by', user.id)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (!data) {
        setQuickEval(null);
        return;
      }
      const criteria = (data.criteria as any[]) || [];
      const ratings = (data.ratings as Record<string, number>) || {};
      const ratedCount = Object.values(ratings).filter((r) => r != null).length;
      setQuickEval({
        criteriaCount: criteria.length,
        ratedCount,
        overallScore: data.overall_score ? Number(data.overall_score) : null,
        recommendation: (data as any).recommendation || null,
      });
    };
    loadEval();
    // Refresh à chaque fois que ScorecardTab modifie la DB (debounced auto-save)
    const interval = setInterval(loadEval, 5_000);
    return () => clearInterval(interval);
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

  const jobDetails = useMemo(() => {
    if (!candidate?.jobId) return null;
    return notionJobs?.find(j => j.id === candidate.jobId) || null;
  }, [candidate?.jobId, notionJobs]);

  if (loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!candidate) return null;

  const profileData = candidate.linkedinProfileData as any;
  const avatarUrl = profileData?.profile_picture_url;
  const initials = candidate.name.split(' ').slice(0, 2).map(p => p.charAt(0).toUpperCase()).join('');

  // Quick eval derived
  const progressPct = quickEval && quickEval.criteriaCount > 0
    ? (quickEval.ratedCount / quickEval.criteriaCount) * 100
    : 0;

  const recoTone = (() => {
    const r = quickEval?.recommendation;
    if (r === 'strong_yes') return { bg: 'bg-success/15', text: 'text-success', border: 'border-success/30', label: 'Strong Yes' };
    if (r === 'yes') return { bg: 'bg-success/10', text: 'text-success', border: 'border-success/30', label: 'Yes' };
    if (r === 'maybe') return { bg: 'bg-warning/10', text: 'text-warning', border: 'border-warning/30', label: 'Maybe' };
    if (r === 'no') return { bg: 'bg-destructive/10', text: 'text-destructive', border: 'border-destructive/30', label: 'No' };
    if (r === 'strong_no') return { bg: 'bg-destructive/15', text: 'text-destructive', border: 'border-destructive/30', label: 'Strong No' };
    return null;
  })();

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col overflow-hidden">
      {/* ═══ Header riche ═══ */}
      <header className="sticky top-0 z-20 bg-background/95 backdrop-blur-md border-b border-border">
        <div className="flex items-center gap-3 px-4 sm:px-6 h-14 max-w-none">
          <button
            onClick={() => navigate(-1)}
            className="h-9 w-9 grid place-items-center rounded-full border border-border bg-background hover:bg-accent transition-colors shrink-0"
            aria-label="Retour"
          >
            <ArrowLeft className="w-4 h-4" />
          </button>

          {/* Avatar + name + headline compact */}
          <div className="flex items-center gap-2.5 min-w-0 flex-1">
            <Avatar className="w-8 h-8 ring-2 ring-border shadow-sm shrink-0">
              <AvatarImage src={avatarUrl} alt={candidate.name} />
              <AvatarFallback className="bg-gradient-to-br from-foreground/20 to-foreground/10 text-foreground font-bold text-xs">
                {initials}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <p className="text-3xs uppercase tracking-wider text-muted-foreground font-bold leading-none mb-0.5 hidden sm:block">
                Scorecard d'entretien
              </p>
              <h1 className="font-display text-[14px] sm:text-[15px] font-bold truncate leading-tight">
                {candidate.name}
                {candidate.jobTitle && (
                  <span className="text-muted-foreground font-medium hidden sm:inline">
                    {' · '}{candidate.jobTitle}
                  </span>
                )}
              </h1>
            </div>
          </div>

          {/* Progress + score + reco compact */}
          {quickEval && quickEval.criteriaCount > 0 && (
            <div className="hidden md:flex items-center gap-3 shrink-0">
              {/* Progress bar */}
              <div className="flex items-center gap-2">
                <span className="text-2xs tabular-nums font-display font-bold text-foreground">
                  {quickEval.ratedCount}/{quickEval.criteriaCount}
                </span>
                <div className="h-1.5 w-24 rounded-full bg-muted/40 overflow-hidden">
                  <div
                    className="h-full bg-emerald-500/70 transition-all duration-500"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
              </div>

              {/* Score running */}
              {quickEval.overallScore != null && (
                <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border border-border bg-card">
                  <Sparkles className="w-3 h-3 text-foreground/60" />
                  <span className="text-2xs font-bold tabular-nums">
                    {quickEval.overallScore.toFixed(1)}/5
                  </span>
                </div>
              )}

              {/* Recommendation */}
              {recoTone && (
                <span
                  className={cn(
                    'inline-flex items-center text-3xs uppercase tracking-wider font-bold px-2.5 py-1 rounded-full border',
                    recoTone.bg, recoTone.text, recoTone.border,
                  )}
                >
                  {recoTone.label}
                </span>
              )}
            </div>
          )}

          {/* Coaching live indicator */}
          {autoCoaching && (
            <div className="hidden lg:flex items-center gap-1.5 shrink-0 px-2.5 py-1 rounded-full bg-destructive/10 border border-destructive/30">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-destructive opacity-75" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-destructive" />
              </span>
              <span className="text-2xs text-destructive uppercase tracking-wider font-bold inline-flex items-center gap-1">
                <Mic className="w-3 h-3" />
                Coaching Live
              </span>
            </div>
          )}

          {/* Sidebar toggle (desktop) */}
          <button
            onClick={() => setSidebarCollapsed((p) => !p)}
            className="hidden sm:grid h-9 w-9 place-items-center rounded-full border border-border bg-background hover:bg-accent transition-colors shrink-0"
            title={sidebarCollapsed ? 'Afficher la sidebar candidat' : 'Réduire la sidebar pour focus'}
            aria-label={sidebarCollapsed ? 'Afficher sidebar' : 'Réduire sidebar'}
          >
            {sidebarCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {/* Mobile pane toggle */}
        <div className="sm:hidden flex items-center border-t border-border bg-muted/10">
          <button
            onClick={() => setMobilePane('sidebar')}
            className={cn(
              'flex-1 py-2 text-2xs font-medium text-center transition-colors',
              mobilePane === 'sidebar' ? 'text-foreground border-b-2 border-foreground' : 'text-muted-foreground',
            )}
          >
            Profil & Poste
          </button>
          <button
            onClick={() => setMobilePane('scorecard')}
            className={cn(
              'flex-1 py-2 text-2xs font-medium text-center transition-colors',
              mobilePane === 'scorecard' ? 'text-foreground border-b-2 border-foreground' : 'text-muted-foreground',
            )}
          >
            Scorecard
          </button>
        </div>

        {/* Mobile mini progress bar (visible sur petit écran) */}
        {quickEval && quickEval.criteriaCount > 0 && (
          <div className="md:hidden h-0.5 bg-muted/40 relative">
            <div
              className="absolute inset-y-0 left-0 bg-emerald-500/70 transition-all"
              style={{ width: `${progressPct}%` }}
            />
          </div>
        )}
      </header>

      {/* ═══ Body 2-col ═══ */}
      <div className="flex-1 flex overflow-hidden">
        {/* Sidebar gauche (collapsible sur desktop) */}
        <aside
          className={cn(
            'border-r border-border bg-muted/10 flex-col shrink-0 min-w-0 transition-all duration-300',
            'sm:flex',
            sidebarCollapsed ? 'sm:w-0 sm:border-r-0 sm:overflow-hidden' : 'sm:w-[320px] lg:w-[340px]',
            mobilePane === 'sidebar' ? 'flex flex-1 sm:flex-none w-full' : 'hidden sm:flex',
          )}
        >
          {/* Tabs candidat/poste */}
          <div className="border-b border-border p-2 flex items-center gap-1 shrink-0">
            <button
              onClick={() => setSidebarTab('candidate')}
              className={cn(
                'flex-1 inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-full text-2xs font-medium transition-colors',
                sidebarTab === 'candidate'
                  ? 'bg-foreground text-background shadow-sm'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              )}
            >
              <User className="w-3.5 h-3.5" />
              Candidat
            </button>
            <button
              onClick={() => setSidebarTab('job')}
              className={cn(
                'flex-1 inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-full text-2xs font-medium transition-colors',
                sidebarTab === 'job'
                  ? 'bg-foreground text-background shadow-sm'
                  : 'text-muted-foreground hover:bg-muted/50 hover:text-foreground',
              )}
            >
              <Briefcase className="w-3.5 h-3.5" />
              Poste
            </button>
          </div>

          <ScrollArea className="flex-1 w-full">
            {sidebarTab === 'candidate' ? (
              <div className="p-4 space-y-4 w-full min-w-0 max-w-full">
                {/* Identity */}
                <div className="flex items-start gap-3">
                  <Avatar className="w-12 h-12 ring-2 ring-border shadow-sm">
                    <AvatarImage src={avatarUrl} alt={candidate.name} />
                    <AvatarFallback className="bg-gradient-to-br from-foreground/20 to-foreground/10 text-foreground font-bold">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <h2 className="font-display font-bold text-[15px] tracking-tight leading-tight truncate">
                      {candidate.name}
                    </h2>
                    {enrichedProfile?.headline && (
                      <p className="text-2xs text-muted-foreground line-clamp-2 leading-snug mt-0.5">
                        {enrichedProfile.headline}
                      </p>
                    )}
                  </div>
                </div>

                {/* Progress + score */}
                {quickEval && quickEval.criteriaCount > 0 && (
                  <div className="rounded-xl border border-border bg-card p-3">
                    <div className="flex items-center justify-between mb-2">
                      <p className="text-3xs uppercase tracking-wider font-bold text-muted-foreground">
                        Progression
                      </p>
                      <span className="text-2xs font-bold tabular-nums">
                        {quickEval.ratedCount}/{quickEval.criteriaCount}
                      </span>
                    </div>
                    <div className="h-1.5 rounded-full bg-muted/40 overflow-hidden mb-2">
                      <div
                        className="h-full bg-emerald-500/70 transition-all duration-500"
                        style={{ width: `${progressPct}%` }}
                      />
                    </div>
                    {quickEval.overallScore != null && (
                      <div className="flex items-center justify-between text-2xs mt-2">
                        <span className="text-muted-foreground">Score moyen</span>
                        <span className="font-bold tabular-nums">{quickEval.overallScore.toFixed(2)}/5</span>
                      </div>
                    )}
                    {recoTone && (
                      <div className={cn('mt-2 px-2 py-1 rounded-full text-3xs uppercase tracking-wider font-bold border text-center', recoTone.bg, recoTone.text, recoTone.border)}>
                        {recoTone.label}
                      </div>
                    )}
                  </div>
                )}

                {/* Score IA initial */}
                {candidate.score != null && candidate.score > 0 && (
                  <div className={cn(
                    'rounded-xl border px-3 py-2.5 flex items-center gap-3',
                    candidate.score >= 70 ? 'border-success/30 bg-success/5' :
                    candidate.score >= 50 ? 'border-warning/30 bg-warning/5' :
                    'border-destructive/30 bg-destructive/5',
                  )}>
                    <div className={cn(
                      'h-10 w-10 rounded-lg grid place-items-center font-display font-bold tabular-nums shrink-0',
                      candidate.score >= 70 ? 'bg-success/15 text-success' :
                      candidate.score >= 50 ? 'bg-warning/15 text-warning' :
                      'bg-destructive/15 text-destructive',
                    )}>
                      {candidate.score}
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-3xs uppercase tracking-wider font-bold text-muted-foreground">
                        Score IA initial
                      </p>
                      <p className="text-2xs font-medium text-foreground truncate">
                        {candidate.recommendation === 'shortlist' ? 'Recommandé' :
                         candidate.recommendation === 'skip' ? 'Non recommandé' :
                         'À évaluer'}
                      </p>
                    </div>
                  </div>
                )}

                {/* Meta row */}
                <div className="flex flex-wrap gap-1.5">
                  {enrichedProfile?.currentCompany && (
                    <span className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full bg-foreground/[0.06] text-foreground/85 border border-border">
                      <Building2 className="w-3 h-3" />
                      {enrichedProfile.currentCompany}
                    </span>
                  )}
                  {enrichedProfile?.location && (
                    <span className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full bg-foreground/[0.06] text-foreground/85 border border-border">
                      <MapPin className="w-3 h-3" />
                      {enrichedProfile.location.split(',')[0]}
                    </span>
                  )}
                  {enrichedProfile?.yearsOfExperience && (
                    <span className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/30 font-medium">
                      <Sparkles className="w-3 h-3" />
                      {enrichedProfile.yearsOfExperience} ans
                    </span>
                  )}
                </div>

                {/* Quick actions */}
                {candidate.linkedin && (
                  <a
                    href={candidate.linkedin}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="w-full inline-flex items-center justify-center gap-2 h-8 px-3 rounded-full text-2xs font-medium border border-border bg-background hover:bg-accent transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Ouvrir LinkedIn
                  </a>
                )}

                {/* Expérience compact */}
                {(enrichedProfile?.experiences?.length || 0) > 0 && (
                  <SidebarSection
                    icon={Briefcase}
                    title="Expérience"
                    eyebrow={`${enrichedProfile!.experiences.length} positions`}
                  >
                    <div className="space-y-2.5">
                      {enrichedProfile!.experiences.slice(0, 4).map((exp, i) => (
                        <CompactExperienceItem
                          key={i}
                          exp={exp}
                          logoErrors={logoErrors}
                          setLogoErrors={setLogoErrors}
                        />
                      ))}
                      {enrichedProfile!.experiences.length > 4 && (
                        <p className="text-2xs text-muted-foreground/70 italic pl-9">
                          +{enrichedProfile!.experiences.length - 4} autres
                        </p>
                      )}
                    </div>
                  </SidebarSection>
                )}

                {/* Formation */}
                {(enrichedProfile?.education?.length || 0) > 0 && (
                  <SidebarSection
                    icon={GraduationCap}
                    title="Formation"
                    eyebrow={`${enrichedProfile!.education.length} école${enrichedProfile!.education.length > 1 ? 's' : ''}`}
                  >
                    <div className="space-y-2">
                      {enrichedProfile!.education.slice(0, 3).map((edu, i) => (
                        <div key={i} className="flex items-start gap-2.5">
                          <div className="h-7 w-7 rounded-md bg-emerald-500/15 grid place-items-center shrink-0">
                            {edu.logo ? (
                              <img src={edu.logo} alt="" className="w-5 h-5 object-contain rounded" />
                            ) : (
                              <GraduationCap className="w-3.5 h-3.5 text-foreground" />
                            )}
                          </div>
                          <div className="flex-1 min-w-0">
                            <p className="text-2xs font-semibold truncate">{edu.school}</p>
                            {(edu.degree || edu.field) && (
                              <p className="text-2xs text-muted-foreground truncate">
                                {[edu.degree, edu.field].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </div>
                        </div>
                      ))}
                    </div>
                  </SidebarSection>
                )}

                {/* Skills */}
                {(enrichedProfile?.skills?.length || 0) > 0 && (
                  <SidebarSection
                    icon={Sparkles}
                    title="Compétences"
                    eyebrow={`${enrichedProfile!.skills.length} skills`}
                  >
                    <div className="flex flex-wrap gap-1 min-w-0">
                      {enrichedProfile!.skills.slice(0, 14).map((skill, i) => (
                        <span
                          key={i}
                          className="inline-flex items-center text-2xs px-1.5 py-0.5 rounded-full bg-foreground/[0.06] text-foreground/85 border border-border max-w-full break-words"
                        >
                          {skill}
                        </span>
                      ))}
                      {enrichedProfile!.skills.length > 14 && (
                        <span className="inline-flex items-center text-2xs px-1.5 py-0.5 rounded-full text-muted-foreground border border-border bg-muted/30">
                          +{enrichedProfile!.skills.length - 14}
                        </span>
                      )}
                    </div>
                  </SidebarSection>
                )}
              </div>
            ) : (
              // ═══ Job sidebar ═══
              <div className="p-4 space-y-4 w-full min-w-0 max-w-full">
                <div>
                  <p className="text-3xs uppercase tracking-wider text-muted-foreground font-semibold mb-1">
                    Mission
                  </p>
                  <h2 className="font-display font-bold text-[15px] tracking-tight leading-tight">
                    {candidate.jobTitle || jobDetails?.title || 'Poste non spécifié'}
                  </h2>
                  {jobDetails?.client?.name && (
                    <p className="text-2xs text-muted-foreground mt-0.5">
                      {jobDetails.client.name}
                      {jobDetails.location && ` · ${jobDetails.location}`}
                    </p>
                  )}
                </div>

                {jobDetails && (
                  <div className="flex flex-wrap gap-1.5">
                    {jobDetails.seniority && (
                      <span className="inline-flex items-center text-2xs px-2 py-0.5 rounded-full bg-info/10 text-info border border-info/30 font-medium">
                        {jobDetails.seniority}
                      </span>
                    )}
                    {jobDetails.contractType && (
                      <span className="inline-flex items-center text-2xs px-2 py-0.5 rounded-full bg-foreground/[0.06] text-foreground/85 border border-border">
                        {jobDetails.contractType}
                      </span>
                    )}
                    {jobDetails.remote && (
                      <span className="inline-flex items-center text-2xs px-2 py-0.5 rounded-full bg-success/10 text-success border border-success/30 font-medium">
                        Remote
                      </span>
                    )}
                  </div>
                )}

                {candidate.jobId && (
                  <button
                    onClick={() => setJobOpen(true)}
                    className="w-full inline-flex items-center justify-center gap-2 h-8 px-3 rounded-full text-2xs font-medium border border-border bg-background hover:bg-accent transition-colors"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                    Voir tous les détails
                  </button>
                )}

                {(jobDetails as any)?.mustHave && Array.isArray((jobDetails as any).mustHave) && (jobDetails as any).mustHave.length > 0 && (
                  <SidebarSection
                    icon={Target}
                    title="Compétences obligatoires"
                    eyebrow={`${(jobDetails as any).mustHave.length} skills`}
                  >
                    <div className="flex flex-wrap gap-1">
                      {(jobDetails as any).mustHave.map((s: string, i: number) => (
                        <span key={i} className="inline-flex items-center text-2xs px-1.5 py-0.5 rounded-full bg-success/10 text-success border border-success/30">
                          <CheckCircle2 className="w-2.5 h-2.5 mr-0.5" />
                          {s}
                        </span>
                      ))}
                    </div>
                  </SidebarSection>
                )}

                {jobDetails?.description && (
                  <SidebarSection icon={Briefcase} title="Description du poste">
                    <p className="text-2xs text-foreground/85 leading-relaxed line-clamp-8 whitespace-pre-line">
                      {jobDetails.description}
                    </p>
                  </SidebarSection>
                )}
              </div>
            )}
          </ScrollArea>
        </aside>

        {/* Main area : ScorecardTab — pleine largeur */}
        <main
          className={cn(
            'flex-1 min-w-0 overflow-hidden',
            'sm:block',
            mobilePane === 'scorecard' ? 'block' : 'hidden sm:block',
          )}
        >
          <ScrollArea className="h-full w-full">
            <div className="px-4 sm:px-6 lg:px-8 py-4 sm:py-6 min-w-0 w-full max-w-[1400px] mx-auto">
              <ScorecardTab
                candidate={candidate}
                enrichedProfile={enrichedProfile}
                onOpenProfile={() => setMobilePane('sidebar')}
                autoStartCoaching={autoCoaching}
                autoOpenFirst
              />
            </div>
          </ScrollArea>
        </main>
      </div>

      <JobDetailSheet
        jobId={candidate.jobId}
        open={jobOpen}
        onOpenChange={setJobOpen}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Sub-components
// ═══════════════════════════════════════════════════════════════════

function SidebarSection({
  icon: Icon, title, eyebrow, children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  eyebrow?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-xl border border-border bg-card p-3 w-full min-w-0 max-w-full overflow-hidden">
      <div className="flex items-center gap-2 mb-2 min-w-0">
        <div className="h-6 w-6 rounded-md bg-emerald-500/15 grid place-items-center shrink-0">
          <Icon className="w-3 h-3 text-foreground" />
        </div>
        <div className="flex-1 min-w-0">
          <h3 className="font-display font-bold text-[12px] tracking-tight text-foreground truncate">
            {title}
          </h3>
          {eyebrow && (
            <p className="text-3xs uppercase tracking-wider font-semibold text-muted-foreground/70 truncate">
              {eyebrow}
            </p>
          )}
        </div>
      </div>
      <div className="min-w-0 max-w-full">
        {children}
      </div>
    </div>
  );
}

function CompactExperienceItem({
  exp, logoErrors, setLogoErrors,
}: {
  exp: { title: string; company: string; logo?: string; startDate?: string; endDate?: string; isCurrent?: boolean };
  logoErrors: Set<string>;
  setLogoErrors: React.Dispatch<React.SetStateAction<Set<string>>>;
}) {
  const companySlug = (exp.company || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  const logoKey = `exp-${companySlug}`;
  const clearbitUrl = companySlug ? `https://logo.clearbit.com/${companySlug}.com` : null;
  const hasLogoError = logoErrors.has(logoKey);
  const logoSrc = exp.logo || (!hasLogoError && clearbitUrl ? clearbitUrl : null);

  return (
    <div className="flex items-start gap-2.5">
      <div className="h-7 w-7 rounded-md bg-emerald-500/15 grid place-items-center shrink-0 overflow-hidden">
        {logoSrc ? (
          <img
            src={logoSrc}
            alt=""
            className="w-5 h-5 object-contain rounded-sm"
            onError={() => setLogoErrors(prev => new Set(prev).add(logoKey))}
          />
        ) : (
          <Building2 className="w-3.5 h-3.5 text-foreground" />
        )}
      </div>
      <div className="flex-1 min-w-0">
        <p className="text-2xs font-semibold leading-tight truncate">
          {exp.title}
          {exp.isCurrent && (
            <span className="inline-flex items-center gap-0.5 text-3xs font-bold uppercase tracking-wider px-1 py-0 rounded-full bg-success/10 text-success border border-success/30 ml-1.5 align-middle">
              <span className="h-1 w-1 rounded-full bg-success animate-pulse" />
              Actuel
            </span>
          )}
        </p>
        <p className="text-2xs text-muted-foreground truncate">{exp.company}</p>
        {(exp.startDate || exp.endDate) && (
          <p className="text-3xs text-muted-foreground/70 tabular-nums mt-0.5">
            {exp.startDate} {exp.endDate ? `→ ${exp.endDate}` : '→ Présent'}
          </p>
        )}
      </div>
    </div>
  );
}

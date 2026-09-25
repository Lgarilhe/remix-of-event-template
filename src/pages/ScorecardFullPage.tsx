/**
 * ScorecardFullPage : la grille d'entretien en plein écran, avec le profil du
 * candidat et le poste dans un panneau latéral repliable.
 *
 * L'en-tête suit la grille ouverte (critères notés, moyenne, recommandation)
 * par les événements de ScorecardTab, sans interroger la base toutes les 5 s
 * (revue design E-32). L'indicateur d'enregistrement n'apparaît que pendant un
 * enregistrement réel de l'assistant d'entretien (E-33).
 */

import { useCallback, useEffect, useId, useMemo, useState } from 'react';
import { Link, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';
import {
  ArrowLeft, Briefcase, Building2, ExternalLink, GraduationCap, ListChecks, MapPin, Mic, PanelLeftClose,
  PanelLeftOpen, Target, UserX, type LucideIcon,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { ScorecardTab, type ScorecardSummary } from '@/components/ats/ScorecardTab';
import { JobDetailSheet } from '@/components/ats/JobDetailSheet';
import { CandidateAvatar } from '@/components/dashboard/CandidateAvatar';
import { EmptyState } from '@/components/layout/EmptyState';
import { ErrorState } from '@/components/layout/ErrorState';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ScoreBadge } from '@/components/ui/score-badge';
import { SegmentedControl } from '@/components/ui/segmented-control';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { ATSCandidate } from '@/hooks/useATSData';
import { useNotionJobs } from '@/hooks/useNotionJobs';
import { EnrichedProfile } from '@/hooks/useProfileEnrichment';
import { aiRecommendationMeta, hiringVerdictMeta } from '@/lib/verdicts';
import { cn } from '@/lib/utils';

type SidebarTab = 'candidate' | 'job';
type MobilePane = 'sidebar' | 'scorecard';
type LoadState = 'loading' | 'error' | 'not_found' | 'ready';

const formatAverage = (value: number) =>
  value.toLocaleString('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** « 2021-03 » devient « mars 2021 » ; une année seule reste telle quelle. */
function formatMonth(value?: string): string {
  if (!value) return '';
  const match = /^(\d{4})(?:-(\d{1,2}))?/.exec(value);
  if (!match) return value;
  if (!match[2]) return match[1];
  const month = Number(match[2]);
  if (month < 1 || month > 12) return match[1];
  return format(new Date(Number(match[1]), month - 1, 1), 'MMMM yyyy', { locale: fr });
}

function PageSkeleton() {
  return (
    <div className="flex h-dvh flex-col bg-background" aria-busy="true">
      <span className="sr-only" role="status">Chargement de la grille d'entretien</span>
      <div className="flex h-14 items-center gap-3 border-b border-border px-4 sm:px-6">
        <Skeleton className="h-8 w-8 rounded-full" />
        <div className="space-y-1.5">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-4 w-44" />
        </div>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="hidden w-80 space-y-4 border-r border-border p-4 sm:block">
          <Skeleton className="h-14 rounded-xl" />
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-40 rounded-xl" />
        </div>
        <div className="flex-1 space-y-4 p-4 sm:p-6">
          <Skeleton className="h-24 rounded-xl" />
          <Skeleton className="h-96 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

export default function ScorecardFullPage() {
  const { candidateId } = useParams<{ candidateId: string }>();
  const [searchParams] = useSearchParams();
  const autoCoaching = searchParams.get('coaching') === '1';
  const navigate = useNavigate();
  const location = useLocation();
  const sidebarId = useId();
  const [candidate, setCandidate] = useState<ATSCandidate | null>(null);
  const [loadState, setLoadState] = useState<LoadState>('loading');
  const [reloadTick, setReloadTick] = useState(0);
  const [jobOpen, setJobOpen] = useState(false);
  const [logoErrors, setLogoErrors] = useState<Set<string>>(new Set());
  const [sidebarTab, setSidebarTab] = useState<SidebarTab>('candidate');
  const [mobilePane, setMobilePane] = useState<MobilePane>('scorecard');
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  // Grille ouverte, remontée par ScorecardTab à chaque modification.
  const [quickEval, setQuickEval] = useState<ScorecardSummary | null>(null);
  const [recording, setRecording] = useState(false);

  const { data: notionJobs } = useNotionJobs();

  useEffect(() => {
    if (!candidateId) {
      setLoadState('not_found');
      return;
    }
    let cancelled = false;
    const load = async () => {
      setLoadState('loading');
      const { data, error } = await supabase
        .from('job_candidate_status')
        .select('*')
        .eq('candidate_id', candidateId)
        .order('updated_at', { ascending: false })
        .limit(1)
        .maybeSingle();

      if (cancelled) return;
      if (error) {
        console.error('[ScorecardFullPage] lecture impossible :', error);
        setLoadState('error');
        return;
      }
      if (!data) {
        setLoadState('not_found');
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
        scoringDetails: data.scoring_details as unknown as ATSCandidate['scoringDetails'],
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

      if (cancelled) return;
      setCandidate(c);
      setLoadState('ready');
    };
    load().catch((err) => {
      if (cancelled) return;
      console.error('[ScorecardFullPage] lecture impossible :', err);
      setLoadState('error');
    });
    return () => {
      cancelled = true;
    };
  }, [candidateId, reloadTick]);

  const enrichedProfile = useMemo<EnrichedProfile | null>(() => {
    if (!candidate?.linkedinProfileData) return null;
    // Données brutes du profil LinkedIn, de forme variable selon la source.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const p = candidate.linkedinProfileData as any;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    type Raw = any;
    const workExperience: Raw[] = p.work_experience || p.experiences || p.positions || [];
    const currentJob = workExperience.find((exp) => !exp.end) || workExperience[0];

    let yearsOfExperience: number | undefined = p.years_of_experience;
    if (!yearsOfExperience) {
      const allStartYears = workExperience
        .map((exp) => exp.start?.year)
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
      skills: p.skills?.map((s: Raw) => (typeof s === 'string' ? s : s.name)).filter(Boolean) || [],
      experiences: workExperience.map((exp) => ({
        title: exp.role || exp.title || '',
        company: exp.company || exp.company_name || '',
        logo: exp.company_logo || exp.logo_url || exp.logo || undefined,
        description: exp.description || '',
        startDate: exp.start ? `${exp.start.year || ''}${exp.start.month ? `-${String(exp.start.month).padStart(2, '0')}` : ''}` : (exp.start_date || ''),
        endDate: exp.end ? `${exp.end.year || ''}${exp.end.month ? `-${String(exp.end.month).padStart(2, '0')}` : ''}` : (exp.end_date || ''),
        isCurrent: !exp.end && !exp.end_date,
      })),
      education: (p.education || []).map((edu: Raw) => {
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
    return notionJobs?.find((j) => j.id === candidate.jobId) || null;
  }, [candidate?.jobId, notionJobs]);

  const goBack = useCallback(() => {
    // Ouverte dans un nouvel onglet ou par un lien direct : pas de page précédente dans l'application.
    if (location.key !== 'default') navigate(-1);
    else navigate('/pipeline');
  }, [location.key, navigate]);

  // Bouton « Voir le profil » de l'assistant d'entretien : le panneau du candidat s'affiche.
  const showProfile = useCallback(() => {
    setSidebarTab('candidate');
    setSidebarCollapsed(false);
    setMobilePane('sidebar');
  }, []);

  const backButton = (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Retour" onClick={goBack} className="shrink-0 max-md:h-11 max-md:w-11">
          <ArrowLeft aria-hidden="true" />
        </Button>
      </TooltipTrigger>
      <TooltipContent>Retour</TooltipContent>
    </Tooltip>
  );

  if (loadState === 'loading') return <PageSkeleton />;

  if (loadState === 'error' || loadState === 'not_found' || !candidate) {
    return (
      <div className="flex min-h-dvh flex-col bg-background text-foreground">
        <div className="flex h-14 items-center border-b border-border px-4 sm:px-6">{backButton}</div>
        <div className="mx-auto w-full max-w-md px-4 py-10">
          {loadState === 'error' ? (
            <ErrorState
              title="Impossible de charger le candidat"
              description="Vérifiez votre connexion, puis réessayez."
              onRetry={() => setReloadTick((t) => t + 1)}
            />
          ) : (
            <EmptyState
              icon={UserX}
              title="Candidat introuvable"
              description="Ce candidat n'existe plus, ou votre compte n'y a pas accès."
              action={
                <Button asChild variant="outline" className="max-md:min-h-11">
                  <Link to="/pipeline">Ouvrir le pipeline</Link>
                </Button>
              }
            />
          )}
        </div>
      </div>
    );
  }

  const profileData = candidate.linkedinProfileData as unknown as { profile_picture_url?: string } | null;
  const avatarUrl = profileData?.profile_picture_url;
  const progressPct = quickEval && quickEval.criteriaCount > 0
    ? (quickEval.ratedCount / quickEval.criteriaCount) * 100
    : 0;
  const verdict = hiringVerdictMeta(quickEval?.recommendation);
  const aiReco = aiRecommendationMeta(candidate.recommendation);
  const years = enrichedProfile?.yearsOfExperience;
  const mustHave = (jobDetails as unknown as { mustHave?: unknown } | null)?.mustHave;
  const mustHaveList = Array.isArray(mustHave) ? (mustHave as string[]) : [];

  const progressBar = (className: string) => (
    <div
      role="progressbar"
      aria-label="Critères notés"
      aria-valuemin={0}
      aria-valuemax={quickEval?.criteriaCount ?? 0}
      aria-valuenow={quickEval?.ratedCount ?? 0}
      className={cn('overflow-hidden rounded-full bg-muted', className)}
    >
      <div className="h-full rounded-full bg-brand transition-[width] duration-200" style={{ width: `${progressPct}%` }} />
    </div>
  );

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background text-foreground">
      {/* En-tête */}
      <header className="shrink-0 border-b border-border bg-background">
        <div className="flex h-14 items-center gap-3 px-4 sm:px-6">
          {backButton}

          <div className="flex min-w-0 flex-1 items-center gap-2.5">
            <CandidateAvatar name={candidate.name} avatarUrl={avatarUrl} size={32} />
            <div className="min-w-0 flex-1">
              <p className="eyebrow hidden leading-none sm:block">Grille d'entretien</p>
              <h1 className="truncate text-sm font-semibold sm:text-md">
                {candidate.name}
                {candidate.jobTitle && (
                  <span className="hidden font-medium text-muted-foreground sm:inline"> · {candidate.jobTitle}</span>
                )}
              </h1>
            </div>
          </div>

          {quickEval && quickEval.criteriaCount > 0 && (
            <div className="hidden shrink-0 items-center gap-3 md:flex">
              <div className="flex items-center gap-2">
                <span className="text-xs font-semibold tabular-nums text-foreground">
                  {quickEval.ratedCount}/{quickEval.criteriaCount}
                </span>
                {progressBar('h-1.5 w-24')}
              </div>
              {quickEval.overallScore != null && (
                <span className="text-xs font-semibold tabular-nums text-foreground">
                  <span className="sr-only">Moyenne </span>
                  {formatAverage(quickEval.overallScore)}
                  <span className="font-medium text-muted-foreground">/5</span>
                </span>
              )}
              {verdict && <Badge variant={verdict.tone}>{verdict.label}</Badge>}
            </div>
          )}

          {recording && (
            <Badge variant="danger" className="shrink-0 gap-1.5">
              <span className="h-1.5 w-1.5 rounded-full bg-danger" aria-hidden="true" />
              <Mic className="h-3 w-3 sm:hidden" aria-hidden="true" />
              <span className="max-sm:sr-only">Enregistrement en cours</span>
            </Badge>
          )}

          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                variant="ghost"
                size="icon"
                aria-label={sidebarCollapsed ? 'Afficher le panneau du candidat' : 'Masquer le panneau du candidat'}
                aria-expanded={!sidebarCollapsed}
                aria-controls={sidebarId}
                onClick={() => setSidebarCollapsed((p) => !p)}
                className="hidden shrink-0 sm:inline-flex"
              >
                {sidebarCollapsed ? <PanelLeftOpen aria-hidden="true" /> : <PanelLeftClose aria-hidden="true" />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>
              {sidebarCollapsed ? 'Afficher le panneau du candidat' : 'Masquer le panneau du candidat'}
            </TooltipContent>
          </Tooltip>
        </div>

        {/* Téléphone : profil ou grille */}
        <div className="border-t border-border px-4 py-2 sm:hidden">
          <SegmentedControl<MobilePane>
            aria-label="Affichage"
            value={mobilePane}
            onValueChange={setMobilePane}
            options={[
              { value: 'scorecard', label: 'Grille' },
              { value: 'sidebar', label: 'Profil et poste' },
            ]}
            className="h-11"
          />
        </div>

        {quickEval && quickEval.criteriaCount > 0 && progressBar('h-0.5 md:hidden')}
      </header>

      <div className="flex min-h-0 flex-1">
        {/* Panneau latéral : candidat ou poste */}
        <aside
          id={sidebarId}
          aria-label="Candidat et poste"
          className={cn(
            'min-h-0 shrink-0 flex-col overflow-y-auto border-r border-border',
            mobilePane === 'sidebar' ? 'flex w-full' : 'hidden',
            sidebarCollapsed ? 'sm:hidden' : 'sm:flex sm:w-80',
          )}
        >
          <div className="border-b border-border p-2">
            <SegmentedControl<SidebarTab>
              aria-label="Contenu du panneau"
              value={sidebarTab}
              onValueChange={setSidebarTab}
              options={[
                { value: 'candidate', label: 'Candidat' },
                { value: 'job', label: 'Poste' },
              ]}
              className="max-md:h-11"
            />
          </div>

          {sidebarTab === 'candidate' ? (
            <div className="min-w-0 space-y-4 p-4">
              <div className="flex items-start gap-3">
                <CandidateAvatar name={candidate.name} avatarUrl={avatarUrl} size={48} />
                <div className="min-w-0 flex-1">
                  <h2 className="truncate text-md font-semibold text-foreground">{candidate.name}</h2>
                  {enrichedProfile?.headline && (
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{enrichedProfile.headline}</p>
                  )}
                </div>
              </div>

              {quickEval && quickEval.criteriaCount > 0 && (
                <div className="space-y-2 rounded-xl border border-border bg-card p-3">
                  <div className="flex items-center justify-between gap-2">
                    <p className="eyebrow">Progression</p>
                    <span className="text-xs font-semibold tabular-nums">
                      {quickEval.ratedCount} sur {quickEval.criteriaCount}
                    </span>
                  </div>
                  {progressBar('h-1.5')}
                  {quickEval.overallScore != null && (
                    <div className="flex items-center justify-between text-xs">
                      <span className="text-muted-foreground">Moyenne</span>
                      <span className="font-semibold tabular-nums">{formatAverage(quickEval.overallScore)}/5</span>
                    </div>
                  )}
                  {verdict && (
                    <div className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-muted-foreground">Recommandation</span>
                      <Badge variant={verdict.tone}>{verdict.label}</Badge>
                    </div>
                  )}
                </div>
              )}

              {candidate.score != null && candidate.score > 0 && (
                <div className="space-y-2 rounded-xl border border-border bg-card p-3">
                  <p className="eyebrow">Score de l'IA</p>
                  <ScoreBadge score={candidate.score} showLevel />
                  <p className="flex flex-wrap items-center gap-1.5 text-xs text-foreground-secondary">
                    {`Recommandation de l'IA\u00a0:`}
                    {aiReco ? <Badge variant={aiReco.tone}>{aiReco.label}</Badge> : <span>aucune</span>}
                  </p>
                </div>
              )}

              {(enrichedProfile?.currentCompany || enrichedProfile?.location || years) && (
                <div className="flex flex-wrap gap-1.5">
                  {enrichedProfile?.currentCompany && (
                    <Badge variant="outline" className="font-normal">
                      <Building2 className="h-3 w-3" aria-hidden="true" />
                      {enrichedProfile.currentCompany}
                    </Badge>
                  )}
                  {enrichedProfile?.location && (
                    <Badge variant="outline" className="font-normal">
                      <MapPin className="h-3 w-3" aria-hidden="true" />
                      {enrichedProfile.location.split(',')[0]}
                    </Badge>
                  )}
                  {years ? (
                    <Badge variant="outline" className="font-normal">
                      <Briefcase className="h-3 w-3" aria-hidden="true" />
                      {years > 1 ? `${years} ans d'expérience` : `${years} an d'expérience`}
                    </Badge>
                  ) : null}
                </div>
              )}

              {candidate.linkedin && (
                <Button asChild variant="outline" size="sm" className="w-full max-md:min-h-11">
                  <a href={candidate.linkedin} target="_blank" rel="noopener noreferrer">
                    <ExternalLink aria-hidden="true" />
                    Ouvrir le profil LinkedIn
                    <span className="sr-only"> (nouvel onglet)</span>
                  </a>
                </Button>
              )}

              {(enrichedProfile?.experiences?.length || 0) > 0 && (
                <SidebarSection
                  icon={Briefcase}
                  title="Expérience"
                  meta={`${enrichedProfile!.experiences.length} poste${enrichedProfile!.experiences.length > 1 ? 's' : ''}`}
                >
                  <ul className="space-y-2.5">
                    {enrichedProfile!.experiences.slice(0, 4).map((exp, i) => (
                      <CompactExperienceItem key={i} exp={exp} logoErrors={logoErrors} setLogoErrors={setLogoErrors} />
                    ))}
                  </ul>
                  {enrichedProfile!.experiences.length > 4 && (
                    <p className="mt-2 pl-9 text-2xs text-muted-foreground">
                      et {enrichedProfile!.experiences.length - 4} autre{enrichedProfile!.experiences.length - 4 > 1 ? 's' : ''}
                    </p>
                  )}
                </SidebarSection>
              )}

              {(enrichedProfile?.education?.length || 0) > 0 && (
                <SidebarSection
                  icon={GraduationCap}
                  title="Formation"
                  meta={`${enrichedProfile!.education.length} école${enrichedProfile!.education.length > 1 ? 's' : ''}`}
                >
                  <ul className="space-y-2">
                    {enrichedProfile!.education.slice(0, 3).map((edu, i) => (
                      <li key={i} className="flex items-start gap-2.5">
                        <div className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-md bg-muted">
                          {edu.logo ? (
                            <img src={edu.logo} alt="" className="h-5 w-5 rounded-sm object-contain" />
                          ) : (
                            <GraduationCap className="h-3.5 w-3.5 text-foreground-secondary" aria-hidden="true" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-xs font-semibold">{edu.school}</p>
                          {(edu.degree || edu.field) && (
                            <p className="truncate text-2xs text-muted-foreground">
                              {[edu.degree, edu.field].filter(Boolean).join(' · ')}
                            </p>
                          )}
                        </div>
                      </li>
                    ))}
                  </ul>
                </SidebarSection>
              )}

              {(enrichedProfile?.skills?.length || 0) > 0 && (
                <SidebarSection
                  icon={ListChecks}
                  title="Compétences"
                  meta={`${enrichedProfile!.skills.length} compétence${enrichedProfile!.skills.length > 1 ? 's' : ''}`}
                >
                  <div className="flex min-w-0 flex-wrap gap-1">
                    {enrichedProfile!.skills.slice(0, 14).map((skill, i) => (
                      <Badge key={i} variant="outline" className="max-w-full break-words font-normal">
                        {skill}
                      </Badge>
                    ))}
                    {enrichedProfile!.skills.length > 14 && (
                      <Badge variant="muted" className="font-normal">
                        et {enrichedProfile!.skills.length - 14} autres
                      </Badge>
                    )}
                  </div>
                </SidebarSection>
              )}
            </div>
          ) : (
            <div className="min-w-0 space-y-4 p-4">
              <div>
                <p className="eyebrow">Mission</p>
                <h2 className="mt-1 text-md font-semibold text-foreground">
                  {candidate.jobTitle || jobDetails?.title || 'Poste non précisé'}
                </h2>
                {jobDetails?.client?.name && (
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {jobDetails.client.name}
                    {jobDetails.location && ` · ${jobDetails.location}`}
                  </p>
                )}
              </div>

              {jobDetails && (jobDetails.seniority || jobDetails.contractType || jobDetails.remote) && (
                <div className="flex flex-wrap gap-1.5">
                  {jobDetails.seniority && <Badge variant="outline" className="font-normal">{jobDetails.seniority}</Badge>}
                  {jobDetails.contractType && <Badge variant="outline" className="font-normal">{jobDetails.contractType}</Badge>}
                  {jobDetails.remote && (
                    <Badge variant="outline" className="font-normal">{`Télétravail\u00a0: ${jobDetails.remote}`}</Badge>
                  )}
                </div>
              )}

              {candidate.jobId ? (
                <Button variant="outline" size="sm" onClick={() => setJobOpen(true)} className="w-full max-md:min-h-11">
                  <ExternalLink aria-hidden="true" />
                  Voir la fiche du poste
                </Button>
              ) : (
                <p className="text-sm text-muted-foreground">Aucun poste n'est rattaché à ce candidat.</p>
              )}

              {mustHaveList.length > 0 && (
                <SidebarSection
                  icon={Target}
                  title="Compétences indispensables"
                  meta={`${mustHaveList.length} compétence${mustHaveList.length > 1 ? 's' : ''}`}
                >
                  <div className="flex flex-wrap gap-1">
                    {mustHaveList.map((s, i) => (
                      <Badge key={i} variant="outline" className="font-normal">{s}</Badge>
                    ))}
                  </div>
                </SidebarSection>
              )}

              {jobDetails?.description && (
                <SidebarSection icon={Briefcase} title="Description du poste">
                  <p className="line-clamp-6 whitespace-pre-line text-xs leading-relaxed text-foreground-secondary">
                    {jobDetails.description}
                  </p>
                </SidebarSection>
              )}
            </div>
          )}
        </aside>

        {/* Grille */}
        <main
          className={cn(
            'min-h-0 min-w-0 flex-1 overflow-y-auto',
            mobilePane === 'scorecard' ? 'block' : 'hidden sm:block',
          )}
        >
          <div className="mx-auto w-full min-w-0 max-w-screen-xl px-4 py-4 sm:px-6 sm:py-6 lg:px-8">
            <ScorecardTab
              candidate={candidate}
              enrichedProfile={enrichedProfile}
              onOpenProfile={showProfile}
              autoStartCoaching={autoCoaching}
              autoOpenFirst
              onActiveEvaluationChange={setQuickEval}
              onRecordingChange={setRecording}
            />
          </div>
        </main>
      </div>

      <JobDetailSheet jobId={candidate.jobId} open={jobOpen} onOpenChange={setJobOpen} />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════
// Sous-composants
// ═══════════════════════════════════════════════════════════════════

function SidebarSection({
  icon: Icon, title, meta, children,
}: {
  icon: LucideIcon;
  title: string;
  meta?: string;
  children: React.ReactNode;
}) {
  const headingId = useId();
  return (
    <section aria-labelledby={headingId} className="w-full min-w-0 overflow-hidden rounded-xl border border-border bg-card p-3">
      <div className="mb-2 flex min-w-0 items-center gap-2">
        <div className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-muted">
          <Icon className="h-3.5 w-3.5 text-foreground-secondary" aria-hidden="true" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 id={headingId} className="truncate text-xs font-semibold text-foreground">{title}</h3>
          {meta && <p className="truncate text-2xs text-muted-foreground">{meta}</p>}
        </div>
      </div>
      <div className="min-w-0">{children}</div>
    </section>
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
  const start = formatMonth(exp.startDate);
  const end = formatMonth(exp.endDate);
  const period = start ? `${start} – ${end || "aujourd'hui"}` : end;

  return (
    <li className="flex items-start gap-2.5">
      <div className="grid h-7 w-7 shrink-0 place-items-center overflow-hidden rounded-md bg-muted">
        {logoSrc ? (
          <img
            src={logoSrc}
            alt=""
            className="h-5 w-5 rounded-sm object-contain"
            onError={() => setLogoErrors((prev) => new Set(prev).add(logoKey))}
          />
        ) : (
          <Building2 className="h-3.5 w-3.5 text-foreground-secondary" aria-hidden="true" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <p className="flex min-w-0 items-center gap-1.5 text-xs font-semibold leading-tight">
          <span className="truncate">{exp.title || exp.company}</span>
          {exp.isCurrent && <Badge variant="muted" className="shrink-0 px-1.5 py-0 text-3xs">Actuel</Badge>}
        </p>
        {exp.title && <p className="truncate text-2xs text-muted-foreground">{exp.company}</p>}
        {period && <p className="mt-0.5 text-2xs tabular-nums text-muted-foreground">{period}</p>}
      </div>
    </li>
  );
}

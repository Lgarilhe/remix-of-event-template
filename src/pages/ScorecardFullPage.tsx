import { useEffect, useState, useMemo, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { ScorecardTab } from '@/components/ats/ScorecardTab';
import { ATSCandidate } from '@/hooks/useATSData';
import { EnrichedProfile } from '@/hooks/useProfileEnrichment';
import { ArrowLeft, Maximize2, User, ChevronUp, ChevronDown, ExternalLink, MapPin, Building2, Briefcase, GraduationCap, Wrench, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

export default function ScorecardFullPage() {
  const { candidateId } = useParams<{ candidateId: string }>();
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<ATSCandidate | null>(null);
  const [loading, setLoading] = useState(true);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileSection, setProfileSection] = useState<'exp' | 'edu' | 'skills'>('exp');
  const [expandedExp, setExpandedExp] = useState<Set<number>>(new Set());
  const [logoErrors, setLogoErrors] = useState<Set<string>>(new Set());

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
    return {
      name: p.name || p.full_name || candidate.name,
      headline: p.headline || p.occupation,
      summary: p.summary || p.about,
      currentRole: p.current_role || p.headline,
      currentCompany: p.current_company,
      location: p.location || p.city,
      skills: p.skills || [],
      experiences: (p.experiences || p.positions || []).map((e: any) => ({
        title: e.title || '',
        company: e.company || e.company_name || '',
        description: e.description || '',
        startDate: e.start_date || e.starts_at,
        endDate: e.end_date || e.ends_at,
        isCurrent: e.is_current || !e.end_date,
      })),
      education: (p.education || []).map((e: any) => ({
        school: e.school || e.school_name || '',
        degree: e.degree || e.degree_name || '',
        field: e.field || e.field_of_study || '',
      })),
      yearsOfExperience: p.years_of_experience,
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
              <p className="text-[10px] text-muted-foreground truncate">
                {candidate.jobTitle || 'Poste non spécifié'}
                {candidate.headline && ` · ${candidate.headline}`}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-1 shrink-0">
            <Maximize2 className="w-3.5 h-3.5 text-muted-foreground" />
            <span className="text-[9px] text-muted-foreground uppercase tracking-wider font-medium hidden sm:inline">Plein écran</span>
          </div>
        </div>
      </div>

      {/* Scorecard content */}
      <div className="max-w-3xl mx-auto px-4 py-6">
        <ScorecardTab
          candidate={candidate}
          enrichedProfile={enrichedProfile}
          onOpenProfile={() => setProfileOpen(true)}
        />
      </div>

      {/* Floating profile preview button */}
      <button
        onClick={() => setProfileOpen(!profileOpen)}
        className={cn(
          "fixed bottom-4 right-4 z-30 h-11 flex items-center gap-2 px-4 border-2 border-foreground shadow-[3px_3px_0px_0px_hsl(var(--foreground))] transition-all",
          profileOpen
            ? "bg-foreground text-background"
            : "bg-background text-foreground hover:bg-foreground hover:text-background"
        )}
      >
        <User className="w-4 h-4" />
        <span className="text-[10px] font-bold uppercase tracking-wider">Profil</span>
        {profileOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronUp className="w-3.5 h-3.5" />}
      </button>

      {/* Profile preview drawer (bottom sheet) */}
      {profileOpen && (
        <div className="fixed inset-x-0 bottom-0 z-20 bg-background border-t-2 border-foreground shadow-[0_-4px_20px_rgba(0,0,0,0.15)] max-h-[60vh] overflow-y-auto animate-in slide-in-from-bottom duration-200">
          <div className="max-w-3xl mx-auto px-4 py-4 space-y-4">
            {/* Header */}
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h3 className="text-sm font-bold uppercase tracking-wider text-foreground">{candidate.name}</h3>
                {enrichedProfile?.headline && (
                  <p className="text-[11px] text-muted-foreground mt-0.5">{enrichedProfile.headline}</p>
                )}
                <div className="flex items-center gap-3 mt-1.5 flex-wrap">
                  {enrichedProfile?.location && (
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <MapPin className="w-3 h-3" /> {enrichedProfile.location}
                    </span>
                  )}
                  {enrichedProfile?.currentCompany && (
                    <span className="flex items-center gap-1 text-[10px] text-muted-foreground">
                      <Building2 className="w-3 h-3" /> {enrichedProfile.currentCompany}
                    </span>
                  )}
                  {enrichedProfile?.yearsOfExperience && (
                    <span className="text-[10px] text-muted-foreground">
                      {enrichedProfile.yearsOfExperience} ans d'XP
                    </span>
                  )}
                </div>
              </div>
              {candidate.linkedin && (
                <a href={candidate.linkedin} target="_blank" rel="noopener noreferrer"
                  className="shrink-0 h-8 px-3 flex items-center gap-1.5 border-2 border-foreground text-foreground text-[10px] font-bold uppercase tracking-wider hover:bg-foreground hover:text-background transition-colors">
                  <ExternalLink className="w-3 h-3" /> LinkedIn
                </a>
              )}
            </div>

            {/* Summary */}
            {enrichedProfile?.summary && (
              <div className="border-l-2 border-foreground pl-3">
                <p className="text-[11px] text-muted-foreground leading-relaxed line-clamp-4">{enrichedProfile.summary}</p>
              </div>
            )}

            {/* Experiences */}
            {enrichedProfile?.experiences && enrichedProfile.experiences.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                  <Briefcase className="w-3 h-3" /> Expériences
                </h4>
                <div className="space-y-2">
                  {enrichedProfile.experiences.slice(0, 4).map((exp, i) => (
                    <div key={i} className="flex items-start gap-2">
                      <span className={cn("w-1.5 h-1.5 shrink-0 mt-1.5", exp.isCurrent ? "bg-emerald-400" : "bg-foreground/20")} />
                      <div className="min-w-0">
                        <p className="text-[11px] font-bold text-foreground truncate">{exp.title}</p>
                        <p className="text-[10px] text-muted-foreground truncate">{exp.company}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Education */}
            {enrichedProfile?.education && enrichedProfile.education.length > 0 && (
              <div className="space-y-2">
                <h4 className="text-[10px] font-bold uppercase tracking-wider text-foreground flex items-center gap-1.5">
                  <GraduationCap className="w-3 h-3" /> Formation
                </h4>
                <div className="space-y-1">
                  {enrichedProfile.education.slice(0, 3).map((edu, i) => (
                    <p key={i} className="text-[11px] text-muted-foreground">
                      <span className="font-medium text-foreground">{edu.school}</span>
                      {edu.degree && ` · ${edu.degree}`}
                    </p>
                  ))}
                </div>
              </div>
            )}

            {/* Skills */}
            {enrichedProfile?.skills && enrichedProfile.skills.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {enrichedProfile.skills.slice(0, 12).map((skill, i) => (
                  <span key={i} className="px-2 py-0.5 border border-foreground/15 text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                    {typeof skill === 'string' ? skill : (skill as any).name || ''}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

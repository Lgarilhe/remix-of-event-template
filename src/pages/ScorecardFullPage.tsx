import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { ScorecardTab } from '@/components/ats/ScorecardTab';
import { ATSCandidate } from '@/hooks/useATSData';
import { EnrichedProfile } from '@/hooks/useProfileEnrichment';
import { ArrowLeft, Maximize2 } from 'lucide-react';
import { toast } from 'sonner';

export default function ScorecardFullPage() {
  const { candidateId } = useParams<{ candidateId: string }>();
  const navigate = useNavigate();
  const [candidate, setCandidate] = useState<ATSCandidate | null>(null);
  const [loading, setLoading] = useState(true);

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

      // Try to get job title
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

  // Parse linkedinProfileData into EnrichedProfile
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

  return (
    <div className="min-h-screen bg-background text-foreground">
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
        />
      </div>
    </div>
  );
}

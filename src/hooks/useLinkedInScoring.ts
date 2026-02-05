import { useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { LinkedInProfile } from '@/components/outreach/types';
import { Job } from '@/pages/JobSpace';
import { JobMatchResult } from '@/components/outreach/JobScoreDisplay';
import { toast } from 'sonner';

interface ScoringContext {
  selectedJob: Job | null;
  selectedProfiles: Set<string>;
  results: LinkedInProfile[];
  jobScores: Record<string, JobMatchResult>;
  autoHideTreatedRef: React.MutableRefObject<boolean>;
  candidateStatus: {
    batchDismiss: (profiles: Array<{
      id: string;
      name?: string;
      headline?: string;
      profileUrl?: string;
      score?: number;
      recommendation?: string;
      skipReason?: string;
    }>) => Promise<void>;
  };
}

interface ScoringSetters {
  setJobScores: React.Dispatch<React.SetStateAction<Record<string, JobMatchResult>>>;
  setScoringInProgress: (v: boolean) => void;
  setSortByScore: (v: boolean) => void;
  setResults: React.Dispatch<React.SetStateAction<LinkedInProfile[]>>;
  setSelectedProfiles: React.Dispatch<React.SetStateAction<Set<string>>>;
}

// Build enriched profile data for scoring
export function buildProfileData(profile: LinkedInProfile) {
  const workExperience = profile.work_experience || [];
  const currentJob = workExperience.find(exp => !exp.end) || workExperience[0];
  const pastJobs = workExperience.filter(exp => exp.end).slice(0, 5);
  const education = profile.education || [];

  // Calculate years of experience from diploma
  const calculateYearsFromDiploma = () => {
    const relevantDegreeKeywords = [
      'bachelor', 'licence', 'bac+3',
      'master', 'msc', 'bac+5', 'maîtrise',
      'mba', 'ingénieur', 'engineer', 'engineering',
      'phd', 'doctorat', 'bac+8',
      'diplôme', 'degree', 'graduate', 'grande école'
    ];

    const relevantEdu = education
      .filter((edu: any) => {
        if (!edu.end?.year) return false;
        const combined = `${edu.degree || ''} ${edu.school || ''} ${edu.field_of_study || ''}`.toLowerCase();
        return relevantDegreeKeywords.some(kw => combined.includes(kw));
      })
      .sort((a: any, b: any) => (b.end?.year || 0) - (a.end?.year || 0));

    const diplomaToUse = relevantEdu[0] || education.filter((edu: any) => edu.end?.year).sort((a: any, b: any) => (b.end?.year || 0) - (a.end?.year || 0))[0];

    if (!diplomaToUse?.end?.year) return null;
    const years = new Date().getFullYear() - diplomaToUse.end.year;
    return years > 0 ? years : null;
  };

  // Calculate duration in months
  const calculateDurationMonths = (start?: { year?: number; month?: number }, end?: { year?: number; month?: number }): number => {
    if (!start?.year) return 0;
    const endYear = end?.year || new Date().getFullYear();
    const endMonth = end?.month || new Date().getMonth() + 1;
    const startYear = start.year;
    const startMonth = start.month || 1;
    return (endYear - startYear) * 12 + (endMonth - startMonth);
  };

  // Format duration string
  const formatDuration = (totalMonths: number): string => {
    const years = Math.floor(totalMonths / 12);
    const months = totalMonths % 12;
    if (years === 0) return `${months} mois`;
    if (months === 0) return `${years} an${years > 1 ? 's' : ''}`;
    return `${years} an${years > 1 ? 's' : ''} ${months} mois`;
  };

  // Calculate average tenure
  const calculateAverageTenure = (): number | null => {
    const positionsWithDates = workExperience.filter(exp => exp.start?.year);
    if (positionsWithDates.length === 0) return null;

    const tenures = positionsWithDates.map(exp => calculateDurationMonths(exp.start, exp.end));
    const totalMonths = tenures.reduce((sum, t) => sum + t, 0);
    return Math.round(totalMonths / positionsWithDates.length);
  };

  // Build enriched work experience
  const recentPositions = workExperience.slice(0, 3);
  const enrichedWorkExperience = recentPositions.map(exp => {
    const durationMonths = calculateDurationMonths(exp.start, exp.end);
    return {
      role: exp.role || '',
      company: exp.company || '',
      duration: durationMonths > 0 ? formatDuration(durationMonths) : undefined,
      durationMonths,
      description: exp.description?.slice(0, 200) || undefined,
      skills: exp.skills?.slice(0, 5).map(s => s.name || String(s)) || undefined,
    };
  });

  // Receptivity signals
  const isOpenToWork = profile.open_to_work === true;
  const isOpenProfile = profile.open_profile === true;
  const networkDistance = typeof profile.network_distance === 'number'
    ? profile.network_distance
    : parseInt(String(profile.network_distance), 10) || null;

  return {
    name: profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
    headline: profile.headline,
    currentRole: currentJob?.role,
    currentCompany: currentJob?.company,
    location: profile.location,
    skills: profile.skills?.map((s: any) => s.name || s).slice(0, 15) || [],
    summary: profile.summary?.slice(0, 300) || undefined,
    workExperience: enrichedWorkExperience.length > 0 ? enrichedWorkExperience : undefined,
    pastPositions: pastJobs.map(p => `${p.role} chez ${p.company}`),
    education: education.map((e: any) => {
      const degree = e.degree || '';
      const school = e.school || '';
      const year = e.end?.year ? ` (${e.end.year})` : '';
      return `${degree} - ${school}${year}`;
    }) || [],
    yearsOfExperience: calculateYearsFromDiploma(),
    averageTenureMonths: calculateAverageTenure(),
    openToWork: isOpenToWork,
    openProfile: isOpenProfile,
    networkDistance,
  };
}

export function useLinkedInScoring(
  context: ScoringContext,
  setters: ScoringSetters
) {
  const {
    selectedJob,
    selectedProfiles,
    results,
    jobScores,
    autoHideTreatedRef,
    candidateStatus,
  } = context;

  const {
    setJobScores,
    setScoringInProgress,
    setSortByScore,
    setResults,
    setSelectedProfiles,
  } = setters;

  // Score a single profile
  const scoreProfile = useCallback(async (profile: LinkedInProfile) => {
    if (!selectedJob) {
      toast.error('Sélectionnez un poste pour le scoring');
      return;
    }

    try {
      const profileData = buildProfileData(profile);

      const { data, error } = await supabase.functions.invoke('score-profile-job', {
        body: {
          profile: profileData,
          job: {
            id: selectedJob.id,
            title: selectedJob.title,
            client: selectedJob.client,
            skills: selectedJob.skills || [],
            requirements: selectedJob.requirements,
            description: selectedJob.description,
            seniority: selectedJob.seniority,
            location: selectedJob.location,
            remote: selectedJob.remote,
            xpMin: selectedJob.xpMin,
            xpMax: selectedJob.xpMax,
            salaryMin: selectedJob.salaryMin,
            salaryMax: selectedJob.salaryMax,
            tjmMin: selectedJob.tjm,
            contractType: selectedJob.contractType,
          }
        }
      });

      if (error) throw error;
      if (data?.result) {
        setJobScores(prev => ({ ...prev, [profile.id]: data.result }));
      }
    } catch (err) {
      console.error('Score error:', err);
      toast.error('Erreur lors du scoring');
    }
  }, [selectedJob, setJobScores]);

  // Batch score selected profiles
  const handleBatchScore = useCallback(async () => {
    if (!selectedJob) {
      toast.error('Sélectionnez un poste pour le scoring');
      return;
    }

    if (selectedProfiles.size === 0) {
      toast.error('Sélectionnez au moins un profil');
      return;
    }

    setScoringInProgress(true);
    const profilesToScore = results.filter(p => selectedProfiles.has(p.id));

    try {
      const profilesData = profilesToScore.map(buildProfileData);

      const { data, error } = await supabase.functions.invoke('score-profile-job', {
        body: {
          profiles: profilesData,
          job: {
            id: selectedJob.id,
            title: selectedJob.title,
            client: selectedJob.client,
            skills: selectedJob.skills || [],
            requirements: selectedJob.requirements,
            description: selectedJob.description,
            seniority: selectedJob.seniority,
            location: selectedJob.location,
            remote: selectedJob.remote,
            xpMin: selectedJob.xpMin,
            xpMax: selectedJob.xpMax,
            salaryMin: selectedJob.salaryMin,
            salaryMax: selectedJob.salaryMax,
            tjmMin: selectedJob.tjm,
            contractType: selectedJob.contractType,
          }
        }
      });

      if (error) {
        if (error.message?.includes('CREDITS_EXHAUSTED') || error.message?.includes('402')) {
          toast.error('Crédits IA épuisés. Veuillez ajouter des crédits.', { duration: 8000 });
          return;
        }
        if (error.message?.includes('RATE_LIMITED') || error.message?.includes('429')) {
          toast.error('Limite de requêtes IA atteinte. Réessayez dans quelques instants.', { duration: 5000 });
          return;
        }
        throw error;
      }

      if (data?.results) {
        const newScores: Record<string, JobMatchResult> = {};
        const lowScoreProfiles: Array<{
          id: string;
          name?: string;
          headline?: string;
          profileUrl?: string;
          score?: number;
          recommendation?: string;
          skipReason?: string;
        }> = [];

        data.results.forEach((result: JobMatchResult, index: number) => {
          const profile = profilesToScore[index];
          if (profile) {
            newScores[profile.id] = result;
            if (result.recommendation === 'skip') {
              lowScoreProfiles.push({
                id: profile.id,
                name: profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
                headline: profile.headline,
                profileUrl: profile.public_profile_url || profile.profile_url,
                score: result.match_score,
                recommendation: result.recommendation,
                skipReason: result.summary || 'Score insuffisant',
              });
            }
          }
        });

        setJobScores(prev => ({ ...prev, ...newScores }));
        setSortByScore(true);

        // Auto-dismiss low score profiles when autoHideTreated is ON
        const shouldAutoDismiss = autoHideTreatedRef.current;
        if (shouldAutoDismiss && lowScoreProfiles.length > 0) {
          await candidateStatus.batchDismiss(lowScoreProfiles);

          const lowScoreIds = new Set(lowScoreProfiles.map(p => p.id));
          setResults(prev => prev.filter(p => !lowScoreIds.has(p.id)));
          setSelectedProfiles(prev => {
            const newSet = new Set(prev);
            lowScoreIds.forEach(id => newSet.delete(id));
            return newSet;
          });

          const goodCount = data.results.length - lowScoreProfiles.length;
          toast.success(`${data.results.length} profils scorés : ${goodCount} pertinent${goodCount > 1 ? 's' : ''}, ${lowScoreProfiles.length} écarté${lowScoreProfiles.length > 1 ? 's' : ''}`);
        } else {
          const goodCount = data.results.length - lowScoreProfiles.length;
          if (lowScoreProfiles.length > 0) {
            toast.success(`${data.results.length} profils scorés : ${goodCount} pertinent${goodCount > 1 ? 's' : ''}, ${lowScoreProfiles.length} peu adapté${lowScoreProfiles.length > 1 ? 's' : ''}`);
          } else {
            toast.success(`${data.results.length} profils scorés`);
          }
        }
      }
    } catch (err) {
      console.error('Batch score error:', err);
      toast.error('Erreur lors du scoring par lot');
    } finally {
      setScoringInProgress(false);
    }
  }, [selectedJob, selectedProfiles, results, autoHideTreatedRef, candidateStatus, setJobScores, setScoringInProgress, setSortByScore, setResults, setSelectedProfiles]);

  return {
    scoreProfile,
    handleBatchScore,
  };
}

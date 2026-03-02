import React, { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { LinkedInProfile } from '@/components/outreach/types';
import { Job } from '@/types/jobs';
import { JobMatchResult, BatchScoringStats } from '@/components/outreach/JobScoreDisplay';
import { toast } from 'sonner';

interface ScoringOptions {
  selectedJob: Job | null;
  selectedProfiles: Set<string>;
  results: LinkedInProfile[];
  allAvailableProfilesRef?: React.MutableRefObject<LinkedInProfile[]>;
  jobScores: Record<string, JobMatchResult>;
  setJobScores: React.Dispatch<React.SetStateAction<Record<string, JobMatchResult>>>;
  setScoringInProgress: (v: boolean) => void;
  setSortByScore?: (v: boolean) => void;
  setResults?: React.Dispatch<React.SetStateAction<LinkedInProfile[]>>;
  setSelectedProfiles?: React.Dispatch<React.SetStateAction<Set<string>>>;
  autoHideTreatedRef?: React.MutableRefObject<boolean>;
  customScoringInstructions?: string;
  candidateStatus?: {
    batchDismiss: (profiles: Array<{
      id: string;
      name?: string;
      headline?: string;
      profileUrl?: string;
      score?: number;
      recommendation?: string;
      skipReason?: string;
      scoringDetails?: any;
      linkedinProfileData?: any;
    }>) => Promise<void>;
    saveScore?: (candidateId: string, data: {
      name?: string;
      headline?: string;
      profileUrl?: string;
      score: number;
      recommendation: string;
      scoringDetails?: any;
      linkedinProfileData?: any;
    }) => Promise<void>;
    batchSaveScores?: (candidates: Array<{
      id: string;
      name?: string;
      headline?: string;
      profileUrl?: string;
      score: number;
      recommendation: string;
      scoringDetails?: any;
      linkedinProfileData?: any;
    }>) => Promise<void>;
  };
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

// Map edge function result keys to JobMatchResult interface
function mapScoringResult(raw: any): JobMatchResult {
  const recMap: Record<string, string> = {
    'STRONG_MATCH': 'go', 'GOOD_MATCH': 'go',
    'POSSIBLE_MATCH': 'maybe', 'WEAK_MATCH': 'skip',
    'NO_MATCH': 'skip', 'ERROR': 'skip',
  };
  const expMap: Record<string, string> = {
    'MATCH': 'compatible', 'OVER': 'trop_senior',
    'UNDER': 'trop_junior', 'UNKNOWN': 'incertain',
  };
  return {
    profile_name: raw.name || raw.profile_name || '',
    match_score: Math.max(0, Math.min(100, Number(raw.score ?? raw.match_score ?? raw.finalScore) || 0)),
    matching_skills: raw.matching_skills || raw.matchedSkills || [],
    missing_skills: raw.missing_skills || raw.missingSkills || [],
    experience_match: (expMap[raw.experienceMatch] || raw.experience_match || 'incertain') as JobMatchResult['experience_match'],
    location_match: raw.location_match ?? (raw.locationMatch === 'MATCH' || raw.locationMatch === 'REMOTE_OK'),
    summary: raw.summary || '',
    recommendation: (recMap[raw.recommendation] || raw.recommendation || 'maybe') as JobMatchResult['recommendation'],
    salary_analysis: raw.salary_analysis,
    scoring_details: {
      strengths: raw.strengths || [],
      concerns: raw.concerns || [],
      seniorityMatch: raw.seniorityMatch || raw.seniority_match || undefined,
      tenureAnalysis: raw.tenureAnalysis || raw.tenure_analysis || undefined,
      receptivityScore: raw.receptivityScore ?? raw.receptivity_score ?? null,
      foreignDiplomaRisk: raw.foreignDiplomaRisk || raw.foreign_diploma_risk || 'none',
      locationCompatibility: raw.locationCompatibility || raw.location_compatibility || 'unknown',
      candidatePreferencesConflict: raw.candidatePreferencesConflict || raw.candidate_preferences_conflict || null,
      contractMismatch: raw.contractMismatch || raw.contract_mismatch || null,
      skipReason: raw.skipReason || raw.skip_reason || null,
    },
    // V2 fields passthrough
    hardFilterPassed: raw.hardFilterPassed,
    hardFilterKO: raw.hardFilterKO,
    confidenceScore: raw.confidenceScore,
    dimensions: raw.dimensions,
    dataCompleteness: raw.dataCompleteness,
    missingDataPoints: raw.missingDataPoints,
    skippedLLM: raw.skippedLLM,
    processingTimeMs: raw.processingTimeMs,
    tokensUsed: raw.tokensUsed,
  };
}

// Serialize profile for storage (keep essential data, skip huge fields)
function serializeProfileForStorage(profile: LinkedInProfile): any {
  return {
    name: profile.name,
    first_name: profile.first_name,
    last_name: profile.last_name,
    headline: profile.headline,
    summary: profile.summary,
    location: profile.location,
    skills: profile.skills,
    work_experience: (profile.work_experience || []).slice(0, 8),
    education: profile.education,
    languages: (profile as any).languages,
    open_to_work: profile.open_to_work,
    open_profile: profile.open_profile,
    network_distance: profile.network_distance,
    public_profile_url: profile.public_profile_url,
    profile_url: profile.profile_url,
    connections_count: profile.connections_count,
  };
}

export function useLinkedInScoring({
  selectedJob,
  selectedProfiles,
  results,
  allAvailableProfilesRef,
  jobScores,
  setJobScores,
  setScoringInProgress,
  setSortByScore,
  setResults,
  setSelectedProfiles,
  autoHideTreatedRef,
  candidateStatus,
  customScoringInstructions,
}: ScoringOptions) {
  const [batchStats, setBatchStats] = useState<BatchScoringStats | null>(null);

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
          },
          customScoringInstructions,
        }
      });

      if (error) throw error;
      if (data?.result) {
        const mapped = mapScoringResult(data.result);
        setJobScores(prev => ({ ...prev, [profile.id]: mapped }));
        
        const profileName = profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
        const profileUrl = profile.public_profile_url || profile.profile_url || (profile as any)?.linkedin_url;

        // Serialize full LinkedIn profile for storage
        const linkedinProfileData = serializeProfileForStorage(profile);

        // Auto-dismiss profiles with 'skip' recommendation
        if (mapped.recommendation === 'skip' && candidateStatus) {
          await candidateStatus.batchDismiss([{
            id: profile.id,
            name: profileName,
            headline: profile.headline,
            profileUrl,
            score: mapped.match_score,
            recommendation: mapped.recommendation,
            skipReason: mapped.summary || 'Score insuffisant',
            scoringDetails: mapped,
            linkedinProfileData,
          }]);
          setSelectedProfiles?.(prev => {
            const newSet = new Set(prev);
            newSet.delete(profile.id);
            return newSet;
          });
          toast.info(`Profil écarté (score: ${mapped.match_score}%)`);
        } else if (candidateStatus?.saveScore) {
          // Persist score for go/maybe profiles too
          await candidateStatus.saveScore(profile.id, {
            name: profileName,
            headline: profile.headline,
            profileUrl,
            score: mapped.match_score,
            recommendation: mapped.recommendation,
            scoringDetails: mapped,
            linkedinProfileData,
          });
        }
      }
    } catch (err) {
      console.error('Score error:', err);
      toast.error('Erreur lors du scoring');
    }
  }, [selectedJob, setJobScores, candidateStatus, setSelectedProfiles, customScoringInstructions]);

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
    // Use merged results (including pool profiles) if available, otherwise fall back to search results
    const allProfiles = allAvailableProfilesRef?.current || results;
    // Exclude profiles that already have a score to avoid re-scoring
    const profilesToScore = allProfiles.filter(p => selectedProfiles.has(p.id) && !jobScores[p.id]);

    if (profilesToScore.length === 0) {
      toast.info('Tous les profils sélectionnés sont déjà scorés');
      setScoringInProgress(false);
      return;
    }

    // Batch settings to avoid AI rate limits
    const BATCH_SIZE = 10;
    const DELAY_BETWEEN_BATCHES_MS = 500;

    try {
      const profilesData = profilesToScore.map(buildProfileData);
      const jobPayload = {
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
      };

      const allResults: JobMatchResult[] = [];
      let rateLimited = false;
      let aggregatedStats: BatchScoringStats | null = null;
      const batchStartTime = Date.now();
      const totalBatches = Math.ceil(profilesData.length / BATCH_SIZE);

      for (let i = 0; i < profilesData.length; i += BATCH_SIZE) {
        const batch = profilesData.slice(i, i + BATCH_SIZE);
        const batchIndex = Math.floor(i / BATCH_SIZE) + 1;

        if (totalBatches > 1) {
          toast.info(`Scoring lot ${batchIndex}/${totalBatches}...`, { id: 'batch-scoring-progress', duration: 3000 });
        }

        const { data, error } = await supabase.functions.invoke('score-profile-job', {
          body: { profiles: batch, job: jobPayload, customScoringInstructions }
        });

        if (error) {
          const errMsg = error.message || '';
          if (errMsg.includes('CREDITS_EXHAUSTED') || errMsg.includes('402')) {
            toast.error('Crédits IA épuisés.', { duration: 8000 });
            return;
          }
          if (errMsg.includes('RATE_LIMITED') || errMsg.includes('429')) {
            rateLimited = true;
            // Fill fallback for this batch
            batch.forEach(() => allResults.push({
              match_score: 0,
              matching_skills: [],
              missing_skills: [],
              experience_match: 'incertain',
              location_match: false,
              summary: 'Rate limited - réessayez plus tard',
              recommendation: 'maybe',
            } as any));
            break;
          }
          // For other errors (including Failed to fetch), skip this batch gracefully
          console.error(`Batch ${batchIndex} error:`, error);
          toast.warning(`Lot ${batchIndex}/${totalBatches} échoué, passage au suivant...`);
          continue;
        }

        if (data?.results && Array.isArray(data.results)) {
          allResults.push(...data.results);
        }
        // Capture batch stats from response
        if (data?.stats) {
          aggregatedStats = {
            total: (aggregatedStats?.total || 0) + (data.stats.total || 0),
            hardFiltered: (aggregatedStats?.hardFiltered || 0) + (data.stats.hardFiltered || 0),
            llmSkipped: (aggregatedStats?.llmSkipped || 0) + (data.stats.llmSkipped || 0),
            llmCalled: (aggregatedStats?.llmCalled || 0) + (data.stats.llmCalled || 0),
            avgScore: data.stats.avgScore || 0,
            totalTokens: (aggregatedStats?.totalTokens || 0) + (data.stats.totalTokens || 0),
          };
        }

        // Delay between batches
        if (i + BATCH_SIZE < profilesData.length && !rateLimited) {
          await new Promise(resolve => setTimeout(resolve, DELAY_BETWEEN_BATCHES_MS));
        }
      }

      if (allResults.length > 0) {
        const newScores: Record<string, JobMatchResult> = {};
        const lowScoreProfiles: Array<{
          id: string;
          name?: string;
          headline?: string;
          profileUrl?: string;
          score?: number;
          recommendation?: string;
          skipReason?: string;
          scoringDetails?: any;
          linkedinProfileData?: any;
        }> = [];
        const goodScoreProfiles: Array<{
          id: string;
          name?: string;
          headline?: string;
          profileUrl?: string;
          score: number;
          recommendation: string;
          scoringDetails?: any;
          linkedinProfileData?: any;
        }> = [];

        allResults.forEach((rawResult: any, index: number) => {
          const profile = profilesToScore[index];
          if (!profile) return;
          const result = mapScoringResult(rawResult);
          newScores[profile.id] = result;
          const profileName = profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
          const profileUrl = profile.public_profile_url || profile.profile_url;
          const linkedinProfileData = serializeProfileForStorage(profile);
          if (result.recommendation === 'skip' || result.match_score === 0) {
            lowScoreProfiles.push({
              id: profile.id,
              name: profileName,
              headline: profile.headline,
              profileUrl,
              score: result.match_score,
              recommendation: result.recommendation || 'skip',
              skipReason: result.summary || 'Score insuffisant',
              scoringDetails: result,
              linkedinProfileData,
            });
          } else {
            goodScoreProfiles.push({
              id: profile.id,
              name: profileName,
              headline: profile.headline,
              profileUrl,
              score: result.match_score,
              recommendation: result.recommendation,
              scoringDetails: result,
              linkedinProfileData,
            });
          }
        });

        setJobScores(prev => ({ ...prev, ...newScores }));
        setSortByScore(true);

        const scoredCount = Object.keys(newScores).length;

        // Persist good scores
        if (goodScoreProfiles.length > 0 && candidateStatus?.batchSaveScores) {
          await candidateStatus.batchSaveScores(goodScoreProfiles);
        }

        // Always auto-dismiss low score profiles after scoring
        if (lowScoreProfiles.length > 0 && candidateStatus) {
          await candidateStatus.batchDismiss(lowScoreProfiles);

          // Remove from selection
          const lowScoreIds = new Set(lowScoreProfiles.map(p => p.id));
          setSelectedProfiles?.(prev => {
            const newSet = new Set(prev);
            lowScoreIds.forEach(id => newSet.delete(id));
            return newSet;
          });
        }

        const goodCount = scoredCount - lowScoreProfiles.length;
        if (rateLimited) {
          toast.warning(`${scoredCount} profils scorés sur ${profilesToScore.length} (rate limit atteint, réessayez le reste)`);
        } else if (lowScoreProfiles.length > 0) {
          toast.success(`${scoredCount} profils scorés : ${goodCount} pertinent${goodCount > 1 ? 's' : ''}, ${lowScoreProfiles.length} écarté${lowScoreProfiles.length > 1 ? 's' : ''}`);
        } else {
          toast.success(`${scoredCount} profils scorés`);
        }
        // Compute aggregate stats if not provided by backend
        if (!aggregatedStats) {
          const mapped = Object.values(newScores);
          aggregatedStats = {
            total: mapped.length,
            hardFiltered: mapped.filter(r => r.hardFilterPassed === false).length,
            llmSkipped: mapped.filter(r => r.skippedLLM).length,
            llmCalled: mapped.filter(r => !r.skippedLLM && r.hardFilterPassed !== false).length,
            avgScore: Math.round(mapped.reduce((s, r) => s + r.match_score, 0) / mapped.length),
            totalTokens: mapped.reduce((s, r) => s + (r.tokensUsed ? r.tokensUsed.input + r.tokensUsed.output : 0), 0),
          };
        } else {
          // Recalculate avg across all batches
          const mapped = Object.values(newScores);
          aggregatedStats.avgScore = Math.round(mapped.reduce((s, r) => s + r.match_score, 0) / mapped.length);
          aggregatedStats.total = mapped.length;
        }
        setBatchStats(aggregatedStats);
      }
    } catch (err) {
      console.error('Batch score error:', err);
      toast.error('Erreur lors du scoring par lot');
    } finally {
      setScoringInProgress(false);
    }
  }, [selectedJob, selectedProfiles, results, allAvailableProfilesRef, autoHideTreatedRef, candidateStatus, setJobScores, setScoringInProgress, setSortByScore, setResults, setSelectedProfiles, customScoringInstructions]);

  return {
    scoreProfile,
    handleBatchScore,
    batchStats,
  };
}

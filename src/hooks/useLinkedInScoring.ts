import React, { useCallback, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { LinkedInProfile } from '@/components/outreach/types';
import { getYear, parseDate } from '@/components/outreach/dateUtils';
import { Job } from '@/types/jobs';
import { JobMatchResult, BatchScoringStats } from '@/components/outreach/JobScoreDisplay';
import { BatchReportEntry } from '@/components/outreach/BatchScoringReport';
import { toast } from 'sonner';

// Fire-and-forget: generate embedding for a candidate after scoring
async function generateCandidateEmbedding(profile: LinkedInProfile): Promise<void> {
  const parts: string[] = [];

  // Identity & headline
  if (profile.name) parts.push(`Name: ${profile.name}`);
  if (profile.headline) parts.push(`Headline: ${profile.headline}`);
  if (profile.summary) parts.push(`Summary: ${profile.summary}`);
  if (profile.location) parts.push(`Location: ${profile.location}`);
  if (profile.industry) parts.push(`Industry: ${profile.industry}`);

  // Skills (all of them)
  const skills = (profile.skills || []).map(s => typeof s === 'string' ? s : s.name).filter(Boolean);
  if (skills.length > 0) parts.push(`Skills: ${skills.join(', ')}`);

  // Work experience — ALL entries with full detail
  const workExp = profile.work_experience || [];
  if (workExp.length > 0) {
    const expParts = workExp.map(w => {
      const lines: string[] = [];
      if (w.role) lines.push(`Role: ${w.role}`);
      if (w.company) lines.push(`Company: ${w.company}`);
      if (w.description) lines.push(`Description: ${w.description}`);
      if (w.industry) lines.push(`Industry: ${w.industry}`);
      if (w.location) lines.push(`Location: ${w.location}`);
      if (w.company_description) lines.push(`Company desc: ${w.company_description}`);
      if (w.skills && w.skills.length > 0) lines.push(`Skills: ${w.skills.map(s => s.name).join(', ')}`);
      return lines.join(' | ');
    }).filter(Boolean);
    parts.push(`Experience: ${expParts.join(' ; ')}`);
  }

  // Current positions (legacy but may contain extra data)
  const currentPos = profile.current_positions || [];
  if (currentPos.length > 0 && workExp.length === 0) {
    const cpParts = currentPos.map(p =>
      [p.role, p.company, p.description, p.location].filter(Boolean).join(' | ')
    ).filter(Boolean);
    parts.push(`Current positions: ${cpParts.join(' ; ')}`);
  }

  // Past positions (legacy fallback)
  const pastPos = profile.past_positions || [];
  if (pastPos.length > 0 && workExp.length === 0) {
    const ppParts = pastPos.map(p =>
      [p.role, p.company, p.description, p.location].filter(Boolean).join(' | ')
    ).filter(Boolean);
    parts.push(`Past positions: ${ppParts.join(' ; ')}`);
  }

  // Education — ALL entries with full detail
  const education = profile.education || [];
  if (education.length > 0) {
    const eduParts = education.map(e => {
      const lines: string[] = [];
      if (e.school) lines.push(e.school);
      if (e.degree) lines.push(e.degree);
      if (e.field_of_study) lines.push(e.field_of_study);
      if (e.school_details?.description) lines.push(e.school_details.description);
      return lines.join(' | ');
    }).filter(Boolean);
    parts.push(`Education: ${eduParts.join(' ; ')}`);
  }

  // Certifications
  const certs = (profile as any).certifications || [];
  if (certs.length > 0) {
    const certParts = certs.map((c: any) =>
      [c.name, c.organization].filter(Boolean).join(' - ')
    ).filter(Boolean);
    parts.push(`Certifications: ${certParts.join('; ')}`);
  }

  // Projects
  const projects = (profile as any).projects || [];
  if (projects.length > 0) {
    const projParts = projects.map((p: any) => {
      const bits: string[] = [];
      if (p.name) bits.push(p.name);
      if (p.description) bits.push(p.description);
      if (p.skills?.length) bits.push(`Skills: ${p.skills.join(', ')}`);
      return bits.join(' | ');
    }).filter(Boolean);
    parts.push(`Projects: ${projParts.join('; ')}`);
  }

  // Volunteering
  const volunteering = (profile as any).volunteering_experience || [];
  if (volunteering.length > 0) {
    const volParts = volunteering.map((v: any) =>
      [v.role, v.company, v.cause, v.description].filter(Boolean).join(' | ')
    ).filter(Boolean);
    parts.push(`Volunteering: ${volParts.join('; ')}`);
  }

  // Languages
  const languages = (profile as any).languages || [];
  if (languages.length > 0) {
    const langParts = languages.map((l: any) =>
      l.proficiency ? `${l.name} (${l.proficiency})` : l.name
    );
    parts.push(`Languages: ${langParts.join(', ')}`);
  }

  // Recommendations received (text content is rich signal)
  const recs = (profile as any).recommendations?.received || [];
  if (recs.length > 0) {
    const recParts = recs.slice(0, 5).map((r: any) => r.text).filter(Boolean);
    if (recParts.length > 0) parts.push(`Recommendations: ${recParts.join(' ; ')}`);
  }

  // Hashtags / creator topics
  const hashtags = (profile as any).hashtags || [];
  if (hashtags.length > 0) parts.push(`Topics: ${hashtags.join(', ')}`);

  // Recent LinkedIn posts (rich signal for interests, expertise, thought leadership)
  const posts = (profile as any).recent_posts || [];
  if (posts.length > 0) {
    const postParts = posts.slice(0, 5).map((p: any) => {
      const bits: string[] = [];
      if (p.title) bits.push(p.title);
      if (p.text) bits.push(p.text.length > 300 ? p.text.slice(0, 300) + '...' : p.text);
      return bits.join(' | ');
    }).filter((t: string) => t.length > 10);
    if (postParts.length > 0) parts.push(`Recent posts: ${postParts.join(' ; ')}`);
  }

  // Interests / signals
  const interests = profile.interests || [];
  if (interests.length > 0) parts.push(`Interests: ${interests.join(', ')}`);

  const text = parts.join('\n');

  if (text.trim().length < 20) return;

  try {
    await invokeEdgeFunction('generate-embedding', {
      text, type: 'candidate', entityId: profile.id,
    });
  } catch (e) {
    console.error('generate-embedding call failed:', e);
  }
}

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
  accountId?: string | null;
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
  // Merge work_experience with current_positions/past_positions fallback
  let workExperience = profile.work_experience || [];
  if (workExperience.length === 0) {
    const currentPositions = (profile.current_positions || []).map(p => ({ ...p, current: true }));
    const pastPositions = (profile.past_positions || []).map(p => ({ ...p, current: false }));
    workExperience = [...currentPositions, ...pastPositions];
  }
  const currentJob = workExperience.find(exp => !exp.end || exp.current) || workExperience[0];
  const pastJobs = workExperience.filter(exp => exp.end && !exp.current).slice(0, 5);
  const education = profile.education || [];

  // Calculate years of experience from diploma, with work experience fallback
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
        if (!getYear(edu.end)) return false;
        const combined = `${edu.degree || ''} ${edu.school || ''} ${edu.field_of_study || ''}`.toLowerCase();
        return relevantDegreeKeywords.some(kw => combined.includes(kw));
      })
      .sort((a: any, b: any) => (getYear(b.end) || 0) - (getYear(a.end) || 0));

    const diplomaToUse = relevantEdu[0] || education.filter((edu: any) => getYear(edu.end)).sort((a: any, b: any) => (getYear(b.end) || 0) - (getYear(a.end) || 0))[0];

    if (diplomaToUse) {
      const endYear = getYear(diplomaToUse.end);
      if (endYear) {
        const years = new Date().getFullYear() - endYear;
        if (years > 0) return years;
      }
    }

    // Fallback: use earliest work experience start date
    let earliestYear: number | null = null;
    for (const exp of workExperience) {
      const startYear = getYear(exp.start);
      if (startYear && startYear > 1970) {
        if (!earliestYear || startYear < earliestYear) {
          earliestYear = startYear;
        }
      }
    }
    if (earliestYear) {
      const years = new Date().getFullYear() - earliestYear;
      return years > 0 ? years : null;
    }

    return null;
  };

  // Calculate duration in months
  const calculateDurationMonths = (startRaw?: any, endRaw?: any): number => {
    const start = parseDate(startRaw);
    const end = parseDate(endRaw);
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
    const positionsWithDates = workExperience.filter(exp => getYear(exp.start));
    if (positionsWithDates.length === 0) return null;

    const tenures = positionsWithDates.map(exp => calculateDurationMonths(exp.start, exp.end));
    const totalMonths = tenures.reduce((sum, t) => sum + t, 0);
    return Math.round(totalMonths / positionsWithDates.length);
  };

  // Build enriched work experience — send ALL positions for accurate scoring
  const enrichedWorkExperience = workExperience.map(exp => {
    const durationMonths = calculateDurationMonths(exp.start, exp.end);
    return {
      role: exp.role || exp.position || '',
      company: exp.company || '',
      duration: durationMonths > 0 ? formatDuration(durationMonths) : undefined,
      durationMonths,
      description: exp.description?.slice(0, 500) || undefined,
      skills: exp.skills?.slice(0, 8).map(s => s.name || String(s)) || undefined,
    };
  });

  // Receptivity signals
  const isOpenToWork = profile.open_to_work === true || profile.is_open_to_work === true;
  const isOpenProfile = profile.open_profile === true || profile.is_open_profile === true;
  const networkDistance = typeof profile.network_distance === 'number'
    ? profile.network_distance
    : parseInt(String(profile.network_distance).replace('DISTANCE_', '').replace('FIRST_DEGREE', '1').replace('SECOND_DEGREE', '2').replace('THIRD_DEGREE', '3'), 10) || null;

  return {
    id: profile.id || profile.provider_id || profile.public_identifier || profile.member_urn || `${profile.first_name}_${profile.last_name}`.toLowerCase(),
    name: profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim(),
    headline: profile.headline,
    currentRole: currentJob?.role || currentJob?.position,
    currentCompany: currentJob?.company,
    location: profile.location,
    skills: profile.skills?.map((s: any) => s.name || s).slice(0, 15) || [],
    summary: profile.summary?.slice(0, 300) || undefined,
    workExperience: enrichedWorkExperience.length > 0 ? enrichedWorkExperience : undefined,
    pastPositions: pastJobs.map(p => `${p.role || p.position} chez ${p.company}`),
    education: education.map((e: any) => {
      const school = e.school || e.school_details?.name || '';
      const degree = e.degree || '';
      const field = e.field_of_study || '';
      const endYear = getYear(e.end);
      const year = endYear ? ` (${endYear})` : '';
      return [school, degree, field].filter(Boolean).join(' - ') + year;
    }).filter((s: string) => s.trim().length > 0) || [],
    yearsOfExperience: calculateYearsFromDiploma(),
    averageTenureMonths: calculateAverageTenure(),
    openToWork: isOpenToWork,
    openProfile: isOpenProfile,
    networkDistance,
    profileUrl: profile.public_profile_url || profile.profile_url || undefined,
    providerId: profile.provider_id || profile.public_identifier || undefined,
    noAiScoring: (profile as any).no_ai_scoring === true || undefined,
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
      foreignDiplomaRisk: raw.internationalExperienceValidation || raw.foreignDiplomaRisk || raw.foreign_diploma_risk || 'none',
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
  accountId,
}: ScoringOptions) {
  const [batchStats, setBatchStats] = useState<BatchScoringStats | null>(null);
  const [batchReport, setBatchReport] = useState<BatchReportEntry[]>([]);
  const [batchDurationMs, setBatchDurationMs] = useState<number | undefined>(undefined);

  // Score a single profile
  const scoreProfile = useCallback(async (profile: LinkedInProfile) => {
    if (!selectedJob) {
      toast.error('Sélectionnez un poste pour le scoring');
      return;
    }

    try {
      const profileData = buildProfileData(profile);

      const { data, error } = await invokeWithCredits('score-profile-job', 'scoring', {
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
          tjmMin: (selectedJob as any).tjmMin ?? selectedJob.tjm,
          contractType: selectedJob.contractType,
          mustHave: selectedJob.mustHave,
          shouldHave: selectedJob.shouldHave,
          niceToHave: selectedJob.niceToHave,
          bodyContent: selectedJob.bodyContent,
          transversalCriteria: selectedJob.transversalCriteria,
        },
        customScoringInstructions,
        accountId: accountId || undefined,
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

        // Generate embedding for scored candidate (fire-and-forget)
        generateCandidateEmbedding(profile).catch(err =>
          console.error('Candidate embedding error:', err)
        );
      }
    } catch (err) {
      console.error('Score error:', err);
      toast.error('Erreur lors du scoring');
    }
  }, [selectedJob, setJobScores, candidateStatus, setSelectedProfiles, customScoringInstructions, accountId]);

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

    // Batch settings — now with parallelization
    const BATCH_SIZE = 10;
    const PARALLEL_BATCHES = 3;

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
        tjmMin: (selectedJob as any).tjmMin ?? selectedJob.tjm,
        contractType: selectedJob.contractType,
        mustHave: selectedJob.mustHave,
        shouldHave: selectedJob.shouldHave,
        niceToHave: selectedJob.niceToHave,
        bodyContent: selectedJob.bodyContent,
        transversalCriteria: selectedJob.transversalCriteria,
      };

      const allResults: JobMatchResult[] = [];
      let rateLimited = false;
      let aggregatedStats: BatchScoringStats | null = null;
      const batchStartTime = Date.now();
      const totalBatches = Math.ceil(profilesData.length / BATCH_SIZE);

      // Split profiles into batches
      const batches: typeof profilesData[] = [];
      for (let i = 0; i < profilesData.length; i += BATCH_SIZE) {
        batches.push(profilesData.slice(i, i + BATCH_SIZE));
      }

      // Process batches in parallel waves (PARALLEL_BATCHES at a time)
      for (let wave = 0; wave < batches.length; wave += PARALLEL_BATCHES) {
        if (rateLimited) break;

        const waveBatches = batches.slice(wave, wave + PARALLEL_BATCHES);
        const waveStart = wave + 1;
        const waveEnd = Math.min(wave + PARALLEL_BATCHES, batches.length);

        if (totalBatches > 1) {
          toast.info(`Scoring lots ${waveStart}-${waveEnd}/${totalBatches}...`, { id: 'batch-scoring-progress', duration: 3000 });
        }

        const waveResults = await Promise.allSettled(
          waveBatches.map(batch =>
            invokeWithCredits('score-profile-job', 'scoring', {
              profiles: batch, job: jobPayload, customScoringInstructions, accountId: accountId || undefined,
            })
          )
        );

        for (let j = 0; j < waveResults.length; j++) {
          const result = waveResults[j];
          const batchIndex = wave + j + 1;

          if (result.status === 'rejected') {
            console.error(`Batch ${batchIndex} rejected:`, result.reason);
            toast.warning(`Lot ${batchIndex}/${totalBatches} échoué, passage au suivant...`);
            continue;
          }

          const { data, error } = result.value;

          if (error) {
            const errMsg = error.message || '';
            if (errMsg.includes('CREDITS_EXHAUSTED') || errMsg.includes('402')) {
              toast.error('Crédits IA épuisés.', { duration: 8000 });
              return;
            }
            if (errMsg.includes('RATE_LIMITED') || errMsg.includes('429')) {
              rateLimited = true;
              waveBatches[j].forEach(() => allResults.push({
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
            console.error(`Batch ${batchIndex} error:`, error);
            toast.warning(`Lot ${batchIndex}/${totalBatches} échoué, passage au suivant...`);
            continue;
          }

          if (data?.results && Array.isArray(data.results)) {
            allResults.push(...data.results);
          }
          if ((data as any)?.stats) {
            const stats = (data as any).stats;
            aggregatedStats = {
              total: (aggregatedStats?.total || 0) + (stats.total || 0),
              hardFiltered: (aggregatedStats?.hardFiltered || 0) + (stats.hardFiltered || 0),
              llmSkipped: (aggregatedStats?.llmSkipped || 0) + (stats.llmSkipped || 0),
              llmCalled: (aggregatedStats?.llmCalled || 0) + (stats.llmCalled || 0),
              avgScore: stats.avgScore || 0,
              totalTokens: (aggregatedStats?.totalTokens || 0) + (stats.totalTokens || 0),
            };
          }
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
          // Match by profile_id when available (batch scoring), fallback to index
          const profile = rawResult.profile_id
            ? profilesToScore.find(p => p.id === rawResult.profile_id) || profilesToScore[index]
            : profilesToScore[index];
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

        // Generate embeddings for scored candidates (fire-and-forget)
        profilesToScore.forEach(profile => {
          generateCandidateEmbedding(profile).catch(err =>
            console.error('Batch embedding error:', err)
          );
        });

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
        setBatchDurationMs(Date.now() - batchStartTime);

        // Build detailed per-profile report
        const reportEntries: BatchReportEntry[] = allResults.map((rawResult: any, index: number) => {
          const profile = rawResult.profile_id
            ? profilesToScore.find(p => p.id === rawResult.profile_id) || profilesToScore[index]
            : profilesToScore[index];
          if (!profile) return null;
          const result = mapScoringResult(rawResult);
          const profileName = profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
          const profileUrl = profile.public_profile_url || profile.profile_url;
          return {
            profileId: profile.id,
            name: profileName || 'Inconnu',
            headline: profile.headline,
            profileUrl,
            score: result.match_score,
            recommendation: result.recommendation,
            summary: result.summary || '',
            hardFilterPassed: result.hardFilterPassed,
            hardFilterKO: result.hardFilterKO,
            skippedLLM: result.skippedLLM,
            dismissed: result.recommendation === 'skip' || result.match_score === 0,
          } as BatchReportEntry;
        }).filter(Boolean) as BatchReportEntry[];
        setBatchReport(reportEntries);
      }
    } catch (err) {
      console.error('Batch score error:', err);
      toast.error('Erreur lors du scoring par lot');
    } finally {
      setScoringInProgress(false);
    }
  }, [selectedJob, selectedProfiles, results, allAvailableProfilesRef, autoHideTreatedRef, candidateStatus, setJobScores, setScoringInProgress, setSortByScore, setResults, setSelectedProfiles, customScoringInstructions, accountId]);

  const clearBatchReport = useCallback(() => {
    setBatchReport([]);
    setBatchStats(null);
    setBatchDurationMs(undefined);
  }, []);

  return {
    scoreProfile,
    handleBatchScore,
    batchStats,
    batchReport,
    batchDurationMs,
    clearBatchReport,
  };
}

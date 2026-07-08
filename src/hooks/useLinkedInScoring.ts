import React, { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { invokeCoresignal } from '@/lib/invokeCoresignal';
import { LinkedInProfile } from '@/components/outreach/types';
import { getYear, parseDate } from '@/components/outreach/dateUtils';
import { Job } from '@/types/jobs';
import { JobMatchResult, BatchScoringStats, isDegradedScore } from '@/components/outreach/JobScoreDisplay';
import { BatchReportEntry } from '@/components/outreach/BatchScoringReport';
import { toast } from 'sonner';
import { confirmAlert } from '@/lib/confirmAlert';

/**
 * Pour un profil Base Konekt (source==='database') affiché en aperçu (données
 * partielles), récupère la fiche complète (collect) avant scoring, afin que
 * score-profile-job dispose du résumé, des descriptions d'expérience et des
 * skills — sans aucune modification de score-profile-job lui-même.
 *
 * Défensif : ne bloque JAMAIS le scoring (fallback = profil d'origine).
 * No-op immédiat pour les profils LinkedIn (source !== 'database').
 */
async function hydrateIfDatabase(profile: LinkedInProfile): Promise<LinkedInProfile> {
  if (!profile || (profile as { source?: string }).source !== 'database') return profile;
  const hasDescription = Array.isArray(profile.work_experience)
    && profile.work_experience.some((w) => !!w?.description);
  if (hasDescription) return profile; // fiche déjà complète (collect en cache)
  try {
    const { data } = await invokeCoresignal({ body: { action: 'collect', id: profile.id } });
    if (data?.success && data.profile) {
      return { ...(data.profile as LinkedInProfile), source: 'database' };
    }
  } catch {
    // fallback silencieux sur le profil d'aperçu
  }
  return profile;
}

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
  /**
   * Setter du filtre statut. Si fourni, le hook switche automatiquement vers
   * le filtre "scored_go" après un batch scoring réussi qui a généré au moins
   * 1 profil pertinent. Évite d'avoir une liste vide post-scoring quand le
   * filtre par défaut cache les profils traités.
   */
  setStatusFilter?: (v: 'all' | 'untreated' | 'scored' | 'scored_go' | 'scored_maybe' | 'scored_investigate' | 'scored_not_contacted' | 'messaged' | 'dismissed' | 'known') => void;
  autoHideTreatedRef?: React.MutableRefObject<boolean>;
  customScoringInstructions?: string;
  accountId?: string | null;
  /**
   * User-selected model override for scoring (from ModelPicker).
   * null/undefined → laisse invokeWithCredits résoudre le modèle
   * (orgDefault → action.autoDefault → tier default).
   */
  scoringModel?: string | null;
  /**
   * Recherche autonome (/sourcing) : si non-null, tout scoring est bloqué
   * avec ce message — la cible (intitulé du poste) n'est pas encore définie.
   */
  scoringDisabledReason?: string | null;
  /**
   * Recherche autonome : pas de brief mission, le pré-check de complétude
   * ne s'applique pas (le scoring s'appuie sur l'intitulé + les instructions).
   */
  skipBriefCheck?: boolean;
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
    // Skills enrichies avec endorsement_count — signal de validation pair
    skillsWithEndorsements: profile.skills?.slice(0, 15).map((s: any) => ({
      name: typeof s === 'string' ? s : s.name,
      endorsements: typeof s === 'object' ? s.endorsement_count : undefined,
    })).filter((s: { name: string }) => s.name) || undefined,
    // Summary tronqué à 700 chars (~175 mots) pour capturer les bios
    // LinkedIn longues type "I help startups build reliable data infra...".
    // Le backend re-tronque à 700 aussi (cohérent).
    summary: profile.summary?.slice(0, 700) || undefined,
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
    // ─── Sprint B : signaux secondaires souvent décisifs ─────────────────
    // Recommandations LinkedIn — texte rédigé par d'anciens collègues/managers,
    // signal humain à très haute crédibilité. Particulièrement précieux pour
    // les profils thin (silencieux compétents, shadow workers).
    recommendations: (profile as any).recommendations?.received?.slice(0, 4).map((r: any) => ({
      text: r.text || r.caption || '',
      author: r.actor ? `${r.actor.first_name || ''} ${r.actor.last_name || ''}`.trim() : undefined,
      authorHeadline: r.actor?.headline,
    })).filter((r: { text: string }) => r.text && r.text.length > 20) || undefined,
    // Posts récents — expertise réelle (vs déclarative) + signal d'activité.
    // Tronqués à 180 chars pour rester compact.
    recentPosts: (profile as any).recent_posts?.slice(0, 5).map((p: any) => ({
      text: p.text?.slice(0, 180),
      title: p.title?.slice(0, 100),
      date: p.date,
      reactions: p.reaction_counter,
    })).filter((p: { text?: string; title?: string }) => p.text || p.title) || undefined,
    // Projets persos — souvent stack non-déclarée explicitement (Rust en perso
    // = vrai dev systems même si poste actuel = autre).
    projects: (profile as any).projects?.slice(0, 5).map((p: any) => ({
      name: p.name,
      description: p.description?.slice(0, 120),
      skills: p.skills?.slice(0, 5),
    })).filter((p: { name?: string }) => p.name) || undefined,
    // Certifications — preuve formelle pour les must-have (AWS SAA, CKA, etc.)
    certifications: (profile as any).certifications?.slice(0, 8).map((c: any) => ({
      name: c.name,
      organization: c.organization,
    })).filter((c: { name?: string }) => c.name) || undefined,
    // Volunteering — soft skills, leadership, engagement
    volunteering: (profile as any).volunteering_experience?.slice(0, 3).map((v: any) => ({
      role: v.role,
      company: v.company,
      description: v.description?.slice(0, 100),
    })).filter((v: { role?: string; company?: string }) => v.role || v.company) || undefined,
    // Langues — critique sur poste international (LinkedInProfile.languages)
    languages: (profile as any).languages?.map((l: any) => ({
      name: l.name,
      proficiency: l.proficiency,
    })).filter((l: { name?: string }) => l.name) || undefined,
    // Hashtags / interests — focus métier
    interests: profile.interests?.slice(0, 10) || (profile as any).hashtags?.slice(0, 10) || undefined,
    // Réseau (warm intro possible si shared > 5)
    connectionsCount: profile.connections_count,
    followersCount: (profile as any).followers_count,
    sharedConnectionsCount: profile.shared_connections_count,
    // Activity flags
    recentlyHired: profile.recently_hired,
    mentionedInNews: profile.mentioned_in_the_news,
    isCreator: profile.is_creator || profile.is_influencer,
    isHiring: profile.is_hiring,
  };
}

/**
 * Convert any value to a safe React-renderable string.
 *
 * Évite l'erreur React #31 ("Objects are not valid as a React child") quand
 * le LLM retourne occasionnellement un objet là où un string est attendu
 * (ex: criteriaEvaluations[].label = {nested: "..."} au lieu de "...").
 *
 * Stratégie : essaie .name → .label → .text → .value avant de renvoyer ''
 * (préfère masquer un champ à crasher tout l'écran).
 */
function safeStr(v: unknown): string {
  if (v == null) return '';
  if (typeof v === 'string') return v;
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  if (Array.isArray(v)) return v.map(safeStr).filter(Boolean).join(', ');
  if (typeof v === 'object') {
    const obj = v as Record<string, unknown>;
    if (typeof obj.name === 'string') return obj.name;
    if (typeof obj.label === 'string') return obj.label;
    if (typeof obj.text === 'string') return obj.text;
    if (typeof obj.value === 'string') return obj.value;
    return '';
  }
  return String(v);
}

/** Sanitize an array : keep only safe strings, drop empties. */
function safeStrArray(v: unknown, max = 50): string[] {
  if (!Array.isArray(v)) return [];
  return v.map(safeStr).filter(Boolean).slice(0, max);
}

// Map edge function result keys to JobMatchResult interface
function mapScoringResult(raw: any): JobMatchResult {
  const recMap: Record<string, string> = {
    'STRONG_MATCH': 'go', 'GOOD_MATCH': 'go',
    'POSSIBLE_MATCH': 'maybe', 'WEAK_MATCH': 'skip',
    'NO_MATCH': 'skip', 'ERROR': 'skip',
  };
  // Legacy mapping pour l'ancien format ('MATCH'/'OVER'/'UNDER'/'UNKNOWN'),
  // gardé en fallback si le backend renvoie ces strings.
  const expMap: Record<string, string> = {
    'MATCH': 'compatible', 'OVER': 'trop_senior',
    'UNDER': 'trop_junior', 'UNKNOWN': 'incertain',
  };
  // Verdict XP : priorité au champ structuré experienceMatchKind (backend
  // moderne), fallback expMap legacy, fallback experience_match snake_case,
  // sinon 'incertain'. Avant ce fix, le backend renvoyait `weighted.dimensions
  // .experience?.details` (undefined car la dimension s'appelle 'seniority'),
  // donc 'incertain' s'affichait pour tous les profils → "XP à vérifier"
  // visible sur 100% des cards même quand l'XP était parfaitement compatible.
  // Sécurité : on garantit que c'est une string parmi les 4 verdicts attendus
  // par le composant JobScoreDisplay (sinon, expLabel fallback sur 'À vérifier').
  const validExpVerdicts = new Set(['compatible', 'trop_junior', 'trop_senior', 'incertain']);
  const candidateExpValue = (typeof raw.experienceMatchKind === 'string' && raw.experienceMatchKind)
    || (typeof raw.experienceMatch === 'string' ? expMap[raw.experienceMatch] : null)
    || (typeof raw.experience_match === 'string' && raw.experience_match)
    || 'incertain';
  const experienceMatchValue = validExpVerdicts.has(candidateExpValue) ? candidateExpValue : 'incertain';
  // Verdict location : on accepte 'compatible' OU 'remote_ok' comme positif.
  // Le champ booléen historique location_match est conservé pour rétrocompat.
  const locationMatchKind = raw.locationMatchKind;
  const locationMatchBool = locationMatchKind
    ? (locationMatchKind === 'compatible' || locationMatchKind === 'remote_ok')
    : (raw.location_match ?? (raw.locationMatch === 'MATCH' || raw.locationMatch === 'REMOTE_OK'));
  return {
    profile_name: raw.name || raw.profile_name || '',
    match_score: Math.max(0, Math.min(100, Number(raw.score ?? raw.match_score ?? raw.finalScore) || 0)),
    // Sanitize : le LLM peut retourner des objets dans certains cas → safeStr
    // pour éviter l'erreur React #31 au render. Cap à 30 max pour la perf.
    matching_skills: safeStrArray(raw.matching_skills || raw.matchedSkills, 30),
    missing_skills: safeStrArray(raw.missing_skills || raw.missingSkills, 30),
    experience_match: experienceMatchValue as JobMatchResult['experience_match'],
    location_match: locationMatchBool,
    summary: safeStr(raw.summary),
    recommendation: (recMap[raw.recommendation] || (typeof raw.recommendation === 'string' ? raw.recommendation : 'maybe')) as JobMatchResult['recommendation'],
    salary_analysis: raw.salary_analysis,
    scoring_details: {
      strengths: safeStrArray(raw.strengths, 10),
      concerns: safeStrArray(raw.concerns, 10),
      seniorityMatch: safeStr(raw.seniorityMatch || raw.seniority_match) || undefined,
      tenureAnalysis: safeStr(raw.tenureAnalysis || raw.tenure_analysis) || undefined,
      receptivityScore: raw.receptivityScore ?? raw.receptivity_score ?? null,
      foreignDiplomaRisk: safeStr(raw.internationalExperienceValidation || raw.foreignDiplomaRisk || raw.foreign_diploma_risk) || 'none',
      locationCompatibility: safeStr(raw.locationCompatibility || raw.location_compatibility) || 'unknown',
      candidatePreferencesConflict: safeStr(raw.candidatePreferencesConflict || raw.candidate_preferences_conflict) || null,
      contractMismatch: safeStr(raw.contractMismatch || raw.contract_mismatch) || null,
      skipReason: safeStr(raw.skipReason || raw.skip_reason) || null,
    },
    // Criteria evaluations (per brief criteria) — sanitize chaque entry pour
    // éviter le crash React #31 si le LLM retourne des objets imbriqués.
    criteriaEvaluations: Array.isArray(raw.criteriaEvaluations)
      ? raw.criteriaEvaluations
          .map((ce: any) => ({
            label: safeStr(ce?.label),
            verdict: (typeof ce?.verdict === 'string' ? ce.verdict : 'unknown') as 'pass' | 'partial' | 'fail' | 'unknown',
            reason: safeStr(ce?.reason),
          }))
          .filter((ce: { label: string }) => ce.label)
      : [],
    likelyToSwitchScore: raw.likelyToSwitchScore ?? null,
    careerGrowthScore: raw.careerGrowthScore ?? null,
    switchSignals: safeStrArray(raw.switchSignals, 10),
    // V2 fields passthrough
    hardFilterPassed: raw.hardFilterPassed,
    hardFilterKO: raw.hardFilterKO,
    confidenceScore: raw.confidenceScore,
    // ─── Sprint C : 3 axes + investigation + shape ─────────────────────
    llmConfidenceScore: raw.llmConfidenceScore ?? null,
    engagementScore: raw.engagementScore ?? null,
    investigationNeeded: raw.investigationNeeded === true,
    investigationFocus: safeStrArray(raw.investigationFocus, 5),
    shape: typeof raw.shape === 'string' ? raw.shape : null,
    pedigreeAssessment: (raw.pedigreeAssessment && typeof raw.pedigreeAssessment === 'object') ? {
      presetName: typeof raw.pedigreeAssessment.presetName === 'string' ? raw.pedigreeAssessment.presetName : undefined,
      strictMode: raw.pedigreeAssessment.strictMode === true,
      verdict: ['match', 'partial', 'mismatch'].includes(raw.pedigreeAssessment.verdict) ? raw.pedigreeAssessment.verdict : undefined,
      matched: safeStrArray(raw.pedigreeAssessment.matched, 8),
      missed: safeStrArray(raw.pedigreeAssessment.missed, 8),
      capped: raw.pedigreeAssessment.capped === true,
      detail: typeof raw.pedigreeAssessment.detail === 'string' ? raw.pedigreeAssessment.detail : undefined,
    } : null,
    dimensions: raw.dimensions,
    dataCompleteness: raw.dataCompleteness,
    // Défaut 'quick' : les scores historiques (avant l'introduction du
    // scoring profond) ont tous été calculés sur les données de liste.
    scoringDepth: raw.scoringDepth === 'deep' ? 'deep' : 'quick',
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

// ─── Batch report persistence ──────────────────────────────────────────────
//
// Le rapport de scoring (`batchReport` + `batchStats` + `batchDurationMs`) est
// stocké dans le state React in-memory du hook. Sur mobile, le browser peut
// purger l'onglet pendant un scoring qui dure 20-30s (verrouillage écran,
// switch d'app, pression mémoire) — au réveil, le state est perdu et la modale
// "Scoring terminé" ne peut plus se rendre alors que les scores sont bien
// persistés en DB.
//
// Fix : on persiste le rapport en localStorage par mission avec un TTL court
// (5 min). Si l'user revient sur la mission dans la fenêtre, la modale
// reapparaît automatiquement avec le badge ⚡ et le breakdown Go/Maybe/Skip.
// Au-delà de 5 min, le rapport est considéré périmé et n'est plus auto-affiché
// (l'user doit relancer un scoring pour avoir un nouveau rapport).

const BATCH_REPORT_TTL_MS = 5 * 60 * 1000;

function batchReportStorageKey(jobId: string | null | undefined): string | null {
  return jobId ? `konekt_batch_report_${jobId}` : null;
}

interface PersistedBatchReport {
  report: BatchReportEntry[];
  stats: BatchScoringStats | null;
  durationMs: number | undefined;
  savedAt: number;
}

function readPersistedBatchReport(jobId: string | null | undefined): PersistedBatchReport | null {
  const key = batchReportStorageKey(jobId);
  if (!key) return null;
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedBatchReport;
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > BATCH_REPORT_TTL_MS) {
      localStorage.removeItem(key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writePersistedBatchReport(
  jobId: string | null | undefined,
  data: { report: BatchReportEntry[]; stats: BatchScoringStats | null; durationMs: number | undefined }
): void {
  const key = batchReportStorageKey(jobId);
  if (!key) return;
  try {
    localStorage.setItem(
      key,
      JSON.stringify({ ...data, savedAt: Date.now() } satisfies PersistedBatchReport)
    );
  } catch {
    // Quota exceeded ou autre — on ne bloque pas le scoring
  }
}

function clearPersistedBatchReport(jobId: string | null | undefined): void {
  const key = batchReportStorageKey(jobId);
  if (!key) return;
  try { localStorage.removeItem(key); } catch { /* noop */ }
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
  setStatusFilter,
  autoHideTreatedRef,
  candidateStatus,
  customScoringInstructions,
  accountId,
  scoringModel,
  scoringDisabledReason,
  skipBriefCheck,
}: ScoringOptions) {
  // Hydrate from localStorage on mount — survives mobile remounts during scoring
  const initialPersisted = readPersistedBatchReport(selectedJob?.id);
  const [batchStats, setBatchStats] = useState<BatchScoringStats | null>(initialPersisted?.stats ?? null);
  const [batchReport, setBatchReport] = useState<BatchReportEntry[]>(initialPersisted?.report ?? []);
  const [batchDurationMs, setBatchDurationMs] = useState<number | undefined>(initialPersisted?.durationMs);

  // Re-hydrate when the active mission changes (selectedJob.id change)
  useEffect(() => {
    const persisted = readPersistedBatchReport(selectedJob?.id);
    setBatchReport(persisted?.report ?? []);
    setBatchStats(persisted?.stats ?? null);
    setBatchDurationMs(persisted?.durationMs);
  }, [selectedJob?.id]);

  // Auto-restore au focus du tab : si l'user revient sur Konekt après avoir
  // switch d'app pendant un scoring (cas mobile fréquent où le browser purge
  // le state React mais le localStorage survit), on détecte le mismatch
  // (localStorage rempli, state vide) et on restaure → la modale "Scoring
  // terminé" réapparaît automatiquement au retour de l'user.
  useEffect(() => {
    const restoreOnFocus = () => {
      // Skip si la modale est déjà ouverte (state non vide)
      if (batchReport.length > 0) return;
      const persisted = readPersistedBatchReport(selectedJob?.id);
      if (persisted?.report?.length && persisted.report.length > 0) {
        console.info('[scoring] Auto-restore batch report from localStorage on focus', {
          jobId: selectedJob?.id,
          entries: persisted.report.length,
          ageMs: Date.now() - persisted.savedAt,
        });
        setBatchReport(persisted.report);
        setBatchStats(persisted.stats);
        setBatchDurationMs(persisted.durationMs);
      }
    };
    // Déclenche au focus (retour sur tab) ET à la visibility change (Chrome mobile)
    window.addEventListener('focus', restoreOnFocus);
    document.addEventListener('visibilitychange', restoreOnFocus);
    return () => {
      window.removeEventListener('focus', restoreOnFocus);
      document.removeEventListener('visibilitychange', restoreOnFocus);
    };
  }, [selectedJob?.id, batchReport.length]);

  // Score a single profile.
  // options.deep : scoring profond — le profil passé contient les données
  // complètes (visite du profil dans l'app via get_profile). Bypass le cache
  // serveur, résultat marqué scoringDepth='deep'. Déclenché par le bouton
  // "Analyse complète" de la fiche (action volontaire → erreurs affichées,
  // comme le scoring standard ; avant, l'auto-déclenchement à l'ouverture
  // imposait des erreurs silencieuses).
  const scoreProfile = useCallback(async (profile: LinkedInProfile, options?: { deep?: boolean }) => {
    if (!selectedJob) {
      toast.error('Sélectionnez un poste pour le scoring');
      return;
    }
    if (scoringDisabledReason) {
      toast.error(scoringDisabledReason);
      return;
    }

    try {
      // Base Konekt : hydrate la fiche complète (collect) avant scoring. No-op LinkedIn.
      const hydratedProfile = await hydrateIfDatabase(profile);
      const profileData = buildProfileData(hydratedProfile);

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
          originalBriefText: (selectedJob as any).originalBriefText,
          transversalCriteria: selectedJob.transversalCriteria,
          // ─── Sprint D : enrichissements brief structurés ─────────────
          evaluationCriteria: (selectedJob as any).evaluationCriteria,
          evaluationWeights: (selectedJob as any).evaluationWeights,
          targetCompanies: (selectedJob as any).targetCompanies,
          calibrationProfiles: (selectedJob as any).calibrationProfiles,
          skillsToAvoid: (selectedJob as any).skillsToAvoid,
          requiredLanguages: (selectedJob as any).requiredLanguages,
          requiredCertifications: (selectedJob as any).requiredCertifications,
          urgency: (selectedJob as any).urgency,
          teamSize: (selectedJob as any).teamSize,
          reportsTo: (selectedJob as any).reportsTo,
          manages: (selectedJob as any).manages,
          pedigreeRequirements: (selectedJob as any).pedigreeRequirements,
          pedigreePresetName: (selectedJob as any).pedigreePresetName,
          clientCompetitors: (selectedJob as any).clientCompetitors,
          restrictSearchToCompetitors: (selectedJob as any).restrictSearchToCompetitors,
        },
        customScoringInstructions,
        accountId: accountId || undefined,
        scoringMode: options?.deep ? 'deep' : undefined,
      }, { modelOverride: scoringModel || undefined });

      if (error) throw error;
      if (data?.result) {
        const mapped = mapScoringResult(data.result);
        setJobScores(prev => ({ ...prev, [profile.id]: mapped }));
        
        const profileName = profile.name || `${profile.first_name || ''} ${profile.last_name || ''}`.trim();
        const profileUrl = profile.public_profile_url || profile.profile_url || (profile as any)?.linkedin_url;

        // Serialize full LinkedIn profile for storage
        const linkedinProfileData = serializeProfileForStorage(profile);

        // Auto-dismiss profiles with 'skip' recommendation.
        // Pas en mode deep : l'user est en train de REGARDER le profil dans la
        // fiche — l'écarter sous ses yeux serait brutal. On enregistre le score
        // (branche saveScore) et il tranche lui-même.
        if (!options?.deep && mapped.recommendation === 'skip' && candidateStatus) {
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
  }, [selectedJob, setJobScores, candidateStatus, setSelectedProfiles, customScoringInstructions, accountId, scoringModel, scoringDisabledReason]);

  // Batch score selected profiles
  const handleBatchScore = useCallback(async () => {
    if (!selectedJob) {
      toast.error('Sélectionnez un poste pour le scoring');
      return;
    }
    if (scoringDisabledReason) {
      toast.error(scoringDisabledReason);
      return;
    }

    if (selectedProfiles.size === 0) {
      toast.error('Sélectionnez au moins un profil');
      return;
    }

    // ── PRÉ-CHECK 1 : brief complet ?
    // Sans skills_must_have ni description, le scoring n'a pas de quoi
    // évaluer la pertinence. On bloque pour éviter des scores hauts non
    // fondés.
    const hasMustHave = !!(selectedJob.mustHave && selectedJob.mustHave.trim().length > 0);
    const hasSkills = Array.isArray(selectedJob.skills) && selectedJob.skills.length > 0;
    const hasDescription = !!(selectedJob.description && selectedJob.description.trim().length >= 30);
    const isMissionJob = typeof selectedJob.id === 'string' && selectedJob.id.startsWith('project:');
    if (!skipBriefCheck && isMissionJob && !hasMustHave && !hasSkills && !hasDescription) {
      toast.error('Brief incomplet', {
        description: 'Renseigne au moins les compétences must-have ou la description de la mission avant de lancer le scoring — sinon les scores ne seront pas pertinents.',
        duration: 8000,
      });
      return;
    }

    // ── PRÉ-CHECK 2 : taille du batch raisonnable
    // Au-delà de 25 profils, le batch prend 1-3 minutes (10 profils/call,
    // 3 calls en parallèle, ~20s/call). On confirme avec l'user via AlertDialog.
    // Note : ce path n'envoie RIEN à Unipile/LinkedIn — uniquement à Claude (LLM).
    // Les données profil sont déjà en mémoire (issues de la recherche LinkedIn
    // initiale). La limite sert juste à protéger l'user d'un long wait + coût crédits.
    const SAFE_BATCH_SIZE = 25;
    if (selectedProfiles.size > SAFE_BATCH_SIZE) {
      const eta = Math.ceil(selectedProfiles.size / 25) * 60; // ~1min par tranche de 25
      const etaLabel = eta < 60 ? `${eta} secondes` : `${Math.ceil(eta / 60)} minutes`;
      const ok = await confirmAlert({
        title: `Scorer ${selectedProfiles.size} profils en une fois ?`,
        description:
          `Temps estimé : ~${etaLabel}\n`
          + `Crédits IA consommés : ~${selectedProfiles.size}`,
        confirmLabel: 'Lancer le scoring',
      });
      if (!ok) return;
    }

    setScoringInProgress(true);

    // 🐛 BUG FIX Opus A1 (race scoring cross-projet) : capture l'ID du job au
    // lancement. Si l'user change de projet pendant que les batches tournent
    // (Promise.allSettled en parallèle), on refuse d'écrire les scores sur le
    // nouveau projet. Avant : setJobScores mettait les scores dans la map du
    // nouveau projet → faux positifs visuels silencieux.
    const initialJobId = selectedJob.id;

    // Use merged results (including pool profiles) if available, otherwise fall back to search results
    const allProfiles = allAvailableProfilesRef?.current || results;
    // Exclude profiles that already have a score to avoid re-scoring — SAUF
    // les scores dégradés (passe IA échouée, skippedLLM) : sans cette
    // exception, un score partiel restait définitif puisque rien ne le
    // re-scorait jamais (l'edge function ne cache plus ces résultats).
    const profilesToScore = allProfiles.filter(p =>
      selectedProfiles.has(p.id) && (!jobScores[p.id] || isDegradedScore(jobScores[p.id]))
    );

    if (profilesToScore.length === 0) {
      toast.info('Tous les profils sélectionnés sont déjà scorés');
      setScoringInProgress(false);
      return;
    }

    // Batch settings — now with parallelization
    const BATCH_SIZE = 10;
    const PARALLEL_BATCHES = 3;

    try {
      // Base Konekt : hydrate les fiches complètes (collect) avant scoring. No-op LinkedIn.
      const hydratedProfiles = await Promise.all(profilesToScore.map(hydrateIfDatabase));
      const profilesData = hydratedProfiles.map(buildProfileData);
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
        // originalBriefText oublié dans le batch jobPayload — fix : transmis aussi
        originalBriefText: (selectedJob as any).originalBriefText,
        transversalCriteria: selectedJob.transversalCriteria,
        // ─── Sprint D : enrichissements brief structurés ─────────────
        evaluationCriteria: (selectedJob as any).evaluationCriteria,
        evaluationWeights: (selectedJob as any).evaluationWeights,
        targetCompanies: (selectedJob as any).targetCompanies,
        calibrationProfiles: (selectedJob as any).calibrationProfiles,
        skillsToAvoid: (selectedJob as any).skillsToAvoid,
        requiredLanguages: (selectedJob as any).requiredLanguages,
        requiredCertifications: (selectedJob as any).requiredCertifications,
        urgency: (selectedJob as any).urgency,
        teamSize: (selectedJob as any).teamSize,
        reportsTo: (selectedJob as any).reportsTo,
        manages: (selectedJob as any).manages,
        pedigreeRequirements: (selectedJob as any).pedigreeRequirements,
        pedigreePresetName: (selectedJob as any).pedigreePresetName,
        clientCompetitors: (selectedJob as any).clientCompetitors,
        restrictSearchToCompetitors: (selectedJob as any).restrictSearchToCompetitors,
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
            }, { modelOverride: scoringModel || undefined })
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
                // Marque le placeholder comme dégradé : badge "Analyse IA
                // incomplète" + re-scorable (sinon le guard batch le figeait).
                skippedLLM: true,
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
              escalated: (aggregatedStats?.escalated || 0) + (stats.escalated || 0),
              escalationModel: stats.escalationModel ?? aggregatedStats?.escalationModel ?? null,
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

        // 🐛 BUG FIX Opus A1 (race scoring cross-projet) : abort si l'user a changé
        // de projet pendant le scoring — on ne veut pas écrire les scores du job A
        // dans la map du job B actuellement sélectionné.
        if (selectedJob?.id !== initialJobId) {
          console.warn('[useLinkedInScoring] Projet changé pendant scoring, résultats ignorés', {
            initialJobId,
            currentJobId: selectedJob?.id,
          });
          toast.info('Scoring annulé : vous avez changé de projet.');
          return;
        }

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

        // Auto-switch vers les pertinents si on en a — évite que l'user voie
        // une liste vide ("Aucun profil trouvé") quand le filtre par défaut
        // cache les profils traités. Si pas de Go mais des Maybe, on switch
        // sur Maybe. Si tout est dismissed → reste sur le filtre actuel
        // (l'user verra Pipeline ou utilisera le filtre Dismissed).
        if (setStatusFilter && goodCount > 0) {
          const hasGo = goodScoreProfiles.some(p => p.recommendation === 'go');
          const hasMaybe = goodScoreProfiles.some(p => p.recommendation === 'maybe');
          if (hasGo) setStatusFilter('scored_go');
          else if (hasMaybe) setStatusFilter('scored_maybe');
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

        // Persist le rapport en localStorage AVANT d'éventuels remounts mobile.
        // Ainsi si le browser purge l'onglet, le rapport revient à l'hydratation.
        writePersistedBatchReport(selectedJob?.id, {
          report: reportEntries,
          stats: aggregatedStats,
          durationMs: Date.now() - batchStartTime,
        });
      }
    } catch (err) {
      console.error('Batch score error:', err);
      toast.error('Erreur lors du scoring par lot');
    } finally {
      setScoringInProgress(false);
    }
  }, [selectedJob, selectedProfiles, results, allAvailableProfilesRef, autoHideTreatedRef, candidateStatus, setJobScores, setScoringInProgress, setSortByScore, setResults, setSelectedProfiles, setStatusFilter, customScoringInstructions, accountId, scoringModel, scoringDisabledReason, skipBriefCheck]);

  const clearBatchReport = useCallback(() => {
    setBatchReport([]);
    setBatchStats(null);
    setBatchDurationMs(undefined);
    // Clear également le localStorage pour que la modale ne réapparaisse pas
    // si l'user navigue entre missions et revient sur celle-ci.
    clearPersistedBatchReport(selectedJob?.id);
  }, [selectedJob?.id]);

  return {
    scoreProfile,
    handleBatchScore,
    batchStats,
    batchReport,
    batchDurationMs,
    clearBatchReport,
  };
}

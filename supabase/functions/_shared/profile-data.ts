// ============================================================================
// profile-data.ts — mapping LinkedInProfile (snake_case, tel que stocké dans
// job_candidate_status.linkedin_profile_data) → ProfileData (camelCase attendu
// par score-profile-job). (P5 agent de fond, 2026-07-15)
// ============================================================================
// Port fidèle Deno de src/hooks/useLinkedInScoring.ts::buildProfileData (+ les
// helpers parseDate/getYear de src/components/outreach/dateUtils.ts). Le worker
// process-agent-tasks énumère les profils DÉJÀ stockés en base et doit produire
// EXACTEMENT le même ProfileData que le frontend, sinon les scores de fond
// divergeraient de ceux du premier plan (champs dérivés yearsOfExperience /
// averageTenureMonths absents → pénalité "données incomplètes").
//
// ⚠️ Toute évolution de buildProfileData côté frontend doit être répercutée ici
// (les deux runtimes — navigateur / Deno edge — ne partagent pas de module).
// ============================================================================

// deno-lint-ignore no-explicit-any
type Any = any;

/** Parse un champ date Unipile ("2019-01", "2019", { year, month }). */
export function parseDate(
  value: string | { year?: number; month?: number } | null | undefined,
): { year: number; month?: number } | null {
  if (!value) return null;
  if (typeof value === "object") {
    if (value.year) return { year: value.year, month: value.month };
    return null;
  }
  if (typeof value === "string") {
    const parts = value.split("-");
    const year = parseInt(parts[0], 10);
    if (isNaN(year) || year < 1900) return null;
    const month = parts[1] ? parseInt(parts[1], 10) : undefined;
    return { year, month: month && !isNaN(month) ? month : undefined };
  }
  return null;
}

/** Raccourci : année seule d'un champ date Unipile. */
export function getYear(
  value: string | { year?: number; month?: number } | null | undefined,
): number | undefined {
  return parseDate(value)?.year;
}

/**
 * Convertit un LinkedInProfile brut (snake_case) en ProfileData (camelCase)
 * consommé par score-profile-job. Réplique verbatim la logique frontend.
 */
export function buildProfileData(profile: Any): Any {
  // Merge work_experience avec current_positions/past_positions en fallback
  let workExperience: Any[] = profile.work_experience || [];
  if (workExperience.length === 0) {
    const currentPositions = (profile.current_positions || []).map((p: Any) => ({ ...p, current: true }));
    const pastPositions = (profile.past_positions || []).map((p: Any) => ({ ...p, current: false }));
    workExperience = [...currentPositions, ...pastPositions];
  }
  const currentJob = workExperience.find((exp: Any) => !exp.end || exp.current) || workExperience[0];
  const pastJobs = workExperience.filter((exp: Any) => exp.end && !exp.current).slice(0, 5);
  const education: Any[] = profile.education || [];

  const calculateYearsFromDiploma = (): number | null => {
    const relevantDegreeKeywords = [
      "bachelor", "licence", "bac+3",
      "master", "msc", "bac+5", "maîtrise",
      "mba", "ingénieur", "engineer", "engineering",
      "phd", "doctorat", "bac+8",
      "diplôme", "degree", "graduate", "grande école",
    ];
    const relevantEdu = education
      .filter((edu: Any) => {
        if (!getYear(edu.end)) return false;
        const combined = `${edu.degree || ""} ${edu.school || ""} ${edu.field_of_study || ""}`.toLowerCase();
        return relevantDegreeKeywords.some((kw) => combined.includes(kw));
      })
      .sort((a: Any, b: Any) => (getYear(b.end) || 0) - (getYear(a.end) || 0));

    const diplomaToUse = relevantEdu[0] ||
      education.filter((edu: Any) => getYear(edu.end)).sort((a: Any, b: Any) => (getYear(b.end) || 0) - (getYear(a.end) || 0))[0];

    if (diplomaToUse) {
      const endYear = getYear(diplomaToUse.end);
      if (endYear) {
        const years = new Date().getFullYear() - endYear;
        if (years > 0) return years;
      }
    }

    let earliestYear: number | null = null;
    for (const exp of workExperience) {
      const startYear = getYear(exp.start);
      if (startYear && startYear > 1970) {
        if (!earliestYear || startYear < earliestYear) earliestYear = startYear;
      }
    }
    if (earliestYear) {
      const years = new Date().getFullYear() - earliestYear;
      return years > 0 ? years : null;
    }
    return null;
  };

  const calculateDurationMonths = (startRaw?: Any, endRaw?: Any): number => {
    const start = parseDate(startRaw);
    const end = parseDate(endRaw);
    if (!start?.year) return 0;
    const endYear = end?.year || new Date().getFullYear();
    const endMonth = end?.month || new Date().getMonth() + 1;
    const startYear = start.year;
    const startMonth = start.month || 1;
    return (endYear - startYear) * 12 + (endMonth - startMonth);
  };

  const formatDuration = (totalMonths: number): string => {
    const years = Math.floor(totalMonths / 12);
    const months = totalMonths % 12;
    if (years === 0) return `${months} mois`;
    if (months === 0) return `${years} an${years > 1 ? "s" : ""}`;
    return `${years} an${years > 1 ? "s" : ""} ${months} mois`;
  };

  const calculateAverageTenure = (): number | null => {
    const positionsWithDates = workExperience.filter((exp: Any) => getYear(exp.start));
    if (positionsWithDates.length === 0) return null;
    const tenures = positionsWithDates.map((exp: Any) => calculateDurationMonths(exp.start, exp.end));
    const totalMonths = tenures.reduce((sum: number, t: number) => sum + t, 0);
    return Math.round(totalMonths / positionsWithDates.length);
  };

  const enrichedWorkExperience = workExperience.map((exp: Any) => {
    const durationMonths = calculateDurationMonths(exp.start, exp.end);
    return {
      role: exp.role || exp.position || "",
      company: exp.company || "",
      duration: durationMonths > 0 ? formatDuration(durationMonths) : undefined,
      durationMonths,
      description: exp.description?.slice(0, 500) || undefined,
      skills: exp.skills?.slice(0, 8).map((s: Any) => s.name || String(s)) || undefined,
    };
  });

  const isOpenToWork = profile.open_to_work === true || profile.is_open_to_work === true;
  const isOpenProfile = profile.open_profile === true || profile.is_open_profile === true;
  const networkDistance = typeof profile.network_distance === "number"
    ? profile.network_distance
    : parseInt(
      String(profile.network_distance)
        .replace("DISTANCE_", "")
        .replace("FIRST_DEGREE", "1")
        .replace("SECOND_DEGREE", "2")
        .replace("THIRD_DEGREE", "3"),
      10,
    ) || null;

  return {
    id: profile.id || profile.provider_id || profile.public_identifier || profile.member_urn ||
      `${profile.first_name}_${profile.last_name}`.toLowerCase(),
    name: profile.name || `${profile.first_name || ""} ${profile.last_name || ""}`.trim(),
    headline: profile.headline,
    currentRole: currentJob?.role || currentJob?.position,
    currentCompany: currentJob?.company,
    location: profile.location,
    skills: profile.skills?.map((s: Any) => s.name || s).slice(0, 15) || [],
    skillsWithEndorsements: profile.skills?.slice(0, 15).map((s: Any) => ({
      name: typeof s === "string" ? s : s.name,
      endorsements: typeof s === "object" ? s.endorsement_count : undefined,
    })).filter((s: { name: string }) => s.name) || undefined,
    summary: profile.summary?.slice(0, 700) || undefined,
    workExperience: enrichedWorkExperience.length > 0 ? enrichedWorkExperience : undefined,
    pastPositions: pastJobs.map((p: Any) => `${p.role || p.position} chez ${p.company}`),
    education: education.map((e: Any) => {
      const school = e.school || e.school_details?.name || "";
      const degree = e.degree || "";
      const field = e.field_of_study || "";
      const endYear = getYear(e.end);
      const year = endYear ? ` (${endYear})` : "";
      return [school, degree, field].filter(Boolean).join(" - ") + year;
    }).filter((s: string) => s.trim().length > 0) || [],
    yearsOfExperience: calculateYearsFromDiploma(),
    averageTenureMonths: calculateAverageTenure(),
    openToWork: isOpenToWork,
    openProfile: isOpenProfile,
    networkDistance,
    profileUrl: profile.public_profile_url || profile.profile_url || undefined,
    providerId: profile.provider_id || profile.public_identifier || undefined,
    noAiScoring: profile.no_ai_scoring === true || undefined,
    recommendations: profile.recommendations?.received?.slice(0, 4).map((r: Any) => ({
      text: r.text || r.caption || "",
      author: r.actor ? `${r.actor.first_name || ""} ${r.actor.last_name || ""}`.trim() : undefined,
      authorHeadline: r.actor?.headline,
    })).filter((r: { text: string }) => r.text && r.text.length > 20) || undefined,
    recentPosts: profile.recent_posts?.slice(0, 5).map((p: Any) => ({
      text: p.text?.slice(0, 180),
      title: p.title?.slice(0, 100),
      date: p.date,
      reactions: p.reaction_counter,
    })).filter((p: { text?: string; title?: string }) => p.text || p.title) || undefined,
    projects: profile.projects?.slice(0, 5).map((p: Any) => ({
      name: p.name,
      description: p.description?.slice(0, 120),
      skills: p.skills?.slice(0, 5),
    })).filter((p: { name?: string }) => p.name) || undefined,
    certifications: profile.certifications?.slice(0, 8).map((c: Any) => ({
      name: c.name,
      organization: c.organization,
    })).filter((c: { name?: string }) => c.name) || undefined,
    volunteering: profile.volunteering_experience?.slice(0, 3).map((v: Any) => ({
      role: v.role,
      company: v.company,
      description: v.description?.slice(0, 100),
    })).filter((v: { role?: string; company?: string }) => v.role || v.company) || undefined,
    languages: profile.languages?.map((l: Any) => ({
      name: l.name,
      proficiency: l.proficiency,
    })).filter((l: { name?: string }) => l.name) || undefined,
    interests: profile.interests?.slice(0, 10) || profile.hashtags?.slice(0, 10) || undefined,
    connectionsCount: profile.connections_count,
    followersCount: profile.followers_count,
    sharedConnectionsCount: profile.shared_connections_count,
    recentlyHired: profile.recently_hired,
    mentionedInNews: profile.mentioned_in_the_news,
    isCreator: profile.is_creator || profile.is_influencer,
    isHiring: profile.is_hiring,
  };
}

/**
 * Construit le payload "job" pour score-profile-job à partir du brief
 * (sourcing_projects.job_details). Port de useLinkedInSearch::buildJobFromBrief.
 *
 * Différence assumée vs frontend : le bloc `clientCompetitors` (signal positif
 * bonus) n'est pas inclus — il dépend d'un état front-only (enabledCompetitors)
 * et son absence ne déclenche aucune pénalité de scoring.
 *
 * @param jd    job_details de la mission (peut être {} )
 * @param base  { id, title, client?, description? } de base
 */
export function buildJobFromBrief(jd: Any, base: Record<string, Any>): Record<string, Any> {
  jd = jd || {};
  const job: Record<string, Any> = { ...base };

  job.skills = [...(jd.skills_must_have || []), ...(jd.skills_should_have || [])];
  const descParts = [jd.mission_description, jd.context].filter(Boolean);
  if (descParts.length) job.description = descParts.join("\n\n");
  if (jd.skills_must_have?.length) job.mustHave = jd.skills_must_have.join(", ");
  if (jd.skills_should_have?.length) job.shouldHave = jd.skills_should_have.join(", ");
  if (jd.skills_nice_to_have?.length) job.niceToHave = jd.skills_nice_to_have.join(", ");
  if (jd.seniority) job.seniority = jd.seniority;
  if (jd.location) job.location = jd.location;
  if (jd.experience_min != null) job.xpMin = jd.experience_min;
  if (jd.experience_max != null) job.xpMax = jd.experience_max;
  if (jd.remote_policy) job.remote = jd.remote_policy;
  if (jd.contract_type) job.contractType = jd.contract_type;
  if (jd.salary_min != null) job.salaryMin = jd.salary_min;
  if (jd.salary_max != null) job.salaryMax = jd.salary_max;
  if (jd.salary_type === "daily" && jd.salary_min != null) job.tjmMin = jd.salary_min;

  const reqParts: string[] = [];
  if (jd.certifications?.length) reqParts.push(`Certifications requises : ${jd.certifications.join(", ")}`);
  if (jd.languages?.length) {
    reqParts.push(`Langues : ${jd.languages.map((l: Any) => `${l.language} (${l.level})`).join(", ")}`);
  }
  if (reqParts.length) job.requirements = reqParts.join(". ");

  if (jd.evaluation_criteria?.length && Array.isArray(jd.evaluation_criteria)) {
    const criteriaText = jd.evaluation_criteria
      .filter((c: Any) => c && c.label)
      .slice(0, 15)
      .map((c: Any) =>
        `[${c.category || "?"}${c.deal_breaker ? " DEAL-BREAKER" : ""} poids:${c.weight || 1}] ${c.label}: ${(c.description || "").slice(0, 150)}${c.level_10 ? ` (10/10: ${c.level_10.slice(0, 80)})` : ""}${c.level_1 ? ` (rédhibitoire: ${c.level_1.slice(0, 80)})` : ""}`
      )
      .join("\n");
    job.bodyContent = (job.bodyContent ? job.bodyContent + "\n\n" : "") +
      `=== CRITÈRES D'ÉVALUATION DU MANAGER ===\n${criteriaText}`;
  }
  if (jd.raw_brief) job.originalBriefText = jd.raw_brief.slice(0, 4000);
  if (job.bodyContent && job.bodyContent.length > 3000) job.bodyContent = job.bodyContent.slice(0, 3000);

  if (jd.target_companies?.length) {
    const companies = jd.target_companies.flatMap((cat: Any) => cat.companies?.map((c: Any) => c.name) || []).filter(Boolean);
    if (companies.length && !job.transversalCriteria) {
      job.transversalCriteria = { context: `Entreprises cibles / feeders : ${companies.join(", ")}` };
    }
  }
  if (jd.evaluation_criteria?.length) {
    job.evaluationCriteria = jd.evaluation_criteria.slice(0, 12).map((c: Any) => ({
      label: c.label,
      description: c.description,
      category: c.category,
      weight: c.weight,
      dealBreaker: !!c.deal_breaker,
      level10: c.level_10,
      level1: c.level_1,
      interviewStage: c.interview_stage,
    }));
  }
  if (jd.evaluation_weights) job.evaluationWeights = jd.evaluation_weights;
  if (jd.target_companies?.length) {
    job.targetCompanies = jd.target_companies.slice(0, 6).map((cat: Any) => ({
      category: cat.category,
      companies: (cat.companies || []).slice(0, 8).map((c: Any) => c.name).filter(Boolean),
    }));
  }
  if (jd.calibration_profiles?.length) {
    job.calibrationProfiles = jd.calibration_profiles.slice(0, 5).map((p: Any) => ({
      name: p.name,
      headline: p.headline,
      linkedinUrl: p.linkedin_url,
      whyGoodFit: p.why_good_fit,
      areasOfImprovement: p.areas_of_improvement,
    }));
  }
  if (jd.skills_to_avoid?.length) job.skillsToAvoid = jd.skills_to_avoid;
  if (jd.languages?.length) {
    job.requiredLanguages = jd.languages.map((l: Any) => ({ language: l.language, level: l.level }));
  }
  if (jd.certifications?.length) job.requiredCertifications = jd.certifications;
  if (jd.client?.size || jd.client?.culture_notes) {
    const existingClient = job.client || (jd.client?.name ? { name: jd.client.name, sector: jd.client.sector } : null);
    if (existingClient) {
      job.client = { ...existingClient, size: jd.client?.size, cultureNotes: jd.client?.culture_notes };
    }
  }
  if (jd.urgency) job.urgency = jd.urgency;
  if (jd.team_size) job.teamSize = jd.team_size;
  if (jd.reports_to) job.reportsTo = jd.reports_to;
  if (jd.manages) job.manages = jd.manages;
  if (jd.pedigree_requirements) job.pedigreeRequirements = jd.pedigree_requirements;
  if (jd.pedigree_preset_name) job.pedigreePresetName = jd.pedigree_preset_name;

  return job;
}

// supabase/functions/_shared/rag-adapters.ts
// Adaptateurs RAG — transforment les données brutes en chunks standardisés
// pour le Knowledge Lake (table knowledge_chunks).

// ─── Types ───────────────────────────────────────────────────────

export interface Chunk {
  chunk_type: string;
  content: string;
  source_table?: string;
  source_id?: string;
  metadata?: Record<string, any>;
  expires_at?: string;
}

// ─── Helpers ─────────────────────────────────────────────────────

function truncate(text: string | null | undefined, max: number): string {
  if (!text) return "";
  const s = String(text).trim();
  if (s.length <= max) return s;
  return s.substring(0, max).trimEnd() + "…";
}

function safeDate(raw: any): string {
  if (!raw) return "";
  try {
    const d = new Date(raw);
    if (isNaN(d.getTime())) return String(raw);
    return d.toISOString().split("T")[0]; // YYYY-MM-DD
  } catch {
    return String(raw);
  }
}

function isoExpiry(baseDate: any, days: number): string | undefined {
  if (!baseDate) return undefined;
  try {
    const d = new Date(baseDate);
    if (isNaN(d.getTime())) return undefined;
    d.setDate(d.getDate() + days);
    return d.toISOString();
  } catch {
    return undefined;
  }
}

// ─── 1. adaptLinkedInProfile ─────────────────────────────────────

export function adaptLinkedInProfile(profileData: any): Chunk[] {
  if (!profileData) return [];
  const chunks: Chunk[] = [];

  // — Chunk "profile" (résumé du profil) —
  const name = profileData.name || profileData.full_name || profileData.first_name
    ? `${profileData.first_name ?? ""} ${profileData.last_name ?? ""}`.trim()
    : "";
  const headline = profileData.headline || profileData.title || "";
  const currentRole = profileData.current_role || profileData.occupation || headline;
  const currentCompany = profileData.current_company
    || profileData.company
    || (profileData.experiences?.[0]?.company ?? "");
  const location = profileData.location || profileData.city || "";

  // Estimation années d'expérience
  const yearsXp = profileData.years_xp
    ?? profileData.years_of_experience
    ?? (profileData.experiences ? profileData.experiences.length : null);

  // Skills (top 15)
  const rawSkills: any[] = profileData.skills || profileData.top_skills || [];
  const skills = rawSkills
    .slice(0, 15)
    .map((s: any) => (typeof s === "string" ? s : s?.name || s?.skill || ""))
    .filter(Boolean);

  const profileLines: string[] = [];
  if (name) profileLines.push(`Nom : ${name}`);
  if (headline) profileLines.push(`Titre : ${headline}`);
  if (currentRole) profileLines.push(`Poste actuel : ${currentRole}`);
  if (currentCompany) profileLines.push(`Entreprise : ${currentCompany}`);
  if (location) profileLines.push(`Localisation : ${location}`);
  if (yearsXp != null) profileLines.push(`Années d'expérience : ${yearsXp}`);
  if (skills.length) profileLines.push(`Compétences : ${skills.join(", ")}`);

  if (profileLines.length) {
    chunks.push({
      chunk_type: "profile",
      content: profileLines.join("\n"),
      source_table: "linkedin_profile",
      metadata: { name, headline, current_role: currentRole, current_company: currentCompany, location, years_xp: yearsXp, skills },
    });
  }

  // — Chunk "about" —
  const about = profileData.about || profileData.summary || profileData.description || "";
  if (about) {
    chunks.push({
      chunk_type: "about",
      content: truncate(about, 800),
      source_table: "linkedin_profile",
      metadata: { section: "about" },
    });
  }

  // — Chunks "experience" (max 5) —
  const experiences: any[] = profileData.experiences || profileData.positions || [];
  for (const exp of experiences.slice(0, 5)) {
    const title = exp.title || exp.role || "";
    const company = exp.company || exp.company_name || exp.organization || "";
    const description = truncate(exp.description || exp.summary || "", 300);
    const startDate = safeDate(exp.start_date || exp.starts_at || exp.from);
    const endDate = exp.end_date || exp.ends_at || exp.to ? safeDate(exp.end_date || exp.ends_at || exp.to) : "présent";

    const lines: string[] = [];
    if (title) lines.push(`Poste : ${title}`);
    if (company) lines.push(`Entreprise : ${company}`);
    if (startDate) lines.push(`Période : ${startDate} → ${endDate}`);
    if (description) lines.push(`Description : ${description}`);

    if (lines.length) {
      chunks.push({
        chunk_type: "experience",
        content: lines.join("\n"),
        source_table: "linkedin_profile",
        metadata: { title, company, start_date: startDate, end_date: endDate },
      });
    }
  }

  return chunks;
}

// ─── 2. adaptLinkedInPosts ───────────────────────────────────────

export function adaptLinkedInPosts(posts: any[]): Chunk[] {
  if (!Array.isArray(posts) || posts.length === 0) return [];
  const chunks: Chunk[] = [];

  for (const post of posts) {
    const text = truncate(post.text || post.content || post.body || "", 500);
    if (!text) continue;

    const date = safeDate(post.date || post.created_at || post.published_at);
    const reactions = post.reactions_count ?? post.likes_count ?? post.reactions ?? 0;

    chunks.push({
      chunk_type: "post",
      content: text,
      source_table: "linkedin_posts",
      metadata: { date, reactions, source: "linkedin" },
      expires_at: isoExpiry(post.date || post.created_at || post.published_at, 90),
    });
  }

  return chunks;
}

// ─── 3. adaptConversationMessages ────────────────────────────────

export function adaptConversationMessages(messages: any[], candidateId: string): Chunk[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];

  const last10 = messages.slice(-10);

  const parts = last10.map((msg) => {
    const role = msg.is_sender || msg.direction === "outgoing" || msg.from === "recruiter"
      ? "Recruteur"
      : "Candidat";
    const text = truncate(msg.text || msg.body || msg.content || "", 300);
    return `${role}: ${text}`;
  });

  const content = parts.join(" | ");
  if (!content) return [];

  const lastDate = safeDate(
    last10[last10.length - 1]?.date
    || last10[last10.length - 1]?.created_at
    || last10[last10.length - 1]?.timestamp
  );

  const channel: string =
    last10[0]?.channel
    || last10[0]?.provider
    || last10[0]?.source
    || "linkedin";

  return [{
    chunk_type: "conversation",
    content,
    source_table: "conversation_messages",
    source_id: candidateId,
    metadata: {
      last_message_date: lastDate,
      channel,
      message_count: last10.length,
    },
  }];
}

// ─── 4. adaptAirtableHistory ─────────────────────────────────────

export function adaptAirtableHistory(data: {
  shortlists?: any[];
  placements?: any[];
  notes?: any[];
  appointments?: any[];
}): Chunk[] {
  if (!data) return [];
  const chunks: Chunk[] = [];

  // — 1 chunk par note —
  const notes = data.notes || [];
  for (const note of notes) {
    const title = note.title || "Note";
    const detail = truncate(note.detail || note.content || note.description || "", 300);
    const date = safeDate(note.note_date || note.created_at || note.date);
    const consultant = note.author || note.consultant || note.created_by || "";
    const noteType = note.type || note.category || "note";

    chunks.push({
      chunk_type: "note",
      content: `${title}\n${detail}`.trim(),
      source_table: "airtable_notes",
      source_id: note.airtable_id || note.id,
      metadata: { date, consultant, type: noteType },
    });
  }

  // — 1 chunk "evaluation" pour les shortlists + placements —
  const shortlists = data.shortlists || [];
  const placements = data.placements || [];
  const evalLines: string[] = [];

  for (const sl of shortlists) {
    const poste = sl.job_title || sl.job_name || sl.position || "poste inconnu";
    const entreprise = sl.company || sl.client || sl.organization || "entreprise inconnue";
    const date = safeDate(sl.created_at || sl.date || sl.shortlist_date);
    const consultant = sl.consultant || sl.author || sl.created_by || "";
    const status = sl.status || "en cours";
    let line = `Shortlisté pour ${poste} chez ${entreprise}`;
    if (date) line += ` le ${date}`;
    if (consultant) line += ` par ${consultant}`;
    line += `. Statut: ${status}`;
    evalLines.push(line);
  }

  for (const pl of placements) {
    const poste = pl.job_title || pl.job_name || pl.position || "poste inconnu";
    const entreprise = pl.company || pl.client || pl.organization || "entreprise inconnue";
    const date = safeDate(pl.created_at || pl.date || pl.placement_date);
    const status = pl.status || "placé";
    let line = `Placement : ${poste} chez ${entreprise}`;
    if (date) line += ` le ${date}`;
    line += `. Statut: ${status}`;
    evalLines.push(line);
  }

  if (evalLines.length) {
    chunks.push({
      chunk_type: "evaluation",
      content: evalLines.join("\n"),
      source_table: "airtable_shortlists",
      metadata: {
        shortlist_count: shortlists.length,
        placement_count: placements.length,
      },
    });
  }

  return chunks;
}

// ─── 5. adaptCallData ────────────────────────────────────────────

export function adaptCallData(call: any, transcript?: string, report?: any): Chunk[] {
  if (!call) return [];
  const chunks: Chunk[] = [];

  const date = safeDate(call.started_at || call.date || call.created_at);
  const duration = call.duration ?? call.duration_seconds ?? 0;
  const direction = call.direction || "unknown";
  const consultant = call.user_name || call.consultant || call.agent || "";

  const baseMeta = { date, duration, direction, consultant };

  // — Chunk transcript —
  if (transcript) {
    chunks.push({
      chunk_type: "call_transcript",
      content: truncate(transcript, 2000),
      source_table: "call_coaching_sessions",
      source_id: call.id || call.aircall_id,
      metadata: { ...baseMeta },
    });
  }

  // — Chunk rapport / évaluation —
  if (report) {
    const reportLines: string[] = [];

    if (report.summary || report.résumé) {
      reportLines.push(`Résumé : ${report.summary || report.résumé}`);
    }
    if (report.recommendation || report.recommandation) {
      reportLines.push(`Recommandation : ${report.recommendation || report.recommandation}`);
    }
    if (report.strengths || report.points_forts) {
      const items = report.strengths || report.points_forts;
      reportLines.push(`Points forts : ${Array.isArray(items) ? items.join(", ") : items}`);
    }
    if (report.weaknesses || report.points_faibles) {
      const items = report.weaknesses || report.points_faibles;
      reportLines.push(`Points faibles : ${Array.isArray(items) ? items.join(", ") : items}`);
    }
    if (report.score != null || report.note != null) {
      reportLines.push(`Score : ${report.score ?? report.note}`);
    }

    // Fallback : sérialiser les clés restantes
    if (reportLines.length === 0) {
      for (const [key, val] of Object.entries(report)) {
        reportLines.push(`${key} : ${typeof val === "object" ? JSON.stringify(val) : val}`);
      }
    }

    if (reportLines.length) {
      chunks.push({
        chunk_type: "evaluation",
        content: reportLines.join("\n"),
        source_table: "call_coaching_sessions",
        source_id: call.id || call.aircall_id,
        metadata: { ...baseMeta },
      });
    }
  }

  return chunks;
}

// ─── 6. adaptQualificationSession ───────────────────────────────

export function adaptQualificationSession(session: any): Chunk[] {
  if (!session) return [];

  const lines: string[] = [];

  if (session.notes) {
    lines.push(`Notes : ${session.notes}`);
  }
  if (session.verdict) {
    lines.push(`Verdict : ${session.verdict}`);
  }

  // scoring_summary peut être un objet ou une chaîne
  if (session.scoring_summary) {
    if (typeof session.scoring_summary === "string") {
      lines.push(`Scoring : ${session.scoring_summary}`);
    } else {
      const ss = session.scoring_summary;
      if (ss.overall_score != null) lines.push(`Score global : ${ss.overall_score}`);
      if (ss.criteria && Array.isArray(ss.criteria)) {
        for (const c of ss.criteria) {
          lines.push(`  - ${c.name || c.label || "Critère"} : ${c.score ?? c.value ?? "N/A"}${c.comment ? ` (${c.comment})` : ""}`);
        }
      }
      if (ss.recommendation) lines.push(`Recommandation : ${ss.recommendation}`);
      if (ss.summary) lines.push(`Résumé scoring : ${ss.summary}`);
    }
  }

  if (lines.length === 0) return [];

  const date = safeDate(session.created_at || session.date || session.session_date);
  const jobId = session.job_id || "";
  const jobTitle = session.job_title || "";

  return [{
    chunk_type: "evaluation",
    content: lines.join("\n"),
    source_table: "qualification_sessions",
    source_id: session.id,
    metadata: { date, job_id: jobId, job_title: jobTitle, verdict: session.verdict || "" },
  }];
}

// ─── 7. adaptJobContext ──────────────────────────────────────────

export function adaptJobContext(jobData: any, bodyContent?: string): Chunk[] {
  if (!jobData) return [];

  const lines: string[] = [];

  const title = jobData.title || jobData.name || jobData.job_title || "";
  const client = jobData.client || jobData.company || jobData.organization || "";
  const skills = jobData.skills || jobData.required_skills || [];
  const seniority = jobData.seniority || jobData.level || "";
  const remote = jobData.remote ?? jobData.remote_policy ?? "";
  const salary = jobData.salary || jobData.salary_range || "";

  if (title) lines.push(`Poste : ${title}`);
  if (client) lines.push(`Client : ${client}`);
  if (seniority) lines.push(`Séniorité : ${seniority}`);
  if (remote !== "") lines.push(`Télétravail : ${remote}`);
  if (salary) lines.push(`Salaire : ${salary}`);

  if (Array.isArray(skills) && skills.length) {
    lines.push(`Compétences : ${skills.map((s: any) => (typeof s === "string" ? s : s?.name || "")).filter(Boolean).join(", ")}`);
  }

  // Must / Should / Nice to have
  const must = jobData.must_have || jobData.must || [];
  const should = jobData.should_have || jobData.should || [];
  const nice = jobData.nice_to_have || jobData.nice || [];

  if (Array.isArray(must) && must.length) lines.push(`Indispensable : ${must.join(", ")}`);
  if (Array.isArray(should) && should.length) lines.push(`Souhaité : ${should.join(", ")}`);
  if (Array.isArray(nice) && nice.length) lines.push(`Bonus : ${nice.join(", ")}`);

  // Description
  const description = jobData.description || jobData.summary || "";
  if (description) lines.push(`Description : ${truncate(description, 500)}`);

  // Body content additionnel (Notion)
  if (bodyContent) {
    lines.push(`\nDétails supplémentaires :\n${truncate(bodyContent, 800)}`);
  }

  if (lines.length === 0) return [];

  return [{
    chunk_type: "job_context",
    content: lines.join("\n"),
    source_table: "jobs",
    source_id: jobData.id || jobData.job_id,
    metadata: { title, client, seniority, remote, salary },
  }];
}

// ─── 8. adaptSequenceHistory ─────────────────────────────────────

export function adaptSequenceHistory(executions: any[]): Chunk[] {
  if (!Array.isArray(executions) || executions.length === 0) return [];

  const lines: string[] = [];

  for (const exec of executions) {
    const date = safeDate(exec.executed_at || exec.created_at || exec.date);
    const stepType = exec.step_type || exec.type || exec.action || "message";
    const status = exec.status || "";
    const content = truncate(exec.final_message || exec.message || exec.content || "", 150);

    let line = `${stepType}`;
    if (date) line += ` le ${date}`;
    if (status) line += ` (${status})`;
    if (content) line += ` — ${content}`;
    lines.push(line);
  }

  if (lines.length === 0) return [];

  // Récupérer le nom de la séquence depuis le premier élément
  const sequenceName = executions[0]?.sequence_name
    || executions[0]?.sequence?.name
    || "";

  const lastDate = safeDate(
    executions[executions.length - 1]?.executed_at
    || executions[executions.length - 1]?.created_at
  );

  return [{
    chunk_type: "sequence_history",
    content: `Historique de séquence${sequenceName ? ` "${sequenceName}"` : ""} :\n${lines.join("\n")}`,
    source_table: "sequence_step_executions",
    metadata: {
      sequence_name: sequenceName,
      step_count: executions.length,
      last_step_date: lastDate,
    },
  }];
}

// ─── 9. adaptScoringResult ───────────────────────────────────────

export function adaptScoringResult(score: any): Chunk[] {
  if (!score) return [];

  const lines: string[] = [];

  const globalScore = score.score ?? score.overall_score ?? score.total ?? null;
  const recommendation = score.recommendation || score.recommandation || "";

  if (globalScore != null) lines.push(`Score global : ${globalScore}`);
  if (recommendation) lines.push(`Recommandation : ${recommendation}`);

  // Détail par critère
  const criteria: any[] = score.criteria || score.details || score.breakdown || [];
  if (Array.isArray(criteria) && criteria.length) {
    lines.push("Détail par critère :");
    for (const c of criteria) {
      const name = c.name || c.label || c.criterion || "Critère";
      const value = c.score ?? c.value ?? c.rating ?? "N/A";
      const comment = c.comment || c.reason || "";
      lines.push(`  - ${name} : ${value}${comment ? ` — ${comment}` : ""}`);
    }
  }

  // Points manquants
  const missing = score.missing || score.missing_skills || score.gaps || [];
  if (Array.isArray(missing) && missing.length) {
    lines.push(`Points manquants : ${missing.join(", ")}`);
  } else if (typeof missing === "string" && missing) {
    lines.push(`Points manquants : ${missing}`);
  }

  if (lines.length === 0) return [];

  const date = safeDate(score.created_at || score.date || score.scored_at);

  return [{
    chunk_type: "scoring_result",
    content: lines.join("\n"),
    source_table: "scoring_results",
    source_id: score.id,
    metadata: {
      job_id: score.job_id || "",
      score: globalScore,
      date,
    },
  }];
}

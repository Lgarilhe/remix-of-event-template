// supabase/functions/_shared/rag-adapters.ts

// Adaptateurs pour transformer les données brutes en chunks standardisés
// pour le Knowledge Lake (table knowledge_chunks)

export interface Chunk {
  chunk_type: string;
  content: string;
  source_table?: string;
  source_id?: string;
  metadata?: Record<string, any>;
  expires_at?: string;
}

function truncate(str: string | null | undefined, max: number): string {
  if (!str) return '';
  return str.length > max ? str.slice(0, max) + '...' : str;
}

function safeStr(val: any): string {
  if (val === null || val === undefined) return '';
  return String(val);
}

// 1. Profil LinkedIn → chunks profile + about + experience
export function adaptLinkedInProfile(profileData: any): Chunk[] {
  if (!profileData || typeof profileData !== 'object') return [];
  const chunks: Chunk[] = [];

  const name = safeStr(profileData.first_name || profileData.name || '') + ' ' + safeStr(profileData.last_name || '');
  const headline = safeStr(profileData.headline || profileData.occupation || '');
  const location = safeStr(profileData.location || profileData.city || '');
  const skills = Array.isArray(profileData.skills)
    ? profileData.skills.slice(0, 15).map((s: any) => typeof s === 'string' ? s : s.name || '').filter(Boolean).join(', ')
    : '';

  // Chunk profile (résumé)
  const profileLines = [name.trim(), headline, location, skills ? `Compétences : ${skills}` : ''].filter(Boolean);
  if (profileLines.length > 0) {
    chunks.push({ chunk_type: 'profile', content: profileLines.join('\n'), source_table: 'linkedin_profile', metadata: { name: name.trim(), headline, location } });
  }

  // Chunk about
  const about = safeStr(profileData.about || profileData.summary || '');
  if (about.length > 20) {
    chunks.push({ chunk_type: 'about', content: truncate(about, 800), source_table: 'linkedin_profile', metadata: { source: 'linkedin_about' } });
  }

  // Chunks experience (max 5)
  const experiences = profileData.work_experience || profileData.experiences || profileData.positions?.values || [];
  if (Array.isArray(experiences)) {
    experiences.slice(0, 5).forEach((exp: any, i: number) => {
      const title = safeStr(exp.title || exp.role || '');
      const company = safeStr(exp.company_name || exp.company || '');
      const desc = truncate(safeStr(exp.description || ''), 300);
      const startDate = exp.start_date || exp.starts_at || '';
      const endDate = exp.end_date || exp.ends_at || '';
      const dateStr = startDate ? `(${typeof startDate === 'object' ? startDate.year : startDate} - ${endDate ? (typeof endDate === 'object' ? endDate.year : endDate) : 'présent'})` : '';
      
      if (title || company) {
        chunks.push({
          chunk_type: 'experience',
          content: `${title} @ ${company} ${dateStr}\n${desc}`.trim(),
          source_table: 'linkedin_profile',
          source_id: `exp_${i}`,
          metadata: { title, company, index: i },
        });
      }
    });
  }

  return chunks;
}

// 2. Posts LinkedIn → 1 chunk par post
export function adaptLinkedInPosts(posts: any[]): Chunk[] {
  if (!Array.isArray(posts)) return [];
  return posts.filter(p => p && (p.text || p.body || p.content)).map((post, i) => {
    const text = truncate(safeStr(post.text || post.body || post.content), 500);
    const date = post.created_at || post.date || post.timestamp || '';
    const dateStr = date ? new Date(date).toLocaleDateString('fr-FR') : 'récent';
    const reactions = post.reactions_count || post.likes_count || post.num_likes || 0;
    const ninetyDays = new Date();
    ninetyDays.setDate(ninetyDays.getDate() + 90);

    return {
      chunk_type: 'post' as const,
      content: `Post LinkedIn du ${dateStr}${reactions ? ` (${reactions} réactions)` : ''} :\n${text}`,
      source_table: 'linkedin_posts',
      source_id: `post_${i}`,
      metadata: { date: dateStr, reactions, source: 'linkedin' },
      expires_at: ninetyDays.toISOString(),
    };
  });
}

// 3. Messages conversation → 1 chunk concaténé
export function adaptConversationMessages(messages: any[], candidateId: string): Chunk[] {
  if (!Array.isArray(messages) || messages.length === 0) return [];
  const last10 = messages.slice(-10);
  const formatted = last10.map(m => {
    const role = m.is_sender ? 'Recruteur' : 'Candidat';
    return `${role}: ${truncate(safeStr(m.text || m.body || m.content), 200)}`;
  }).join('\n');

  const lastDate = last10[last10.length - 1]?.timestamp || last10[last10.length - 1]?.created_at || '';
  return [{
    chunk_type: 'conversation',
    content: formatted,
    source_table: 'unipile_conversations',
    metadata: { last_message_date: lastDate, message_count: messages.length, candidate_id: candidateId },
  }];
}

// 4. Historique Airtable → notes + évaluation
export function adaptAirtableHistory(data: { shortlists?: any[]; placements?: any[]; notes?: any[]; appointments?: any[] }): Chunk[] {
  if (!data) return [];
  const chunks: Chunk[] = [];

  // Notes individuelles
  (data.notes || []).filter(n => n && (n.detail || n.title)).forEach((note, i) => {
    chunks.push({
      chunk_type: 'note',
      content: `${safeStr(note.title)}${note.detail ? ' : ' + truncate(safeStr(note.detail), 300) : ''}`,
      source_table: 'airtable_notes',
      source_id: note.airtable_id || `note_${i}`,
      metadata: { date: note.note_date || '', consultant: note.author || note.consultant || '', type: note.note_type || '' },
    });
  });

  // Résumé shortlists + placements
  const historyLines: string[] = [];
  (data.shortlists || []).filter(s => s.job_title || s.company_name).forEach(s => {
    historyLines.push(`Shortlisté pour ${safeStr(s.job_title)} chez ${safeStr(s.company_name)} le ${safeStr(s.date_added)}. Statut : ${safeStr(s.status)}${s.consultant ? '. Par ' + s.consultant : ''}`);
  });
  (data.placements || []).filter(p => p.company_name).forEach(p => {
    historyLines.push(`Placé chez ${safeStr(p.company_name)} (${safeStr(p.contract_type)}), début ${safeStr(p.start_date)}. Statut : ${safeStr(p.status)}`);
  });
  if (historyLines.length > 0) {
    chunks.push({
      chunk_type: 'evaluation',
      content: `Historique cabinet :\n${historyLines.join('\n')}`,
      source_table: 'airtable_shortlists_placements',
      metadata: { shortlists_count: (data.shortlists || []).length, placements_count: (data.placements || []).length },
    });
  }

  return chunks;
}

// 5. Appel + transcript + rapport
export function adaptCallData(call: any, transcript?: string, report?: any): Chunk[] {
  const chunks: Chunk[] = [];
  if (transcript && transcript.length > 20) {
    chunks.push({
      chunk_type: 'call_transcript',
      content: truncate(transcript, 2000),
      source_table: 'call_coaching_sessions',
      metadata: { date: call?.started_at || call?.created_at || '', duration: call?.duration || 0, direction: call?.direction || '' },
    });
  }
  if (report && typeof report === 'object') {
    const reportText = typeof report === 'string' ? report : JSON.stringify(report, null, 2);
    chunks.push({
      chunk_type: 'evaluation',
      content: `Rapport d'appel :\n${truncate(reportText, 1500)}`,
      source_table: 'call_coaching_sessions',
      metadata: { date: call?.started_at || call?.created_at || '', type: 'call_report' },
    });
  }
  return chunks;
}

// 6. Session de qualification
export function adaptQualificationSession(session: any): Chunk[] {
  if (!session) return [];
  const lines: string[] = [];
  if (session.verdict && session.verdict !== 'pending') lines.push(`Verdict : ${session.verdict}`);
  if (session.notes) lines.push(`Notes : ${truncate(safeStr(session.notes), 500)}`);
  if (session.scoring_summary && typeof session.scoring_summary === 'object') {
    lines.push(`Scoring : ${JSON.stringify(session.scoring_summary)}`);
  }
  if (lines.length === 0) return [];
  return [{
    chunk_type: 'evaluation',
    content: `Qualification${session.job_title ? ' pour ' + session.job_title : ''}${session.client_name ? ' chez ' + session.client_name : ''} :\n${lines.join('\n')}`,
    source_table: 'qualification_sessions',
    source_id: session.id,
    metadata: { date: session.event_start_at || '', job_id: session.job_id || '', verdict: session.verdict || '' },
  }];
}

// 7. Contexte de poste
export function adaptJobContext(jobData: any, bodyContent?: string): Chunk[] {
  if (!jobData) return [];
  const lines: string[] = [];
  const title = safeStr(jobData.title || jobData['Poste'] || jobData['Titre'] || '');
  const client = safeStr(jobData.client?.name || jobData['Client'] || jobData['Entreprise'] || '');
  if (title) lines.push(`Poste : ${title}`);
  if (client) lines.push(`Client : ${client}`);
  if (jobData.skills) lines.push(`Compétences : ${Array.isArray(jobData.skills) ? jobData.skills.join(', ') : jobData.skills}`);
  if (jobData.seniority) lines.push(`Séniorité : ${jobData.seniority}`);
  if (jobData.location) lines.push(`Localisation : ${jobData.location}`);
  if (jobData.remote) lines.push(`Remote : ${jobData.remote}`);
  if (jobData.salaryMin || jobData.salaryMax) lines.push(`Salaire : ${jobData.salaryMin || '?'}k - ${jobData.salaryMax || '?'}k€`);
  if (jobData.mustHave) lines.push(`Must-have : ${jobData.mustHave}`);
  if (jobData.shouldHave) lines.push(`Should-have : ${jobData.shouldHave}`);
  if (jobData.description) lines.push(`Description : ${truncate(safeStr(jobData.description), 300)}`);
  if (bodyContent) lines.push(`Détails : ${truncate(bodyContent, 500)}`);
  if (lines.length === 0) return [];
  return [{
    chunk_type: 'job_context',
    content: lines.join('\n'),
    source_table: 'notion_jobs',
    metadata: { title, client },
  }];
}

// 8. Historique de séquence
export function adaptSequenceHistory(executions: any[]): Chunk[] {
  if (!Array.isArray(executions) || executions.length === 0) return [];
  const lines = executions.filter(e => e.status === 'sent' || e.final_message).map((e, i) => {
    const type = e.step?.action_type || 'message';
    const date = e.executed_at || e.created_at || '';
    const dateStr = date ? new Date(date).toLocaleDateString('fr-FR') : '';
    const msg = truncate(safeStr(e.final_message), 100);
    return `Étape ${i + 1} (${type}, ${dateStr}) : ${msg}`;
  });
  if (lines.length === 0) return [];
  return [{
    chunk_type: 'sequence_history',
    content: `Séquence d'outreach :\n${lines.join('\n')}`,
    source_table: 'sequence_step_executions',
    metadata: { step_count: lines.length, last_step_date: executions[executions.length - 1]?.executed_at || '' },
  }];
}

// 10. Mission / projet de sourcing (brief) → chunk job_context
// Dérivé UNIQUEMENT des champs sémantiques du brief (pas de stats/dates/
// filters_snapshot) pour que le content_hash reste stable : les UPDATE de
// churn (stats_*, last_search_at) produisent un contenu identique → dédup
// SHA-256 → pas de ré-embedding (même pattern que job_candidate_status).
export function adaptSourcingProject(project: any): Chunk[] {
  if (!project) return [];
  const jd = (project.job_details && typeof project.job_details === 'object') ? project.job_details : {};
  const lines: string[] = [];

  const title = safeStr(jd.title || project.job_title || project.name || '');
  const client = safeStr(jd.client?.name || project.client_name || '');
  if (title) lines.push(`Mission : ${title}`);
  if (project.name && safeStr(project.name) !== title) lines.push(`Nom interne : ${safeStr(project.name)}`);
  if (client) lines.push(`Client : ${client}`);
  if (jd.client?.sector) lines.push(`Secteur client : ${safeStr(jd.client.sector)}`);
  if (jd.client?.size) lines.push(`Taille client : ${safeStr(jd.client.size)}`);

  if (jd.seniority) lines.push(`Séniorité : ${safeStr(jd.seniority)}`);
  if (jd.experience_min || jd.experience_max) {
    lines.push(`Expérience : ${jd.experience_min ?? '?'} - ${jd.experience_max ?? '?'} ans`);
  }
  if (jd.contract_type) lines.push(`Contrat : ${safeStr(jd.contract_type)}`);
  if (jd.location) lines.push(`Localisation : ${safeStr(jd.location)}`);
  if (jd.remote_policy) {
    lines.push(`Télétravail : ${safeStr(jd.remote_policy)}${jd.remote_days ? ` (${jd.remote_days} j/sem)` : ''}`);
  }
  if (jd.salary_min || jd.salary_max) {
    const cur = safeStr(jd.salary_currency || '€');
    lines.push(`Rémunération : ${jd.salary_min ?? '?'} - ${jd.salary_max ?? '?'} ${cur}${jd.salary_type ? ` (${safeStr(jd.salary_type)})` : ''}`);
  }

  const skillList = (v: any) => (Array.isArray(v) ? v.filter(Boolean).map((s: any) => safeStr(s)) : []);
  const mustHave = skillList(jd.skills_must_have);
  const shouldHave = skillList(jd.skills_should_have);
  const niceToHave = skillList(jd.skills_nice_to_have);
  if (mustHave.length) lines.push(`Compétences indispensables : ${mustHave.join(', ')}`);
  if (shouldHave.length) lines.push(`Compétences souhaitées : ${shouldHave.join(', ')}`);
  if (niceToHave.length) lines.push(`Compétences bonus : ${niceToHave.join(', ')}`);
  if (Array.isArray(jd.languages) && jd.languages.length) {
    const langs = jd.languages
      .map((l: any) => `${safeStr(l?.language)}${l?.level ? ` (${safeStr(l.level)})` : ''}`)
      .filter((s: string) => s.trim());
    if (langs.length) lines.push(`Langues : ${langs.join(', ')}`);
  }

  if (jd.mission_description) lines.push(`Mission : ${truncate(safeStr(jd.mission_description), 600)}`);
  if (jd.context) lines.push(`Contexte : ${truncate(safeStr(jd.context), 400)}`);
  if (Array.isArray(jd.evaluation_criteria) && jd.evaluation_criteria.length) {
    const crit = jd.evaluation_criteria
      .map((c: any) => typeof c === 'string' ? c : safeStr(c?.label || c?.criterion || c?.name || c?.description || c?.text || ''))
      .filter(Boolean)
      .slice(0, 15)
      .join(' ; ');
    if (crit) lines.push(`Critères d'évaluation : ${truncate(crit, 400)}`);
  }

  if (lines.length === 0) return [];
  return [{
    chunk_type: 'job_context',
    content: lines.join('\n'),
    source_table: 'sourcing_projects',
    source_id: safeStr(project.id) || undefined,
    metadata: { title, client, mission_name: safeStr(project.name || '') },
  }];
}

// 9. Résultat de scoring
export function adaptScoringResult(score: any): Chunk[] {
  if (!score) return [];
  const lines: string[] = [];
  if (score.score !== undefined) lines.push(`Score : ${score.score}/100`);
  if (score.recommendation) lines.push(`Recommandation : ${truncate(safeStr(score.recommendation), 300)}`);
  if (score.details) lines.push(`Détails : ${truncate(typeof score.details === 'string' ? score.details : JSON.stringify(score.details), 500)}`);
  if (lines.length === 0) return [];
  return [{
    chunk_type: 'scoring_result',
    content: lines.join('\n'),
    source_table: 'match_scores',
    metadata: { job_id: score.job_id || '', score: score.score, date: score.created_at || '' },
  }];
}

/** Contexte réel : toutes les lectures métier passent par le JWT et sa RLS. */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.75.1?target=deno&no-check';
import { isCandidateErasedForOrg } from '../get-or-fetch-contact.ts';
import type { CandidateActionContext, CandidateActionScope, CandidateActionSource } from './types.ts';
import {
  candidateActionStoredEmailSource,
  loadCandidateActionTargets, readCandidateActionChatContext,
  readCandidateActionEmailContext, validateCandidateActionChat,
} from './transport.ts';

type Row = Record<string, unknown>;
type State = CandidateActionContext['sourceStates'][string];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const text = (v: unknown): string => typeof v === 'string' ? v.trim() : '';
const record = (v: unknown): Row => v && typeof v === 'object' && !Array.isArray(v) ? v as Row : {};
const rows = (v: unknown): Row[] => Array.isArray(v) ? v.filter(r => r && typeof r === 'object') : [];
const strings = (v: unknown): string[] => Array.isArray(v) ? v.map(text).filter(Boolean) : [];
const unique = (v: string[]): string[] => [...new Set(v.filter(Boolean))].sort();
const safeId = (v: unknown): string => { const id = text(v); return id && id.length <= 512 && ![...id].some(character => character.charCodeAt(0) < 32) ? id : ''; };
const json = (v: unknown): string => JSON.stringify(v ?? null);

export class CandidateActionContextError extends Error {
  constructor(public code: string, message: string, public status = 409) { super(message); }
}

/** Exact slug comparison, with escaped search patterns only as a first pass. */
export function normalizeActionLinkedInUrl(value: unknown): string | null {
  try {
    const url = new URL(text(value));
    if (!['http:', 'https:'].includes(url.protocol) || !(url.hostname === 'linkedin.com' || url.hostname.endsWith('.linkedin.com'))) return null;
    const match = url.pathname.match(/^\/in\/([^/]+)\/?$/i);
    return match ? `https://www.linkedin.com/in/${decodeURIComponent(match[1]).toLowerCase()}` : null;
  } catch { return null; }
}

const slugPattern = (url: string) => `%/in/${url.split('/').pop()!.replace(/[\\%_]/g, '\\$&')}%`;
const sameUrl = (a: unknown, b: unknown) => !!normalizeActionLinkedInUrl(a) && normalizeActionLinkedInUrl(a) === normalizeActionLinkedInUrl(b);

/** Bounded reads are explicitly partial. A failure never turns into an empty source. */
async function read(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<{ data: Row[]; state: State }> {
  try {
    const response = await query;
    if (response.error) return { data: [], state: 'unavailable' };
    const result = rows(response.data);
    return { data: result.slice(0, 100), state: result.length > 100 ? 'partial' : 'available' };
  } catch { return { data: [], state: 'unavailable' }; }
}

function stable(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stable);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value as Row).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, stable(v)]));
  return value;
}

/** Collection time is deliberately excluded; facts and incoming text determine freshness. */
export async function candidateActionContextVersion(scope: CandidateActionScope, sources: CandidateActionSource[], states: Record<string, State>, targets: CandidateActionContext['targets']): Promise<string> {
  const ownAccounts = new Set([scope.account_id, ...targets.map(t => t.senderAccountId)].filter(Boolean));
  const fingerprintSources = sources.map(source => {
    if (source.reference?.table !== 'mission_conversations') return source;
    try {
      const detail = record(JSON.parse(source.detail));
      if (!ownAccounts.has(text(detail.accountId))) return source;
      // Own outgoing messages have their own immutable provider references.
      // A refreshed linkage timestamp must not block later effects of that send.
      const factual = { accountId: detail.accountId, lastInboundAt: detail.lastInboundAt, createdAt: detail.createdAt };
      return { ...source, summary: json(factual), detail: json(factual), timestamp: text(detail.lastInboundAt ?? detail.createdAt), reference: { ...source.reference, version: text(detail.lastInboundAt ?? detail.createdAt) || null } };
    } catch { return source; }
  });
  const payload = JSON.stringify(stable({ scope, states, targets: [...targets].sort((a, b) => a.id.localeCompare(b.id)), sources: fingerprintSources.sort((a, b) => a.id.localeCompare(b.id)) }));
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(payload));
  return Array.from(new Uint8Array(digest)).map(n => n.toString(16).padStart(2, '0')).join('');
}

export async function loadCandidateActionContext(
  admin: SupabaseClient, userClient: SupabaseClient, userId: string,
  requestedScope: CandidateActionScope, options: { excludeEffectIds?: string[] } = {},
): Promise<CandidateActionContext> {
  if (!UUID.test(requestedScope.organization_id) || !safeId(requestedScope.candidate_id)) throw new CandidateActionContextError('IDENTITY_REQUIRED', 'Le candidat ou l’organisation est introuvable.', 400);
  if (requestedScope.project_id && !UUID.test(requestedScope.project_id)) throw new CandidateActionContextError('MISSION_REQUIRED', 'Choisissez la mission concernée.', 400);
  // Revalidate actual membership; active_organization_id alone is not authority.
  const membership = await admin.from('organization_members').select('user_id').eq('organization_id', requestedScope.organization_id).eq('user_id', userId).maybeSingle();
  if (membership.error || !membership.data) throw new CandidateActionContextError('ACCESS_DENIED', 'Vous n’avez pas accès à cette organisation.', 403);
  const activeProfile = await admin.from('profiles').select('active_organization_id').eq('user_id', userId).maybeSingle();
  if (activeProfile.error) throw new CandidateActionContextError('ORGANIZATION_UNAVAILABLE', 'Votre organisation ne peut pas être vérifiée. Réessayez.', 503);
  if (activeProfile.data?.active_organization_id !== requestedScope.organization_id) throw new CandidateActionContextError('ORGANIZATION_CHANGED', 'Votre organisation a changé. Rechargez ce contexte avant de préparer une action.');
  const organizationId = requestedScope.organization_id;
  const states: Record<string, State> = {};
  const warnings: string[] = [];
  const verifiedChat = requestedScope.chat_id ? await validateCandidateActionChat(admin, userId, requestedScope) : null;
  let ids = unique([safeId(requestedScope.candidate_id), ...strings(verifiedChat?.candidateIds)]);
  const declaredUrl = normalizeActionLinkedInUrl(requestedScope.linkedin_url);
  const verifiedUrl = normalizeActionLinkedInUrl(verifiedChat?.linkedinUrl);
  if (declaredUrl && verifiedUrl && declaredUrl !== verifiedUrl) throw new CandidateActionContextError('IDENTITY_MISMATCH', 'Le profil et la conversation ne désignent pas le même candidat.', 403);
  let linkedinUrl = verifiedChat ? verifiedUrl : declaredUrl;

  const identityReads = await Promise.all([
    read(userClient.from('job_candidate_status').select('*').eq('organization_id', organizationId).in('candidate_id', ids).order('updated_at', { ascending: false }).limit(101)),
    linkedinUrl ? read(userClient.from('job_candidate_status').select('*').eq('organization_id', organizationId).ilike('linkedin_profile_url', slugPattern(linkedinUrl)).order('updated_at', { ascending: false }).limit(101)) : Promise.resolve({ data: [], state: 'available' as State }),
    read(userClient.from('mission_conversations').select('*').eq('organization_id', organizationId).overlaps('candidate_ids', ids).order('updated_at', { ascending: false }).limit(101)),
  ]);
  const idRows = identityReads[0].data;
  if (linkedinUrl && idRows.some(r => normalizeActionLinkedInUrl(r.linkedin_profile_url) && !sameUrl(r.linkedin_profile_url, linkedinUrl))) throw new CandidateActionContextError('IDENTITY_MISMATCH', 'Le profil et la candidature ne désignent pas le même candidat.', 403);
  // An arbitrary supplied URL cannot join an unlinked id to somebody else.
  const allowUrlAliases = !idRows.length || !!verifiedUrl || idRows.some(r => sameUrl(r.linkedin_profile_url, linkedinUrl));
  let candidacies = [...new Map([...idRows, ...(allowUrlAliases ? identityReads[1].data.filter(r => sameUrl(r.linkedin_profile_url, linkedinUrl)) : [])].map(r => [text(r.id), r])).values()];
  let conversations = identityReads[2].data;
  // Stored conversation aliases are trusted only where an already validated identifier matches.
  ids = unique([...ids, ...candidacies.map(r => text(r.candidate_id)), ...conversations.flatMap(r => [text(r.candidate_id), ...strings(r.candidate_ids)])]);
  if (conversations.length) {
    const byAliases = await read(userClient.from('job_candidate_status').select('*').eq('organization_id', organizationId).in('candidate_id', ids).order('updated_at', { ascending: false }).limit(101));
    candidacies = [...new Map([...candidacies, ...byAliases.data].map(r => [text(r.id), r])).values()];
    identityReads.push(byAliases);
  }
  states.identity = identityReads.some(r => r.state === 'unavailable') ? 'unavailable' : identityReads.some(r => r.state === 'partial') ? 'partial' : 'available';
  if (!candidacies.length && !verifiedChat) throw new CandidateActionContextError('CANDIDATE_UNVERIFIED', 'Ouvrez une fiche candidat ou une conversation de votre compte pour préparer une action.', 403);
  if (states.identity !== 'available') throw new CandidateActionContextError('IDENTITY_UNAVAILABLE', 'Le rattachement du candidat est incomplet. Actualisez avant de préparer une action.', 503);

  const missionIds = unique([...candidacies.map(r => text(r.project_id)), ...conversations.map(r => text(r.project_id))]);
  if (!requestedScope.project_id && missionIds.length > 1) throw new CandidateActionContextError('MISSION_AMBIGUOUS', 'Ce candidat est présent dans plusieurs missions. Choisissez la mission concernée.');
  const projectId = requestedScope.project_id ?? missionIds[0] ?? null;
  let mission: Row | null = null;
  if (projectId) {
    const result = await userClient.from('sourcing_projects').select('id, name, job_id, job_title, client_name, description, job_details, created_by, updated_at, organization_id').eq('organization_id', organizationId).eq('id', projectId).maybeSingle();
    if (result.error || !result.data) throw new CandidateActionContextError('MISSION_ACCESS_DENIED', 'Cette mission est indisponible ou vous n’y avez pas accès.', 403);
    mission = record(result.data);
    const candidateBelongs = candidacies.some(r => r.project_id === projectId || (!r.project_id && r.job_id && r.job_id === mission!.job_id)) || conversations.some(r => r.project_id === projectId);
    if (!candidateBelongs) throw new CandidateActionContextError('MISSION_CANDIDATE_MISMATCH', 'Ce candidat n’est pas rattaché à la mission choisie.', 403);
  }
  const scopedRows = candidacies.filter(r => !projectId ? !r.project_id : r.project_id === projectId || (!r.project_id && !!mission?.job_id && r.job_id === mission.job_id));
  const candidate = scopedRows.sort((a, b) => text(b.updated_at).localeCompare(text(a.updated_at)))[0] ?? null;
  // A stored canonical id wins over browser aliases. Without pipeline, only the verified chat is authority.
  const candidateId = text(candidate?.candidate_id) || safeId(verifiedChat?.candidateIds[0]) || requestedScope.candidate_id;
  linkedinUrl = normalizeActionLinkedInUrl(candidate?.linkedin_profile_url) ?? linkedinUrl;
  ids = unique([...ids, candidateId]);
  const scope: CandidateActionScope = { organization_id: organizationId, candidate_id: candidateId, project_id: projectId, linkedin_url: linkedinUrl, account_id: requestedScope.account_id ?? null, chat_id: requestedScope.chat_id ?? null };
  const candidateName = text(candidate?.candidate_name) || text(verifiedChat?.candidateName) || 'Candidat';
  conversations = conversations.filter(r => projectId ? r.project_id === projectId : !r.project_id);
  // This authorization lookup also protects internal notes/comments from recreating erased data.
  const verifyErasure = async (emails: string[] = []) => {
    try {
      if (await isCandidateErasedForOrg(admin, { organizationId, linkedinIds: ids, linkedinUrl: text(candidate?.linkedin_profile_url) || text(verifiedChat?.linkedinUrl) || linkedinUrl, emails })) {
        throw new CandidateActionContextError('CANDIDATE_ERASED', 'Ce candidat a demandé l’effacement de ses données. Aucune action ne peut être préparée ou enregistrée.', 403);
      }
    } catch (error) {
      if (error instanceof CandidateActionContextError) throw error;
      throw new CandidateActionContextError('GDPR_UNVERIFIED', 'Les conditions d’accès à ce candidat ne peuvent pas être vérifiées. Réessayez.', 503);
    }
  };
  await verifyErasure();

  // Resolve ignored refs from durable effects, never from browser-supplied document ids.
  const excluded = new Set<string>();
  const ownPlanIds = new Set<string>();
  const ownEffectIds = new Set<string>();
  if (options.excludeEffectIds?.length) {
    let planQuery = userClient.from('candidate_action_plans').select('id').eq('organization_id', organizationId).eq('candidate_id', candidateId).eq('user_id', userId);
    planQuery = projectId ? planQuery.eq('project_id', projectId) : planQuery.is('project_id', null);
    const plans = await planQuery;
    if (plans.error) throw new CandidateActionContextError('EFFECTS_UNAVAILABLE', 'L’état des actions n’a pas pu être vérifié.', 503);
    for (const plan of rows(plans.data)) ownPlanIds.add(text(plan.id));
    const effects = ownPlanIds.size ? await userClient.from('candidate_action_effects').select('id, result, plan_id').in('plan_id', [...ownPlanIds]).in('id', options.excludeEffectIds).limit(100) : { data: [], error: null };
    if (effects.error) throw new CandidateActionContextError('EFFECTS_UNAVAILABLE', 'L’état des actions n’a pas pu être vérifié.', 503);
    for (const effect of rows(effects.data)) if (ownPlanIds.has(text(effect.plan_id))) {
      // The receipt can commit before result.referenceId is populated. Its
      // effect_id is already trustworthy through the owned, scoped plan.
      if (UUID.test(text(effect.id))) ownEffectIds.add(text(effect.id));
      const result = record(effect.result);
      for (const id of [result.referenceId, result.providerId]) if (text(id)) excluded.add(text(id));
    }
  }

  let notesQuery = userClient.from('candidate_notes').select('id,content,created_by,created_at,updated_at').eq('organization_id', organizationId).in('candidate_id', ids);
  let commentsQuery = userClient.from('candidate_comments').select('id,content,mentions,job_id,created_by,created_at').eq('organization_id', organizationId).in('candidate_id', ids);
  let recordedMessagesQuery = userClient.from('candidate_action_messages').select('*').eq('organization_id', organizationId).in('candidate_id', ids);
  // Exclude our verified results before pagination: inserting the 101st note
  // must not evict an older factual source or turn an available read partial.
  // Only UUID references enter this PostgREST filter; provider IDs stay local.
  const ownRowIds = [...excluded].filter(id => UUID.test(id));
  if (ownRowIds.length) {
    const filter = `(${ownRowIds.join(',')})`;
    notesQuery = notesQuery.not('id', 'in', filter);
    commentsQuery = commentsQuery.not('id', 'in', filter);
    recordedMessagesQuery = recordedMessagesQuery.not('id', 'in', filter);
  }
  const ownEffectsFilter = ownEffectIds.size ? `effect_id.is.null,effect_id.not.in.(${[...ownEffectIds].join(',')})` : null;
  if (ownEffectsFilter) recordedMessagesQuery = recordedMessagesQuery.or(ownEffectsFilter);
  const sourceReads = await Promise.all([
    read(userClient.from('candidate_contacts').select('candidate_id,email,phone,source,updated_at,updated_by').eq('organization_id', organizationId).in('candidate_id', ids).order('candidate_id').limit(101)),
    read(notesQuery.order('created_at', { ascending: false }).limit(101)),
    read(commentsQuery.order('created_at', { ascending: false }).limit(101)),
    read(userClient.from('candidate_evaluations').select('*').eq('organization_id', organizationId).in('candidate_id', ids).order('updated_at', { ascending: false }).limit(101)),
    read(userClient.from('call_coaching_sessions').select('id,candidate_id,project_id,process_step_id,evaluation_id,qualification_session_id,report,status,created_by,created_at').eq('organization_id', organizationId).in('candidate_id', ids).order('created_at', { ascending: false }).limit(101)),
    read(userClient.from('qualification_sessions').select('*').eq('organization_id', organizationId).in('candidate_profile_id', ids).order('event_start_at', { ascending: false }).limit(101)),
    read(userClient.from('sequence_enrollments').select('id,profile_id,provider_id,resolved_profile_id,profile_url,profile_name,sequence_id,status,job_id,job_title,email_used,phone_used,created_by,replied_at,updated_at,tracking_data').eq('organization_id', organizationId).in('profile_id', ids).order('updated_at', { ascending: false }).limit(101)),
    projectId ? read(userClient.from('mission_process_steps').select('*').eq('project_id', projectId).order('step_order').limit(101)) : Promise.resolve({ data: [], state: 'available' as State }),
    read(userClient.from('organization_members').select('user_id,role').eq('organization_id', organizationId).order('user_id').limit(101)),
    read(recordedMessagesQuery.order('occurred_at', { ascending: false }).limit(101)),
  ]);
  const keys = ['contacts', 'notes', 'comments', 'evaluations', 'reports', 'interviews', 'sequences', 'process', 'members', 'recordedMessages'];
  sourceReads.forEach((r, i) => { states[keys[i]] = r.state; });
  // The ledger is an authorized subset of exchanges, including private
  // incoming messages. A complete SQL page is not a complete team history.
  if (states.recordedMessages === 'available') states.recordedMessages = 'partial';
  const [contactsRead, notesRead, commentsRead, evaluationsRead, reportsRead, interviewsRead, enrollmentsRead, processRead, membersRead, recordedMessagesRead] = sourceReads;

  // Enrollments may store any of the three provider identifiers. URL matching remains exact.
  const enrollmentLookups = await Promise.all([
    read(userClient.from('sequence_enrollments').select('*').eq('organization_id', organizationId).in('provider_id', ids).order('updated_at', { ascending: false }).limit(101)),
    read(userClient.from('sequence_enrollments').select('*').eq('organization_id', organizationId).in('resolved_profile_id', ids).order('updated_at', { ascending: false }).limit(101)),
    linkedinUrl ? read(userClient.from('sequence_enrollments').select('*').eq('organization_id', organizationId).ilike('profile_url', slugPattern(linkedinUrl)).order('updated_at', { ascending: false }).limit(101)) : Promise.resolve({ data: [], state: 'available' as State }),
  ]);
  if (enrollmentLookups.some(r => r.state !== 'available')) states.sequences = enrollmentLookups.some(r => r.state === 'unavailable') ? 'unavailable' : 'partial';
  const allEnrollments = [...new Map([...enrollmentsRead.data, ...enrollmentLookups[0].data, ...enrollmentLookups[1].data, ...enrollmentLookups[2].data.filter(r => sameUrl(r.profile_url, linkedinUrl))].map(r => [text(r.id), r])).values()];
  const knownJobIds = new Set([projectId, projectId ? `project:${projectId}` : null, text(mission?.job_id)].filter(Boolean));
  const enrollments = allEnrollments.filter(r => projectId ? knownJobIds.has(text(r.job_id)) || conversations.some(c => c.enrollment_id === r.id) : !r.job_id);
  const enrollmentIds = enrollments.map(r => text(r.id));
  const executionRead = enrollmentIds.length ? await read(userClient.from('sequence_step_executions').select('id,enrollment_id,status,channel,executed_at,scheduled_at,final_subject,final_message,updated_at').eq('organization_id', organizationId).in('enrollment_id', enrollmentIds).order('updated_at', { ascending: false }).limit(101)) : { data: [], state: 'available' as State };
  states.sequenceEvents = executionRead.state;

  const memberIds = membersRead.data.map(r => text(r.user_id));
  const profiles = memberIds.length ? await read(userClient.from('profiles').select('user_id,display_name').in('user_id', memberIds).order('user_id').limit(101)) : { data: [], state: 'available' as State };
  if (profiles.state !== 'available') states.members = profiles.state;
  const members = membersRead.data.map(r => ({ id: text(r.user_id), name: text(profiles.data.find(p => p.user_id === r.user_id)?.display_name) || 'Membre de l’équipe' }));
  const nameOf = (id: unknown) => text(id) === userId ? 'Vous' : members.find(m => m.id === id)?.name || 'Auteur non renseigné';
  const sources: CandidateActionSource[] = [];
  const add = (table: string, row: Row, type: string, title: string, detail: string, project: string | null = projectId, service?: CandidateActionSource['service']) => {
    const id = text(row.id);
    if (!id || excluded.has(id)) return;
    sources.push({ id: `${table}:${id}`, type, title, author: nameOf(row.created_by ?? row.updated_by), timestamp: text(row.event_start_at ?? row.executed_at ?? row.created_at ?? row.updated_at), summary: detail.slice(0, 200), detail: detail.slice(0, 12000), projectId: project, ...(service ? { service } : {}), reference: { table, id, version: text(row.updated_at ?? row.created_at) || null } });
  };
  if (candidate) add('job_candidate_status', candidate, 'profile', 'Profil et candidature', json({ profile: candidate.linkedin_profile_data, headline: candidate.candidate_headline, stage: candidate.general_stage, processStepId: candidate.process_step_id, score: candidate.score, scoringDetails: candidate.scoring_details }));
  if (mission) add('sourcing_projects', mission, 'mission', 'Brief de la mission', json({ name: mission.name, title: mission.job_title, description: mission.description, details: mission.job_details }));
  const scoped = (r: Row) => projectId ? r.project_id === projectId : !r.project_id;
  const evaluations = evaluationsRead.data.filter(scoped);
  const reports = reportsRead.data.filter(scoped);
  const interviews = interviewsRead.data.filter(scoped);
  const notes = notesRead.data.filter(r => !excluded.has(text(r.id)));
  const comments = commentsRead.data.filter(r => !excluded.has(text(r.id)) && (projectId ? knownJobIds.has(text(r.job_id)) : !r.job_id));
  for (const r of notes) add('candidate_notes', r, 'note', 'Note interne sur le candidat', text(r.content), null);
  for (const r of comments) add('candidate_comments', r, 'team_comment', 'Commentaire de l’équipe', text(r.content));
  for (const r of evaluations) add('candidate_evaluations', r, 'evaluation', 'Grille d’entretien', json({ processStepId: r.process_step_id, criteria: r.criteria, ratings: r.ratings, comments: r.comments, summary: r.summary, followUpNotes: r.follow_up_notes, recommendation: r.recommendation, aiGenerated: r.ai_generated }));
  for (const r of reports) if (Object.keys(record(r.report)).length) add('call_coaching_sessions', r, 'interview_report', 'Compte rendu d’entretien', json({ report: r.report, evaluationId: r.evaluation_id, eventId: r.qualification_session_id, status: r.status }));
  for (const r of interviews) add('qualification_sessions', r, 'interview', text(r.event_name) || 'Entretien', json({ status: r.status, startsAt: r.event_start_at, endsAt: r.event_end_at, notes: r.notes, verdict: r.verdict, verdictAt: r.verdict_at, verdictBy: r.verdict_by, verdictNotes: r.verdict_notes }), projectId, r.calendly_event_id ? 'calendly' : 'calendar');
  for (const r of processRead.data) add('mission_process_steps', r, 'process_step', text(r.name) || 'Étape d’entretien', json({ objectives: r.objectives, criteria: r.evaluation_criteria, interviewerId: r.interviewer_user_id }));
  for (const r of executionRead.data) add('sequence_step_executions', { ...r, created_by: enrollments.find(e => e.id === r.enrollment_id)?.created_by }, 'sequence', 'Action de séquence', json({ status: r.status, channel: r.channel, subject: r.final_subject, message: r.final_message, enrollmentId: r.enrollment_id }), projectId, r.channel === 'email' ? 'email' : r.channel === 'whatsapp' ? 'whatsapp' : 'linkedin');
  for (const r of conversations) add('mission_conversations', r, 'team_intervention', 'Derniers échanges rattachés à la mission', json({ accountId: r.account_id, createdAt: r.created_at, lastInboundAt: r.last_inbound_at, lastOutboundAt: r.last_outbound_at, lastSendKind: r.last_send_kind }), projectId, 'linkedin');

  // Historical records without mission linkage are explicitly ambiguous and cannot prove a missing debrief.
  if (projectId && (evaluationsRead.data.some(r => !r.project_id) || reportsRead.data.some(r => !r.project_id))) warnings.push('Certains anciens entretiens ou évaluations n’ont pas de mission identifiée ; ils ne permettent pas de conclure sur l’entretien actuel.');
  const contacts = [...contactsRead.data.map(r => ({ candidate_id: text(r.candidate_id), email: text(r.email) || null, phone: text(r.phone) || null })), ...allEnrollments.map(r => ({ candidate_id: candidateId, email: text(r.email_used) || null, phone: text(r.phone_used) || null }))];
  await verifyErasure(unique(contacts.map(contact => text(contact.email))));
  const targets = await loadCandidateActionTargets(admin, userClient, userId, scope, contacts, members);
  const readableChannels = [!!scope.chat_id || targets.some(target => target.channel === 'linkedin' && target.audience === 'candidate'), targets.some(target => target.channel === 'email' && target.audience === 'candidate')];
  const messageReads = await Promise.allSettled([
    readCandidateActionChatContext(admin, userId, { ...scope, account_id: scope.account_id ?? targets.find(t => t.channel === 'linkedin')?.senderAccountId ?? null, chat_id: scope.chat_id ?? targets.find(t => t.channel === 'linkedin')?.chatId ?? null }),
    readCandidateActionEmailContext(admin, userId, scope, targets),
  ]);
  const ownProviderSources = new Set<string>();
  if (ownEffectIds.size) {
    // Link any live-provider echo to the same validated effect even while its
    // durable result is still null. Do not suppress an unrelated account's
    // copy of the provider ID, or a colleague's intervention.
    let receiptsQuery = userClient.from('candidate_action_messages').select('channel,account_id,provider_message_id')
      .eq('organization_id', organizationId).in('candidate_id', ids).eq('owner_user_id', userId)
      .in('action_plan_id', [...ownPlanIds]).in('effect_id', [...ownEffectIds]).eq('direction', 'outbound');
    receiptsQuery = projectId ? receiptsQuery.eq('project_id', projectId) : receiptsQuery.is('project_id', null);
    const receipts = await read(receiptsQuery.limit(101));
    if (receipts.state !== 'available') throw new CandidateActionContextError('EFFECTS_UNAVAILABLE', 'Les reçus de vos actions ne peuvent pas être vérifiés. Réessayez.', 503);
    for (const receipt of receipts.data) ownProviderSources.add(`${text(receipt.channel)}-${text(receipt.account_id)}-${text(receipt.provider_message_id)}`);
  }
  if (targets.some(target => target.channel === 'email' && target.audience === 'candidate')) {
    // An authorized provider read may hydrate the private email ledger. Read
    // its effective page now, so the first and next context have the same
    // canonical sources and pagination state.
    let refreshedQuery = userClient.from('candidate_action_messages').select('*').eq('organization_id', organizationId).in('candidate_id', ids);
    if (ownRowIds.length) refreshedQuery = refreshedQuery.not('id', 'in', `(${ownRowIds.join(',')})`);
    if (ownEffectsFilter) refreshedQuery = refreshedQuery.or(ownEffectsFilter);
    const refreshed = await read(refreshedQuery.order('occurred_at', { ascending: false }).limit(101));
    recordedMessagesRead.data = refreshed.data;
    recordedMessagesRead.state = refreshed.state;
    states.recordedMessages = refreshed.state === 'available' ? 'partial' : refreshed.state;
  }
  const messages: CandidateActionSource[] = [];
  const scopedMessageRows = recordedMessagesRead.data.filter(row => scoped(row) || (!!projectId && !row.project_id));
  for (const row of scopedMessageRows) {
    const providerId = text(row.provider_message_id);
    if (excluded.has(providerId) || excluded.has(text(row.id))) continue;
    const detail = text(row.body_plain ?? row.body ?? row.content ?? row.text);
    if (!detail) continue;
    const audience = row.audience === 'team' ? 'team' : 'candidate';
    const ambiguous = !!projectId && !row.project_id;
    const emailSource = candidateActionStoredEmailSource(row);
    const source: CandidateActionSource = emailSource ? {
      ...emailSource,
      ...(ambiguous ? { type: 'ambiguous_message', title: 'Échange sans mission identifiée', projectId: null } : {}),
    } : {
      id: `candidate_action_messages:${text(row.id)}`, type: ambiguous ? 'ambiguous_message' : audience === 'team' ? 'team_message' : row.direction === 'inbound' ? 'inbound_message' : 'outbound_message',
      title: ambiguous ? 'Échange sans mission identifiée' : audience === 'team' ? 'Coordination avec l’équipe' : text(row.subject) || 'Échange avec le candidat',
      author: row.direction === 'outbound' ? nameOf(row.owner_user_id) : text(row.sender) || (audience === 'candidate' ? candidateName : 'Équipe'),
      timestamp: text(row.occurred_at), summary: detail.slice(0, 200), detail: detail.slice(0, 12000), projectId: ambiguous ? null : projectId,
      service: row.service as CandidateActionSource['service'], reference: { table: 'candidate_action_messages', id: text(row.id), version: text(row.occurred_at) },
    };
    messages.push(source);
    sources.push(source);
  }
  const recordedProviderSources = new Set(scopedMessageRows.map(row => `${row.channel}-${text(row.account_id)}-${text(row.provider_message_id)}`));
  messageReads.forEach((result, i) => {
    const key = i === 0 ? 'linkedinMessages' : 'emailMessages';
    states[key] = !readableChannels[i] || result.status === 'rejected' ? 'unavailable' : result.value.complete ? 'available' : 'partial';
    if (result.status === 'fulfilled') for (const source of result.value.messages) {
      if (excluded.has(source.reference?.id ?? '') || excluded.has(source.id)) continue;
      if (ownProviderSources.has(source.id)) continue;
      if (recordedProviderSources.has(source.id)) continue;
      const actualProjectId = source.reference?.table === 'provider_emails' ? source.projectId ?? null : projectId;
      if (projectId && actualProjectId && actualProjectId !== projectId) continue;
      const canonical = { ...source, projectId: actualProjectId,
        ...(projectId && !actualProjectId ? { type: 'ambiguous_message', title: 'Échange sans mission identifiée' } : {}),
      };
      messages.push(canonical);
      sources.push(canonical);
    }
  });
  if (projectId && messages.some(source => source.type === 'ambiguous_message')) warnings.push('Certains échanges ne sont pas rattachés à une mission. Ils sont visibles dans l’historique, mais ne justifient aucune action spécifique à la mission ouverte.');
  // Only stored posts with durable identifiers and dates are admissible. No provider call on chat open.
  const profile = record(candidate?.linkedin_profile_data);
  const posts = rows(profile.recent_posts ?? profile.recentPosts ?? profile.posts).filter(p => text(p.id) && text(p.url ?? p.share_url) && text(p.date ?? p.published_at)).slice(0, 5);
  states.posts = posts.length ? 'available' : 'unavailable';
  // phone_calls has no candidate identifier. A shared phone number cannot establish this linkage.
  states.phoneCallInsights = 'unavailable';
  for (const post of posts) add('stored_linkedin_posts', { ...post, created_at: post.date ?? post.published_at, created_by: '' }, 'post', 'Publication LinkedIn', json({ text: post.text, url: post.url ?? post.share_url }), null, 'linkedin');
  const sourceLabels: Record<string, string> = { contacts: 'Coordonnées', notes: 'Notes internes', comments: 'Commentaires de l’équipe', evaluations: 'Évaluations', reports: 'Comptes rendus', interviews: 'Entretiens', sequences: 'Séquences', sequenceEvents: 'Envois de séquence', process: 'Process de la mission', members: 'Membres de l’équipe', recordedMessages: 'Historique des échanges', linkedinMessages: 'Messages LinkedIn', emailMessages: 'E-mails', phoneCallInsights: 'Analyses des appels téléphoniques' };
  for (const [key, state] of Object.entries(states)) if (state !== 'available' && key !== 'posts') warnings.push(`${sourceLabels[key] || 'Contexte candidat'} : ${state === 'partial' ? 'historique partiel' : 'lecture indisponible'}. Les actions qui nécessitent ces informations attendront leur vérification.`);
  const ownEvaluationIds = evaluations.filter(r => r.created_by === userId && r.candidate_id === candidateId).map(r => text(r.id));
  const facts = {
    identityAliases: ids, profile, mission, candidacy: candidate,
    interviews, evaluations, reports, notes, comments, sequenceEvents: executionRead.data,
    sequenceEnrollments: enrollments, teamInterventions: conversations, processSteps: processRead.data,
    messages, posts, incomingSources: messages.filter(s => s.type === 'inbound_message'), ambiguousMessages: messages.filter(s => s.type === 'ambiguous_message'),
  };
  return { scope, candidateName, sources, sourceStates: states, facts, targets, members, ownEvaluationIds, warnings, contextVersion: await candidateActionContextVersion(scope, sources, states, targets) };
}

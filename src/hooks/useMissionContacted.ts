// Refonte mission, lot 5f-2b : candidats contactés d'une mission, pour l'onglet
// « Contactés » du panneau Prise de contact et la pastille du bouton.
//
// Trois lectures sous la RLS de la personne connectée (un collaborateur ne lit
// que ses inscriptions) : les inscriptions de la mission (id de la mission sous
// ses trois formes, missionEnrollmentJobIds), leurs exécutions utiles au statut
// (en attente, en échec, ou porteuses d'un motif), et les lignes du Pipeline des
// candidats contactés ou répondus, plus celles des candidats inscrits (fiche,
// photo). Le rangement en groupes est dans src/lib/contactedGroups.ts.
//
// Clé ['mission-contacted', id], hors de invalidateStageReaders : un geste
// d'étape (Retenir, Écarter) ne change pas les inscriptions, et cette lecture est
// lourde (inscriptions, exécutions, liens, lignes) ; elle est relue après une
// inscription (invalidateMissionContacted, appelé par les deux fenêtres), à
// chaque ouverture du panneau et au retour sur l'onglet.

import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { MISSION_ROW_LIGHT_COLUMNS, toMissionCandidateRow } from '@/components/missions/v3/types';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useMemberLinkedInAccounts } from '@/hooks/useMemberLinkedInAccounts';
import { useOrganization } from '@/hooks/useOrganization';
import { useMemberName } from '@/hooks/useTeamMembers';
import { MISSION_CONTACTED_KEY } from '@/lib/stageDisplay';
import { missionEnrollmentJobIds } from '@/lib/sequenceErrorMessages';
import { buildContacted, type ContactedEnrollment, type ContactedRow, type ContactedView } from '@/lib/contactedGroups';
import type { StatusLineExecution } from '@/lib/enrollmentStatusLine';

/** Inscriptions lues par mission, les plus récentes d'abord. */
export const CONTACTED_ENROLLMENT_LIMIT = 500;
/** Lignes du Pipeline lues pour les candidats contactés ou répondus. */
export const CONTACTED_ROW_LIMIT = 500;
/** Inscriptions par lecture d'exécutions. */
const EXECUTION_BATCH_SIZE = 40;
/** Identifiants par lecture de lignes du Pipeline (longueur de l'adresse). */
const ROW_ID_BATCH_SIZE = 80;
/** Statuts dont le statut affiché a besoin pour lire les exécutions. */
const EXECUTION_STATUSES = ['active', 'paused', 'stopped'];
/** Exécutions utiles : en attente, en échec, ou annulées avec un motif (effacement, réponse ailleurs). */
const EXECUTION_FILTER = 'skip_reason.not.is.null,status.in.(scheduled,waiting_event,quota_blocked,sending,failed)';

/** Colonnes des inscriptions lues (une constante littérale : la lecture reste typée). */
const ENROLLMENT_COLUMNS = 'id, sequence_id, profile_id, provider_id, resolved_profile_id, profile_name, profile_headline, profile_url, status, pause_reason, tracking_data, replied_at, completed_at, updated_at, created_at, created_by, account_id, sequence:outreach_sequences(name, is_active)';

export interface MissionContactedData {
  enrollments: ContactedEnrollment[];
  rows: ContactedRow[];
  /** Plus d'inscriptions ou de lignes contactées que la lecture n'en garde (les plus récentes sont rendues). */
  truncated: boolean;
  /** Conversation LinkedIn d'une inscription répondue ou arrêtée (lien du lot 0b). */
  chatByEnrollment: Map<string, string>;
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);

function toExecution(raw: unknown): (StatusLineExecution & { enrollment_id: string }) | null {
  const r = asRecord(raw);
  if (!r || typeof r.enrollment_id !== 'string' || typeof r.status !== 'string' || typeof r.scheduled_at !== 'string') return null;
  const stepRaw = Array.isArray(r.step) ? r.step[0] : r.step;
  const step = asRecord(stepRaw);
  return {
    enrollment_id: r.enrollment_id,
    status: r.status,
    scheduled_at: r.scheduled_at,
    executed_at: text(r.executed_at),
    error_message: text(r.error_message),
    skip_reason: text(r.skip_reason),
    final_message: text(r.final_message),
    step_order: typeof r.step_order === 'number' ? r.step_order : null,
    step: step
      ? {
          action_type: text(step.action_type),
          timeout_days: typeof step.timeout_days === 'number' ? step.timeout_days : null,
          wait_for_event: text(step.wait_for_event),
        }
      : null,
  };
}

async function readExecutions(enrollmentIds: string[]): Promise<Map<string, StatusLineExecution[]>> {
  const byEnrollment = new Map<string, StatusLineExecution[]>();
  for (let i = 0; i < enrollmentIds.length; i += EXECUTION_BATCH_SIZE) {
    const batch = enrollmentIds.slice(i, i + EXECUTION_BATCH_SIZE);
    const { data, error } = await supabase
      .from('sequence_step_executions')
      .select('enrollment_id, step_order, status, scheduled_at, executed_at, error_message, skip_reason, final_message, step:sequence_steps(action_type, timeout_days, wait_for_event)')
      .in('enrollment_id', batch)
      .or(EXECUTION_FILTER)
      .limit(1000);
    if (error) throw error;
    for (const raw of (data ?? []) as unknown[]) {
      const execution = toExecution(raw);
      if (!execution) continue;
      const list = byEnrollment.get(execution.enrollment_id);
      if (list) list.push(execution);
      else byEnrollment.set(execution.enrollment_id, [execution]);
    }
  }
  return byEnrollment;
}

async function readChats(enrollmentIds: string[]): Promise<Map<string, string>> {
  const chats = new Map<string, string>();
  for (let i = 0; i < enrollmentIds.length; i += ROW_ID_BATCH_SIZE) {
    const { data, error } = await supabase
      .from('mission_conversations')
      .select('enrollment_id, chat_id')
      .in('enrollment_id', enrollmentIds.slice(i, i + ROW_ID_BATCH_SIZE))
      .not('chat_id', 'is', null);
    // Lien de conversation facultatif : sans lui, « Voir la conversation » ouvre la messagerie.
    if (error) {
      console.warn('[useMissionContacted] conversations indisponibles:', error);
      return chats;
    }
    for (const r of data ?? []) if (r.enrollment_id && r.chat_id) chats.set(r.enrollment_id, r.chat_id);
  }
  return chats;
}

function toContactedRows(data: unknown): ContactedRow[] {
  if (!Array.isArray(data)) return [];
  const out: ContactedRow[] = [];
  for (const raw of data) {
    const row = toMissionCandidateRow(raw);
    if (!row) continue;
    out.push({
      id: row.id,
      candidateId: row.candidateId,
      name: row.name,
      headline: row.headline,
      linkedinUrl: row.linkedinUrl,
      pictureUrl: row.pictureUrl,
      stage: row.stage,
      contactedAt: row.contactedAt,
      repliedAt: row.repliedAt,
    });
  }
  return out;
}

async function readRows(projectId: string, candidateIds: string[]): Promise<{ rows: ContactedRow[]; truncated: boolean }> {
  const base = () => supabase
    .from('mission_candidate_rows')
    .select(MISSION_ROW_LIGHT_COLUMNS)
    .eq('project_id', projectId)
    .eq('is_unopened', false);

  // Contactés et répondus de la mission, inscrits ou non, les plus récemment contactés d'abord.
  const contacted = await base()
    .in('general_stage', ['contacted', 'replied'])
    .order('contacted_at', { ascending: false, nullsFirst: false })
    .order('id', { ascending: true })
    .limit(CONTACTED_ROW_LIMIT + 1);
  if (contacted.error) throw contacted.error;
  const all = toContactedRows(contacted.data);
  const truncated = all.length > CONTACTED_ROW_LIMIT;
  const rows = all.slice(0, CONTACTED_ROW_LIMIT);

  // Candidats inscrits que le Pipeline range ailleurs (Retenu avant le premier envoi, entretien…) : leur fiche et leur photo.
  const known = new Set(rows.map((row) => row.candidateId));
  const missing = candidateIds.filter((id) => !known.has(id));
  for (let i = 0; i < missing.length; i += ROW_ID_BATCH_SIZE) {
    const page = await base().in('candidate_id', missing.slice(i, i + ROW_ID_BATCH_SIZE)).order('id', { ascending: true }).limit(ROW_ID_BATCH_SIZE * 2);
    if (page.error) throw page.error;
    rows.push(...toContactedRows(page.data));
  }
  return { rows, truncated };
}

function toEnrollment(r: Record<string, unknown>, executions: Map<string, StatusLineExecution[]>): ContactedEnrollment {
  const sequenceRaw = Array.isArray(r.sequence) ? r.sequence[0] : r.sequence;
  const sequence = asRecord(sequenceRaw);
  return {
    id: String(r.id),
    sequenceId: String(r.sequence_id),
    sequenceName: text(sequence?.name),
    sequenceActive: typeof sequence?.is_active === 'boolean' ? sequence.is_active : null,
    profileId: String(r.profile_id),
    providerId: text(r.provider_id),
    resolvedProfileId: text(r.resolved_profile_id),
    profileName: text(r.profile_name),
    profileHeadline: text(r.profile_headline),
    profileUrl: text(r.profile_url),
    createdBy: text(r.created_by),
    accountId: text(r.account_id),
    createdAt: String(r.created_at),
    status: String(r.status),
    pause_reason: text(r.pause_reason),
    tracking_data: r.tracking_data,
    replied_at: text(r.replied_at),
    completed_at: text(r.completed_at),
    updated_at: text(r.updated_at),
    executions: executions.get(String(r.id)) ?? [],
  };
}

async function readMissionContacted(projectId: string, projectJobId: string | null): Promise<MissionContactedData> {
  const jobIds = missionEnrollmentJobIds(projectId, projectJobId);
  const { data, error } = await supabase
    .from('sequence_enrollments')
    .select(ENROLLMENT_COLUMNS)
    .in('job_id', jobIds)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false })
    .limit(CONTACTED_ENROLLMENT_LIMIT + 1);
  if (error) throw error;

  const all = (data ?? []) as unknown as Array<Record<string, unknown>>;
  const enrollmentsTruncated = all.length > CONTACTED_ENROLLMENT_LIMIT;
  const raws = all.slice(0, CONTACTED_ENROLLMENT_LIMIT);

  const profileIds = (list: Array<Record<string, unknown>>) => [...new Set(list.map((r) => String(r.profile_id)))];
  const { rows, truncated: rowsTruncated } = await readRows(projectId, profileIds(raws));

  // Plafond atteint : l'inscription d'un candidat du Pipeline peut être au-delà. Sans elle, il serait dit
  // « contacté hors séquence » ; on lit donc les inscriptions des candidats de ces lignes, quel que soit leur âge.
  if (enrollmentsTruncated) {
    const known = new Set(raws.flatMap((r) => [text(r.profile_id), text(r.provider_id), text(r.resolved_profile_id)]).filter((id): id is string => !!id));
    const unmatched = [...new Set(rows.map((row) => row.candidateId))].filter((id) => !known.has(id));
    const seen = new Set(raws.map((r) => String(r.id)));
    for (let i = 0; i < unmatched.length; i += ROW_ID_BATCH_SIZE) {
      const page = await supabase
        .from('sequence_enrollments')
        .select(ENROLLMENT_COLUMNS)
        .in('job_id', jobIds)
        .in('profile_id', unmatched.slice(i, i + ROW_ID_BATCH_SIZE))
        .order('created_at', { ascending: false })
        .limit(ROW_ID_BATCH_SIZE * 4);
      if (page.error) throw page.error;
      for (const extra of (page.data ?? []) as unknown as Array<Record<string, unknown>>) {
        if (seen.has(String(extra.id))) continue;
        seen.add(String(extra.id));
        raws.push(extra);
      }
    }
  }

  const withExecutions = raws.filter((r) => EXECUTION_STATUSES.includes(String(r.status))).map((r) => String(r.id));
  const withChats = raws.filter((r) => r.status === 'replied' || r.status === 'stopped').map((r) => String(r.id));
  const [executions, chatByEnrollment] = await Promise.all([readExecutions(withExecutions), readChats(withChats)]);

  return {
    enrollments: raws.map((r) => toEnrollment(r, executions)),
    rows,
    chatByEnrollment,
    truncated: enrollmentsTruncated || rowsTruncated,
  };
}

/**
 * Inscriptions et lignes du Pipeline des candidats contactés d'une mission.
 * `data` est absent tant que la lecture n'a pas abouti : jamais de liste vide
 * inventée (une lecture en échec est `isError`).
 */
export function useMissionContacted(
  projectId: string | null | undefined,
  projectJobId: string | null | undefined,
  options?: { enabled?: boolean },
) {
  const id = projectId ?? null;
  return useQuery({
    queryKey: [MISSION_CONTACTED_KEY, id],
    queryFn: () => readMissionContacted(id as string, projectJobId ?? null),
    enabled: id !== null && (options?.enabled ?? true),
    staleTime: 30_000,
    // Ouvrir le panneau relit toujours : une pause ou une reprise faite sur la page d'une séquence y apparaît.
    refetchOnMount: 'always',
    refetchOnWindowFocus: true,
  });
}

/**
 * La liste rangée en groupes, avec le contexte de la personne connectée (ses
 * gestes sur le statut : reconnecter son compte, réactiver une séquence, nom de
 * l'auteur d'un arrêt). `view` est null tant que la lecture n'a pas abouti.
 */
export function useMissionContactedView(
  projectId: string | null | undefined,
  projectJobId: string | null | undefined,
  options?: { enabled?: boolean },
) {
  const query = useMissionContacted(projectId, projectJobId, options);
  const { isAdmin, isCollaborator } = useOrganization();
  const { user } = useAuthReady();
  const memberName = useMemberName();
  const { getUserLinkedAccountId } = useMemberLinkedInAccounts();
  const userId = user?.id ?? null;
  const myAccountId = userId ? getUserLinkedAccountId(userId) : null;
  const data = query.data;
  const view = useMemo<ContactedView | null>(
    // Un collaborateur ne lit que ses inscriptions : un candidat de séquence d'un collègue ne doit pas passer pour contacté à la main.
    () => (data ? buildContacted(data.enrollments, data.rows, { memberName, canManageSequence: isAdmin, myAccountId, includeManual: !isCollaborator }) : null),
    [data, isAdmin, isCollaborator, myAccountId, memberName],
  );
  return { ...query, view };
}

/**
 * Effectifs des groupes, sans contexte de personne : la pastille du bouton
 * « Prise de contact » les lit (les groupes ne dépendent pas des gestes proposés).
 * `counts` est null tant que la lecture n'a pas abouti : jamais un zéro inventé.
 */
export function useMissionContactedCounts(
  projectId: string | null | undefined,
  projectJobId: string | null | undefined,
  options?: { enabled?: boolean },
) {
  const query = useMissionContacted(projectId, projectJobId, options);
  const data = query.data;
  const counts = useMemo(() => (data ? buildContacted(data.enrollments, data.rows).counts : null), [data]);
  return { counts, isError: query.isError };
}

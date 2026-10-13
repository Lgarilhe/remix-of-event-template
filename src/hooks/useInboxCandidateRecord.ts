import { useQuery } from '@tanstack/react-query';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { candidateOfMissionRow, type MissionRow } from '@/hooks/useATSData';
import { supabase } from '@/integrations/supabase/client';
import { candidateLinkedInSlug } from '@/lib/candidateProfile';
import { inboxCandidateIdentityIds, selectInboxCandidateRecords, type InboxCandidateRecordInput } from '@/lib/inboxCandidateRecord';

export type { InboxCandidateRecord, InboxCandidateRecordInput } from '@/lib/inboxCandidateRecord';
export { buildTransientInboxCandidate } from '@/lib/inboxCandidateRecord';

// Les lignes sont bornées à cette personne et à l'organisation ; jamais tout le pipeline.
const COLUMNS: string = 'id, organization_id, candidate_id, candidate_name, candidate_headline, linkedin_profile_url, linkedin_profile_data, status, pipeline_stage, general_stage, process_step_id, stage_entered_at, score, recommendation, job_id, project_id, mission_name, tags, updated_at, created_at, scoring_details, contacted_at, replied_at, first_interview_at, hired_at, rejected_from_stage, is_unopened, group_ids, picture:linkedin_profile_data->>profile_picture_url, picture_large:linkedin_profile_data->>profile_picture_url_large';
const PAGE_SIZE = 50;
const MAX_PAGES = 20;
type InboxMissionRow = MissionRow & { organization_id: string | null; linkedin_profile_data: unknown };

export class InboxCandidateRecordError extends Error {
  constructor() {
    super('Impossible de retrouver la fiche de ce candidat. Réessayez.');
    this.name = 'InboxCandidateRecordError';
  }
}

export async function fetchInboxCandidateRecord(organizationId: string, input: InboxCandidateRecordInput) {
  if (!organizationId) throw new InboxCandidateRecordError();
  const ids = inboxCandidateIdentityIds(input);
  const slug = candidateLinkedInSlug(input.profileUrl);
  const read = async (byUrl: boolean) => {
    const rows: InboxMissionRow[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      let query = supabase.from('mission_candidate_rows').select(COLUMNS).eq('organization_id', organizationId);
      query = byUrl
        ? query.ilike('linkedin_profile_url', `%/in/${slug!.replace(/[\\%_]/g, '\\$&')}%`)
        : query.in('candidate_id', ids);
      const { data, error } = await query.order('updated_at', { ascending: false }).order('id', { ascending: true })
        .range(page * PAGE_SIZE, (page + 1) * PAGE_SIZE - 1);
      if (error) throw new InboxCandidateRecordError();
      const received = (data ?? []) as unknown as InboxMissionRow[];
      rows.push(...received.filter(row => row.organization_id === organizationId
        && typeof row.id === 'string' && !!row.id && typeof row.candidate_id === 'string' && !!row.candidate_id
        && (byUrl ? candidateLinkedInSlug(row.linkedin_profile_url) === slug : ids.includes(row.candidate_id))));
      if (received.length < PAGE_SIZE) return rows;
    }
    // Une lecture tronquée ne doit pas décider à la place du recruteur.
    throw new InboxCandidateRecordError();
  };
  const results = await Promise.all([...(ids.length ? [read(false)] : []), ...(slug ? [read(true)] : [])]);
  const rows = [...new Map(results.flat().map(row => [row.id, row])).values()];
  const candidates = rows.map(row => ({ ...candidateOfMissionRow(row), linkedinProfileData: row.linkedin_profile_data ?? null }));
  return selectInboxCandidateRecords(candidates, input);
}

/** Un résultat tardif reste dans le cache de sa personne, conversation et organisation de départ. */
export function useInboxCandidateRecord(input: InboxCandidateRecordInput) {
  const { user, isReady } = useAuthReady();
  const { organizationId } = useOrganization();
  const snapshot = { ...input, aliases: [...(input.aliases ?? [])] };
  const ids = inboxCandidateIdentityIds(snapshot);
  const queryKey = ['inbox-candidate-record', user?.id, organizationId, snapshot.chatId,
    ids, snapshot.profileUrl ?? null, snapshot.projectId ?? null,
    snapshot.name || snapshot.profileName || '', snapshot.headline ?? null, snapshot.photo ?? null];
  return useQuery({
    queryKey,
    queryFn: () => fetchInboxCandidateRecord(organizationId!, snapshot),
    enabled: isReady && !!user && !!organizationId && !!snapshot.chatId,
    staleTime: 60_000,
    retry: false,
  });
}

import type { SupabaseClient } from '@supabase/supabase-js';
import type { Database } from '@/integrations/supabase/types';
import type { SequenceEnrollmentInfo } from '@/hooks/useMessagesInbox';

type EnrollmentRow = Omit<SequenceEnrollmentInfo, 'outreach_config' | 'client_name'>;
const PAGE_SIZE = 500;
const COLUMNS = 'profile_id, provider_id, resolved_profile_id, job_title, job_id, status, replied_at, current_step_order, pause_reason, completion_reason:tracking_data->>completion_reason, manual_stop:tracking_data->manual_stop';

/** Le contexte récent, plus toutes les séquences actives, même anciennes. */
export async function fetchInboxEnrollmentRows(client: SupabaseClient<Database>, organizationId: string): Promise<EnrollmentRow[]> {
  if (!organizationId) return [];
  const query = () => client.from('sequence_enrollments')
    .select<string, EnrollmentRow>(COLUMNS)
    .eq('organization_id', organizationId)
    .order('created_at', { ascending: false })
    .order('id', { ascending: false });

  const recent = await query().limit(PAGE_SIZE);
  if (recent.error) throw recent.error;
  const rows = [...(recent.data ?? [])];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const active = await query().eq('status', 'active').range(offset, offset + PAGE_SIZE - 1);
    if (active.error) throw active.error;
    rows.push(...(active.data ?? []));
    if ((active.data?.length ?? 0) < PAGE_SIZE) break;
  }
  return rows;
}

/** Chaque alias LinkedIn retrouve la séquence ; une active prime sur l'historique. */
export function indexInboxEnrollments<T extends Pick<SequenceEnrollmentInfo, 'profile_id' | 'provider_id' | 'resolved_profile_id' | 'status'>>(rows: T[]): Map<string, T> {
  const index = new Map<string, T>();
  for (const row of rows) {
    for (const id of [row.profile_id, row.provider_id, row.resolved_profile_id]) {
      if (!id) continue;
      const previous = index.get(id);
      if (!previous || (row.status === 'active' && previous.status !== 'active')) index.set(id, row);
    }
  }
  return index;
}

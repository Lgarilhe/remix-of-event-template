import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useOrganization } from '@/hooks/useOrganization';
import { useNow } from '@/hooks/sidebar/useNow';
import { groupMultichannelConversations, type MultichannelCandidateLabel, type MultichannelProjectLabel } from '@/lib/multichannelInbox';
import { SERVICE_LABELS, type MessagingService } from '@/lib/messagingServices';
import type { CandidateActionMessageRecord } from '@/lib/candidateActions';

const isService = (value: string): value is MessagingService => Object.prototype.hasOwnProperty.call(SERVICE_LABELS, value);
const PAGE = 500;

/** Lecture avec le JWT personnel : les politiques protègent aussi les boîtes de collègues. */
export function useMultichannelInbox() {
  const { user, isReady } = useAuthReady();
  const { organizationId } = useOrganization();
  const now = useNow(30_000);
  const query = useQuery({
    queryKey: ['multichannel-inbox', user?.id, organizationId],
    enabled: isReady && !!user && !!organizationId,
    staleTime: 30_000,
    refetchInterval: 30_000,
    retry: false,
    queryFn: async () => {
      const messages: CandidateActionMessageRecord[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await supabase.from('candidate_action_messages').select('*').eq('organization_id', organizationId!).eq('audience', 'candidate').neq('channel', 'linkedin').order('occurred_at', { ascending: false }).order('id').range(from, from + PAGE - 1);
        if (error) throw error;
        for (const row of data ?? []) {
          if ((row.channel !== 'email' && row.channel !== 'whatsapp') || !isService(row.service) || (row.direction !== 'inbound' && row.direction !== 'outbound') || row.audience !== 'candidate') continue;
          messages.push({ ...row, channel: row.channel, service: row.service, direction: row.direction, audience: 'candidate' });
        }
        if ((data?.length ?? 0) < PAGE) break;
      }
      const ids = [...new Set(messages.map(row => row.candidate_id))];
      const [candidateRead, projectRead] = await Promise.all([
        (async () => {
          const rows: MultichannelCandidateLabel[] = [];
          for (let offset = 0; offset < ids.length; offset += 100) {
            for (let from = 0; ; from += PAGE) {
              const { data, error } = await supabase.from('job_candidate_status').select('candidate_id, candidate_name, linkedin_profile_url, linkedin_profile_data, project_id, job_id').eq('organization_id', organizationId!).in('candidate_id', ids.slice(offset, offset + 100)).order('id').range(from, from + PAGE - 1);
              if (error) return { rows, incomplete: true };
              rows.push(...(data ?? []));
              if ((data?.length ?? 0) < PAGE) break;
            }
          }
          return { rows, incomplete: false };
        })(),
        (async () => {
          const rows: MultichannelProjectLabel[] = [];
          if (!messages.length) return { rows, incomplete: false };
          for (let from = 0; ; from += PAGE) {
            const { data, error } = await supabase.from('sourcing_projects').select('id, name, job_title, job_id').eq('organization_id', organizationId!).order('id').range(from, from + PAGE - 1);
            if (error) return { rows, incomplete: true };
            rows.push(...(data ?? []));
            if ((data?.length ?? 0) < PAGE) break;
          }
          return { rows, incomplete: false };
        })(),
      ]);
      return { messages, candidates: candidateRead.rows, projects: projectRead.rows, incompleteLabels: candidateRead.incomplete || projectRead.incomplete };
    },
  });
  const data = query.data;
  const conversations = data ? groupMultichannelConversations(data.messages, data.candidates, data.projects, new Date(now)) : [];
  return { ...query, conversations, incompleteLabels: !!data?.incompleteLabels };
}

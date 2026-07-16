import { useQuery } from '@tanstack/react-query';

import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';

export interface NotionConnectionStatus {
  connected: boolean;
  needs_reauthorization: boolean;
  workspace_id: string | null;
  email_domain: string | null;
  connected_at: string | null;
  expires_at: string | null;
  has_error: boolean;
}

export interface NotionStatusResponse extends Record<string, unknown> {
  success?: boolean;
  can_manage?: boolean;
  connection?: NotionConnectionStatus | null;
  error?: string;
}

export const notionMcpStatusQueryKey = (organizationId?: string | null, userId?: string | null) => [
  'notion-mcp-status',
  organizationId,
  userId,
] as const;

export function isUsableNotionConnection(connection?: NotionConnectionStatus | null): boolean {
  return connection?.connected === true
    && !connection.needs_reauthorization
    && !connection.has_error;
}

export function useNotionMcpStatus(organizationId?: string | null, userId?: string | null) {
  return useQuery({
    queryKey: notionMcpStatusQueryKey(organizationId, userId),
    queryFn: async () => {
      const { data, error } = await invokeEdgeFunction<NotionStatusResponse>('notion-mcp-oauth', {
        action: 'status',
      });
      if (error || data.success === false) {
        throw error ?? new Error(data.error || 'Statut Notion indisponible');
      }
      return data;
    },
    enabled: Boolean(organizationId && userId),
    staleTime: 30_000,
    retry: 1,
  });
}

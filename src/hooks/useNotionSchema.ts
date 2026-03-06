import { useQuery } from '@tanstack/react-query';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';

export interface NotionFieldSchema {
  type: 'select' | 'multi_select' | 'status';
  options: { name: string; color: string }[];
}

export type NotionSchema = Record<string, NotionFieldSchema>;

async function fetchSchema(): Promise<NotionSchema> {
  const { data, error } = await invokeEdgeFunction('fetch-notion-schema');
  if (error) throw error;
  if (!data?.success) throw new Error(data?.error || 'Failed to fetch schema');
  return data.schema || {};
}

export function useNotionSchema() {
  return useQuery({
    queryKey: ['notion-schema'],
    queryFn: fetchSchema,
    staleTime: 60 * 60 * 1000, // 1 hour
    gcTime: 2 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
  });
}

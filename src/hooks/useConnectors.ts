import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { toast } from 'sonner';

export interface ConnectorDefinition {
  id: string;
  name: string;
  description: string | null;
  category: string;
  config_schema: Record<string, any>;
  is_active: boolean;
  icon_url: string | null;
  created_at: string;
}

export interface ConnectorInstance {
  id: string;
  organization_id: string;
  connector_id: string;
  config: Record<string, any>;
  status: 'active' | 'disconnected' | 'error';
  last_sync_at: string | null;
  error_message: string | null;
  sync_schedule: string;
  next_sync_at: string | null;
  sync_entities: string[];
  total_synced_records: number;
  created_at: string;
  updated_at: string;
  // Joined
  connector?: ConnectorDefinition;
}

export interface SyncRun {
  id: string;
  organization_id: string;
  connector_instance_id: string;
  entity_type: string;
  direction: 'pull' | 'push' | 'full';
  started_at: string;
  completed_at: string | null;
  status: 'pending' | 'running' | 'success' | 'partial' | 'failed';
  records_processed: number;
  records_created: number;
  records_updated: number;
  records_failed: number;
  error_message: string | null;
}

/** Fetch all available connectors from registry */
export const useConnectorRegistry = () => {
  return useQuery({
    queryKey: ['connector-registry'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('connector_registry')
        .select('*')
        .eq('is_active', true)
        .order('category', { ascending: true });
      if (error) throw error;
      return (data || []) as ConnectorDefinition[];
    },
    staleTime: 30 * 60 * 1000,
  });
};

/** Fetch org's connector instances with their definitions */
export const useConnectorInstances = () => {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  const { data: instances = [], isLoading } = useQuery({
    queryKey: ['connector-instances', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from('connector_instances')
        .select('*, connector:connector_registry(*)')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as ConnectorInstance[];
    },
    enabled: !!organizationId,
    staleTime: 5 * 60 * 1000,
  });

  // Activate a connector
  const activate = useMutation({
    mutationFn: async (input: { connector_id: string; config: Record<string, any> }) => {
      if (!organizationId) throw new Error('No organization');
      const { data, error } = await supabase
        .from('connector_instances')
        .insert({
          organization_id: organizationId,
          connector_id: input.connector_id,
          config: input.config,
          status: 'active',
        })
        .select('*, connector:connector_registry(*)')
        .single();
      if (error) throw error;
      return data as ConnectorInstance;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connector-instances', organizationId] });
      toast.success('Connecteur activé');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Update config
  const updateConfig = useMutation({
    mutationFn: async ({ id, config }: { id: string; config: Record<string, any> }) => {
      const { error } = await supabase
        .from('connector_instances')
        .update({ config, updated_at: new Date().toISOString() })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connector-instances', organizationId] });
      toast.success('Configuration mise à jour');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  // Disconnect
  const disconnect = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('connector_instances')
        .update({ status: 'disconnected' })
        .eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connector-instances', organizationId] });
      toast.success('Connecteur déconnecté');
    },
    onError: (err: Error) => toast.error(err.message),
  });

  return {
    instances,
    isLoading,
    activate: activate.mutateAsync,
    isActivating: activate.isPending,
    updateConfig: updateConfig.mutateAsync,
    disconnect: disconnect.mutateAsync,
  };
};

/** Fetch sync runs for a connector instance */
export const useConnectorSyncRuns = (instanceId: string | undefined) => {
  return useQuery({
    queryKey: ['connector-sync-runs', instanceId],
    queryFn: async () => {
      if (!instanceId) return [];
      const { data, error } = await (supabase
        .from('connector_sync_runs' as any)
        .select('*')
        .eq('connector_instance_id', instanceId)
        .order('started_at', { ascending: false })
        .limit(20)) as any;
      if (error) throw error;
      return (data || []) as SyncRun[];
    },
    enabled: !!instanceId,
    staleTime: 30 * 1000,
  });
};

/** Trigger a manual sync */
export const useTriggerSync = () => {
  const queryClient = useQueryClient();
  const { organizationId } = useOrganization();

  return useMutation({
    mutationFn: async (input: { instanceId: string; entityType: string }) => {
      if (!organizationId) throw new Error('No organization');

      // Create a sync run record
      const { data: run, error: runErr } = await (supabase
        .from('connector_sync_runs' as any)
        .insert({
          organization_id: organizationId,
          connector_instance_id: input.instanceId,
          entity_type: input.entityType,
          status: 'running',
        })
        .select()
        .single();
      if (runErr) throw runErr;

      // The actual sync would be triggered via an edge function
      // For now, we just create the run record and let the edge function handle it
      // TODO: invoke connector-sync edge function

      return run as SyncRun;
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ['connector-sync-runs', variables.instanceId] });
      toast.success('Synchronisation lancée');
    },
    onError: (err: Error) => toast.error(err.message),
  });
};

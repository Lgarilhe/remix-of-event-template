import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Plug, Check, X, Loader2, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';

interface ConnectorRow {
  id: string;
  name: string;
  description: string | null;
  category: string;
  is_active: boolean;
}

interface InstanceRow {
  id: string;
  connector_id: string;
  status: string;
  last_sync_at: string | null;
  error_message: string | null;
}

const categoryLabels: Record<string, string> = {
  sourcing: 'Sourcing',
  ats: 'ATS',
  crm: 'CRM',
  communication: 'Communication',
  scheduling: 'Planning',
  evaluation: 'Évaluation',
  other: 'Autre',
};

export const ConnectorSettings = () => {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();

  const { data: connectors = [], isLoading: loadingConnectors } = useQuery({
    queryKey: ['connector-registry'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('connector_registry')
        .select('*')
        .eq('is_active', true)
        .order('category');
      if (error) throw error;
      return (data || []) as ConnectorRow[];
    },
  });

  const { data: instances = [], isLoading: loadingInstances } = useQuery({
    queryKey: ['connector-instances', organizationId],
    queryFn: async () => {
      if (!organizationId) return [];
      const { data, error } = await supabase
        .from('connector_instances')
        .select('*')
        .eq('organization_id', organizationId);
      if (error) throw error;
      return (data || []) as InstanceRow[];
    },
    enabled: !!organizationId,
  });

  const toggleConnector = useMutation({
    mutationFn: async ({ connectorId, enable }: { connectorId: string; enable: boolean }) => {
      if (!organizationId) throw new Error('No org');
      if (enable) {
        const { error } = await supabase.from('connector_instances').insert({
          organization_id: organizationId,
          connector_id: connectorId,
          status: 'active',
        });
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from('connector_instances')
          .delete()
          .eq('organization_id', organizationId)
          .eq('connector_id', connectorId);
        if (error) throw error;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connector-instances'] });
      toast.success('Connecteur mis à jour');
    },
    onError: () => toast.error('Erreur lors de la mise à jour'),
  });

  const instanceMap = new Map(instances.map(i => [i.connector_id, i]));

  const grouped = connectors.reduce<Record<string, ConnectorRow[]>>((acc, c) => {
    (acc[c.category] = acc[c.category] || []).push(c);
    return acc;
  }, {});

  if (loadingConnectors || loadingInstances) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <Plug className="w-4 h-4" />
            Connecteurs Knowledge Lake
          </CardTitle>
          <p className="text-xs text-muted-foreground mt-1">
            Activez les connecteurs pour alimenter automatiquement le contexte IA de vos candidats et postes.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          {Object.entries(grouped).map(([category, items]) => (
            <div key={category}>
              <h3 className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground mb-3">
                {categoryLabels[category] || category}
              </h3>
              <div className="space-y-2">
                {items.map(connector => {
                  const instance = instanceMap.get(connector.id);
                  const isActive = !!instance;

                  return (
                    <div
                      key={connector.id}
                      className="flex items-center justify-between py-3 px-3 border border-foreground/10 rounded-sm hover:bg-muted/30 transition-colors"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className={`w-8 h-8 rounded-sm flex items-center justify-center ${isActive ? 'bg-primary/10' : 'bg-muted'}`}>
                          <Plug className={`w-4 h-4 ${isActive ? 'text-primary' : 'text-muted-foreground'}`} />
                        </div>
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-foreground">{connector.name}</p>
                          {connector.description && (
                            <p className="text-xs text-muted-foreground truncate">{connector.description}</p>
                          )}
                        </div>
                      </div>

                      <div className="flex items-center gap-2 shrink-0">
                        {instance?.error_message && (
                          <Badge variant="destructive" className="text-[10px]">Erreur</Badge>
                        )}
                        {isActive && (
                          <Badge variant="secondary" className="text-[10px] bg-emerald-500/10 text-emerald-600">
                            <Check className="w-3 h-3 mr-1" />
                            Actif
                          </Badge>
                        )}
                        <Button
                          size="sm"
                          variant={isActive ? 'ghost' : 'default'}
                          className="h-7 text-xs"
                          disabled={toggleConnector.isPending}
                          onClick={() => toggleConnector.mutate({ connectorId: connector.id, enable: !isActive })}
                        >
                          {toggleConnector.isPending ? (
                            <Loader2 className="w-3 h-3 animate-spin" />
                          ) : isActive ? (
                            <>
                              <X className="w-3 h-3 mr-1" />
                              Désactiver
                            </>
                          ) : (
                            <>
                              <Plug className="w-3 h-3 mr-1" />
                              Activer
                            </>
                          )}
                        </Button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  );
};

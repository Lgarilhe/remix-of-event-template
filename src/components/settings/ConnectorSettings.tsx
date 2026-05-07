import { useState } from 'react';
import { useOrganization } from '@/hooks/useOrganization';
import { supabase } from '@/integrations/supabase/client';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { Loader2, Power, PowerOff, CheckCircle2, AlertCircle } from 'lucide-react';
import { cn } from '@/lib/utils';
import { format } from 'date-fns';
import { fr } from 'date-fns/locale';

interface ConnectorRegistry {
  id: string;
  name: string;
  description: string | null;
  icon_url: string | null;
  category: string;
  config_schema: Record<string, unknown>;
  is_active: boolean;
  created_at: string;
}

interface ConnectorInstance {
  id: string;
  organization_id: string;
  connector_id: string;
  config: Record<string, unknown>;
  status: string;
  last_sync_at: string | null;
  error_message: string | null;
  created_at: string;
  updated_at: string;
}

const CATEGORY_LABELS: Record<string, string> = {
  ats: 'ATS',
  sourcing: 'SOURCING',
  communication: 'MESSAGERIE',
  telephony: 'TÉLÉPHONIE',
  scheduling: 'CALENDRIER',
  crm: 'CRM',
  sirh: 'SIRH',
  evaluation: 'ÉVALUATION',
  enrichment: 'ENRICHISSEMENT',
  custom: 'CUSTOM',
  other: 'AUTRE',
};

const CATEGORY_ORDER = ['ats', 'crm', 'sourcing', 'communication', 'telephony', 'scheduling', 'evaluation', 'sirh', 'enrichment', 'custom', 'other'];

export const ConnectorSettings = () => {
  const { organizationId } = useOrganization();
  const queryClient = useQueryClient();
  const [loadingId, setLoadingId] = useState<string | null>(null);

  const { data: registry = [], isLoading: loadingRegistry } = useQuery({
    queryKey: ['connector-registry'],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('connector_registry')
        .select('*')
        .eq('is_active', true)
        .order('category')
        .order('name');
      if (error) throw error;
      return (data || []) as ConnectorRegistry[];
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
      return (data || []) as ConnectorInstance[];
    },
    enabled: !!organizationId,
  });

  const activateConnector = useMutation({
    mutationFn: async (connectorId: string) => {
      if (!organizationId) throw new Error('No org');
      setLoadingId(connectorId);
      const { error } = await supabase
        .from('connector_instances')
        .upsert({
          organization_id: organizationId,
          connector_id: connectorId,
          status: 'active',
          config: {},
        }, { onConflict: 'organization_id,connector_id' });
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connector-instances'] });
      toast.success('Connecteur activé');
    },
    onError: () => toast.error('Erreur lors de l\'activation'),
    onSettled: () => setLoadingId(null),
  });

  const deactivateConnector = useMutation({
    mutationFn: async (instanceId: string) => {
      setLoadingId(instanceId);
      const { error } = await supabase
        .from('connector_instances')
        .update({ status: 'disconnected' })
        .eq('id', instanceId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['connector-instances'] });
      toast.success('Connecteur désactivé');
    },
    onError: () => toast.error('Erreur lors de la désactivation'),
    onSettled: () => setLoadingId(null),
  });

  const activeInstances = instances.filter(i => i.status === 'active');
  const activeConnectorIds = new Set(activeInstances.map(i => i.connector_id));
  const availableConnectors = registry.filter(r => !activeConnectorIds.has(r.id));

  // Group available by category
  const groupedAvailable = availableConnectors.reduce<Record<string, ConnectorRegistry[]>>((acc, c) => {
    const cat = c.category || 'other';
    if (!acc[cat]) acc[cat] = [];
    acc[cat].push(c);
    return acc;
  }, {});

  const isLoading = loadingRegistry || loadingInstances;

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Active connectors */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <CheckCircle2 className="w-4 h-4 text-success" />
            Connecteurs actifs
            <Badge variant="secondary" className="ml-auto text-xs">
              {activeInstances.length}
            </Badge>
          </CardTitle>
        </CardHeader>
        <CardContent>
          {activeInstances.length === 0 ? (
            <p className="text-sm text-muted-foreground py-4">Aucun connecteur activé.</p>
          ) : (
            <div className="space-y-3">
              {activeInstances.map(instance => {
                const reg = registry.find(r => r.id === instance.connector_id);
                return (
                  <div
                    key={instance.id}
                    className="flex items-center justify-between py-3 border-b border-border last:border-0"
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="w-8 h-8 rounded bg-success/10 flex items-center justify-center shrink-0">
                        <Power className="w-4 h-4 text-success" />
                      </div>
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-foreground truncate">
                          {reg?.name || instance.connector_id}
                        </p>
                        <div className="flex items-center gap-2 text-xs text-muted-foreground">
                          <Badge variant="outline" className="text-xs px-1.5 py-0 border-success text-success">
                            ACTIF
                          </Badge>
                          {instance.last_sync_at && (
                            <span>
                              Sync : {format(new Date(instance.last_sync_at), 'dd MMM yyyy HH:mm', { locale: fr })}
                            </span>
                          )}
                          {instance.error_message && (
                            <span className="text-destructive flex items-center gap-1">
                              <AlertCircle className="w-3 h-3" />
                              {instance.error_message}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-8 text-xs text-destructive hover:text-destructive shrink-0"
                      disabled={loadingId === instance.id}
                      onClick={() => deactivateConnector.mutate(instance.id)}
                    >
                      {loadingId === instance.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <PowerOff className="w-3.5 h-3.5 mr-1" />
                      )}
                      Désactiver
                    </Button>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Available connectors by category */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            Connecteurs disponibles
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          {CATEGORY_ORDER.filter(cat => groupedAvailable[cat]?.length).map(cat => (
            <div key={cat}>
              <h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3 border-b border-border pb-1.5">
                {CATEGORY_LABELS[cat] || cat.toUpperCase()}
              </h3>
              <div className="space-y-2">
                {groupedAvailable[cat].map(connector => (
                  <div
                    key={connector.id}
                    className="flex items-center justify-between py-2.5 border-b border-border/5 last:border-0"
                  >
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-foreground">{connector.name}</p>
                      {connector.description && (
                        <p className="text-xs text-muted-foreground truncate max-w-[280px]">
                          {connector.description}
                        </p>
                      )}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-8 text-xs shrink-0"
                      disabled={loadingId === connector.id}
                      onClick={() => activateConnector.mutate(connector.id)}
                    >
                      {loadingId === connector.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                      ) : (
                        <Power className="w-3.5 h-3.5 mr-1" />
                      )}
                      Activer
                    </Button>
                  </div>
                ))}
              </div>
            </div>
          ))}

          {availableConnectors.length === 0 && (
            <p className="text-sm text-muted-foreground py-4">Tous les connecteurs sont déjà activés.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
};

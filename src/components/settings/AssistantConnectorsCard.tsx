import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Plug } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { ErrorBox } from '@/components/layout/ErrorBox';
import { NotionConnectorRow } from '@/components/settings/NotionConnectorRow';
import { useOrganization } from '@/hooks/useOrganization';
import { supabase } from '@/integrations/supabase/client';
import { RESERVED_BUILTIN_CONNECTORS, connectorLabel } from '@/lib/assistantConnectors';

/**
 * « Applications connectées » (Paramètres › Connexions, #applications) : la liste des
 * connecteurs que l'assistant peut consulter. Notion y est une ligne parmi d'autres,
 * à côté des connecteurs ajoutés par l'organisation (Règles de l'assistant, #connecteurs).
 */
export function AssistantConnectorsCard() {
  const { organizationId, isAdmin } = useOrganization();

  const { data: orgConnectors = [], isError, refetch } = useQuery({
    // Cache à part de AgentConnectorsSettings (forme de gestion complète) et du chat.
    queryKey: ['account-org-mcp-servers', organizationId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from('organization_mcp_servers')
        .select('name')
        .eq('organization_id', organizationId)
        .eq('enabled', true)
        .order('name', { ascending: true });
      if (error) throw error;
      return (data ?? []).filter((server) => !RESERVED_BUILTIN_CONNECTORS.has(server.name.toLowerCase()));
    },
    enabled: Boolean(organizationId),
    staleTime: 30_000,
  });

  return (
    <Card>
      <CardHeader className="space-y-1">
        <CardTitle className="text-sm font-semibold">Applications connectées</CardTitle>
        <p className="text-sm text-muted-foreground">
          L’assistant peut chercher et lire dans ces applications pendant vos conversations, jamais y modifier quoi que ce soit.
          Vos connexions vous sont personnelles : les autres membres ne peuvent pas utiliser vos accès.
        </p>
      </CardHeader>

      <CardContent className="space-y-3">
        <div className="divide-y divide-border rounded-lg border border-border">
          <NotionConnectorRow />
          {orgConnectors.map((server) => (
            <div key={server.name} className="flex items-center gap-3 px-3 py-3">
              <span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-border bg-muted" aria-hidden="true">
                <Plug className="h-4 w-4 text-muted-foreground" />
              </span>
              <div className="min-w-0">
                <h3 className="truncate text-sm font-medium text-foreground">{connectorLabel(server.name)}</h3>
                <p className="text-xs text-muted-foreground">Ajouté par votre organisation</p>
              </div>
            </div>
          ))}
        </div>

        {isError && (
          <ErrorBox title="Impossible de charger les connecteurs de l’organisation." onRetry={() => { void refetch(); }} />
        )}

        {isAdmin && (
          <p className="text-xs text-muted-foreground">
            Les connecteurs de l’organisation se gèrent dans{' '}
            <Link to="/settings/org/assistant#connecteurs" className="font-medium text-foreground underline-offset-4 hover:underline">
              Règles de l’assistant
            </Link>
            .
          </p>
        )}
      </CardContent>
    </Card>
  );
}

import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Paperclip, Plug, Plus, Settings2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import notionLogo from '@/assets/notion-logo.webp';
import { EmailProviderLogo } from '@/components/assistant-ui/connector-logos';
import { FileUploadTrigger } from '@/components/prompt-kit/file-upload';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Spinner } from '@/components/ui/spinner';
import { Switch } from '@/components/ui/switch';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { useAgent } from '@/contexts/AgentContext';

export interface ChatConnectorOption {
  name: string;
  label: string;
  kind: 'notion' | 'gmail' | 'outlook' | 'email' | 'mcp';
  connected: boolean;
  enabled: boolean;
  description?: string | null;
  status?: 'connected' | 'disconnected' | 'checking' | 'unavailable';
  manageHref?: string;
}

interface ConnectorMenuProps {
  connectors: ChatConnectorOption[];
  loading?: boolean;
  onToggle: (name: string, enabled: boolean) => void;
}

export function ConnectorMenu({ connectors, loading = false, onToggle }: ConnectorMenuProps) {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { closeAgent } = useAgent();
  const activeCount = connectors.filter((connector) => connector.connected && connector.enabled).length;
  const triggerLabel = activeCount > 0
    ? `Ajouter un fichier ou gérer les connecteurs, ${activeCount} actif${activeCount > 1 ? 's' : ''}`
    : 'Ajouter un fichier ou gérer les connecteurs, aucun actif';

  const manageConnectors = (href = '/settings/account/connections#applications') => {
    setOpen(false);
    navigate(href);
    closeAgent();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={triggerLabel}
              className="relative shrink-0 rounded-full text-muted-foreground hover:text-foreground max-md:h-11 max-md:w-11"
            >
              <Plus aria-hidden="true" />
              {activeCount > 0 && (
                <span
                  className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-success ring-2 ring-background"
                  aria-hidden="true"
                />
              )}
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent side="top">Ajouter un fichier ou gérer les connecteurs</TooltipContent>
      </Tooltip>

      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        aria-label="Fichiers et connecteurs du chat"
        className="w-72 p-2"
      >
        <FileUploadTrigger asChild>
          <Button
            type="button"
            variant="ghost"
            onClick={() => setOpen(false)}
            className="h-auto w-full justify-start gap-2.5 px-2.5 py-2 text-left"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground" aria-hidden="true">
              <Paperclip />
            </span>
            Joindre un fichier
          </Button>
        </FileUploadTrigger>

        <div className="my-2 border-t border-border/70" />

        <div className="flex items-center justify-between px-2 pb-1.5 pt-0.5">
          <div>
            <p className="text-xs font-semibold text-foreground">Connecteurs</p>
            <p className="text-3xs text-muted-foreground">Appliqué aux prochains messages</p>
          </div>
          {loading && <Spinner size="sm" label="Chargement des connecteurs" />}
        </div>

        <div className="space-y-1">
          {connectors.map((connector) => {
            const isEmailConnector = connector.kind === 'gmail'
              || connector.kind === 'outlook'
              || connector.kind === 'email';
            // Une application non connectée (Notion, e-mail) propose « Connecter », comme toutes les autres.
            const canConnect = connector.kind !== 'mcp'
              && !connector.connected
              && connector.status !== 'checking';

            return (
              <div
                key={connector.name}
                className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
              >
                {/* Fond blanc pour un logo officiel (lisible en sombre) ; icône du thème sinon. */}
                <span
                  className={cn(
                    'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border',
                    connector.kind === 'notion' || isEmailConnector ? 'bg-white' : 'bg-muted',
                  )}
                >
                  {connector.kind === 'notion' ? (
                    <img src={notionLogo} alt="" className="h-5 w-5 object-contain" />
                  ) : connector.kind !== 'mcp' ? (
                    <EmailProviderLogo provider={connector.kind} className="h-5 w-5" aria-hidden="true" />
                  ) : (
                    <Plug className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
                  )}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-foreground">{connector.label}</span>
                  {connector.description && (
                    <span className="block truncate text-3xs text-muted-foreground" title={connector.description}>
                      {connector.description}
                    </span>
                  )}
                  <span className="block text-3xs text-muted-foreground">
                    {connector.status === 'checking'
                      ? 'Vérification…'
                      : connector.status === 'unavailable'
                        ? 'Statut indisponible'
                        : !connector.connected
                          ? 'Non connecté'
                          : connector.enabled
                            ? 'Actif dans le chat'
                            : 'En pause'}
                  </span>
                </span>
                {canConnect ? (
                  <Button
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => manageConnectors(connector.manageHref)}
                    aria-label={`Connecter ${connector.label}`}
                    className="shrink-0 max-md:h-11"
                  >
                    Connecter
                  </Button>
                ) : (
                  <Switch
                    checked={connector.connected && connector.enabled}
                    disabled={!connector.connected || connector.status === 'checking' || connector.status === 'unavailable'}
                    onCheckedChange={(enabled) => onToggle(connector.name, enabled)}
                    aria-label={`Utiliser ${connector.label} dans le chat`}
                  />
                )}
              </div>
            );
          })}
        </div>

        <Button
          type="button"
          variant="ghost"
          onClick={() => manageConnectors()}
          className="mt-1.5 h-auto w-full justify-start px-2.5 py-2 text-xs font-normal text-muted-foreground hover:text-foreground max-md:min-h-11 [&_svg]:size-3.5"
        >
          <Settings2 aria-hidden="true" />
          Gérer les connecteurs
        </Button>
      </PopoverContent>
    </Popover>
  );
}

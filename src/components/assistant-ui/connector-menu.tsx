import { useState } from 'react';
import { Loader2, Paperclip, Plug, Plus, Settings2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import notionLogo from '@/assets/notion-logo.webp';
import { FileUploadTrigger } from '@/components/prompt-kit/file-upload';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { useAgent } from '@/contexts/AgentContext';

export interface ChatConnectorOption {
  name: string;
  label: string;
  kind: 'notion' | 'mcp';
  connected: boolean;
  enabled: boolean;
  status?: 'connected' | 'disconnected' | 'checking' | 'unavailable';
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
    ? `Ajouter un fichier ou gérer les connecteurs — ${activeCount} actif${activeCount > 1 ? 's' : ''}`
    : 'Ajouter un fichier ou gérer les connecteurs — aucun actif';

  const manageConnectors = () => {
    setOpen(false);
    navigate('/settings?tab=agent-actions');
    closeAgent();
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          title="Ajouter un fichier ou gérer les connecteurs"
          aria-label={triggerLabel}
          className="relative flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Plus className="h-4 w-4" />
          {activeCount > 0 && (
            <span
              className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-success ring-2 ring-background"
              aria-hidden="true"
            />
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="start"
        sideOffset={8}
        aria-label="Fichiers et connecteurs du chat"
        className="w-72 p-2"
      >
        <FileUploadTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-sm transition-colors hover:bg-muted"
          >
            <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-muted text-muted-foreground">
              <Paperclip className="h-4 w-4" />
            </span>
            <span className="font-medium">Joindre un fichier</span>
          </button>
        </FileUploadTrigger>

        <div className="my-2 border-t border-border/70" />

        <div className="flex items-center justify-between px-2 pb-1.5 pt-0.5">
          <div>
            <p className="text-xs font-semibold text-foreground">Connecteurs</p>
            <p className="text-[10px] text-muted-foreground">Appliqué aux prochains messages</p>
          </div>
          {loading && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" aria-label="Chargement" />}
        </div>

        <div className="space-y-1">
          {connectors.map((connector) => (
            <div
              key={connector.name}
              className="flex items-center gap-2.5 rounded-lg px-2 py-2 transition-colors hover:bg-muted/60"
            >
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-white shadow-sm">
                {connector.kind === 'notion' ? (
                  <img src={notionLogo} alt="" className="h-5 w-5 object-contain" />
                ) : (
                  <Plug className="h-4 w-4 text-slate-700" aria-hidden="true" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-xs font-medium text-foreground">{connector.label}</span>
                <span className="block text-[10px] text-muted-foreground">
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
              <Switch
                checked={connector.connected && connector.enabled}
                disabled={!connector.connected || connector.status === 'checking' || connector.status === 'unavailable'}
                onCheckedChange={(enabled) => onToggle(connector.name, enabled)}
                aria-label={`Utiliser ${connector.label} dans le chat`}
              />
            </div>
          ))}
        </div>

        <button
          type="button"
          onClick={manageConnectors}
          className="mt-1.5 flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <Settings2 className="h-3.5 w-3.5" />
          Gérer les connecteurs
        </button>
      </PopoverContent>
    </Popover>
  );
}

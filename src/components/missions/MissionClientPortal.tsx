import React, { useState } from 'react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { useClientPortalTokens } from '@/hooks/useClientPortalTokens';
import { useOrganization } from '@/hooks/useOrganization';
import { hasFeature } from '@/lib/featureGates';
import { Link2, Copy, Trash2, ExternalLink, Plus, Lock, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface MissionClientPortalProps {
  project: SourcingProject;
}

export const MissionClientPortal: React.FC<MissionClientPortalProps> = ({ project }) => {
  const { orgType } = useOrganization();
  const canUse = hasFeature(orgType, 'client_portal');
  const { tokens, isLoading, createToken, isCreating, deleteToken } = useClientPortalTokens();
  const [clientName, setClientName] = useState('');
  const [clientEmail, setClientEmail] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [revokeTarget, setRevokeTarget] = useState<{ id: string; name: string } | null>(null);

  // Filter tokens that include this project
  const projectTokens = tokens.filter(t =>
    !t.project_ids || t.project_ids.length === 0 || t.project_ids.includes(project.id)
  );

  if (!canUse) {
    return (
      <div className="rounded-lg border border-border p-6 text-center">
        <Lock className="w-6 h-6 text-muted-foreground mx-auto mb-3" />
        <p className="text-sm text-muted-foreground">
          Le portail client est réservé aux cabinets et freelances.
        </p>
      </div>
    );
  }

  const handleCreate = async () => {
    if (!clientName.trim()) {
      toast.error('Entrez le nom du client');
      return;
    }
    try {
      await createToken({
        client_name: clientName.trim(),
        client_email: clientEmail.trim() || undefined,
        project_ids: [project.id],
      });
      setClientName('');
      setClientEmail('');
      setShowForm(false);
    } catch {
      // Error already toasted by hook
    }
  };

  const handleCopy = async (tokenValue: string) => {
    const url = `${window.location.origin}/client/${tokenValue}`;
    try {
      await navigator.clipboard.writeText(url);
      setCopiedId(tokenValue);
      toast.success('Lien copié !');
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error('Impossible de copier — copiez manuellement : ' + url);
    }
  };

  const handleDelete = (tokenId: string, clientName: string) => {
    setRevokeTarget({ id: tokenId, name: clientName });
  };

  return (
    <div className="rounded-xl border border-border p-5 space-y-4 bg-card">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          <div className="h-9 w-9 rounded-lg bg-muted grid place-items-center flex-shrink-0">
            <Link2 className="w-4 h-4 text-foreground" />
          </div>
          <div className="min-w-0">
            <h3 className="font-display text-[14px] font-bold leading-tight">
              Portail client
              {projectTokens.length > 0 && (
                <span className="ml-2 text-[11px] font-medium text-muted-foreground tabular-nums">
                  ({projectTokens.length})
                </span>
              )}
            </h3>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Lien public pour partager les candidats avec le hiring manager.
            </p>
          </div>
        </div>
        {!showForm && (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="h-9 px-3 rounded-full inline-flex items-center gap-1.5 text-[12px] font-medium border border-border hover:bg-accent transition-colors flex-shrink-0"
          >
            <Plus className="w-3 h-3" /> Créer un accès
          </button>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <div className="rounded-lg border border-border p-4 space-y-3 bg-background konekt-fade-up">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Nom du client <span className="text-destructive">*</span>
              </label>
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Ex: Thomas Dupont"
                autoFocus
                className="w-full h-9 px-3 mt-1 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
              />
            </div>
            <div>
              <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
                Email <span className="text-muted-foreground/70 normal-case tracking-normal">(optionnel)</span>
              </label>
              <input
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                type="email"
                placeholder="thomas@client.com"
                className="w-full h-9 px-3 mt-1 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
              />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={isCreating || !clientName.trim()}
              className="h-9 px-4 rounded-full inline-flex items-center gap-1.5 text-[12px] font-semibold bg-foreground text-background hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {isCreating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isCreating ? 'Création…' : 'Générer le lien'}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setClientName(''); setClientEmail(''); }}
              className="h-9 px-3 rounded-full text-[12px] text-muted-foreground hover:text-foreground border border-border transition-colors"
            >
              Annuler
            </button>
          </div>
        </div>
      )}

      {/* Token list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : projectTokens.length === 0 && !showForm ? (
        <p className="text-[12px] text-muted-foreground py-2 italic">
          Aucun accès client créé. Génère un lien pour donner accès au hiring manager.
        </p>
      ) : projectTokens.length > 0 ? (
        <div className="space-y-2">
          {projectTokens.map(t => (
            <div
              key={t.id}
              className="flex items-center gap-3 px-3 py-2 rounded-md border border-border bg-background hover:border-foreground/30 transition-colors"
            >
              <div className="flex-1 min-w-0">
                <p className="text-[13px] font-medium truncate">{t.client_name}</p>
                {t.client_email && (
                  <p className="text-[11px] text-muted-foreground truncate">{t.client_email}</p>
                )}
              </div>
              {t.last_accessed_at && (
                <span className="text-[10.5px] text-muted-foreground shrink-0 hidden sm:block">
                  Vu {formatDistanceToNow(new Date(t.last_accessed_at), { addSuffix: true, locale: fr })}
                </span>
              )}
              <button
                type="button"
                onClick={() => handleCopy(t.token)}
                className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
                title="Copier le lien"
              >
                {copiedId === t.token ? (
                  <Check className="w-3.5 h-3.5" style={{ color: 'hsl(var(--status-success))' }} />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
              <a
                href={`/client/${t.token}`}
                target="_blank"
                rel="noopener noreferrer"
                className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
                title="Ouvrir le portail"
              >
                <ExternalLink className="w-3.5 h-3.5" />
              </a>
              <button
                type="button"
                onClick={() => handleDelete(t.id, t.client_name)}
                className="h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0"
                title="Révoquer l'accès"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>
      ) : null}

      <AlertDialog open={!!revokeTarget} onOpenChange={(open) => !open && setRevokeTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Révoquer l'accès ?</AlertDialogTitle>
            <AlertDialogDescription>
              {revokeTarget && `Révoquer l'accès pour "${revokeTarget.name}" ? Le lien partagé deviendra inaccessible. Cette action est irréversible.`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={async () => {
                if (revokeTarget) {
                  try {
                    await deleteToken(revokeTarget.id);
                  } catch {
                    // Error already toasted by hook
                  }
                }
                setRevokeTarget(null);
              }}
            >
              Révoquer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

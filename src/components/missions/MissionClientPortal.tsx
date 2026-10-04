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
import { Button } from '@/components/ui/button';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { useClientPortalTokens, isPortalLinkExpired, PORTAL_LINK_VALIDITY_DAYS } from '@/hooks/useClientPortalTokens';
import { useOrganization } from '@/hooks/useOrganization';
import { hasFeature } from '@/lib/featureGates';
import { Link2, Copy, Trash2, ExternalLink, Plus, Lock, Check, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { format, formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

interface MissionClientPortalProps {
  project: SourcingProject;
  /**
   * Nouvelle page mission (Réglages de Cadrage, design simplifié du 04/10/2026) :
   * sans carte ni pastille d'icône ni majuscules, « Créer un accès » en bouton
   * discret, rien d'écrit quand le portail n'est pas offert. Défaut : le rendu d'aujourd'hui.
   */
  embedded?: boolean;
}

export const MissionClientPortal: React.FC<MissionClientPortalProps> = ({ project, embedded = false }) => {
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
    if (embedded) return null;
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
    <div className={embedded ? 'space-y-4 border-t border-border pt-6' : 'rounded-xl border border-border p-5 space-y-4 bg-card'}>
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex items-center gap-3 min-w-0">
          {!embedded && (
          <div className="h-9 w-9 rounded-lg bg-muted grid place-items-center flex-shrink-0">
            <Link2 className="w-4 h-4 text-foreground" />
          </div>
          )}
          <div className="min-w-0">
            <h3 className={embedded ? 'text-md font-semibold text-foreground' : 'font-display text-md font-bold leading-tight'}>
              Portail client
              {projectTokens.length > 0 && (
                <span className={embedded ? 'ml-2 text-sm font-normal text-muted-foreground tabular-nums' : 'ml-2 text-2xs font-medium text-muted-foreground tabular-nums'}>
                  ({projectTokens.length})
                </span>
              )}
            </h3>
            <p className={embedded ? 'text-sm text-muted-foreground' : 'text-2xs text-muted-foreground mt-0.5'}>
              Le client voit les candidats retenus et au-delà, jamais les profils à trier, écartés ou seulement contactés. Chaque nouveau lien est valable {PORTAL_LINK_VALIDITY_DAYS} jours.
            </p>
          </div>
        </div>
        {!showForm && (embedded ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setShowForm(true)}
            className="shrink-0 text-foreground max-sm:min-h-11"
          >
            <Plus aria-hidden="true" /> Créer un accès
          </Button>
        ) : (
          <button
            type="button"
            onClick={() => setShowForm(true)}
            className="h-9 px-3 rounded-full inline-flex items-center gap-1.5 text-xs font-medium border border-border hover:bg-accent transition-colors flex-shrink-0"
          >
            <Plus className="w-3 h-3" /> Créer un accès
          </button>
        ))}
      </div>

      {/* Create form */}
      {showForm && (
        <div className={embedded ? 'space-y-3 konekt-fade-up' : 'rounded-lg border border-border p-4 space-y-3 bg-background konekt-fade-up'}>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={embedded ? 'text-sm text-muted-foreground' : 'text-2xs uppercase tracking-wider text-muted-foreground font-semibold'}>
                Nom du client <span className="text-destructive">*</span>
              </label>
              <input
                value={clientName}
                onChange={(e) => setClientName(e.target.value)}
                placeholder="Ex: Thomas Dupont"
                autoFocus
                className={embedded
                  ? 'w-full h-9 px-3 mt-1 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 max-sm:h-11'
                  : 'w-full h-9 px-3 mt-1 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1'}
              />
            </div>
            <div>
              <label className={embedded ? 'text-sm text-muted-foreground' : 'text-2xs uppercase tracking-wider text-muted-foreground font-semibold'}>
                Email <span className={embedded ? 'text-muted-foreground' : 'text-muted-foreground/70 normal-case tracking-normal'}>(optionnel)</span>
              </label>
              <input
                value={clientEmail}
                onChange={(e) => setClientEmail(e.target.value)}
                type="email"
                placeholder="thomas@client.com"
                className={embedded
                  ? 'w-full h-9 px-3 mt-1 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 max-sm:h-11'
                  : 'w-full h-9 px-3 mt-1 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1'}
              />
            </div>
          </div>
          {embedded ? (
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={handleCreate}
              disabled={isCreating || !clientName.trim()}
              loading={isCreating}
              className="-ml-3 font-semibold text-foreground max-sm:min-h-11"
            >
              {isCreating ? 'Création…' : 'Générer le lien'}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              onClick={() => { setShowForm(false); setClientName(''); setClientEmail(''); }}
              className="text-muted-foreground hover:text-foreground max-sm:min-h-11"
            >
              Annuler
            </Button>
          </div>
          ) : (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCreate}
              disabled={isCreating || !clientName.trim()}
              className="h-9 px-4 rounded-full inline-flex items-center gap-1.5 text-xs font-semibold bg-foreground text-background hover:opacity-90 disabled:opacity-50 transition-opacity"
            >
              {isCreating && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isCreating ? 'Création…' : 'Générer le lien'}
            </button>
            <button
              type="button"
              onClick={() => { setShowForm(false); setClientName(''); setClientEmail(''); }}
              className="h-9 px-3 rounded-full text-xs text-muted-foreground hover:text-foreground border border-border transition-colors"
            >
              Annuler
            </button>
          </div>
          )}
        </div>
      )}

      {/* Token list */}
      {isLoading ? (
        <div className="flex items-center justify-center py-6">
          <Loader2 className="w-4 h-4 animate-spin text-muted-foreground" />
        </div>
      ) : projectTokens.length === 0 && !showForm ? (
        embedded ? null : (
        <p className="text-xs text-muted-foreground py-2 italic">
          Aucun accès client créé. Génère un lien pour donner accès au hiring manager.
        </p>
        )
      ) : projectTokens.length > 0 ? (
        <div className={embedded ? 'flex flex-col' : 'space-y-2'}>
          {projectTokens.map(t => {
            // Un lien échu ne se copie ni ne s'ouvre plus ; il se révoque.
            const expired = isPortalLinkExpired(t.expires_at);
            return (
            <div
              key={t.id}
              className={embedded
                ? 'flex items-center gap-3 border-t border-border py-2 first:border-t-0'
                : 'flex items-center gap-3 px-3 py-2 rounded-md border border-border bg-background hover:border-foreground/30 transition-colors'}
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{t.client_name}</p>
                {t.client_email && (
                  <p className={embedded ? 'text-sm text-muted-foreground truncate' : 'text-2xs text-muted-foreground truncate'}>{t.client_email}</p>
                )}
                <p className={cn(embedded ? 'text-sm truncate' : 'text-2xs truncate', expired ? 'text-destructive' : 'text-muted-foreground')}>
                  {t.expires_at && !Number.isNaN(new Date(t.expires_at).getTime())
                    ? `${expired ? 'Expiré le' : "Valable jusqu'au"} ${format(new Date(t.expires_at), 'd MMM yyyy', { locale: fr })}`
                    : 'Expiré'}
                </p>
              </div>
              {t.last_accessed_at && (
                <span className={embedded ? 'text-sm text-muted-foreground shrink-0 hidden sm:block' : 'text-2xs text-muted-foreground shrink-0 hidden sm:block'}>
                  Vu {formatDistanceToNow(new Date(t.last_accessed_at), { addSuffix: true, locale: fr })}
                </span>
              )}
              <button
                type="button"
                onClick={() => handleCopy(t.token)}
                disabled={expired}
                className={embedded
                  ? 'h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0 disabled:opacity-40 disabled:pointer-events-none max-sm:h-11 max-sm:w-11'
                  : 'h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0 disabled:opacity-40 disabled:pointer-events-none'}
                title={expired ? 'Lien expiré' : 'Copier le lien'}
                aria-label={embedded ? (expired ? 'Lien expiré' : `Copier le lien de ${t.client_name}`) : undefined}
              >
                {copiedId === t.token ? (
                  <Check className="w-3.5 h-3.5" style={{ color: 'hsl(var(--status-success))' }} />
                ) : (
                  <Copy className="w-3.5 h-3.5" />
                )}
              </button>
              {!expired && (
                <a
                  href={`/client/${t.token}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={embedded
                    ? 'h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0 max-sm:h-11 max-sm:w-11'
                    : 'h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0'}
                  title="Ouvrir le portail"
                  aria-label={embedded ? `Ouvrir le portail de ${t.client_name}` : undefined}
                >
                  <ExternalLink className="w-3.5 h-3.5" />
                </a>
              )}
              <button
                type="button"
                onClick={() => handleDelete(t.id, t.client_name)}
                className={embedded
                  ? 'h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0 max-sm:h-11 max-sm:w-11'
                  : 'h-7 w-7 grid place-items-center rounded-md text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors flex-shrink-0'}
                title="Révoquer l'accès"
                aria-label={embedded ? `Révoquer l'accès de ${t.client_name}` : undefined}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
            );
          })}
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

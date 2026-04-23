/**
 * ExtensionTokens — gestion des tokens API pour la Chrome extension Konekt.
 *
 * Affiche la liste des tokens existants (sans révéler le clair), permet d'en
 * créer un nouveau (clair affiché UNE SEULE fois) et d'en révoquer.
 *
 * UX :
 * - Génération : modal de création avec label optionnel
 * - Affichage du clair : alerte verte avec bouton Copy + warning "ne sera plus affiché"
 * - Liste : préfixe + label + dernière utilisation + bouton revoke
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import {
  Puzzle, Plus, Copy, CheckCircle2, Trash2, Loader2, AlertTriangle, ExternalLink, KeyRound,
} from 'lucide-react';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';
import { formatDistanceToNow, parseISO } from 'date-fns';
import { fr } from 'date-fns/locale';
import { cn } from '@/lib/utils';

interface ExtensionToken {
  id: string;
  label: string;
  token_prefix: string;
  created_at: string;
  last_used_at: string | null;
  revoked_at: string | null;
}

interface NewTokenResponse {
  success: boolean;
  token: string;
  id: string;
  label: string;
  prefix: string;
  created_at: string;
  error?: string;
}

interface ListResponse {
  success: boolean;
  tokens: ExtensionToken[];
  error?: string;
}

export const ExtensionTokens: React.FC = () => {
  const [tokens, setTokens] = useState<ExtensionToken[]>([]);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [justCreatedToken, setJustCreatedToken] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const loadTokens = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await invokeEdgeFunction<ListResponse>('extension-token', { action: 'list' });
      if (error || !data?.success) {
        toast.error(data?.error || error?.message || 'Erreur de chargement');
        return;
      }
      setTokens(data.tokens || []);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadTokens();
  }, [loadTokens]);

  const handleCreate = async () => {
    setCreating(true);
    try {
      const { data, error } = await invokeEdgeFunction<NewTokenResponse>('extension-token', {
        action: 'create',
        label: newLabel.trim() || undefined,
      });
      if (error || !data?.success || !data?.token) {
        toast.error(data?.error || error?.message || 'Erreur de création');
        return;
      }
      setJustCreatedToken(data.token);
      setNewLabel('');
      setCreateOpen(false);
      await loadTokens();
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (tokenId: string) => {
    setRevoking(tokenId);
    try {
      const { data, error } = await invokeEdgeFunction<{ success: boolean; error?: string }>('extension-token', {
        action: 'revoke',
        token_id: tokenId,
      });
      if (error || !data?.success) {
        toast.error(data?.error || error?.message || 'Erreur lors de la révocation');
        return;
      }
      toast.success('Token révoqué');
      await loadTokens();
    } finally {
      setRevoking(null);
    }
  };

  const handleCopy = async () => {
    if (!justCreatedToken) return;
    try {
      await navigator.clipboard.writeText(justCreatedToken);
      setCopied(true);
      toast.success('Token copié dans le presse-papiers');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Impossible de copier — sélectionnez manuellement le token');
    }
  };

  const activeTokens = tokens.filter(t => !t.revoked_at);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-lg">
          <Puzzle className="w-5 h-5 text-info" aria-hidden="true" />
          Extension Chrome Konekt
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="text-sm text-muted-foreground space-y-2">
          <p>
            L'extension Chrome Konekt vous permet de :
          </p>
          <ul className="text-xs space-y-1 ml-4 list-disc">
            <li>Reconnecter votre compte LinkedIn en 1 clic (capture le cookie automatiquement)</li>
            <li>Voir le statut Konekt de chaque profil dans vos recherches LinkedIn (badges overlay)</li>
            <li>Ajouter un profil au pipeline d'une mission depuis n'importe quelle page LinkedIn</li>
            <li>Prendre des notes rapides sans quitter LinkedIn</li>
          </ul>
        </div>

        {/* Token nouvellement créé — affichage unique */}
        {justCreatedToken && (
          <div className="border-2 border-success bg-success/5 p-3 space-y-2 animate-in fade-in-0 slide-in-from-top-2 duration-200">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="w-4 h-4 text-success shrink-0 mt-0.5" aria-hidden="true" />
              <div className="flex-1">
                <p className="text-sm font-bold uppercase tracking-wider text-success">Token créé !</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  ⚠️ Copiez ce token <strong>maintenant</strong> — il ne sera <strong>plus jamais ré-affiché</strong> pour des raisons de sécurité.
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-2 bg-background border border-border">
              <code className="flex-1 text-xs font-mono break-all select-all">{justCreatedToken}</code>
              <Button
                size="sm"
                variant="outline"
                onClick={handleCopy}
                className="shrink-0 gap-1.5"
              >
                {copied ? (
                  <CheckCircle2 className="w-3.5 h-3.5 text-success" aria-hidden="true" />
                ) : (
                  <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                )}
                {copied ? 'Copié' : 'Copier'}
              </Button>
            </div>
            <div className="flex items-start gap-2 text-xs text-muted-foreground">
              <KeyRound className="w-3 h-3 shrink-0 mt-0.5" aria-hidden="true" />
              <p>
                Collez ce token dans l'extension Chrome lors du premier setup, puis cliquez sur "OK je l'ai copié" ci-dessous.
              </p>
            </div>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setJustCreatedToken(null)}
              className="w-full"
            >
              OK, je l'ai copié
            </Button>
          </div>
        )}

        {/* Liste des tokens actifs */}
        {loading ? (
          <div className="flex items-center justify-center py-6">
            <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" aria-hidden="true" />
          </div>
        ) : activeTokens.length === 0 ? (
          <div className="text-center py-6 border border-dashed border-border">
            <Puzzle className="w-6 h-6 text-muted-foreground/40 mx-auto mb-2" aria-hidden="true" />
            <p className="text-xs text-muted-foreground">Aucun token actif</p>
            <p className="text-[11px] text-muted-foreground/70 mt-1">Créez un token pour activer l'extension Chrome</p>
          </div>
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {activeTokens.length} token{activeTokens.length > 1 ? 's' : ''} actif{activeTokens.length > 1 ? 's' : ''}
            </p>
            {activeTokens.map(token => (
              <div key={token.id} className="flex items-center gap-3 p-2.5 bg-muted/30 border border-border">
                <KeyRound className="w-4 h-4 text-muted-foreground shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-foreground truncate">{token.label}</p>
                  <p className="text-[11px] text-muted-foreground font-mono">{token.token_prefix}</p>
                  <p className="text-[10px] text-muted-foreground">
                    {token.last_used_at
                      ? `Utilisé ${formatDistanceToNow(parseISO(token.last_used_at), { locale: fr, addSuffix: true })}`
                      : 'Jamais utilisé'}
                    {' · '}créé {formatDistanceToNow(parseISO(token.created_at), { locale: fr, addSuffix: true })}
                  </p>
                </div>
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-muted-foreground hover:text-destructive shrink-0"
                      disabled={revoking === token.id}
                      aria-label={`Révoquer le token ${token.label}`}
                    >
                      {revoking === token.id ? (
                        <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                      ) : (
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      )}
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Révoquer ce token ?</AlertDialogTitle>
                      <AlertDialogDescription>
                        L'extension utilisant ce token cessera immédiatement de fonctionner et devra être reconfigurée avec un nouveau token. Cette action est irréversible.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Annuler</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => handleRevoke(token.id)}
                        className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                      >
                        Révoquer
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              </div>
            ))}
          </div>
        )}

        {/* Bouton créer + lien install */}
        <div className="flex items-center gap-2 pt-2 border-t border-border">
          <Dialog open={createOpen} onOpenChange={setCreateOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="gap-1.5">
                <Plus className="w-3.5 h-3.5" aria-hidden="true" />
                Nouveau token
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Créer un nouveau token extension</DialogTitle>
                <DialogDescription>
                  Ce token autorisera votre extension Chrome à se connecter à votre compte Konekt.
                  Il sera affiché une seule fois — copiez-le immédiatement.
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-3 py-2">
                <div className="space-y-1.5">
                  <Label htmlFor="token-label" className="text-xs font-medium">
                    Étiquette (optionnel)
                  </Label>
                  <Input
                    id="token-label"
                    value={newLabel}
                    onChange={(e) => setNewLabel(e.target.value)}
                    placeholder="ex: Mon Chrome au bureau"
                    className="text-sm"
                    maxLength={100}
                  />
                  <p className="text-[10px] text-muted-foreground">
                    Pour identifier ce token dans la liste (utile si vous installez l'extension sur plusieurs ordinateurs).
                  </p>
                </div>
                <div className="flex items-start gap-2 p-2 bg-warning/5 border border-warning/30 text-xs">
                  <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0 mt-0.5" aria-hidden="true" />
                  <p className="text-foreground">
                    Le token est équivalent à un mot de passe — ne le partagez pas et ne le commitez pas dans git.
                  </p>
                </div>
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
                  Annuler
                </Button>
                <Button onClick={handleCreate} disabled={creating} className="gap-1.5">
                  {creating ? (
                    <Loader2 className="w-3.5 h-3.5 animate-spin" aria-hidden="true" />
                  ) : (
                    <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                  )}
                  Créer le token
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <a
            href="https://github.com/Lgarilhe/remix-of-event-template/raw/main/extensions/chrome/dist/konekt-extension.zip"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'inline-flex items-center gap-1.5 h-9 px-3 text-xs font-medium border border-border hover:bg-accent transition-colors',
            )}
          >
            <ExternalLink className="w-3 h-3" aria-hidden="true" />
            Télécharger l'extension
          </a>
        </div>
      </CardContent>
    </Card>
  );
};

/**
 * ExtensionTokens — gestion des tokens API pour la Chrome extension Konekt.
 *
 * Affiche la liste des tokens existants (sans révéler le clair), permet d'en
 * créer un nouveau (clair affiché UNE SEULE fois) et d'en révoquer.
 *
 * UX :
 * - Génération : modal de création avec label optionnel
 * - Affichage du clair : bloc avec bouton Copier + rappel « ne sera plus affiché »
 * - Liste : préfixe + label + dernière utilisation + bouton revoke
 *
 * Lot 3 des Paramètres : carte masquée tant qu'aucun jeton n'est actif, sauf si
 * `revealWhenEmpty` la demande (lien #extension, ancien ?tab=account de
 * l'extension installée). Une fois affichée, elle reste pendant la visite.
 *
 * Lot 12 du chantier design : plus de procédure d'installation de développeur
 * (F-10), une phrase dit que l'extension sera proposée ici à sa publication ;
 * une lecture ratée s'affiche dans la carte avec « Réessayer » (F-06) ; « jeton »
 * plutôt que « token » à l'écran (F-20).
 */

import { useState, useEffect, useCallback } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger,
} from '@/components/ui/dialog';
import { EmptyState } from '@/components/layout/EmptyState';
import { ErrorState } from '@/components/layout/ErrorState';
import {
  Puzzle, Plus, Copy, Check, CheckCircle2, Trash2, AlertTriangle, Info, KeyRound,
} from 'lucide-react';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { plural } from '@/lib/plural';
import { timeAgo } from '@/lib/relativeTime';
import { toast } from 'sonner';

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

/** « il y a 3 h », « à l'instant », ou « le 12 sept. » au-delà d'un mois. */
function since(iso: string): string {
  const text = timeAgo(iso) ?? '';
  return text.startsWith('il y a') || text === "à l'instant" ? text : `le ${text}`;
}

export const ExtensionTokens: React.FC<{ revealWhenEmpty?: boolean }> = ({ revealWhenEmpty = false }) => {
  const [tokens, setTokens] = useState<ExtensionToken[]>([]);
  // Carte révélée : demandée par l'appelant, ou un jeton actif existe. Ne se referme plus.
  const [revealed, setRevealed] = useState(revealWhenEmpty);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);
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
        // Lecture ratée : dite dans la carte, avec « Réessayer », jamais un faux « aucun jeton ».
        // Pas de toast : une carte cachée n'a rien à signaler.
        setLoadError(true);
        return;
      }
      setLoadError(false);
      const list = data.tokens || [];
      setTokens(list);
      if (list.some((t) => !t.revoked_at)) setRevealed(true);
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
        toast.error(data?.error || error?.message || 'La création du jeton a échoué.');
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
        toast.error(data?.error || error?.message || 'La révocation du jeton a échoué.');
        return;
      }
      toast.success('Jeton révoqué');
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
      toast.success('Jeton copié dans le presse-papiers');
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Copie impossible : sélectionnez le jeton à la main.');
    }
  };

  const activeTokens = tokens.filter(t => !t.revoked_at);

  // Rien pendant le chargement ni sans jeton actif, sauf carte révélée.
  if (!revealed) return null;

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Puzzle className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Extension Chrome Konekt
        </CardTitle>
        <Dialog open={createOpen} onOpenChange={setCreateOpen}>
          <DialogTrigger asChild>
            <Button size="sm" variant="outline" className="max-md:h-11">
              <Plus aria-hidden="true" />
              Créer un jeton
            </Button>
          </DialogTrigger>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Créer un jeton pour l'extension</DialogTitle>
              <DialogDescription>
                Ce jeton autorise l'extension Chrome à se connecter à votre compte Konekt.
                Il ne s'affiche qu'une fois : copiez-le dès sa création.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-3 py-2">
              <div className="space-y-1.5">
                <Label htmlFor="token-label" className="text-xs font-medium">
                  Étiquette (facultatif)
                </Label>
                <Input
                  id="token-label"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="Ex. : Chrome du bureau"
                  maxLength={100}
                  aria-describedby="token-label-aide"
                />
                <p id="token-label-aide" className="text-xs text-muted-foreground">
                  Pour reconnaître ce jeton dans la liste, si vous installez l'extension sur plusieurs ordinateurs.
                </p>
              </div>
              <div className="flex items-start gap-2 rounded-lg border border-warning/25 bg-warning-muted p-2.5 text-xs">
                <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                <p className="text-foreground">
                  Ce jeton vaut un mot de passe : ne le partagez avec personne.
                </p>
              </div>
            </div>
            <DialogFooter>
              <Button variant="ghost" onClick={() => setCreateOpen(false)} disabled={creating}>
                Annuler
              </Button>
              <Button variant="primary" onClick={handleCreate} loading={creating}>
                Créer le jeton
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="space-y-2 text-sm text-muted-foreground">
          <p>L'extension Chrome Konekt vous permet de :</p>
          <ul className="ml-4 list-disc space-y-1 text-xs">
            <li>reconnecter votre compte LinkedIn en un clic (elle récupère le cookie pour vous) ;</li>
            <li>voir le statut Konekt de chaque profil dans vos recherches LinkedIn ;</li>
            <li>ajouter un profil au pipeline d'une mission depuis n'importe quelle page LinkedIn ;</li>
            <li>prendre des notes sans quitter LinkedIn.</li>
          </ul>
        </div>

        {/* Plus de procédure d'installation pour développeur (F-10) : une phrase neutre. */}
        <p className="flex items-start gap-2 rounded-lg bg-muted p-3 text-xs text-foreground-secondary">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
          L'extension Chrome vous sera proposée ici dès sa publication. Les jetons ci-dessous la relient à votre compte Konekt.
        </p>

        {/* Jeton tout juste créé : affiché une seule fois */}
        {justCreatedToken && (
          <div role="status" className="space-y-3 rounded-lg border border-border bg-muted p-3">
            <div className="flex items-start gap-2">
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-success" aria-hidden="true" />
              <div>
                <p className="text-sm font-semibold text-foreground">Jeton créé</p>
                <p className="mt-0.5 text-xs text-foreground-secondary">
                  Copiez-le maintenant : pour votre sécurité, il ne sera plus jamais affiché.
                </p>
              </div>
            </div>
            <div className="flex flex-col gap-2 rounded-lg border border-border bg-background p-2 sm:flex-row sm:items-center">
              {/* Police à chasse fixe : un secret à copier. */}
              <code className="min-w-0 flex-1 select-all break-all font-mono text-xs text-foreground">{justCreatedToken}</code>
              <Button size="sm" variant="outline" onClick={handleCopy} className="shrink-0 max-md:h-11">
                {copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
                {copied ? 'Copié' : 'Copier'}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Collez-le dans les réglages de l'extension Chrome, puis masquez-le.
            </p>
            <Button variant="ghost" size="sm" onClick={() => setJustCreatedToken(null)} className="w-full max-md:h-11">
              Masquer le jeton
            </Button>
          </div>
        )}

        {/* Jetons actifs */}
        {loading ? (
          <div role="status" className="space-y-2">
            <Skeleton className="h-14 w-full rounded-lg" aria-hidden="true" />
            <Skeleton className="h-14 w-full rounded-lg" aria-hidden="true" />
            <span className="sr-only">Chargement des jetons…</span>
          </div>
        ) : loadError ? (
          <ErrorState
            variant="compact"
            title="Impossible de charger vos jetons."
            description="Vérifiez votre connexion, puis réessayez."
            onRetry={() => { void loadTokens(); }}
          />
        ) : activeTokens.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={KeyRound}
            title="Aucun jeton actif"
            headingLevel={4}
            description="Créez un jeton pour relier l'extension Chrome à votre compte."
          />
        ) : (
          <div className="space-y-2">
            <p className="text-xs font-medium text-foreground">
              {plural(activeTokens.length, 'jeton actif', 'jetons actifs')}
            </p>
            <ul className="space-y-2">
              {activeTokens.map(token => (
                <li key={token.id} className="flex items-center gap-3 rounded-lg border border-border p-2.5">
                  <KeyRound className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-foreground">{token.label}</p>
                    <p className="text-xs text-muted-foreground">
                      Commence par {token.token_prefix}
                      {' · '}
                      {token.last_used_at ? `utilisé ${since(token.last_used_at)}` : 'jamais utilisé'}
                      {' · '}créé {since(token.created_at)}
                    </p>
                  </div>
                  <AlertDialog>
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <AlertDialogTrigger asChild>
                          <Button
                            variant="ghost"
                            size="icon-sm"
                            loading={revoking === token.id}
                            className="shrink-0 text-muted-foreground hover:text-danger max-md:h-11 max-md:w-11"
                            aria-label={`Révoquer le jeton ${token.label}`}
                          >
                            {revoking !== token.id && <Trash2 aria-hidden="true" />}
                          </Button>
                        </AlertDialogTrigger>
                      </TooltipTrigger>
                      <TooltipContent>Révoquer</TooltipContent>
                    </Tooltip>
                    <AlertDialogContent>
                      <AlertDialogHeader>
                        <AlertDialogTitle>Révoquer ce jeton ?</AlertDialogTitle>
                        <AlertDialogDescription>
                          L'extension qui l'utilise cessera aussitôt de fonctionner et devra être reliée avec un nouveau jeton. Cette action est irréversible.
                        </AlertDialogDescription>
                      </AlertDialogHeader>
                      <AlertDialogFooter>
                        <AlertDialogCancel>Annuler</AlertDialogCancel>
                        <AlertDialogAction onClick={() => handleRevoke(token.id)} className="bg-destructive">
                          Révoquer
                        </AlertDialogAction>
                      </AlertDialogFooter>
                    </AlertDialogContent>
                  </AlertDialog>
                </li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
    </Card>
  );
};

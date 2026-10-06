import React, { useId, useMemo, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
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
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { EmptyState } from '@/components/layout/EmptyState';
import { useEmailSignatures, EmailSignature } from '@/hooks/useEmailSignatures';
import { Mail, Plus, Pencil, Trash2 } from 'lucide-react';
import { ErrorBox } from '@/components/layout/ErrorBox';
import { sanitizeSignatureHtml } from '@/lib/signatureHtml';

/**
 * Signatures e-mail (Paramètres › Rédaction, #signatures).
 *
 * Lot 12 du chantier design : titre de carte commun et action à droite (F-01),
 * un seul verbe « Enregistrer » (F-09), actions de ligne toujours visibles (F-12),
 * libellés reliés à leur champ (F-15), lignes arrondies (F-18), squelette (F-66).
 */
export const EmailSignatures: React.FC = () => {
  const { signatures, isLoading, isError, refetch, createSignature, updateSignature, deleteSignature } = useEmailSignatures();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EmailSignature | null>(null);
  const [form, setForm] = useState({ name: '', content: '' });
  const [deleteTargetId, setDeleteTargetId] = useState<string | null>(null);
  // Aperçu assaini : tout membre peut écrire une signature, les autres l'ouvrent ici.
  const previewHtml = useMemo(() => sanitizeSignatureHtml(form.content), [form.content]);
  const uid = useId();
  const ids = { name: `${uid}-nom`, content: `${uid}-contenu`, preview: `${uid}-apercu` };
  const saving = createSignature.isPending || updateSignature.isPending;

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', content: '' });
    setDialogOpen(true);
  };

  const openEdit = (sig: EmailSignature) => {
    setEditing(sig);
    setForm({ name: sig.name, content: sig.content });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.content.trim()) return;
    try {
      if (editing) {
        await updateSignature.mutateAsync({ id: editing.id, ...form });
      } else {
        await createSignature.mutateAsync(form);
      }
      setDialogOpen(false);
    } catch {
      // Échec déjà annoncé par le hook : la fenêtre reste ouverte pour réessayer.
    }
  };

  const handleDelete = (id: string) => {
    setDeleteTargetId(id);
  };

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <Mail className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Signatures e-mail
        </CardTitle>
        <Button size="sm" variant="outline" onClick={openCreate} disabled={isLoading || isError} className="max-md:h-11">
          <Plus aria-hidden="true" />
          Nouvelle signature
        </Button>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div role="status" className="space-y-2">
            <Skeleton className="h-16 w-full rounded-lg" aria-hidden="true" />
            <Skeleton className="h-16 w-full rounded-lg" aria-hidden="true" />
            <span className="sr-only">Chargement des signatures…</span>
          </div>
        ) : isError ? (
          // Lecture ratée : pas de faux « Aucune signature », ni création à l'aveugle
          <ErrorBox title="Impossible de charger les signatures e-mail." onRetry={() => { void refetch(); }} />
        ) : signatures.length === 0 ? (
          <EmptyState
            variant="compact"
            icon={Mail}
            className="border-0"
            title="Aucune signature"
            headingLevel={4}
            description="Créez-en une pour l’utiliser dans vos séquences e-mail."
          />
        ) : (
          <ul className="divide-y divide-border">
            {signatures.map((sig) => (
              <li key={sig.id} className="flex items-start justify-between gap-2 py-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-foreground">{sig.name}</p>
                  <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                    {sig.content.replace(/<[^>]*>/g, '').slice(0, 120)}
                  </p>
                </div>
                {/* Toujours visibles : au doigt et au clavier, pas seulement au survol (F-12). */}
                <div className="flex shrink-0 items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-foreground max-md:h-11 max-md:w-11"
                        onClick={() => openEdit(sig)}
                        aria-label={`Modifier la signature ${sig.name}`}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Modifier</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="text-muted-foreground hover:text-danger max-md:h-11 max-md:w-11"
                        onClick={() => handleDelete(sig.id)}
                        aria-label={`Supprimer la signature ${sig.name}`}
                      >
                        <Trash2 aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Supprimer</TooltipContent>
                  </Tooltip>
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>

      <AlertDialog open={!!deleteTargetId} onOpenChange={(open) => !open && setDeleteTargetId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette signature ?</AlertDialogTitle>
            <AlertDialogDescription>
              Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive"
              onClick={async () => {
                try {
                  if (deleteTargetId) await deleteSignature.mutateAsync(deleteTargetId);
                } catch {
                  // Échec déjà annoncé par le hook.
                }
                setDeleteTargetId(null);
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Modifier la signature' : 'Nouvelle signature'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor={ids.name}>
                Nom <span className="text-danger" aria-hidden="true">*</span>
              </Label>
              <Input
                id={ids.name}
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ex. : Signature principale"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor={ids.content}>
                Contenu HTML <span className="text-danger" aria-hidden="true">*</span>
              </Label>
              {/* Police à chasse fixe : on écrit du code HTML. */}
              <Textarea
                id={ids.content}
                value={form.content}
                onChange={(e) => setForm(f => ({ ...f, content: e.target.value }))}
                placeholder="<p>Cordialement,<br/>Jean Martin</p>"
                rows={5}
                required
                className="font-mono text-xs"
              />
            </div>
            {form.content && (
              <div className="space-y-1.5">
                <p id={ids.preview} className="text-xs font-medium text-muted-foreground">Aperçu</p>
                <div
                  data-testid="signature-preview"
                  role="region"
                  aria-labelledby={ids.preview}
                  className="rounded-lg border border-border bg-muted/40 p-3 text-sm max-h-64 overflow-auto [&_img]:max-w-full [&_img]:h-auto"
                  dangerouslySetInnerHTML={{ __html: previewHtml }}
                />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setDialogOpen(false)} disabled={saving}>Annuler</Button>
            <Button
              variant="primary"
              onClick={handleSave}
              loading={saving}
              disabled={!form.name.trim() || !form.content.trim()}
            >
              Enregistrer
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

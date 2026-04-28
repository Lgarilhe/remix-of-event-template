/**
 * CustomVariablesSettings — UI CRUD pour les variables custom user.
 *
 * Variables custom : valeurs définies par l'user (ex: {{lien_demo}},
 * {{prix_offre}}) utilisables dans les templates de messages.
 */

import React, { useState } from 'react';
import {
  useUserTemplateVariables,
  type UserTemplateVariable,
} from '@/hooks/useUserTemplateVariables';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Variable, Plus, Pencil, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export const CustomVariablesSettings: React.FC = () => {
  const { variables, isLoading, create, update, remove } = useUserTemplateVariables();
  const [editing, setEditing] = useState<UserTemplateVariable | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<UserTemplateVariable | null>(null);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <Variable className="w-4 h-4" />
            Variables custom
          </CardTitle>
          <Button size="sm" onClick={() => setCreating(true)} className="gap-1.5">
            <Plus className="w-3.5 h-3.5" />
            Nouvelle variable
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground">
          Définissez vos propres variables réutilisables (ex: <code className="bg-muted px-1 rounded text-xs">{'{{lien_demo}}'}</code>,{' '}
          <code className="bg-muted px-1 rounded text-xs">{'{{prix_offre}}'}</code>) pour les
          utiliser dans vos templates et les actualiser facilement.
        </p>

        {!isLoading && variables.length === 0 && (
          <div className="border border-dashed border-border rounded-lg p-4 bg-muted/20 text-center">
            <p className="text-xs text-muted-foreground">
              Aucune variable custom encore. Ajoutez-en pour personnaliser vos templates.
            </p>
          </div>
        )}

        {!isLoading && variables.length > 0 && (
          <div className="border border-border rounded-lg divide-y divide-border">
            {variables.map((v) => (
              <div
                key={v.id}
                className="flex items-center gap-3 px-3 py-2 group hover:bg-muted/30 transition-colors"
              >
                <code className="text-xs font-mono bg-muted px-2 py-1 rounded text-foreground shrink-0">
                  {`{{${v.key}}}`}
                </code>
                <div className="flex-1 min-w-0">
                  <p className="text-sm truncate">{v.value}</p>
                  {v.description && (
                    <p className="text-[11px] text-muted-foreground truncate mt-0.5">
                      {v.description}
                    </p>
                  )}
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => setEditing(v)}
                    aria-label="Modifier"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteConfirm(v)}
                    aria-label="Supprimer"
                  >
                    <Trash2 className="w-3.5 h-3.5" />
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}

        {isLoading && (
          <div className="text-xs text-muted-foreground text-center py-2">
            <Loader2 className="w-3 h-3 animate-spin inline mr-1" />
            Chargement...
          </div>
        )}
      </CardContent>

      {/* Modal create/edit */}
      <VariableFormDialog
        open={creating || !!editing}
        variable={editing}
        onClose={() => {
          setCreating(false);
          setEditing(null);
        }}
        onSubmit={(input) => {
          if (editing) {
            update({ id: editing.id, ...input });
          } else {
            create(input);
          }
          setCreating(false);
          setEditing(null);
        }}
      />

      {/* Confirm delete */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette variable ?</AlertDialogTitle>
            <AlertDialogDescription>
              <code className="bg-muted px-1 rounded">{`{{${deleteConfirm?.key}}}`}</code> sera
              supprimée. Les templates qui l'utilisent afficheront le placeholder tel quel
              jusqu'à ce que vous le retiriez.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive hover:bg-destructive/90"
              onClick={() => {
                if (deleteConfirm) {
                  remove(deleteConfirm.id);
                  setDeleteConfirm(null);
                }
              }}
            >
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
};

interface VariableFormDialogProps {
  open: boolean;
  variable: UserTemplateVariable | null;
  onClose: () => void;
  onSubmit: (input: { key: string; value: string; description: string | null }) => void;
}

const VariableFormDialog: React.FC<VariableFormDialogProps> = ({
  open,
  variable,
  onClose,
  onSubmit,
}) => {
  const [form, setForm] = useState({ key: '', value: '', description: '' });

  React.useEffect(() => {
    if (open) {
      if (variable) {
        setForm({
          key: variable.key,
          value: variable.value,
          description: variable.description || '',
        });
      } else {
        setForm({ key: '', value: '', description: '' });
      }
    }
  }, [open, variable]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.key.trim() || !form.value.trim()) {
      toast.error('Nom et valeur sont obligatoires');
      return;
    }
    if (!/^[a-z][a-z0-9_]*$/.test(form.key)) {
      toast.error('Le nom doit être en minuscules + chiffres/underscores (ex: lien_demo)');
      return;
    }
    onSubmit({
      key: form.key.trim(),
      value: form.value.trim(),
      description: form.description.trim() || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{variable ? 'Modifier la variable' : 'Nouvelle variable'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">
              Nom de la variable <span className="text-destructive">*</span>
            </label>
            <Input
              value={form.key}
              onChange={(e) => setForm({ ...form, key: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })}
              placeholder="lien_demo"
              required
              disabled={!!variable}
              className="h-9 text-sm font-mono"
            />
            <p className="text-[10px] text-muted-foreground mt-1">
              Sera utilisée comme{' '}
              <code className="bg-muted px-1 rounded">
                {`{{${form.key || 'nom_variable'}}}`}
              </code>{' '}
              dans vos templates
            </p>
          </div>
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">
              Valeur <span className="text-destructive">*</span>
            </label>
            <Textarea
              value={form.value}
              onChange={(e) => setForm({ ...form, value: e.target.value })}
              placeholder="https://demo.konekt.fr/booking"
              required
              rows={3}
              className="text-sm"
            />
          </div>
          <div>
            <label className="text-xs font-medium text-foreground mb-1 block">
              Description
            </label>
            <Input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Lien de réservation démo (mettre à jour si change)"
              className="h-9 text-sm"
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit">{variable ? 'Enregistrer' : 'Créer'}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useEmailSignatures, EmailSignature } from '@/hooks/useEmailSignatures';
import { Mail, Plus, Pencil, Trash2, Star } from 'lucide-react';
import { BrutalLoader } from '@/components/ui/brutal-loader';

export const EmailSignatures: React.FC = () => {
  const { signatures, isLoading, createSignature, updateSignature, deleteSignature } = useEmailSignatures();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<EmailSignature | null>(null);
  const [form, setForm] = useState({ name: '', content: '', is_default: false });

  const openCreate = () => {
    setEditing(null);
    setForm({ name: '', content: '', is_default: false });
    setDialogOpen(true);
  };

  const openEdit = (sig: EmailSignature) => {
    setEditing(sig);
    setForm({ name: sig.name, content: sig.content, is_default: sig.is_default });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.content.trim()) return;
    if (editing) {
      await updateSignature.mutateAsync({ id: editing.id, ...form });
    } else {
      await createSignature.mutateAsync(form);
    }
    setDialogOpen(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Supprimer cette signature ?')) return;
    await deleteSignature.mutateAsync(id);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between text-sm font-bold uppercase tracking-wider">
          <div className="flex items-center gap-2">
            <Mail className="w-4 h-4" />
            Signatures email
          </div>
          <Button size="sm" onClick={openCreate} className="gap-1">
            <Plus className="w-3.5 h-3.5" />
            Nouvelle
          </Button>
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="flex justify-center py-6">
            <BrutalLoader compact />
          </div>
        ) : signatures.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-4">
            Aucune signature. Créez-en une pour l'utiliser dans vos séquences email.
          </p>
        ) : (
          <div className="space-y-3">
            {signatures.map((sig) => (
              <div
                key={sig.id}
                className="group border border-foreground/10 p-3 hover:border-foreground/30 transition-colors"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-sm">{sig.name}</span>
                      {sig.is_default && (
                        <Badge variant="secondary" className="text-[10px] px-1.5 py-0 h-4 gap-0.5">
                          <Star className="w-2.5 h-2.5" />
                          Par défaut
                        </Badge>
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                      {sig.content.replace(/<[^>]*>/g, '').slice(0, 120)}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEdit(sig)}>
                      <Pencil className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-7 w-7 text-destructive hover:text-destructive"
                      onClick={() => handleDelete(sig.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </CardContent>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>{editing ? 'Modifier la signature' : 'Nouvelle signature'}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label>Nom *</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm(f => ({ ...f, name: e.target.value }))}
                placeholder="Ex: Signature principale"
                className="mt-1"
              />
            </div>
            <div>
              <Label>Contenu HTML *</Label>
              <Textarea
                value={form.content}
                onChange={(e) => setForm(f => ({ ...f, content: e.target.value }))}
                placeholder="<p>Cordialement,<br/>Jean Martin</p>"
                rows={5}
                className="mt-1 font-mono text-xs"
              />
            </div>
            {form.content && (
              <div>
                <Label className="text-xs text-muted-foreground">Aperçu</Label>
                <div
                  className="mt-1 p-3 border border-foreground/10 bg-muted/30 rounded text-sm"
                  dangerouslySetInnerHTML={{ __html: form.content }}
                />
              </div>
            )}
            <div className="flex items-center gap-2">
              <Switch
                checked={form.is_default}
                onCheckedChange={(checked) => setForm(f => ({ ...f, is_default: checked }))}
              />
              <Label className="text-sm">Signature par défaut</Label>
            </div>
            <div className="flex justify-end gap-2 pt-2">
              <Button variant="outline" onClick={() => setDialogOpen(false)}>Annuler</Button>
              <Button
                onClick={handleSave}
                disabled={!form.name.trim() || !form.content.trim() || createSignature.isPending || updateSignature.isPending}
              >
                {(createSignature.isPending || updateSignature.isPending) ? 'Enregistrement...' : 'Sauvegarder'}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
};

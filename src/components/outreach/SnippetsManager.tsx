import React, { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrganization } from '@/hooks/useOrganization';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Plus,
  Search,
  Pencil,
  Copy,
  Trash2,
  FileText,
} from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { formatDistanceToNow } from 'date-fns';
import { fr } from 'date-fns/locale';

const CATEGORIES = [
  { value: 'introduction', label: 'Introduction' },
  { value: 'value_prop', label: 'Value Prop' },
  { value: 'cta', label: 'CTA' },
  { value: 'signature', label: 'Signature' },
  { value: 'other', label: 'Autre' },
];

interface Snippet {
  id: string;
  name: string;
  content: string;
  category: string | null;
  created_by: string;
  created_at: string;
}

interface SnippetFormData {
  name: string;
  content: string;
  category: string;
}

export const SnippetsManager: React.FC = () => {
  const { organizationId } = useOrganization();
  const [snippets, setSnippets] = useState<Snippet[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [editModal, setEditModal] = useState<{ open: boolean; snippet?: Snippet }>({ open: false });
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [formData, setFormData] = useState<SnippetFormData>({ name: '', content: '', category: '' });
  const [saving, setSaving] = useState(false);

  const fetchSnippets = async () => {
    if (!organizationId) return;
    try {
      const { data, error } = await (supabase
        .from('sequence_snippets') as any)
        .select('*')
        .eq('organization_id', organizationId)
        .order('created_at', { ascending: false });
      if (error) throw error;
      setSnippets(data || []);
    } catch (err) {
      console.error('Error fetching snippets:', err);
      toast.error('Erreur lors du chargement des snippets');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchSnippets();
  }, [organizationId]);

  const openCreateModal = () => {
    setFormData({ name: '', content: '', category: '' });
    setEditModal({ open: true });
  };

  const openEditModal = (snippet: Snippet) => {
    setFormData({ name: snippet.name, content: snippet.content, category: snippet.category || '' });
    setEditModal({ open: true, snippet });
  };

  const handleSave = async () => {
    if (!formData.name.trim() || !formData.content.trim()) {
      toast.error('Le nom et le contenu sont requis');
      return;
    }
    if (!organizationId) return;

    setSaving(true);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');

      if (editModal.snippet) {
        const { error } = await (supabase
          .from('sequence_snippets') as any)
          .update({
            name: formData.name,
            content: formData.content,
            category: formData.category || null,
          })
          .eq('id', editModal.snippet.id);
        if (error) throw error;
        toast.success('Snippet mis à jour');
      } else {
        const { error } = await (supabase
          .from('sequence_snippets') as any)
          .insert({
            organization_id: organizationId,
            name: formData.name,
            content: formData.content,
            category: formData.category || null,
            created_by: user.id,
          });
        if (error) throw error;
        toast.success('Snippet créé');
      }
      setEditModal({ open: false });
      fetchSnippets();
    } catch (err) {
      console.error('Error saving snippet:', err);
      toast.error('Erreur lors de la sauvegarde');
    } finally {
      setSaving(false);
    }
  };

  const handleDuplicate = async (snippet: Snippet) => {
    if (!organizationId) return;
    try {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) throw new Error('Non authentifié');

      const { error } = await (supabase
        .from('sequence_snippets') as any)
        .insert({
          organization_id: organizationId,
          name: `Copie de ${snippet.name}`,
          content: snippet.content,
          category: snippet.category,
          created_by: user.id,
        });
      if (error) throw error;
      toast.success('Snippet dupliqué');
      fetchSnippets();
    } catch (err) {
      toast.error('Erreur lors de la duplication');
    }
  };

  const handleDelete = async () => {
    if (!deleteId) return;
    try {
      const { error } = await (supabase
        .from('sequence_snippets') as any)
        .delete()
        .eq('id', deleteId);
      if (error) throw error;
      toast.success('Snippet supprimé');
      setDeleteId(null);
      fetchSnippets();
    } catch (err) {
      toast.error('Erreur lors de la suppression');
    }
  };

  const filtered = snippets.filter(s => {
    const matchesSearch = !searchQuery || s.name.toLowerCase().includes(searchQuery.toLowerCase()) || s.content.toLowerCase().includes(searchQuery.toLowerCase());
    const matchesCategory = categoryFilter === 'all' || s.category === categoryFilter;
    return matchesSearch && matchesCategory;
  });

  const getCategoryLabel = (cat: string | null) => CATEGORIES.find(c => c.value === cat)?.label || cat || 'Sans catégorie';

  // Highlight variables in content preview
  const highlightVars = (text: string) => {
    return text.replace(/\{\{(\w+)\}\}/g, '⟨$1⟩');
  };

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-bold text-foreground uppercase tracking-tight">📋 Snippets</h2>
          <p className="text-xs text-muted-foreground mt-0.5">Blocs de texte réutilisables dans vos séquences</p>
        </div>
        <button
          onClick={openCreateModal}
          className="relative overflow-hidden flex items-center gap-1.5 h-[34px] px-4 text-xs font-medium uppercase tracking-wider border border-border bg-foreground text-background group shrink-0"
        >
          <Plus className="w-3.5 h-3.5 relative z-10" />
          <span className="relative z-10">Nouveau snippet</span>
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground" />
          <Input
            placeholder="Rechercher..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-9 bg-background border-border rounded-lg"
          />
        </div>
        <Select value={categoryFilter} onValueChange={setCategoryFilter}>
          <SelectTrigger className="w-[160px] bg-background border-border rounded-lg text-xs uppercase tracking-wide">
            <SelectValue placeholder="Catégorie" />
          </SelectTrigger>
          <SelectContent className="bg-background border-border rounded-lg">
            <SelectItem value="all">Toutes</SelectItem>
            {CATEGORIES.map(c => (
              <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {/* Snippets grid */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-6 w-6 border-b-2 border-border" />
        </div>
      ) : filtered.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 bg-background border border-border">
          <FileText className="w-10 h-10 text-muted-foreground mb-3" />
          <h3 className="font-bold text-foreground mb-1 uppercase tracking-wide">Aucun snippet</h3>
          <p className="text-sm text-muted-foreground mb-4">
            {snippets.length === 0 ? 'Créez votre premier snippet réutilisable' : 'Aucun résultat pour cette recherche'}
          </p>
          {snippets.length === 0 && (
            <button onClick={openCreateModal} className="h-[30px] px-4 bg-foreground text-background text-xs font-medium uppercase tracking-wider">
              Créer un snippet
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(snippet => (
            <div key={snippet.id} className="border border-border bg-background p-4 group hover:bg-muted/30 transition-colors">
              <div className="flex items-start justify-between gap-2 mb-2">
                <h3 className="font-bold text-sm text-foreground truncate">{snippet.name}</h3>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button onClick={() => openEditModal(snippet)} className="p-1 hover:bg-muted" title="Modifier">
                    <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                  <button onClick={() => handleDuplicate(snippet)} className="p-1 hover:bg-muted" title="Dupliquer">
                    <Copy className="w-3.5 h-3.5 text-muted-foreground" />
                  </button>
                  <button onClick={() => setDeleteId(snippet.id)} className="p-1 hover:bg-muted" title="Supprimer">
                    <Trash2 className="w-3.5 h-3.5 text-destructive" />
                  </button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground line-clamp-2 mb-3 whitespace-pre-wrap">
                {highlightVars(snippet.content)}
              </p>
              <div className="flex items-center justify-between">
                {snippet.category && (
                  <Badge variant="outline" className="text-[10px] uppercase tracking-wider rounded-full border-border">
                    {getCategoryLabel(snippet.category)}
                  </Badge>
                )}
                <span className="text-[10px] text-muted-foreground ml-auto">
                  {formatDistanceToNow(new Date(snippet.created_at), { addSuffix: true, locale: fr })}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit modal */}
      <Dialog open={editModal.open} onOpenChange={(open) => !open && setEditModal({ open: false })}>
        <DialogContent className="bg-background border-border rounded-lg max-w-md">
          <DialogHeader>
            <DialogTitle className="uppercase tracking-wide text-sm">
              {editModal.snippet ? 'Modifier le snippet' : 'Nouveau snippet'}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Nom *</Label>
              <Input
                value={formData.name}
                onChange={(e) => setFormData(p => ({ ...p, name: e.target.value }))}
                placeholder="Ex: Intro sourcing tech"
                className="mt-1.5 border-border rounded-lg"
              />
            </div>
            <div>
              <Label>Catégorie</Label>
              <Select value={formData.category || 'none'} onValueChange={(v) => setFormData(p => ({ ...p, category: v === 'none' ? '' : v }))}>
                <SelectTrigger className="mt-1.5 border-border rounded-lg">
                  <SelectValue placeholder="Sélectionner..." />
                </SelectTrigger>
                <SelectContent className="bg-background border-border rounded-lg">
                  <SelectItem value="none">Sans catégorie</SelectItem>
                  {CATEGORIES.map(c => (
                    <SelectItem key={c.value} value={c.value}>{c.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div>
              <div className="flex items-center justify-between mb-1.5">
                <Label>Contenu *</Label>
                <span className="text-[10px] text-muted-foreground">
                  Variables : {'{{first_name}}'}, {'{{company}}'}, {'{{job_title}}'}
                </span>
              </div>
              <Textarea
                value={formData.content}
                onChange={(e) => setFormData(p => ({ ...p, content: e.target.value }))}
                placeholder="Bonjour {{first_name}}, je me permets de vous contacter..."
                rows={6}
                className="border-border rounded-lg text-sm"
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditModal({ open: false })} className="border-border rounded-lg">
              Annuler
            </Button>
            <Button onClick={handleSave} disabled={saving} className="bg-foreground text-background rounded-lg">
              {saving ? 'Sauvegarde...' : 'Sauvegarder'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirmation */}
      <AlertDialog open={!!deleteId} onOpenChange={() => setDeleteId(null)}>
        <AlertDialogContent className="bg-background border-border rounded-lg">
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce snippet ?</AlertDialogTitle>
            <AlertDialogDescription>Cette action est irréversible.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="rounded-lg">Annuler</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} className="bg-destructive text-destructive-foreground rounded-lg">
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

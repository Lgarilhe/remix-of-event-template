/**
 * MessageTemplatesSettings — UI CRUD pour les templates de messages.
 *
 * Permet à l'user de créer/éditer/supprimer ses templates personnels.
 * Les templates sont utilisables dans le composer inbox via slash command
 * (taper "/" puis le shortcut ou le nom).
 *
 * Structure : liste des templates existants + form pour créer/éditer.
 */

import React, { useState } from 'react';
import { useMessageTemplates, type MessageTemplate, type CreateTemplateInput } from '@/hooks/useMessageTemplates';
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
import {
  FileText, Plus, Pencil, Trash2, Sparkles, Loader2,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';

// Templates pré-remplis suggérés au premier usage
const SUGGESTED_TEMPLATES: CreateTemplateInput[] = [
  {
    name: 'Intro générale',
    shortcut: '/intro',
    emoji: '👋',
    category: 'Intro',
    content: `Bonjour {{prénom}},

J'ai vu votre profil et votre parcours chez {{entreprise actuelle}} m'a vraiment marqué.

Nous accompagnons actuellement {{client}} sur la recherche d'un {{poste}} et je pense que ça pourrait vous intéresser.

Seriez-vous ouvert(e) à 15 min d'échange cette semaine ?

Bonne journée,`,
  },
  {
    name: 'Relance J+3',
    shortcut: '/relance',
    emoji: '⏰',
    category: 'Relance',
    content: `Bonjour {{prénom}},

Je me permets de revenir vers vous suite à mon précédent message.

Je sais que les inbox sont chargées — un simple "intéressé" / "pas pour moi" suffit !

Bonne journée,`,
  },
  {
    name: 'Lien Calendly',
    shortcut: '/calendly',
    emoji: '📅',
    category: 'Calendly',
    content: `Parfait ! Voici mon lien pour caler 15 min :

{{lien Calendly}}

Choisissez le créneau qui vous arrange. À très bientôt !`,
  },
  {
    name: 'Remerciement',
    shortcut: '/merci',
    emoji: '🙏',
    category: 'Closing',
    content: `Merci beaucoup pour votre retour {{prénom}} !

Je vous tiens au courant des prochaines étapes très vite.

Excellente journée,`,
  },
];

export const MessageTemplatesSettings: React.FC = () => {
  const { templates, isLoading, create, update, remove } = useMessageTemplates();
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<MessageTemplate | null>(null);

  const handleCreateSuggested = async (template: CreateTemplateInput) => {
    create(template);
  };

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between gap-3">
          <CardTitle className="flex items-center gap-2 text-sm font-bold uppercase tracking-wider">
            <FileText className="w-4 h-4" />
            Templates de messages
          </CardTitle>
          <Button
            size="sm"
            onClick={() => setCreating(true)}
            className="gap-1.5"
          >
            <Plus className="w-3.5 h-3.5" />
            Nouveau template
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Créez des réponses-types réutilisables. Insérez-les dans le composer
          en tapant <kbd className="px-1.5 py-0.5 bg-muted rounded text-xs font-mono">/</kbd> suivi
          du nom ou du raccourci.
        </p>

        {/* État vide : suggestions de templates pré-remplis */}
        {!isLoading && templates.length === 0 && (
          <div className="border border-dashed border-border rounded-lg p-6 bg-muted/20">
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="w-4 h-4 text-foreground" />
              <h4 className="text-sm font-semibold">Démarrer avec des templates suggérés</h4>
            </div>
            <p className="text-xs text-muted-foreground mb-4">
              Ajoutez en un clic des templates classiques (intro, relance, Calendly, remerciement).
              Vous pourrez les modifier ensuite.
            </p>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
              {SUGGESTED_TEMPLATES.map((tpl) => (
                <button
                  key={tpl.shortcut}
                  type="button"
                  onClick={() => handleCreateSuggested(tpl)}
                  className="flex items-start gap-2 p-3 text-left rounded-md border border-border bg-background hover:bg-muted/40 transition-colors"
                >
                  <span className="text-lg shrink-0">{tpl.emoji}</span>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">{tpl.name}</span>
                      <kbd className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {tpl.shortcut}
                      </kbd>
                    </div>
                    <p className="text-xs text-muted-foreground truncate mt-0.5">
                      {tpl.content.slice(0, 60)}…
                    </p>
                  </div>
                  <Plus className="w-3.5 h-3.5 text-muted-foreground shrink-0 mt-0.5" />
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Liste des templates existants */}
        {!isLoading && templates.length > 0 && (
          <div className="space-y-2">
            {templates.map((tpl) => (
              <div
                key={tpl.id}
                className="flex items-start gap-3 p-3 rounded-lg border border-border hover:border-foreground/20 transition-colors group"
              >
                {tpl.emoji && (
                  <span className="text-xl shrink-0">{tpl.emoji}</span>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h4 className="text-sm font-semibold">{tpl.name}</h4>
                    {tpl.shortcut && (
                      <kbd className="text-[10px] font-mono text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                        {tpl.shortcut}
                      </kbd>
                    )}
                    {tpl.category && (
                      <span className="text-[10px] text-muted-foreground bg-muted/40 px-1.5 py-0.5 rounded">
                        {tpl.category}
                      </span>
                    )}
                    {tpl.usage_count > 0 && (
                      <span className="text-[10px] text-muted-foreground/70">
                        Utilisé {tpl.usage_count}×
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground line-clamp-2 mt-1 whitespace-pre-line">
                    {tpl.content}
                  </p>
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7"
                    onClick={() => setEditingTemplate(tpl)}
                    aria-label="Modifier"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    className="h-7 w-7 text-muted-foreground hover:text-destructive"
                    onClick={() => setDeleteConfirm(tpl)}
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
          <div className="flex items-center justify-center py-8 text-muted-foreground">
            <Loader2 className="w-4 h-4 animate-spin mr-2" />
            <span className="text-xs">Chargement...</span>
          </div>
        )}
      </CardContent>

      {/* Modal Create / Edit */}
      <TemplateFormDialog
        open={creating || !!editingTemplate}
        template={editingTemplate}
        onClose={() => {
          setCreating(false);
          setEditingTemplate(null);
        }}
        onSubmit={(input) => {
          if (editingTemplate) {
            update({ id: editingTemplate.id, ...input });
          } else {
            create(input);
          }
          setCreating(false);
          setEditingTemplate(null);
        }}
      />

      {/* Confirmation suppression */}
      <AlertDialog open={!!deleteConfirm} onOpenChange={(open) => !open && setDeleteConfirm(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer ce template ?</AlertDialogTitle>
            <AlertDialogDescription>
              "{deleteConfirm?.name}" sera définitivement supprimé. Cette action est irréversible.
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

// ─── Form Dialog (Create / Edit) ──────────────────────────────────────

interface TemplateFormDialogProps {
  open: boolean;
  template: MessageTemplate | null;
  onClose: () => void;
  onSubmit: (input: CreateTemplateInput) => void;
}

const TemplateFormDialog: React.FC<TemplateFormDialogProps> = ({
  open,
  template,
  onClose,
  onSubmit,
}) => {
  const [form, setForm] = useState<CreateTemplateInput>({
    name: '',
    shortcut: null,
    emoji: null,
    category: null,
    content: '',
  });

  // Reset le form à l'ouverture / changement de template
  React.useEffect(() => {
    if (open) {
      if (template) {
        setForm({
          name: template.name,
          shortcut: template.shortcut,
          emoji: template.emoji,
          category: template.category,
          content: template.content,
        });
      } else {
        setForm({ name: '', shortcut: null, emoji: null, category: null, content: '' });
      }
    }
  }, [open, template]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name.trim() || !form.content.trim()) {
      toast.error('Nom et contenu sont obligatoires');
      return;
    }
    // Normalise shortcut (force "/" préfixe si non vide)
    let shortcut = form.shortcut?.trim() || null;
    if (shortcut && !shortcut.startsWith('/')) shortcut = '/' + shortcut;
    onSubmit({
      ...form,
      shortcut,
      name: form.name.trim(),
      content: form.content.trim(),
      emoji: form.emoji?.trim() || null,
      category: form.category?.trim() || null,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{template ? 'Modifier le template' : 'Nouveau template'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-foreground mb-1 block">
                Nom <span className="text-destructive">*</span>
              </label>
              <Input
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="Ex: Intro générale"
                required
                className="h-9 text-sm"
              />
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">
                Raccourci
              </label>
              <Input
                value={form.shortcut || ''}
                onChange={(e) => setForm({ ...form, shortcut: e.target.value })}
                placeholder="/intro"
                className="h-9 text-sm font-mono"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Tapez "/" + raccourci dans le composer
              </p>
            </div>
            <div>
              <label className="text-xs font-medium text-foreground mb-1 block">
                Emoji
              </label>
              <Input
                value={form.emoji || ''}
                onChange={(e) => setForm({ ...form, emoji: e.target.value })}
                placeholder="👋"
                maxLength={4}
                className="h-9 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-foreground mb-1 block">
                Catégorie
              </label>
              <Input
                value={form.category || ''}
                onChange={(e) => setForm({ ...form, category: e.target.value })}
                placeholder="Intro, Relance, Closing..."
                className="h-9 text-sm"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-foreground mb-1 block">
                Contenu <span className="text-destructive">*</span>
              </label>
              <Textarea
                value={form.content}
                onChange={(e) => setForm({ ...form, content: e.target.value })}
                placeholder="Bonjour {{prénom}}..."
                required
                rows={8}
                className="text-sm leading-relaxed font-mono"
              />
              <p className="text-[10px] text-muted-foreground mt-1">
                Astuce : utilisez <code className="bg-muted px-1 rounded">{'{{prénom}}'}</code> pour
                des placeholders à remplacer manuellement.
              </p>
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit">
              {template ? 'Enregistrer' : 'Créer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

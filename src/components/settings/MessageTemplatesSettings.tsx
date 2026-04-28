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
  FileText, Plus, Pencil, Trash2, Sparkles, Loader2, Info, Variable, Settings as SettingsIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { PLACEHOLDERS_CATALOG } from '@/lib/templatePlaceholders';
import { CustomVariablesSettings } from './CustomVariablesSettings';
import { useUserTemplateVariables } from '@/hooks/useUserTemplateVariables';

// Templates pré-remplis suggérés au premier usage
// Les placeholders sont AUTOMATIQUEMENT remplacés à l'insertion
// (cf src/lib/templatePlaceholders.ts pour la liste complète)
const SUGGESTED_TEMPLATES: CreateTemplateInput[] = [
  {
    name: 'Intro générale',
    shortcut: '/intro',
    emoji: '👋',
    category: 'Intro',
    content: `Bonjour {{prenom}},

J'ai vu votre profil et votre parcours {{poste_actuel}} chez {{entreprise_actuelle}} m'a vraiment marqué.

Nous accompagnons actuellement {{client}} sur la recherche d'un {{poste_recherche}} et je pense que ça pourrait vous intéresser.

Seriez-vous ouvert(e) à 15 min d'échange cette semaine ?

Bonne journée,
{{mon_prenom}}`,
  },
  {
    name: 'Relance J+3',
    shortcut: '/relance',
    emoji: '⏰',
    category: 'Relance',
    content: `Bonjour {{prenom}},

Je me permets de revenir vers vous suite à mon précédent message.

Je sais que les inbox sont chargées — un simple "intéressé" / "pas pour moi" suffit !

Bonne journée,
{{mon_prenom}}`,
  },
  {
    name: 'Lien Calendly',
    shortcut: '/calendly',
    emoji: '📅',
    category: 'Calendly',
    content: `Parfait {{prenom}} ! Voici mon lien pour caler 15 min :

{{lien_calendly}}

Choisissez le créneau qui vous arrange. À très bientôt !

{{mon_prenom}}`,
  },
  {
    name: 'Remerciement',
    shortcut: '/merci',
    emoji: '🙏',
    category: 'Closing',
    content: `Merci beaucoup pour votre retour {{prenom}} !

Je vous tiens au courant des prochaines étapes très vite.

Excellente journée,
{{mon_prenom}}`,
  },
  {
    name: 'Présentation poste',
    shortcut: '/poste',
    emoji: '💼',
    category: 'Présentation',
    content: `Bonjour {{prenom}},

Pour résumer le poste : {{client}} recherche un {{poste_recherche}}.

Le contexte est intéressant et l'équipe vraiment top. Je peux vous envoyer la fiche complète si vous voulez en savoir plus !

{{mon_prenom}}`,
  },
  {
    name: 'Demande disponibilité',
    shortcut: '/dispo',
    emoji: '🗓',
    category: 'Coordination',
    content: `Bonjour {{prenom}},

Quelles seraient vos disponibilités cette semaine ou la semaine prochaine pour un échange de 15 min ?

Le matin entre 10h et 12h ou en fin d'après-midi entre 16h et 18h fonctionne en général bien de mon côté.

À votre écoute,
{{mon_prenom}}`,
  },
];

export const MessageTemplatesSettings: React.FC = () => {
  return (
    <div className="space-y-6">
      <TemplatesSection />
      <CustomVariablesSettings />
    </div>
  );
};

const TemplatesSection: React.FC = () => {
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

// ─── Placeholders Panel (cliquable pour insérer) ─────────────────────

interface PlaceholdersPanelProps {
  onInsert: (placeholder: string) => void;
}

const PLACEHOLDER_CATEGORIES = [
  { key: 'contact', label: 'Contact', emoji: '👤', description: 'Données du contact' },
  { key: 'enriched', label: 'Données enrichies', emoji: '✨', description: 'Calculées depuis le profil' },
  { key: 'mission', label: 'Mission', emoji: '🎯', description: 'Job en cours de sourcing' },
  { key: 'sender', label: 'Vous (sender)', emoji: '✍️', description: 'Vos infos personnelles' },
  { key: 'date', label: 'Date & contexte', emoji: '📅', description: 'Salutation, jour, etc.' },
  { key: 'conv', label: 'Conversation', emoji: '💬', description: 'Sujet, nb messages' },
] as const;

const PlaceholdersPanel: React.FC<PlaceholdersPanelProps> = ({ onInsert }) => {
  const [search, setSearch] = useState('');
  const { variables: customVars } = useUserTemplateVariables();

  // Filtre placeholders builtin par recherche
  const filteredCatalog = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return PLACEHOLDERS_CATALOG;
    return PLACEHOLDERS_CATALOG.filter(p =>
      p.key.toLowerCase().includes(q) ||
      p.label.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q)
    );
  }, [search]);

  // Filtre custom variables par recherche
  const filteredCustom = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return customVars;
    return customVars.filter(v =>
      v.key.toLowerCase().includes(q) ||
      v.value.toLowerCase().includes(q) ||
      (v.description || '').toLowerCase().includes(q)
    );
  }, [search, customVars]);

  return (
    <div className="flex flex-col h-full">
      {/* Header sticky avec recherche */}
      <div className="px-4 py-3 border-b border-border bg-background sticky top-0 z-10">
        <div className="flex items-center gap-1.5 mb-2">
          <Info className="w-3 h-3 text-muted-foreground" />
          <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
            Variables disponibles
          </span>
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher (prenom, client, lien...)"
          className="h-8 text-xs"
        />
        <p className="text-[10px] text-muted-foreground/80 mt-1.5 leading-relaxed">
          Cliquez pour insérer · Le placeholder sera remplacé automatiquement
        </p>
      </div>

      {/* Sections de placeholders */}
      <div className="px-4 py-3 space-y-3">
        {PLACEHOLDER_CATEGORIES.map((cat) => {
          const items = filteredCatalog.filter(p => p.category === cat.key);
          if (items.length === 0) return null;
          return (
            <div key={cat.key}>
              <div className="flex items-center gap-1.5 mb-1.5 sticky top-0">
                <span className="text-xs">{cat.emoji}</span>
                <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground">
                  {cat.label}
                </span>
                <span className="text-[10px] text-muted-foreground/60">
                  · {items.length}
                </span>
              </div>
              <div className="flex flex-wrap gap-1">
                {items.map((p) => (
                  <button
                    key={p.key}
                    type="button"
                    onClick={() => onInsert(p.key)}
                    title={`${p.description}${p.example ? ` — ex: ${p.example}` : ''}`}
                    className="inline-flex items-center px-2 py-1 text-[10px] font-mono rounded-md bg-background border border-border hover:bg-foreground hover:text-background hover:border-foreground transition-all"
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
          );
        })}

        {/* Section variables custom user */}
        {filteredCustom.length > 0 && (
          <div>
            <div className="flex items-center gap-1.5 mb-1.5">
              <Variable className="w-3 h-3 text-foreground" />
              <span className="text-[10px] font-semibold uppercase tracking-wider text-foreground">
                Mes variables custom
              </span>
              <span className="text-[10px] text-muted-foreground/60">
                · {filteredCustom.length}
              </span>
            </div>
            <div className="flex flex-wrap gap-1">
              {filteredCustom.map((v) => (
                <button
                  key={v.id}
                  type="button"
                  onClick={() => onInsert(v.key)}
                  title={`${v.description || 'Variable custom'} — ${v.value.slice(0, 60)}${v.value.length > 60 ? '…' : ''}`}
                  className="inline-flex items-center px-2 py-1 text-[10px] font-mono rounded-md bg-background border border-foreground/30 hover:bg-foreground hover:text-background transition-all"
                >
                  {`{{${v.key}}}`}
                </button>
              ))}
            </div>
          </div>
        )}

        {filteredCatalog.length === 0 && filteredCustom.length === 0 && (
          <div className="text-center py-6 text-xs text-muted-foreground">
            Aucune variable trouvée pour "{search}"
          </div>
        )}

        {/* Astuce filtres */}
        <div className="mt-4 p-2 rounded-md bg-background/60 border border-border/50">
          <p className="text-[10px] font-semibold text-foreground/80 mb-1">💡 Filtres avancés</p>
          <ul className="text-[10px] text-muted-foreground space-y-0.5 leading-relaxed">
            <li><code className="bg-muted px-1 rounded">{'{{prenom | upper}}'}</code> — MAJ</li>
            <li><code className="bg-muted px-1 rounded">{'{{prenom | capitalize}}'}</code> — Prénom</li>
            <li><code className="bg-muted px-1 rounded">{'{{client | fallback:"votre boîte"}}'}</code></li>
            <li><code className="bg-muted px-1 rounded">{'{{headline | truncate:50}}'}</code></li>
          </ul>
        </div>
      </div>
    </div>
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

  /** Insère un placeholder dans la textarea content à la position du curseur */
  const contentRef = React.useRef<HTMLTextAreaElement>(null);
  const insertPlaceholder = (placeholder: string) => {
    const ta = contentRef.current;
    const tag = `{{${placeholder}}}`;
    if (!ta) {
      setForm({ ...form, content: form.content + tag });
      return;
    }
    const start = ta.selectionStart ?? form.content.length;
    const end = ta.selectionEnd ?? form.content.length;
    const newContent = form.content.slice(0, start) + tag + form.content.slice(end);
    setForm({ ...form, content: newContent });
    requestAnimationFrame(() => {
      ta.focus();
      const newPos = start + tag.length;
      ta.setSelectionRange(newPos, newPos);
    });
  };

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      {/* Modal large + scrollable avec layout 2 colonnes : form gauche,
          panel placeholders droite. max-h-[90vh] + overflow-hidden + flex
          column pour que le footer reste sticky bottom. */}
      <DialogContent className="max-w-5xl max-h-[90vh] p-0 overflow-hidden flex flex-col">
        <DialogHeader className="px-6 pt-6 pb-3 border-b border-border shrink-0">
          <DialogTitle>{template ? 'Modifier le template' : 'Nouveau template'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
          {/* Body en 2 colonnes — scrollable indépendamment */}
          <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] flex-1 min-h-0 overflow-hidden">
            {/* COLONNE GAUCHE — form + content */}
            <div className="overflow-y-auto p-6 space-y-4 min-w-0">
              <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
                <div className="md:col-span-3">
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
                <div>
                  <label className="text-xs font-medium text-foreground mb-1 block">
                    Catégorie
                  </label>
                  <Input
                    value={form.category || ''}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    placeholder="Intro, Relance..."
                    className="h-9 text-sm"
                  />
                </div>
              </div>

              <div>
                <label className="text-xs font-medium text-foreground mb-1 block">
                  Contenu <span className="text-destructive">*</span>
                </label>
                <Textarea
                  ref={contentRef}
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  placeholder="Bonjour {{prenom}}, ..."
                  required
                  rows={12}
                  className="text-sm leading-relaxed font-mono resize-y"
                />
                <p className="text-[10px] text-muted-foreground mt-1">
                  💡 Cliquez sur une variable à droite pour l'insérer · Astuce : utilisez
                  <code className="bg-muted px-1 mx-0.5 rounded">{'{{client | fallback:"votre boîte"}}'}</code>
                  pour gérer les valeurs manquantes
                </p>
              </div>
            </div>

            {/* COLONNE DROITE — placeholders avec recherche + sections */}
            <div className="border-l border-border bg-muted/20 overflow-y-auto min-w-0">
              <PlaceholdersPanel onInsert={insertPlaceholder} />
            </div>
          </div>

          {/* Footer sticky bottom */}
          <DialogFooter className="px-6 py-4 border-t border-border shrink-0 bg-background">
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

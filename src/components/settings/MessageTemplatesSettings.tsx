/**
 * MessageTemplatesSettings — UI CRUD pour les templates de messages.
 *
 * Permet à l'user de créer/éditer/supprimer ses templates personnels.
 * Les templates sont utilisables dans le composer inbox via slash command
 * (taper "/" puis le shortcut ou le nom).
 *
 * Structure : liste des templates existants + form pour créer/éditer.
 *
 * Lot 12 du chantier design : « modèle » à l'écran (F-20), plus d'émoji servant
 * d'icône (F-19), actions de ligne toujours visibles (F-12), libellés reliés à
 * leur champ (F-15), squelette au chargement (F-66).
 */

import React, { useId, useState } from 'react';
import { useMessageTemplates, type MessageTemplate, type CreateTemplateInput } from '@/hooks/useMessageTemplates';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Skeleton } from '@/components/ui/skeleton';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { FileText, Plus, Pencil, Trash2, Variable } from 'lucide-react';
import { toast } from 'sonner';
import { plural } from '@/lib/plural';
import { PLACEHOLDERS_CATALOG } from '@/lib/templatePlaceholders';
import { useUserTemplateVariables } from '@/hooks/useUserTemplateVariables';
import { ErrorBox } from '@/components/layout/ErrorBox';

/** Raccourci ou variable cités tels qu'on les tape. */
const KBD = 'rounded-sm border border-border bg-muted px-1.5 py-0.5 text-2xs text-muted-foreground';

// Templates pré-remplis suggérés au premier usage
// Les placeholders sont AUTOMATIQUEMENT remplacés à l'insertion
// (cf src/lib/templatePlaceholders.ts pour la liste complète)
// Sans émoji : un émoji ne sert jamais d'icône (revue design F-19).
const SUGGESTED_TEMPLATES: CreateTemplateInput[] = [
  {
    name: 'Intro générale',
    shortcut: '/intro',
    emoji: null,
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
    emoji: null,
    category: 'Relance',
    content: `Bonjour {{prenom}},

Je me permets de revenir vers vous suite à mon précédent message.

Je sais que les messageries sont chargées : un simple « intéressé » ou « pas pour moi » suffit !

Bonne journée,
{{mon_prenom}}`,
  },
  {
    name: 'Lien Calendly',
    shortcut: '/calendly',
    emoji: null,
    category: 'Rendez-vous',
    content: `Parfait {{prenom}} ! Voici mon lien pour caler 15 min :

{{lien_calendly}}

Choisissez le créneau qui vous arrange. À très bientôt !

{{mon_prenom}}`,
  },
  {
    name: 'Remerciement',
    shortcut: '/merci',
    emoji: null,
    category: 'Conclusion',
    content: `Merci beaucoup pour votre retour {{prenom}} !

Je vous tiens au courant des prochaines étapes très vite.

Excellente journée,
{{mon_prenom}}`,
  },
  {
    name: 'Présentation poste',
    shortcut: '/poste',
    emoji: null,
    category: 'Présentation',
    content: `Bonjour {{prenom}},

Pour résumer le poste : {{client}} recherche un {{poste_recherche}}.

Le contexte est intéressant et l'équipe vraiment top. Je peux vous envoyer la fiche complète si vous voulez en savoir plus !

{{mon_prenom}}`,
  },
  {
    name: 'Demande disponibilité',
    shortcut: '/dispo',
    emoji: null,
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
    </div>
  );
};

const TemplatesSection: React.FC = () => {
  const { templates, isLoading, isError, refetch, create, update, remove } = useMessageTemplates();
  const [editingTemplate, setEditingTemplate] = useState<MessageTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState<MessageTemplate | null>(null);

  const handleCreateSuggested = async (template: CreateTemplateInput) => {
    create(template);
  };

  return (
    <Card>
      <CardHeader className="flex-row flex-wrap items-center justify-between gap-3 space-y-0">
        <CardTitle className="flex items-center gap-2 text-sm font-semibold">
          <FileText className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          Modèles de messages
        </CardTitle>
        <Button
          size="sm"
          variant="outline"
          onClick={() => setCreating(true)}
          disabled={isLoading || isError}
          className="max-md:h-11"
        >
          <Plus aria-hidden="true" />
          Nouveau modèle
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Créez des réponses prêtes à l'emploi. Dans la messagerie, tapez <kbd className={KBD}>/</kbd> puis
          le nom ou le raccourci d'un modèle pour l'insérer.
        </p>

        {/* Lecture ratée : ni suggestions ni liste, sinon on croirait les modèles perdus */}
        {isError && (
          <ErrorBox title="Impossible de charger vos modèles." onRetry={() => { void refetch(); }} />
        )}

        {/* État vide : suggestions de modèles pré-remplis. Design simplifié : sans encadré,
            chaque suggestion est une ligne discrète (bouton ghost), plus de tuiles bordées. */}
        {!isLoading && !isError && templates.length === 0 && (
          <div className="space-y-3">
            <div>
              <h4 className="text-sm font-semibold text-foreground">Commencer avec des modèles suggérés</h4>
              <p className="mt-1 text-xs text-muted-foreground">
                Ajoutez en un clic des modèles courants (introduction, relance, prise de rendez-vous, remerciement).
                Vous pourrez les modifier ensuite.
              </p>
            </div>
            <ul className="grid grid-cols-1 gap-1 md:grid-cols-2 md:gap-x-6">
              {SUGGESTED_TEMPLATES.map((tpl) => (
                <li key={tpl.shortcut} className="-mx-2">
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => handleCreateSuggested(tpl)}
                    aria-label={`Ajouter le modèle ${tpl.name}`}
                    className="h-auto w-full items-start justify-start gap-2 whitespace-normal px-2 py-2 text-left font-normal"
                  >
                    <Plus className="mt-0.5 text-muted-foreground" aria-hidden="true" />
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-medium text-foreground">{tpl.name}</span>
                        <kbd className={KBD}>{tpl.shortcut}</kbd>
                      </span>
                      <span className="mt-0.5 block truncate text-xs text-muted-foreground">
                        {tpl.content.slice(0, 60)}…
                      </span>
                    </span>
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Liste des modèles existants */}
        {!isLoading && !isError && templates.length > 0 && (
          <ul className="divide-y divide-border">
            {templates.map((tpl) => (
              <li key={tpl.id} className="flex items-start gap-3 py-3">
                {/* Émoji choisi par la personne : son contenu, décoratif (comme dans la messagerie). */}
                {tpl.emoji && (
                  <span className="shrink-0 text-lg leading-none" aria-hidden="true">{tpl.emoji}</span>
                )}
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="text-sm font-semibold text-foreground">{tpl.name}</h4>
                    {tpl.shortcut && <kbd className={KBD}>{tpl.shortcut}</kbd>}
                    {tpl.category && <span className="text-xs text-muted-foreground">{tpl.category}</span>}
                    {tpl.usage_count > 0 && (
                      <span className="text-xs text-muted-foreground">
                        Utilisé {plural(tpl.usage_count, 'fois', 'fois')}
                      </span>
                    )}
                  </div>
                  <p className="mt-1 line-clamp-2 whitespace-pre-line text-xs text-muted-foreground">
                    {tpl.content}
                  </p>
                </div>
                {/* Toujours visibles : au doigt et au clavier, pas seulement au survol (F-12). */}
                <div className="flex shrink-0 items-center gap-1">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-foreground max-md:h-11 max-md:w-11"
                        onClick={() => setEditingTemplate(tpl)}
                        aria-label={`Modifier le modèle ${tpl.name}`}
                      >
                        <Pencil aria-hidden="true" />
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent>Modifier</TooltipContent>
                  </Tooltip>
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        className="text-muted-foreground hover:text-danger max-md:h-11 max-md:w-11"
                        onClick={() => setDeleteConfirm(tpl)}
                        aria-label={`Supprimer le modèle ${tpl.name}`}
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

        {isLoading && (
          <div role="status" className="space-y-2">
            {[0, 1, 2].map((i) => (
              <Skeleton key={i} className="h-16 w-full rounded-lg" aria-hidden="true" />
            ))}
            <span className="sr-only">Chargement des modèles…</span>
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
            <AlertDialogTitle>Supprimer ce modèle ?</AlertDialogTitle>
            <AlertDialogDescription>
              Le modèle « {deleteConfirm?.name} » sera supprimé. Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive"
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
  { key: 'contact', label: 'Contact' },
  { key: 'enriched', label: 'Données enrichies' },
  { key: 'mission', label: 'Mission' },
  { key: 'sender', label: 'Vous (expéditeur)' },
  { key: 'date', label: 'Date et contexte' },
  { key: 'conv', label: 'Conversation' },
] as const;

const PlaceholdersPanel: React.FC<PlaceholdersPanelProps> = ({ onInsert }) => {
  const [search, setSearch] = useState('');
  const { variables: customVars } = useUserTemplateVariables();
  const uid = useId();

  // Filtre placeholders builtin par recherche
  const filteredCatalog = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return PLACEHOLDERS_CATALOG;
    return PLACEHOLDERS_CATALOG.filter(p =>
      String(p.key).toLowerCase().includes(q) ||
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
    <div className="flex h-full flex-col">
      {/* En-tête collant avec la recherche */}
      <div className="sticky top-0 z-10 space-y-2 border-b border-border bg-background px-4 py-3">
        <Label htmlFor={`${uid}-recherche`} className="text-xs font-semibold text-foreground">
          Variables disponibles
        </Label>
        <Input
          id={`${uid}-recherche`}
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Rechercher (prénom, client, lien…)"
          className="h-8 text-xs max-md:h-11"
          aria-describedby={`${uid}-recherche-aide`}
        />
        <p id={`${uid}-recherche-aide`} className="text-xs leading-relaxed text-muted-foreground">
          Cliquez sur une variable pour l'insérer : elle sera remplacée automatiquement à l'envoi.
        </p>
      </div>

      {/* Sections de variables */}
      <div className="space-y-3 px-4 py-3">
        {PLACEHOLDER_CATEGORIES.map((cat) => {
          const items = filteredCatalog.filter(p => p.category === cat.key);
          if (items.length === 0) return null;
          return (
            <section key={cat.key} aria-labelledby={`${uid}-${cat.key}`}>
              <h3 id={`${uid}-${cat.key}`} className="eyebrow mb-1.5">
                {cat.label} · {items.length}
              </h3>
              {/* Chasse fixe : des variables, du code inséré tel quel dans le message. */}
              <div className="flex flex-wrap gap-1">
                {items.map((p) => (
                  <Button
                    key={String(p.key)}
                    type="button"
                    variant="outline"
                    size="xs"
                    onClick={() => onInsert(String(p.key))}
                    title={p.example ? `${p.description} (ex. : ${p.example})` : p.description}
                    aria-label={`Insérer ${p.label} : ${p.description}`}
                    className="font-mono text-2xs max-md:h-11"
                  >
                    {p.label}
                  </Button>
                ))}
              </div>
            </section>
          );
        })}

        {/* Section variables personnalisées */}
        {filteredCustom.length > 0 && (
          <section aria-labelledby={`${uid}-perso`}>
            <h3 id={`${uid}-perso`} className="eyebrow mb-1.5 flex items-center gap-1.5">
              <Variable className="h-3 w-3" aria-hidden="true" />
              Mes variables personnalisées · {filteredCustom.length}
            </h3>
            <div className="flex flex-wrap gap-1">
              {filteredCustom.map((v) => (
                <Button
                  key={v.id}
                  type="button"
                  variant="outline"
                  size="xs"
                  onClick={() => onInsert(v.key)}
                  title={`${v.description || 'Variable personnalisée'} : ${v.value.slice(0, 60)}${v.value.length > 60 ? '…' : ''}`}
                  className="font-mono text-2xs max-md:h-11"
                >
                  {`{{${v.key}}}`}
                </Button>
              ))}
            </div>
          </section>
        )}

        {filteredCatalog.length === 0 && filteredCustom.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            Aucune variable ne correspond à « {search} ».
          </p>
        )}

        {/* Astuce filtres */}
        <div className="mt-4 rounded-md border border-border p-2.5">
          <p className="mb-1 text-xs font-semibold text-foreground">Filtres avancés</p>
          <ul className="space-y-0.5 text-xs leading-relaxed text-muted-foreground">
            <li><code className="rounded-sm bg-muted px-1">{'{{prenom | upper}}'}</code> : en majuscules</li>
            <li><code className="rounded-sm bg-muted px-1">{'{{prenom | capitalize}}'}</code> : initiale en majuscule</li>
            <li><code className="rounded-sm bg-muted px-1">{'{{client | fallback:"votre boîte"}}'}</code> : valeur de repli</li>
            <li><code className="rounded-sm bg-muted px-1">{'{{headline | truncate:50}}'}</code> : coupé à 50 caractères</li>
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
  const uid = useId();
  const ids = {
    name: `${uid}-nom`,
    shortcut: `${uid}-raccourci`,
    emoji: `${uid}-emoji`,
    category: `${uid}-categorie`,
    content: `${uid}-contenu`,
    contentHint: `${uid}-contenu-aide`,
  };

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
      toast.error('Le nom et le contenu sont obligatoires.');
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
      <DialogContent className="flex max-h-[90vh] max-w-5xl flex-col overflow-hidden p-0">
        <DialogHeader className="shrink-0 border-b border-border px-6 pb-3 pt-6">
          <DialogTitle>{template ? 'Modifier le modèle' : 'Nouveau modèle'}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex min-h-0 flex-1 flex-col overflow-hidden">
          {/* Corps en 2 colonnes, chacune avec son défilement */}
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden md:grid-cols-[1fr_320px]">
            {/* Colonne gauche : champs et contenu */}
            <div className="min-w-0 space-y-4 overflow-y-auto p-6">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <div className="space-y-1.5 md:col-span-3">
                  <Label htmlFor={ids.name} className="text-xs font-medium">
                    Nom <span className="text-danger" aria-hidden="true">*</span>
                  </Label>
                  <Input
                    id={ids.name}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="Ex. : Introduction"
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={ids.shortcut} className="text-xs font-medium">Raccourci</Label>
                  {/* Chasse fixe : une commande tapée telle quelle dans la messagerie (« /intro »). */}
                  <Input
                    id={ids.shortcut}
                    value={form.shortcut || ''}
                    onChange={(e) => setForm({ ...form, shortcut: e.target.value })}
                    placeholder="/intro"
                    className="font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={ids.emoji} className="text-xs font-medium">Émoji</Label>
                  <Input
                    id={ids.emoji}
                    value={form.emoji || ''}
                    onChange={(e) => setForm({ ...form, emoji: e.target.value })}
                    placeholder="Facultatif"
                    maxLength={4}
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor={ids.category} className="text-xs font-medium">Catégorie</Label>
                  <Input
                    id={ids.category}
                    value={form.category || ''}
                    onChange={(e) => setForm({ ...form, category: e.target.value })}
                    placeholder="Intro, Relance…"
                  />
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor={ids.content} className="text-xs font-medium">
                  Contenu <span className="text-danger" aria-hidden="true">*</span>
                </Label>
                <Textarea
                  id={ids.content}
                  ref={contentRef}
                  value={form.content}
                  onChange={(e) => setForm({ ...form, content: e.target.value })}
                  placeholder="Bonjour {{prenom}}, …"
                  required
                  rows={12}
                  className="resize-y text-sm leading-relaxed"
                  aria-describedby={ids.contentHint}
                />
                <p id={ids.contentHint} className="text-xs text-muted-foreground">
                  Cliquez sur une variable pour l'insérer. Pour une valeur manquante, écrivez par exemple{' '}
                  <code className="rounded-sm bg-muted px-1">{'{{client | fallback:"votre boîte"}}'}</code>.
                </p>
              </div>
            </div>

            {/* Colonne droite : variables, avec recherche */}
            <div className="min-w-0 overflow-y-auto border-t border-border bg-muted/40 md:border-l md:border-t-0">
              <PlaceholdersPanel onInsert={insertPlaceholder} />
            </div>
          </div>

          {/* Pied collé en bas */}
          <DialogFooter className="shrink-0 border-t border-border bg-background px-6 py-4">
            <Button type="button" variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <Button type="submit" variant="primary">
              {template ? 'Enregistrer' : 'Créer le modèle'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
};

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SEOHead } from '@/components/SEOHead';
import { useSourcingProjects, SourcingProject } from '@/hooks/useSourcingProjects';
import { Button } from '@/components/ui/button';
import { BrutalLoader } from '@/components/ui/brutal-loader';
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
import { Search, Plus, Trash2, ArrowRight, Users, Star, Send } from 'lucide-react';

// Nom auto d'une nouvelle recherche : « Recherche du 6 juillet, 14h32 ».
// Remplacé par l'intitulé dès que l'user remplit « Que cherches-tu ? ».
const buildSearchName = () => {
  const now = new Date();
  const date = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(now);
  const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(now).replace(':', 'h');
  return `Recherche du ${date}, ${time}`;
};

const formatDate = (iso: string) =>
  new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }).format(new Date(iso));

const SearchCard = ({
  search,
  onOpen,
  onDelete,
}: {
  search: SourcingProject;
  onOpen: () => void;
  onDelete: () => void;
}) => {
  const stats = [
    { icon: Users, value: search.stats_total_found, label: 'profils' },
    { icon: Star, value: search.stats_shortlisted, label: 'shortlistés' },
    { icon: Send, value: search.stats_messaged, label: 'contactés' },
  ].filter(s => s.value > 0);

  return (
    <div className="interactive-card group relative rounded-xl border border-border bg-card p-4 flex flex-col gap-3">
      <button
        onClick={onOpen}
        className="text-left focus:outline-none"
        aria-label={`Ouvrir la recherche ${search.name}`}
      >
        <span className="absolute inset-0 rounded-xl" aria-hidden="true" />
        <p className="font-display font-bold text-foreground leading-snug line-clamp-2">{search.name}</p>
        <p className="text-xs text-muted-foreground mt-1">Modifiée le {formatDate(search.updated_at)}</p>
      </button>

      <div className="flex items-center gap-1.5 flex-wrap min-h-6">
        {stats.length > 0 ? (
          stats.map(({ icon: Icon, value, label }) => (
            <span
              key={label}
              className="inline-flex items-center gap-1 h-6 px-2 rounded-full bg-muted text-[11.5px] font-medium text-foreground"
            >
              <Icon className="w-3 h-3" />
              <span className="tabular-nums font-bold">{value}</span> {label}
            </span>
          ))
        ) : (
          <span className="text-[11.5px] text-muted-foreground">Aucune recherche lancée</span>
        )}
      </div>

      <div className="relative z-10 flex items-center justify-between gap-2 pt-1 border-t border-border/60">
        <Button variant="ghost" size="sm" className="h-7 px-2 text-xs gap-1" onClick={onOpen}>
          Reprendre <ArrowRight className="w-3 h-3" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="h-7 w-7 p-0 text-muted-foreground hover:text-destructive opacity-0 group-hover:opacity-100 focus:opacity-100 transition-opacity"
          onClick={onDelete}
          aria-label="Supprimer la recherche"
        >
          <Trash2 className="w-3.5 h-3.5" />
        </Button>
      </div>
    </div>
  );
};

export default function SourcingSearches() {
  const navigate = useNavigate();
  const { projects: searches, isLoading, createProject, deleteProject, isCreating, isDeleting } = useSourcingProjects('search');
  const [toDelete, setToDelete] = useState<SourcingProject | null>(null);

  const handleCreate = async () => {
    try {
      const created = await createProject({ name: buildSearchName(), kind: 'search' });
      navigate(`/sourcing/${created.id}`);
    } catch {
      // toast d'erreur déjà géré par le hook
    }
  };

  const handleDelete = async () => {
    if (!toDelete) return;
    try {
      await deleteProject(toDelete.id);
    } catch {
      // toast d'erreur déjà géré par le hook
    } finally {
      setToDelete(null);
    }
  };

  return (
    <div className="w-full max-w-full bg-background">
      <SEOHead
        title="Recherche | Konekt"
        description="Sourcez des candidats librement, sans créer de mission"
      />

      <div className="py-6 w-full max-w-full">
        <div className="max-w-[1600px] mx-auto w-full min-w-0 px-3 sm:px-6 lg:px-8">
          <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-4 mb-6">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium mb-1">Sourcing</p>
              <h1 className="font-display text-2xl font-bold text-foreground tracking-tight">Recherche</h1>
              <p className="text-sm text-muted-foreground mt-1">
                Source des candidats librement — transforme la recherche en mission quand elle devient sérieuse.
              </p>
            </div>
            <Button onClick={handleCreate} disabled={isCreating} className="gap-1.5 shrink-0">
              <Plus className="w-4 h-4" />
              Nouvelle recherche
            </Button>
          </div>

          {isLoading ? (
            <BrutalLoader variant="default" rows={3} messages={['Chargement des recherches…']} />
          ) : searches.length === 0 ? (
            <div className="konekt-fade-up flex flex-col items-center justify-center py-16 text-center rounded-xl border border-dashed border-border">
              <div className="w-14 h-14 rounded-xl bg-foreground text-background flex items-center justify-center mb-4">
                <Search className="w-7 h-7" />
              </div>
              <p className="font-display font-bold text-foreground">Aucune recherche pour l'instant</p>
              <p className="text-sm text-muted-foreground mt-1 max-w-sm">
                Lance une recherche LinkedIn sans créer de mission : filtres, scoring IA et shortlist fonctionnent pareil.
              </p>
              <Button onClick={handleCreate} disabled={isCreating} className="gap-1.5 mt-4">
                <Plus className="w-4 h-4" />
                Démarrer une recherche
              </Button>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
              {searches.map(search => (
                <SearchCard
                  key={search.id}
                  search={search}
                  onOpen={() => navigate(`/sourcing/${search.id}`)}
                  onDelete={() => setToDelete(search)}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Supprimer cette recherche ?</AlertDialogTitle>
            <AlertDialogDescription>
              « {toDelete?.name} » et les statuts candidats associés (shortlist, scores, contactés) seront supprimés.
              Cette action est irréversible.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction className="bg-destructive text-destructive-foreground hover:bg-destructive/90" onClick={handleDelete} disabled={isDeleting}>
              Supprimer
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

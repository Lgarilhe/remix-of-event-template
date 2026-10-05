/**
 * Recherche (/sourcing) : liste des recherches hors mission, au langage de la
 * liste des missions (ProjectsListV2, docs/design/01-direction.md) : en-tête
 * commun, champ de recherche, tableau d'une ligne par recherche, actions en
 * menu, états vide et chargement communs.
 *
 * Les trois chiffres sont des cumuls depuis le début (lot 0c-1) : ils portent
 * « au total », jamais le nom d'une étape.
 */

import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { MoreHorizontal, Plus, Search, Trash2 } from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { useSourcingProjects, SourcingProject } from '@/hooks/useSourcingProjects';
import { timeAgo } from '@/lib/relativeTime';
import { plural } from '@/lib/plural';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { PageHeader } from '@/components/layout/PageHeader';
import { EmptyState } from '@/components/layout/EmptyState';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
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

// Nom auto d'une nouvelle recherche : « Recherche du 6 juillet, 14h32 ».
// Remplacé par l'intitulé dès que l'user remplit « Que cherches-tu ? ».
const buildSearchName = () => {
  const now = new Date();
  const date = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(now);
  const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(now).replace(':', 'h');
  return `Recherche du ${date}, ${time}`;
};

// ── Colonnes de chiffres (cumuls) ──

const COUNT_COLUMNS: ReadonlyArray<{ label: string; of: (s: SourcingProject) => number }> = [
  { label: 'Sourcés', of: (s) => s.stats_total_found },
  { label: 'Retenus au total', of: (s) => s.stats_shortlisted },
  { label: 'Contactés au total', of: (s) => s.stats_messaged },
];

const CountCell = ({ value }: { value: number }) => (
  <span className={value > 0 ? 'tabular-nums text-foreground' : 'tabular-nums text-muted-foreground'}>
    {value.toLocaleString('fr-FR')}
  </span>
);

// ── Ligne de recherche ──

const SearchRow = ({
  search,
  onOpen,
  onDelete,
}: {
  search: SourcingProject;
  onOpen: () => void;
  onDelete: () => void;
}) => {
  const launched = search.stats_total_found > 0;

  return (
    <tr
      data-testid="search-row"
      onClick={onOpen}
      className="group h-[60px] cursor-pointer border-b border-border/50 transition-colors duration-150 hover:bg-muted/40"
    >
      <td className="min-w-0 py-2 pl-3 pr-3 sm:pl-2">
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onOpen(); }}
          className="block min-w-0 max-w-full truncate rounded-sm text-left text-sm font-medium text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          title={search.name}
        >
          {search.name}
        </button>
        <p className="mt-0.5 truncate text-xs text-muted-foreground">
          {launched ? plural(search.stats_total_found, 'profil sourcé', 'profils sourcés') : 'Aucune recherche lancée'}
        </p>
      </td>
      {COUNT_COLUMNS.map(({ label, of }) => (
        <td key={label} className="hidden py-2 pr-3 text-right text-sm md:table-cell">
          <CountCell value={of(search)} />
        </td>
      ))}
      <td className="hidden py-2 pr-3 text-right text-xs tabular-nums text-muted-foreground lg:table-cell">
        {timeAgo(search.updated_at) ?? ''}
      </td>
      <td className="py-2 pr-2 text-right">
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={(e) => e.stopPropagation()}
              aria-label={`Actions pour ${search.name}`}
              title="Plus d'actions"
            >
              <MoreHorizontal aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-44">
            <DropdownMenuItem onClick={onDelete} className="text-danger focus:text-danger">
              <Trash2 className="mr-2 h-3.5 w-3.5" aria-hidden="true" /> Supprimer
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </td>
    </tr>
  );
};

const LoadingRows = () => (
  <div aria-busy="true" aria-label="Chargement des recherches">
    {[0, 1, 2, 3].map((i) => (
      <div key={i} className="flex h-[60px] items-center gap-4 border-b border-border/50 px-2">
        <div className="min-w-0 flex-1">
          <Skeleton className="h-4 w-56 max-w-full" />
          <Skeleton className="mt-1.5 h-3 w-32 max-w-full" />
        </div>
        <Skeleton className="hidden h-4 w-40 md:block" />
      </div>
    ))}
  </div>
);

// ── Page ──

export default function SourcingSearches() {
  const navigate = useNavigate();
  const { projects: searches, isLoading, createProject, deleteProject, isCreating, isDeleting } = useSourcingProjects('search');
  const [query, setQuery] = useState('');
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

  // Plus récente d'abord, sur la dernière modification.
  const sorted = useMemo(() => {
    const time = (s: SourcingProject) => {
      const t = new Date(s.updated_at).getTime();
      return Number.isNaN(t) ? 0 : t;
    };
    return [...searches].sort((a, b) => time(b) - time(a));
  }, [searches]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return q ? sorted.filter((s) => s.name.toLowerCase().includes(q)) : sorted;
  }, [sorted, query]);

  const createButton = (
    <Button variant="primary" onClick={handleCreate} disabled={isCreating}>
      <Plus aria-hidden="true" />
      Nouvelle recherche
    </Button>
  );

  return (
    <div className="w-full max-w-full bg-background">
      <SEOHead
        title="Recherche | Konekt"
        description="Sourcez des candidats librement, sans créer de mission"
      />

      <div className="py-6 w-full max-w-full">
        <div className="max-w-[1600px] mx-auto w-full min-w-0 px-3 sm:px-6 lg:px-8">
          <div className="mx-auto w-full max-w-[1200px]">
            <PageHeader
              title="Recherche"
              subtitle={
                !isLoading && searches.length > 0
                  ? `${plural(searches.length, 'recherche')} hors mission. Transformez-en une en mission quand elle devient sérieuse.`
                  : 'Sourcez des candidats librement, puis transformez la recherche en mission quand elle devient sérieuse.'
              }
              actions={searches.length > 0 || isLoading ? createButton : undefined}
            />

            {isLoading ? (
              <LoadingRows />
            ) : searches.length === 0 ? (
              <EmptyState
                icon={Search}
                headingLevel={2}
                title="Aucune recherche pour l'instant"
                description="Lancez une recherche LinkedIn sans créer de mission : filtres, scoring IA et shortlist fonctionnent pareil."
                action={
                  <Button variant="primary" onClick={handleCreate} disabled={isCreating}>
                    <Plus aria-hidden="true" />
                    Démarrer une recherche
                  </Button>
                }
              />
            ) : (
              <>
                <div className="relative mb-6 max-w-md">
                  <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                  <Input
                    placeholder="Rechercher une recherche"
                    aria-label="Rechercher parmi les recherches"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    className="pl-9"
                  />
                </div>

                {filtered.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
                    <p className="text-sm text-foreground">Aucune recherche trouvée.</p>
                    <p className="mt-1 text-xs text-muted-foreground">Essayez avec d'autres mots-clés ou effacez le champ.</p>
                  </div>
                ) : (
                  <div className="-mx-3 overflow-x-auto sm:mx-0">
                    <table className="w-full table-fixed border-collapse text-sm">
                      <caption className="sr-only">Recherches hors mission</caption>
                      <colgroup>
                        <col />
                        {COUNT_COLUMNS.map(({ label }) => <col key={label} className="hidden w-32 md:table-column" />)}
                        <col className="hidden w-24 lg:table-column" />
                        <col className="w-12" />
                      </colgroup>
                      <thead>
                        <tr className="h-[34px] border-b border-border text-left text-xs text-muted-foreground">
                          <th scope="col" className="pl-3 pr-3 font-normal sm:pl-2">Recherche</th>
                          {COUNT_COLUMNS.map(({ label }) => (
                            <th key={label} scope="col" className="hidden pr-3 text-right font-normal md:table-cell">{label}</th>
                          ))}
                          <th scope="col" className="hidden pr-3 text-right font-normal lg:table-cell">Activité</th>
                          <th scope="col" className="pr-2 text-right font-normal"><span className="sr-only">Actions</span></th>
                        </tr>
                      </thead>
                      <tbody>
                        {filtered.map((search) => (
                          <SearchRow
                            key={search.id}
                            search={search}
                            onOpen={() => navigate(`/sourcing/${search.id}`)}
                            onDelete={() => setToDelete(search)}
                          />
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}
          </div>
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

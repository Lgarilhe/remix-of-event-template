/**
 * Recherche hors mission (/sourcing) : un seul écran, « Qui cherchez-vous ? ».
 *
 * Même prompt que le Sourcing d'une mission (SearchHero, disposition
 * mission-v3), puis « Reprendre une recherche » pour les recherches déjà
 * commencées. L’envoi ouvre le chat de cadrage ; la recherche est créée
 * seulement après validation, puis /sourcing/:id lance les filtres validés.
 * Le chemin manuel ouvre directement les filtres, sans appel à l’IA.
 */

import { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Trash2 } from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { useSourcingProjects, SourcingProject } from '@/hooks/useSourcingProjects';
import { plural } from '@/lib/plural';
import { timeAgo } from '@/lib/relativeTime';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { PageBackdrop } from '@/components/layout/PageBackdrop';
import { SearchHero } from '@/components/outreach/search/SourcingFlow';
import { useFilteredLinkedInAccounts } from '@/hooks/useFilteredLinkedInAccounts';
import { SourcingInterviewDialog } from '@/components/outreach/search/SourcingInterviewDialog';
import type { SourcingSource } from '@/components/outreach/search/SourcingSourcePicker';
import type { JobDetails } from '@/types/jobDetails';
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

const VISIBLE_SEARCHES = 5;

// Nom d'une recherche créée sans phrase : « Recherche du 6 juillet, 14h32 ».
// L'utilisateur le remplace par un intitulé dans la barre de la recherche.
const buildSearchName = () => {
  const now = new Date();
  const date = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long' }).format(now);
  const time = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(now).replace(':', 'h');
  return `Recherche du ${date}, ${time}`;
};

export default function SourcingSearches() {
  const navigate = useNavigate();
  const reduceMotion = useReducedMotion();
  const { projects: searches, isLoading, createProject, deleteProject, isDeleting } = useSourcingProjects('search');
  const { accounts, accountsLoading } = useFilteredLinkedInAccounts();
  const [interview, setInterview] = useState<{ phrase: string } | null>(null);
  const [launching, setLaunching] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [toDelete, setToDelete] = useState<SourcingProject | null>(null);
  const launchingRef = useRef(false);
  const confirm = async (brief: JobDetails, source: SourcingSource) => {
    const created = await createProject({
      name: brief.title!.trim(), kind: 'search', job_details: brief, description: brief.raw_brief, silent: true,
    });
    navigate(`/sourcing/${created.id}`, { state: { phrase: 'Chercher selon le cadrage et les critères validés.', source } });
    setInterview(null);
  };

  // Chemin direct : une recherche vide, avec la fenêtre des filtres ouverte.
  const launchWithFilters = async () => {
    if (launchingRef.current) return;
    launchingRef.current = true; setLaunching(true);
    try {
      const created = await createProject({ name: buildSearchName(), kind: 'search' });
      await new Promise((r) => setTimeout(r, reduceMotion ? 0 : 260));
      navigate(`/sourcing/${created.id}`, { state: { filters: true } });
    } catch {
      // toast d'erreur déjà géré par le hook
      launchingRef.current = false; setLaunching(false);
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

  const sorted = [...searches].sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime());
  const shown = showAll ? sorted : sorted.slice(0, VISIBLE_SEARCHES);

  return (
    <div className="konekt-on-backdrop relative flex w-full min-h-[calc(100vh-64px)] flex-col items-center bg-background px-4 pb-12 pt-10 sm:pt-20">
      <SEOHead
        title="Recherche | Konekt"
        description="Sourcez des candidats librement, sans créer de mission"
      />

      <PageBackdrop follow />

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={launching && !reduceMotion ? { opacity: 0, y: -10, scale: 0.98 } : { opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: launching ? 0.25 : 0.35, ease: 'easeOut' }}
        className="relative flex w-full flex-col items-center"
      >
        <SearchHero variant="mission-v3" guided headingLevel={1} jobTitle="" history={[]} onResumeHistory={() => {}}
          className="min-h-0 px-0 pt-0 sm:pt-0 pb-0"
          onLaunch={phrase => setInterview({ phrase })} onConfigureFilters={() => void launchWithFilters()}
          disabled={launching || accountsLoading || !!interview} />

        {isLoading ? (
          <div className="mt-8 w-full max-w-[640px] space-y-1.5" aria-busy="true" aria-label="Chargement des recherches">
            <Skeleton className="h-9 w-full" />
            <Skeleton className="h-9 w-full" />
          </div>
        ) : (
          sorted.length > 0 && (
            <section className="mt-8 w-full max-w-[640px]" aria-labelledby="reprendre-recherche">
              <h2 id="reprendre-recherche" className="mb-1 text-sm font-medium text-[var(--k-text-2)]">
                Reprendre une recherche
              </h2>
              {shown.map((search) => (
                <div
                  key={search.id}
                  className="group flex items-center border-t border-[var(--k-hairline)] first:border-t-0"
                >
                  <button
                    type="button"
                    disabled={launching}
                    onClick={() => navigate(`/sourcing/${search.id}`)}
                    className="flex min-w-0 flex-1 items-center gap-2.5 px-1 py-2.5 text-left transition-colors hover:bg-[var(--k-surface)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-11"
                    aria-label={`Reprendre la recherche ${search.name}`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-3.5 w-3.5 shrink-0 text-[var(--k-text)]" aria-hidden="true">
                      <circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 1.5" />
                    </svg>
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--k-text)]">{search.name}</span>
                    <span className="hidden shrink-0 text-sm text-[var(--k-text-muted)] sm:inline">
                      {timeAgo(search.updated_at) ?? ''}
                    </span>
                    {search.stats_total_found > 0 && (
                      <span className="shrink-0 text-sm text-[var(--k-text-muted)]">
                        {plural(search.stats_total_found, 'profil')}
                      </span>
                    )}
                  </button>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="shrink-0 text-muted-foreground opacity-0 transition-opacity hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 max-sm:opacity-100"
                    onClick={() => setToDelete(search)}
                    aria-label={`Supprimer la recherche ${search.name}`}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                </div>
              ))}
              {sorted.length > VISIBLE_SEARCHES && (
                <button
                  type="button"
                  onClick={() => setShowAll((s) => !s)}
                  className="mt-1 text-sm text-[var(--k-text)] underline underline-offset-4 hover:decoration-[var(--k-text)]"
                >
                  {showAll ? 'Voir moins' : `Voir les ${sorted.length - VISIBLE_SEARCHES} autres`}
                </button>
              )}
            </section>
          )
        )}
      </motion.div>

      {interview && <SourcingInterviewDialog initialBrief={{}} initialMessage={interview.phrase}
        initialSource={accounts.length ? 'linkedin' : 'database'} linkedinAvailable={accounts.length > 0}
        onClose={() => setInterview(null)} onConfirm={confirm} />}

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

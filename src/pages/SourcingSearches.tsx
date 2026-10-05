/**
 * Recherche hors mission (/sourcing) : un seul écran, « Qui cherchez-vous ? ».
 *
 * Même prompt que le Sourcing d'une mission (SearchHero, disposition
 * mission-v3), puis « Reprendre une recherche » pour les recherches déjà
 * commencées. À l'envoi : la recherche est créée avec la phrase comme nom et
 * comme intitulé (le scoring IA s'en sert), puis /sourcing/:id la lance tout de
 * suite (écran de plan, puis résultats). Rien n'est créé tant qu'on n'a pas
 * lancé : ouvrir la page ne laisse aucune recherche vide derrière soi.
 */

import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion, useReducedMotion } from 'framer-motion';
import { Loader2, Trash2 } from 'lucide-react';
import { SEOHead } from '@/components/SEOHead';
import { cn } from '@/lib/utils';
import { useSourcingProjects, SourcingProject } from '@/hooks/useSourcingProjects';
import { plural } from '@/lib/plural';
import { timeAgo } from '@/lib/relativeTime';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { AiBurst } from '@/components/outreach/search/SourcingFlow';
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

const EXAMPLES = [
  "Account Manager SaaS B2B, 8-12 ans, grands comptes, Île-de-France, pas d'ESN",
  'Head of Sales fintech série B, Paris, a scalé une équipe',
];

const VISIBLE_SEARCHES = 5;

/** Intitulé tiré de la phrase : sa première proposition, 80 caractères au plus. */
const titleFromPhrase = (phrase: string) => {
  const clause = phrase.split(/[,.\n]/)[0]?.trim() || phrase.trim();
  return clause.slice(0, 80);
};

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
  const [value, setValue] = useState('');
  const [focused, setFocused] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [showAll, setShowAll] = useState(false);
  const [toDelete, setToDelete] = useState<SourcingProject | null>(null);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const armed = value.trim().length > 0;

  // « / » met le curseur dans le prompt, comme dans le Sourcing d'une mission.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/' || document.activeElement === taRef.current) return;
      if (/INPUT|TEXTAREA/.test((document.activeElement as HTMLElement)?.tagName || '')) return;
      e.preventDefault();
      taRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  const launch = async () => {
    const phrase = value.trim();
    if (!phrase || launching) return;
    setLaunching(true);
    try {
      const title = titleFromPhrase(phrase);
      const created = await createProject({ name: title, kind: 'search', job_details: { title } });
      // Le temps de l'animation de sortie, au minimum.
      await new Promise((r) => setTimeout(r, reduceMotion ? 0 : 260));
      navigate(`/sourcing/${created.id}`, { state: { phrase } });
    } catch {
      // toast d'erreur déjà géré par le hook
      setLaunching(false);
    }
  };

  // Chemin direct : une recherche vide, avec la fenêtre des filtres ouverte.
  const launchWithFilters = async () => {
    if (launching) return;
    setLaunching(true);
    try {
      const created = await createProject({ name: buildSearchName(), kind: 'search' });
      await new Promise((r) => setTimeout(r, reduceMotion ? 0 : 260));
      navigate(`/sourcing/${created.id}`, { state: { filters: true } });
    } catch {
      // toast d'erreur déjà géré par le hook
      setLaunching(false);
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
    <div className="relative flex w-full min-h-[calc(100vh-64px)] flex-col items-center bg-background px-4 pb-12 pt-10 sm:pt-20">
      <SEOHead
        title="Recherche | Konekt"
        description="Sourcez des candidats librement, sans créer de mission"
      />

      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-0 left-1/2 h-[300px] w-[560px] max-w-full -translate-x-1/2 opacity-50"
        style={{ background: 'radial-gradient(ellipse at center, var(--k-accent-tint), transparent 70%)' }}
      />

      <motion.div
        initial={reduceMotion ? false : { opacity: 0, y: 12 }}
        animate={launching && !reduceMotion ? { opacity: 0, y: -10, scale: 0.98 } : { opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: launching ? 0.25 : 0.35, ease: 'easeOut' }}
        className="relative flex w-full flex-col items-center"
      >
        <h1 className="mb-4 text-xl font-semibold tracking-[-.015em] text-[var(--k-text)]">Qui cherchez-vous ?</h1>

        <div
          className={cn(
            'relative w-full max-w-[640px] rounded-xl border bg-[var(--k-surface)] px-4 py-3.5 transition-[border-color,box-shadow] duration-150',
            focused ? 'border-[var(--k-hairline-focus)] shadow-[0_1px_3px_rgba(0,0,0,0.2)]' : 'border-[var(--k-hairline)]',
          )}
        >
          <div className="flex items-start gap-2.5">
            <motion.span
              aria-hidden="true"
              className="mt-1 shrink-0"
              animate={launching && !reduceMotion ? { rotate: 180, scale: 1.15 } : { rotate: 0, scale: 1 }}
              transition={{ duration: 0.4, ease: 'easeInOut' }}
            >
              <AiBurst
                className={cn(
                  'h-[17px] w-[17px] transition-colors duration-150',
                  focused || armed ? 'text-[var(--k-accent)]' : 'text-[var(--k-text-placeholder)]',
                )}
              />
            </motion.span>
            <textarea
              ref={taRef}
              value={value}
              rows={2}
              autoFocus
              disabled={launching}
              onChange={(e) => setValue(e.target.value)}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  void launch();
                }
              }}
              aria-label="Décrivez le profil recherché"
              placeholder="Décrivez le profil idéal : rôle, séniorité, contexte, lieu. L'IA le traduit en filtres que vous pourrez modifier."
              className="min-h-[52px] min-w-0 flex-1 resize-none border-0 bg-transparent p-0 text-base leading-relaxed text-[var(--k-text)] placeholder:text-muted-foreground focus:outline-none max-sm:min-h-[108px]"
            />
          </div>
          <div className="mt-1.5 flex items-center gap-2.5">
            <span className="hidden items-center gap-1.5 text-sm text-[var(--k-text-muted)] sm:inline-flex">
              Entrée pour lancer
            </span>
            <Button
              type="button"
              size="sm"
              variant={armed ? 'primary' : 'ghost'}
              disabled={!armed || launching}
              onClick={() => void launch()}
              className="ml-auto max-sm:min-h-11"
            >
              {launching ? (
                <Loader2 className="animate-spin" aria-hidden="true" />
              ) : (
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} className="h-3.5 w-3.5" aria-hidden="true">
                  <path d="M4 12h15M13 6l6 6-6 6" />
                </svg>
              )}
              Générer les filtres et chercher
            </Button>
          </div>
        </div>

        <div className="mt-4 flex max-w-[660px] flex-wrap justify-center gap-x-4 gap-y-0.5">
          <span className="mb-0.5 w-full text-center text-sm text-[var(--k-text-muted)]">
            Exemples : rôle, séniorité, contexte, lieu
          </span>
          {EXAMPLES.map((ex) => (
            <button
              key={ex}
              type="button"
              disabled={launching}
              onClick={() => { setValue(ex); taRef.current?.focus(); }}
              className="rounded-sm px-1 py-1.5 text-sm text-[var(--k-text-2)] underline decoration-[var(--k-hairline-focus)] underline-offset-4 transition-colors hover:text-[var(--k-text)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring max-sm:min-h-11"
            >
              {ex}
            </button>
          ))}
        </div>

        <p className="mt-6 text-center text-sm text-[var(--k-text-muted)]">
          ou{' '}
          <button
            type="button"
            disabled={launching}
            onClick={() => void launchWithFilters()}
            className="font-medium text-[var(--k-text-2)] underline decoration-[var(--k-hairline-focus)] underline-offset-4 hover:text-[var(--k-text)] disabled:opacity-60 max-sm:inline-block max-sm:py-3"
          >
            configurer les filtres manuellement
          </button>
          , sans passer par le prompt
        </p>

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
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} className="h-3.5 w-3.5 shrink-0 text-[var(--k-text-muted)]" aria-hidden="true">
                      <circle cx="12" cy="12" r="8" /><path d="M12 8v4l2.5 1.5" />
                    </svg>
                    <span className="min-w-0 flex-1 truncate text-sm text-[var(--k-text-2)]">{search.name}</span>
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
                  className="mt-1 text-sm text-[var(--k-text-muted)] underline underline-offset-4 hover:text-[var(--k-text-2)]"
                >
                  {showAll ? 'Voir moins' : `Voir les ${sorted.length - VISIBLE_SEARCHES} autres`}
                </button>
              )}
            </section>
          )
        )}
      </motion.div>

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

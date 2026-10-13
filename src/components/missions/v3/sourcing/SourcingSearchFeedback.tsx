import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { animate, motion, useReducedMotion } from 'framer-motion';
import { Check, Search } from 'lucide-react';
import { plural } from '@/lib/plural';

interface Props {
  loading: boolean;
  loadingMore: boolean;
  loadedCount: number;
  total: number | null;
  hasSearched: boolean;
  searchScopeKey?: string;
  searchSuccessKey?: number;
  children?: ReactNode;
}

/** Only newly accepted searches animate. Restored results already have their final values. */
export function SourcingSearchFeedback({
  loading, loadingMore, loadedCount, total, hasSearched, searchScopeKey,
  searchSuccessKey = 0, children,
}: Props) {
  const reducedMotion = useReducedMotion();
  const motionEnabled = reducedMotion === false;
  const observed = useRef({ scope: searchScopeKey, success: searchSuccessKey, searching: loading });
  const animated = useRef({ scope: searchScopeKey, success: 0 });
  const paged = useRef({ scope: searchScopeKey, success: 0 });
  const [notUpdated, setNotUpdated] = useState(false);
  const loadedRef = useRef<HTMLSpanElement>(null);
  const announcedRef = useRef<HTMLSpanElement>(null);

  useLayoutEffect(() => {
    const previous = observed.current;
    if (previous.scope !== searchScopeKey) {
      observed.current = { scope: searchScopeKey, success: searchSuccessKey, searching: loading };
      setNotUpdated(false);
      return;
    }
    if (loading) {
      if (!previous.searching) previous.success = searchSuccessKey;
      previous.searching = true;
      setNotUpdated(false);
      return;
    }
    if (previous.searching) {
      previous.searching = false;
      setNotUpdated(searchSuccessKey === previous.success);
    }
    previous.success = searchSuccessKey;
  }, [loading, searchScopeKey, searchSuccessKey]);

  useLayoutEffect(() => {
    if (paged.current.scope !== searchScopeKey) paged.current = { scope: searchScopeKey, success: 0 };
    if (loadingMore) paged.current.success = searchSuccessKey;
  }, [loadingMore, searchScopeKey, searchSuccessKey]);

  const wasPaged = paged.current.scope === searchScopeKey && paged.current.success === searchSuccessKey;
  const updated = searchSuccessKey > 0 && !wasPaged && !notUpdated && !loading && !loadingMore;
  const hasCounters = hasSearched || loadedCount > 0 || searchSuccessKey > 0;
  const summary = `${plural(loadedCount, 'profil chargé', 'profils chargés')}${total === null
    ? '. Total non communiqué.'
    : ` sur ${plural(total, 'résultat annoncé', 'résultats annoncés')}.`}`;

  useLayoutEffect(() => {
    const loaded = loadedRef.current;
    const announced = announcedRef.current;
    const previous = animated.current;
    if (previous.scope !== searchScopeKey) animated.current = { scope: searchScopeKey, success: 0 };
    const freshSuccess = updated && animated.current.success !== searchSuccessKey;
    if (freshSuccess) animated.current.success = searchSuccessKey;
    if (!freshSuccess || !motionEnabled || loading) {
      if (loaded) loaded.textContent = loadedCount.toLocaleString('fr-FR');
      if (announced && total !== null) announced.textContent = total.toLocaleString('fr-FR');
      return;
    }
    // Paint final, truthful values for assistive technology; only the hidden visual digits count up.
    if (loaded) loaded.textContent = '0';
    if (announced && total !== null) announced.textContent = '0';
    const controls = animate(0, 1, {
      duration: 0.5,
      ease: 'easeOut',
      onUpdate: (progress) => {
        if (loaded) loaded.textContent = Math.round(progress * loadedCount).toLocaleString('fr-FR');
        if (announced && total !== null) announced.textContent = Math.round(progress * total).toLocaleString('fr-FR');
      },
    });
    return () => controls.stop();
  }, [searchSuccessKey, searchScopeKey, updated, motionEnabled, loading, loadedCount, total]);

  const state = loading ? 'searching' : loadingMore ? 'more' : notUpdated ? 'unchanged' : updated ? 'updated' : 'idle';
  const announcement = loading
    ? `Recherche en cours.${loadedCount > 0 ? ' Résultats précédents affichés pendant la recherche.' : ''}`
    : loadingMore ? 'Chargement de la suite.'
      : `${notUpdated ? 'Recherche non actualisée. ' : updated ? 'Résultats mis à jour. ' : ''}${hasCounters ? summary : ''}`;

  return (
    <div data-testid="sourcing-search-feedback" data-state={state} className="mb-3 shrink-0 space-y-2">
      <p role="status" aria-label="État de la recherche" aria-live="polite" aria-atomic="true" className="sr-only">
        {announcement}
      </p>
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm">
        {loading ? (
          <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1">
            <Search className="h-4 w-4 shrink-0 text-foreground" aria-hidden="true" />
            <span className="font-semibold text-foreground">Recherche en cours</span>
            {loadedCount > 0 && <span className="text-muted-foreground">Résultats précédents affichés pendant la recherche.</span>}
          </span>
        ) : (
          <span className="contents">
            {(updated || notUpdated) && (
              <span className="inline-flex flex-wrap items-center gap-x-1.5 gap-y-1">
                {updated && <Check className="h-4 w-4 text-foreground" aria-hidden="true" />}
                <span className="font-semibold text-foreground">{notUpdated ? 'Recherche non actualisée' : 'Résultats mis à jour'}</span>
                {notUpdated && loadedCount > 0 && <span className="text-muted-foreground">Résultats précédents conservés.</span>}
              </span>
            )}
            {hasCounters && <span data-testid="sourcing-search-summary" className="sr-only">{summary}</span>}
            {hasCounters && <span aria-hidden="true" className="text-muted-foreground">
              <span ref={loadedRef} className="font-semibold tabular-nums text-foreground">{loadedCount.toLocaleString('fr-FR')}</span>
              {loadedCount > 1 ? ' profils chargés' : ' profil chargé'}
              {total === null ? '. Total non communiqué.' : (
                <>
                  {' sur '}
                  <span ref={announcedRef} data-testid="sourcing-announced-count" className="font-semibold tabular-nums text-foreground">{total.toLocaleString('fr-FR')}</span>
                  {total > 1 ? ' résultats annoncés.' : ' résultat annoncé.'}
                </>
              )}
            </span>}
          </span>
        )}
        <div className="contents">{children}</div>
      </div>
      {loading && (
        <div data-testid="sourcing-search-motion" aria-hidden="true" className="relative h-1.5 overflow-hidden rounded-full bg-muted">
          {!motionEnabled ? (
            <span className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-foreground" />
          ) : (
            <motion.span
              className="absolute inset-y-0 left-0 w-1/3 rounded-full bg-foreground"
              initial={{ x: '-100%' }}
              animate={{ x: '400%' }}
              transition={{ duration: 1.1, repeat: Infinity, ease: 'easeInOut' }}
            />
          )}
        </div>
      )}
    </div>
  );
}

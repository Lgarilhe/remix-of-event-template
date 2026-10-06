import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Search, Check } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * Démonstration produit de l'accueil : une recherche, le score d'un profil et
 * son ajout à une séquence, dans la fenêtre de l'application.
 *
 * Jouée une seule fois, en moins de cinq secondes, quand la fenêtre entre à
 * l'écran, puis figée sur l'état final (WCAG 2.2.2 : aucun mouvement
 * automatique de plus de cinq secondes). Avec le mouvement réduit, l'état final
 * s'affiche d'emblée. Couleurs et tailles viennent des jetons du thème.
 * Décorative : lue comme une image par les lecteurs d'écran.
 */

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
const RING_R = 18;
const CIRC = 2 * Math.PI * RING_R;
const SCORE = 92;
const QUERY = 'Product Designer Senior · Paris';

const OTHER_ROWS = [
  { ini: 'NB', name: 'Noah Bertrand', role: 'Product Designer · Lyon · 6 ans', chips: ['Figma', 'Prototypage'], badge: 86 },
  { ini: 'LM', name: 'Léa Mercier', role: 'UX Designer Senior · Télétravail · 9 ans', chips: ['Recherche', 'Design ops'], badge: 81 },
  { ini: 'TN', name: 'Théo Nguyen', role: 'Product Designer · Nantes · 5 ans', chips: ['Design system', 'Motion'], badge: 78 },
];

interface DemoState {
  typed: string;
  searchFocus: boolean;
  rowsIn: boolean;
  scoreOn: boolean;
  pillOn: boolean;
  cursorOn: boolean;
  cursorClick: boolean;
  added: boolean;
  toastOn: boolean;
}

const FINAL_STATE: DemoState = {
  typed: QUERY,
  searchFocus: false,
  rowsIn: true,
  scoreOn: true,
  pillOn: true,
  cursorOn: false,
  cursorClick: false,
  added: true,
  toastOn: false,
};

const INITIAL_STATE: DemoState = {
  typed: '',
  searchFocus: false,
  rowsIn: false,
  scoreOn: false,
  pillOn: false,
  cursorOn: false,
  cursorClick: false,
  added: false,
  toastOn: false,
};

export const LandingProductDemo = () => {
  const reduceMotion = useReducedMotion();
  const [s, setS] = useState<DemoState>(reduceMotion ? FINAL_STATE : INITIAL_STATE);
  const [displayScore, setDisplayScore] = useState(reduceMotion ? SCORE : 0);
  const rootRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLSpanElement>(null);
  const [cursorPos, setCursorPos] = useState({ x: 320, y: -20 });

  const patch = useCallback((p: Partial<DemoState>) => setS((prev) => ({ ...prev, ...p })), []);

  // Compte du score, synchronisé sur le tracé de l'anneau (700 ms).
  const runScoreCount = useCallback(() => {
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min((now - start) / 700, 1);
      const e = 1 - Math.pow(1 - p, 3);
      setDisplayScore(Math.round(e * SCORE));
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }, []);

  const moveCursorToAdd = useCallback(() => {
    const list = listRef.current;
    const add = addRef.current;
    if (!list || !add) return;
    const lr = list.getBoundingClientRect();
    const ar = add.getBoundingClientRect();
    setCursorPos({ x: ar.left - lr.left + ar.width / 2 - 4, y: ar.top - lr.top + ar.height / 2 - 2 });
  }, []);

  useEffect(() => {
    if (reduceMotion) {
      setS(FINAL_STATE);
      setDisplayScore(SCORE);
      return;
    }
    const root = rootRef.current;
    if (!root || typeof IntersectionObserver === 'undefined') {
      setS(FINAL_STATE);
      setDisplayScore(SCORE);
      return;
    }

    const timers: number[] = [];
    const at = (ms: number, fn: () => void) => {
      timers.push(window.setTimeout(fn, ms));
    };

    // Une seule lecture, déclenchée quand la moitié de la fenêtre est visible.
    const play = () => {
      at(150, () => patch({ searchFocus: true }));
      for (let i = 1; i <= QUERY.length; i++) {
        at(200 + i * 28, () => patch({ typed: QUERY.slice(0, i) }));
      }
      at(1200, () => patch({ rowsIn: true, searchFocus: false }));
      at(1650, () => {
        patch({ scoreOn: true });
        runScoreCount();
      });
      at(2400, () => patch({ pillOn: true }));
      at(2550, () => {
        moveCursorToAdd();
        patch({ cursorOn: true });
      });
      at(3300, () => patch({ cursorClick: true }));
      at(3450, () => patch({ cursorClick: false, added: true }));
      at(3650, () => patch({ toastOn: true }));
      at(4550, () => setS(FINAL_STATE));
    };

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          observer.disconnect();
          play();
        }
      },
      { threshold: 0.5 },
    );
    observer.observe(root);

    return () => {
      observer.disconnect();
      timers.forEach(clearTimeout);
    };
  }, [reduceMotion, patch, runScoreCount, moveCursorToAdd]);

  return (
    <div
      ref={rootRef}
      role="img"
      aria-label="Aperçu de Konekt : une recherche de profils, le score d'un candidat et son ajout à une séquence"
      className="relative isolate overflow-hidden rounded-xl border border-border bg-card text-left text-foreground"
    >
      <div aria-hidden="true">
        {/* Barre de fenêtre */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-2.5">
          <div className="flex shrink-0 gap-1.5">
            {[0, 1, 2].map((i) => (
              <span key={i} className="h-2.5 w-2.5 rounded-full bg-muted" />
            ))}
          </div>
          <span className="min-w-0 flex-1 truncate text-center text-2xs text-muted-foreground">
            Mission · Product Designer Senior
          </span>
          <span className="w-10 shrink-0" />
        </div>

        {/* Onglets de la mission */}
        <div className="flex items-center gap-0.5 border-b border-border px-3">
          {['Aperçu', 'Brief', 'Sourcing', 'Pipeline'].map((tab) => (
            <span
              key={tab}
              className={cn('relative px-2.5 py-2.5 text-sm sm:px-3', tab === 'Sourcing' ? 'text-foreground' : 'text-muted-foreground')}
            >
              {tab}
              {tab === 'Sourcing' && <span className="absolute inset-x-2.5 -bottom-px h-0.5 rounded-full bg-foreground" />}
            </span>
          ))}
          <span className="flex-1" />
          <span className="hidden pr-1.5 text-2xs text-muted-foreground sm:inline">
            Entretiens <span className="ml-1 tabular-nums text-foreground">{s.added ? 5 : 4}</span>
          </span>
        </div>

        {/* Barre de recherche */}
        <div className="flex gap-2.5 px-3.5 pb-1 pt-3.5">
          <div
            className={cn(
              'flex h-9 min-w-0 flex-1 items-center gap-2 rounded-lg border bg-background px-3 transition-[border-color,box-shadow] duration-200',
              s.searchFocus ? 'border-ring ring-[3px] ring-ring/20' : 'border-input',
            )}
          >
            <Search className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
            <span className="truncate whitespace-nowrap text-sm">{s.typed}</span>
            {s.typed.length > 0 && s.typed.length < QUERY.length && <span className="h-3.5 w-px shrink-0 bg-foreground" />}
          </div>
          <span className="hidden items-center rounded-lg bg-primary px-3.5 text-xs font-semibold text-primary-foreground sm:inline-flex">
            Scorer les profils
          </span>
        </div>

        {/* Résultats */}
        <div ref={listRef} className="relative flex min-h-[240px] flex-col gap-2 px-3.5 pb-4 pt-2.5">
          {/* Ligne principale */}
          <motion.div
            initial={false}
            animate={s.rowsIn ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
            transition={{ duration: 0.4, ease: EASE_OUT }}
            className={cn(
              'grid grid-cols-[36px_1fr_auto] items-center gap-3 rounded-xl border bg-card p-3 transition-colors duration-300',
              s.added ? 'border-border-strong' : 'border-border',
            )}
          >
            <span className="grid h-9 w-9 place-items-center rounded-full border border-border bg-muted text-xs font-semibold text-foreground-secondary">
              CR
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold leading-tight">Camille Roy</p>
              <p className="truncate text-2xs text-muted-foreground">Product Designer Senior · Paris · 8 ans</p>
              <div className="mt-1.5 hidden gap-1 sm:flex">
                {['Figma', 'Design system', 'SaaS B2B'].map((c) => (
                  <span key={c} className="rounded-full border border-border px-2 py-px text-3xs text-muted-foreground">
                    {c}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2.5">
              <motion.span
                initial={false}
                animate={s.pillOn ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.85 }}
                transition={{ duration: 0.3, ease: EASE_OUT }}
                className="hidden items-center gap-1 whitespace-nowrap rounded-md border border-border bg-muted px-2 py-0.5 text-3xs font-semibold sm:inline-flex"
              >
                <Check className="h-3 w-3 text-success" /> À contacter
              </motion.span>
              <span className="relative h-11 w-11 shrink-0">
                <svg width="44" height="44" viewBox="0 0 44 44" className="-rotate-90">
                  <circle cx="22" cy="22" r={RING_R} fill="none" strokeWidth="4.5" className="stroke-muted" />
                  <motion.circle
                    cx="22"
                    cy="22"
                    r={RING_R}
                    fill="none"
                    strokeWidth="4.5"
                    strokeLinecap="round"
                    className="stroke-brand"
                    strokeDasharray={CIRC}
                    initial={false}
                    animate={{ strokeDashoffset: s.scoreOn ? CIRC * (1 - SCORE / 100) : CIRC }}
                    transition={{ duration: 0.7, ease: EASE_OUT }}
                  />
                </svg>
                <span className="absolute inset-0 grid place-items-center text-xs font-semibold tabular-nums">{displayScore}</span>
              </span>
              <span
                ref={addRef}
                className={cn(
                  'inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-xs font-semibold transition-[background-color,color,border-color,transform] duration-300 sm:px-3',
                  s.added ? 'border-transparent bg-primary text-primary-foreground' : 'border-border bg-transparent text-foreground',
                  s.cursorClick ? 'scale-95' : 'scale-100',
                )}
              >
                {s.added ? (
                  <>
                    <Check className="h-3 w-3" /> Ajoutée
                  </>
                ) : (
                  <>
                    <span className="sm:hidden">Ajouter</span>
                    <span className="hidden sm:inline">Ajouter à la séquence</span>
                  </>
                )}
              </span>
            </div>
          </motion.div>

          {/* Autres candidats */}
          {OTHER_ROWS.map((row, i) => (
            <motion.div
              key={row.ini}
              initial={false}
              animate={s.rowsIn ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
              transition={{ duration: 0.4, ease: EASE_OUT, delay: s.rowsIn ? (i + 1) * 0.06 : 0 }}
              className="grid grid-cols-[36px_1fr_auto] items-center gap-3 rounded-xl border border-border bg-card p-3"
            >
              <span className="grid h-9 w-9 place-items-center rounded-full border border-border bg-muted text-xs font-semibold text-foreground-secondary">
                {row.ini}
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold leading-tight">{row.name}</p>
                <p className="truncate text-2xs text-muted-foreground">{row.role}</p>
                <div className="mt-1.5 hidden gap-1 sm:flex">
                  {row.chips.map((c) => (
                    <span key={c} className="rounded-full border border-border px-2 py-px text-3xs text-muted-foreground">
                      {c}
                    </span>
                  ))}
                </div>
              </div>
              <span className="rounded-md border border-border px-2 py-1 text-2xs tabular-nums text-muted-foreground">{row.badge}</span>
            </motion.div>
          ))}

          {/* Curseur */}
          <motion.div
            className="pointer-events-none absolute left-0 top-0 z-20 drop-shadow-md"
            initial={false}
            animate={{
              x: cursorPos.x,
              y: cursorPos.y,
              opacity: s.cursorOn ? 1 : 0,
              scale: s.cursorClick ? 0.86 : 1,
            }}
            transition={{
              x: { duration: 0.7, ease: EASE_OUT },
              y: { duration: 0.7, ease: EASE_OUT },
              opacity: { duration: 0.25 },
              scale: { duration: 0.15 },
            }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18">
              <path d="M4 2l6 15.5 2.2-6L18 9.4z" className="fill-foreground stroke-background" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          </motion.div>

          {/* Confirmation */}
          <motion.div
            className="pointer-events-none absolute bottom-3.5 right-3.5 z-20 flex items-center gap-2.5 rounded-xl border border-border bg-popover px-3.5 py-2.5 shadow-lg"
            initial={false}
            animate={s.toastOn ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
            transition={{ duration: 0.3, ease: EASE_OUT }}
          >
            <Check className="h-4 w-4 shrink-0 text-success" />
            <span>
              <span className="block text-xs font-semibold leading-tight">Camille ajoutée à la séquence</span>
              <span className="block text-3xs text-muted-foreground">Mission · Product Designer Senior</span>
            </span>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

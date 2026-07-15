import { useCallback, useEffect, useRef, useState } from 'react';
import { motion, useReducedMotion } from 'framer-motion';
import { Search, Check } from 'lucide-react';

/**
 * Démo produit vivante du hero landing — remplace le screenshot statique.
 * Rejoue en boucle la chorégraphie signature de l'app : recherche qui se
 * tape → résultats en cascade → scoring → ajout à la séquence → toast.
 *
 * Les couleurs sont volontairement câblées sur le thème SOMBRE de l'app
 * (hsl 40 3% …) et non sur les tokens de la page : la landing est claire,
 * mais la fenêtre représente l'app telle qu'elle est. Purement décoratif
 * (aria-hidden), aucune interaction réelle.
 */

const EASE_OUT: [number, number, number, number] = [0.22, 1, 0.36, 1];
const RING_R = 18;
const CIRC = 2 * Math.PI * RING_R;
const SCORE = 92;
const QUERY = 'Product Designer Senior · Paris';
const LOOP_MS = 11000;

const OTHER_ROWS = [
  { ini: 'NB', name: 'Noah Bertrand', role: 'Product Designer · Lyon · 6 ans', chips: ['Figma', 'Prototypage'], badge: 86 },
  { ini: 'LM', name: 'Léa Mercier', role: 'UX Designer Senior · Remote · 9 ans', chips: ['Recherche', 'Design ops'], badge: 81 },
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
  fadeOut: boolean;
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
  fadeOut: false,
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
  fadeOut: false,
};

export const LandingProductDemo = () => {
  const reduceMotion = useReducedMotion();
  const [s, setS] = useState<DemoState>(reduceMotion ? FINAL_STATE : INITIAL_STATE);
  const [displayScore, setDisplayScore] = useState(reduceMotion ? SCORE : 0);
  const listRef = useRef<HTMLDivElement>(null);
  const addRef = useRef<HTMLDivElement>(null);
  const [cursorPos, setCursorPos] = useState({ x: 320, y: -20 });
  const timersRef = useRef<number[]>([]);

  const patch = useCallback((p: Partial<DemoState>) => setS(prev => ({ ...prev, ...p })), []);

  // Count-up du score, synchronisé sur le tracé de l'anneau (900ms ease-out).
  const runScoreCount = useCallback(() => {
    const start = performance.now();
    const step = (now: number) => {
      const p = Math.min((now - start) / 900, 1);
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
    if (reduceMotion) return;

    const runCycle = () => {
      timersRef.current.forEach(clearTimeout);
      timersRef.current = [];
      setS(INITIAL_STATE);
      setDisplayScore(0);
      setCursorPos({ x: 320, y: -20 });

      const at = (ms: number, fn: () => void) => {
        timersRef.current.push(window.setTimeout(fn, ms));
      };

      // Frappe de la recherche (38ms/caractère)
      for (let i = 1; i <= QUERY.length; i++) {
        at(350 + i * 38, () => patch({ typed: QUERY.slice(0, i) }));
      }
      at(1900, () => patch({ searchFocus: true }));
      at(2050, () => patch({ rowsIn: true }));
      at(2900, () => { patch({ scoreOn: true }); runScoreCount(); });
      at(3900, () => patch({ pillOn: true }));
      at(4300, () => { moveCursorToAdd(); patch({ cursorOn: true }); });
      at(5350, () => patch({ cursorClick: true }));
      at(5520, () => patch({ cursorClick: false, added: true }));
      at(5900, () => patch({ toastOn: true, searchFocus: false }));
      at(9600, () => patch({ cursorOn: false }));
      at(10300, () => patch({ fadeOut: true }));
    };

    const startId = window.setTimeout(runCycle, 250);
    const loopId = window.setInterval(runCycle, LOOP_MS);
    return () => {
      clearTimeout(startId);
      clearInterval(loopId);
      timersRef.current.forEach(clearTimeout);
    };
  }, [reduceMotion, patch, runScoreCount, moveCursorToAdd]);

  return (
    <div
      className="rounded-2xl border border-white/10 bg-[hsl(40,3%,14%)] text-[hsl(0,0%,98%)] text-left overflow-hidden shadow-2xl relative"
      aria-label="Démonstration animée de Konekt : recherche, scoring et mise en séquence d'un candidat"
    >
      {/* Filet dégradé de marque — balaie le haut de la fenêtre au scoring */}
      <div className="absolute top-0 left-0 right-0 h-0.5 overflow-hidden z-10" aria-hidden="true">
        <motion.div
          className="absolute inset-y-0 w-1/3 rounded-full skalr-gradient-border"
          initial={false}
          animate={s.scoreOn && !s.fadeOut ? { x: ['-120%', '340%'], opacity: [0, 0.95, 0] } : { x: '-120%', opacity: 0 }}
          transition={s.scoreOn && !s.fadeOut ? { duration: 1.1, ease: EASE_OUT } : { duration: 0 }}
        />
      </div>

      <div aria-hidden="true">
        {/* Chrome fenêtre */}
        <div className="flex items-center px-4 py-3 border-b border-white/10">
          <div className="flex gap-1.5">
            {[0, 1, 2].map(i => <span key={i} className="w-2.5 h-2.5 rounded-full bg-[hsl(40,3%,18%)]" />)}
          </div>
          <span className="flex-1 text-center font-mono text-[11px] text-[hsl(40,2%,56%)]">
            konekt.app — Mission · Product Designer Senior
          </span>
          <span className="w-[52px]" />
        </div>

        {/* Onglets mission */}
        <div className="flex items-center gap-0.5 px-3 border-b border-white/10">
          {['Aperçu', 'Brief', 'Sourcing', 'Pipeline'].map(tab => (
            <span
              key={tab}
              className={`relative px-3 py-2.5 text-[13px] ${tab === 'Sourcing' ? 'text-[hsl(0,0%,98%)]' : 'text-[hsl(40,2%,56%)]'}`}
            >
              {tab}
              {tab === 'Sourcing' && <span className="absolute left-2.5 right-2.5 -bottom-px h-0.5 rounded-full bg-[hsl(0,0%,98%)]" />}
            </span>
          ))}
          <span className="flex-1" />
          <span className="font-mono text-[11px] text-[hsl(40,2%,56%)] pr-1.5">
            Entretiens&nbsp;&nbsp;<span className="text-[hsl(0,0%,98%)]">{s.toastOn || s.added ? 5 : 4}</span>
          </span>
        </div>

        {/* Barre de recherche */}
        <div className="flex gap-2.5 px-3.5 pt-3.5 pb-1">
          <div
            className={`flex-1 flex items-center gap-2 h-9 px-3 rounded-[10px] border bg-[hsl(40,3%,11%)] transition-[border-color,box-shadow] duration-200 ${
              s.searchFocus ? 'border-white/25 shadow-[0_0_0_3px_rgba(255,255,255,0.06)]' : 'border-white/[0.12]'
            }`}
          >
            <Search className="w-3.5 h-3.5 shrink-0 text-[hsl(40,2%,56%)]" />
            <span className="text-[13px] whitespace-nowrap overflow-hidden">{s.typed}</span>
            {!reduceMotion && s.typed.length < QUERY.length && s.typed.length > 0 && (
              <span className="w-px h-3.5 bg-[hsl(0,0%,98%)] animate-pulse" />
            )}
            <span className="ml-auto font-mono text-[10px] text-[hsl(40,2%,56%)] border border-white/10 rounded px-1.5 py-px">⌘K</span>
          </div>
          <span className="inline-flex items-center text-[12px] font-semibold rounded-[10px] px-3.5 bg-[hsl(0,0%,98%)] text-[hsl(40,3%,11%)]">
            Scorer les profils
          </span>
        </div>

        {/* Liste résultats */}
        <div ref={listRef} className="relative flex flex-col gap-2 px-3.5 pb-4 pt-2.5 min-h-[240px]">
          <motion.div
            className="contents"
            initial={false}
            animate={{ opacity: s.fadeOut ? 0 : 1 }}
            transition={{ duration: 0.25 }}
          >
            {/* Ligne candidate principale */}
            <motion.div
              initial={false}
              animate={s.rowsIn ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
              transition={{ duration: 0.5, ease: EASE_OUT }}
              className={`grid grid-cols-[36px_1fr_auto] gap-3 items-center p-3 rounded-xl border bg-[hsl(40,3%,14%)] transition-colors duration-300 ${
                s.added ? 'border-white/25' : 'border-white/10'
              }`}
            >
              <span className="w-9 h-9 rounded-full grid place-items-center border border-white/10 bg-[hsl(40,3%,18%)] font-brand font-semibold text-[12px]">
                CR
              </span>
              <div className="min-w-0">
                <p className="text-[13px] font-semibold leading-tight truncate">Camille Roy</p>
                <p className="text-[11.5px] text-[hsl(40,2%,56%)] truncate">Product Designer Senior · Paris · 8 ans</p>
                <div className="hidden sm:flex gap-1 mt-1.5">
                  {['Figma', 'Design system', 'B2B SaaS'].map(c => (
                    <span key={c} className="font-mono text-[9px] text-[hsl(40,2%,56%)] border border-white/10 rounded-full px-2 py-px">{c}</span>
                  ))}
                </div>
              </div>
              <div className="flex items-center gap-2.5">
                <motion.span
                  initial={false}
                  animate={s.pillOn ? { opacity: 1, scale: 1 } : { opacity: 0, scale: 0.85 }}
                  transition={{ duration: 0.4, ease: EASE_OUT }}
                  className="hidden sm:inline-flex items-center gap-1 text-[10.5px] font-semibold border border-white/10 bg-[hsl(40,3%,18%)] rounded-lg px-2 py-0.5 whitespace-nowrap"
                >
                  <Check className="w-3 h-3 text-[hsl(142,71%,45%)]" /> À contacter
                </motion.span>
                <span className="relative w-11 h-11 shrink-0">
                  <svg width="44" height="44" viewBox="0 0 44 44" className="-rotate-90">
                    <circle cx="22" cy="22" r={RING_R} fill="none" strokeWidth="4.5" className="stroke-[hsl(40,3%,18%)]" />
                    <motion.circle
                      cx="22" cy="22" r={RING_R} fill="none" strokeWidth="4.5"
                      className="stroke-[hsl(0,0%,98%)]"
                      strokeDasharray={CIRC}
                      initial={false}
                      animate={{ strokeDashoffset: s.scoreOn ? CIRC * (1 - SCORE / 100) : CIRC }}
                      transition={{ duration: 0.9, ease: EASE_OUT }}
                    />
                  </svg>
                  <span className="absolute inset-0 grid place-items-center font-mono text-[12px] tabular-nums">{displayScore}</span>
                </span>
                <div
                  ref={addRef}
                  className={`inline-flex items-center gap-1.5 text-[12px] font-semibold rounded-[10px] px-3 py-1.5 border transition-colors duration-300 whitespace-nowrap ${
                    s.added
                      ? 'bg-[hsl(0,0%,98%)] text-[hsl(40,3%,11%)] border-transparent'
                      : 'bg-transparent text-[hsl(0,0%,98%)] border-white/10'
                  } ${s.cursorClick ? 'scale-95' : 'scale-100'}`}
                  style={{ transitionProperty: 'background-color,color,border-color,transform' }}
                >
                  {s.added ? <><Check className="w-3 h-3" /> Ajoutée</> : 'Ajouter à la séquence'}
                </div>
              </div>
            </motion.div>

            {/* Autres candidats */}
            {OTHER_ROWS.map((row, i) => (
              <motion.div
                key={row.ini}
                initial={false}
                animate={s.rowsIn ? { opacity: 1, y: 0 } : { opacity: 0, y: 6 }}
                transition={{ duration: 0.5, ease: EASE_OUT, delay: s.rowsIn ? (i + 1) * 0.07 : 0 }}
                className="grid grid-cols-[36px_1fr_auto] gap-3 items-center p-3 rounded-xl border border-white/10 bg-[hsl(40,3%,14%)]"
              >
                <span className="w-9 h-9 rounded-full grid place-items-center border border-white/10 bg-[hsl(40,3%,18%)] font-brand font-semibold text-[12px]">
                  {row.ini}
                </span>
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold leading-tight truncate">{row.name}</p>
                  <p className="text-[11.5px] text-[hsl(40,2%,56%)] truncate">{row.role}</p>
                  <div className="hidden sm:flex gap-1 mt-1.5">
                    {row.chips.map(c => (
                      <span key={c} className="font-mono text-[9px] text-[hsl(40,2%,56%)] border border-white/10 rounded-full px-2 py-px">{c}</span>
                    ))}
                  </div>
                </div>
                <span className="font-mono text-[11.5px] text-[hsl(40,2%,56%)] border border-white/10 rounded-lg px-2 py-1">{row.badge}</span>
              </motion.div>
            ))}
          </motion.div>

          {/* Curseur */}
          <motion.div
            className="absolute left-0 top-0 z-20 pointer-events-none drop-shadow-[0_3px_6px_rgba(0,0,0,0.45)]"
            initial={false}
            animate={{
              x: cursorPos.x,
              y: cursorPos.y,
              opacity: s.cursorOn ? 1 : 0,
              scale: s.cursorClick ? 0.86 : 1,
            }}
            transition={{ x: { duration: 0.95, ease: EASE_OUT }, y: { duration: 0.95, ease: EASE_OUT }, opacity: { duration: 0.35 }, scale: { duration: 0.15 } }}
          >
            <svg viewBox="0 0 24 24" width="18" height="18" fill="hsl(0,0%,98%)">
              <path d="M4 2l6 15.5 2.2-6L18 9.4z" stroke="hsl(40,3%,11%)" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          </motion.div>

          {/* Toast de confirmation */}
          <motion.div
            className="absolute right-3.5 bottom-3.5 z-20 flex items-center gap-2.5 rounded-xl border border-white/10 bg-[hsl(40,3%,11%)] px-3.5 py-2.5 shadow-2xl pointer-events-none"
            initial={false}
            animate={s.toastOn && !s.fadeOut ? { opacity: 1, y: 0 } : { opacity: 0, y: 10 }}
            transition={{ duration: 0.35, ease: EASE_OUT }}
          >
            <Check className="w-4 h-4 shrink-0 text-[hsl(142,71%,45%)]" />
            <span>
              <span className="block text-[12px] font-semibold leading-tight">Camille ajoutée à la séquence</span>
              <span className="block text-[10.5px] text-[hsl(40,2%,56%)]">Mission · Product Designer Senior</span>
            </span>
          </motion.div>
        </div>
      </div>
    </div>
  );
};

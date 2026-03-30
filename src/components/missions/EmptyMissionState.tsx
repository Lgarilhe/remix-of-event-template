import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Clock, MessageSquare, Pencil, List, Settings, ExternalLink } from 'lucide-react';
import { ShimmerButton } from '@/components/magicui/shimmer-button';
import { cn } from '@/lib/utils';

interface EmptyMissionStateProps {
  onCreateAI: () => void;
  onCreateManual: () => void;
}

/** Abstract AI brain SVG illustration */
const AIBrainIllustration = () => (
  <svg viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-28 h-24">
    {/* Brain outline */}
    <path
      d="M60 15C45 15 35 25 33 35C28 36 22 42 22 50C22 58 28 64 33 65C35 75 45 85 60 85C75 85 85 75 87 65C92 64 98 58 98 50C98 42 92 36 87 35C85 25 75 15 60 15Z"
      stroke="hsl(var(--foreground))"
      strokeWidth="1.5"
      strokeLinecap="round"
      fill="hsl(var(--brutal-accent) / 0.06)"
    />
    {/* Center line */}
    <path d="M60 25V75" stroke="hsl(var(--foreground) / 0.15)" strokeWidth="1" strokeDasharray="3 3" />
    {/* Neural nodes */}
    {[
      { cx: 45, cy: 38 }, { cx: 75, cy: 38 },
      { cx: 40, cy: 55 }, { cx: 80, cy: 55 },
      { cx: 52, cy: 68 }, { cx: 68, cy: 68 },
      { cx: 60, cy: 45 },
    ].map((p, i) => (
      <g key={i}>
        <circle cx={p.cx} cy={p.cy} r="3.5" fill="hsl(var(--foreground))" />
        <circle cx={p.cx} cy={p.cy} r="6" stroke="hsl(var(--brutal-accent))" strokeWidth="0.8" opacity="0.4" />
      </g>
    ))}
    {/* Connections */}
    {[
      [45, 38, 60, 45], [75, 38, 60, 45],
      [60, 45, 40, 55], [60, 45, 80, 55],
      [40, 55, 52, 68], [80, 55, 68, 68],
      [52, 68, 68, 68],
    ].map(([x1, y1, x2, y2], i) => (
      <line key={i} x1={x1} y1={y1} x2={x2} y2={y2}
        stroke="hsl(var(--brutal-accent))" strokeWidth="1" opacity="0.35" />
    ))}
    {/* Sparkle accents */}
    <circle cx="30" cy="30" r="1.5" fill="hsl(var(--brutal-accent))" opacity="0.6" />
    <circle cx="90" cy="30" r="1" fill="hsl(var(--brutal-accent))" opacity="0.5" />
    <circle cx="25" cy="60" r="1" fill="hsl(var(--brutal-accent))" opacity="0.4" />
    <circle cx="95" cy="60" r="1.5" fill="hsl(var(--brutal-accent))" opacity="0.5" />
  </svg>
);

/** Abstract manual/tools SVG illustration */
const ManualIllustration = () => (
  <svg viewBox="0 0 120 100" fill="none" xmlns="http://www.w3.org/2000/svg" className="w-28 h-24">
    {/* Document */}
    <rect x="35" y="18" width="50" height="64" rx="0" stroke="hsl(var(--foreground))" strokeWidth="1.5" fill="none" />
    <line x1="43" y1="32" x2="77" y2="32" stroke="hsl(var(--foreground) / 0.3)" strokeWidth="1.5" />
    <line x1="43" y1="40" x2="70" y2="40" stroke="hsl(var(--foreground) / 0.2)" strokeWidth="1.5" />
    <line x1="43" y1="48" x2="74" y2="48" stroke="hsl(var(--foreground) / 0.2)" strokeWidth="1.5" />
    <line x1="43" y1="56" x2="65" y2="56" stroke="hsl(var(--foreground) / 0.15)" strokeWidth="1.5" />
    {/* Checkboxes */}
    <rect x="43" y="64" width="6" height="6" stroke="hsl(var(--foreground) / 0.3)" strokeWidth="1" fill="none" />
    <rect x="43" y="73" width="6" height="6" stroke="hsl(var(--foreground) / 0.3)" strokeWidth="1" fill="none" />
    <line x1="44" y1="67" x2="46" y2="69" stroke="hsl(var(--foreground))" strokeWidth="1" />
    <line x1="46" y1="69" x2="49" y2="65" stroke="hsl(var(--foreground))" strokeWidth="1" />
    <line x1="53" y1="67" x2="70" y2="67" stroke="hsl(var(--foreground) / 0.2)" strokeWidth="1.5" />
    <line x1="53" y1="76" x2="66" y2="76" stroke="hsl(var(--foreground) / 0.15)" strokeWidth="1.5" />
    {/* Pencil */}
    <g transform="translate(72, 12) rotate(30)">
      <rect x="0" y="0" width="6" height="28" fill="hsl(var(--foreground))" />
      <polygon points="0,28 6,28 3,34" fill="hsl(var(--foreground))" />
    </g>
  </svg>
);

const cardVariants = {
  hidden: { opacity: 0, y: 30 },
  visible: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.2, duration: 0.5, ease: 'easeOut' as const },
  }),
};

const aiBullets = [
  { icon: Sparkles, text: 'Brief vocal ou écrit → structuré par l\'IA', color: 'text-amber-500' },
  { icon: Clock, text: 'Filtres de recherche générés automatiquement', color: 'text-blue-500' },
  { icon: MessageSquare, text: 'Messages personnalisés en 1 clic', color: 'text-emerald-500' },
];

const manualBullets = [
  { icon: Pencil, text: 'Contrôle total sur chaque paramètre', color: 'text-muted-foreground' },
  { icon: List, text: 'Importez depuis une URL ou un fichier', color: 'text-muted-foreground' },
  { icon: Settings, text: 'Pour les recruteurs expérimentés', color: 'text-muted-foreground' },
];

export const EmptyMissionState: React.FC<EmptyMissionStateProps> = ({ onCreateAI, onCreateManual }) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="py-10 sm:py-16"
    >
      {/* Hero */}
      <div className="text-center mb-10 sm:mb-14">
        <motion.h2
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="text-2xl sm:text-3xl font-black uppercase tracking-wider text-foreground mb-3"
        >
          Lancez votre première mission
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed"
        >
          Une mission = un poste à pourvoir. Choisissez votre méthode pour démarrer.
        </motion.p>
      </div>

      {/* Cards */}
      <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 max-w-3xl mx-auto">
        {/* ── Card AI ── */}
        <motion.div
          custom={0}
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          className="flex-1 min-w-0"
        >
          <button
            onClick={onCreateAI}
            className={cn(
              "relative w-full text-left border-2 border-foreground p-6 sm:p-8 overflow-hidden h-full",
              "bg-gradient-to-br from-[hsl(var(--brutal-accent)/0.06)] to-transparent",
              "transition-transform duration-300 ease-out hover:scale-[1.02]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brutal-accent"
            )}
          >
            {/* Recommended badge */}
            <span className="absolute top-4 right-4 px-2.5 py-1 bg-foreground text-background text-[9px] font-bold uppercase tracking-widest animate-pulse">
              Recommandé
            </span>

            {/* Illustration */}
            <div className="mb-5">
              <AIBrainIllustration />
            </div>

            {/* Title */}
            <h3 className="text-lg font-black uppercase tracking-wider text-foreground mb-5">
              Créer avec l'IA
            </h3>

            {/* Bullets */}
            <ul className="space-y-4 mb-8">
              {aiBullets.map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <div className="w-6 h-6 border border-foreground/15 flex items-center justify-center shrink-0 mt-0.5">
                    <item.icon className={cn("w-3.5 h-3.5", item.color)} />
                  </div>
                  <span className="text-xs text-foreground/80 leading-relaxed">{item.text}</span>
                </li>
              ))}
            </ul>

            {/* CTA */}
            <ShimmerButton
              className="w-full h-[44px] text-xs pointer-events-none"
              shimmerDuration="2s"
              tabIndex={-1}
            >
              <Sparkles className="w-3.5 h-3.5" />
              Commencer le brief IA
            </ShimmerButton>
          </button>
        </motion.div>

        {/* ── Card Manual ── */}
        <motion.div
          custom={1}
          variants={cardVariants}
          initial="hidden"
          animate="visible"
          className="flex-1 min-w-0"
        >
          <button
            onClick={onCreateManual}
            className={cn(
              "relative w-full text-left border border-foreground/30 p-6 sm:p-8 overflow-hidden h-full bg-background",
              "transition-transform duration-300 ease-out hover:scale-[1.02]",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-foreground/30"
            )}
          >
            {/* Illustration */}
            <div className="mb-5">
              <ManualIllustration />
            </div>

            {/* Title */}
            <h3 className="text-lg font-black uppercase tracking-wider text-foreground mb-5">
              Créer manuellement
            </h3>

            {/* Bullets */}
            <ul className="space-y-4 mb-8">
              {manualBullets.map((item, i) => (
                <li key={i} className="flex items-start gap-3">
                  <div className="w-6 h-6 border border-foreground/15 flex items-center justify-center shrink-0 mt-0.5">
                    <item.icon className={cn("w-3.5 h-3.5", item.color)} />
                  </div>
                  <span className="text-xs text-foreground/80 leading-relaxed">{item.text}</span>
                </li>
              ))}
            </ul>

            {/* CTA outline */}
            <div className="w-full h-[44px] text-xs font-bold uppercase tracking-wider border border-foreground bg-background text-foreground flex items-center justify-center gap-2 group-hover:shadow-[4px_4px_0px_0px_hsl(var(--foreground))] transition-shadow">
              <Pencil className="w-3.5 h-3.5" />
              Création manuelle
            </div>
          </button>
        </motion.div>
      </div>

      {/* Bottom link */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6, duration: 0.4 }}
        className="mt-8 text-center"
      >
        <p className="text-[11px] text-muted-foreground/60">
          Ou importez depuis une page carrières{' '}
          <span className="inline-flex items-center gap-0.5 text-foreground/50 hover:text-foreground transition-colors cursor-pointer">
            <ExternalLink className="w-3 h-3" />
          </span>
        </p>
      </motion.div>
    </motion.div>
  );
};

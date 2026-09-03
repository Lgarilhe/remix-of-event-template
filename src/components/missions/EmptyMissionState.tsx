import React from 'react';
import { motion } from 'framer-motion';
import { Sparkles, Clock, MessageSquare, Pencil, List, Settings, ArrowRight, Brain, ExternalLink } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface EmptyMissionStateProps {
  onCreateAI: () => void;
  onCreateManual: () => void;
}

/* ─── Stats bar — chiffres statiques, une seule entrée en fondu ─── */
const StatsBar: React.FC = () => (
  <motion.div
    initial={{ opacity: 0, y: 10 }}
    animate={{ opacity: 1, y: 0 }}
    transition={{ delay: 0.3, duration: 0.4 }}
    className="flex items-center justify-center gap-8 sm:gap-12 mb-10 sm:mb-14"
  >
    {[
      { value: '200M+', label: 'Profils accessibles' },
      { value: '45s', label: 'Brief → Sourcing' },
      { value: '3x', label: 'Plus rapide' },
    ].map((stat) => (
      <div key={stat.label} className="text-center">
        <div className="text-xl sm:text-2xl font-black text-foreground tracking-tight">
          {stat.value}
        </div>
        <div className="text-xs text-muted-foreground uppercase tracking-wider mt-0.5">
          {stat.label}
        </div>
      </div>
    ))}
  </motion.div>
);

/* ─── Bullets — icônes uniformes, même chip sur les deux cards ─── */
const aiBullets = [
  { icon: Sparkles, text: 'Brief vocal ou écrit → structuré par l\'IA' },
  { icon: Clock, text: 'Filtres de recherche générés automatiquement' },
  { icon: MessageSquare, text: 'Messages personnalisés en 1 clic' },
];

const manualBullets = [
  { icon: Pencil, text: 'Contrôle total sur chaque paramètre' },
  { icon: List, text: 'Importez depuis une URL ou un fichier' },
  { icon: Settings, text: 'Pour les recruteurs expérimentés' },
];

const BulletList: React.FC<{ items: typeof aiBullets }> = ({ items }) => (
  <ul className="space-y-4 mb-8">
    {items.map((item) => (
      <li key={item.text} className="flex items-start gap-3">
        <span className="w-7 h-7 border border-border bg-accent/50 flex items-center justify-center shrink-0">
          <item.icon className="w-3.5 h-3.5 text-foreground/70" />
        </span>
        <span className="text-xs text-foreground/80 leading-relaxed pt-1">{item.text}</span>
      </li>
    ))}
  </ul>
);

/* ═══════════════════════════════════════════════════════
   MAIN COMPONENT
   Version allégée (03/09/2026) : avant = fond neuronal animé,
   particules flottantes, anneau orbital, texte à effet machine
   à écrire, badge qui pulse, bouton shimmer. Tout ça chargeait
   l'écran sans ajouter d'information. Ici : titre, preuves,
   deux choix, un accent unique.
   ═══════════════════════════════════════════════════════ */

export const EmptyMissionState: React.FC<EmptyMissionStateProps> = ({ onCreateAI, onCreateManual }) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4 }}
      className="py-10 sm:py-16"
    >
      {/* Hero */}
      <div className="text-center mb-8 sm:mb-10">
        <div className="w-14 h-14 mx-auto mb-5 border border-border bg-accent/50 flex items-center justify-center">
          <Brain className="w-6 h-6 text-foreground" />
        </div>
        <h2 className="text-2xl sm:text-4xl font-black uppercase tracking-wider text-foreground mb-3">
          Lancez votre première mission
        </h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto leading-relaxed">
          Une mission = un poste à pourvoir. L'IA vous guide du brief au premier message.
        </p>
      </div>

      {/* Stats */}
      <StatsBar />

      {/* Cards */}
      <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 max-w-4xl mx-auto">
        {/* ── Card AI ── */}
        <motion.button
          onClick={onCreateAI}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          className="flex-1 min-w-0 text-left border border-border bg-card p-7 sm:p-9 relative interactive-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <span className="absolute top-4 right-4 px-2.5 py-1 bg-foreground text-background text-xs font-bold uppercase tracking-wider">
            Recommandé
          </span>

          <div className="w-14 h-14 mb-6 bg-foreground flex items-center justify-center">
            <Brain className="w-6 h-6 text-background" />
          </div>

          <h3 className="text-lg sm:text-xl font-black uppercase tracking-wider text-foreground mb-2">
            Créer avec l'IA
          </h3>
          <p className="text-xs text-muted-foreground mb-6">
            La méthode la plus rapide
          </p>

          <BulletList items={aiBullets} />

          <Button variant="primary" className="w-full h-12 text-xs pointer-events-none" tabIndex={-1}>
            <Sparkles className="w-3.5 h-3.5" />
            Commencer le brief IA
            <ArrowRight className="w-3.5 h-3.5" />
          </Button>
        </motion.button>

        {/* ── Card Manual ── */}
        <motion.button
          onClick={onCreateManual}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3, duration: 0.4 }}
          className="flex-1 min-w-0 text-left border border-border bg-background p-7 sm:p-9 interactive-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <div className="w-14 h-14 mb-6 border border-border flex items-center justify-center">
            <Pencil className="w-6 h-6 text-foreground/70" />
          </div>

          <h3 className="text-lg sm:text-xl font-black uppercase tracking-wider text-foreground mb-2">
            Créer manuellement
          </h3>
          <p className="text-xs text-muted-foreground mb-6">
            Pour les recruteurs experts
          </p>

          <BulletList items={manualBullets} />

          <Button variant="outline" className="w-full h-12 text-xs pointer-events-none" tabIndex={-1}>
            <Pencil className="w-3.5 h-3.5" />
            Créer manuellement
          </Button>
        </motion.button>
      </div>

      {/* Import link */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.5, duration: 0.4 }}
        className="mt-8 text-center"
      >
        <p className="text-xs text-muted-foreground/50">
          Ou importez depuis une page carrières{' '}
          <ExternalLink className="inline w-3 h-3 text-foreground/30 hover:text-foreground/60 transition-colors cursor-pointer" />
        </p>
      </motion.div>
    </motion.div>
  );
};

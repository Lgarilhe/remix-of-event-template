import React from 'react';
import { motion } from 'framer-motion';
import { Bot, Pencil, Sparkles, FileText, Zap, Clock, Upload, Settings2 } from 'lucide-react';
import { ShimmerButton } from '@/components/magicui/shimmer-button';

interface EmptyMissionStateProps {
  onCreateAI: () => void;
  onCreateManual: () => void;
}

export const EmptyMissionState: React.FC<EmptyMissionStateProps> = ({ onCreateAI, onCreateManual }) => {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5 }}
      className="py-8 sm:py-12"
    >
      {/* Hero text */}
      <div className="text-center mb-8 sm:mb-12">
        <motion.div
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ delay: 0.1, duration: 0.4 }}
          className="text-5xl sm:text-6xl mb-4"
        >
          🚀
        </motion.div>
        <h2 className="text-xl sm:text-2xl font-black uppercase tracking-wider text-foreground mb-2">
          Lancez votre première mission
        </h2>
        <p className="text-sm text-muted-foreground max-w-lg mx-auto">
          Une mission = un poste à pourvoir. L'IA vous guide de A à Z : du brief jusqu'au premier message envoyé.
        </p>
      </div>

      {/* Two cards side by side */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 sm:gap-6 max-w-3xl mx-auto">
        {/* Card AI */}
        <motion.div
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.2, duration: 0.4 }}
          className="relative border-2 border-foreground bg-background p-6 sm:p-8 shadow-[4px_4px_0px_0px_hsl(var(--brutal-accent))] group"
        >
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 bg-foreground text-background flex items-center justify-center shrink-0">
              <Bot className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-black uppercase tracking-wider text-foreground">
              Créer avec l'IA
            </h3>
          </div>

          <ul className="space-y-3 mb-6">
            {[
              { icon: FileText, text: 'Brief vocal ou écrit — l\'IA comprend tout' },
              { icon: Sparkles, text: 'ICP, filtres et stratégie générés automatiquement' },
              { icon: Clock, text: 'Prêt à sourcer en 2 minutes' },
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <item.icon className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <span className="text-xs text-foreground/80 leading-relaxed">{item.text}</span>
              </li>
            ))}
          </ul>

          <ShimmerButton
            onClick={onCreateAI}
            className="w-full h-[40px] text-xs"
          >
            <Sparkles className="w-3.5 h-3.5" />
            Commencer le brief IA
          </ShimmerButton>
        </motion.div>

        {/* Card Manual */}
        <motion.div
          initial={{ opacity: 0, x: 20 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: 0.3, duration: 0.4 }}
          className="relative border border-foreground bg-background p-6 sm:p-8 group"
        >
          <div className="flex items-center gap-3 mb-5">
            <div className="w-10 h-10 border border-foreground text-foreground flex items-center justify-center shrink-0">
              <Pencil className="w-5 h-5" />
            </div>
            <h3 className="text-sm font-black uppercase tracking-wider text-foreground">
              Créer manuellement
            </h3>
          </div>

          <ul className="space-y-3 mb-6">
            {[
              { icon: Settings2, text: 'Contrôle total sur chaque paramètre' },
              { icon: Upload, text: 'Importez depuis une URL ou un fichier' },
              { icon: Zap, text: 'Pour les recruteurs expérimentés' },
            ].map((item, i) => (
              <li key={i} className="flex items-start gap-2.5">
                <item.icon className="w-3.5 h-3.5 text-muted-foreground mt-0.5 shrink-0" />
                <span className="text-xs text-foreground/80 leading-relaxed">{item.text}</span>
              </li>
            ))}
          </ul>

          <button
            onClick={onCreateManual}
            className="relative overflow-hidden w-full h-[40px] text-xs font-bold uppercase tracking-wider border border-foreground bg-background text-foreground group/btn"
          >
            <span className="relative z-10 flex items-center justify-center gap-2">
              <Pencil className="w-3.5 h-3.5" />
              Création manuelle
            </span>
            <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover/btn:translate-y-0 transition-transform duration-300 ease-out" />
          </button>
        </motion.div>
      </div>
    </motion.div>
  );
};

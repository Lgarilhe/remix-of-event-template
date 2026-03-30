import React from 'react';
import { motion } from 'framer-motion';
import { Bot, Pencil, Sparkles, FileText, Zap, Clock, Upload, Settings2 } from 'lucide-react';
import { ShimmerButton } from '@/components/magicui/shimmer-button';
import { TiltCard } from '@/components/magicui/tilt-card';
import { Glow } from '@/components/magicui/glow';
import { BorderBeam } from '@/components/magicui/border-beam';

interface EmptyMissionStateProps {
  onCreateAI: () => void;
  onCreateManual: () => void;
}

const floatingEmojis = ['🎯', '💼', '🚀', '⚡', '🔍'];

export const EmptyMissionState: React.FC<EmptyMissionStateProps> = ({ onCreateAI, onCreateManual }) => {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6 }}
      className="py-8 sm:py-16"
    >
      {/* Hero text with staggered reveal */}
      <div className="text-center mb-10 sm:mb-14">
        {/* Floating emojis orbit */}
        <div className="relative inline-block mb-6">
          <motion.div
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ type: 'spring', stiffness: 200, damping: 15, delay: 0.1 }}
            className="text-6xl sm:text-7xl relative z-10"
          >
            🚀
          </motion.div>
          {/* Orbiting particles */}
          {floatingEmojis.map((emoji, i) => (
            <motion.span
              key={i}
              className="absolute text-lg sm:text-xl pointer-events-none"
              style={{ top: '50%', left: '50%' }}
              initial={{ opacity: 0, scale: 0 }}
              animate={{
                opacity: [0, 0.7, 0],
                scale: [0, 1, 0.5],
                x: [0, Math.cos((i * 2 * Math.PI) / floatingEmojis.length) * 80],
                y: [0, Math.sin((i * 2 * Math.PI) / floatingEmojis.length) * 80],
              }}
              transition={{
                duration: 3,
                delay: 0.5 + i * 0.15,
                repeat: Infinity,
                repeatDelay: 4,
                ease: 'easeOut',
              }}
            >
              {emoji}
            </motion.span>
          ))}
        </div>

        <motion.h2
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2, duration: 0.5 }}
          className="text-2xl sm:text-3xl font-black uppercase tracking-wider text-foreground mb-3"
        >
          Lancez votre première mission
        </motion.h2>
        <motion.p
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.35, duration: 0.5 }}
          className="text-sm text-muted-foreground max-w-lg mx-auto leading-relaxed"
        >
          Une mission = un poste à pourvoir. L'IA vous guide de A à Z : du brief jusqu'au premier message envoyé.
        </motion.p>
      </div>

      {/* Two tilt cards side by side */}
      <div className="perspective-1000 grid grid-cols-1 sm:grid-cols-2 gap-5 sm:gap-8 max-w-3xl mx-auto">
        {/* Card AI */}
        <motion.div
          initial={{ opacity: 0, x: -30, rotateY: -5 }}
          animate={{ opacity: 1, x: 0, rotateY: 0 }}
          transition={{ delay: 0.4, duration: 0.6, ease: 'easeOut' }}
        >
          <TiltCard
            tiltAmount={8}
            scale={1.03}
            className="h-full"
          >
            <div className="relative border-2 border-foreground bg-background p-6 sm:p-8 shadow-[4px_4px_0px_0px_hsl(var(--brutal-accent))] overflow-hidden h-full">
              {/* Glow effect */}
              <Glow variant="top-right" color="hsl(var(--brutal-accent))" size="md" pulse />

              {/* Border beam */}
              <BorderBeam size={150} duration={6} colorFrom="hsl(var(--brutal-accent))" />

              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-5">
                  <motion.div
                    className="w-11 h-11 bg-foreground text-background flex items-center justify-center shrink-0"
                    whileHover={{ rotate: [0, -10, 10, 0] }}
                    transition={{ duration: 0.5 }}
                  >
                    <Bot className="w-5 h-5" />
                  </motion.div>
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-wider text-foreground">
                      Créer avec l'IA
                    </h3>
                    <span className="text-[10px] text-brutal-accent font-bold uppercase tracking-widest">
                      Recommandé
                    </span>
                  </div>
                </div>

                <ul className="space-y-3.5 mb-7">
                  {[
                    { icon: FileText, text: 'Brief vocal ou écrit — l\'IA comprend tout' },
                    { icon: Sparkles, text: 'ICP, filtres et stratégie générés automatiquement' },
                    { icon: Clock, text: 'Prêt à sourcer en 2 minutes' },
                  ].map((item, i) => (
                    <motion.li
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.6 + i * 0.1, duration: 0.3 }}
                      className="flex items-start gap-2.5"
                    >
                      <div className="w-5 h-5 border border-foreground/20 flex items-center justify-center shrink-0 mt-0.5">
                        <item.icon className="w-3 h-3 text-muted-foreground" />
                      </div>
                      <span className="text-xs text-foreground/80 leading-relaxed">{item.text}</span>
                    </motion.li>
                  ))}
                </ul>

                <ShimmerButton
                  onClick={onCreateAI}
                  className="w-full h-[44px] text-xs"
                  shimmerDuration="2s"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  Commencer le brief IA
                </ShimmerButton>
              </div>
            </div>
          </TiltCard>
        </motion.div>

        {/* Card Manual */}
        <motion.div
          initial={{ opacity: 0, x: 30, rotateY: 5 }}
          animate={{ opacity: 1, x: 0, rotateY: 0 }}
          transition={{ delay: 0.5, duration: 0.6, ease: 'easeOut' }}
        >
          <TiltCard
            tiltAmount={8}
            scale={1.03}
            className="h-full"
          >
            <div className="relative border border-foreground bg-background p-6 sm:p-8 overflow-hidden h-full">
              {/* Subtle glow */}
              <Glow variant="top-left" color="hsl(var(--muted-foreground))" size="sm" />

              <div className="relative z-10">
                <div className="flex items-center gap-3 mb-5">
                  <motion.div
                    className="w-11 h-11 border border-foreground text-foreground flex items-center justify-center shrink-0"
                    whileHover={{ rotate: [0, -10, 10, 0] }}
                    transition={{ duration: 0.5 }}
                  >
                    <Pencil className="w-5 h-5" />
                  </motion.div>
                  <div>
                    <h3 className="text-sm font-black uppercase tracking-wider text-foreground">
                      Créer manuellement
                    </h3>
                    <span className="text-[10px] text-muted-foreground font-bold uppercase tracking-widest">
                      Pour experts
                    </span>
                  </div>
                </div>

                <ul className="space-y-3.5 mb-7">
                  {[
                    { icon: Settings2, text: 'Contrôle total sur chaque paramètre' },
                    { icon: Upload, text: 'Importez depuis une URL ou un fichier' },
                    { icon: Zap, text: 'Pour les recruteurs expérimentés' },
                  ].map((item, i) => (
                    <motion.li
                      key={i}
                      initial={{ opacity: 0, x: -10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: 0.7 + i * 0.1, duration: 0.3 }}
                      className="flex items-start gap-2.5"
                    >
                      <div className="w-5 h-5 border border-foreground/20 flex items-center justify-center shrink-0 mt-0.5">
                        <item.icon className="w-3 h-3 text-muted-foreground" />
                      </div>
                      <span className="text-xs text-foreground/80 leading-relaxed">{item.text}</span>
                    </motion.li>
                  ))}
                </ul>

                <button
                  onClick={onCreateManual}
                  className="relative overflow-hidden w-full h-[44px] text-xs font-bold uppercase tracking-wider border border-foreground bg-background text-foreground group/btn transition-all duration-200 hover:shadow-[4px_4px_0px_0px_hsl(var(--foreground))]"
                >
                  <span className="relative z-10 flex items-center justify-center gap-2">
                    <Pencil className="w-3.5 h-3.5" />
                    Création manuelle
                  </span>
                  <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover/btn:translate-y-0 transition-transform duration-300 ease-out" />
                </button>
              </div>
            </div>
          </TiltCard>
        </motion.div>
      </div>

      {/* Bottom trust signal */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 1, duration: 0.5 }}
        className="mt-10 text-center"
      >
        <p className="text-[10px] text-muted-foreground/50 uppercase tracking-widest">
          ✨ L'IA analyse votre brief et génère une stratégie de sourcing personnalisée
        </p>
      </motion.div>
    </motion.div>
  );
};

import React from 'react';
import { MessageSquare, Mail, Zap, Crown } from 'lucide-react';
import { cn } from '@/lib/utils';
import { motion } from 'framer-motion';

interface OutreachOption {
  emoji: string;
  icon: React.ElementType;
  title: string;
  description: string;
  recommended?: boolean;
  onClick: () => void;
}

interface OutreachEmptyStateProps {
  goCount?: number;
  onLinkedInMessage: () => void;
  onInMail: () => void;
  onSequence: () => void;
}

export const OutreachEmptyState: React.FC<OutreachEmptyStateProps> = ({
  goCount = 0,
  onLinkedInMessage,
  onInMail,
  onSequence,
}) => {
  const showRecommended = goCount > 10;

  const options: OutreachOption[] = [
    {
      emoji: '💬',
      icon: MessageSquare,
      title: 'Message LinkedIn',
      description: 'Envoyez un message personnalisé à vos connexions de 1er degré.',
      onClick: onLinkedInMessage,
    },
    {
      emoji: '📧',
      icon: Mail,
      title: 'InMail',
      description: 'Contactez n\'importe qui, même sans connexion. Nécessite LinkedIn Premium.',
      onClick: onInMail,
    },
    {
      emoji: '📋',
      icon: Zap,
      title: 'Séquence multicanal',
      description: 'Automatisez visite → invitation → message → relance sur plusieurs jours.',
      recommended: showRecommended,
      onClick: onSequence,
    },
  ];

  return (
    <div className="flex flex-col items-center py-10 px-4">
      {/* Illustration */}
      <motion.div
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: 0.4, ease: 'easeOut' }}
        className="w-16 h-16 bg-foreground text-background flex items-center justify-center text-2xl mb-5"
      >
        ✉️
      </motion.div>

      <motion.h2
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.1, duration: 0.3 }}
        className="text-base font-bold uppercase tracking-wider text-foreground mb-2"
      >
        Contactez vos meilleurs candidats
      </motion.h2>

      <motion.p
        initial={{ y: 10, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ delay: 0.15, duration: 0.3 }}
        className="text-xs text-muted-foreground max-w-lg text-center mb-8"
      >
        Choisissez comment approcher vos candidats. L'IA personnalise chaque message selon le profil et le poste.
      </motion.p>

      {/* Cards grid */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-2xl">
        {options.map((opt, idx) => {
          const Icon = opt.icon;
          return (
            <motion.button
              key={opt.title}
              initial={{ y: 20, opacity: 0 }}
              animate={{ y: 0, opacity: 1 }}
              transition={{ delay: 0.2 + idx * 0.08, duration: 0.3 }}
              onClick={opt.onClick}
              className={cn(
                "relative group text-left border border-foreground bg-background p-4 transition-all duration-200",
                "hover:shadow-[4px_4px_0px_0px_hsl(var(--foreground))]",
                "hover:-translate-x-0.5 hover:-translate-y-0.5",
              )}
            >
              {opt.recommended && (
                <span className="absolute -top-2.5 right-2 flex items-center gap-1 px-2 py-0.5 bg-brutal-accent text-foreground text-[9px] font-bold uppercase tracking-wider border border-foreground">
                  <Crown className="w-2.5 h-2.5" />
                  Recommandé
                </span>
              )}

              <div className="flex items-center gap-2 mb-2">
                <span className="text-lg">{opt.emoji}</span>
                <Icon className="w-4 h-4 text-foreground" />
              </div>

              <h3 className="text-xs font-bold uppercase tracking-wider text-foreground mb-1">
                {opt.title}
              </h3>
              <p className="text-[10px] text-muted-foreground leading-relaxed">
                {opt.description}
              </p>

              {/* Hover accent fill */}
              <span className="absolute inset-0 bg-brutal-accent/10 opacity-0 group-hover:opacity-100 transition-opacity duration-200 pointer-events-none" />
            </motion.button>
          );
        })}
      </div>

      {goCount > 0 && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.5 }}
          className="mt-6 text-[10px] text-muted-foreground uppercase tracking-wider"
        >
          {goCount} candidat{goCount > 1 ? 's' : ''} scoré{goCount > 1 ? 's' : ''} 🟢 Go — prêts à être contactés
        </motion.p>
      )}
    </div>
  );
};

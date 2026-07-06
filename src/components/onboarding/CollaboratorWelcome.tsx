import React from 'react';
import { motion } from 'framer-motion';
import { Building2, ArrowRight, Clock } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface Props {
  orgName: string;
  onCreateWorkspace: () => void;
  onSkip: () => void;
}

export const CollaboratorWelcome: React.FC<Props> = ({ orgName, onCreateWorkspace, onSkip }) => {
  return (
    <div className="min-h-screen flex items-center justify-center bg-background px-4">
      <div className="w-full max-w-md flex flex-col items-center text-center gap-6">
        {/* Icon */}
        <motion.div
          className="w-16 h-16 bg-foreground text-background flex items-center justify-center"
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.4 }}
          style={{ boxShadow: '0 4px 16px hsl(var(--primary) / 0.15)' }}
        >
          <Building2 className="w-7 h-7" />
        </motion.div>

        {/* Title */}
        <motion.div
          className="space-y-2"
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.15, duration: 0.4 }}
        >
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight leading-tight">
            Vous avez rejoint{' '}
            <span className="skalr-gradient-text">{orgName}</span>
          </h1>
          <p className="text-muted-foreground text-sm">
            en tant que collaborateur externe.
          </p>
        </motion.div>

        {/* Question */}
        <motion.p
          className="text-foreground/80 text-sm"
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.3, duration: 0.4 }}
        >
          Souhaitez-vous aussi créer votre propre espace de travail ?
        </motion.p>

        {/* Actions */}
        <motion.div
          className="flex flex-col sm:flex-row gap-3 w-full"
          initial={{ y: 10, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          transition={{ delay: 0.4, duration: 0.4 }}
        >
          <Button
            onClick={onCreateWorkspace}
            className="flex-1 gap-2 border border-border bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
            style={{ boxShadow: '0 4px 16px hsl(var(--primary) / 0.15)' }}
          >
            Créer mon espace <ArrowRight className="w-4 h-4" />
          </Button>
          <Button
            onClick={onSkip}
            variant="outline"
            className="flex-1 gap-2 border border-border text-sm"
          >
            <Clock className="w-4 h-4" /> Plus tard
          </Button>
        </motion.div>
      </div>
    </div>
  );
};

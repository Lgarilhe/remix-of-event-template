import React from 'react';
import { motion } from 'framer-motion';
import { Link } from 'react-router-dom';
import { Check, Rocket, ArrowUpRight, Circle } from 'lucide-react';
import { NumberTicker } from '@/components/magicui/number-ticker';
import { ConfettiBurst } from './ConfettiBurst';

export interface LaunchChecklistItem {
  key: string;
  label: string;
  done: boolean;
  /** Lien Réglages pour terminer plus tard (affiché si non fait) */
  settingsPath?: string;
}

interface Props {
  items: LaunchChecklistItem[];
  scorePercent: number;
  orgName?: string;
  onFinish: () => void;
}

export const SceneLaunch: React.FC<Props> = ({ items, scorePercent, orgName, onFinish }) => {
  const isHighScore = scorePercent >= 70;
  const circumference = 2 * Math.PI * 44;
  const strokeDashoffset = circumference - (scorePercent / 100) * circumference;
  const doneCount = items.filter((i) => i.done).length;
  const remaining = items.filter((i) => !i.done);

  return (
    <div className="flex flex-col items-center gap-6 w-full max-w-lg px-2">
      <ConfettiBurst />

      {/* Score ring */}
      <motion.div
        initial={{ scale: 0.5, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 18 }}
        className="relative flex items-center justify-center w-32 h-32"
      >
        <svg width="128" height="128" viewBox="0 0 100 100" className="absolute inset-0 rotate-[-90deg]">
          <circle cx="50" cy="50" r="44" fill="none" stroke="hsl(var(--foreground) / 0.08)" strokeWidth="3" />
          <motion.circle
            cx="50" cy="50" r="44" fill="none"
            stroke="hsl(var(--success))" strokeWidth="3" strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 1.4, ease: [0.22, 1, 0.36, 1], delay: 0.3 }}
          />
        </svg>
        <div className="text-center">
          <span
            className="text-3xl font-bold text-foreground tabular-nums"
            style={{ fontFamily: "'Space Mono', monospace" }}
          >
            <NumberTicker value={scorePercent} delay={0.4} />%
          </span>
          <span
            className="block text-3xs uppercase tracking-wider text-muted-foreground"
            style={{ fontFamily: "'Space Mono', monospace" }}
          >
            configuré
          </span>
        </div>
      </motion.div>

      {/* Titre */}
      <div className="text-center space-y-1.5">
        <motion.h1
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25 }}
          className="font-editorial font-normal italic text-4xl md:text-5xl leading-[1.08] text-foreground"
        >
          {isHighScore ? 'Configuration parfaite.' : 'Votre espace est prêt.'}
        </motion.h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="text-sm text-muted-foreground"
        >
          {orgName ? `${orgName} est prêt à sourcer.` : 'Tout est en place pour votre premier sourcing.'}{' '}
          {doneCount}/{items.length} éléments configurés.
        </motion.p>
      </div>

      {/* Récap checklist */}
      <div className="w-full divide-y divide-border/40">
        {items.map((item, i) => (
          <motion.div
            key={item.key}
            initial={{ opacity: 0, x: -14 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ delay: 0.5 + i * 0.08, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            className="flex items-center gap-3 py-2.5"
          >
            {item.done ? (
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ delay: 0.6 + i * 0.08, type: 'spring', stiffness: 400, damping: 18 }}
                className="w-5 h-5 flex items-center justify-center shrink-0 rounded-md bg-success/15 text-success"
              >
                <Check className="w-3 h-3" strokeWidth={3.5} />
              </motion.span>
            ) : (
              <span className="w-5 h-5 flex items-center justify-center shrink-0 text-muted-foreground/40">
                <Circle className="w-3 h-3" />
              </span>
            )}
            <span className={`flex-1 text-sm ${item.done ? 'text-foreground' : 'text-muted-foreground'}`}>
              {item.label}
            </span>
            {!item.done && item.settingsPath && (
              <Link
                to={item.settingsPath}
                className="inline-flex items-center gap-0.5 text-2xs font-semibold text-muted-foreground hover:text-foreground underline-offset-2 hover:underline shrink-0"
              >
                Terminer plus tard <ArrowUpRight className="w-3 h-3" />
              </Link>
            )}
          </motion.div>
        ))}
      </div>

      {remaining.length > 0 && (
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.9 }}
          className="text-xs text-muted-foreground text-center -mt-2"
        >
          Pas d’inquiétude : tout se termine en 2 clics depuis les Réglages.
        </motion.p>
      )}

      {/* CTA */}
      <motion.button
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.8 }}
        whileHover={{ scale: 1.02, y: -1 }}
        whileTap={{ scale: 0.97 }}
        onClick={onFinish}
        className="konekt-shine relative w-full py-3 rounded-lg text-sm font-semibold flex items-center justify-center gap-2 overflow-hidden bg-foreground text-background hover:bg-foreground/90 transition-colors"
      >
        <Rocket className="w-4 h-4" />
        Lancer Konekt
      </motion.button>
    </div>
  );
};

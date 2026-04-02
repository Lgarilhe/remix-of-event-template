import React from 'react';
import { motion } from 'framer-motion';
import { Check, Rocket, Circle } from 'lucide-react';
import trophyImg from '@/assets/illust-trophy.webp';

interface Props {
  completedSet: Set<number>;
  totalSteps: number;
  onFinish: () => void;
}

const CHECKLIST = [
  { step: 0, label: 'Bienvenue' },
  { step: 1, label: 'Organisation créée' },
  { step: 2, label: 'Audit configuré' },
  { step: 3, label: 'Profil complété' },
  { step: 4, label: 'Outils connectés' },
  { step: 5, label: 'Équipe invitée' },
];

const ECOSYSTEM = [
  { name: 'Skalr', emoji: '🧠', desc: 'Stratégie', active: true },
  { name: 'App Skalr', emoji: '⚡', desc: 'Outreach IA', active: true },
  { name: 'Skalr RPO', emoji: '🤝', desc: 'Renfort', active: false },
];

export const SceneLaunch: React.FC<Props> = ({ completedSet, totalSteps, onFinish }) => {
  const scorePercent = Math.round((completedSet.size / totalSteps) * 100);
  const isHighScore = scorePercent >= 60;
  const circumference = 2 * Math.PI * 40;
  const strokeDashoffset = circumference - (scorePercent / 100) * circumference;

  return (
    <div className="flex flex-col items-center gap-6 w-full px-2">
      {/* Label */}
      <motion.span
        initial={{ opacity: 0, y: -10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-xs tracking-[0.2em] text-muted-foreground uppercase"
        style={{ fontFamily: "'Space Mono', monospace" }}
      >
        06 — C'EST PARTI
      </motion.span>

      {/* Trophy + Score ring */}
      <motion.div
        initial={{ scale: 0.6, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ type: 'spring', stiffness: 200, damping: 18 }}
        className="relative flex items-center justify-center"
      >
        <img src={trophyImg} alt="" aria-hidden="true" className="w-20 h-20 object-contain relative z-10" />
        <svg
          width="100"
          height="100"
          viewBox="0 0 100 100"
          className="absolute inset-0 rotate-[-90deg]"
        >
          <defs>
            <linearGradient id="launch-grad" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="hsl(var(--skalr-purple))" />
              <stop offset="100%" stopColor="hsl(var(--skalr-pink))" />
            </linearGradient>
          </defs>
          <circle cx="50" cy="50" r="40" fill="none" stroke="hsl(var(--foreground) / 0.08)" strokeWidth="3" />
          <motion.circle
            cx="50" cy="50" r="40" fill="none"
            stroke="url(#launch-grad)" strokeWidth="3" strokeLinecap="round"
            strokeDasharray={circumference}
            initial={{ strokeDashoffset: circumference }}
            animate={{ strokeDashoffset }}
            transition={{ duration: 1.2, ease: 'easeOut', delay: 0.3 }}
          />
        </svg>
        <motion.span
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.8 }}
          className="absolute -bottom-1 text-xs font-bold text-foreground/70"
          style={{ fontFamily: "'Space Mono', monospace" }}
        >
          {scorePercent}%
        </motion.span>
      </motion.div>

      {/* Title */}
      <motion.h1
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="text-3xl text-center text-foreground"
        style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic' }}
      >
        {isHighScore ? 'Parfait, on y va !' : 'Tout est prêt'}
      </motion.h1>

      {/* Checklist */}
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.35 }}
        className="flex flex-wrap justify-center gap-2"
      >
        {CHECKLIST.map((item) => {
          const done = completedSet.has(item.step);
          return (
            <span
              key={item.step}
              className={`inline-flex items-center gap-1.5 text-xs px-3 py-1.5 border-2 ${
                done
                  ? 'border-[hsl(var(--skalr-green))] bg-[hsl(var(--skalr-green)/0.1)] text-[hsl(var(--skalr-green))]'
                  : 'border-border text-muted-foreground'
              }`}
              style={{ fontFamily: "'Space Mono', monospace" }}
            >
              {done ? <Check className="w-3 h-3" /> : <Circle className="w-3 h-3" />}
              {item.label}
            </span>
          );
        })}
      </motion.div>

      {/* Ecosystem card */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.5 }}
        className="w-full border-2 border-border bg-card p-5"
        style={{
          boxShadow: '0 4px 20px hsl(var(--skalr-purple) / 0.2), 0 0 40px hsl(var(--skalr-purple) / 0.05)',
        }}
      >
        <p
          className="text-xs tracking-[0.15em] text-muted-foreground uppercase mb-4 text-center"
          style={{ fontFamily: "'Space Mono', monospace" }}
        >
          VOTRE ÉCOSYSTÈME
        </p>

        <div className="grid grid-cols-3 gap-3 mb-4">
          {ECOSYSTEM.map((eco) => (
            <div
              key={eco.name}
              className="flex flex-col items-center gap-1.5 p-3 border border-border bg-muted/30 relative"
            >
              <span className="text-2xl">{eco.emoji}</span>
              <span className="text-xs font-semibold text-foreground">{eco.name}</span>
              <span className="text-xs text-muted-foreground">{eco.desc}</span>
              {eco.active && (
                <span
                  className="absolute -top-2 -right-2 text-xs font-bold px-1.5 py-0.5 bg-[hsl(var(--landing-accent-yellow))] text-foreground border border-border"
                  style={{ fontFamily: "'Space Mono', monospace" }}
                >
                  ACTIF
                </span>
              )}
            </div>
          ))}
        </div>

        <p
          className="text-center text-sm text-muted-foreground"
          style={{ fontFamily: "'Instrument Serif', serif", fontStyle: 'italic' }}
        >
          Stratégie + Tech + Exécution — personne d'autre ne fait les 3
        </p>
      </motion.div>

      {/* Launch button */}
      <motion.button
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.7 }}
        whileHover={{ scale: 1.02 }}
        whileTap={{ scale: 0.97 }}
        onClick={onFinish}
        className="w-full py-3.5 text-sm font-bold tracking-wider uppercase border-2 border-border flex items-center justify-center gap-2"
        style={{
          fontFamily: "'Space Mono', monospace",
          background: 'hsl(var(--landing-accent-yellow))',
          color: 'hsl(var(--foreground))',
          boxShadow: '0 4px 16px hsl(var(--foreground) / 0.1)',
        }}
      >
        <Rocket className="w-4 h-4" />
        Lancer Skalr
      </motion.button>
    </div>
  );
};

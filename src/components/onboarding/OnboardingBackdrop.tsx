import React from 'react';
import { motion, useReducedMotion } from 'framer-motion';

/**
 * Grain SVG inline (feTurbulence) encodé en data-URI — texture de fond
 * sans requête réseau ni dépendance.
 */
const NOISE_DATA_URI =
  "url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='160' height='160'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.55'/%3E%3C/svg%3E\")";

interface BlobDef {
  size: number;
  color: string;
  alpha: number;
  initial: { top: string; left: string };
  drift: { x: number[]; y: number[]; scale: number[] };
  duration: number;
}

// Palette sobre alignée sur le reste de l'app : lueurs neutres + un souffle
// d'émeraude (accent unique de la sidebar). Pas d'arc-en-ciel.
const BLOBS: BlobDef[] = [
  {
    size: 640,
    color: '--foreground',
    alpha: 0.045,
    initial: { top: '-12%', left: '-8%' },
    drift: { x: [0, 90, -40, 0], y: [0, 50, 110, 0], scale: [1, 1.15, 0.95, 1] },
    duration: 46,
  },
  {
    size: 560,
    color: '--success',
    alpha: 0.05,
    initial: { top: '55%', left: '68%' },
    drift: { x: [0, -110, 40, 0], y: [0, -60, -130, 0], scale: [1, 0.9, 1.12, 1] },
    duration: 52,
  },
  {
    size: 460,
    color: '--foreground',
    alpha: 0.035,
    initial: { top: '68%', left: '-6%' },
    drift: { x: [0, 120, 60, 0], y: [0, -90, -30, 0], scale: [1, 1.1, 0.92, 1] },
    duration: 58,
  },
];

/**
 * Fond immersif de l'onboarding : mesh gradient animé + grille + grain + vignette.
 * Purement décoratif (aria-hidden, pointer-events-none), respecte prefers-reduced-motion.
 */
export const OnboardingBackdrop: React.FC = () => {
  const reduceMotion = useReducedMotion();

  return (
    <div className="fixed inset-0 overflow-hidden pointer-events-none" aria-hidden="true">
      {/* Blobs mesh gradient */}
      {BLOBS.map((blob, i) => (
        <motion.div
          key={i}
          className="absolute rounded-full"
          style={{
            width: blob.size,
            height: blob.size,
            top: blob.initial.top,
            left: blob.initial.left,
            background: `radial-gradient(circle, hsl(var(${blob.color}) / ${blob.alpha}) 0%, transparent 68%)`,
            filter: 'blur(48px)',
            willChange: 'transform',
          }}
          animate={reduceMotion ? undefined : { x: blob.drift.x, y: blob.drift.y, scale: blob.drift.scale }}
          transition={{ duration: blob.duration, repeat: Infinity, ease: 'easeInOut' }}
        />
      ))}

      {/* Grille subtile */}
      <div
        className="absolute inset-0"
        style={{
          backgroundImage:
            'linear-gradient(hsl(var(--foreground) / 0.025) 1px, transparent 1px), linear-gradient(90deg, hsl(var(--foreground) / 0.025) 1px, transparent 1px)',
          backgroundSize: '56px 56px',
          maskImage: 'radial-gradient(ellipse 90% 80% at 50% 30%, black 0%, transparent 100%)',
          WebkitMaskImage: 'radial-gradient(ellipse 90% 80% at 50% 30%, black 0%, transparent 100%)',
        }}
      />

      {/* Grain */}
      <div
        className="absolute inset-0 mix-blend-overlay"
        style={{ backgroundImage: NOISE_DATA_URI, opacity: 0.5 }}
      />

      {/* Vignette */}
      <div
        className="absolute inset-0"
        style={{ background: 'radial-gradient(ellipse 120% 100% at 50% 40%, transparent 55%, hsl(var(--background) / 0.7) 100%)' }}
      />
    </div>
  );
};

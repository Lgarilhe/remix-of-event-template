import React, { useEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  color: string;
  rotation: number;
  rotationSpeed: number;
  shape: 'rect' | 'circle';
  drag: number;
}

const COLORS = [
  'hsl(271 81% 56%)', // skalr-purple
  'hsl(330 81% 60%)', // skalr-pink
  'hsl(217 91% 60%)', // skalr-blue
  'hsl(187 85% 53%)', // skalr-cyan
  'hsl(142 71% 45%)', // skalr-green
  'hsl(50 100% 60%)', // accent-yellow
];

const GRAVITY = 0.18;
const DURATION_MS = 3200;
const PARTICLES_PER_CANNON = 70;

function spawnCannon(particles: Particle[], originX: number, originY: number, angleBase: number) {
  for (let i = 0; i < PARTICLES_PER_CANNON; i++) {
    const angle = angleBase + (Math.random() - 0.5) * (Math.PI / 3);
    const speed = 7 + Math.random() * 9;
    particles.push({
      x: originX,
      y: originY,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 4 + Math.random() * 6,
      color: COLORS[Math.floor(Math.random() * COLORS.length)],
      rotation: Math.random() * Math.PI * 2,
      rotationSpeed: (Math.random() - 0.5) * 0.3,
      shape: Math.random() > 0.35 ? 'rect' : 'circle',
      drag: 0.985 + Math.random() * 0.01,
    });
  }
}

/**
 * Explosion de confettis en canvas plein écran — deux canons latéraux + un central.
 * Se joue une fois au montage puis se nettoie. Inerte si prefers-reduced-motion.
 */
export const ConfettiBurst: React.FC = () => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const w = window.innerWidth;
    const h = window.innerHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.scale(dpr, dpr);

    const particles: Particle[] = [];
    spawnCannon(particles, w * 0.08, h * 0.85, -Math.PI / 3);        // canon gauche
    spawnCannon(particles, w * 0.92, h * 0.85, -Math.PI + Math.PI / 3); // canon droit
    spawnCannon(particles, w * 0.5, h * 0.75, -Math.PI / 2);         // canon central

    const start = performance.now();
    let raf = 0;

    const tick = (now: number) => {
      const elapsed = now - start;
      ctx.clearRect(0, 0, w, h);
      const fade = Math.max(0, 1 - elapsed / DURATION_MS);

      for (const p of particles) {
        p.vx *= p.drag;
        p.vy = p.vy * p.drag + GRAVITY;
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.rotationSpeed;

        ctx.save();
        ctx.globalAlpha = fade;
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rotation);
        ctx.fillStyle = p.color;
        if (p.shape === 'rect') {
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        } else {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2.5, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      if (elapsed < DURATION_MS) {
        raf = requestAnimationFrame(tick);
      } else {
        ctx.clearRect(0, 0, w, h);
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduceMotion]);

  if (reduceMotion) return null;

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 z-50 pointer-events-none"
      style={{ width: '100vw', height: '100vh' }}
      aria-hidden="true"
    />
  );
};

import React, { useEffect, useRef } from 'react';
import { useReducedMotion } from 'framer-motion';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  rot: number;
  vr: number;
  color: string;
  shape: 'rect' | 'dot';
  life: number;
}

// Palette du kit d'illustrations : bleu-vert, crème, kraft, encre.
const COLORS = ['#7fbdbc', '#387071', '#f3ead8', '#d9b98a', '#efe3c8', '#2b3a3a'];

/**
 * Salve de papiers découpés, jouée une fois à l'arrivée sur la dernière scène.
 * Canvas plein écran, transparent aux clics, arrêté dès que tout est tombé.
 * Rien avec le mouvement réduit.
 */
export const Confetti: React.FC<{ fire: boolean; originX?: number; originY?: number }> = ({ fire, originX = 0.5, originY = 0.42 }) => {
  const reduced = useReducedMotion();
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!fire || reduced) return;
    const canvas = ref.current;
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) return;

    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    };
    resize();

    const ox = window.innerWidth * originX;
    const oy = window.innerHeight * originY;
    const particles: Particle[] = Array.from({ length: 150 }, () => {
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * Math.PI * 1.15;
      const speed = 6 + Math.random() * 11;
      return {
        x: ox,
        y: oy,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        size: 5 + Math.random() * 7,
        rot: Math.random() * Math.PI * 2,
        vr: (Math.random() - 0.5) * 0.35,
        color: COLORS[Math.floor(Math.random() * COLORS.length)],
        shape: Math.random() > 0.72 ? 'dot' : 'rect',
        life: 0,
      };
    });

    let raf = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const dt = Math.min((now - last) / 16.67, 2);
      last = now;
      ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
      let alive = 0;
      for (const p of particles) {
        p.life += dt;
        p.vy += 0.34 * dt;
        p.vx *= 0.992;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        if (p.y < window.innerHeight + 30) alive += 1;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.globalAlpha = Math.max(0, 1 - Math.max(0, p.life - 90) / 60);
        ctx.fillStyle = p.color;
        if (p.shape === 'dot') {
          ctx.beginPath();
          ctx.arc(0, 0, p.size / 2, 0, Math.PI * 2);
          ctx.fill();
        } else {
          ctx.fillRect(-p.size / 2, -p.size / 3, p.size, p.size * 0.66);
        }
        ctx.restore();
      }
      if (alive > 0 && particles[0].life < 200) raf = requestAnimationFrame(tick);
      else ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);
    };
    raf = requestAnimationFrame(tick);
    window.addEventListener('resize', resize);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
    };
  }, [fire, reduced, originX, originY]);

  return <canvas ref={ref} aria-hidden="true" className="pointer-events-none fixed inset-0 z-toast h-full w-full" />;
};

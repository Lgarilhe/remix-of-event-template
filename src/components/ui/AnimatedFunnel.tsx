import React, { useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface AnimatedFunnelProps {
  size?: number;
  speed?: number;
  className?: string;
}

const SKALR_COLORS: [number, number, number][] = [
  [124, 58, 237],   // purple
  [236, 72, 153],   // pink
  [59, 130, 246],   // blue
  [225, 112, 255],  // magenta
];

export const AnimatedFunnel: React.FC<AnimatedFunnelProps> = ({
  size = 40,
  speed = 1,
  className,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const animRef = useRef<number>(0);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const ctx = canvas.getContext('2d', { alpha: true });
    if (!ctx) return;

    const dpr = window.devicePixelRatio || 1;
    const w = size * dpr;
    const h = size * dpr;
    canvas.width = w;
    canvas.height = h;

    const cx = w / 2;
    let t = 0;

    const isDark = !document.documentElement.classList.contains('light');

    // Particles flowing through funnel
    interface Particle { x: number; y: number; vy: number; r: number; color: number; opacity: number; }
    const particles: Particle[] = [];

    function spawnParticle() {
      particles.push({
        x: cx + (Math.random() - 0.5) * w * 0.7,
        y: h * 0.08,
        vy: (0.3 + Math.random() * 0.5) * dpr * speed,
        r: (1.5 + Math.random() * 2) * dpr,
        color: Math.floor(Math.random() * 4),
        opacity: 0.6 + Math.random() * 0.4,
      });
    }

    function frame() {
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      // Outer glow
      const glowGrad = ctx.createRadialGradient(cx, h * 0.4, 0, cx, h * 0.4, w * 0.5);
      glowGrad.addColorStop(0, `rgba(${SKALR_COLORS[0][0]},${SKALR_COLORS[0][1]},${SKALR_COLORS[0][2]},0.15)`);
      glowGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = glowGrad;
      ctx.fillRect(0, 0, w, h);

      // Funnel shape
      const topY = h * 0.2;
      const botY = h * 0.85;
      const topW = w * 0.42;
      const botW = w * 0.08;
      const neckY = h * 0.6;

      ctx.beginPath();
      ctx.moveTo(cx - topW, topY);
      ctx.bezierCurveTo(cx - topW, topY, cx - botW * 1.5, neckY, cx - botW, botY);
      ctx.lineTo(cx + botW, botY);
      ctx.bezierCurveTo(cx + botW * 1.5, neckY, cx + topW, topY, cx + topW, topY);
      ctx.closePath();

      ctx.fillStyle = isDark ? 'rgba(15,15,20,0.9)' : 'rgba(255,255,255,0.95)';
      ctx.fill();

      // Border gradient
      ctx.lineWidth = 2.5 * dpr;
      const strokeGrad = ctx.createLinearGradient(cx, topY, cx, botY);
      strokeGrad.addColorStop(0, `rgba(${SKALR_COLORS[2][0]},${SKALR_COLORS[2][1]},${SKALR_COLORS[2][2]},0.9)`);
      strokeGrad.addColorStop(0.5, `rgba(${SKALR_COLORS[0][0]},${SKALR_COLORS[0][1]},${SKALR_COLORS[0][2]},1)`);
      strokeGrad.addColorStop(1, `rgba(${SKALR_COLORS[1][0]},${SKALR_COLORS[1][1]},${SKALR_COLORS[1][2]},0.9)`);
      ctx.strokeStyle = strokeGrad;
      ctx.stroke();

      // Clip for particles
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(cx - topW + 2 * dpr, topY);
      ctx.bezierCurveTo(cx - topW, topY, cx - botW * 1.5, neckY, cx - botW, botY);
      ctx.lineTo(cx + botW, botY);
      ctx.bezierCurveTo(cx + botW * 1.5, neckY, cx + topW, topY, cx + topW - 2 * dpr, topY);
      ctx.closePath();
      ctx.clip();

      // Spawn particles
      if (Math.random() < 0.3 * speed) spawnParticle();

      // Update & draw particles
      for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.y += p.vy;

        // Converge toward center as y increases
        const progress = (p.y - topY) / (botY - topY);
        const funnelWidthAtY = topW * (1 - progress) + botW * progress;
        p.x += (cx - p.x) * 0.03;

        // Constrain
        if (p.x < cx - funnelWidthAtY) p.x = cx - funnelWidthAtY;
        if (p.x > cx + funnelWidthAtY) p.x = cx + funnelWidthAtY;

        if (p.y > botY + 5 * dpr) {
          particles.splice(i, 1);
          continue;
        }

        const c = SKALR_COLORS[p.color];
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${p.opacity * (1 - progress * 0.3)})`;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (1 - progress * 0.4), 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

      // Drip glow at bottom
      const dripPulse = (Math.sin(t * 3 * speed) + 1) / 2;
      const dripGrad = ctx.createRadialGradient(cx, botY, 0, cx, botY, botW * 3);
      dripGrad.addColorStop(0, `rgba(${SKALR_COLORS[1][0]},${SKALR_COLORS[1][1]},${SKALR_COLORS[1][2]},${0.3 + dripPulse * 0.2})`);
      dripGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = dripGrad;
      ctx.beginPath();
      ctx.arc(cx, botY, botW * 3, 0, Math.PI * 2);
      ctx.fill();

      t += 0.02;
      animRef.current = requestAnimationFrame(frame);
    }

    animRef.current = requestAnimationFrame(frame);
    return () => { cancelAnimationFrame(animRef.current); particles.length = 0; };
  }, [size, speed]);

  return (
    <canvas
      ref={canvasRef}
      className={cn('shrink-0', className)}
      style={{ width: size, height: size }}
    />
  );
};

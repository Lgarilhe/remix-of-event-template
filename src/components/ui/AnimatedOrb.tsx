import React, { useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface AnimatedOrbProps {
  /** Content inside the orb — ignored, kept for compat */
  children?: React.ReactNode;
  /** Size in px — defaults to 40 */
  size?: number;
  /** Animation speed multiplier — defaults to 1 */
  speed?: number;
  /** Additional className on the wrapper */
  className?: string;
}

const SKALR_COLORS: [number, number, number][] = [
  [124, 58, 237],   // purple
  [236, 72, 153],   // pink
  [59, 130, 246],   // blue
  [225, 112, 255],  // magenta/brutal-accent
];

export const AnimatedOrb: React.FC<AnimatedOrbProps> = ({
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
    const cy = h / 2;

    let t = 0;
    let blink = 0;
    let blinkT = 0;
    let lookX = 0;
    let lookY = 0;
    let targetX = 0;
    let targetY = 0;
    let nextLook = 120;

    const isDark = document.documentElement.classList.contains('dark');

    function frame() {
      if (!ctx) return;

      ctx.fillStyle = `rgb(${bg[0]},${bg[1]},${bg[2]})`;
      ctx.fillRect(0, 0, w, h);

      nextLook--;
      if (nextLook <= 0) {
        if (Math.random() < 0.15) {
          blink = 1;
          blinkT = 0;
        }
        targetX = (Math.random() - 0.5) * 6 * dpr;
        targetY = (Math.random() - 0.5) * 3 * dpr;
        nextLook = 80 + Math.random() * 200;
      }
      lookX += (targetX - lookX) * 0.06;
      lookY += (targetY - lookY) * 0.06;

      if (blink) {
        blinkT += 0.12 * speed;
        if (blinkT > 1) { blink = 0; blinkT = 0; }
      }
      const blinkY = blink ? Math.sin(blinkT * Math.PI) : 0;

      // Ambient glow
      const outerR = w * 0.38;
      const grad = ctx.createRadialGradient(cx, cy, outerR * 0.3, cx, cy, outerR);
      grad.addColorStop(0, `rgba(${SKALR_COLORS[0][0]},${SKALR_COLORS[0][1]},${SKALR_COLORS[0][2]},0.08)`);
      grad.addColorStop(1, `rgba(${SKALR_COLORS[0][0]},${SKALR_COLORS[0][1]},${SKALR_COLORS[0][2]},0)`);
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
      ctx.fill();

      // Eye shape
      const eyeW = w * 0.52;
      const eyeH = w * 0.22;
      const squeeze = 1 - blinkY * 0.95;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, squeeze);

      ctx.beginPath();
      ctx.ellipse(0, 0, eyeW / 2, eyeH / 2, 0, 0, Math.PI * 2);
      ctx.strokeStyle = `rgba(${SKALR_COLORS[0][0]},${SKALR_COLORS[0][1]},${SKALR_COLORS[0][2]},0.7)`;
      ctx.lineWidth = 1.5 * dpr;
      ctx.stroke();
      ctx.clip();

      // Iris
      const irisR = eyeH * 0.52;
      const breath = (Math.sin(t * 1.5 * speed) + 1) / 2;
      const irisGrad = ctx.createRadialGradient(lookX, lookY, 0, lookX, lookY, irisR);
      irisGrad.addColorStop(0, `rgba(${SKALR_COLORS[3][0]},${SKALR_COLORS[3][1]},${SKALR_COLORS[3][2]},${0.9 + breath * 0.1})`);
      irisGrad.addColorStop(0.5, `rgba(${SKALR_COLORS[0][0]},${SKALR_COLORS[0][1]},${SKALR_COLORS[0][2]},0.7)`);
      irisGrad.addColorStop(1, `rgba(${SKALR_COLORS[1][0]},${SKALR_COLORS[1][1]},${SKALR_COLORS[1][2]},0.3)`);
      ctx.fillStyle = irisGrad;
      ctx.beginPath();
      ctx.arc(lookX, lookY, irisR, 0, Math.PI * 2);
      ctx.fill();

      // Pupil
      const pupilR = irisR * 0.35 + breath * irisR * 0.08;
      ctx.fillStyle = isDark ? '#111' : '#0a0a0a';
      ctx.beginPath();
      ctx.arc(lookX, lookY, pupilR, 0, Math.PI * 2);
      ctx.fill();

      // Specular highlight
      const specX = lookX - irisR * 0.25;
      const specY = lookY - irisR * 0.25;
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(specX, specY, pupilR * 0.35, 0, Math.PI * 2);
      ctx.fill();

      ctx.restore();
      t += 0.02;
      animRef.current = requestAnimationFrame(frame);
    }

    animRef.current = requestAnimationFrame(frame);

    return () => {
      cancelAnimationFrame(animRef.current);
    };
  }, [size, speed]);

  return (
    <canvas
      ref={canvasRef}
      className={cn('shrink-0', className)}
      style={{ width: size, height: size }}
    />
  );
};

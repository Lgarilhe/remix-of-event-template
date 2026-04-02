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

    const isDark = !document.documentElement.classList.contains('light');

    function frame() {
      if (!ctx) return;

      ctx.clearRect(0, 0, w, h);

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

      // Outer glow — two layers for more punch
      const outerR = w * 0.48;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerR);
      grad.addColorStop(0, `rgba(${SKALR_COLORS[3][0]},${SKALR_COLORS[3][1]},${SKALR_COLORS[3][2]},0.25)`);
      grad.addColorStop(0.4, `rgba(${SKALR_COLORS[0][0]},${SKALR_COLORS[0][1]},${SKALR_COLORS[0][2]},0.12)`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
      ctx.fill();

      // Eye shape — fills most of the canvas
      const eyeW = w * 0.92;
      const eyeH = w * 0.44;
      const squeeze = 1 - blinkY * 0.95;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, squeeze);

      // Draw almond eye shape using bezier curves
      ctx.beginPath();
      const hw = eyeW / 2;
      const hh = eyeH / 2;
      ctx.moveTo(-hw, 0);
      ctx.bezierCurveTo(-hw * 0.6, -hh * 1.3, hw * 0.6, -hh * 1.3, hw, 0);
      ctx.bezierCurveTo(hw * 0.6, hh * 1.3, -hw * 0.6, hh * 1.3, -hw, 0);
      ctx.closePath();

      // Eye fill
      ctx.fillStyle = isDark ? 'rgba(15,15,20,0.95)' : 'rgba(255,255,255,0.97)';
      ctx.fill();

      // Eye border — gradient stroke
      ctx.lineWidth = 3 * dpr;
      const strokeGrad = ctx.createLinearGradient(-hw, 0, hw, 0);
      strokeGrad.addColorStop(0, `rgba(${SKALR_COLORS[1][0]},${SKALR_COLORS[1][1]},${SKALR_COLORS[1][2]},0.9)`);
      strokeGrad.addColorStop(0.5, `rgba(${SKALR_COLORS[0][0]},${SKALR_COLORS[0][1]},${SKALR_COLORS[0][2]},1)`);
      strokeGrad.addColorStop(1, `rgba(${SKALR_COLORS[3][0]},${SKALR_COLORS[3][1]},${SKALR_COLORS[3][2]},0.9)`);
      ctx.strokeStyle = strokeGrad;
      ctx.stroke();
      ctx.clip();

      // Iris — larger, more vivid
      const irisR = eyeH * 0.82;
      const breath = (Math.sin(t * 1.5 * speed) + 1) / 2;
      const irisGrad = ctx.createRadialGradient(lookX, lookY, 0, lookX, lookY, irisR);
      irisGrad.addColorStop(0, `rgba(${SKALR_COLORS[3][0]},${SKALR_COLORS[3][1]},${SKALR_COLORS[3][2]},1)`);
      irisGrad.addColorStop(0.4, `rgba(${SKALR_COLORS[0][0]},${SKALR_COLORS[0][1]},${SKALR_COLORS[0][2]},0.9)`);
      irisGrad.addColorStop(0.8, `rgba(${SKALR_COLORS[1][0]},${SKALR_COLORS[1][1]},${SKALR_COLORS[1][2]},0.6)`);
      irisGrad.addColorStop(1, `rgba(${SKALR_COLORS[1][0]},${SKALR_COLORS[1][1]},${SKALR_COLORS[1][2]},0.15)`);
      ctx.fillStyle = irisGrad;
      ctx.beginPath();
      ctx.arc(lookX, lookY, irisR, 0, Math.PI * 2);
      ctx.fill();

      // Pupil — deep black, breathing
      const pupilR = irisR * 0.32 + breath * irisR * 0.06;
      ctx.fillStyle = '#050508';
      ctx.beginPath();
      ctx.arc(lookX, lookY, pupilR, 0, Math.PI * 2);
      ctx.fill();

      // Specular highlights — two for depth
      const specX = lookX - irisR * 0.28;
      const specY = lookY - irisR * 0.28;
      ctx.fillStyle = 'rgba(255,255,255,0.85)';
      ctx.beginPath();
      ctx.arc(specX, specY, pupilR * 0.4, 0, Math.PI * 2);
      ctx.fill();

      // Secondary smaller highlight
      ctx.fillStyle = 'rgba(255,255,255,0.5)';
      ctx.beginPath();
      ctx.arc(lookX + irisR * 0.2, lookY + irisR * 0.15, pupilR * 0.18, 0, Math.PI * 2);
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

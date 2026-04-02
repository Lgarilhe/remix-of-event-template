import React, { useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface AnimatedCompassProps {
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

export const AnimatedCompass: React.FC<AnimatedCompassProps> = ({
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

    const isDark = document.documentElement.classList.contains('dark');

    function frame() {
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      // Outer glow
      const outerR = w * 0.48;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerR);
      grad.addColorStop(0, `rgba(${SKALR_COLORS[2][0]},${SKALR_COLORS[2][1]},${SKALR_COLORS[2][2]},0.2)`);
      grad.addColorStop(0.5, `rgba(${SKALR_COLORS[0][0]},${SKALR_COLORS[0][1]},${SKALR_COLORS[0][2]},0.08)`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
      ctx.fill();

      // Compass circle
      const compassR = w * 0.38;
      ctx.beginPath();
      ctx.arc(cx, cy, compassR, 0, Math.PI * 2);
      ctx.fillStyle = isDark ? 'rgba(15,15,20,0.95)' : 'rgba(255,255,255,0.97)';
      ctx.fill();

      // Border gradient
      ctx.lineWidth = 2.5 * dpr;
      const strokeGrad = ctx.createLinearGradient(cx - compassR, cy, cx + compassR, cy);
      strokeGrad.addColorStop(0, `rgba(${SKALR_COLORS[2][0]},${SKALR_COLORS[2][1]},${SKALR_COLORS[2][2]},0.9)`);
      strokeGrad.addColorStop(0.5, `rgba(${SKALR_COLORS[0][0]},${SKALR_COLORS[0][1]},${SKALR_COLORS[0][2]},1)`);
      strokeGrad.addColorStop(1, `rgba(${SKALR_COLORS[3][0]},${SKALR_COLORS[3][1]},${SKALR_COLORS[3][2]},0.9)`);
      ctx.strokeStyle = strokeGrad;
      ctx.stroke();

      // Tick marks (N, E, S, W)
      const tickLen = compassR * 0.15;
      ctx.strokeStyle = isDark ? 'rgba(255,255,255,0.2)' : 'rgba(0,0,0,0.15)';
      ctx.lineWidth = 1.5 * dpr;
      for (let i = 0; i < 4; i++) {
        const angle = (i * Math.PI) / 2;
        const innerR = compassR - tickLen;
        ctx.beginPath();
        ctx.moveTo(cx + Math.cos(angle) * innerR, cy + Math.sin(angle) * innerR);
        ctx.lineTo(cx + Math.cos(angle) * (compassR - 3 * dpr), cy + Math.sin(angle) * (compassR - 3 * dpr));
        ctx.stroke();
      }

      // Needle — rotates with a "seeking" motion
      const seekAngle = Math.sin(t * 0.8 * speed) * 0.4 + Math.sin(t * 0.3 * speed) * 0.2;
      const needleAngle = -Math.PI / 2 + seekAngle; // mostly points up (north)
      const needleLen = compassR * 0.7;
      const needleW = compassR * 0.14;

      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(needleAngle);

      // North half (purple-pink)
      ctx.beginPath();
      ctx.moveTo(0, -needleLen);
      ctx.lineTo(-needleW, 0);
      ctx.lineTo(needleW, 0);
      ctx.closePath();
      const northGrad = ctx.createLinearGradient(0, -needleLen, 0, 0);
      northGrad.addColorStop(0, `rgba(${SKALR_COLORS[0][0]},${SKALR_COLORS[0][1]},${SKALR_COLORS[0][2]},1)`);
      northGrad.addColorStop(1, `rgba(${SKALR_COLORS[1][0]},${SKALR_COLORS[1][1]},${SKALR_COLORS[1][2]},0.9)`);
      ctx.fillStyle = northGrad;
      ctx.fill();

      // South half (faded)
      ctx.beginPath();
      ctx.moveTo(0, needleLen * 0.5);
      ctx.lineTo(-needleW, 0);
      ctx.lineTo(needleW, 0);
      ctx.closePath();
      ctx.fillStyle = isDark ? 'rgba(255,255,255,0.15)' : 'rgba(0,0,0,0.12)';
      ctx.fill();

      ctx.restore();

      // Center dot
      const dotR = compassR * 0.1;
      const dotGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, dotR);
      dotGrad.addColorStop(0, `rgba(${SKALR_COLORS[3][0]},${SKALR_COLORS[3][1]},${SKALR_COLORS[3][2]},1)`);
      dotGrad.addColorStop(1, `rgba(${SKALR_COLORS[0][0]},${SKALR_COLORS[0][1]},${SKALR_COLORS[0][2]},0.8)`);
      ctx.fillStyle = dotGrad;
      ctx.beginPath();
      ctx.arc(cx, cy, dotR, 0, Math.PI * 2);
      ctx.fill();

      // Specular
      ctx.fillStyle = 'rgba(255,255,255,0.7)';
      ctx.beginPath();
      ctx.arc(cx - dotR * 0.3, cy - dotR * 0.3, dotR * 0.35, 0, Math.PI * 2);
      ctx.fill();

      t += 0.02;
      animRef.current = requestAnimationFrame(frame);
    }

    animRef.current = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(animRef.current);
  }, [size, speed]);

  return (
    <canvas
      ref={canvasRef}
      className={cn('shrink-0', className)}
      style={{ width: size, height: size }}
    />
  );
};

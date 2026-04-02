import React, { useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';

interface AnimatedChatBubbleProps {
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

export const AnimatedChatBubble: React.FC<AnimatedChatBubbleProps> = ({
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
    const cy = h * 0.42;
    let t = 0;
    let dotPhase = 0;

    const isDark = document.documentElement.classList.contains('dark');

    function drawRoundedBubble(x: number, y: number, bw: number, bh: number, r: number) {
      if (!ctx) return;
      ctx.beginPath();
      ctx.moveTo(x + r, y);
      ctx.lineTo(x + bw - r, y);
      ctx.quadraticCurveTo(x + bw, y, x + bw, y + r);
      ctx.lineTo(x + bw, y + bh - r);
      ctx.quadraticCurveTo(x + bw, y + bh, x + bw - r, y + bh);
      // Tail
      ctx.lineTo(x + bw * 0.35, y + bh);
      ctx.lineTo(x + bw * 0.15, y + bh + bh * 0.25);
      ctx.lineTo(x + bw * 0.25, y + bh);
      ctx.lineTo(x + r, y + bh);
      ctx.quadraticCurveTo(x, y + bh, x, y + bh - r);
      ctx.lineTo(x, y + r);
      ctx.quadraticCurveTo(x, y, x + r, y);
      ctx.closePath();
    }

    function frame() {
      if (!ctx) return;
      ctx.clearRect(0, 0, w, h);

      // Outer glow
      const outerR = w * 0.48;
      const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, outerR);
      grad.addColorStop(0, `rgba(${SKALR_COLORS[2][0]},${SKALR_COLORS[2][1]},${SKALR_COLORS[2][2]},0.18)`);
      grad.addColorStop(0.5, `rgba(${SKALR_COLORS[0][0]},${SKALR_COLORS[0][1]},${SKALR_COLORS[0][2]},0.06)`);
      grad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(cx, cy, outerR, 0, Math.PI * 2);
      ctx.fill();

      // Bubble dimensions
      const bw = w * 0.78;
      const bh = h * 0.48;
      const br = bh * 0.28;
      const bx = cx - bw / 2;
      const by = cy - bh / 2;

      // Subtle breathing
      const breath = Math.sin(t * 1.5 * speed) * 0.008;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1 + breath, 1 + breath);
      ctx.translate(-cx, -cy);

      // Draw bubble
      drawRoundedBubble(bx, by, bw, bh, br);
      ctx.fillStyle = isDark ? 'rgba(15,15,20,0.95)' : 'rgba(255,255,255,0.97)';
      ctx.fill();

      // Gradient border
      ctx.lineWidth = 2.5 * dpr;
      const strokeGrad = ctx.createLinearGradient(bx, by, bx + bw, by + bh);
      strokeGrad.addColorStop(0, `rgba(${SKALR_COLORS[2][0]},${SKALR_COLORS[2][1]},${SKALR_COLORS[2][2]},0.9)`);
      strokeGrad.addColorStop(0.5, `rgba(${SKALR_COLORS[0][0]},${SKALR_COLORS[0][1]},${SKALR_COLORS[0][2]},1)`);
      strokeGrad.addColorStop(1, `rgba(${SKALR_COLORS[1][0]},${SKALR_COLORS[1][1]},${SKALR_COLORS[1][2]},0.9)`);
      drawRoundedBubble(bx, by, bw, bh, br);
      ctx.strokeStyle = strokeGrad;
      ctx.stroke();

      // Typing dots animation
      dotPhase += 0.04 * speed;
      const dotR = bh * 0.09;
      const dotSpacing = bw * 0.14;
      const dotCy = cy - bh * 0.02;

      for (let i = 0; i < 3; i++) {
        const bounce = Math.sin(dotPhase + i * 0.8) * bh * 0.08;
        const alpha = 0.5 + (Math.sin(dotPhase + i * 0.8) + 1) / 2 * 0.5;
        const c = SKALR_COLORS[i % 4];
        ctx.fillStyle = `rgba(${c[0]},${c[1]},${c[2]},${alpha})`;
        ctx.beginPath();
        ctx.arc(cx + (i - 1) * dotSpacing, dotCy + bounce, dotR, 0, Math.PI * 2);
        ctx.fill();
      }

      ctx.restore();

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

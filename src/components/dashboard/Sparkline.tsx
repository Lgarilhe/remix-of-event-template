/**
 * Sparkline — micro-chart inline pour visualiser une tendance sur 7-14 points.
 *
 * Pas de dépendance recharts (overkill pour 14 points), on dessine un SVG path
 * directement. Léger, customisable, avec animation de tracé à l'entrée.
 *
 * Usage :
 *   <Sparkline data={[3, 5, 2, 8, 6, 9, 11]} tone="positive" />
 *
 * Format flat : juste un trait + un fill subtil + un dot sur la dernière valeur.
 * Pas de gridlines, pas de labels (c'est un sparkline, pas un chart).
 */

import React, { useMemo } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';

export type SparklineTone = 'positive' | 'negative' | 'neutral' | 'info';

interface SparklineProps {
  data: number[];
  tone?: SparklineTone;
  width?: number;
  height?: number;
  className?: string;
  showDot?: boolean;
}

const TONE_STYLES: Record<SparklineTone, { stroke: string; fill: string }> = {
  positive: { stroke: 'hsl(var(--success))', fill: 'hsl(var(--success) / 0.15)' },
  negative: { stroke: 'hsl(var(--destructive))', fill: 'hsl(var(--destructive) / 0.12)' },
  neutral: { stroke: 'hsl(var(--foreground) / 0.6)', fill: 'hsl(var(--foreground) / 0.08)' },
  info: { stroke: 'hsl(var(--info))', fill: 'hsl(var(--info) / 0.12)' },
};

export const Sparkline: React.FC<SparklineProps> = ({
  data,
  tone = 'neutral',
  width = 80,
  height = 24,
  className,
  showDot = true,
}) => {
  const { linePath, areaPath, lastPoint } = useMemo(() => {
    if (data.length === 0) {
      return { linePath: '', areaPath: '', lastPoint: null };
    }

    const max = Math.max(...data, 1);
    const min = Math.min(...data, 0);
    const range = max - min || 1;
    const stepX = data.length > 1 ? width / (data.length - 1) : 0;
    const padding = 2;

    const points = data.map((v, i) => {
      const x = i * stepX;
      const y = padding + (height - padding * 2) * (1 - (v - min) / range);
      return { x, y };
    });

    const line = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');
    const area = `${line} L ${points[points.length - 1].x} ${height} L 0 ${height} Z`;

    return { linePath: line, areaPath: area, lastPoint: points[points.length - 1] };
  }, [data, width, height]);

  const styles = TONE_STYLES[tone];

  if (data.length === 0) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('shrink-0', className)}
      aria-hidden="true"
    >
      {/* Area fill */}
      <motion.path
        d={areaPath}
        fill={styles.fill}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.6, delay: 0.2, ease: 'easeOut' }}
      />
      {/* Line */}
      <motion.path
        d={linePath}
        fill="none"
        stroke={styles.stroke}
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={{ pathLength: 0 }}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.8, ease: 'easeInOut' }}
      />
      {/* Last point dot */}
      {showDot && lastPoint && (
        <motion.circle
          cx={lastPoint.x}
          cy={lastPoint.y}
          r={2.5}
          fill={styles.stroke}
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 0.3, delay: 0.8, ease: 'easeOut' }}
        />
      )}
    </svg>
  );
};

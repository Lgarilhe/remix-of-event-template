/**
 * Sparkline — micro-courbe d'une tendance sur 7 à 14 points.
 *
 * SVG dessiné à la main (recharts serait disproportionné pour 14 points).
 * Monochrome : la courbe montre une forme, pas un jugement ; le sens de la
 * variation est écrit à côté (+12 %), avec sa couleur de statut.
 *
 * Usage :
 *   <Sparkline data={[3, 5, 2, 8, 6, 9, 11]} />
 */

import React, { useMemo } from 'react';
import { cn } from '@/lib/utils';

interface SparklineProps {
  data: number[];
  width?: number;
  height?: number;
  className?: string;
  showDot?: boolean;
}

export const Sparkline: React.FC<SparklineProps> = ({
  data,
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

  if (data.length === 0) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={cn('shrink-0 text-muted-foreground', className)}
      aria-hidden="true"
    >
      <path d={areaPath} fill="currentColor" fillOpacity={0.08} />
      <path
        d={linePath}
        fill="none"
        stroke="currentColor"
        strokeWidth={1.5}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {showDot && lastPoint && <circle cx={lastPoint.x} cy={lastPoint.y} r={2.5} className="fill-foreground" />}
    </svg>
  );
};

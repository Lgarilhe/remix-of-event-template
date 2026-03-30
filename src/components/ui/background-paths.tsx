import React, { useMemo } from 'react';
import { motion } from 'framer-motion';

interface FloatingPathProps {
  d: string;
  delay: number;
  duration: number;
  color: string;
  width: number;
}

const FloatingPath: React.FC<FloatingPathProps> = ({ d, delay, duration, color, width }) => (
  <motion.path
    d={d}
    fill="none"
    stroke={color}
    strokeWidth={width}
    strokeLinecap="round"
    initial={{ pathLength: 0, opacity: 0 }}
    animate={{
      pathLength: [0, 1, 0],
      opacity: [0, 0.6, 0],
      pathOffset: [0, 0, 1],
    }}
    transition={{
      duration,
      delay,
      repeat: Infinity,
      ease: 'easeInOut',
    }}
  />
);

interface BackgroundPathsProps {
  className?: string;
  pathCount?: number;
}

function generatePath(seed: number, width: number, height: number): string {
  const r = (n: number) => {
    const x = Math.sin(seed * 9301 + n * 49297 + 233280) * 10000;
    return x - Math.floor(x);
  };
  const startX = r(0) * width * 0.2;
  const startY = r(1) * height;
  const cp1x = r(2) * width * 0.5 + width * 0.1;
  const cp1y = r(3) * height;
  const cp2x = r(4) * width * 0.5 + width * 0.3;
  const cp2y = r(5) * height;
  const endX = width * 0.8 + r(6) * width * 0.2;
  const endY = r(7) * height;
  return `M ${startX} ${startY} C ${cp1x} ${cp1y}, ${cp2x} ${cp2y}, ${endX} ${endY}`;
}

export const BackgroundPaths: React.FC<BackgroundPathsProps> = ({
  className,
  pathCount = 8,
}) => {
  const paths = useMemo(() => {
    const w = 1600;
    const h = 900;
    return Array.from({ length: pathCount }, (_, i) => ({
      d: generatePath(i + 1, w, h),
      delay: i * 0.7,
      duration: 6 + (i % 3) * 2,
      color: `hsl(var(--brutal-accent) / ${0.08 + (i % 4) * 0.04})`,
      width: 1 + (i % 3) * 0.5,
    }));
  }, [pathCount]);

  return (
    <div className={className}>
      <svg
        viewBox="0 0 1600 900"
        fill="none"
        className="w-full h-full"
        preserveAspectRatio="xMidYMid slice"
      >
        {paths.map((p, i) => (
          <FloatingPath key={i} {...p} />
        ))}
      </svg>
    </div>
  );
};

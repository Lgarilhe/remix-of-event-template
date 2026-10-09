import { cn } from '@/lib/utils';
import styles from './AgentOrb.module.css';

export interface AgentOrbProps {
  tone?: 'amber' | 'violet' | 'teal' | 'slate';
  size?: 'sm' | 'md' | 'lg' | 'hero';
  animated?: boolean;
  className?: string;
}

/** Decorative identity; the accompanying text always carries the agent state. */
export function AgentOrb({ tone = 'teal', size = 'md', animated = false, className }: AgentOrbProps) {
  return <span aria-hidden="true" className={cn(styles.orb, styles[tone], styles[size], animated && styles.animated, className)}>
    <span className={styles.surface} />
    <span className={styles.grain} />
    <span className={styles.light} />
  </span>;
}

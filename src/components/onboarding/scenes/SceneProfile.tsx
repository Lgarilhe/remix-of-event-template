import React, { useEffect, useId, useRef, useState } from 'react';
import { motion } from 'framer-motion';
import { cn } from '@/lib/utils';
import { ORG_TYPE_LABEL, type OrgType } from '../onboardingMeta';
import { SceneHeading } from '../parts/SceneHeading';
import { SPRING_SOFT } from '../stage/springs';
import { useDelay } from '../stage/useDelay';
import { TiltCard } from '../stage/TiltCard';

interface Choice {
  value: OrgType;
  title: string;
  line: string;
}

const CHOICES: Choice[] = [
  { value: 'enterprise', title: 'Ma propre entreprise', line: 'Vos postes internes, avec ou sans cabinets externes.' },
  { value: 'agency', title: 'Un cabinet, pour des clients', line: 'Une équipe, plusieurs clients, un portail à leur montrer.' },
  { value: 'freelance', title: 'Moi seul, pour des clients', line: 'Missions RPO, au succès ou en chasse.' },
];

interface Props {
  initial: OrgType | null;
  /** Survol ou focus d'une réponse : la carte du bureau l'écrit avant même le clic. */
  onPreview: (type: OrgType | null) => void;
  onSelect: (type: OrgType) => void;
}

/**
 * Première vraie question. Trois cartes tactiles ; la réponse s'écrit sur la
 * carte d'identité du bureau dès le survol, puis la scène suit d'elle-même.
 */
export const SceneProfile: React.FC<Props> = ({ initial, onPreview, onSelect }) => {
  const [picked, setPicked] = useState<OrgType | null>(initial);
  const firedRef = useRef(false);
  const titleId = useId();
  const d = useDelay();

  const pick = (value: OrgType) => {
    if (firedRef.current) return;
    firedRef.current = true;
    setPicked(value);
    onPreview(value);
    window.setTimeout(() => onSelect(value), 650);
  };

  // Lettres A, B, C
  const pickRef = useRef(pick);
  pickRef.current = pick;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey || e.key.length !== 1) return;
      const idx = 'ABC'.indexOf(e.key.toUpperCase());
      if (idx >= 0) {
        e.preventDefault();
        pickRef.current(CHOICES[idx].value);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <div className="space-y-8">
      <SceneHeading id={titleId} eyebrow="Vous" title="Vous recrutez pour qui ?" accent={['qui']}>
        <p>Konekt adapte ses écrans et ses quotas à votre façon de travailler. Un seul choix, modifiable plus tard.</p>
      </SceneHeading>

      <div role="radiogroup" aria-labelledby={titleId} className="space-y-3">
        {CHOICES.map((c, i) => {
          const isPicked = picked === c.value;
          return (
            <motion.div
              key={c.value}
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ ...SPRING_SOFT, delay: d(0.55 + i * 0.09) }}
            >
              <TiltCard
                role="radio"
                aria-checked={isPicked}
                tabIndex={0}
                tilt={3}
                selected={isPicked}
                dimmed={picked !== null && !isPicked}
                onClick={() => pick(c.value)}
                onPointerEnter={() => !firedRef.current && onPreview(c.value)}
                onPointerLeave={() => !firedRef.current && onPreview(initial)}
                onFocus={() => !firedRef.current && onPreview(c.value)}
                onBlur={() => !firedRef.current && onPreview(initial)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    pick(c.value);
                  }
                }}
                className="flex cursor-pointer items-center gap-4 p-4 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring sm:p-5"
              >
                <span
                  aria-hidden="true"
                  className={cn(
                    'flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border font-mono text-2xs transition-colors duration-150',
                    isPicked ? 'border-brand bg-brand text-brand-foreground' : 'border-input text-muted-foreground',
                  )}
                >
                  {'ABC'[i]}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block text-base font-semibold text-foreground">{c.title}</span>
                  <span className="mt-0.5 block text-sm text-foreground-secondary">{c.line}</span>
                </span>
                <span className="hidden shrink-0 rounded-full border border-border px-2.5 py-1 text-2xs font-medium text-muted-foreground sm:block">
                  {ORG_TYPE_LABEL[c.value]}
                </span>
              </TiltCard>
            </motion.div>
          );
        })}
      </div>
    </div>
  );
};

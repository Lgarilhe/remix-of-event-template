import React from 'react';
import { AnimatePresence, motion } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { PROCESS_CHOICES, processStepNames, type ProcessKey } from '@/lib/onboarding/mission';
import { SPRING_SOFT } from '../stage/springs';
import { useDelay } from '../stage/useDelay';

interface Props {
  value: ProcessKey;
  onChange: (key: ProcessKey) => void;
  readOnly?: boolean;
}

/** Étapes d'entretien : trois formats, et la frise des étapes qui se redessine à chaque choix. */
export const ProcessPicker: React.FC<Props> = ({ value, onChange, readOnly }) => {
  const steps = processStepNames(value);
  const d = useDelay();
  return (
    <div>
      <p className="mb-2 text-xs font-medium text-muted-foreground">Entretiens</p>
      <div role="group" aria-label="Format des entretiens" className="inline-flex rounded-lg border border-border p-0.5">
        {PROCESS_CHOICES.map((choice) => (
          <Button
            key={choice.key}
            variant={value === choice.key ? 'secondary' : 'ghost'}
            size="sm"
            aria-pressed={value === choice.key}
            disabled={readOnly}
            onClick={() => onChange(choice.key)}
            className={cn('rounded-md', value !== choice.key && 'text-muted-foreground')}
          >
            {choice.label}
          </Button>
        ))}
      </div>
      <AnimatePresence mode="wait">
        <motion.ol
          key={value}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0 }}
          transition={SPRING_SOFT}
          className="mt-3 flex flex-wrap items-center gap-x-1 gap-y-2 text-sm text-foreground-secondary"
        >
          {steps.map((name, i) => (
            <li key={name} className="flex items-center gap-1">
              <motion.span
                initial={{ scale: 0 }}
                animate={{ scale: 1 }}
                transition={{ ...SPRING_SOFT, delay: d(i * 0.07) }}
                aria-hidden="true"
                className="flex h-5 w-5 items-center justify-center rounded-full bg-muted text-3xs font-semibold text-foreground"
              >
                {i + 1}
              </motion.span>
              <span>{name}</span>
              {i < steps.length - 1 && <span aria-hidden="true" className="mx-1 h-px w-4 bg-border-strong" />}
            </li>
          ))}
        </motion.ol>
      </AnimatePresence>
    </div>
  );
};

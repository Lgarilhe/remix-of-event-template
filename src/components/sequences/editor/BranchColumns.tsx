// Branches d'une fourche (« Connecté (1er degré) / Non connecté », « Acceptée /
// Pas acceptée après 10 jours ») : côte à côte à partir de 768 px, l'une sous
// l'autre en dessous. Chaque branche est une région nommée qui porte sa liste.
import type { ReactNode } from 'react';
import { Check, X } from 'lucide-react';
import type { EditorBranch } from '@/lib/sequenceEditor';
import { cn } from '@/lib/utils';

interface BranchColumnsProps {
  stepNumber: number;
  branches: EditorBranch[];
  renderBranch: (branch: EditorBranch) => ReactNode;
  /** Panneau d'étape ouvert : 14 rem au lieu de 17 par branche (deux branches tiennent à côté du panneau à 1 280 px). */
  compact?: boolean;
}

export function BranchColumns({ stepNumber, branches, renderBranch, compact = false }: BranchColumnsProps) {
  return (
    <div
      role="group"
      aria-label={`Branches de l’étape ${stepNumber}`}
      className="mt-4 grid grid-cols-1 gap-6 md:grid-flow-col md:grid-cols-none md:auto-cols-[minmax(min-content,1fr)]"
    >
      {branches.map((branch) => (
        <section
          key={branch.key}
          aria-label={`Branche : ${branch.label}`}
          className={cn('min-w-0 max-md:border-l max-md:border-border max-md:pl-3', compact ? 'md:min-w-[14rem]' : 'md:min-w-[17rem]')}
        >
          <p className={cn('mb-2 flex items-center justify-center gap-1.5 text-xs font-medium', branch.tone === 'yes' ? 'text-foreground' : 'text-foreground-secondary')}>
            {branch.tone === 'yes'
              ? <Check className="h-3.5 w-3.5 text-success" aria-hidden="true" />
              : <X className="h-3.5 w-3.5 text-foreground" aria-hidden="true" />}
            {branch.label}
          </p>
          {renderBranch(branch)}
        </section>
      ))}
    </div>
  );
}

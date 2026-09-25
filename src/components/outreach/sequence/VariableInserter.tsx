import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Braces } from 'lucide-react';
import { findUnknownTemplateVariables } from './sequenceGraph';

interface Variable {
  code: string;
  label: string;
  example: string;
}

interface VariableGroup {
  label: string;
  variables: Variable[];
}

// Uniquement des variables que le moteur remplit à l'envoi (liste des clés dans
// sequenceGraph.ts). Ville, passage IA et signature n'y sont pas : elles étaient
// retirées du message envoyé. La signature d'un e-mail se choisit sur l'étape.
const CANDIDATE_VARIABLES: Variable[] = [
  { code: '{{first_name}}', label: 'Prénom', example: 'Marie' },
  { code: '{{last_name}}', label: 'Nom', example: 'Dupont' },
  { code: '{{company}}', label: 'Entreprise', example: 'Acme Corp' },
  { code: '{{job_title}}', label: 'Poste', example: 'CTO' },
];

const RECRUITER_VARIABLES: Variable[] = [
  { code: '{{sender_name}}', label: 'Votre prénom', example: 'Jean' },
  { code: '{{calendly_link}}', label: 'Lien d\'agenda', example: 'https://cal.com/...' },
];

interface VariableInserterProps {
  /** Ref to the target textarea or input */
  targetRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement>;
  /** Called when a variable is inserted — pass the new value */
  onInsert: (newValue: string) => void;
  /** Current value of the field */
  currentValue: string;
  className?: string;
}

export const VariableInserter: React.FC<VariableInserterProps> = ({
  targetRef,
  onInsert,
  currentValue,
  className,
}) => {
  const handleInsert = (code: string) => {
    const el = targetRef.current;
    if (!el) {
      onInsert(currentValue + code);
      return;
    }

    const start = el.selectionStart ?? currentValue.length;
    const end = el.selectionEnd ?? currentValue.length;
    const newValue = currentValue.slice(0, start) + code + currentValue.slice(end);
    onInsert(newValue);

    // Restore cursor position after React re-render
    requestAnimationFrame(() => {
      const newPos = start + code.length;
      el.setSelectionRange(newPos, newPos);
      el.focus();
    });
  };

  const groups: VariableGroup[] = [
    { label: 'Candidat', variables: CANDIDATE_VARIABLES },
    { label: 'Recruteur', variables: RECRUITER_VARIABLES },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className={className || "h-6 px-2 text-xs text-muted-foreground hover:text-foreground gap-1"}
        >
          <Braces className="w-3 h-3" />
          Variables
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-64">
        {groups.map((group, gi) => (
          <React.Fragment key={group.label}>
            {gi > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground">
              {group.label}
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              {group.variables.map((v) => (
                <DropdownMenuItem
                  key={v.code}
                  onClick={() => handleInsert(v.code)}
                  className="flex items-center justify-between cursor-pointer"
                >
                  <div className="flex items-center gap-2">
                    <code className="text-[11px] font-mono bg-muted px-1 py-0.5 rounded">{v.code}</code>
                    <span className="text-xs">{v.label}</span>
                  </div>
                  <span className="text-[10px] text-muted-foreground italic">{v.example}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

/**
 * Variables que le moteur ne sait pas remplir : elles seraient retirées du
 * message envoyé. Affiché sous le champ, avant l'enregistrement.
 */
export const UnknownVariablesNotice: React.FC<{ text: string; customKeys?: string[] }> = ({ text, customKeys = [] }) => {
  const unknown = findUnknownTemplateVariables(text, customKeys);
  if (unknown.length === 0) return null;
  return (
    <p className="text-xs text-warning mt-1">
      {unknown.length > 1
        ? `${unknown.join(', ')} ne seront pas remplacées à l'envoi : elles seront supprimées du message.`
        : `${unknown[0]} ne sera pas remplacée à l'envoi : elle sera supprimée du message.`}
    </p>
  );
};

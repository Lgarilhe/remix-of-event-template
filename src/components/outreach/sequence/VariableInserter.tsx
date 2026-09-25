import React from 'react';
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
import { cn } from '@/lib/utils';
import { VARIABLE_EXAMPLE } from './messageTypeUtils';

interface Variable {
  code: string;
  label: string;
  example: string;
}

interface VariableGroup {
  label: string;
  variables: Variable[];
}

// Exemples : les mêmes que l'aperçu du message (messageTypeUtils, revue design D-36).
const CANDIDATE_VARIABLES: Variable[] = [
  { code: '{{first_name}}', label: 'Prénom', example: VARIABLE_EXAMPLE.first_name },
  { code: '{{last_name}}', label: 'Nom', example: VARIABLE_EXAMPLE.last_name },
  { code: '{{company}}', label: 'Entreprise', example: VARIABLE_EXAMPLE.company },
  { code: '{{job_title}}', label: 'Poste', example: VARIABLE_EXAMPLE.job_title },
  { code: '{{city}}', label: 'Ville', example: VARIABLE_EXAMPLE.city },
];

const RECRUITER_VARIABLES: Variable[] = [
  { code: '{{sender_name}}', label: 'Votre prénom', example: 'Jean' },
  { code: '{{calendly_link}}', label: 'Lien Calendly', example: 'calendly.com/…' },
];

const EMAIL_ONLY_VARIABLES: Variable[] = [
  { code: '{{signature}}', label: "Signature de l'e-mail", example: 'Votre signature' },
];

const AI_VARIABLES: Variable[] = [
  { code: '{{ai_snippet}}', label: "Passage rédigé par l'IA", example: "À l'envoi" },
];

interface VariableInserterProps {
  /** Ref to the target textarea or input */
  targetRef: React.RefObject<HTMLTextAreaElement | HTMLInputElement>;
  /** Called when a variable is inserted — pass the new value */
  onInsert: (newValue: string) => void;
  /** Current value of the field */
  currentValue: string;
  /** Show email-only variables */
  showEmailVariables?: boolean;
  /** Champ visé (« l'objet », « le message »), pour le nom du bouton. */
  fieldLabel?: string;
  className?: string;
}

export const VariableInserter: React.FC<VariableInserterProps> = ({
  targetRef,
  onInsert,
  currentValue,
  showEmailVariables = false,
  fieldLabel,
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
    { label: 'Vous', variables: RECRUITER_VARIABLES },
    ...(showEmailVariables ? [{ label: 'E-mail', variables: EMAIL_ONLY_VARIABLES }] : []),
    { label: 'IA', variables: AI_VARIABLES },
  ];

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="xs"
          className={cn('gap-1 text-muted-foreground hover:text-foreground max-md:h-11', className)}
          aria-label={fieldLabel ? `Variables à insérer dans ${fieldLabel}` : undefined}
        >
          <Braces aria-hidden="true" />
          Variables
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        {groups.map((group, gi) => (
          <React.Fragment key={group.label}>
            {gi > 0 && <DropdownMenuSeparator />}
            <DropdownMenuLabel className="eyebrow text-2xs">{group.label}</DropdownMenuLabel>
            <DropdownMenuGroup>
              {group.variables.map((v) => (
                <DropdownMenuItem
                  key={v.code}
                  onClick={() => handleInsert(v.code)}
                  className="flex cursor-pointer items-center justify-between gap-3"
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <code className="rounded-sm bg-muted px-1 py-0.5 font-mono text-2xs">{v.code}</code>
                    <span className="truncate text-xs">{v.label}</span>
                  </span>
                  <span className="shrink-0 text-2xs text-muted-foreground">{v.example}</span>
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </React.Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
};

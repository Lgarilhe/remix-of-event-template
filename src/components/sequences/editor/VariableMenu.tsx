// Menu « + Variable » de l'éditeur de message (lot 5d-2) : groupes « Le
// candidat », « La mission », « Vous », « La date », chaque entrée en français
// avec un exemple sur le candidat fictif (« Prénom · Claire »). Choisir une
// entrée écrit la clé du moteur ({{prenom}}) :
// variableMenu de src/lib/sequenceVariables.ts, seule source des entrées.
// S'ouvre aussi quand on tape {{ dans le message.
import { Fragment, useMemo } from 'react';
import { Plus } from 'lucide-react';
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
import { variableMenu } from '@/lib/sequenceVariables';

interface VariableMenuProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPick: (key: string) => void;
  /** Fermeture : rend la main au champ du message, au bon endroit. */
  onClosed: () => void;
}

export function VariableMenu({ open, onOpenChange, onPick, onClosed }: VariableMenuProps) {
  // Calculé à l'ouverture : les exemples de « La date » suivent l'heure.
  const groups = useMemo(() => (open ? variableMenu(new Date()) : []), [open]);
  return (
    <DropdownMenu open={open} onOpenChange={onOpenChange} modal={false}>
      <DropdownMenuTrigger asChild>
        <Button type="button" variant="outline" size="xs" aria-label="Insérer une variable" className="max-md:h-11">
          <Plus aria-hidden="true" />
          Variable
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="max-h-80 w-72 overflow-y-auto"
        onCloseAutoFocus={(event) => {
          event.preventDefault();
          onClosed();
        }}
      >
        {groups.map(({ group, variables }, index) => (
          <Fragment key={group}>
            {index > 0 && <DropdownMenuSeparator />}
            <DropdownMenuGroup aria-label={group}>
              <DropdownMenuLabel>{group}</DropdownMenuLabel>
              {variables.map((v) => (
                <DropdownMenuItem key={v.key} textValue={v.label} onSelect={() => onPick(v.key)} className="gap-1.5 max-md:min-h-11">
                  <span className="shrink-0 text-foreground">{v.label}</span>
                  {v.example && <span className="min-w-0 truncate text-xs text-muted-foreground">· {v.example}</span>}
                </DropdownMenuItem>
              ))}
            </DropdownMenuGroup>
          </Fragment>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

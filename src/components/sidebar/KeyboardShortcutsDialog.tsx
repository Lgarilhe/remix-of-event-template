/**
 * Liste des raccourcis clavier (§2.4), ouverte depuis le menu Aide.
 *
 * Rendue par AppSidebar hors de <Sidebar>, en mode contrôlé. Les lettres G
 * reprennent G_ROUTES (GoShortcuts.tsx) ; un test vérifie qu'aucune ne manque.
 * Un nom par page : « Agenda » et « Messagerie », comme la rangée basse et la
 * palette.
 */
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

export interface KeyboardShortcutsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);

const G_SHORTCUTS: ReadonlyArray<{ keys: string; label: string }> = [
  { keys: 'G puis D', label: 'Tableau de bord' },
  { keys: 'G puis M', label: 'Missions' },
  { keys: 'G puis P', label: 'Pipeline' },
  { keys: 'G puis E', label: 'Agenda' },
  { keys: 'G puis T', label: 'Tâches' },
  { keys: 'G puis C', label: 'Messagerie' },
  { keys: 'G puis I', label: 'Assistant' },
];

export function KeyboardShortcutsDialog({ open, onOpenChange }: KeyboardShortcutsDialogProps) {
  const mod = isMac() ? '⌘' : 'Ctrl';
  const rows: ReadonlyArray<{ keys: string; label: string }> = [
    { keys: `${mod} J`, label: 'Aller à une page ou une action' },
    { keys: `${mod} K`, label: 'Ouvrir ou fermer l\'assistant' },
    { keys: `${mod} B`, label: 'Replier ou déplier la barre' },
    ...G_SHORTCUTS,
  ];

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Raccourcis clavier</DialogTitle>
        </DialogHeader>
        <table className="w-full text-sm">
          <tbody>
            {rows.map((row) => (
              <tr key={row.keys} className="border-b border-border last:border-0">
                <td className="py-2 pr-4 whitespace-nowrap">
                  <kbd className="rounded border border-border bg-muted px-1.5 py-0.5 font-mono text-[12px]">
                    {row.keys}
                  </kbd>
                </td>
                <td className="py-2 text-muted-foreground">{row.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <DialogDescription className="text-[12px]">
          Les raccourcis G ne fonctionnent pas dans un champ de saisie ni quand une fenêtre est ouverte.
        </DialogDescription>
      </DialogContent>
    </Dialog>
  );
}

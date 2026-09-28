/**
 * SnoozeArchiveButtons — mise en sommeil et archive, dans l'en-tête de la
 * conversation, sur ordinateur comme sur téléphone (revue design D-03).
 *
 * - Mettre en sommeil : délais proposés ou date choisie ; la conversation
 *   revient dans la liste à cette date.
 * - Archiver : geste réversible, donc sans confirmation ni rouge (D-20). La
 *   conversation reste ouverte et « Restaurer » prend la place des deux
 *   boutons : c'est l'annulation immédiate.
 * - Conversation en sommeil ou archivée : un seul bouton, « Restaurer ».
 */

import React, { useId, useState } from 'react';
import { AlarmClock, Archive, RotateCcw } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { SNOOZE_PRESETS } from '@/hooks/useChatStatus';
import { cn } from '@/lib/utils';

interface SnoozeArchiveButtonsProps {
  chatId: string;
  accountId: string;
  isSnoozed: boolean;
  isArchived: boolean;
  snoozedUntil: Date | null;
  onSnooze: (chatId: string, accountId: string, until: Date) => void;
  onArchive: (chatId: string, accountId: string) => void;
  onRestore: (chatId: string, accountId: string) => void;
  /** Classes du bouton « Archiver » (le masquer sur téléphone quand le menu de l'en-tête le reprend). */
  archiveClassName?: string;
}

// 44 px au doigt, 32 px à la souris (01-direction.md, § 5)
const ICON_BUTTON = 'h-11 w-11 text-muted-foreground hover:text-foreground md:h-8 md:w-8';

const formatWhen = (date: Date) =>
  date.toLocaleString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });

export const SnoozeArchiveButtons: React.FC<SnoozeArchiveButtonsProps> = ({
  chatId,
  accountId,
  isSnoozed,
  isArchived,
  snoozedUntil,
  onSnooze,
  onArchive,
  onRestore,
  archiveClassName,
}) => {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [customDateInput, setCustomDateInput] = useState('');
  const customDateId = useId();

  if (isSnoozed || isArchived) {
    const reason =
      isSnoozed && snoozedUntil
        ? `En sommeil jusqu'au ${snoozedUntil.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
        : 'Conversation archivée';
    return (
      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            onClick={() => onRestore(chatId, accountId)}
            aria-label={`Restaurer la conversation (${reason.charAt(0).toLowerCase()}${reason.slice(1)})`}
            className="h-11 w-11 px-0 md:h-8 md:w-auto md:px-3"
          >
            <RotateCcw aria-hidden="true" />
            <span className="hidden md:inline">Restaurer</span>
          </Button>
        </TooltipTrigger>
        <TooltipContent>{reason}</TooltipContent>
      </Tooltip>
    );
  }

  const customDate = customDateInput ? new Date(customDateInput) : null;
  const customDateValid = !!customDate && customDate.getTime() > Date.now();

  return (
    <>
      <Popover open={snoozeOpen} onOpenChange={setSnoozeOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button variant="ghost" size="icon-sm" aria-label="Mettre en sommeil" className={ICON_BUTTON}>
                <AlarmClock aria-hidden="true" />
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>Mettre en sommeil</TooltipContent>
        </Tooltip>
        <PopoverContent align="end" className="w-72 p-2">
          <div className="px-2 pb-2 pt-1">
            <p className="text-sm font-semibold text-foreground">Mettre en sommeil</p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              La conversation quitte la liste et y revient à la date choisie.
            </p>
          </div>

          <div className="space-y-0.5">
            {SNOOZE_PRESETS.map((preset) => {
              const target = preset.getDate();
              return (
                <Button
                  key={preset.label}
                  variant="ghost"
                  size="sm"
                  className="h-11 w-full justify-between gap-3 px-2 font-normal md:h-8"
                  onClick={() => {
                    onSnooze(chatId, accountId, target);
                    setSnoozeOpen(false);
                  }}
                >
                  <span className="truncate text-foreground">{preset.label}</span>
                  <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{formatWhen(target)}</span>
                </Button>
              );
            })}
          </div>

          {/* Date choisie */}
          <form
            className="mt-2 space-y-1.5 border-t border-border px-2 pb-1 pt-2"
            onSubmit={(e) => {
              e.preventDefault();
              if (!customDate || !customDateValid) return;
              onSnooze(chatId, accountId, customDate);
              setSnoozeOpen(false);
              setCustomDateInput('');
            }}
          >
            <Label htmlFor={customDateId} className="text-xs text-muted-foreground">
              Autre date
            </Label>
            <div className="flex gap-1.5">
              <Input
                id={customDateId}
                type="datetime-local"
                value={customDateInput}
                onChange={(e) => setCustomDateInput(e.target.value)}
                className="h-8 flex-1"
                min={new Date().toISOString().slice(0, 16)}
              />
              <Button type="submit" size="sm" variant="outline" disabled={!customDateValid}>
                Valider
              </Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>

      <Tooltip>
        <TooltipTrigger asChild>
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={() => onArchive(chatId, accountId)}
            aria-label="Archiver la conversation"
            className={cn(ICON_BUTTON, archiveClassName)}
          >
            <Archive aria-hidden="true" />
          </Button>
        </TooltipTrigger>
        <TooltipContent>Archiver la conversation</TooltipContent>
      </Tooltip>
    </>
  );
};

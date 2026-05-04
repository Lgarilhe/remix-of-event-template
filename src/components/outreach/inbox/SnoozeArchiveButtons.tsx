/**
 * SnoozeArchiveButtons — Boutons Snooze + Archive pour le header MessageView.
 *
 * - Snooze : popover avec presets (3h, demain, vendredi, lundi, 1 mois) + custom date picker
 * - Archive : bouton direct (toast confirmation)
 * - Restore : si chat snooze ou archived, bouton "Restaurer" remplace les autres
 *
 * Usage :
 *   <SnoozeArchiveButtons
 *     chatId={chat.id}
 *     accountId={chat.account_id}
 *     isSnoozed={isSnoozed}
 *     isArchived={isArchived}
 *     snoozedUntil={snoozedUntil}
 *     onSnooze={snoozeChat}
 *     onArchive={archiveChat}
 *     onRestore={restoreChat}
 *   />
 */

import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Popover, PopoverContent, PopoverTrigger,
} from '@/components/ui/popover';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { Clock, Archive, RotateCcw, Calendar as CalendarIcon } from 'lucide-react';
import { SNOOZE_PRESETS } from '@/hooks/useChatStatus';

interface SnoozeArchiveButtonsProps {
  chatId: string;
  accountId: string;
  isSnoozed: boolean;
  isArchived: boolean;
  snoozedUntil: Date | null;
  onSnooze: (chatId: string, accountId: string, until: Date) => void;
  onArchive: (chatId: string, accountId: string) => void;
  onRestore: (chatId: string, accountId: string) => void;
  compact?: boolean;
}

export const SnoozeArchiveButtons: React.FC<SnoozeArchiveButtonsProps> = ({
  chatId,
  accountId,
  isSnoozed,
  isArchived,
  snoozedUntil,
  onSnooze,
  onArchive,
  onRestore,
  compact = false,
}) => {
  const [snoozeOpen, setSnoozeOpen] = useState(false);
  const [archiveConfirmOpen, setArchiveConfirmOpen] = useState(false);
  const [customDateInput, setCustomDateInput] = useState('');

  const btnSize = compact ? 'sm' : 'default';
  const btnClass = compact ? 'h-7 px-2 text-xs gap-1' : 'gap-1.5 text-xs';

  // Si snooze ou archive → uniquement bouton restaurer
  if (isSnoozed || isArchived) {
    return (
      <Button
        variant="outline"
        size={btnSize}
        onClick={() => onRestore(chatId, accountId)}
        className={btnClass}
        title={isSnoozed && snoozedUntil
          ? `En sommeil jusqu'au ${snoozedUntil.toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`
          : 'Conversation archivée'}
      >
        <RotateCcw className={compact ? 'w-3 h-3' : 'w-4 h-4'} aria-hidden="true" />
        Restaurer
      </Button>
    );
  }

  return (
    <>
      {/* Snooze */}
      <Popover open={snoozeOpen} onOpenChange={setSnoozeOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="ghost"
            size={btnSize}
            className={btnClass}
            title="Mettre en sommeil"
          >
            <Clock className={compact ? 'w-3 h-3' : 'w-4 h-4'} aria-hidden="true" />
            {!compact && <span>Snooze</span>}
          </Button>
        </PopoverTrigger>
        <PopoverContent align="end" className="w-72 p-2">
          <div className="px-2 py-1.5 mb-1">
            <div className="text-xs font-bold text-muted-foreground">
              Mettre en sommeil
            </div>
            <div className="text-[10px] text-muted-foreground/70 mt-0.5">
              La conversation reviendra dans la liste à la date choisie.
            </div>
          </div>

          <div className="space-y-0.5">
            {SNOOZE_PRESETS.map((preset) => {
              const target = preset.getDate();
              const formatted = target.toLocaleString('fr-FR', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
              });
              return (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => {
                    onSnooze(chatId, accountId, target);
                    setSnoozeOpen(false);
                  }}
                  className="w-full flex items-center justify-between px-2 py-1.5 text-xs rounded hover:bg-muted transition-colors text-left"
                >
                  <span className="text-foreground">{preset.label}</span>
                  <span className="text-[10px] text-muted-foreground tabular-nums">{formatted}</span>
                </button>
              );
            })}
          </div>

          {/* Custom date */}
          <div className="border-t border-border mt-2 pt-2 px-2">
            <label className="text-[10px] text-muted-foreground font-bold flex items-center gap-1 mb-1">
              <CalendarIcon className="w-2.5 h-2.5" aria-hidden="true" />
              Date personnalisée
            </label>
            <div className="flex gap-1">
              <input
                type="datetime-local"
                value={customDateInput}
                onChange={(e) => setCustomDateInput(e.target.value)}
                className="flex-1 text-xs px-2 py-1 bg-background border border-border rounded"
                min={new Date().toISOString().slice(0, 16)}
              />
              <Button
                size="sm"
                variant="outline"
                disabled={!customDateInput}
                onClick={() => {
                  const d = new Date(customDateInput);
                  if (d.getTime() > Date.now()) {
                    onSnooze(chatId, accountId, d);
                    setSnoozeOpen(false);
                    setCustomDateInput('');
                  }
                }}
                className="h-7 px-2 text-xs"
              >
                OK
              </Button>
            </div>
          </div>
        </PopoverContent>
      </Popover>

      {/* Archive */}
      <Button
        variant="ghost"
        size={btnSize}
        onClick={() => setArchiveConfirmOpen(true)}
        className={`${btnClass} text-muted-foreground hover:text-destructive`}
        title="Archiver la conversation"
      >
        <Archive className={compact ? 'w-3 h-3' : 'w-4 h-4'} aria-hidden="true" />
        {!compact && <span>Archiver</span>}
      </Button>

      <AlertDialog open={archiveConfirmOpen} onOpenChange={setArchiveConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archiver cette conversation ?</AlertDialogTitle>
            <AlertDialogDescription>
              La conversation sera masquée de votre liste principale mais restera
              accessible via le filtre "Archivées". Vous pourrez la restaurer à tout
              moment.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                onArchive(chatId, accountId);
                setArchiveConfirmOpen(false);
              }}
            >
              Archiver
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
};

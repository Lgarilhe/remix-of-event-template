import React from 'react';
import { Sparkles } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useCopilot } from '@/contexts/CopilotContext';

export function CopilotTrigger() {
  const { isOpen, toggle, selectedProfiles, messages } = useCopilot();

  const hasUnreadSuggestions = messages.length > 0 && messages[messages.length - 1].role === 'assistant';
  const hasSelection = selectedProfiles.length > 0;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          onClick={toggle}
          className={cn(
            'fixed right-4 bottom-4 z-50 h-12 w-12 rounded-full shadow-lg transition-all duration-200',
            'bg-gradient-to-r from-violet-500 to-purple-600 hover:from-violet-600 hover:to-purple-700',
            'hover:scale-105 active:scale-95',
            isOpen && 'ring-2 ring-violet-400 ring-offset-2'
          )}
          size="icon"
        >
          <Sparkles className="h-5 w-5 text-white" />
          
          {/* Notification badge */}
          {(hasUnreadSuggestions || hasSelection) && !isOpen && (
            <span className="absolute -top-1 -right-1 flex h-4 w-4">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-violet-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-4 w-4 bg-violet-500 items-center justify-center text-[10px] text-white font-medium">
                {hasSelection ? selectedProfiles.length : '!'}
              </span>
            </span>
          )}
        </Button>
      </TooltipTrigger>
      <TooltipContent side="left" className="flex items-center gap-2">
        <span>Copilot IA</span>
        <kbd className="pointer-events-none inline-flex h-5 select-none items-center gap-1 rounded border bg-muted px-1.5 font-mono text-[10px] font-medium text-muted-foreground">
          <span className="text-xs">⌘</span>K
        </kbd>
      </TooltipContent>
    </Tooltip>
  );
}

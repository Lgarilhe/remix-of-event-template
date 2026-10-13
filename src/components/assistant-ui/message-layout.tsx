import type { ReactNode } from 'react';
import KonektLogo from '@/components/KonektLogo';
import { cn } from '@/lib/utils';

/** Avatar de l'assistant : le monogramme Konekt, fixe. */
export function AssistantAvatar({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <span
      className={cn(
        'flex shrink-0 items-center justify-center rounded-full bg-muted',
        size === 'lg' ? 'h-10 w-10' : 'h-7 w-7',
      )}
      aria-hidden="true"
    >
      <KonektLogo variant="mark" theme="auto" size={size === 'lg' ? 20 : 14} ariaLabel="" />
    </span>
  );
}

/** Enveloppe du message assistant, identique à celle du fil principal. */
export function AssistantMessageLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex gap-3 animate-fade-in">
      <div className="mt-0.5">
        <AssistantAvatar />
      </div>
      <div className="flex-1 min-w-0 space-y-2 pt-0.5">{children}</div>
    </div>
  );
}

/** Enveloppe du message utilisateur, identique à celle du fil principal. */
export function UserMessageLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex justify-end animate-fade-in">
      <div className="max-w-[80%] rounded-xl rounded-br-sm bg-muted px-4 py-2.5 text-md leading-relaxed text-foreground">
        {children}
      </div>
    </div>
  );
}

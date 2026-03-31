import React from 'react';
import { SidebarTrigger } from '@/components/ui/sidebar';

export const AppHeader: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  return (
    <header className="h-12 flex items-center gap-3 border-b border-border px-3 shrink-0 bg-background">
      <SidebarTrigger className="h-8 w-8 rounded-none border border-foreground" />
      {children}
    </header>
  );
};

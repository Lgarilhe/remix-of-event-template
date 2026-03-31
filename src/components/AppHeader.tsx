import React from 'react';
import { SidebarTrigger, useSidebar } from '@/components/ui/sidebar';
import { Menu } from 'lucide-react';

export const AppHeader: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const { isMobile } = useSidebar();

  return (
    <header className="h-11 flex items-center gap-3 border-b border-foreground/10 px-4 shrink-0 bg-background">
      <SidebarTrigger className="h-7 w-7 rounded-none text-muted-foreground hover:text-foreground hover:bg-transparent">
        <Menu className="h-4 w-4" />
      </SidebarTrigger>
      {children}
    </header>
  );
};

import React from 'react';
import { SidebarTrigger } from '@/components/ui/sidebar';
import { PanelLeft } from 'lucide-react';
import { NotificationDropdown } from '@/components/notifications/NotificationDropdown';

export const AppHeader: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  return (
    <header className="h-12 flex items-center gap-3 border-b border-border px-4 shrink-0 bg-background">
      <SidebarTrigger className="h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors">
        <PanelLeft className="h-4 w-4" />
      </SidebarTrigger>
      {children}
      {/* Zone droite : actions globales, le centre de notifications en premier */}
      <div className="ml-auto flex items-center gap-1">
        <NotificationDropdown />
      </div>
    </header>
  );
};

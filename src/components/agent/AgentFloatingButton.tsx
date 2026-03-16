import React from 'react';
import { Bot } from 'lucide-react';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';
import { useAgent } from '@/contexts/AgentContext';
import { useLocation } from 'react-router-dom';

const HIDDEN_ROUTES = ['/', '/auth', '/portal'];

export const AgentFloatingButton: React.FC = () => {
  const { openAgent, isOpen, unreadCount } = useAgent();
  const location = useLocation();

  const isHidden = isOpen || HIDDEN_ROUTES.some(r =>
    location.pathname === r || location.pathname.startsWith('/portal/')
  );

  if (isHidden) return null;

  return (
    <button
      onClick={() => openAgent()}
      className="fixed bottom-6 right-6 z-[2000] group"
      aria-label="Ouvrir l'agent IA"
    >
      <div className="relative">
        <AnimatedOrb size={56} speed={6}>
          <Bot className="w-6 h-6 text-foreground group-hover:scale-110 transition-transform" />
        </AnimatedOrb>
        <div className="absolute inset-0 -z-10 translate-x-[3px] translate-y-[3px] rounded-full bg-brutal-accent/40" />
        {unreadCount > 0 && (
          <span className="absolute -top-1 -right-1 px-1.5 py-0.5 text-[10px] font-bold bg-destructive text-destructive-foreground rounded-full min-w-[18px] text-center">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </div>
    </button>
  );
};

import React from 'react';
import { Bot } from 'lucide-react';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';
import { useAgentDrawer } from './AgentDrawerContext';
import { useLocation } from 'react-router-dom';

const HIDDEN_ROUTES = ['/', '/auth', '/portal'];

export const AgentFloatingButton: React.FC = () => {
  const { openAgent, isOpen } = useAgentDrawer();
  const location = useLocation();

  // Hide on public routes and when drawer is already open
  const isHidden = isOpen || HIDDEN_ROUTES.some(r =>
    location.pathname === r || location.pathname.startsWith('/portal/')
  );

  if (isHidden) return null;

  return (
    <button
      onClick={openAgent}
      className="fixed bottom-6 right-6 z-[2000] group"
      aria-label="Ouvrir l'agent IA"
    >
      <div className="relative">
        <AnimatedOrb size={56} speed={6}>
          <Bot className="w-6 h-6 text-foreground group-hover:scale-110 transition-transform" />
        </AnimatedOrb>
        {/* Brutal shadow accent */}
        <div className="absolute inset-0 -z-10 translate-x-[3px] translate-y-[3px] rounded-full bg-brutal-accent/40" />
      </div>
    </button>
  );
};

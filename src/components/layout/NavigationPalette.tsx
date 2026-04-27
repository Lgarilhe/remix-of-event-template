/**
 * NavigationPalette — palette de navigation rapide style Linear/Notion.
 *
 * Raccourci : Cmd+J (macOS) / Ctrl+J (Windows/Linux).
 * (Cmd+K est déjà pris par l'Agent IA, on ne l'écrase pas).
 *
 * Contient :
 * - Navigation vers les pages principales
 * - Actions rapides (créer mission, ouvrir settings tabs…)
 * - Raccourcis système (toggle theme, se déconnecter, toggle agent IA)
 *
 * Recherche fuzzy native via cmdk (déjà intégré dans shadcn/ui command).
 */

import React, { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  CommandDialog, CommandInput, CommandList, CommandEmpty, CommandGroup, CommandItem, CommandShortcut,
} from '@/components/ui/command';
import {
  LayoutDashboard, Target, Kanban, MessageSquare, Calendar as CalendarIcon, CheckSquare,
  Settings as SettingsIcon, Sparkles, Sun, Moon, LogOut,
  Plus, CreditCard, Users,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAgent } from '@/contexts/AgentContext';

export function NavigationPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { toggleAgent } = useAgent();

  // Ctrl+J / Cmd+J ouvre la palette
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        setOpen((prev) => !prev);
      }
      if (e.key === 'Escape' && open) {
        setOpen(false);
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [open]);

  const run = useCallback((action: () => void) => {
    setOpen(false);
    // Defer pour laisser le modal se fermer avant la nav
    setTimeout(action, 50);
  }, []);

  const go = useCallback((path: string) => run(() => navigate(path)), [navigate, run]);

  const toggleTheme = useCallback(() => {
    run(() => {
      const root = document.documentElement;
      if (root.classList.contains('light')) {
        root.classList.remove('light');
      } else {
        root.classList.add('light');
      }
    });
  }, [run]);

  const signOut = useCallback(() => {
    run(async () => {
      await supabase.auth.signOut();
      navigate('/auth');
    });
  }, [navigate, run]);

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Chercher une page, une action…" />
      <CommandList>
        <CommandEmpty>Aucun résultat</CommandEmpty>

        <CommandGroup heading="Navigation">
          <CommandItem onSelect={() => go('/dashboard')}>
            <LayoutDashboard className="mr-2 h-4 w-4" aria-hidden="true" />
            Dashboard
            <CommandShortcut>G D</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go('/missions')}>
            <Target className="mr-2 h-4 w-4" aria-hidden="true" />
            Missions
            <CommandShortcut>G M</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go('/pipeline')}>
            <Kanban className="mr-2 h-4 w-4" aria-hidden="true" />
            Pipeline
            <CommandShortcut>G P</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go('/calendar')}>
            <CalendarIcon className="mr-2 h-4 w-4" aria-hidden="true" />
            Calendrier
          </CommandItem>
          <CommandItem onSelect={() => go('/tasks')}>
            <CheckSquare className="mr-2 h-4 w-4" aria-hidden="true" />
            Tâches
          </CommandItem>
          <CommandItem onSelect={() => go('/inbox')}>
            <MessageSquare className="mr-2 h-4 w-4" aria-hidden="true" />
            Messages
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(() => toggleAgent())}>
            <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
            Ouvrir le copilot IA
            <CommandShortcut>⌘K</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go('/missions?new=1')}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Créer une mission
          </CommandItem>
          <CommandItem onSelect={() => go('/settings?tab=team')}>
            <Users className="mr-2 h-4 w-4" aria-hidden="true" />
            Gérer l'équipe
          </CommandItem>
          <CommandItem onSelect={() => go('/settings?tab=billing')}>
            <CreditCard className="mr-2 h-4 w-4" aria-hidden="true" />
            Abonnement & facturation
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Paramètres">
          <CommandItem onSelect={() => go('/settings')}>
            <SettingsIcon className="mr-2 h-4 w-4" aria-hidden="true" />
            Paramètres
          </CommandItem>
          <CommandItem onSelect={toggleTheme}>
            <Sun className="mr-2 h-4 w-4 dark:hidden" aria-hidden="true" />
            <Moon className="mr-2 h-4 w-4 hidden dark:block" aria-hidden="true" />
            Basculer le thème clair/sombre
          </CommandItem>
          <CommandItem onSelect={signOut} className="text-destructive data-[selected=true]:text-destructive">
            <LogOut className="mr-2 h-4 w-4" aria-hidden="true" />
            Se déconnecter
          </CommandItem>
        </CommandGroup>
      </CommandList>
    </CommandDialog>
  );
}

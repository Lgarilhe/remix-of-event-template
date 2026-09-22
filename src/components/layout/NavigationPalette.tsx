/**
 * NavigationPalette — palette de navigation rapide style Linear/Notion.
 *
 * Raccourci : Cmd+J (macOS) / Ctrl+J (Windows/Linux). Le bouton « Aller à… »
 * de la barre latérale l'ouvre aussi, via l'événement konekt:open-palette.
 * (Cmd+K est déjà pris par l'Agent IA, on ne l'écrase pas).
 *
 * Séquences G puis une lettre (G D, G M…) : actives hors champ de saisie,
 * menu ou fenêtre ouverte.
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
  Plus, CreditCard, Users, Search, Bot, ListPlus,
} from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useAgent } from '@/contexts/AgentContext';
import { useOrganization } from '@/hooks/useOrganization';
import { hasFeature } from '@/lib/featureGates';
import { useAuthReady } from '@/hooks/useAuthReady';

// G puis une lettre : mêmes destinations que les raccourcis affichés ci-dessous.
const G_ROUTES: Record<string, string> = {
  d: '/dashboard',
  m: '/missions',
  p: '/pipeline',
  e: '/calendar',
  t: '/tasks',
  c: '/inbox',
  i: '/agents',
};
const G_SEQUENCE_WINDOW_MS = 1200;

function isTypingOrInMenu(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  if (!el || typeof el.closest !== 'function') return false;
  if (el.isContentEditable) return true;
  if (el.closest('input, textarea, select, [contenteditable="true"]')) return true;
  return !!el.closest('[role="menu"], [role="listbox"], [role="combobox"], [role="grid"], [role="dialog"]');
}

export function NavigationPalette() {
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const { toggleAgent } = useAgent();
  const { orgType, isCollaborator, isAdmin } = useOrganization();
  // Mêmes règles que les onglets des paramètres : Équipe (freelance : pas de
  // gestion d'équipe) et Facturation (admins et propriétaires seulement).
  const canManageTeam = !isCollaborator && hasFeature(orgType, 'team_management');
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform);
  const { session } = useAuthReady();
  const signedIn = !!session;

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

  // Bouton « Aller à… » de la barre latérale
  useEffect(() => {
    const openPalette = () => setOpen(true);
    window.addEventListener('konekt:open-palette', openPalette);
    return () => window.removeEventListener('konekt:open-palette', openPalette);
  }, []);

  // G puis une lettre. Écoute en capture pour que la seconde lettre ne
  // déclenche pas aussi un raccourci de page (ex. T = aujourd'hui au calendrier).
  useEffect(() => {
    // Pages publiques (accueil, connexion) : pas de navigation au clavier.
    if (!signedIn) return;
    let pendingSince = 0;
    const handler = (e: KeyboardEvent) => {
      if (open || e.metaKey || e.ctrlKey || e.altKey || e.defaultPrevented) {
        pendingSince = 0;
        return;
      }
      if (isTypingOrInMenu(e.target) || document.querySelector('[role="dialog"][data-state="open"]')) {
        pendingSince = 0;
        return;
      }
      const key = (e.key || '').toLowerCase();
      if (pendingSince && e.timeStamp - pendingSince < G_SEQUENCE_WINDOW_MS) {
        pendingSince = 0;
        const path = G_ROUTES[key];
        if (path) {
          e.preventDefault();
          e.stopPropagation();
          navigate(path);
        }
        return;
      }
      pendingSince = key === 'g' && !e.shiftKey ? e.timeStamp : 0;
    };
    window.addEventListener('keydown', handler, true);
    return () => window.removeEventListener('keydown', handler, true);
  }, [open, navigate, signedIn]);

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
          <CommandItem onSelect={() => go('/sourcing')}>
            <Search className="mr-2 h-4 w-4" aria-hidden="true" />
            Recherche
          </CommandItem>
          <CommandItem onSelect={() => go('/pipeline')}>
            <Kanban className="mr-2 h-4 w-4" aria-hidden="true" />
            Pipeline
            <CommandShortcut>G P</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go('/calendar')}>
            <CalendarIcon className="mr-2 h-4 w-4" aria-hidden="true" />
            Calendrier
            <CommandShortcut>G E</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go('/tasks')}>
            <CheckSquare className="mr-2 h-4 w-4" aria-hidden="true" />
            Tâches
            <CommandShortcut>G T</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go('/inbox')}>
            <MessageSquare className="mr-2 h-4 w-4" aria-hidden="true" />
            Messages
            <CommandShortcut>G C</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => go('/agents')}>
            <Bot className="mr-2 h-4 w-4" aria-hidden="true" />
            Agents IA
            <CommandShortcut>G I</CommandShortcut>
          </CommandItem>
        </CommandGroup>

        <CommandGroup heading="Actions">
          <CommandItem onSelect={() => run(() => toggleAgent())}>
            <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
            Ouvrir le copilot IA
            <CommandShortcut>{isMac ? '⌘K' : 'Ctrl K'}</CommandShortcut>
          </CommandItem>
          <CommandItem onSelect={() => run(() => window.dispatchEvent(new CustomEvent('konekt:new-task')))}>
            <ListPlus className="mr-2 h-4 w-4" aria-hidden="true" />
            Nouvelle tâche
          </CommandItem>
          <CommandItem onSelect={() => go('/missions?create=brief')}>
            <Plus className="mr-2 h-4 w-4" aria-hidden="true" />
            Créer une mission
          </CommandItem>
          {canManageTeam && (
            <CommandItem onSelect={() => go('/settings?tab=team')}>
              <Users className="mr-2 h-4 w-4" aria-hidden="true" />
              Gérer l'équipe
            </CommandItem>
          )}
          {isAdmin && (
            <CommandItem onSelect={() => go('/settings?tab=billing')}>
              <CreditCard className="mr-2 h-4 w-4" aria-hidden="true" />
              Abonnement & facturation
            </CommandItem>
          )}
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

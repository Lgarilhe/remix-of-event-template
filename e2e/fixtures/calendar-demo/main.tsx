import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Link, MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { Sidebar, SidebarProvider, SidebarTrigger } from '@/components/ui/sidebar';
import { CalendarDemoProvider } from '@/components/calendar/CalendarDemoProvider';
import { UpcomingEvents } from '@/components/sidebar/UpcomingEvents';
import CalendarPage from '@/pages/Calendar';
import { EventDetailSheet } from '@/components/calendar/EventDetailSheet';
import type { CalendarEvent } from '@/hooks/useCalendarEvents';

const event: CalendarEvent = {
  id: 'qualif-session-fixture', type: 'qualification', status: 'scheduled',
  startAt: new Date(Date.now() + 60 * 60_000).toISOString(),
  endAt: new Date(Date.now() + 90 * 60_000).toISOString(),
  title: 'Entretien de Camille', subtitle: 'Camille Durand',
  meta: {
    candidateId: 'candidate/fixture', candidateName: 'Camille Durand',
    projectId: 'mission/fixture', jobTitle: 'Développeuse',
    location: 'https://meet.google.com/fixture-preview',
  },
};

export function NativeEventFixture() {
  const [open, setOpen] = useState(true);
  return <><h1>Fiche de rendez-vous</h1><button onClick={() => setOpen(true)}>Ouvrir le rendez-vous</button><EventDetailSheet event={event} open={open} onOpenChange={setOpen} /></>;
}

export function Destination() {
  const location = useLocation();
  return <><h1>Destination du rendez-vous</h1><output aria-label="Destination">{location.pathname + location.search}</output></>;
}

/** Vrai tiroir mobile : le dialogue doit survivre au démontage de son contenu. */
export function SidebarApp() {
  const location = useLocation();
  const [clicks, setClicks] = useState(0);
  return <div className="flex min-h-screen w-full">
    <Sidebar>
      <nav aria-label="Navigation de l’aperçu" className="flex flex-col gap-2 p-3">
        <Link to="/inbox">Messagerie</Link>
        <Link to="/pipeline">Pipeline</Link>
        <Link to="/calendar?demo=1">Aperçu Agenda</Link>
      </nav>
      <UpcomingEvents />
    </Sidebar>
    <main className="min-w-0 flex-1 p-3">
      <SidebarTrigger />
      <h1>{location.pathname === '/inbox' ? 'Messagerie' : 'Pipeline'}</h1>
      <output aria-label="Page active">{location.pathname}</output>
      <button className="block min-h-11" onClick={() => setClicks(previous => previous + 1)}>Action de la page ({clicks})</button>
    </main>
  </div>;
}

createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={[location.pathname + location.search]}>
    <SidebarProvider><CalendarDemoProvider><TooltipProvider><Toaster /><div className="min-h-screen w-full bg-background text-foreground">
      <Routes>
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/native-event" element={<NativeEventFixture />} />
        <Route path="/inbox" element={<SidebarApp />} />
        <Route path="/pipeline" element={<SidebarApp />} />
        <Route path="*" element={<Destination />} />
      </Routes>
    </div></TooltipProvider></CalendarDemoProvider></SidebarProvider>
  </MemoryRouter>,
);

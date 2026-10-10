import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
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

createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={[location.pathname + location.search]}>
    <TooltipProvider><Toaster /><main className="min-h-screen bg-background text-foreground">
      <Routes>
        <Route path="/calendar" element={<CalendarPage />} />
        <Route path="/native-event" element={<NativeEventFixture />} />
        <Route path="*" element={<Destination />} />
      </Routes>
    </main></TooltipProvider>
  </MemoryRouter>,
);

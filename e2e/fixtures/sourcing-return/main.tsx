import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MissionSourcing } from '@/components/missions/MissionSourcing';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Button } from '@/components/ui/button';
import { Toaster } from '@/components/ui/sonner';
import { useFixture } from './mocks';
import type { FixtureWindow } from './types';

const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
const w = window as FixtureWindow;
export function App() {
  const state = useFixture();
  const [sourcing, setSourcing] = useState(true);
  const [initial, setInitial] = useState(true);
  const project = w.qaProjects[state.projectId ?? 'mission-a'];
  return <main className="min-h-screen min-w-0 bg-background p-3 text-foreground sm:p-6">
    <nav aria-label="Navigation de la mission" className="mb-4 flex gap-2">
      <Button className="min-h-11" variant="outline" onClick={() => { setInitial(false); setSourcing(false); }}>Pipeline</Button>
      <Button className="min-h-11" variant="outline" onClick={() => setSourcing(true)}>Sourcing</Button>
    </nav>
    {sourcing ? <MissionSourcing project={project} layout={new URLSearchParams(location.search).has('legacy') ? 'default' : 'mission-v3'} startWithFilters={initial && new URLSearchParams(location.search).has('configure')} /> : <h1>Pipeline de {project.name}</h1>}
    <Toaster />
  </main>;
}
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={client}><MemoryRouter><TooltipProvider><App /></TooltipProvider></MemoryRouter></QueryClientProvider>,
);

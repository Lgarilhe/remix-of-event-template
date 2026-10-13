import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DashboardSourcingPanel } from '@/components/dashboard/DashboardSourcingPanel';
import { MissionSourcing } from '@/components/missions/MissionSourcing';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { Button } from '@/components/ui/button';
import { useState } from 'react';
import { useFixture } from './mocks';
import type { FixtureWindow } from './types';
const client = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
function App() {
  useFixture();
  const location = useLocation();
  const [visible, setVisible] = useState(true);
  const w = window as FixtureWindow;
  const id = location.pathname.split('/').filter(Boolean)[1];
  const project = id ? w.qaProjects[id] : undefined;
  const start = location.state as { phrase?: string; source?: 'database' | 'linkedin' } | null;
  return <main className="min-h-screen bg-background p-4 text-foreground sm:p-6">
    {project ? <>
      <h1 className="mb-3 text-xl font-semibold">{project.name}</h1>
      <Button variant="ghost" onClick={() => setVisible(v => !v)}>Basculer Pipeline / Sourcing</Button>
      {visible ? <MissionSourcing project={project} layout="mission-v3" initialPhrase={start?.phrase} initialSource={start?.source} /> : <h2>Pipeline</h2>}
    </> : <div className="mx-auto max-w-3xl"><h1 className="mb-5 text-2xl font-semibold">Bonjour Camille</h1><DashboardSourcingPanel projects={Object.values(w.qaProjects)} loading={false} error={null} /></div>}
    <Toaster />
  </main>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><MemoryRouter initialEntries={[new URLSearchParams(window.location.search).get('mission') ? '/missions/mission-a/sourcing' : '/']}><TooltipProvider><App /></TooltipProvider></MemoryRouter></QueryClientProvider>);

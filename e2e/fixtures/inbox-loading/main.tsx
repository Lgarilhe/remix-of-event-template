import InboxPage from '@/pages/Inbox';
import { CardMessageThread } from '@/components/outreach/result-card/CardMessageThread';
import { Toaster } from '@/components/ui/sonner';
import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { TooltipProvider } from '@/components/ui/tooltip';
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
export function App() { const id = 'ACo_fixture_camille'; return new URLSearchParams(location.search).has('thread') ? <main className="mx-auto h-screen max-w-5xl overflow-y-auto bg-background p-4 text-foreground"><h1 className="mb-4 text-xl">Camille Durand</h1><CardMessageThread profileId={id} profileName="Camille Durand" profileUrl="https://www.linkedin.com/in/camille-fixture"/></main> : <main className="h-screen bg-background text-foreground"><InboxPage /></main>; }
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><MemoryRouter><TooltipProvider><Toaster /><App /></TooltipProvider></MemoryRouter></QueryClientProvider>);

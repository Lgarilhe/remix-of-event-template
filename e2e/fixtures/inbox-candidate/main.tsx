import React from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import Inbox from '@/pages/Inbox';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import type { CandidateFixtureWindow } from './types';
const w = window as CandidateFixtureWindow;
const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
w.qaCandidateInvalidations = () => { void client.invalidateQueries(); };
export function App() { const location = useLocation(); w.qaCandidateAddress = location.pathname + location.search; return <main className="h-screen bg-background text-foreground"><Inbox /></main>; }
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><MemoryRouter initialEntries={['/inbox']}><TooltipProvider><Toaster /><App /></TooltipProvider></MemoryRouter></QueryClientProvider>);

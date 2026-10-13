import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ConversationContext } from '@/components/outreach/inbox/ConversationContext';
import { Button } from '@/components/ui/button';
import { Sheet, SheetTrigger, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet';
import { useFixture } from './mocks';
import type { ProfileFixtureWindow } from './types';

const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
(window as ProfileFixtureWindow).qaProfileInvalidate = () => { void client.invalidateQueries({ queryKey: ['inbox-candidate-profile'] }); };
export function App() {
  const s = useFixture();
  const [open, setOpen] = useState(false);
  return <main className="min-h-screen bg-background p-5 text-foreground">
    <h1 className="mb-5 text-xl font-semibold">Messagerie</h1>
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild><Button variant="outline" className="min-h-11">Afficher le contexte candidat</Button></SheetTrigger>
      <SheetContent className="w-full max-w-sm overflow-y-auto p-0 [&>button]:h-11 [&>button]:w-11">
        <SheetHeader className="px-5 pt-6"><SheetTitle>Contexte candidat</SheetTitle><SheetDescription>Mission, séquence et prochain entretien.</SheetDescription></SheetHeader>
        <ConversationContext name={s.profileName} profileId={s.profileId} profileAliases={s.aliases} profileUrl={s.profileUrl} mission={null} events={[]} now={0} readOnly onEnroll={() => {}} onAddToPipeline={() => {}} />
      </SheetContent>
    </Sheet>
  </main>;
}
createRoot(document.getElementById('root')!).render(<QueryClientProvider client={client}><MemoryRouter><App /></MemoryRouter></QueryClientProvider>);

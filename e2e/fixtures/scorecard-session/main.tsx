import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { ScorecardTab } from '@/components/ats/ScorecardTab';
import { TooltipProvider } from '@/components/ui/tooltip';
import type { ATSCandidate } from '@/hooks/useATSData';

const candidate: ATSCandidate = {
  id: 'candidate-row', candidateId: 'candidate-fixture', name: 'Camille Durand',
  email: null, phone: null, linkedin: null, headline: 'Product Designer', expertise: [],
  stage: 'En entretien', entity: null, source: 'local', sourceId: 'candidate-fixture',
  jobId: null, jobTitle: 'Product Designer', projectId: 'mission-fixture',
  lastActivity: null, createdAt: '2026-10-01T10:00:00Z',
};

export function App() {
  const [session, setSession] = useState('session-first');
  const coaching = new URLSearchParams(location.search).get('case') === 'ready-assistant';
  return <main className="mx-auto max-w-3xl p-4">
    <h1>Évaluation de Camille</h1>
    <button onClick={() => setSession('session-second')}>Ouvrir le deuxième entretien</button>
    <output aria-label="Entretien actif">{session}</output>
    <ScorecardTab candidate={candidate} enrichedProfile={null}
      qualificationSessionId={session} autoGenerate autoOpenFirst autoStartCoaching={coaching}
      meetingLocation="https://teams.microsoft.com/l/meetup-join/fixture" />
  </main>;
}

createRoot(document.getElementById('root')!).render(
  <MemoryRouter><TooltipProvider><App /></TooltipProvider></MemoryRouter>,
);

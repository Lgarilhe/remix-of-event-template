import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Toaster } from '@/components/ui/sonner';
import { LiveCoachingPanel } from '@/components/ats/LiveCoachingPanel';
import { ScorecardEditor, type ScorecardEditorValue } from '@/components/ats/ScorecardEditor';

const locations: Record<string, string | null> = {
  teams: 'https://teams.microsoft.com/l/meetup-join/audio-fixture',
  meet: 'https://meet.google.com/aaa-bbbb-ccc',
  zoom: 'https://eu01.zoom.us/j/123456789',
  phone: 'tel:+33123456789',
  onsite: 'Entretien en présentiel dans nos bureaux',
  unknown: null,
};

export function Harness() {
  const [meeting, setMeeting] = useState(new URLSearchParams(window.location.search).get('meeting') || 'teams');
  const [open, setOpen] = useState(true);
  const workspace = new URLSearchParams(window.location.search).has('workspace');
  const [grid, setGrid] = useState<ScorecardEditorValue>({
    criteria: [{ id: 'research', label: 'Recherche utilisateur', description: 'Expliquer une décision issue des entretiens.', category: 'technical', weight: 2,
      suggestedQuestions: ['Quel retour utilisateur a changé votre décision ?'], ratingRubric: { '1': 'Pas encore de pratique', '3': 'Un exemple expliqué', '5': 'Décision et résultat mesurable' } }],
    ratings: {}, comments: {}, overallScore: null, jobTitle: 'Product Designer', interviewStage: 'phone_screen',
  });
  const assistant = open ? <LiveCoachingPanel
      key={meeting}
      candidateId="candidate-fixture" candidateName="Camille Durand" projectId="mission-fixture"
      qualificationSessionId={`interview-${meeting}`} meetingLocation={locations[meeting]}
      jobId="job-fixture" jobTitle="Product Designer" jobContext="Concevoir une expérience utilisateur accessible."
      criteria={[{ id: 'research', label: 'Recherche utilisateur', description: 'Expliquer une décision issue des entretiens.', category: 'technical', weight: 2 }]}
      onCriteriaUpdate={() => {}} onAutoScores={() => {}} onReportGenerated={() => {}}
      onClose={() => setOpen(false)}
    /> : <button className="min-h-11 rounded border border-border px-3" onClick={() => setOpen(true)}>Rouvrir l’assistant</button>;
  return <main className={`mx-auto w-full space-y-3 p-3 ${workspace ? 'max-w-[1600px]' : 'max-w-[420px]'}`}>
    <h1 className="text-lg font-semibold">Entretien de Camille Durand</h1>
    {!workspace && <label className="block text-sm">Rendez-vous du harnais
      <select aria-label="Rendez-vous du harnais" className="mt-1 block min-h-11 w-full rounded border border-border bg-background px-2" value={meeting} onChange={event => setMeeting(event.target.value)}>
        <option value="teams">Teams</option><option value="meet">Meet</option><option value="zoom">Zoom</option>
        <option value="phone">Téléphone</option><option value="onsite">Présentiel</option><option value="unknown">Lieu inconnu</option>
      </select>
    </label>}
    {workspace ? <ScorecardEditor
      value={grid} currentCriterionIndex={0} onCriterionChange={() => {}}
      onRate={(id, rating) => setGrid(previous => ({ ...previous, ratings: { ...previous.ratings, [id]: rating } }))}
      onComment={(id, comment) => setGrid(previous => ({ ...previous, comments: { ...previous.comments, [id]: comment } }))}
      onRecommendationChange={recommendation => setGrid(previous => ({ ...previous, recommendation }))}
      onSummaryChange={summary => setGrid(previous => ({ ...previous, summary }))}
      onFollowUpNotesChange={followUpNotes => setGrid(previous => ({ ...previous, followUpNotes }))}
      assistant={assistant}
    /> : assistant}
  </main>;
}

createRoot(document.getElementById('root')!).render(
  <TooltipProvider><Toaster /><div className="min-h-screen bg-background text-foreground"><Harness /></div></TooltipProvider>,
);

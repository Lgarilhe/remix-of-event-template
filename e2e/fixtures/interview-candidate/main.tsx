import { createRoot } from 'react-dom/client';
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { TooltipProvider } from '@/components/ui/tooltip';
import ATS from '@/pages/ATS';
import ScorecardFullPage from '@/pages/ScorecardFullPage';

export function Harness() {
  const navigate = useNavigate();
  const current = useLocation();
  window.interviewQA.navigate = navigate;
  return <TooltipProvider><div className="bg-background text-foreground">
    <output aria-label="Adresse ouverte">{current.pathname + current.search}</output>
    <Routes>
      <Route path="/pipeline/scorecard/:candidateId" element={<ScorecardFullPage />} />
      <Route path="*" element={<ATS />} />
    </Routes>
  </div></TooltipProvider>;
}
createRoot(document.getElementById('root')!).render(
  <MemoryRouter initialEntries={[location.pathname + location.search]}><Harness /></MemoryRouter>,
);

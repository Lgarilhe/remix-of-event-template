import React, { useState } from 'react';
import { Navbar } from '@/components/Navbar';
import { SEOHead } from '@/components/SEOHead';
import { ATSDashboard } from '@/components/ats/ATSDashboard';
import { ATSStatsSkeleton } from '@/components/ats/ATSStatsSkeleton';
import { CandidateDetailModal } from '@/components/ats/CandidateDetailModal';
import { JobDetailSheet } from '@/components/ats/JobDetailSheet';
import { useATSData, ATS_STAGES, ATSCandidate } from '@/hooks/useATSData';
import { RefreshCw } from 'lucide-react';
import iconDashboard3d from '@/assets/icon-dashboard-3d.png';

export default function Dashboard() {
  const { candidates, loading, isFetching, isFromCache, refetch, handleStageChange, handleTagsChange } = useATSData();
  const [selectedCandidate, setSelectedCandidate] = useState<ATSCandidate | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Dashboard | Konekt"
        description="Vue d'ensemble de votre activité recrutement"
      />
      <Navbar />

      <main className="pt-16 sm:pt-20 pb-8">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-8 w-8 flex items-center justify-center shrink-0">
                <img src={iconDashboard3d} alt="" className="w-8 h-8 object-contain" />
              </div>
              <h1 className="text-xl sm:text-2xl font-bold text-foreground uppercase tracking-tight">Dashboard</h1>
              {isFromCache && !isFetching && (
                <span className="text-[9px] text-muted-foreground border border-border px-1.5 py-0.5 uppercase tracking-wider font-medium hidden sm:inline">
                  Cache
                </span>
              )}
              {isFetching && !loading && (
                <span className="text-[9px] text-muted-foreground border border-border px-1.5 py-0.5 uppercase tracking-wider font-medium animate-pulse hidden sm:inline">
                  Sync...
                </span>
              )}
            </div>

            <button
              onClick={refetch}
              disabled={loading}
              className="relative overflow-hidden h-8 px-3 flex items-center gap-1.5 border border-foreground text-foreground text-[10px] font-medium uppercase tracking-wider group disabled:opacity-30"
            >
              <RefreshCw className={`w-3 h-3 relative z-10 ${loading ? 'animate-spin' : ''}`} />
              <span className="relative z-10 hidden sm:inline">Actualiser</span>
              <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out" />
            </button>
          </div>

          {/* Dashboard Content */}
          {loading && candidates.length === 0 ? (
            <ATSStatsSkeleton />
          ) : candidates.length === 0 ? (
            <div className="border-2 border-foreground bg-background p-6 sm:p-8">
              <div className="flex items-start gap-4">
                <div className="text-4xl">👋</div>
                <div>
                  <h2 className="text-lg font-bold uppercase tracking-wider">Bienvenue sur Konekt</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Voici les 3 étapes pour démarrer :
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
                <a href="/missions" className="group border border-foreground p-4 hover:bg-brutal-accent transition-colors">
                  <div className="text-2xl mb-2">📂</div>
                  <div className="text-[11px] font-bold uppercase tracking-wider">1. Créer une mission</div>
                  <p className="text-[10px] text-muted-foreground mt-1">Ajoutez votre premier poste à pourvoir</p>
                </a>
                <a href="/missions?tab=search" className="group border border-foreground p-4 hover:bg-brutal-accent transition-colors">
                  <div className="text-2xl mb-2">🔍</div>
                  <div className="text-[11px] font-bold uppercase tracking-wider">2. Sourcer des candidats</div>
                  <p className="text-[10px] text-muted-foreground mt-1">Lancez une recherche LinkedIn</p>
                </a>
                <a href="/settings?tab=connectors" className="group border border-foreground p-4 hover:bg-brutal-accent transition-colors">
                  <div className="text-2xl mb-2">🔌</div>
                  <div className="text-[11px] font-bold uppercase tracking-wider">3. Connecter vos outils</div>
                  <p className="text-[10px] text-muted-foreground mt-1">Notion, Airtable, Aircall...</p>
                </a>
              </div>
              <p className="text-[10px] text-muted-foreground mt-4 text-center">
                Astuce : appuyez sur <kbd className="px-1 py-0.5 border border-foreground text-foreground">{isMac ? '⌘K' : 'Ctrl+K'}</kbd> à tout moment pour ouvrir le copilot IA
              </p>
            </div>
          ) : (
            <ATSDashboard
              candidates={candidates}
              stages={ATS_STAGES}
              onCandidateClick={(c) => setSelectedCandidate(c)}
              onJobClick={(jobId) => setSelectedJobId(jobId)}
            />
          )}
        </div>
      </main>

      {selectedCandidate && (
        <CandidateDetailModal
          candidate={selectedCandidate}
          onClose={() => setSelectedCandidate(null)}
          onStageChange={handleStageChange}
          onTagsChange={handleTagsChange}
          onRefresh={refetch}
        />
      )}

      <JobDetailSheet
        jobId={selectedJobId}
        open={!!selectedJobId}
        onOpenChange={(open) => !open && setSelectedJobId(null)}
      />
    </div>
  );
}

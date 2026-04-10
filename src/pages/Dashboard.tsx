import React, { useState } from 'react';
import { SEOHead } from '@/components/SEOHead';
import { ATSDashboard } from '@/components/ats/ATSDashboard';
import { ATSStatsSkeleton } from '@/components/ats/ATSStatsSkeleton';
import { CandidateDetailModal } from '@/components/ats/CandidateDetailModal';
import { JobDetailSheet } from '@/components/ats/JobDetailSheet';
import { useATSData, ATS_STAGES, ATSCandidate } from '@/hooks/useATSData';
import { useOrganization } from '@/hooks/useOrganization';
import { getOrgTypeLabel, getOrgTypeEmoji } from '@/lib/featureGates';
import { RefreshCw } from 'lucide-react';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';

export default function Dashboard() {
  const { candidates, loading, isFetching, isFromCache, refetch, handleStageChange, handleTagsChange } = useATSData();
  const { orgType } = useOrganization();
  const [selectedCandidate, setSelectedCandidate] = useState<ATSCandidate | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Dashboard | Skalr"
        description="Vue d'ensemble de votre activité recrutement"
      />

      <div className="py-6 pb-8">
        <div className="max-w-[1600px] mx-auto px-3 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2.5 min-w-0">
              <AnimatedOrb size={32} speed={0.8} />
              <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">Dashboard</h1>
            </div>

            <button
              onClick={refetch}
              disabled={loading}
              className="relative overflow-hidden h-9 px-4 flex items-center gap-2 border border-border text-foreground text-xs font-semibold group disabled:opacity-30"
            >
              <RefreshCw className={`w-3.5 h-3.5 relative z-10 ${loading ? 'animate-spin' : ''}`} />
              <span className="relative z-10">Actualiser</span>
            </button>
          </div>

          {/* Dashboard Content */}
          {loading && candidates.length === 0 ? (
            <ATSStatsSkeleton />
          ) : candidates.length === 0 ? (
            <div className="border border-border bg-background p-6 sm:p-8">
              <div className="flex items-start gap-4">
                <div className="text-4xl">👋</div>
                <div>
                  <h2 className="text-lg font-bold tracking-tight">Bienvenue sur Skalr</h2>
                  <p className="text-sm text-muted-foreground mt-1">
                    Voici les 3 étapes pour démarrer :
                  </p>
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
                <a href="/missions" className="group border border-border p-5 hover:bg-accent transition-colors">
                  <div className="text-2xl mb-2">📂</div>
                  <div className="text-xs font-bold">1. Créer une mission</div>
                  <p className="text-xs text-muted-foreground mt-1">Ajoutez votre premier poste à pourvoir</p>
                </a>
                <a href="/missions" className="group border border-border p-5 hover:bg-accent transition-colors">
                  <div className="text-2xl mb-2">🔍</div>
                  <div className="text-xs font-bold">2. Sourcer des candidats</div>
                  <p className="text-xs text-muted-foreground mt-1">Lancez une recherche LinkedIn</p>
                </a>
                <a href="/settings?tab=connectors" className="group border border-border p-5 hover:bg-accent transition-colors">
                  <div className="text-2xl mb-2">🔌</div>
                  <div className="text-xs font-bold">3. Connecter vos outils</div>
                  <p className="text-xs text-muted-foreground mt-1">Notion, Airtable, Aircall...</p>
                </a>
              </div>
              <p className="text-xs text-muted-foreground mt-4 text-center">
                Astuce : appuyez sur <kbd className="px-1.5 py-0.5 border border-border text-foreground font-mono">{isMac ? '⌘K' : 'Ctrl+K'}</kbd> à tout moment pour ouvrir le copilot IA
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
      </div>

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

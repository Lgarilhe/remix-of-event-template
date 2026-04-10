import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { Button } from '@/components/ui/button';

export default function Dashboard() {
  const { candidates, loading, isFetching, isFromCache, refetch, handleStageChange, handleTagsChange } = useATSData();
  const { orgType } = useOrganization();
  const [selectedCandidate, setSelectedCandidate] = useState<ATSCandidate | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const navigate = useNavigate();
  const hasMissions = loading ? null : candidates.length > 0;

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
          ) : (
            <>
              {hasMissions === false && (
                <div className="text-center py-12 space-y-4 mb-6">
                  <h2 className="text-sm font-bold uppercase tracking-wider">Bienvenue sur Skalr</h2>
                  <p className="text-xs text-muted-foreground max-w-md mx-auto">
                    Commencez par créer une mission pour sourcer et contacter vos candidats.
                  </p>
                  <Button onClick={() => navigate('/missions')} size="sm">
                    Créer une mission
                  </Button>
                </div>
              )}
              <ATSDashboard
                candidates={candidates}
                stages={ATS_STAGES}
                onCandidateClick={(c) => setSelectedCandidate(c)}
                onJobClick={(jobId) => setSelectedJobId(jobId)}
              />
            </>
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

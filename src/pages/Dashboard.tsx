import React, { lazy, Suspense, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { SEOHead } from '@/components/SEOHead';
// Q5 — ATSDashboard contient recharts (~100KB), lazy-load pour split chunk
const ATSDashboard = lazy(() => import('@/components/ats/ATSDashboard'));
import { ATSStatsSkeleton } from '@/components/ats/ATSStatsSkeleton';
import { CandidateDetailModal } from '@/components/ats/CandidateDetailModal';
import { JobDetailSheet } from '@/components/ats/JobDetailSheet';
import { useATSData, ATS_STAGES, ATSCandidate } from '@/hooks/useATSData';
import { useOrganization } from '@/hooks/useOrganization';
import { getOrgTypeLabel, getOrgTypeEmoji } from '@/lib/featureGates';
import { RefreshCw } from 'lucide-react';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';
import { Button } from '@/components/ui/button';
// Design system — primitives partagées
import { PageLayout, EmptyState } from '@/components/layout';

export default function Dashboard() {
  const { candidates, loading, isFetching, isFromCache, refetch, handleStageChange, handleTagsChange } = useATSData();
  const { orgType } = useOrganization();
  const [selectedCandidate, setSelectedCandidate] = useState<ATSCandidate | null>(null);
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);

  const navigate = useNavigate();
  const hasMissions = loading ? null : candidates.length > 0;

  return (
    <PageLayout maxWidth="2xl">
      <SEOHead
        title="Dashboard | Konekt"
        description="Vue d'ensemble de votre activité recrutement"
      />

      {/* Header — animated orb + title + actualiser */}
      <header className="flex items-center justify-between gap-3 mb-4 flex-wrap">
        <div className="flex items-center gap-2.5 min-w-0">
          <AnimatedOrb size={32} speed={0.8} />
          <h1 className="text-xl sm:text-2xl font-bold text-foreground tracking-tight">Dashboard</h1>
        </div>

        <Button
          onClick={refetch}
          disabled={loading}
          variant="outline"
          size="sm"
          className="h-8 gap-1.5"
          aria-label="Rafraîchir le dashboard"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          <span className="hidden sm:inline">Actualiser</span>
        </Button>
      </header>

      {/* Dashboard Content */}
      {loading && candidates.length === 0 ? (
        <ATSStatsSkeleton />
      ) : (
        <>
          {hasMissions === false && (
            <div className="mb-6">
              <EmptyState
                title="Bienvenue sur Konekt"
                description="Commencez par créer une mission pour sourcer et contacter vos candidats."
                action={
                  <Button onClick={() => navigate('/missions')} size="sm">
                    Créer une mission
                  </Button>
                }
              />
            </div>
          )}
          <Suspense fallback={<ATSStatsSkeleton />}>
            <ATSDashboard
              candidates={candidates}
              stages={ATS_STAGES}
              onCandidateClick={(c) => setSelectedCandidate(c)}
              onJobClick={(jobId) => setSelectedJobId(jobId)}
            />
          </Suspense>
        </>
      )}

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
    </PageLayout>
  );
}

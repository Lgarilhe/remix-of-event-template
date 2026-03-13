import React from 'react';
import { Navbar } from '@/components/Navbar';
import { SEOHead } from '@/components/SEOHead';
import { ATSDashboard } from '@/components/ats/ATSDashboard';
import { ATSStatsSkeleton } from '@/components/ats/ATSStatsSkeleton';
import { useATSData, ATS_STAGES } from '@/hooks/useATSData';
import { BarChart3, RefreshCw, Users } from 'lucide-react';
import { EmptyState } from '@/components/ui/EmptyState';

export default function Dashboard() {
  const { candidates, loading, isFetching, isFromCache, refetch } = useATSData();

  return (
    <div className="min-h-screen bg-background">
      <SEOHead
        title="Dashboard | Konekt"
        description="Vue d'ensemble de votre activité recrutement"
      />
      <Navbar />

      <main className="pt-16 sm:pt-20 pb-8">
        <div className="max-w-[1800px] mx-auto px-3 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="flex items-center justify-between gap-3 mb-4">
            <div className="flex items-center gap-2 min-w-0">
              <div className="h-8 w-8 bg-foreground text-background flex items-center justify-center shrink-0">
                <BarChart3 className="w-4 h-4" />
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
          ) : (
            <ATSDashboard candidates={candidates} stages={ATS_STAGES} />
          )}
        </div>
      </main>
    </div>
  );
}

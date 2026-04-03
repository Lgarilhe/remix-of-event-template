import React, { useState, useCallback } from 'react';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { BarChart3, MapPin, Building2, Briefcase, Users, Loader2, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';
import type { JobDetails } from '@/types/jobDetails';

interface InsightsData {
  totalAvailable: number;
  sampleSize: number;
  topLocations: Array<{ name: string; count: number }>;
  topCompanies: Array<{ name: string; count: number }>;
  topTitles: Array<{ name: string; count: number }>;
  seniorityDistribution: Array<{ name: string; count: number }>;
}

interface MarketInsightsPanelProps {
  project: SourcingProject;
}

const SENIORITY_LABELS: Record<string, string> = {
  senior: 'Senior',
  manager: 'Manager',
  director: 'Director',
  vp: 'VP',
  c_suite: 'C-Suite',
  entry: 'Junior/Entry',
  owner: 'Fondateur',
  partner: 'Partner',
  unknown: 'Non renseigné',
};

const BarRow: React.FC<{ label: string; count: number; max: number; color?: string }> = ({ label, count, max, color = 'bg-primary' }) => (
  <div className="flex items-center gap-2 text-xs">
    <span className="w-28 sm:w-36 truncate text-muted-foreground font-medium">{label}</span>
    <div className="flex-1 h-4 bg-muted rounded-sm overflow-hidden">
      <div
        className={cn("h-full rounded-sm transition-all duration-500", color)}
        style={{ width: `${Math.max(4, (count / max) * 100)}%` }}
      />
    </div>
    <span className="w-8 text-right tabular-nums font-semibold text-foreground">{count}</span>
  </div>
);

export const MarketInsightsPanel: React.FC<MarketInsightsPanelProps> = ({ project }) => {
  const [insights, setInsights] = useState<InsightsData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const jd = (project.job_details || {}) as JobDetails;
  const hasFilters = project.filters_snapshot && Object.keys(project.filters_snapshot).length > 0;

  const handleFetchInsights = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const snapshot = (project.filters_snapshot || {}) as Record<string, any>;
      const { data, error: fetchError } = await invokeEdgeFunction<{ success: boolean; insights?: InsightsData; error?: string }>('database-search', {
        action: 'insights',
        keywords: snapshot.keywords || '',
        role: snapshot.role || [],
        location: snapshot.location_keywords ? snapshot.location_keywords.map((l: string) => ({ name: l })) : [],
        seniority: snapshot.seniority || [],
        company_keywords: snapshot.company_keywords || [],
      });

      if (fetchError || !data?.success) {
        setError(data?.error || 'Impossible d\'analyser le marché');
        return;
      }
      setInsights(data.insights!);
    } catch (err: any) {
      setError(err.message || 'Erreur');
    } finally {
      setLoading(false);
    }
  }, [project.filters_snapshot]);

  if (!hasFilters) return null;

  if (!insights && !loading) {
    return (
      <button
        onClick={handleFetchInsights}
        className="w-full flex items-center justify-center gap-2 h-10 px-4 text-xs font-medium border border-border bg-background text-foreground hover:bg-muted transition-colors rounded-md"
      >
        <BarChart3 className="w-3.5 h-3.5" />
        Analyser le marché
      </button>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center gap-2 h-10 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        Analyse du marché en cours...
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-xs text-destructive p-2 border border-destructive/20 rounded-md bg-destructive/5">
        {error}
      </div>
    );
  }

  if (!insights) return null;

  const maxLoc = insights.topLocations[0]?.count || 1;
  const maxComp = insights.topCompanies[0]?.count || 1;
  const maxTitle = insights.topTitles[0]?.count || 1;
  const maxSeniority = insights.seniorityDistribution[0]?.count || 1;

  return (
    <div className="border border-border rounded-lg bg-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border bg-muted/30">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-primary" />
          <span className="text-sm font-semibold text-foreground">Insights marché</span>
        </div>
        <span className="text-xs text-muted-foreground">
          {insights.totalAvailable.toLocaleString('fr-FR')} profils disponibles
        </span>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4">
        {/* Top Locations */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
            <MapPin className="w-3 h-3" /> Localisation
          </p>
          <div className="space-y-1">
            {insights.topLocations.slice(0, 6).map((loc, i) => (
              <BarRow key={i} label={loc.name} count={loc.count} max={maxLoc} color="bg-primary" />
            ))}
          </div>
        </div>

        {/* Top Companies */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
            <Building2 className="w-3 h-3" /> Entreprises principales
          </p>
          <div className="space-y-1">
            {insights.topCompanies.slice(0, 6).map((comp, i) => (
              <BarRow key={i} label={comp.name} count={comp.count} max={maxComp} color="bg-accent" />
            ))}
          </div>
        </div>

        {/* Top Titles */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
            <Briefcase className="w-3 h-3" /> Titres les plus courants
          </p>
          <div className="space-y-1">
            {insights.topTitles.slice(0, 6).map((title, i) => (
              <BarRow key={i} label={title.name} count={title.count} max={maxTitle} color="bg-info" />
            ))}
          </div>
        </div>

        {/* Seniority Distribution */}
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground flex items-center gap-1.5">
            <Users className="w-3 h-3" /> Séniorité
          </p>
          <div className="space-y-1">
            {insights.seniorityDistribution.slice(0, 6).map((s, i) => (
              <BarRow key={i} label={SENIORITY_LABELS[s.name] || s.name} count={s.count} max={maxSeniority} color="bg-warning" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};

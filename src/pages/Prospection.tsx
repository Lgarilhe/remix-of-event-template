import React, { useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Navbar } from '@/components/Navbar';
import { SEOHead } from '@/components/SEOHead';
import { ICPList } from '@/components/outreach/icp';
import { ProspectSearch } from '@/components/prospection/ProspectSearch';
import { VivierList } from '@/components/prospection/VivierList';
import { ProspectResults } from '@/components/prospection/ProspectResults';
import { Crosshair } from 'lucide-react';
import { cn } from '@/lib/utils';
import { ICP } from '@/hooks/useICPs';
import { ProspectProfile } from '@/types/prospects';

const tabs = [
  { value: 'search', label: 'Recherche', emoji: '🔍' },
  { value: 'vivier', label: 'Vivier', emoji: '📋' },
  { value: 'icp', label: 'ICP', emoji: '🎯' },
] as const;

export default function Prospection() {
  const [searchParams, setSearchParams] = useSearchParams();
  const validTabs = tabs.map(t => t.value) as string[];
  const tabFromUrl = searchParams.get('tab');
  const activeTab = validTabs.includes(tabFromUrl || '') ? tabFromUrl! : 'search';

  const setActiveTab = useCallback((tab: string) => {
    setSearchParams(prev => {
      const next = new URLSearchParams(prev);
      next.set('tab', tab);
      return next;
    }, { replace: true });
  }, [setSearchParams]);

  const [results, setResults] = useState<ProspectProfile[]>([]);
  const [searching, setSearching] = useState(false);
  const [selectedICP, setSelectedICP] = useState<ICP | null>(null);

  const handleSearchFromICP = useCallback((icp: ICP) => {
    setSelectedICP(icp);
    setActiveTab('search');
  }, [setActiveTab]);

  return (
    <div className="min-h-screen w-full max-w-full bg-background">
      <SEOHead
        title="Prospection | Konekt"
        description="Découvrez et qualifiez des prospects grâce à l'enrichissement de données et aux signaux d'intention"
      />
      <Navbar />

      <main className="pt-16 sm:pt-20 pb-8 w-full max-w-full">
        <div className="max-w-[1600px] mx-auto w-full min-w-0 px-3 sm:px-6 lg:px-8">
          {/* Compact header bar with title + tabs inline */}
          <div className="flex items-center gap-3 mb-3 md:mb-5">
            {/* Title — desktop only */}
            <div className="hidden md:flex items-center gap-2 shrink-0">
              <div className="h-8 w-8 bg-foreground text-background flex items-center justify-center shrink-0">
                <Crosshair className="w-4 h-4" />
              </div>
              <h1 className="text-lg font-bold text-foreground uppercase tracking-tight">Prospection</h1>
            </div>

            {/* Separator — desktop only */}
            <div className="hidden md:block w-px h-6 bg-border" />

            {/* Tabs */}
            <div className="flex gap-0 min-w-0 overflow-x-auto no-scrollbar">
              {tabs.map((tab, index) => {
                const isActive = activeTab === tab.value;
                return (
                  <button
                    key={tab.value}
                    onClick={() => setActiveTab(tab.value)}
                    className={cn(
                      "relative overflow-hidden flex items-center justify-center gap-1 h-[34px] px-3 sm:px-4 text-[10px] sm:text-xs font-medium uppercase tracking-wider border border-foreground transition-colors duration-200 group shrink-0",
                      index > 0 && "border-l-0",
                      isActive
                        ? "bg-brutal-accent text-foreground"
                        : "bg-background text-foreground"
                    )}
                  >
                    <span className="text-sm shrink-0 relative z-10">{tab.emoji}</span>
                    <span className="relative z-10 whitespace-nowrap">{tab.label}</span>
                    {!isActive && (
                      <span className="absolute inset-0 bg-brutal-accent translate-y-full group-hover:translate-y-0 transition-transform duration-300 ease-out"></span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* Content */}
          <div className={cn("mt-0 min-w-0", activeTab !== 'vivier' && 'hidden')}>
            <VivierList />
          </div>
          <div className={cn("mt-0 min-w-0", activeTab !== 'icp' && 'hidden')}>
            <ICPList onSearchFromICP={handleSearchFromICP} />
          </div>
          <div className={cn("mt-0 min-w-0", activeTab !== 'search' && 'hidden')}>
            <ProspectSearch
              selectedICP={selectedICP}
              onSelectICP={setSelectedICP}
              onResults={setResults}
              searching={searching}
              onSearchingChange={setSearching}
              results={results}
            />
          </div>
        </div>
      </main>
    </div>
  );
}

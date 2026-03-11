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
import { motion, AnimatePresence } from 'framer-motion';

const tabs = [
  { value: 'search', label: 'Recherche', emoji: '🔍' },
  { value: 'vivier', label: 'Vivier', emoji: '📋' },
  { value: 'icp', label: 'ICP', emoji: '🎯' },
] as const;

export interface ProspectProfile {
  id: string;
  full_name: string;
  first_name?: string;
  last_name?: string;
  headline?: string;
  profile_pic_url?: string | null;
  job_title?: string;
  job_title_role?: string;
  job_title_levels?: string[];
  job_company_name?: string;
  job_company_industry?: string;
  job_company_size?: string;
  job_company_founded?: number;
  job_company_funding_raised?: number;
  job_company_funding_stage?: string;
  job_company_website?: string | null;
  job_company_linkedin_url?: string | null;
  job_start_date?: string;
  location_name?: string;
  location_locality?: string;
  location_region?: string;
  location_country?: string;
  linkedin_url?: string;
  emails?: string[];
  phone_numbers?: string[];
  skills?: string[];
  experience?: { title: string; company: string; start_date?: string; end_date?: string }[];
  education?: { school: string; degree?: string }[];
  intent_signals?: {
    job_change?: boolean;
    recently_funded?: boolean;
    hiring?: boolean;
  };
  score?: number;
  source?: 'pdl' | 'apollo';
}

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
        <div className="max-w-[1800px] mx-auto w-full min-w-0 px-3 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="flex items-center gap-2 mb-4 hidden md:flex">
            <div className="h-8 w-8 bg-foreground text-background flex items-center justify-center shrink-0">
              <Crosshair className="w-4 h-4" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground uppercase tracking-tight">Prospection</h1>
          </div>

          {/* Tabs */}
          <div className="mb-3 md:mb-5">
            <div className="flex gap-0 w-full min-w-0 overflow-x-auto no-scrollbar">
              {tabs.map((tab, index) => {
                const isActive = activeTab === tab.value;
                return (
                  <button
                    key={tab.value}
                    onClick={() => setActiveTab(tab.value)}
                    className={cn(
                      "relative overflow-hidden flex items-center justify-center gap-1 h-[34px] px-2 sm:px-4 text-[10px] sm:text-xs font-medium uppercase tracking-wider border border-foreground transition-colors duration-200 group shrink-0",
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
          <AnimatePresence mode="wait">
            {/* Vivier tab */}
            {activeTab === 'vivier' && (
              <motion.div
                key="vivier"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                className="min-w-0"
              >
                <VivierList />
              </motion.div>
            )}

            {/* ICP tab */}
            {activeTab === 'icp' && (
              <motion.div
                key="icp"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                className="min-w-0"
              >
                <ICPList onSearchFromICP={handleSearchFromICP} />
              </motion.div>
            )}

            {/* Search tab */}
            {activeTab === 'search' && (
              <motion.div
                key="search"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8 }}
                transition={{ duration: 0.25 }}
                className="min-w-0"
              >
                <ProspectSearch
                  selectedICP={selectedICP}
                  onSelectICP={setSelectedICP}
                  onResults={setResults}
                  searching={searching}
                  onSearchingChange={setSearching}
                  results={results}
                />
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </main>
    </div>
  );
}

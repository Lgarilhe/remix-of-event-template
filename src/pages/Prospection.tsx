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

      <main className="pt-20 pb-0 w-full max-w-full">
        <div className="max-w-[1600px] mx-auto w-full min-w-0 px-3 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="flex items-center gap-2 mb-4 hidden md:flex">
            <div className="h-8 w-8 bg-foreground text-background flex items-center justify-center shrink-0">
              <Crosshair className="w-4 h-4" />
            </div>
            <h1 className="text-xl sm:text-2xl font-bold text-foreground uppercase tracking-tight">Prospection</h1>
          </div>

          {/* Tabs */}
          <motion.div
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3, delay: 0.1 }}
            className="mb-4 md:mb-6"
          >
            <div className="inline-flex gap-1 p-1 rounded-xl bg-muted/60 backdrop-blur-sm border border-border/50">
              {tabs.map((tab) => {
                const isActive = activeTab === tab.value;
                return (
                  <button
                    key={tab.value}
                    onClick={() => setActiveTab(tab.value)}
                    className={cn(
                      "relative flex items-center gap-1.5 h-9 px-4 text-xs font-semibold rounded-lg transition-all duration-200",
                      isActive
                        ? "bg-background text-foreground shadow-sm"
                        : "text-muted-foreground hover:text-foreground hover:bg-background/50"
                    )}
                  >
                    <span className="text-sm">{tab.emoji}</span>
                    <span className="whitespace-nowrap">{tab.label}</span>
                  </button>
                );
              })}
            </div>
          </motion.div>

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

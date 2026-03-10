import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Search, Target, Loader2, Building2, MapPin, Briefcase, Code, TrendingUp, Zap } from 'lucide-react';
import { useICPs, ICP, ICPCriteria } from '@/hooks/useICPs';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { ProspectProfile } from '@/pages/Prospection';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

interface ProspectSearchProps {
  selectedICP: ICP | null;
  onSelectICP: (icp: ICP | null) => void;
  onResults: (results: ProspectProfile[]) => void;
  searching: boolean;
  onSearchingChange: (v: boolean) => void;
}

export function ProspectSearch({ selectedICP, onSelectICP, onResults, searching, onSearchingChange }: ProspectSearchProps) {
  const { icps, isLoading: icpsLoading } = useICPs();

  // Search params derived from ICP or manual
  const [jobTitle, setJobTitle] = useState('');
  const [company, setCompany] = useState('');
  const [location, setLocation] = useState('');
  const [industry, setIndustry] = useState('');
  const [companySize, setCompanySize] = useState('');
  const [skills, setSkills] = useState('');
  const [fundingStage, setFundingStage] = useState('');
  const [intentJobChange, setIntentJobChange] = useState(false);
  const [intentFunding, setIntentFunding] = useState(false);
  const [intentHiring, setIntentHiring] = useState(false);

  // Apply ICP criteria to search fields
  useEffect(() => {
    if (!selectedICP) return;
    const c = selectedICP.criteria;
    setJobTitle(c.target_titles?.join(', ') || '');
    setLocation(c.geographies?.join(', ') || '');
    setIndustry(c.industries?.[0] || '');
    setSkills(c.technologies?.join(', ') || '');
    setCompanySize(c.company_sizes?.[0] || '');
    setFundingStage(c.funding_stages?.[0] || '');
  }, [selectedICP]);

  const handleSearch = async () => {
    onSearchingChange(true);
    try {
      const { data, error } = await invokeEdgeFunction<{ prospects: ProspectProfile[] }>('pdl-search', {
        job_title: jobTitle || undefined,
        company: company || undefined,
        location: location || undefined,
        industry: industry || undefined,
        company_size: companySize || undefined,
        skills: skills ? skills.split(',').map(s => s.trim()) : undefined,
        funding_stage: fundingStage || undefined,
        intent_job_change: intentJobChange || undefined,
        intent_funding: intentFunding || undefined,
        intent_hiring: intentHiring || undefined,
        icp_id: selectedICP?.id,
      });

      if (error) throw error;
      if (!data?.success) throw new Error(data?.error || 'Erreur recherche');

      const prospects = (data as any).prospects || [];
      onResults(prospects);
      toast.success(`${prospects.length} prospect(s) trouvé(s)`);
    } catch (err: any) {
      console.error('[ProspectSearch] Error:', err);
      toast.error(err.message || 'Erreur lors de la recherche');
    } finally {
      onSearchingChange(false);
    }
  };

  return (
    <div className="bg-background border border-foreground p-3 sm:p-6">
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2">
          <Search className="w-4 h-4" />
          <h2 className="text-sm font-bold uppercase tracking-wider">Recherche de Prospects</h2>
        </div>
      </div>

      {/* ICP selector */}
      {icps.length > 0 && (
        <div className="mb-5">
          <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-1.5 block">
            Pré-remplir depuis un ICP
          </label>
          <Select
            value={selectedICP?.id || 'none'}
            onValueChange={(v) => {
              const icp = icps.find(i => i.id === v) || null;
              onSelectICP(icp);
            }}
          >
            <SelectTrigger className="h-8 border-foreground/20 max-w-sm">
              <SelectValue placeholder="Sélectionner un ICP..." />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">— Aucun —</SelectItem>
              {icps.map(icp => (
                <SelectItem key={icp.id} value={icp.id}>
                  {icp.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {selectedICP && (
            <Badge variant="outline" className="mt-2 text-[10px] border-foreground/20 gap-1">
              <Target className="w-3 h-3" /> ICP: {selectedICP.name}
            </Badge>
          )}
        </div>
      )}

      {/* Search filters grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-5">
        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-foreground flex items-center gap-1">
            <Briefcase className="w-3 h-3" /> Poste / Titre
          </label>
          <Input
            value={jobTitle}
            onChange={e => setJobTitle(e.target.value)}
            placeholder="CTO, VP Engineering..."
            className="h-8 text-sm border-foreground/20 focus:border-foreground"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-foreground flex items-center gap-1">
            <Building2 className="w-3 h-3" /> Entreprise
          </label>
          <Input
            value={company}
            onChange={e => setCompany(e.target.value)}
            placeholder="Nom d'entreprise..."
            className="h-8 text-sm border-foreground/20 focus:border-foreground"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-foreground flex items-center gap-1">
            <MapPin className="w-3 h-3" /> Localisation
          </label>
          <Input
            value={location}
            onChange={e => setLocation(e.target.value)}
            placeholder="Paris, France..."
            className="h-8 text-sm border-foreground/20 focus:border-foreground"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-foreground flex items-center gap-1">
            <Building2 className="w-3 h-3" /> Secteur
          </label>
          <Input
            value={industry}
            onChange={e => setIndustry(e.target.value)}
            placeholder="SaaS, FinTech..."
            className="h-8 text-sm border-foreground/20 focus:border-foreground"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-foreground flex items-center gap-1">
            <Building2 className="w-3 h-3" /> Taille entreprise
          </label>
          <Select value={companySize} onValueChange={setCompanySize}>
            <SelectTrigger className="h-8 border-foreground/20">
              <SelectValue placeholder="Toutes tailles" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Toutes tailles</SelectItem>
              <SelectItem value="1-10">1-10</SelectItem>
              <SelectItem value="11-50">11-50</SelectItem>
              <SelectItem value="51-200">51-200</SelectItem>
              <SelectItem value="201-500">201-500</SelectItem>
              <SelectItem value="501-1000">501-1000</SelectItem>
              <SelectItem value="1001-5000">1001-5000</SelectItem>
              <SelectItem value="5001-10000">5001-10000</SelectItem>
              <SelectItem value="10001+">10001+</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-foreground flex items-center gap-1">
            <Code className="w-3 h-3" /> Compétences
          </label>
          <Input
            value={skills}
            onChange={e => setSkills(e.target.value)}
            placeholder="React, Python, AWS..."
            className="h-8 text-sm border-foreground/20 focus:border-foreground"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-xs font-medium uppercase tracking-wider text-foreground flex items-center gap-1">
            <TrendingUp className="w-3 h-3" /> Stade de financement
          </label>
          <Select value={fundingStage} onValueChange={setFundingStage}>
            <SelectTrigger className="h-8 border-foreground/20">
              <SelectValue placeholder="Tous stades" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Tous stades</SelectItem>
              <SelectItem value="early_stage">Early Stage (Seed/A)</SelectItem>
              <SelectItem value="growth">Growth (B/C)</SelectItem>
              <SelectItem value="late_stage">Late Stage (D+)</SelectItem>
              <SelectItem value="ipo">IPO / Public</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* Intent signals */}
      <div className="mb-5">
        <label className="text-xs font-medium uppercase tracking-wider text-muted-foreground mb-2 block flex items-center gap-1">
          <Zap className="w-3 h-3" /> Signaux d'intention
        </label>
        <div className="flex flex-wrap gap-2">
          {[
            { key: 'jobChange', label: '🔄 Changement de poste', active: intentJobChange, toggle: () => setIntentJobChange(!intentJobChange) },
            { key: 'funding', label: '💰 Levée de fonds récente', active: intentFunding, toggle: () => setIntentFunding(!intentFunding) },
            { key: 'hiring', label: '📢 Recrutement actif', active: intentHiring, toggle: () => setIntentHiring(!intentHiring) },
          ].map(signal => (
            <button
              key={signal.key}
              onClick={signal.toggle}
              className={cn(
                "px-3 py-1.5 text-xs border transition-colors",
                signal.active
                  ? "bg-foreground text-background border-foreground"
                  : "bg-background text-foreground border-foreground/20 hover:border-foreground/50"
              )}
            >
              {signal.label}
            </button>
          ))}
        </div>
      </div>

      {/* Search button */}
      <Button
        onClick={handleSearch}
        disabled={searching || (!jobTitle && !company && !location && !industry && !skills)}
        className="h-[34px] px-6 bg-foreground text-background hover:bg-foreground/90 text-xs font-medium uppercase tracking-wider gap-2"
      >
        {searching ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
        {searching ? 'Recherche en cours...' : 'Lancer la recherche'}
      </Button>
    </div>
  );
}

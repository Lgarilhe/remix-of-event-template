import React, { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ArrowLeft, ArrowRight, Building2, Loader2, Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { useOrganization } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { supabase } from '@/integrations/supabase/client';
import { toast } from 'sonner';
import type { OnboardingCompanyData } from '@/pages/Onboarding';

/**
 * SceneCompany — écran 2 du flow onboarding (refonte 06/07/2026).
 *
 * Remplace SceneOrganization (930 lignes) : matching société express via
 * enrich-company mode quick_match (~1-2 s, 1 appel), création d'org immédiate.
 * L'enrichissement COMPLET (postes ouverts, insights…) est lancé en arrière-plan
 * par l'orchestrateur après création — aucune attente bloquante ici, le résultat
 * atterrit sur le dashboard (carte « postes détectés », brouillons IA).
 */

interface QuickCompany {
  name: string;
  officialName?: string | null;
  domain: string | null;
  industry: string | null;
  size: string | null;
  location: string | null;
  description: string | null;
  linkedinUrl: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
}

interface DisambiguationCandidate {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
  size: string | null;
  logoUrl: string | null;
}

interface Props {
  onComplete: (companyData: OnboardingCompanyData, orgId: string | null) => void;
  onBack: () => void;
  /** Org déjà créée dans cette session (retour arrière) : réutilisée au lieu
   *  d'en créer une deuxième. */
  createdOrgId?: string | null;
}

type Phase = 'idle' | 'matching' | 'confirm' | 'disambiguate';

const generateSlug = (value: string) =>
  value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const SceneCompany: React.FC<Props> = ({ onComplete, onBack, createdOrgId }) => {
  const { createOrganization } = useOrganization();

  const [query, setQuery] = useState('');
  const [phase, setPhase] = useState<Phase>('idle');
  const [company, setCompany] = useState<QuickCompany | null>(null);
  const [candidates, setCandidates] = useState<DisambiguationCandidate[]>([]);
  const [isCreating, setIsCreating] = useState(false);
  // Choix de désambiguïsation (id Apollo ou '__none__') : DOIT être propagé au
  // run d'enrichissement complet en arrière-plan, sinon celui-ci re-tombe sur
  // la désambiguïsation (snapshot jamais écrit) ou re-matche la mauvaise société.
  const [matchedApolloId, setMatchedApolloId] = useState<string | null>(null);

  const startMatch = useCallback(async (name: string, selectedId?: string) => {
    setPhase('matching');
    setMatchedApolloId(selectedId ?? null);
    try {
      const { data, error } = await invokeEdgeFunction<{
        company: QuickCompany;
        disambiguate?: boolean;
        candidates?: DisambiguationCandidate[];
      }>('enrich-company', {
        company_name: name,
        country: 'France',
        mode: 'quick_match',
        ...(selectedId ? { selected_apollo_id: selectedId } : {}),
      });

      if (error || !data?.success) {
        // Pas bloquant : on continue avec le nom seul.
        setCompany({
          name, domain: null, industry: null, size: null, location: null,
          description: null, linkedinUrl: null, websiteUrl: null, logoUrl: null,
        });
        setPhase('confirm');
        return;
      }

      if (data.disambiguate && data.candidates?.length) {
        setCandidates(data.candidates);
        setPhase('disambiguate');
        return;
      }

      setCompany(data.company);
      setPhase('confirm');
    } catch (err) {
      console.error('[SceneCompany] quick match error:', err);
      setCompany({
        name, domain: null, industry: null, size: null, location: null,
        description: null, linkedinUrl: null, websiteUrl: null, logoUrl: null,
      });
      setPhase('confirm');
    }
  }, []);

  const handleSearch = () => {
    if (query.trim().length >= 2 && phase !== 'matching') {
      startMatch(query.trim());
    }
  };

  const handleCreate = async () => {
    if (!company) return;
    setIsCreating(true);
    try {
      const displayName = company.officialName || company.name;
      const website = company.websiteUrl || (company.domain ? `https://${company.domain}` : null);
      const logoUrl = company.logoUrl || (company.domain ? `https://logo.clearbit.com/${company.domain}` : null);

      // Anti-doublon : réutilise l'org créée en session si retour arrière.
      let orgId = createdOrgId ?? null;
      if (!orgId) {
        const org = await createOrganization({
          name: displayName,
          slug: generateSlug(displayName),
          website,
          logoUrl,
        });
        orgId = org?.id ?? null;
      } else {
        // Org déjà créée (ex. auto-créée en freelance puis switch entreprise) :
        // on aligne son identité sur la société confirmée au lieu de garder
        // le nom de la personne sans logo ni site.
        const { error } = await supabase
          .from('organizations')
          .update({ name: displayName, website, logo_url: logoUrl })
          .eq('id', orgId);
        if (error) console.error('[SceneCompany] Org identity update failed:', error);
      }

      onComplete({
        name: displayName,
        domain: company.domain,
        linkedinUrl: company.linkedinUrl,
        careersUrl: null,
        apolloId: matchedApolloId,
      }, orgId);
    } catch (err: any) {
      const msg = err?.message || '';
      if (msg.includes('duplicate key') || msg.includes('organizations_slug_key')) {
        toast.error('Cette organisation existe déjà.');
      } else {
        toast.error(msg || 'Erreur lors de la création');
      }
    } finally {
      setIsCreating(false);
    }
  };

  const companyMeta = company
    ? [company.domain, company.industry, company.size ? `${company.size} emp.` : null, company.location]
        .filter(Boolean).join(' · ')
    : '';

  return (
    <div className="w-full max-w-lg mx-auto flex flex-col gap-5">
      {/* Header */}
      <div className="text-center space-y-2">
        <span
          className="skalr-gradient-text text-xs uppercase tracking-wider font-semibold"
          style={{ fontFamily: "'Space Mono', monospace" }}
        >
          02 — Votre société
        </span>
        <h2 className="font-editorial italic text-3xl md:text-4xl">Créez votre espace</h2>
        <p className="text-muted-foreground text-sm">
          Entrez le nom de votre société — on s'occupe du reste en arrière-plan.
        </p>
      </div>

      {/* Search input */}
      <div className="flex gap-2">
        <Input
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            if (phase !== 'idle' && phase !== 'matching') setPhase('idle');
          }}
          onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSearch(); } }}
          placeholder="Nom de votre société"
          className="flex-1 border border-border text-sm h-10"
          disabled={phase === 'matching'}
        />
        <Button
          onClick={handleSearch}
          disabled={query.trim().length < 2 || phase === 'matching'}
          className="h-10 gap-2 border border-border bg-foreground text-background hover:bg-foreground/90 text-sm px-4"
          style={{ boxShadow: '2px 2px 0px 0px hsl(var(--primary))' }}
        >
          {phase === 'matching' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
          Rechercher
        </Button>
      </div>

      <AnimatePresence mode="wait">
        {/* Disambiguation */}
        {phase === 'disambiguate' && candidates.length > 0 && (
          <motion.div
            key="disambiguate"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-2"
          >
            <p className="text-sm font-semibold text-center">Plusieurs entreprises trouvées — sélectionnez la vôtre</p>
            {candidates.map((c) => (
              <button
                key={c.id}
                onClick={() => startMatch(query.trim(), c.id)}
                className="w-full text-left border border-border hover:border-foreground/40 p-3 flex items-center gap-3 transition-all"
              >
                {c.logoUrl || c.domain ? (
                  <img
                    src={c.logoUrl || `https://logo.clearbit.com/${c.domain}`}
                    alt={c.name}
                    className="w-8 h-8 object-contain shrink-0"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                  />
                ) : (
                  <div className="w-8 h-8 bg-muted flex items-center justify-center shrink-0">
                    <Building2 className="w-4 h-4 text-muted-foreground" />
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-bold truncate">{c.name}</p>
                  <p className="text-xs text-muted-foreground truncate">
                    {[c.domain, c.industry, c.location].filter(Boolean).join(' · ')}
                  </p>
                </div>
                <ArrowRight className="w-4 h-4 text-muted-foreground shrink-0" />
              </button>
            ))}
            <button
              onClick={() => startMatch(query.trim(), '__none__')}
              className="w-full text-center text-xs text-muted-foreground hover:text-foreground underline underline-offset-2 py-1"
            >
              Aucune ne correspond — continuer avec les infos de base
            </button>
          </motion.div>
        )}

        {/* Confirmed company */}
        {phase === 'confirm' && company && (
          <motion.div
            key="confirm"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
            className="space-y-3"
          >
            <div className="border-2 border-border p-4 flex items-center gap-3" style={{ boxShadow: '3px 3px 0px 0px hsl(var(--primary))' }}>
              {(company.logoUrl || company.domain) ? (
                <img
                  src={company.logoUrl || `https://logo.clearbit.com/${company.domain}`}
                  alt={company.name}
                  className="w-10 h-10 object-contain shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              ) : (
                <div className="w-10 h-10 bg-muted flex items-center justify-center shrink-0">
                  <Building2 className="w-5 h-5 text-muted-foreground" />
                </div>
              )}
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold truncate">{company.officialName || company.name}</p>
                {companyMeta && <p className="text-xs text-muted-foreground truncate">{companyMeta}</p>}
              </div>
            </div>
            <p className="text-xs text-muted-foreground border-l-2 border-foreground/30 pl-3">
              L'analyse complète (postes ouverts, insights société) continue en arrière-plan —
              vous la retrouverez sur votre tableau de bord.
            </p>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Navigation */}
      <div className="flex items-center justify-between pt-2">
        <Button variant="outline" onClick={onBack} className="gap-2 border border-border text-sm">
          <ArrowLeft className="w-4 h-4" /> Retour
        </Button>
        <Button
          onClick={handleCreate}
          disabled={phase !== 'confirm' || !company || isCreating}
          className="gap-2 border border-border bg-foreground text-background hover:bg-foreground/90 text-sm px-6"
          style={{ boxShadow: '3px 3px 0px 0px hsl(var(--primary))' }}
        >
          {isCreating ? <Loader2 className="w-4 h-4 animate-spin" /> : <ArrowRight className="w-4 h-4" />}
          {isCreating ? 'Création…' : 'Créer mon espace'}
        </Button>
      </div>
    </div>
  );
};

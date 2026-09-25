import React, { useState, useCallback, useId, useMemo } from 'react';
import {
  AlertTriangle, ArrowLeft, ArrowRight, Briefcase, Check, Euro, ExternalLink, GitBranch, Globe,
  Heart, Lightbulb, MapPin, Newspaper, RefreshCw, Search, Target, TrendingUp, Users, Zap,
} from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Checkbox } from '@/components/ui/checkbox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import { useOrganization, ORG_ALREADY_EXISTS } from '@/hooks/useOrganization';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { supabase } from '@/integrations/supabase/client';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import linkedinLogo from '@/assets/linkedin-logo.webp';

const WTTJ_LOGO = 'https://www.welcometothejungle.com/assets/images/logos/wttj.svg';
const WTTJ_FALLBACK = 'https://cdn.welcometothejungle.com/wttj-front/production/assets/images/logos/wttj.svg';

import type { OnboardingCompanyData } from '@/pages/Onboarding';
import type { OrgType } from './onboardingMeta';

/* ─── Types ─── */
interface Props {
  /** Type choisi à l'étape précédente, écrit dans l'INSERT de l'organisation */
  orgType: OrgType;
  onComplete: (companyData: OnboardingCompanyData) => void;
  onBack?: () => void;
  /** true = second espace explicitement demandé (`?new=1`) : pas de confirmation */
  allowSecondWorkspace?: boolean;
}

interface StructuredInsight {
  key: 'difficulty' | 'salary' | 'attractivity' | 'timing';
  title: string;
  body: string;
}

interface CompanyData {
  name: string;
  domain: string | null;
  industry: string | null;
  size: string | null;
  location: string | null;
  funding: string | null;
  description: string | null;
  techStack: string[];
  insights: string[];
  structuredInsights?: StructuredInsight[];
  decisionMakers: { name: string; role: string; linkedinUrl?: string | null }[];
  openRoles: { title: string; location: string; source: string; department?: string; url?: string }[];
  linkedinUrl: string | null;
  websiteUrl: string | null;
  logoUrl: string | null;
  careersUrl?: string | null;
  foundedYear?: number | null;
  linkedinFollowers?: number | null;
  annualRevenue?: string | null;
  keywords?: string[];
  jobPostingsCount?: number | null;
  signals?: Array<{ type: string; label: string; color: string }>;
  departmentalHeadcount?: Record<string, number>;
  fundingEvents?: Array<{ date: string; type: string; amount?: number; investors?: string[] }>;
  newsArticles?: Array<{ title: string; url: string; published_at: string; source: string }>;
  suborganizations?: string[];
  numSuborganizations?: number;
  intentStrength?: number | null;
}

interface ApolloCandidate {
  id: string;
  name: string;
  domain: string | null;
  industry: string | null;
  location: string | null;
  size: string | null;
  logoUrl: string | null;
}

type TabKey = 'overview' | 'insights' | 'roles';

const baseCompany = (name: string): CompanyData => ({
  name,
  domain: null, industry: null, size: null, location: null,
  funding: null, description: null, techStack: [], insights: [],
  decisionMakers: [], openRoles: [], linkedinUrl: null, websiteUrl: null, logoUrl: null,
  careersUrl: null,
});

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  return (parts.length > 1 ? parts[0][0] + parts[1][0] : name.slice(0, 2)).toUpperCase();
}

/**
 * Logo de la société : image trouvée, puis icône du site, puis initiales
 * neutres. Plus d'avatar généré en couleur aléatoire (B-64).
 */
const CompanyLogo: React.FC<{ name: string; logoUrl: string | null; domain: string | null; size?: 'sm' | 'md' }> = ({
  name, logoUrl, domain, size = 'md',
}) => {
  const sources = useMemo(
    () =>
      [
        logoUrl || (domain ? `https://logo.clearbit.com/${domain}` : null),
        domain ? `https://www.google.com/s2/favicons?domain=${domain}&sz=128` : null,
      ].filter((s): s is string => !!s),
    [logoUrl, domain],
  );
  const [failed, setFailed] = useState(0);
  const src = sources[failed] ?? null;
  const box = size === 'md' ? 'h-12 w-12 text-sm' : 'h-8 w-8 text-xs';

  if (!src) {
    return (
      <span aria-hidden="true" className={cn('grid shrink-0 place-items-center rounded-lg bg-muted font-semibold text-foreground-secondary', box)}>
        {initials(name)}
      </span>
    );
  }
  return (
    <img
      src={src}
      alt=""
      referrerPolicy="no-referrer"
      onError={() => setFailed((n) => n + 1)}
      className={cn('shrink-0 rounded-lg border border-border bg-background object-contain', box)}
    />
  );
};

/* ─── Component ─── */
export const SceneOrganization: React.FC<Props> = ({ orgType, onComplete, onBack, allowSecondWorkspace = false }) => {
  const [query, setQuery] = useState('');
  const [searchedName, setSearchedName] = useState('');
  const [phase, setPhase] = useState<'idle' | 'scanning' | 'disambiguate' | 'results'>('idle');
  const [company, setCompany] = useState<CompanyData | null>(null);
  // Fiche réduite au nom quand la recherche a échoué : jamais présentée comme enrichie.
  const [enrichFailed, setEnrichFailed] = useState(false);
  const [disambiguationCandidates, setDisambiguationCandidates] = useState<ApolloCandidate[]>([]);
  const [activeTab, setActiveTab] = useState<TabKey>('overview');
  const [selectedRoles, setSelectedRoles] = useState<Set<number>>(new Set());
  const [isCreating, setIsCreating] = useState(false);
  // F3 : l'utilisateur a déjà un espace → confirmation explicite avant d'en créer un second
  const [confirmSecondOpen, setConfirmSecondOpen] = useState(false);
  const { createOrganization } = useOrganization();
  const inputId = useId();

  // La fiche s'affiche dès que la réponse arrive : plus d'animation minimale
  // ni de sources cochées sur minuterie (B-62).
  const startScan = useCallback(async (name: string, selectedApolloId?: string) => {
    setPhase('scanning');
    setSearchedName(name);
    setCompany(null);
    setEnrichFailed(false);
    setDisambiguationCandidates([]);
    setActiveTab('overview');
    setSelectedRoles(new Set());

    try {
      const { data, error } = await invokeEdgeFunction<{ company: CompanyData; disambiguate?: boolean; candidates?: ApolloCandidate[] }>('enrich-company', {
        company_name: name,
        country: 'France',
        force_refresh: true,
        ...(selectedApolloId ? { selected_apollo_id: selectedApolloId } : {}),
      });

      if (error || !data?.success) {
        console.error('[SceneOrganization] Enrichment failed:', error || data?.error);
        setCompany(baseCompany(name));
        setEnrichFailed(true);
        setPhase('results');
        return;
      }

      // Plusieurs sociétés possibles : l'utilisateur choisit
      if (data.disambiguate && data.candidates?.length) {
        setDisambiguationCandidates(data.candidates);
        setPhase('disambiguate');
        return;
      }

      setCompany(data.company);
      setPhase('results');
    } catch (err) {
      console.error('[SceneOrganization] Error:', err);
      setCompany(baseCompany(name));
      setEnrichFailed(true);
      setPhase('results');
    }
  }, []);

  const selectCandidate = useCallback((apolloId: string) => {
    startScan(query.trim(), apolloId);
  }, [query, startScan]);

  const handleInputChange = (val: string) => {
    setQuery(val);
    // Reset to idle when clearing input
    if (val.trim().length < 2 && phase !== 'idle') {
      setPhase('idle');
    }
  };

  const handleSearch = () => {
    if (query.trim().length >= 2 && phase !== 'scanning') {
      startScan(query.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleSearch();
    }
  };

  const toggleRole = (idx: number) => {
    setSelectedRoles((prev) => {
      const next = new Set(prev);
      next.has(idx) ? next.delete(idx) : next.add(idx);
      return next;
    });
  };

  const generateSlug = (value: string) =>
    value.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

  const handleContinue = async (confirmSecond = false) => {
    if (!company) return;
    setIsCreating(true);
    try {
      const org = await createOrganization({
        name: company.name,
        slug: generateSlug(company.name),
        website: company.websiteUrl || (company.domain ? `https://${company.domain}` : null),
        logoUrl: company.logoUrl || (company.domain ? `https://logo.clearbit.com/${company.domain}` : null),
        orgType,
        confirmSecond,
      });

      // Create sourcing projects for selected roles
      if (selectedRoles.size > 0 && org?.id) {
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          const uniqueRoles = dedupeRoles(company.openRoles);
          const projectsToCreate = Array.from(selectedRoles)
            .filter((idx) => idx < uniqueRoles.length)
            .map((idx) => {
              const role = uniqueRoles[idx];
              return {
                name: role.title,
                job_title: role.title,
                client_name: company.name,
                description: role.location ? `Lieu : ${role.location}` : null,
                organization_id: org.id,
                created_by: user.id,
                filters_snapshot: {},
                status: 'active',
              };
            });

          if (projectsToCreate.length > 0) {
            const { error: projError } = await supabase
              .from('sourcing_projects')
              .insert(projectsToCreate as any);
            if (projError) {
              // L'espace existe : on continue, mais l'échec se dit (B-64).
              console.error('[Onboarding] Failed to create projects:', projError);
              toast.error(
                projectsToCreate.length > 1
                  ? "Votre espace est créé, mais les postes choisis n'ont pas pu devenir des missions. Créez-les depuis la page Missions."
                  : "Votre espace est créé, mais le poste choisi n'a pas pu devenir une mission. Créez-la depuis la page Missions.",
              );
            }
          }
        }
      }

      onComplete({
        orgId: org?.id ?? null,
        name: company.name,
        domain: company.domain,
        linkedinUrl: company.linkedinUrl,
        careersUrl: company.careersUrl || null,
      });
    } catch (err: any) {
      const msg = err?.message || '';
      if (err?.code === ORG_ALREADY_EXISTS) {
        // F3 : déjà membre d'un espace → demander une confirmation explicite
        setConfirmSecondOpen(true);
      } else if (msg.includes('duplicate key') || msg.includes('organizations_slug_key')) {
        toast.error('Un espace Konekt existe déjà pour cette société. Demandez à son administrateur de vous inviter.');
      } else {
        // Autre échec : la création de l'organisation l'a déjà signalé.
        console.error('[SceneOrganization] Création impossible :', err);
      }
    } finally {
      setIsCreating(false);
    }
  };

  const uniqueRolesCount = company ? dedupeRoles(company.openRoles).length : 0;
  const hasInsightsData = company && (
    (company.departmentalHeadcount && Object.values(company.departmentalHeadcount).filter(v => v != null).length >= 3) ||
    (company.fundingEvents && company.fundingEvents.length > 0) ||
    (company.newsArticles && company.newsArticles.length > 0)
  );
  const tabs: Array<{ key: TabKey; label: string }> = [
    { key: 'overview', label: 'Aperçu' },
    ...(hasInsightsData ? [{ key: 'insights' as const, label: 'Chiffres et actualités' }] : []),
    { key: 'roles', label: `Postes ouverts (${uniqueRolesCount})` },
  ];

  return (
    <div className="flex w-full flex-col gap-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-foreground">Votre société, en un mot.</h1>
        <p className="mt-2 max-w-md text-md text-foreground-secondary">
          Donnez son nom : Konekt récupère son logo, sa description et ses postes ouverts pour construire votre espace.
        </p>
      </div>

      {/* Search input */}
      <div className="flex gap-2">
        {onBack && (
          <Button variant="outline" size="icon" onClick={onBack} className="h-11 w-11 shrink-0" aria-label="Étape précédente">
            <ArrowLeft aria-hidden="true" />
          </Button>
        )}
        <div className="relative flex-1">
          <Label htmlFor={inputId} className="sr-only">Nom de votre société</Label>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input
            id={inputId}
            value={query}
            onChange={(e) => handleInputChange(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Nom de votre société, par exemple Atelier Nova"
            autoFocus
            className="h-11 pl-9"
          />
        </div>
        <Button
          variant="primary"
          onClick={handleSearch}
          disabled={query.trim().length < 2}
          loading={phase === 'scanning'}
          className="h-11 shrink-0 px-5"
        >
          Rechercher
        </Button>
      </div>

      {/* Recherche en cours : état réel et squelette de la fiche */}
      {phase === 'scanning' && (
        <div className="space-y-4" aria-busy="true">
          <p role="status" className="text-sm text-muted-foreground">
            Recherche de « {searchedName} »…
          </p>
          <div className="flex items-start gap-4 rounded-xl border border-border bg-card p-4">
            <Skeleton className="h-12 w-12 shrink-0 rounded-lg" />
            <div className="flex-1 space-y-2">
              <Skeleton className="h-5 w-40" />
              <Skeleton className="h-4 w-28" />
              <Skeleton className="h-4 w-56" />
            </div>
          </div>
          <Skeleton className="h-9 w-72 max-w-full rounded-lg" />
          <div className="space-y-2">
            <Skeleton className="h-16 w-full rounded-lg" />
            <Skeleton className="h-16 w-full rounded-lg" />
          </div>
        </div>
      )}

      {/* Plusieurs sociétés possibles */}
      {phase === 'disambiguate' && disambiguationCandidates.length > 0 && (
        <div className="space-y-3">
          <div>
            <p className="text-sm font-semibold text-foreground">Plusieurs sociétés trouvées pour « {query} »</p>
            <p className="text-sm text-muted-foreground">Choisissez la vôtre pour une fiche précise.</p>
          </div>
          <div className="space-y-2">
            {disambiguationCandidates.map((c) => (
              <Button
                key={c.id}
                variant="outline"
                onClick={() => selectCandidate(c.id)}
                className="h-auto w-full justify-start gap-3 whitespace-normal p-3 text-left font-normal"
              >
                <CompanyLogo key={`${c.id}-${c.domain}`} name={c.name} logoUrl={c.logoUrl} domain={c.domain} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold text-foreground">{c.name}</span>
                  <span className="block text-xs text-muted-foreground">
                    {[c.domain, c.industry, c.location, c.size ? `${c.size} salariés` : null].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <ArrowRight className="shrink-0 text-muted-foreground" aria-hidden="true" />
              </Button>
            ))}
          </div>
          <Button variant="link" onClick={() => startScan(query.trim(), '__none__')} className="h-auto w-full px-0 py-1 text-muted-foreground hover:text-foreground min-h-11 md:min-h-0">
            Aucune ne correspond : continuer sans ces données
          </Button>
        </div>
      )}

      {/* Fiche de la société */}
      {phase === 'results' && company && (
        <div className="space-y-4">
          <div className="flex flex-col items-start gap-3 rounded-xl border border-border bg-card p-4 sm:flex-row sm:gap-4">
            <CompanyLogo key={`${company.name}-${company.domain}`} name={company.name} logoUrl={company.logoUrl} domain={company.domain} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-lg font-semibold leading-tight text-foreground">{company.name}</h2>
                {!enrichFailed && (
                  <Badge variant="success">
                    <Check className="h-3 w-3" aria-hidden="true" />
                    Fiche trouvée
                  </Badge>
                )}
                {(company.suborganizations?.length || 0) > 0 && (
                  <Badge variant="muted">
                    <GitBranch className="h-3 w-3" aria-hidden="true" />
                    {company.suborganizations!.length} filiale{company.suborganizations!.length > 1 ? 's' : ''}
                  </Badge>
                )}
              </div>
              {company.industry && <p className="mt-0.5 text-sm text-muted-foreground">{company.industry}</p>}
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                {company.size && <span className="flex items-center gap-1"><Users className="h-3 w-3" aria-hidden="true" />{company.size}</span>}
                {company.location && <span className="flex items-center gap-1"><MapPin className="h-3 w-3" aria-hidden="true" />{company.location}</span>}
                {company.funding && <span className="flex items-center gap-1"><TrendingUp className="h-3 w-3" aria-hidden="true" />{company.funding}</span>}
              </div>
            </div>
          </div>

          {enrichFailed ? (
            <div role="alert" className="flex items-start gap-3 rounded-xl border border-border bg-card p-4">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-danger" aria-hidden="true" />
              <div className="min-w-0 flex-1 space-y-3">
                <div>
                  <p className="text-sm font-medium text-foreground">Les informations de la société n'ont pas pu être récupérées.</p>
                  <p className="text-sm text-muted-foreground">Réessayez, ou continuez avec son nom seul : vous compléterez l'espace plus tard.</p>
                </div>
                <Button variant="outline" size="sm" onClick={() => startScan(searchedName)} className="min-h-11 md:min-h-0">
                  <RefreshCw aria-hidden="true" />
                  Réessayer
                </Button>
              </div>
            </div>
          ) : (
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as TabKey)}>
              <TabsList className="h-auto max-w-full flex-wrap justify-start">
                {tabs.map((t) => (
                  <TabsTrigger key={t.key} value={t.key} className="h-11 md:h-8">
                    {t.label}
                  </TabsTrigger>
                ))}
              </TabsList>
              <TabsContent value="overview" className="mt-4">
                <TabOverview company={company} />
              </TabsContent>
              {hasInsightsData && (
                <TabsContent value="insights" className="mt-4">
                  <TabInsights company={company} />
                </TabsContent>
              )}
              <TabsContent value="roles" className="mt-4">
                <TabRoles roles={company.openRoles} selected={selectedRoles} onToggle={toggleRole} />
              </TabsContent>
            </Tabs>
          )}

          {/* Navigation */}
          <div className="flex items-center justify-end pt-2">
            <Button
              variant="primary"
              onClick={() => handleContinue(allowSecondWorkspace)}
              loading={isCreating}
              className="min-h-11 px-6 md:min-h-0"
            >
              {isCreating ? "Création de l'espace…" : 'Continuer'}
              {!isCreating && <ArrowRight aria-hidden="true" />}
            </Button>
          </div>
        </div>
      )}

      {/* F3 : confirmation explicite avant la création d'un second espace */}
      <AlertDialog open={confirmSecondOpen} onOpenChange={setConfirmSecondOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Vous avez déjà un espace de travail</AlertDialogTitle>
            <AlertDialogDescription>
              Votre compte fait déjà partie d’un espace Konekt. Créer un nouvel espace le
              rendra actif à la place de l’actuel : vos missions, crédits et comptes
              LinkedIn resteront dans l’espace existant. Voulez-vous vraiment créer un second espace ?
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annuler</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive"
              onClick={() => { setConfirmSecondOpen(false); void handleContinue(true); }}
            >
              Créer un second espace
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
};

/* ─── Tab: Overview ─── */
// Icônes neutres, couleur unique : pas d'arc-en-ciel
const INSIGHT_ICONS: Record<string, typeof Target> = {
  difficulty: Target,
  salary: Euro,
  attractivity: Heart,
  timing: Zap,
};

const TabOverview: React.FC<{ company: CompanyData }> = ({ company }) => {
  const structuredInsights = company.structuredInsights || [];
  const hasLinks = !!(company.websiteUrl || company.careersUrl);

  return (
    <div className="space-y-4">
      {structuredInsights.length > 0 ? (
        <div className="space-y-2">
          <h3 className="eyebrow">Analyse recrutement</h3>
          <div className="space-y-2">
            {structuredInsights.map((insight) => {
              const Icon = INSIGHT_ICONS[insight.key] || Lightbulb;
              return (
                <div key={insight.key} className="flex gap-3 rounded-lg border border-border bg-card p-3">
                  <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-muted text-foreground-secondary">
                    <Icon className="h-3.5 w-3.5" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm font-medium leading-snug text-foreground">{insight.title}</p>
                    <p className="text-sm text-muted-foreground">{insight.body}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ) : company.insights.length > 0 ? (
        <div className="space-y-2 rounded-lg border border-border bg-card p-4">
          <h3 className="eyebrow">Analyse recrutement</h3>
          <div className="space-y-2">
            {company.insights.map((insight, i) => (
              <p key={i} className="text-sm text-foreground-secondary">{insight}</p>
            ))}
          </div>
        </div>
      ) : null}

      {hasLinks && (
        <div className="flex flex-wrap gap-2">
          {company.websiteUrl && (
            <Button asChild variant="outline" size="sm" className="min-h-11 md:min-h-0">
              <a href={company.websiteUrl} target="_blank" rel="noopener noreferrer">
                <Globe aria-hidden="true" /> Site web
                <span className="sr-only">(nouvel onglet)</span>
              </a>
            </Button>
          )}
          {company.careersUrl && (
            <Button asChild variant="outline" size="sm" className="min-h-11 md:min-h-0">
              <a href={company.careersUrl} target="_blank" rel="noopener noreferrer">
                <Briefcase aria-hidden="true" /> Page carrière
                <span className="sr-only">(nouvel onglet)</span>
              </a>
            </Button>
          )}
        </div>
      )}

      {structuredInsights.length === 0 && company.insights.length === 0 && !hasLinks && (
        <p className="text-sm text-muted-foreground">Aucune analyse disponible pour cette société.</p>
      )}
    </div>
  );
};

/* ─── Helper: format funding amount ─── */
function formatAmount(amount?: number): string {
  if (!amount) return '';
  if (amount >= 1_000_000_000) return `${(amount / 1_000_000_000).toFixed(1)}B$`;
  if (amount >= 1_000_000) return `${(amount / 1_000_000).toFixed(0)}M$`;
  if (amount >= 1_000) return `${(amount / 1_000).toFixed(0)}K$`;
  return `${amount}$`;
}

/* ─── Helper: relative date ─── */
function relativeDate(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    const now = new Date();
    const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
    if (diffDays < 1) return "Aujourd'hui";
    if (diffDays < 7) return `Il y a ${diffDays}j`;
    if (diffDays < 30) return `Il y a ${Math.floor(diffDays / 7)} sem.`;
    if (diffDays < 365) return `Il y a ${Math.floor(diffDays / 30)} mois`;
    return `Il y a ${Math.floor(diffDays / 365)} an${Math.floor(diffDays / 365) > 1 ? 's' : ''}`;
  } catch {
    return dateStr;
  }
}

/* ─── Helper: format month ─── */
function formatMonthYear(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleDateString('fr-FR', { month: 'short', year: 'numeric' });
  } catch {
    return dateStr;
  }
}

/* ─── Tab: Insights ─── */
const TabInsights: React.FC<{ company: CompanyData }> = ({ company }) => {
  // Headcount by department
  const headcountEntries = company.departmentalHeadcount
    ? Object.entries(company.departmentalHeadcount)
        .filter(([, v]) => v != null && v > 0)
        .sort(([, a], [, b]) => b - a)
        .slice(0, 6)
    : [];
  const maxHeadcount = headcountEntries.length > 0 ? headcountEntries[0][1] : 0;

  const fundingEvents = (company.fundingEvents || []).slice(0, 4);
  const newsArticles = (company.newsArticles || []).slice(0, 3);

  return (
    <div className="space-y-5">
      {headcountEntries.length >= 3 && (
        <div className="space-y-2">
          <h3 className="eyebrow flex items-center gap-1.5">
            <Users className="h-3.5 w-3.5" aria-hidden="true" />
            Répartition des équipes
          </h3>
          <div className="space-y-2 rounded-lg border border-border bg-card p-3">
            {headcountEntries.map(([dept, count]) => (
              <div key={dept} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="font-medium capitalize text-foreground">{dept.replace(/_/g, ' ')}</span>
                  <span className="tabular-nums text-foreground-secondary">{count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div className="h-full rounded-full bg-foreground-secondary" style={{ width: `${(count / maxHeadcount) * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {fundingEvents.length > 0 && (
        <div className="space-y-2">
          <h3 className="eyebrow flex items-center gap-1.5">
            <TrendingUp className="h-3.5 w-3.5" aria-hidden="true" />
            Historique des levées
          </h3>
          <ol className="space-y-3 rounded-lg border border-border bg-card p-3">
            {fundingEvents.map((ev, i) => (
              <li key={i} className="flex gap-3">
                <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-border-strong" aria-hidden="true" />
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    {ev.type && <Badge variant="muted">{ev.type}</Badge>}
                    {ev.amount && <span className="text-xs font-semibold text-foreground">{formatAmount(ev.amount)}</span>}
                  </div>
                  {ev.date && <p className="mt-0.5 text-xs text-muted-foreground">{formatMonthYear(ev.date)}</p>}
                  {ev.investors && ev.investors.length > 0 && (
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">{ev.investors.join(', ')}</p>
                  )}
                </div>
              </li>
            ))}
          </ol>
        </div>
      )}

      {newsArticles.length > 0 && (
        <div className="space-y-2">
          <h3 className="eyebrow flex items-center gap-1.5">
            <Newspaper className="h-3.5 w-3.5" aria-hidden="true" />
            Actualités
          </h3>
          <div className="space-y-1.5">
            {newsArticles.map((article, i) => (
              <a
                key={i}
                href={article.url}
                target="_blank"
                rel="noopener noreferrer"
                className="group flex items-start gap-2 rounded-lg border border-border bg-card p-2.5 transition-colors duration-150 hover:border-border-strong hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1">
                  <p className="line-clamp-2 text-xs font-medium leading-snug text-foreground">{article.title}</p>
                  <div className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    {article.source && <span>{article.source}</span>}
                    {article.published_at && <span>· {relativeDate(article.published_at)}</span>}
                  </div>
                </div>
                <span className="sr-only">(nouvel onglet)</span>
              </a>
            ))}
          </div>
        </div>
      )}
    </div>
  );
};

/* ─── Dedupe helper ─── */
function dedupeRoles(roles: CompanyData['openRoles']) {
  const seen = new Map<string, number>();
  return roles.filter((role, i) => {
    const key = role.title.toLowerCase().replace(/[\s\-–—()\/,]+/g, ' ').trim();
    if (seen.has(key)) return false;
    seen.set(key, i);
    return true;
  });
}

/* ─── Source badge with logo ─── */
const SourceBadge: React.FC<{ source: string }> = ({ source }) => {
  const lower = source.toLowerCase();
  // Le fournisseur de données ne s'affiche jamais (CLAUDE.md, « Branding »).
  const label = lower.includes('apollo') ? 'Base Konekt' : source;
  const isLinkedIn = lower.includes('linkedin');
  const isWTTJ = lower.includes('wttj') || lower.includes('welcome');

  return (
    <Badge variant="muted" className="shrink-0 font-normal">
      {isLinkedIn && <img src={linkedinLogo} alt="" className="h-3 w-3 object-contain" />}
      {isWTTJ && <img src={WTTJ_LOGO} alt="" className="h-3 w-3 object-contain" onError={(e) => { (e.target as HTMLImageElement).src = WTTJ_FALLBACK; }} />}
      {label}
    </Badge>
  );
};

/* ─── Tab: Open Roles ─── */
const TabRoles: React.FC<{
  roles: CompanyData['openRoles'];
  selected: Set<number>;
  onToggle: (idx: number) => void;
}> = ({ roles, selected, onToggle }) => {
  const uniqueRoles = dedupeRoles(roles);
  const baseId = useId();

  if (uniqueRoles.length === 0) {
    return (
      <p className="py-4 text-center text-sm text-muted-foreground">
        Aucun poste ouvert trouvé. Vous créerez vos missions depuis la page Missions.
      </p>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-sm text-muted-foreground">
        Les postes cochés deviendront des missions de votre espace.
        {uniqueRoles.length < roles.length &&
          ` ${roles.length - uniqueRoles.length} doublon${roles.length - uniqueRoles.length > 1 ? 's' : ''} masqué${roles.length - uniqueRoles.length > 1 ? 's' : ''}.`}
      </p>
      {uniqueRoles.map((role, i) => {
        const checkboxId = `${baseId}-${i}`;
        return (
          <div
            key={i}
            className="rounded-lg border border-border bg-card p-3 transition-colors duration-150 hover:border-border-strong"
          >
            <div className="flex items-start gap-3">
              <Checkbox id={checkboxId} checked={selected.has(i)} onCheckedChange={() => onToggle(i)} className="mt-0.5" />
              <label htmlFor={checkboxId} className="min-w-0 flex-1 cursor-pointer">
                <span className="block text-sm font-medium text-foreground">{role.title}</span>
                {role.location && (
                  <span className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <MapPin className="h-3 w-3" aria-hidden="true" />{role.location}
                  </span>
                )}
              </label>
              <SourceBadge source={role.source} />
            </div>
            {role.url && (
              <a
                href={role.url}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-7 mt-1 inline-flex min-h-11 md:min-h-0 items-center gap-1 rounded-md text-xs text-muted-foreground underline-offset-4 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                Voir l'offre
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
                <span className="sr-only">(nouvel onglet)</span>
              </a>
            )}
          </div>
        );
      })}
    </div>
  );
};

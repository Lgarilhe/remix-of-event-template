/**
 * CreateMissionV2 — Onboarding création de mission refondu.
 *
 * Inspirée du design Claude "Mission Refonte v2" :
 *   ┌── Hero centré ───────────────────────────────────────┐
 *   │  ✨ Brief en 60 secondes                             │
 *   │  Décris la mission, l'IA fait le reste.              │
 *   └──────────────────────────────────────────────────────┘
 *
 *   ┌── 3 modes d'entrée (cards) ──────────────────────────┐
 *   │  📋 Coller une fiche      🎙 Dicter      ✍️ Manuel  │
 *   └──────────────────────────────────────────────────────┘
 *
 *   ┌── Workspace selon le mode actif ─────────────────────┐
 *   │  - Mode brief : textarea grande + analyse IA live    │
 *   │  - Mode manuel : form classique                       │
 *   │  - Mode voice : à venir (placeholder)                 │
 *   └──────────────────────────────────────────────────────┘
 *
 *   ┌── Footer sticky ─────────────────────────────────────┐
 *   │  Brouillon prêt à X% · [Créer la mission →]          │
 *   └──────────────────────────────────────────────────────┘
 *
 * Réutilise :
 *   - useSourcingProjects.createProject
 *   - generate-search-filters edge function (analyse brief)
 *   - Logique de redirection vers /missions/:id
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { useSourcingProjects, CreateProjectInput } from '@/hooks/useSourcingProjects';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';
import {
  Sparkles, Loader2, FileText, Mic, Pencil, ArrowRight, ArrowLeft,
  Check, X, Building2, MapPin, Briefcase, Star, Clock, Layers, Euro,
  Link2, Paperclip, Upload, Globe,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── URL helpers (détection des sources connues) ──
function detectUrlSource(url: string): { label: string; emoji: string } | null {
  const lower = url.toLowerCase();
  if (lower.includes('welcometothejungle')) return { label: 'Welcome to the Jungle', emoji: '🌴' };
  if (lower.includes('linkedin.com/jobs')) return { label: 'LinkedIn Jobs', emoji: '💼' };
  if (lower.includes('linkedin.com')) return { label: 'LinkedIn', emoji: '💼' };
  if (lower.includes('lever.co')) return { label: 'Lever', emoji: '⚙️' };
  if (lower.includes('greenhouse.io')) return { label: 'Greenhouse', emoji: '🌱' };
  if (lower.includes('workable.com')) return { label: 'Workable', emoji: '⚙️' };
  if (lower.includes('teamtailor.com')) return { label: 'Teamtailor', emoji: '⚙️' };
  if (lower.includes('jobteaser.com')) return { label: 'JobTeaser', emoji: '🎓' };
  if (lower.includes('apec.fr')) return { label: 'APEC', emoji: '🇫🇷' };
  if (/career|job|recrutement|emploi|talent|hiring|offre/i.test(url)) {
    return { label: 'Page carrière', emoji: '🌐' };
  }
  return null;
}

function isValidUrl(s: string): boolean {
  try { new URL(s); return true; } catch { return false; }
}

// Extract first URL from text
function extractUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

// ── Parse local URL — pour extraire title/company directement depuis le slug
// quand c'est une URL de poste spécifique (sans devoir scraper le HTML).
// Marche pour : WTTJ /companies/{slug}/jobs/{title-slug}_{location}
//               LinkedIn /jobs/view/{job_id}/  (titre dans les query params parfois)

interface UrlParsedJob {
  title?: string;
  company?: string;
  location?: string;
  source: string;
  isJobUrl: boolean; // true si URL de POSTE spécifique, false si URL entreprise
}

function smartCapitalize(s: string): string {
  return s.split(/[\s-_]+/)
    .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ')
    .trim();
}

function parseJobUrl(url: string): UrlParsedJob | null {
  try {
    const u = new URL(url);
    const host = u.hostname.toLowerCase();
    const path = u.pathname;

    // WTTJ : /fr/companies/{company-slug}/jobs/{job-slug}[_location]
    if (host.includes('welcometothejungle.com')) {
      const jobMatch = path.match(/\/companies\/([a-z0-9-]+)\/jobs\/([a-z0-9-]+?)(?:_([a-z0-9-]+))?(?:\/|$)/i);
      if (jobMatch) {
        return {
          company: smartCapitalize(jobMatch[1]),
          title: smartCapitalize(jobMatch[2]),
          location: jobMatch[3] ? smartCapitalize(jobMatch[3]) : undefined,
          source: 'Welcome to the Jungle',
          isJobUrl: true,
        };
      }
      const companyMatch = path.match(/\/companies\/([a-z0-9-]+)/i);
      if (companyMatch) {
        return { company: smartCapitalize(companyMatch[1]), source: 'Welcome to the Jungle', isJobUrl: false };
      }
    }

    // LinkedIn jobs : /jobs/view/{id} — pas de slug dans le path, on doit fetch
    if (host.includes('linkedin.com') && path.includes('/jobs/')) {
      return { source: 'LinkedIn Jobs', isJobUrl: true };
    }

    // Lever : jobs.lever.co/{company}/{job-id-or-slug}
    if (host === 'jobs.lever.co') {
      const match = path.match(/^\/([a-z0-9-]+)\/([^/]+)/i);
      if (match) {
        return {
          company: smartCapitalize(match[1]),
          title: smartCapitalize(match[2].replace(/[a-f0-9-]{20,}/g, '').trim()) || undefined,
          source: 'Lever',
          isJobUrl: true,
        };
      }
    }

    // Greenhouse : boards.greenhouse.io/{company}/jobs/{id}
    if (host === 'boards.greenhouse.io') {
      const match = path.match(/^\/([a-z0-9-]+)\/jobs\//i);
      if (match) return { company: smartCapitalize(match[1]), source: 'Greenhouse', isJobUrl: true };
    }

    return null;
  } catch {
    return null;
  }
}

interface CreateMissionV2Props {
  isOpen: boolean;
  onClose: () => void;
  /** Pré-sélectionne un mode d'entrée : 'brief' | 'manual' | 'voice' */
  initialMode?: EntryMode;
}

type EntryMode = 'choose' | 'brief' | 'manual' | 'voice';

interface BriefAnalysis {
  filters: Record<string, unknown>;
  analysis: {
    suggested_title?: string;
    role_keywords?: string[];
    skills_to_search?: string[];
    location_hint?: string | null;
    years_experience_min?: number | null;
    years_experience_max?: number | null;
    job_category?: string;
    detected_company?: string | null;
    // Champs structurés pour pré-remplir job_details
    skills_must_have?: string[];
    skills_should_have?: string[];
    skills_nice_to_have?: string[];
    salary_min?: number | null;
    salary_max?: number | null;
    contract_type?: 'cdi' | 'cdd' | 'freelance' | 'stage' | 'alternance' | 'interim' | null;
    remote_policy?: 'onsite' | 'hybrid' | 'full_remote' | null;
    remote_days?: number | null;
    start_date?: string | null;
    mission_description?: string;
    context?: string | null;
    seniority?: string | null;
    evaluation_criteria?: string[];
  };
}

// ── Mode Card (entrée du flow) ──

const MODE_OPTIONS: {
  value: Exclude<EntryMode, 'choose'>;
  label: string;
  desc: string;
  icon: typeof FileText;
  recommended?: boolean;
  badge?: string;
}[] = [
  {
    value: 'brief',
    label: 'Coller une fiche de poste',
    desc: 'L\'IA extrait le titre, les compétences, l\'expérience et la localisation en quelques secondes.',
    icon: FileText,
    recommended: true,
    badge: '60 secondes',
  },
  {
    value: 'voice',
    label: 'Dicter à voix haute',
    desc: 'Décris la mission à l\'oral. L\'IA structure tout pendant que tu parles.',
    icon: Mic,
    badge: 'Bientôt',
  },
  {
    value: 'manual',
    label: 'Saisir manuellement',
    desc: 'Pour les briefs complexes ou multi-rôles. Tu rempliras les champs un par un.',
    icon: Pencil,
    badge: '5-10 min',
  },
];

export const CreateMissionV2: React.FC<CreateMissionV2Props> = ({
  isOpen,
  onClose,
  initialMode = 'choose',
}) => {
  const navigate = useNavigate();
  const { createProject } = useSourcingProjects();

  const [mode, setMode] = useState<EntryMode>(initialMode);
  const [briefText, setBriefText] = useState('');
  const [briefName, setBriefName] = useState('');
  const [clientName, setClientName] = useState('');
  const [description, setDescription] = useState('');
  const [analyzing, setAnalyzing] = useState(false);
  const [analysis, setAnalysis] = useState<BriefAnalysis | null>(null);
  const [creating, setCreating] = useState(false);
  // Import URL state
  const [scanningUrl, setScanningUrl] = useState(false);
  const [urlSuggestion, setUrlSuggestion] = useState<string | null>(null);
  // File upload state
  const [uploadingFile, setUploadingFile] = useState(false);

  // Détecte automatiquement une URL collée dans le brief — propose un scan
  useEffect(() => {
    const url = extractUrl(briefText.trim());
    if (url && isValidUrl(url) && detectUrlSource(url)) {
      setUrlSuggestion(url);
    } else {
      setUrlSuggestion(null);
    }
  }, [briefText]);

  // Reset state on close
  useEffect(() => {
    if (!isOpen) {
      const t = setTimeout(() => {
        setMode(initialMode);
        setBriefText('');
        setBriefName('');
        setClientName('');
        setDescription('');
        setAnalysis(null);
        setAnalyzing(false);
        setCreating(false);
      }, 200);
      return () => clearTimeout(t);
    }
  }, [isOpen, initialMode]);

  // ── Brief IA : analyse + creation ──
  const handleAnalyze = useCallback(async () => {
    if (briefText.trim().length < 20) {
      toast.error('Le brief est trop court (minimum 20 caractères)');
      return;
    }
    setAnalyzing(true);
    setAnalysis(null);

    try {
      const syntheticJob = {
        id: 'draft',
        title: briefText.trim().split('\n')[0].slice(0, 80),
        description: briefText.trim(),
        client: clientName ? { name: clientName } : null,
        location: null,
        skills: [],
        seniority: null,
      };

      const response = await invokeEdgeFunction<any>('generate-search-filters', { job: syntheticJob });

      if (response.error) throw new Error(response.error.message || 'Erreur IA');
      if (!response.data?.success) throw new Error('Analyse échouée');

      const aiTitle = response.data.analysis?.suggested_title;
      if (aiTitle && !briefName) setBriefName(aiTitle);
      else if (!briefName) {
        const roles = response.data.analysis?.role_keywords || [];
        const loc = response.data.analysis?.location_hint;
        setBriefName(roles[0] ? `${roles[0]}${loc ? ` — ${loc}` : ''}` : 'Mission');
      }

      setAnalysis({
        filters: response.data.filters,
        analysis: response.data.analysis,
      });

      toast.success('Analyse terminée — vérifie et crée la mission');
    } catch (err: any) {
      toast.error(err.message || "Erreur lors de l'analyse");
    } finally {
      setAnalyzing(false);
    }
  }, [briefText, clientName, briefName]);

  const handleCreateFromBrief = useCallback(async () => {
    setCreating(true);
    try {
      const input: CreateProjectInput = {
        name: briefName || briefText.trim().split('\n')[0].slice(0, 80) || 'Nouvelle mission',
        description: briefText.trim(),
        client_name: clientName || undefined,
      };

      if (analysis) {
        input.filters_snapshot = {
          ...analysis.filters,
          generated_at: new Date().toISOString(),
          brief_text: briefText.trim(),
        };

        // Pré-remplit job_details avec ce que l'IA a extrait — c'est ce
        // qui alimente le SCORING IA des candidats (skills_must_have,
        // mission_description, etc.) et l'affichage du brief structuré.
        const a = analysis.analysis;
        const jobDetails: Record<string, unknown> = {
          title: a.suggested_title || briefName || briefText.trim().split('\n')[0].slice(0, 80),
          mission_description: a.mission_description || briefText.trim().slice(0, 600),
          raw_brief: briefText.trim(),
          brief_source: 'imported',
        };
        if (a.context) jobDetails.context = a.context;
        if (clientName || a.detected_company) {
          jobDetails.client = {
            name: clientName || a.detected_company,
          };
        }
        if (a.location_hint) jobDetails.location = a.location_hint;
        if (a.remote_policy) jobDetails.remote_policy = a.remote_policy;
        if (typeof a.remote_days === 'number') jobDetails.remote_days = a.remote_days;
        if (a.contract_type) jobDetails.contract_type = a.contract_type;
        if (a.start_date) jobDetails.start_date = a.start_date;
        if (a.seniority) jobDetails.seniority = a.seniority;
        if (typeof a.years_experience_min === 'number') jobDetails.experience_min = a.years_experience_min;
        if (typeof a.years_experience_max === 'number') jobDetails.experience_max = a.years_experience_max;
        if (typeof a.salary_min === 'number') jobDetails.salary_min = a.salary_min;
        if (typeof a.salary_max === 'number') jobDetails.salary_max = a.salary_max;
        if (a.salary_min || a.salary_max) {
          jobDetails.salary_currency = 'EUR';
          jobDetails.salary_type = 'annual';
        }
        if (Array.isArray(a.skills_must_have) && a.skills_must_have.length) {
          jobDetails.skills_must_have = a.skills_must_have;
        } else if (Array.isArray(a.skills_to_search) && a.skills_to_search.length) {
          // Fallback : skills_to_search peut servir de must_have si pas explicite
          jobDetails.skills_must_have = a.skills_to_search.slice(0, 8);
        }
        if (Array.isArray(a.skills_should_have) && a.skills_should_have.length) {
          jobDetails.skills_should_have = a.skills_should_have;
        }
        if (Array.isArray(a.skills_nice_to_have) && a.skills_nice_to_have.length) {
          jobDetails.skills_nice_to_have = a.skills_nice_to_have;
        }
        if (Array.isArray(a.evaluation_criteria) && a.evaluation_criteria.length) {
          // Convertit en format compatible JobDetails.evaluation_criteria
          jobDetails.evaluation_criteria = a.evaluation_criteria.map((label, i) => ({
            id: `auto-${i + 1}`,
            label,
            description: '',
            category: 'technical' as const,
            weight: 2 as const,
          }));
        }
        (input as any).job_details = jobDetails;
      }

      const project = await createProject(input);
      onClose();
      if (project?.id) {
        navigate(`/missions/${project.id}?tab=${analysis ? 'sourcing' : 'brief'}`);
      }
    } catch {
      // handled by hook
    } finally {
      setCreating(false);
    }
  }, [briefName, briefText, clientName, analysis, createProject, onClose, navigate]);

  // ── Scan d'URL — parsing local du slug uniquement.
  //
  // Note : on n'essaie PAS de scraper le contenu complet de la page.
  // Les sites modernes (WTTJ, LinkedIn jobs, ATS) font du Client-Side
  // Rendering avec anti-bot, ce qui rend le scraping non-fiable.
  // À la place : parsing rapide du slug pour pré-remplir titre +
  // entreprise + lieu + contrat, et l'user complète en copiant-collant
  // le contenu de la fiche.
  const handleScanUrl = useCallback(async (urlOverride?: string) => {
    const url = (urlOverride || urlSuggestion || '').trim();
    if (!url) return;
    setScanningUrl(true);

    try {
      const parsed = parseJobUrl(url);

      // Cas 1 : URL de poste avec slug parsable → on pré-remplit
      if (parsed && parsed.isJobUrl && (parsed.title || parsed.company)) {
        const lines = [
          parsed.title && `Poste : ${parsed.title}`,
          parsed.company && `Entreprise : ${parsed.company}`,
          parsed.location && `Lieu : ${parsed.location}`,
          `Source : ${parsed.source}`,
          `URL : ${url}`,
          '',
          '— Colle ici le contenu complet de la fiche (Ctrl+A puis Ctrl+C sur la page, puis Ctrl+V ici) —',
        ].filter(Boolean).join('\n');

        setBriefText(prev => {
          const without = prev.replace(url, '').trim();
          return without ? `${without}\n\n${lines}` : lines;
        });
        if (!briefName && parsed.title) setBriefName(parsed.title);
        if (!clientName && parsed.company) setClientName(parsed.company);
        setUrlSuggestion(null);

        toast.success(`✨ ${parsed.source} reconnu`, {
          description: 'Titre, entreprise et lieu pré-remplis. Pour le brief complet, copie-colle le contenu de la page sous ces infos.',
          duration: 6000,
        });
        return;
      }

      // Cas 2 : URL de page entreprise (plusieurs postes)
      if (parsed && !parsed.isJobUrl && parsed.company) {
        if (!clientName) setClientName(parsed.company);
        toast.info('Page entreprise détectée', {
          description: `Pour importer plusieurs postes de ${parsed.company} en une fois, utilise "Importer plusieurs postes" depuis ta liste de missions (à venir).`,
          duration: 7000,
        });
        return;
      }

      // Cas 3 : URL non reconnue
      toast.warning('URL non reconnue', {
        description: 'Colle directement le contenu de la fiche dans la zone brief — l\'IA fait le reste.',
        duration: 5000,
      });
    } catch (e: any) {
      toast.error(e.message || "Erreur lors du scan");
    } finally {
      setScanningUrl(false);
    }
  }, [urlSuggestion, briefName, clientName]);

  // ── Upload d'un fichier (TXT pris en charge nativement, PDF/DOCX → message) ──
  const handleFileUpload = useCallback(async (file: File) => {
    setUploadingFile(true);
    try {
      const ext = file.name.toLowerCase().split('.').pop() || '';
      const mime = file.type.toLowerCase();

      // TXT / Markdown / autres formats texte → lecture directe
      if (
        ext === 'txt' || ext === 'md' || ext === 'markdown' ||
        mime.startsWith('text/') || mime === 'application/json'
      ) {
        const text = await file.text();
        setBriefText(prev => {
          const cleaned = text.trim().slice(0, 12000); // cap raisonnable
          return prev.trim() ? `${prev.trim()}\n\n${cleaned}` : cleaned;
        });
        if (!briefName) {
          const guessedName = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').slice(0, 60);
          setBriefName(guessedName);
        }
        toast.success(`📎 Fichier "${file.name}" importé`);
        return;
      }

      // PDF / DOCX : pas encore implémenté côté frontend (lourd à bundler).
      // On accepte le fichier mais on demande à l'user de copier-coller le
      // contenu pour l'instant. Le parsing automatique viendra dans une PR
      // future via une edge function dédiée.
      if (ext === 'pdf' || ext === 'docx' || ext === 'doc' || mime.includes('pdf') || mime.includes('word')) {
        toast.info(
          `📄 ${ext.toUpperCase()} reconnu — extraction automatique bientôt disponible`,
          {
            description: 'Pour l\'instant, ouvre le document, sélectionne tout (Ctrl+A) et colle le contenu dans la zone brief. L\'IA s\'occupera du reste.',
            duration: 7000,
          }
        );
        return;
      }

      toast.error(`Format ${ext.toUpperCase()} non pris en charge — utilise TXT, PDF ou DOCX`);
    } catch (e: any) {
      toast.error(e.message || "Erreur lors de la lecture du fichier");
    } finally {
      setUploadingFile(false);
    }
  }, [briefName]);

  // ── Manuel ──
  const handleCreateManual = useCallback(async () => {
    if (!briefName.trim()) {
      toast.error('Le titre est requis');
      return;
    }
    setCreating(true);
    try {
      const project = await createProject({
        name: briefName.trim(),
        description: description || undefined,
        client_name: clientName || undefined,
      });
      onClose();
      if (project?.id) {
        navigate(`/missions/${project.id}?tab=brief`);
      }
    } catch {
      // handled by hook
    } finally {
      setCreating(false);
    }
  }, [briefName, description, clientName, createProject, onClose, navigate]);

  // Détecte les fields extraits pour le panneau live
  const extractedFields = analysis?.analysis ? buildExtractedFields(analysis.analysis) : [];

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-[920px] p-0 gap-0 overflow-hidden bg-background border border-border rounded-xl max-h-[90vh] flex flex-col">
        <DialogHeader className="sr-only">
          <DialogTitle>Créer une nouvelle mission</DialogTitle>
          <DialogDescription>
            Choisis comment tu veux décrire la mission : coller une fiche de poste, dicter, ou remplir manuellement.
          </DialogDescription>
        </DialogHeader>

        {/* Accent gradient bar */}
        <div className="h-1 konekt-skalr-bg flex-shrink-0" />

        {/* Header (back button visible si mode != choose) */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-border flex-shrink-0">
          <div className="flex items-center gap-3 min-w-0">
            {mode !== 'choose' ? (
              <button
                type="button"
                onClick={() => setMode('choose')}
                className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
                aria-label="Retour"
              >
                <ArrowLeft className="w-4 h-4" />
              </button>
            ) : (
              <div className="h-8 w-8 rounded-lg konekt-skalr-bg konekt-shine grid place-items-center flex-shrink-0">
                <Sparkles className="w-4 h-4 text-white" strokeWidth={2.5} />
              </div>
            )}
            <div className="min-w-0">
              <p className="font-display text-[16px] font-bold leading-tight truncate">
                {mode === 'choose' && 'Nouvelle mission'}
                {mode === 'brief' && 'Brief IA'}
                {mode === 'manual' && 'Création manuelle'}
                {mode === 'voice' && 'Dictée vocale'}
              </p>
              <p className="text-[11px] text-muted-foreground">
                {mode === 'choose' && 'Comment veux-tu décrire la mission ?'}
                {mode === 'brief' && 'Colle ta fiche de poste, l\'IA extrait l\'essentiel'}
                {mode === 'manual' && 'Remplis les champs un par un'}
                {mode === 'voice' && 'Cette fonctionnalité arrive bientôt'}
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="h-8 w-8 grid place-items-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors flex-shrink-0"
            aria-label="Fermer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto">
          {mode === 'choose' && <ChooseMode onPick={setMode} />}
          {mode === 'brief' && (
            <BriefMode
              briefText={briefText}
              setBriefText={setBriefText}
              briefName={briefName}
              setBriefName={setBriefName}
              clientName={clientName}
              setClientName={setClientName}
              analyzing={analyzing}
              analysis={analysis}
              extractedFields={extractedFields}
              onAnalyze={handleAnalyze}
              urlSuggestion={urlSuggestion}
              scanningUrl={scanningUrl}
              onScanUrl={handleScanUrl}
              uploadingFile={uploadingFile}
              onFileUpload={handleFileUpload}
            />
          )}
          {mode === 'manual' && (
            <ManualMode
              name={briefName}
              setName={setBriefName}
              clientName={clientName}
              setClientName={setClientName}
              description={description}
              setDescription={setDescription}
            />
          )}
          {mode === 'voice' && <VoicePlaceholder />}
        </div>

        {/* Footer (selon mode) */}
        {mode === 'brief' && (
          <div className="border-t border-border bg-card/50 px-6 py-3 flex items-center justify-between gap-3 flex-shrink-0">
            <div className="text-[11px] text-muted-foreground inline-flex items-center gap-1.5 min-w-0">
              <Clock className="w-3 h-3 flex-shrink-0" />
              <span className="truncate">
                {analysis
                  ? `Brouillon prêt · ${extractedFields.length} infos extraites`
                  : briefText.trim().length > 20
                    ? 'Prêt pour analyse'
                    : 'Colle ou tape ton brief (min. 20 caractères)'}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-shrink-0">
              {!analysis ? (
                <button
                  type="button"
                  onClick={handleAnalyze}
                  disabled={analyzing || briefText.trim().length < 20}
                  className="h-9 px-5 rounded-full text-[13px] font-semibold text-white inline-flex items-center gap-1.5 konekt-skalr-bg konekt-shine transition-transform active:scale-[0.97] disabled:opacity-50"
                >
                  {analyzing ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Sparkles className="w-3.5 h-3.5" strokeWidth={2.5} />}
                  Analyser avec l'IA
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleCreateFromBrief}
                  disabled={creating}
                  className="h-9 px-5 rounded-full text-[13px] font-semibold text-white inline-flex items-center gap-1.5 konekt-skalr-bg konekt-shine transition-transform active:scale-[0.97] disabled:opacity-50"
                >
                  {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" strokeWidth={2.5} />}
                  Créer la mission
                  <ArrowRight className="w-3 h-3" strokeWidth={2.5} />
                </button>
              )}
            </div>
          </div>
        )}

        {mode === 'manual' && (
          <div className="border-t border-border bg-card/50 px-6 py-3 flex items-center justify-end gap-3 flex-shrink-0">
            <button
              type="button"
              onClick={onClose}
              className="h-9 px-4 rounded-full text-[13px] font-medium border border-border hover:bg-accent transition-colors"
            >
              Annuler
            </button>
            <button
              type="button"
              onClick={handleCreateManual}
              disabled={creating || !briefName.trim()}
              className="h-9 px-5 rounded-full text-[13px] font-semibold text-white inline-flex items-center gap-1.5 konekt-skalr-bg konekt-shine transition-transform active:scale-[0.97] disabled:opacity-50"
            >
              {creating ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" strokeWidth={2.5} />}
              Créer la mission
              <ArrowRight className="w-3 h-3" strokeWidth={2.5} />
            </button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

// ─── Mode Choose ──────────────────────────────────────────────

const ChooseMode: React.FC<{ onPick: (mode: EntryMode) => void }> = ({ onPick }) => (
  <div className="px-8 py-10">
    <div className="text-center max-w-md mx-auto mb-10 konekt-fade-up">
      <div className="inline-flex items-center gap-1.5 mb-4 px-3 py-1 rounded-full text-[11px] font-medium konekt-skalr-bg-soft" style={{ border: '1px solid hsl(271 81% 56% / 0.25)' }}>
        <Sparkles className="w-3 h-3" style={{ color: 'hsl(330 81% 70%)' }} />
        <span className="konekt-skalr-text">Brief en 60 secondes</span>
      </div>
      <h2 className="font-display text-[28px] sm:text-[32px] font-bold leading-tight mb-2">
        Décris la mission,{' '}
        <span className="font-editorial italic font-normal">l'IA fait le reste.</span>
      </h2>
      <p className="text-[13px] text-muted-foreground">
        Colle une fiche de poste, dicte à voix haute, ou remplis les champs manuellement. À toi de choisir.
      </p>
    </div>

    <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 max-w-2xl mx-auto konekt-fade-up" style={{ animationDelay: '120ms' }}>
      {MODE_OPTIONS.map(opt => {
        const Icon = opt.icon;
        const disabled = opt.value === 'voice'; // Voice not implemented yet
        return (
          <button
            key={opt.value}
            type="button"
            onClick={() => !disabled && onPick(opt.value)}
            disabled={disabled}
            className={cn(
              'relative flex flex-col items-start gap-3 px-5 py-5 rounded-xl border text-left transition-all',
              opt.recommended
                ? 'border-foreground/30 bg-card hover:border-foreground/50'
                : 'border-border bg-card/60 hover:bg-card hover:border-borderHi',
              disabled && 'opacity-50 cursor-not-allowed',
            )}
          >
            {opt.badge && (
              <span
                className={cn(
                  'absolute top-3 right-3 text-[10px] px-1.5 py-0.5 rounded-full font-bold',
                  opt.recommended ? 'text-white konekt-skalr-bg' : 'bg-muted text-muted-foreground',
                )}
              >
                {opt.badge}
              </span>
            )}
            <div
              className={cn(
                'h-9 w-9 rounded-lg grid place-items-center flex-shrink-0',
                opt.recommended ? 'konekt-skalr-bg konekt-shine' : 'bg-muted',
              )}
            >
              <Icon className={cn('w-4 h-4', opt.recommended ? 'text-white' : 'text-muted-foreground')} strokeWidth={2.5} />
            </div>
            <div>
              <p className="font-semibold text-[14px] mb-1">{opt.label}</p>
              <p className="text-[11.5px] text-muted-foreground leading-relaxed">{opt.desc}</p>
            </div>
          </button>
        );
      })}
    </div>
  </div>
);

// ─── Mode Brief IA ──────────────────────────────────────────────

interface BriefModeProps {
  briefText: string;
  setBriefText: (v: string) => void;
  briefName: string;
  setBriefName: (v: string) => void;
  clientName: string;
  setClientName: (v: string) => void;
  analyzing: boolean;
  analysis: BriefAnalysis | null;
  extractedFields: ExtractedField[];
  onAnalyze: () => void;
  urlSuggestion: string | null;
  scanningUrl: boolean;
  onScanUrl: (url?: string) => void;
  uploadingFile: boolean;
  onFileUpload: (file: File) => void;
}

const BriefMode: React.FC<BriefModeProps> = ({
  briefText, setBriefText, briefName, setBriefName, clientName, setClientName,
  analyzing, analysis, extractedFields,
  urlSuggestion, scanningUrl, onScanUrl, uploadingFile, onFileUpload,
}) => {
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const [dragActive, setDragActive] = useState(false);
  const [showUrlInput, setShowUrlInput] = useState(false);
  const [manualUrl, setManualUrl] = useState('');

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragActive(false);
    const file = e.dataTransfer.files?.[0];
    if (file) onFileUpload(file);
  };

  const sourceInfo = urlSuggestion ? detectUrlSource(urlSuggestion) : null;

  return (
  <div className="grid grid-cols-1 lg:grid-cols-2 gap-0 min-h-[440px]">
    {/* Left : input */}
    <div className="p-6 space-y-3 lg:border-r border-border">
      <div className="grid grid-cols-2 gap-2">
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Nom (optionnel)
          </label>
          <input
            value={briefName}
            onChange={(e) => setBriefName(e.target.value)}
            placeholder="Ex: Senior React @ Doctolib"
            className="w-full h-9 px-3 mt-1 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
          />
        </div>
        <div>
          <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
            Client (optionnel)
          </label>
          <input
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            placeholder="Ex: Doctolib"
            className="w-full h-9 px-3 mt-1 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
          />
        </div>
      </div>

      {/* Import shortcuts */}
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mr-1">
          Importer depuis
        </p>
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploadingFile}
          className="h-7 px-2.5 inline-flex items-center gap-1.5 rounded-full text-[11px] font-medium border border-border bg-card hover:bg-accent transition-colors disabled:opacity-50"
        >
          {uploadingFile ? <Loader2 className="w-3 h-3 animate-spin" /> : <Paperclip className="w-3 h-3" />}
          Un fichier
        </button>
        <button
          type="button"
          onClick={() => setShowUrlInput(s => !s)}
          className={cn(
            'h-7 px-2.5 inline-flex items-center gap-1.5 rounded-full text-[11px] font-medium border transition-colors',
            showUrlInput ? 'bg-foreground text-background border-foreground' : 'border-border bg-card hover:bg-accent',
          )}
        >
          <Link2 className="w-3 h-3" />
          Une URL
        </button>
        <span className="text-[10px] text-muted-foreground/70 flex-1 text-right">
          PDF · DOCX · TXT · WTTJ · LinkedIn Jobs · careers
        </span>
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf,.docx,.doc,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
          className="sr-only"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) onFileUpload(file);
            e.target.value = '';
          }}
        />
      </div>

      {/* URL input box (apparait quand on clique "Une URL") */}
      {showUrlInput && (
        <div className="konekt-fade-up flex items-center gap-2 bg-card border border-border rounded-md p-2">
          <Globe className="w-3.5 h-3.5 text-muted-foreground flex-shrink-0 ml-1" />
          <input
            value={manualUrl}
            onChange={(e) => setManualUrl(e.target.value)}
            placeholder="https://www.welcometothejungle.com/fr/companies/…"
            className="flex-1 h-8 px-2 text-[12px] bg-transparent focus:outline-none"
            onKeyDown={(e) => {
              if (e.key === 'Enter' && manualUrl.trim() && isValidUrl(manualUrl.trim())) {
                onScanUrl(manualUrl.trim());
                setManualUrl('');
                setShowUrlInput(false);
              }
            }}
            autoFocus
          />
          <button
            type="button"
            onClick={() => {
              if (manualUrl.trim() && isValidUrl(manualUrl.trim())) {
                onScanUrl(manualUrl.trim());
                setManualUrl('');
                setShowUrlInput(false);
              }
            }}
            disabled={!manualUrl.trim() || !isValidUrl(manualUrl.trim()) || scanningUrl}
            className="h-7 px-3 rounded-md text-[11px] font-medium bg-foreground text-background hover:opacity-90 disabled:opacity-40 transition-opacity"
          >
            {scanningUrl ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Scanner'}
          </button>
        </div>
      )}

      {/* URL detection banner — quand l'user a collé une URL dans le brief */}
      {urlSuggestion && sourceInfo && (
        <div
          className="konekt-fade-up flex items-center gap-2 px-3 py-2 rounded-md"
          style={{
            background: 'linear-gradient(135deg, hsl(271 81% 56% / 0.10), hsl(217 91% 60% / 0.10))',
            border: '1px solid hsl(271 81% 56% / 0.3)',
          }}
        >
          <span className="text-base">{sourceInfo.emoji}</span>
          <p className="text-[12px] flex-1 min-w-0 truncate">
            <span className="font-semibold konekt-skalr-text">{sourceInfo.label}</span>
            <span className="text-muted-foreground ml-1">détecté — pré-remplir titre + entreprise ?</span>
          </p>
          <button
            type="button"
            onClick={() => onScanUrl()}
            disabled={scanningUrl}
            className="h-7 px-3 rounded-full text-[11px] font-semibold text-white konekt-skalr-bg konekt-shine flex-shrink-0 disabled:opacity-50"
          >
            {scanningUrl ? <Loader2 className="w-3 h-3 animate-spin" /> : 'Pré-remplir →'}
          </button>
        </div>
      )}

      <div
        onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
        onDragLeave={() => setDragActive(false)}
        onDrop={handleDrop}
        className={cn('relative rounded-md transition-all', dragActive && 'ring-2 ring-foreground/40')}
      >
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          Fiche de poste / Brief
        </label>
        <textarea
          value={briefText}
          onChange={(e) => setBriefText(e.target.value)}
          placeholder={`Colle ta fiche de poste ici, glisse-dépose un fichier, ou tape ton brief...\n\nEx:\nSenior Software Engineer pour Doctolib.\nStack React + TypeScript + Node.\n5+ ans d'expérience, idéalement passé par une scale-up santé ou fintech.\nParis ou full-remote France. Démarrage T3 2026.`}
          rows={10}
          className="w-full mt-1 px-3 py-2 text-[13px] leading-relaxed rounded-md border border-border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
        />
        {dragActive && (
          <div className="absolute inset-0 mt-5 flex items-center justify-center rounded-md bg-background/90 border-2 border-dashed border-foreground/40 pointer-events-none">
            <div className="text-center">
              <Upload className="w-6 h-6 mx-auto mb-2 text-foreground" />
              <p className="text-sm font-semibold">Lâche pour importer</p>
              <p className="text-xs text-muted-foreground">PDF · DOCX · TXT</p>
            </div>
          </div>
        )}
        <p className="text-[10.5px] text-muted-foreground mt-1.5">
          {briefText.length} caractères · {briefText.trim().length < 20 ? 'minimum 20' : 'prêt pour analyse'}
        </p>
      </div>
    </div>

    {/* Right : live extraction */}
    <div className="p-6 bg-card/30">
      <div className="flex items-center gap-2 mb-3">
        <div className="h-6 w-6 rounded-md grid place-items-center konekt-skalr-bg flex-shrink-0">
          <Sparkles className="w-3 h-3 text-white" strokeWidth={2.5} />
        </div>
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          {analyzing ? 'Copilot analyse…' : analysis ? 'Copilot a détecté' : 'Copilot prêt'}
        </p>
        {analyzing && (
          <div className="flex items-end gap-0.5 h-3 ml-auto" style={{ color: 'hsl(330 81% 70%)' }}>
            <span className="w-0.5 h-2 bg-current rounded animate-pulse" />
            <span className="w-0.5 h-3 bg-current rounded animate-pulse" style={{ animationDelay: '100ms' }} />
            <span className="w-0.5 h-2.5 bg-current rounded animate-pulse" style={{ animationDelay: '200ms' }} />
          </div>
        )}
      </div>

      {!analysis && !analyzing && (
        <div className="text-center py-12 text-muted-foreground">
          <p className="text-[12px] leading-relaxed">
            Colle ton brief à gauche et clique sur <strong className="text-foreground">Analyser avec l'IA</strong>.
          </p>
          <p className="text-[11px] mt-2 opacity-70">
            En quelques secondes, l'IA détecte le titre, les compétences clés, l'expérience, la localisation et génère les filtres de recherche.
          </p>
        </div>
      )}

      {analyzing && (
        <div className="space-y-2">
          {[0, 1, 2, 3, 4, 5].map(i => (
            <div
              key={i}
              className="h-9 rounded-md bg-muted/40 animate-pulse"
              style={{ animationDelay: `${i * 80}ms`, opacity: 1 - i * 0.12 }}
            />
          ))}
        </div>
      )}

      {analysis && extractedFields.length > 0 && (
        <div className="grid grid-cols-1 gap-1.5 konekt-fade-up">
          {extractedFields.map((f, i) => {
            const Icon = f.icon;
            return (
              <div
                key={i}
                className="flex items-start gap-2 px-2.5 py-2 rounded-md bg-card border border-border konekt-fade-up"
                style={{ animationDelay: `${i * 50}ms` }}
              >
                <Icon className="w-3.5 h-3.5 text-muted-foreground mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] uppercase tracking-wider text-muted-foreground">{f.label}</p>
                  <p className="text-[12px] font-medium truncate">{f.value}</p>
                </div>
                <Check className="w-3.5 h-3.5 mt-0.5 flex-shrink-0" style={{ color: 'hsl(var(--status-success))' }} strokeWidth={3} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  </div>
  );
};

// ─── Mode Manuel ────────────────────────────────────────────────

interface ManualModeProps {
  name: string;
  setName: (v: string) => void;
  clientName: string;
  setClientName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
}

const ManualMode: React.FC<ManualModeProps> = ({
  name, setName, clientName, setClientName, description, setDescription,
}) => (
  <div className="px-8 py-8 max-w-xl mx-auto space-y-4 konekt-fade-up">
    <div>
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        Titre de la mission <span className="text-destructive">*</span>
      </label>
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Ex: Senior React Engineer"
        className="w-full h-10 px-3 mt-1 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
        autoFocus
      />
    </div>
    <div>
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        Client / Entreprise (optionnel)
      </label>
      <input
        value={clientName}
        onChange={(e) => setClientName(e.target.value)}
        placeholder="Ex: Doctolib"
        className="w-full h-10 px-3 mt-1 text-sm rounded-md border border-border bg-background focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
      />
    </div>
    <div>
      <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        Description (optionnel)
      </label>
      <textarea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Quelques lignes pour décrire la mission, le contexte, les enjeux…"
        rows={6}
        className="w-full mt-1 px-3 py-2 text-sm rounded-md border border-border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
      />
    </div>
    <p className="text-[11px] text-muted-foreground">
      Tu pourras compléter le brief, ajouter des compétences et lancer l'analyse IA après création.
    </p>
  </div>
);

// ─── Voice Placeholder ──────────────────────────────────────────

const VoicePlaceholder: React.FC = () => (
  <div className="px-8 py-16 text-center konekt-fade-up">
    <div className="h-14 w-14 rounded-2xl konekt-skalr-bg konekt-shine grid place-items-center mx-auto mb-4">
      <Mic className="w-6 h-6 text-white" strokeWidth={2} />
    </div>
    <h3 className="font-display text-xl font-bold mb-2">Dictée vocale arrive bientôt</h3>
    <p className="text-[13px] text-muted-foreground max-w-sm mx-auto">
      Tu pourras décrire ta mission à l'oral pendant que l'IA structure tout en temps réel.
      <br />En attendant, utilise le mode <strong className="text-foreground">Coller une fiche</strong> qui marche déjà très bien.
    </p>
  </div>
);

// ─── Helpers ───────────────────────────────────────────────────

interface ExtractedField {
  label: string;
  value: string;
  icon: typeof FileText;
}

function buildExtractedFields(a: BriefAnalysis['analysis']): ExtractedField[] {
  const fields: ExtractedField[] = [];

  if (a.suggested_title) {
    fields.push({ label: 'Titre', value: a.suggested_title, icon: FileText });
  }
  if (a.role_keywords && a.role_keywords.length > 0) {
    fields.push({ label: 'Rôles', value: a.role_keywords.slice(0, 3).join(', '), icon: Briefcase });
  }
  if (a.skills_to_search && a.skills_to_search.length > 0) {
    fields.push({ label: 'Compétences', value: a.skills_to_search.slice(0, 5).join(', '), icon: Layers });
  }
  if (a.years_experience_min !== undefined && a.years_experience_min !== null) {
    const max = a.years_experience_max;
    const exp = max ? `${a.years_experience_min}–${max} ans` : `${a.years_experience_min}+ ans`;
    fields.push({ label: 'Expérience', value: exp, icon: Star });
  }
  if (a.location_hint) {
    fields.push({ label: 'Localisation', value: a.location_hint, icon: MapPin });
  }
  if (a.job_category) {
    fields.push({ label: 'Catégorie', value: a.job_category, icon: Building2 });
  }

  return fields;
}

/**
 * CreateMissionV2 : création d'une mission.
 *
 * Trois écrans dans une même fenêtre :
 *   - choose : coller une fiche de poste (Brief IA) ou saisir à la main ;
 *   - brief  : la fiche à gauche, ce que l'assistant en retient à droite ;
 *   - manual : titre, client, description.
 *
 * Mise en forme : docs/design/01-direction.md et 06-simplicite.md (un seul
 * bouton plein, pas de cadre autour des listes, ni emoji ni dégradé, vouvoiement).
 *
 * Analyse : edge function generate-search-filters, action « brief_analysis »
 * (Sonnet 5.5 par défaut, catalogue _shared/ai-config.ts). Elle renvoie les
 * filtres de recherche (filters_snapshot) et le brief structuré (job_details).
 *
 * Réutilise :
 *   - useSourcingProjects.createProject
 *   - la redirection vers /missions/:id
 *   - editorDraft : la saisie survit à une fermeture (constat UX06)
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
  saveEditorDraft,
  loadEditorDraft,
  clearEditorDraft,
  editorDraftSavedAt,
} from '@/lib/editorDraft';
import { useNavigate } from 'react-router-dom';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { IconTile } from '@/components/ui/IconTile';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useSourcingProjects, CreateProjectInput } from '@/hooks/useSourcingProjects';
import { isInsufficientCreditsError } from '@/lib/invokeEdgeFunction';
import { invokeWithCredits } from '@/lib/invokeWithCredits';
import { toast } from 'sonner';
import {
  ArrowLeft, ArrowRight, FileText, Globe, Link2, Paperclip, Pencil, Upload,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { BriefAnalysisPanel } from './BriefAnalysisPanel';
import {
  MIN_BRIEF_CHARS, MAX_BRIEF_CHARS, SHORT_BRIEF_CHARS, CREDITS_EXHAUSTED_MESSAGE,
  analysisErrorMessage, buildExtractedFields, buildJobDetails, suggestedMissionName,
  type AnalyzeResponse, type BriefAnalysis, type ExtractedField,
} from './briefAnalysis';

// ── URL helpers (détection des sources connues) ──
function detectUrlSource(url: string): { label: string } | null {
  const lower = url.toLowerCase();
  if (lower.includes('welcometothejungle')) return { label: 'Welcome to the Jungle' };
  if (lower.includes('linkedin.com/jobs')) return { label: 'LinkedIn Jobs' };
  if (lower.includes('linkedin.com')) return { label: 'LinkedIn' };
  if (lower.includes('lever.co')) return { label: 'Lever' };
  if (lower.includes('greenhouse.io')) return { label: 'Greenhouse' };
  if (lower.includes('workable.com')) return { label: 'Workable' };
  if (lower.includes('teamtailor.com')) return { label: 'Teamtailor' };
  if (lower.includes('jobteaser.com')) return { label: 'JobTeaser' };
  if (lower.includes('apec.fr')) return { label: 'APEC' };
  if (/career|job|recrutement|emploi|talent|hiring|offre/i.test(url)) {
    return { label: 'Page carrière' };
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

// ── Parse local URL : pour extraire title/company directement depuis le slug
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

    // LinkedIn jobs : /jobs/view/{id}, pas de slug dans le path, on doit fetch
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
  /** Pré-sélectionne un mode d'entrée : 'brief' | 'manual' */
  initialMode?: EntryMode;
}

type EntryMode = 'choose' | 'brief' | 'manual';

const MODE_TITLES: Record<EntryMode, string> = {
  choose: 'Nouvelle mission',
  brief: 'Brief IA',
  manual: 'Saisie manuelle',
};

const MODE_DESCRIPTIONS: Record<EntryMode, string> = {
  choose: 'Comment souhaitez-vous décrire la mission ?',
  brief: "Collez la fiche de poste : l'assistant en tire les informations du brief.",
  manual: 'Renseignez les champs. Vous complèterez le brief après la création.',
};

// ── Choix du mode d'entrée ──

const MODE_OPTIONS: {
  value: Exclude<EntryMode, 'choose'>;
  label: string;
  desc: string;
  icon: typeof FileText;
  recommended?: boolean;
}[] = [
  {
    value: 'brief',
    label: 'Coller une fiche de poste',
    desc: "L'assistant en tire le titre, les compétences, l'expérience et le lieu, puis prépare la recherche.",
    icon: FileText,
    recommended: true,
  },
  {
    value: 'manual',
    label: 'Saisir à la main',
    desc: 'Pour un brief complexe ou à plusieurs rôles. Vous remplissez les champs un par un.',
    icon: Pencil,
  },
];

/** Clé du brouillon de création de mission, une seule par navigateur. */
const MISSION_DRAFT_KEY = 'create-mission';
/** Délai entre une saisie et l'enregistrement du brouillon. */
const DRAFT_SAVE_DELAY_MS = 600;

interface MissionDraft {
  mode?: EntryMode;
  briefText?: string;
  briefName?: string;
  clientName?: string;
  description?: string;
}

/**
 * Écrit le brouillon seulement s'il diffère de celui déjà stocké : ouvrir puis
 * fermer la fenêtre sans rien changer ne rafraîchit ni sa date ni sa durée de vie.
 */
function persistDraft(brouillon: MissionDraft | null): void {
  const stocke = loadEditorDraft<MissionDraft>(MISSION_DRAFT_KEY);
  if (JSON.stringify(stocke) === JSON.stringify(brouillon)) return;
  saveEditorDraft(MISSION_DRAFT_KEY, brouillon);
}

function shortcutLabel(): string {
  return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)
    ? 'Cmd + Entrée'
    : 'Ctrl + Entrée';
}

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
  // Fiche et client au moment de l'analyse : s'ils changent ensuite, le résultat est périmé.
  const [analysedKey, setAnalysedKey] = useState<string | null>(null);
  const [analysisError, setAnalysisError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  // Import URL state
  const [scanningUrl, setScanningUrl] = useState(false);
  const [urlSuggestion, setUrlSuggestion] = useState<string | null>(null);
  // File upload state
  const [uploadingFile, setUploadingFile] = useState(false);
  // Passe a vrai quand la mission a ete creee : la saisie n'est alors plus conservee.
  const creationReussieRef = useRef(false);
  // Vrai tant que le nom vient d'une saisie de l'utilisateur : l'analyse n'y touche pas.
  const userNamedRef = useRef(false);

  const analysisKey = `${briefText.trim().slice(0, MAX_BRIEF_CHARS)}\u0000${clientName.trim()}`;
  const isStale = analysis !== null && analysedKey !== analysisKey;
  const canAnalyze = briefText.trim().length >= MIN_BRIEF_CHARS;
  const { fields: extractedFields, missing: missingFields } = analysis
    ? buildExtractedFields(analysis.analysis, clientName)
    : { fields: [], missing: [] };

  const onNameChange = useCallback((value: string) => {
    userNamedRef.current = value.trim() !== '';
    setBriefName(value);
  }, []);

  // Détecte automatiquement une URL collée dans le brief, propose de pré-remplir
  useEffect(() => {
    const url = extractUrl(briefText.trim());
    if (url && isValidUrl(url) && detectUrlSource(url)) {
      setUrlSuggestion(url);
    } else {
      setUrlSuggestion(null);
    }
  }, [briefText]);

  // Brouillon : la saisie en cours est conservée au lieu d'être effacée, puis
  // proposée à la réouverture. Une fiche de poste collée survit donc à une
  // fermeture par erreur (audit UX du 09/09/2026, constat UX06).
  const brouillonCourant = (): MissionDraft | null => {
    const aDuTexte =
      briefText.trim() || briefName.trim() || clientName.trim() || description.trim();
    const aConserver = aDuTexte && !creationReussieRef.current;
    return aConserver ? { mode, briefText, briefName, clientName, description } : null;
  };
  const brouillonRef = useRef(brouillonCourant);
  useEffect(() => {
    brouillonRef.current = brouillonCourant;
  });

  // Les parents retirent la fenêtre à la fermeture : le composant est démonté sans
  // jamais passer par isOpen = false. L'ancien effet de fermeture ne s'exécutait donc
  // pas, et la saisie était perdue. On conserve au démontage, sans effacer ici : le
  // double montage du mode strict passe par un état encore vide.
  useEffect(() => () => {
    const brouillon = brouillonRef.current();
    if (brouillon) persistDraft(brouillon);
  }, []);

  // Enregistrement au fil de la saisie : un rechargement de page ne perd pas la fiche.
  useEffect(() => {
    if (!isOpen) return;
    const t = setTimeout(() => persistDraft(brouillonRef.current()), DRAFT_SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [isOpen, mode, briefText, briefName, clientName, description]);

  // Réouverture : on repropose le brouillon, sans écraser une saisie en cours.
  useEffect(() => {
    if (!isOpen) return;
    if (briefText || briefName || clientName || description) return;
    const brouillon = loadEditorDraft<MissionDraft>(MISSION_DRAFT_KEY);
    if (!brouillon) return;
    if (brouillon.mode) setMode(brouillon.mode);
    setBriefText(brouillon.briefText || '');
    setBriefName(brouillon.briefName || '');
    userNamedRef.current = !!brouillon.briefName?.trim();
    setClientName(brouillon.clientName || '');
    setDescription(brouillon.description || '');
    const quand = editorDraftSavedAt(MISSION_DRAFT_KEY);
    toast.info('Brouillon repris', {
      description: quand
        ? `Votre saisie du ${quand.toLocaleDateString('fr-FR')} à ${quand.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })} a été conservée.`
        : 'Votre saisie précédente a été conservée.',
    });
    // Au seul passage à l'ouverture.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen]);

  // ── Brief IA : analyse + creation ──
  const handleAnalyze = useCallback(async () => {
    const text = briefText.trim().slice(0, MAX_BRIEF_CHARS);
    if (text.length < MIN_BRIEF_CHARS || analyzing) return;
    const key = analysisKey;
    setAnalyzing(true);
    setAnalysis(null);
    setAnalysisError(null);

    try {
      const syntheticJob = {
        id: 'draft',
        title: text.split('\n')[0].slice(0, 80),
        description: text,
        client: clientName.trim() ? { name: clientName.trim() } : null,
        location: null,
        skills: [],
        seniority: null,
      };

      const { data, error } = await invokeWithCredits<AnalyzeResponse>(
        'generate-search-filters',
        'brief_analysis',
        { job: syntheticJob },
        { description: 'Brief IA : analyse de la fiche de poste' },
      );

      if (error) {
        if (isInsufficientCreditsError(error)) {
          // invokeWithCredits vient d'afficher le toast « Crédits IA insuffisants ».
          setAnalysisError(CREDITS_EXHAUSTED_MESSAGE);
          return;
        }
        throw error;
      }
      if (!data?.success || data.degraded || !data.analysis) throw new Error('Analyse inexploitable');

      setAnalysis({ filters: data.filters ?? {}, analysis: data.analysis });
      setAnalysedKey(key);
      if (!userNamedRef.current) {
        setBriefName(data.analysis.suggested_title || suggestedMissionName(data.analysis));
      }
    } catch (err) {
      console.error('[CreateMissionV2] analyse impossible :', err);
      setAnalysisError(analysisErrorMessage(err));
    } finally {
      setAnalyzing(false);
    }
  }, [briefText, clientName, analyzing, analysisKey]);

  const handleCreateFromBrief = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    try {
      const input: CreateProjectInput = {
        name: briefName.trim() || briefText.trim().split('\n')[0].slice(0, 80) || 'Nouvelle mission',
        description: briefText.trim(),
        client_name: clientName.trim() || undefined,
      };

      if (analysis) {
        input.filters_snapshot = {
          ...analysis.filters,
          generated_at: new Date().toISOString(),
          brief_text: briefText.trim(),
        };
        // Pré-remplit job_details avec ce que l'IA a extrait : c'est ce qui
        // alimente le SCORING IA des candidats et le brief structuré.
        input.job_details = buildJobDetails(analysis.analysis, {
          briefName: briefName.trim(),
          briefText,
          clientName: clientName.trim(),
        });
      }

      const project = await createProject(input);
      // La mission existe : le brouillon n'a plus lieu d'etre conserve.
      creationReussieRef.current = true;
      clearEditorDraft(MISSION_DRAFT_KEY);
      onClose();
      if (project?.id) {
        navigate(`/missions/${project.id}?tab=${analysis ? 'sourcing' : 'brief'}`);
      }
    } catch {
      // handled by hook
    } finally {
      setCreating(false);
    }
  }, [creating, briefName, briefText, clientName, analysis, createProject, onClose, navigate]);

  // ── Scan d'URL : parsing local du slug uniquement.
  //
  // Note : on n'essaie PAS de scraper le contenu de la page.
  // Les sites modernes (WTTJ, LinkedIn jobs, ATS) font du Client-Side
  // Rendering avec anti-bot, ce qui rend le scraping non-fiable.
  // À la place : parsing rapide du slug pour pré-remplir titre +
  // entreprise + lieu, et l'utilisateur colle le texte de la fiche.
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
        ].filter(Boolean).join('\n');

        setBriefText(prev => {
          const without = prev.replace(url, '').trim();
          return without ? `${without}\n\n${lines}` : lines;
        });
        if (!briefName && parsed.title) setBriefName(parsed.title);
        if (!clientName && parsed.company) setClientName(parsed.company);
        setUrlSuggestion(null);

        toast.success(`${parsed.source} reconnu`, {
          description: 'Poste, entreprise et lieu pré-remplis. Collez ensuite le texte de la fiche sous ces lignes.',
          duration: 6000,
        });
        return;
      }

      // Cas 2 : URL de page entreprise (pas une fiche de poste précise)
      if (parsed && !parsed.isJobUrl && parsed.company) {
        if (!clientName) setClientName(parsed.company);
        toast.info('Page entreprise détectée', {
          description: `Entreprise pré-remplie (${parsed.company}). Collez le texte de la fiche de poste dans la zone prévue.`,
          duration: 7000,
        });
        return;
      }

      // Cas 3 : URL non reconnue
      toast.warning('Adresse non reconnue', {
        description: 'Collez directement le texte de la fiche dans la zone prévue.',
        duration: 5000,
      });
    } catch {
      toast.error("L'adresse n'a pas pu être lue.");
    } finally {
      setScanningUrl(false);
    }
  }, [urlSuggestion, briefName, clientName]);

  // ── Upload d'un fichier texte (TXT / Markdown) ──
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
          const cleaned = text.trim().slice(0, MAX_BRIEF_CHARS);
          return prev.trim() ? `${prev.trim()}\n\n${cleaned}` : cleaned;
        });
        if (!briefName) {
          const guessedName = file.name.replace(/\.[^.]+$/, '').replace(/[-_]/g, ' ').slice(0, 60);
          setBriefName(guessedName);
        }
        toast.success(`Fichier « ${file.name} » importé`);
        return;
      }

      toast.error(`Le format ${ext.toUpperCase()} n'est pas pris en charge`, {
        description: 'Importez un fichier .txt ou .md, ou copiez le texte du document dans la zone de la fiche.',
      });
    } catch {
      toast.error('Le fichier n\'a pas pu être lu.');
    } finally {
      setUploadingFile(false);
    }
  }, [briefName]);

  // ── Manuel ──
  const handleCreateManual = useCallback(async () => {
    if (creating) return;
    if (!briefName.trim()) {
      toast.error('Le titre est requis');
      return;
    }
    setCreating(true);
    try {
      const project = await createProject({
        name: briefName.trim(),
        description: description || undefined,
        client_name: clientName.trim() || undefined,
      });
      creationReussieRef.current = true;
      clearEditorDraft(MISSION_DRAFT_KEY);
      onClose();
      if (project?.id) {
        navigate(`/missions/${project.id}?tab=brief`);
      }
    } catch {
      // handled by hook
    } finally {
      setCreating(false);
    }
  }, [creating, briefName, description, clientName, createProject, onClose, navigate]);

  // Ctrl + Entrée (Cmd sur Mac) : l'action principale de l'écran.
  const handleShortcut = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || !(e.metaKey || e.ctrlKey) || e.shiftKey) return;
    e.preventDefault();
    if (mode === 'brief') {
      if (analysis) handleCreateFromBrief();
      else handleAnalyze();
    } else if (mode === 'manual' && briefName.trim()) {
      handleCreateManual();
    }
  };

  // Vide pendant une action : le bouton et le panneau disent déjà ce qui se passe.
  const briefStatus = creating || analyzing
    ? ''
    : analysis
      ? `${extractedFields.length} informations retenues`
      : canAnalyze
        ? null
        : `Collez ou saisissez au moins ${MIN_BRIEF_CHARS} caractères`;

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent
        onKeyDown={handleShortcut}
        className="flex max-h-[90vh] max-w-[960px] flex-col gap-0 overflow-hidden p-0"
      >
        {/* La croix de fermeture est celle du dialogue ; pr-14 lui laisse la place. */}
        <div className="flex shrink-0 items-center gap-3 border-b border-border py-4 pl-6 pr-14">
          {mode !== 'choose' && (
            <Button
              variant="ghost"
              size="icon-sm"
              className="-ml-2"
              aria-label="Retour"
              onClick={() => setMode('choose')}
            >
              <ArrowLeft />
            </Button>
          )}
          <div className="min-w-0">
            <DialogTitle>{MODE_TITLES[mode]}</DialogTitle>
            <DialogDescription className="text-xs">{MODE_DESCRIPTIONS[mode]}</DialogDescription>
          </div>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto">
          {mode === 'choose' && <ChooseMode onPick={setMode} />}
          {mode === 'brief' && (
            <BriefMode
              briefText={briefText}
              setBriefText={setBriefText}
              briefName={briefName}
              onNameChange={onNameChange}
              clientName={clientName}
              setClientName={setClientName}
              analyzing={analyzing}
              analysis={analysis}
              analysisError={analysisError}
              isStale={isStale}
              extractedFields={extractedFields}
              missingFields={missingFields}
              onAnalyze={canAnalyze ? handleAnalyze : undefined}
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
              onNameChange={onNameChange}
              clientName={clientName}
              setClientName={setClientName}
              description={description}
              setDescription={setDescription}
            />
          )}
        </div>

        {/* Footer (selon mode) */}
        {mode === 'brief' && (
          <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-6 py-3">
            <p className="min-w-0 truncate text-xs text-muted-foreground" aria-live="polite">
              {briefStatus ?? (
                <>
                  Prêt à analyser
                  <kbd className="ml-2 font-mono text-xs">{shortcutLabel()}</kbd>
                </>
              )}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              {!analysis && !analyzing && canAnalyze && (
                <Button variant="ghost" onClick={handleCreateFromBrief} disabled={creating}>
                  Créer sans analyse
                </Button>
              )}
              {analysis ? (
                <Button variant="primary" onClick={handleCreateFromBrief} loading={creating}>
                  Créer la mission
                  <ArrowRight />
                </Button>
              ) : (
                <Button variant="primary" onClick={handleAnalyze} loading={analyzing} disabled={!canAnalyze}>
                  {analyzing ? 'Analyse en cours' : 'Analyser la fiche'}
                </Button>
              )}
            </div>
          </div>
        )}

        {mode === 'manual' && (
          <div className="flex shrink-0 items-center justify-end gap-2 border-t border-border px-6 py-3">
            <Button variant="ghost" onClick={onClose}>
              Annuler
            </Button>
            <Button variant="primary" onClick={handleCreateManual} loading={creating} disabled={!briefName.trim()}>
              Créer la mission
              <ArrowRight />
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};

// ─── Mode Choose ──────────────────────────────────────────────

const ChooseMode: React.FC<{ onPick: (mode: EntryMode) => void }> = ({ onPick }) => (
  <div className="konekt-fade-up grid grid-cols-1 gap-3 p-6 sm:grid-cols-2 sm:p-8">
    {MODE_OPTIONS.map(opt => (
      <Button
        key={opt.value}
        type="button"
        variant="outline"
        onClick={() => onPick(opt.value)}
        className="h-auto flex-col items-start justify-start gap-4 whitespace-normal p-5 text-left"
      >
        <IconTile icon={opt.icon} tone={opt.recommended ? 'brand' : 'default'} size="md" />
        <span className="block space-y-1">
          <span className="flex items-center gap-2">
            <span className="text-md font-semibold">{opt.label}</span>
            {opt.recommended && <Badge variant="brand">Recommandé</Badge>}
          </span>
          <span className="block text-sm font-normal text-foreground-secondary">{opt.desc}</span>
        </span>
      </Button>
    ))}
  </div>
);

// ─── Mode Brief IA ──────────────────────────────────────────────

interface BriefModeProps {
  briefText: string;
  setBriefText: (v: string) => void;
  briefName: string;
  onNameChange: (v: string) => void;
  clientName: string;
  setClientName: (v: string) => void;
  analyzing: boolean;
  analysis: BriefAnalysis | null;
  analysisError: string | null;
  isStale: boolean;
  extractedFields: ExtractedField[];
  missingFields: string[];
  /** Absent quand la fiche est trop courte pour être analysée. */
  onAnalyze?: () => void;
  urlSuggestion: string | null;
  scanningUrl: boolean;
  onScanUrl: (url?: string) => void;
  uploadingFile: boolean;
  onFileUpload: (file: File) => void;
}

const BriefMode: React.FC<BriefModeProps> = ({
  briefText, setBriefText, briefName, onNameChange, clientName, setClientName,
  analyzing, analysis, analysisError, isStale, extractedFields, missingFields, onAnalyze,
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

  const submitManualUrl = () => {
    const url = manualUrl.trim();
    if (!url || !isValidUrl(url)) return;
    onScanUrl(url);
    setManualUrl('');
    setShowUrlInput(false);
  };

  const sourceInfo = urlSuggestion ? detectUrlSource(urlSuggestion) : null;
  const length = briefText.length;
  const trimmedLength = briefText.trim().length;

  return (
    // Sur grand écran, hauteur fixe : la fenêtre ne change pas de taille d'un état à l'autre
    // et chaque colonne défile seule. Sur téléphone, les colonnes s'empilent et le corps défile.
    <div className="grid grid-cols-1 lg:h-[min(36rem,calc(90vh-9rem))] lg:grid-cols-2 lg:grid-rows-[minmax(0,1fr)]">
      {/* Gauche : la fiche */}
      <div className="flex flex-col gap-4 p-6 lg:min-h-0 lg:overflow-y-auto">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="brief-name" className="text-xs text-foreground-secondary">
              Nom de la mission <span className="font-normal text-muted-foreground">(facultatif)</span>
            </Label>
            <Input
              id="brief-name"
              value={briefName}
              onChange={(e) => onNameChange(e.target.value)}
              placeholder="Rempli par l'analyse si vide"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="brief-client" className="text-xs text-foreground-secondary">
              Client <span className="font-normal text-muted-foreground">(facultatif)</span>
            </Label>
            <Input
              id="brief-client"
              value={clientName}
              onChange={(e) => setClientName(e.target.value)}
              placeholder="Ex : Numspot"
            />
          </div>
        </div>

        {/* Import */}
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted-foreground">Importer</span>
          <Button
            variant="outline"
            size="xs"
            onClick={() => fileInputRef.current?.click()}
            loading={uploadingFile}
          >
            {!uploadingFile && <Paperclip />}
            Un fichier
          </Button>
          <Button
            variant="outline"
            size="xs"
            aria-expanded={showUrlInput}
            onClick={() => setShowUrlInput(s => !s)}
            className={cn(showUrlInput && 'border-border-strong bg-accent')}
          >
            <Link2 />
            Une adresse web
          </Button>
          <Input
            ref={fileInputRef}
            type="file"
            accept=".txt,.md,text/plain,text/markdown"
            className="sr-only"
            tabIndex={-1}
            aria-label="Importer un fichier .txt ou .md"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) onFileUpload(file);
              e.target.value = '';
            }}
          />
        </div>

        {showUrlInput && (
          <div className="konekt-fade-up space-y-1.5">
            <div className="flex items-center gap-2">
              <Label htmlFor="brief-url" className="sr-only">Adresse de l'offre</Label>
              <Input
                id="brief-url"
                value={manualUrl}
                onChange={(e) => setManualUrl(e.target.value)}
                placeholder="https://www.welcometothejungle.com/fr/companies/…"
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.metaKey && !e.ctrlKey) {
                    e.preventDefault();
                    submitManualUrl();
                  }
                }}
                autoFocus
              />
              <Button
                variant="outline"
                onClick={submitManualUrl}
                disabled={!manualUrl.trim() || !isValidUrl(manualUrl.trim())}
                loading={scanningUrl}
              >
                Pré-remplir
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">
              Le poste, l'entreprise et le lieu sont lus dans l'adresse. Collez ensuite le texte de la fiche.
            </p>
          </div>
        )}

        {/* Adresse repérée dans la fiche collée */}
        {urlSuggestion && sourceInfo && (
          <div className="konekt-fade-up flex items-center gap-2 rounded-lg bg-muted px-3 py-2">
            <Globe className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <p className="min-w-0 flex-1 truncate text-xs">Adresse {sourceInfo.label} détectée.</p>
            <Button variant="ghost" size="xs" onClick={() => onScanUrl()} loading={scanningUrl}>
              Pré-remplir
            </Button>
          </div>
        )}

        <div
          onDragOver={(e) => { e.preventDefault(); setDragActive(true); }}
          onDragLeave={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDragActive(false);
          }}
          onDrop={handleDrop}
          className="relative flex flex-col gap-1.5 lg:min-h-[260px] lg:flex-1"
        >
          <Label htmlFor="brief-text" className="text-xs text-foreground-secondary">
            Fiche de poste
          </Label>
          <Textarea
            id="brief-text"
            value={briefText}
            onChange={(e) => setBriefText(e.target.value)}
            placeholder={'Collez la fiche de poste, glissez-déposez un fichier ou décrivez le besoin.\n\nExemple :\nIngénieur logiciel senior pour Doctolib. Stack React, TypeScript, Node. 5 ans d\'expérience minimum, idéalement en scale-up santé ou fintech. Paris ou télétravail complet en France. Démarrage au T3 2026.'}
            className="min-h-[240px] resize-none leading-relaxed lg:min-h-0 lg:flex-1"
            autoFocus
          />
          {dragActive && (
            <div className="pointer-events-none absolute inset-x-0 bottom-6 top-6 grid place-items-center rounded-lg border-2 border-dashed border-brand bg-popover/90">
              <div className="text-center">
                <Upload className="mx-auto mb-2 size-6" aria-hidden="true" />
                <p className="text-sm font-semibold">Déposez le fichier pour l'importer</p>
                <p className="text-xs text-muted-foreground">.txt ou .md</p>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              {length.toLocaleString('fr-FR')} caractères
              {length > MAX_BRIEF_CHARS && (
                <span className="text-warning">
                  {' '}: seuls les {MAX_BRIEF_CHARS.toLocaleString('fr-FR')} premiers sont analysés
                </span>
              )}
              {trimmedLength >= MIN_BRIEF_CHARS && trimmedLength < SHORT_BRIEF_CHARS && (
                <> : une fiche plus détaillée donne une analyse plus précise</>
              )}
            </span>
            <span>Fichier .txt ou .md, ou glisser-déposer</span>
          </div>
        </div>
      </div>

      {/* Droite : ce que l'assistant retient */}
      <BriefAnalysisPanel
        className="border-t border-border lg:min-h-0 lg:overflow-y-auto lg:border-l lg:border-t-0"
        analyzing={analyzing}
        hasAnalysis={analysis !== null}
        error={analysisError}
        stale={isStale}
        fields={extractedFields}
        missing={missingFields}
        onRetry={onAnalyze}
      />
    </div>
  );
};

// ─── Mode Manuel ────────────────────────────────────────────────

interface ManualModeProps {
  name: string;
  onNameChange: (v: string) => void;
  clientName: string;
  setClientName: (v: string) => void;
  description: string;
  setDescription: (v: string) => void;
}

const ManualMode: React.FC<ManualModeProps> = ({
  name, onNameChange, clientName, setClientName, description, setDescription,
}) => (
  <div className="konekt-fade-up mx-auto max-w-xl space-y-4 px-8 py-8">
    <div className="space-y-1.5">
      <Label htmlFor="manual-name">
        Titre de la mission <span className="font-normal text-muted-foreground">(obligatoire)</span>
      </Label>
      <Input
        id="manual-name"
        value={name}
        onChange={(e) => onNameChange(e.target.value)}
        placeholder="Ex : Ingénieur React senior"
        aria-required="true"
        autoFocus
      />
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="manual-client">
        Client <span className="font-normal text-muted-foreground">(facultatif)</span>
      </Label>
      <Input
        id="manual-client"
        value={clientName}
        onChange={(e) => setClientName(e.target.value)}
        placeholder="Ex : Doctolib"
      />
    </div>
    <div className="space-y-1.5">
      <Label htmlFor="manual-description">
        Description <span className="font-normal text-muted-foreground">(facultatif)</span>
      </Label>
      <Textarea
        id="manual-description"
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Quelques lignes sur la mission, le contexte et les enjeux."
        rows={6}
        className="resize-none"
      />
    </div>
  </div>
);

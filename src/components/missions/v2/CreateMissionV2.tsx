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
} from 'lucide-react';
import { cn } from '@/lib/utils';

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
}

const BriefMode: React.FC<BriefModeProps> = ({
  briefText, setBriefText, briefName, setBriefName, clientName, setClientName,
  analyzing, analysis, extractedFields,
}) => (
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

      <div>
        <label className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
          Fiche de poste / Brief
        </label>
        <textarea
          value={briefText}
          onChange={(e) => setBriefText(e.target.value)}
          placeholder={`Senior Software Engineer pour Doctolib.\nStack React + TypeScript + Node.\n5+ ans d'expérience, idéalement passé par une scale-up santé ou fintech.\nParis ou full-remote France. Démarrage T3 2026.`}
          rows={12}
          className="w-full mt-1 px-3 py-2 text-[13px] leading-relaxed rounded-md border border-border bg-background resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
        />
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

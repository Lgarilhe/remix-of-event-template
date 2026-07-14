import React, { useState } from 'react';
import {
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  useMessage,
} from '@assistant-ui/react';
import {
  ArrowUp, ChevronRight, Sparkles, Paperclip, X, FileText,
  Search, PenLine, BarChart3, Lightbulb, SlidersHorizontal,
  ClipboardList, MessageSquare, CheckCircle2, XCircle, AlertTriangle,
  MapPin, Briefcase,
} from 'lucide-react';
import { AnimatedOrb } from '@/components/ui/AnimatedOrb';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import { useNavigate } from 'react-router-dom';
import { useAgent } from '@/contexts/AgentContext';
import { ToolFallbackChip } from './tool-uis';
import { FileUpload, FileUploadTrigger, FileUploadContent } from '@/components/prompt-kit/file-upload';

interface SkalrThreadProps {
  contextMode?: string | null;
  /** Notion-style: model selector rendered inside the composer toolbar */
  modelSlot?: React.ReactNode;
  /**
   * Pont fichiers joints (P1.2) : le composer y publie ses fichiers et une
   * fonction clear ; l'adaptateur de chat les lit au moment de l'envoi
   * (ingestion → injection dans le message) puis appelle clear().
   */
  filesBridge?: React.MutableRefObject<{ files: File[]; clear: () => void }>;
}

type Suggestion = { icon: React.ComponentType<{ className?: string }>; label: string; prompt: string };
type WelcomeConfig = { title: string; subtitle: string; suggestions: Suggestion[] };

// Notion-AI-style landing: a greeting + clickable suggestions that send on
// click (ThreadPrimitive.Suggestion `send`). Shown only on an empty thread.
const WELCOME: Record<string, WelcomeConfig> = {
  free: {
    title: 'Comment puis-je t’aider ?',
    subtitle: 'Sourcing, messages d’approche, analyse de profils, prochaines actions.',
    suggestions: [
      { icon: Search, label: 'Sourcer des candidats', prompt: 'Je cherche des candidats pour un poste. Aide-moi à définir les critères.' },
      { icon: PenLine, label: 'Rédiger un message d’approche', prompt: 'Aide-moi à rédiger un message d’approche personnalisé pour un candidat.' },
      { icon: BarChart3, label: 'Analyser mes priorités', prompt: 'Analyse mes missions ouvertes et dis-moi quoi prioriser aujourd’hui.' },
      { icon: Lightbulb, label: 'Que peux-tu faire ?', prompt: 'Que peux-tu faire pour m’aider dans mon recrutement ?' },
    ],
  },
  sourcing: {
    title: 'Calibrons ta recherche',
    subtitle: 'Décris le poste, je structure les critères puis l’agent lance la recherche.',
    suggestions: [
      { icon: Search, label: 'Lancer le sourcing sur ce poste', prompt: 'Lançons le sourcing pour cette mission. Pose-moi les questions nécessaires pour calibrer.' },
      { icon: SlidersHorizontal, label: 'Affiner les critères', prompt: 'Aide-moi à affiner les critères de recherche pour ce poste.' },
    ],
  },
  brief: {
    title: 'Construisons le brief',
    subtitle: 'Je t’aide à cadrer le besoin, poste par poste.',
    suggestions: [
      { icon: ClipboardList, label: 'Compléter le brief', prompt: 'Aide-moi à compléter le brief de ce poste, champ par champ.' },
      { icon: MessageSquare, label: 'Questions à poser au client', prompt: 'Quelles questions dois-je poser au client pour bien cadrer ce recrutement ?' },
    ],
  },
  process: {
    title: 'Définissons le process',
    subtitle: 'Étapes d’évaluation, critères, deal-breakers.',
    suggestions: [
      { icon: ClipboardList, label: 'Proposer un process d’évaluation', prompt: 'Propose-moi un process d’évaluation adapté à ce poste.' },
    ],
  },
  outreach: {
    title: 'Travaillons l’approche',
    subtitle: 'Messages, séquences de relance, ton adapté au profil.',
    suggestions: [
      { icon: PenLine, label: 'Rédiger une séquence d’approche', prompt: 'Aide-moi à créer une séquence d’approche multicanale.' },
      { icon: MessageSquare, label: 'Améliorer un message', prompt: 'Améliore ce message d’approche : ' },
    ],
  },
};

/**
 * Claude/Notion-style reasoning toggle. Auto-expands while the model is still
 * "thinking" (no answer text yet), then collapses to a discreet line once the
 * answer streams. The header shimmers while thinking.
 */
const ReasoningBlock = ({ text }: { text: string }) => {
  const isRunning = useMessage((s) => s.status?.type === 'running');
  const hasText = useMessage((s) =>
    s.content?.some((part: any) => part.type === 'text' && part.text?.trim())
  );
  const streaming = isRunning && !hasText;
  const [userToggled, setUserToggled] = useState<boolean | null>(null);
  const open = userToggled ?? streaming;

  return (
    <div className="text-[13px]">
      <button
        onClick={() => setUserToggled(!open)}
        className="group flex items-center gap-1.5 py-0.5 text-left"
      >
        <ChevronRight
          className={cn(
            'h-3.5 w-3.5 text-muted-foreground/60 transition-transform duration-200',
            open && 'rotate-90'
          )}
        />
        <Sparkles className="h-3 w-3 text-muted-foreground/70" />
        <span
          className={cn(
            'text-[11px] font-semibold uppercase tracking-wider',
            streaming ? 'konekt-shimmer-text' : 'text-muted-foreground/70 group-hover:text-muted-foreground'
          )}
        >
          {streaming ? 'Réflexion en cours' : 'Réflexion'}
        </span>
      </button>
      <div
        className={cn(
          'grid transition-all duration-200 ease-out',
          open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0'
        )}
      >
        <div className="overflow-hidden">
          <div className="ml-[7px] mt-1 border-l border-border/60 pl-3 text-xs leading-relaxed text-muted-foreground/80 whitespace-pre-wrap">
            {text}
          </div>
        </div>
      </div>
    </div>
  );
};

/** Claude/Notion-style shimmering status line (only when nothing rendered yet) */
const ShimmerThinking = () => (
  <div className="flex items-center gap-2.5 animate-fade-in px-1">
    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted/60">
      <AnimatedOrb size={20} speed={6} />
    </div>
    <span className="konekt-shimmer-text text-[13px] font-medium">Réflexion en cours…</span>
  </div>
);

/**
 * Extrait les blocs système (`[OPTIONS]`, `[PROFILE]`, `[SCORING_TEST]`,
 * `[SEARCH_PLAN]`, `[AGENT_ACTION]`) du texte assistant.
 *
 * - OPTIONS → chips cliquables (chaque option envoie sa string comme message
 *   suivant).
 * - PROFILE → cards de profils échantillon (calibration agent autonome).
 * - SCORING_TEST → card de breakdown du scoring.
 * - SEARCH_PLAN → card résumé du plan de recherche.
 * - AGENT_ACTION → strippé (déclenche une action côté backend, pas d'UI).
 *
 * Gère aussi le streaming : tag ouvrant sans fermant → on cache la portion
 * partielle au lieu de l'afficher en raw pendant la frappe.
 */
const SYSTEM_TAGS = ['OPTIONS', 'SEARCH_PLAN', 'AGENT_ACTION', 'SCORING_TEST', 'PROFILE'] as const;

interface SampleProfileData {
  name: string;
  title: string;
  company: string;
  location: string;
  yearsExp: number;
  score?: number;
  trajectory: string[];
  strengths: string[];
  concerns: string[];
  tags: string[];
}

interface ScoringTestData {
  purpose: string;
  profiles: Array<{
    name: string;
    title: string;
    company: string;
    score: number;
    recommendation: 'go' | 'maybe' | 'skip';
    criteria: Array<{ label: string; verdict: 'pass' | 'partial' | 'fail'; detail: string }>;
  }>;
}

interface SearchPlanData {
  summary?: string;
  filters?: Record<string, unknown>;
  scoring_criteria?: Record<string, unknown>;
  stop_conditions?: Record<string, unknown>;
}

interface ParseResult {
  stripped: string;
  options: string[];
  profiles: SampleProfileData[];
  scoringTest: ScoringTestData | null;
  searchPlan: SearchPlanData | null;
}

function parseAssistantText(text: string): ParseResult {
  const options: string[] = [];
  const profiles: SampleProfileData[] = [];
  let scoringTest: ScoringTestData | null = null;
  let searchPlan: SearchPlanData | null = null;
  let stripped = text;

  // 1a. Extract OPTIONS (multiple)
  const optionsRe = /\[OPTIONS\]\s*(\[[\s\S]*?\])\s*\[\/OPTIONS\]/g;
  let m: RegExpExecArray | null;
  while ((m = optionsRe.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1]);
      if (Array.isArray(parsed)) {
        for (const item of parsed) {
          const label = typeof item === 'string' ? item.trim() : '';
          if (label) options.push(label);
        }
      }
    } catch { /* partial stream */ }
  }

  // 1b. Extract PROFILE blocks (one card per match — used during calibration)
  const profileRe = /\[PROFILE\]\s*([\s\S]*?)\s*\[\/PROFILE\]/g;
  while ((m = profileRe.exec(text)) !== null) {
    try {
      const parsed = JSON.parse(m[1]) as Partial<SampleProfileData>;
      if (parsed && typeof parsed.name === 'string') {
        profiles.push({
          name: parsed.name,
          title: parsed.title ?? '',
          company: parsed.company ?? '',
          location: parsed.location ?? '',
          yearsExp: typeof parsed.yearsExp === 'number' ? parsed.yearsExp : 0,
          score: typeof parsed.score === 'number' ? parsed.score : undefined,
          trajectory: Array.isArray(parsed.trajectory) ? parsed.trajectory : [],
          strengths: Array.isArray(parsed.strengths) ? parsed.strengths : [],
          concerns: Array.isArray(parsed.concerns) ? parsed.concerns : [],
          tags: Array.isArray(parsed.tags) ? parsed.tags : [],
        });
      }
    } catch { /* partial stream */ }
  }

  // 1c. Extract SCORING_TEST (single)
  const stMatch = text.match(/\[SCORING_TEST\]\s*([\s\S]*?)\s*\[\/SCORING_TEST\]/);
  if (stMatch) {
    try {
      const parsed = JSON.parse(stMatch[1]);
      if (parsed && Array.isArray(parsed.profiles)) {
        scoringTest = parsed as ScoringTestData;
      }
    } catch { /* partial stream */ }
  }

  // 1d. Extract SEARCH_PLAN (single)
  const spMatch = text.match(/\[SEARCH_PLAN\]\s*([\s\S]*?)\s*\[\/SEARCH_PLAN\]/);
  if (spMatch) {
    try {
      const parsed = JSON.parse(spMatch[1]);
      if (parsed && typeof parsed === 'object') {
        searchPlan = parsed as SearchPlanData;
      }
    } catch { /* partial stream */ }
  }

  // 2. Strip ALL complete system tag blocks from displayed text
  for (const tag of SYSTEM_TAGS) {
    stripped = stripped.replace(new RegExp(`\\[${tag}\\][\\s\\S]*?\\[\\/${tag}\\]`, 'g'), '');
  }

  // 3. Hide any in-flight (partial) opening tag
  for (const tag of SYSTEM_TAGS) {
    const openIdx = stripped.indexOf(`[${tag}]`);
    if (openIdx !== -1) {
      stripped = stripped.slice(0, openIdx);
      break;
    }
  }

  return {
    stripped: stripped.replace(/\n{3,}/g, '\n\n').trim(),
    options,
    profiles,
    scoringTest,
    searchPlan,
  };
}

/** Markdown renderer tuned for chat readability (Claude/ChatGPT-like) */
const MarkdownText = ({ text }: { text: string }) => {
  const navigate = useNavigate();
  const { closeAgent } = useAgent();
  const { stripped, options, profiles, scoringTest, searchPlan } = React.useMemo(
    () => parseAssistantText(text),
    [text],
  );

  return (
    <div className="space-y-2">
      {stripped && (
        <div
          className={cn(
            'text-[14px] leading-[1.7] text-foreground',
            '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
            '[&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_ul]:pl-5 [&_ol]:pl-5 [&_ul]:list-disc [&_ol]:list-decimal',
            '[&_li]:my-1 [&_li]:marker:text-muted-foreground',
            '[&_strong]:font-semibold [&_strong]:text-foreground',
            '[&_a]:text-primary [&_a]:underline [&_a]:underline-offset-2 [&_a]:cursor-pointer hover:[&_a]:text-primary/80',
            '[&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:text-[12.5px] [&_code]:font-mono',
            '[&_pre]:bg-muted [&_pre]:p-3 [&_pre]:rounded-xl [&_pre]:overflow-x-auto [&_pre]:my-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
            '[&_h1]:text-base [&_h1]:font-bold [&_h1]:mt-4 [&_h1]:mb-1.5',
            '[&_h2]:text-[15px] [&_h2]:font-bold [&_h2]:mt-4 [&_h2]:mb-1.5',
            '[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1',
            '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_blockquote]:my-2',
            '[&_hr]:my-3 [&_hr]:border-border/60',
          )}
        >
          <ReactMarkdown
            components={{
              a: ({ href, children, ...props }) => {
                const raw = String(href ?? '');
                // Détermine si c'est un lien INTERNE app → navigation SPA. On gère :
                //  - chemin relatif (/ats/scorecard/…)
                //  - URL absolue same-origin
                //  - URL absolue avec un domaine ≠ (ex. l'IA préfixe app.konekt.fr,
                //    qui peut ne pas résoudre) MAIS dont le path est une route app
                // → on navigue sur le PATH, jamais en pleine page vers un domaine mort.
                const APP_ROUTE = /^\/(ats|pipeline|missions|qualification|dashboard|inbox|calendar|tasks|settings|prospection|candidates|marketplace|agents)(\/|$|\?)/;
                let internalPath: string | null = null;
                if (raw.startsWith('/')) {
                  internalPath = raw;
                } else {
                  try {
                    const u = new URL(raw, window.location.origin);
                    if (u.origin === window.location.origin || APP_ROUTE.test(u.pathname)) {
                      internalPath = u.pathname + u.search + u.hash;
                    }
                  } catch {
                    /* pas une URL → traité comme externe ci-dessous */
                  }
                }
                if (internalPath) {
                  const path = internalPath;
                  return (
                    <a
                      href={path}
                      onClick={(e) => {
                        e.preventDefault();
                        closeAgent();
                        navigate(path);
                      }}
                      {...props}
                    >
                      {children}
                    </a>
                  );
                }
                return (
                  <a href={raw} target="_blank" rel="noopener noreferrer" {...props}>
                    {children}
                  </a>
                );
              },
            }}
          >
            {stripped}
          </ReactMarkdown>
        </div>
      )}

      {searchPlan && <SearchPlanCard plan={searchPlan} />}
      {scoringTest && <ScoringTestCard data={scoringTest} />}
      {profiles.length > 0 && <SampleProfilesCards profiles={profiles} />}

      {options.length > 0 && <OptionsChips options={options} />}
    </div>
  );
};

/** Normalise un champ "list" qui peut être array, string CSV ou null. */
function pickList(v: unknown): string[] {
  if (Array.isArray(v)) {
    return v
      .map((x) => (typeof x === 'string' ? x.trim() : String(x ?? '').trim()))
      .filter(Boolean);
  }
  if (typeof v === 'string') return v.split(',').map((x) => x.trim()).filter(Boolean);
  return [];
}

/** Card pour le bloc [SEARCH_PLAN] — résumé du plan de recherche produit par l'IA. */
const SearchPlanCard = ({ plan }: { plan: SearchPlanData }) => {
  const filters = (plan.filters ?? {}) as Record<string, unknown>;
  const stop = (plan.stop_conditions ?? {}) as Record<string, unknown>;
  const summary = typeof plan.summary === 'string' ? plan.summary : '';
  const items: Array<{ label: string; value: string }> = [];
  if (summary) items.push({ label: 'Résumé', value: summary });
  const keywords = pickList(filters.keywords);
  const locations = pickList(filters.location_keywords);
  const titles = pickList(filters.title_keywords);
  const companies = pickList(filters.company_keywords);
  const skills = pickList(filters.skills);
  if (keywords.length) items.push({ label: 'Mots-clés', value: keywords.join(', ') });
  if (locations.length) items.push({ label: 'Localisation', value: locations.join(', ') });
  if (titles.length) items.push({ label: 'Titres', value: titles.join(', ') });
  if (companies.length) items.push({ label: 'Entreprises', value: companies.join(', ') });
  if (skills.length) items.push({ label: 'Compétences', value: skills.join(', ') });
  if (filters.calculated_experience_min != null || filters.calculated_experience_max != null) {
    items.push({
      label: 'Expérience',
      value: `${filters.calculated_experience_min ?? '?'}–${filters.calculated_experience_max ?? '?'} ans`,
    });
  }
  const targetGo = stop.target_go_profiles;

  return (
    <div className="border border-border/60 rounded-xl overflow-hidden bg-card my-2">
      <div className="px-3.5 py-2.5 bg-muted/30 flex items-center gap-2 border-b border-border/40">
        <div className="h-6 w-6 rounded-lg bg-primary/10 flex items-center justify-center">
          <Search className="h-3.5 w-3.5 text-primary" />
        </div>
        <span className="text-xs font-bold text-foreground">Plan de recherche</span>
        {typeof targetGo === 'number' && (
          <span className="ml-auto px-2 py-0.5 text-[10px] font-semibold rounded-md bg-muted text-muted-foreground">
            cible : {targetGo} profils
          </span>
        )}
      </div>
      <div className="px-3.5 py-3 space-y-2.5">
        {items.map((item, i) => (
          <div key={i} className="flex items-start gap-3">
            <span className="h-1.5 w-1.5 rounded-full bg-foreground/20 shrink-0 mt-[7px]" />
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase text-muted-foreground tracking-wide">{item.label}</p>
              <p className="text-[13px] text-foreground/80 mt-0.5 leading-relaxed break-words">{item.value}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

/** Card pour le bloc [SCORING_TEST] — preview du scoring sur quelques profils. */
const ScoringTestCard = ({ data }: { data: ScoringTestData }) => {
  const verdictCfg: Record<string, { icon: typeof CheckCircle2; cls: string }> = {
    pass: { icon: CheckCircle2, cls: 'text-success bg-success/10 border-success/20' },
    partial: { icon: AlertTriangle, cls: 'text-warning bg-warning/10 border-warning/20' },
    fail: { icon: XCircle, cls: 'text-destructive bg-destructive/10 border-destructive/20' },
  };
  const recCfg: Record<string, { label: string; cls: string }> = {
    go: { label: 'À contacter', cls: 'bg-success/15 text-success border-success/20' },
    maybe: { label: 'À évaluer', cls: 'bg-warning/15 text-warning border-warning/20' },
    skip: { label: 'Peu adapté', cls: 'bg-muted text-muted-foreground border-border' },
  };

  return (
    <div className="border border-border/60 rounded-xl overflow-hidden bg-card my-2">
      <div className="px-3.5 py-2.5 bg-muted/30 border-b border-border/40">
        <div className="flex items-center gap-2 mb-1">
          <div className="h-6 w-6 rounded-lg bg-primary/10 flex items-center justify-center">
            <BarChart3 className="h-3.5 w-3.5 text-primary" />
          </div>
          <span className="text-xs font-bold text-foreground">Test de scoring</span>
        </div>
        {data.purpose && (
          <p className="text-[11px] text-muted-foreground leading-relaxed pl-[34px]">{data.purpose}</p>
        )}
      </div>
      <div className="divide-y divide-border/30">
        {data.profiles.map((profile, i) => {
          const rec = recCfg[profile.recommendation] ?? recCfg.maybe;
          const scoreColor =
            profile.score >= 75 ? 'text-success' : profile.score >= 50 ? 'text-warning' : 'text-destructive';
          return (
            <div key={i} className="px-3.5 py-3 space-y-2">
              <div className="flex items-center gap-3">
                <div className="flex items-center justify-center w-9 h-9 rounded-xl bg-muted border border-border/40">
                  <span className={cn('text-base font-black tabular-nums', scoreColor)}>{profile.score}</span>
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-semibold text-foreground truncate">{profile.name}</p>
                  <p className="text-[11px] text-muted-foreground truncate">{profile.title} @ {profile.company}</p>
                </div>
                <span className={cn('text-[10px] font-bold px-2 py-0.5 rounded-md border shrink-0', rec.cls)}>
                  {rec.label}
                </span>
              </div>
              <div className="space-y-1 pl-12">
                {profile.criteria.map((c, j) => {
                  const v = verdictCfg[c.verdict] ?? verdictCfg.partial;
                  const VI = v.icon;
                  return (
                    <div
                      key={j}
                      className={cn('flex items-start gap-2 px-2 py-1 rounded-lg border text-[11px]', v.cls)}
                    >
                      <VI className="h-3 w-3 shrink-0 mt-0.5" />
                      <div className="min-w-0 leading-snug">
                        <span className="font-semibold">{c.label}</span>
                        <span className="text-foreground/60 ml-1.5">— {c.detail}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

/** Cards pour les blocs [PROFILE] — profils échantillons proposés en calibration.
 *  Version lean read-only : l'utilisateur valide ou rejette en envoyant un message
 *  texte (typé ou via OptionsChips dans le même message). Pas de feedback wiring
 *  complexe ici — le pattern original avec onSendFeedback est dans l'ancien
 *  AgentMessageBubble, on garde simple pour l'instant. */
const SampleProfilesCards = ({ profiles }: { profiles: SampleProfileData[] }) => {
  return (
    <div className="space-y-2 my-2">
      {profiles.map((profile, i) => {
        const initials = profile.name
          .split(/\s+/)
          .map((w) => w[0]?.toUpperCase())
          .join('')
          .slice(0, 2);
        const scoreColor =
          profile.score == null
            ? 'text-foreground'
            : profile.score >= 75
            ? 'text-success'
            : profile.score >= 50
            ? 'text-warning'
            : 'text-destructive';
        return (
          <div key={i} className="border border-border/60 rounded-xl overflow-hidden bg-card">
            <div className="px-3.5 py-3 flex items-start gap-3">
              <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center text-xs font-bold text-primary shrink-0">
                {initials}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <p className="text-sm font-semibold text-foreground truncate">{profile.name}</p>
                  {typeof profile.score === 'number' && (
                    <span className={cn('text-[11px] font-bold tabular-nums', scoreColor)}>{profile.score}</span>
                  )}
                </div>
                {profile.title && (
                  <p className="text-xs text-muted-foreground truncate mt-0.5 flex items-center gap-1">
                    <Briefcase className="h-3 w-3 shrink-0" />
                    {profile.title}
                    {profile.company && <span>@ {profile.company}</span>}
                  </p>
                )}
                <div className="flex items-center gap-2 mt-0.5 text-[11px] text-muted-foreground">
                  {profile.location && (
                    <span className="flex items-center gap-0.5">
                      <MapPin className="h-3 w-3" /> {profile.location}
                    </span>
                  )}
                  {profile.yearsExp > 0 && <span>· {profile.yearsExp} ans XP</span>}
                </div>
              </div>
            </div>
            {profile.tags.length > 0 && (
              <div className="px-3.5 pb-2 flex flex-wrap gap-1">
                {profile.tags.slice(0, 8).map((tag, j) => (
                  <span
                    key={j}
                    className="text-[10px] font-medium px-1.5 py-0.5 bg-primary/10 text-primary rounded-md"
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
            {profile.trajectory.length > 0 && (
              <div className="px-3.5 pb-2">
                <p className="text-[10px] font-semibold text-muted-foreground mb-1">Parcours</p>
                <div className="flex items-center gap-1.5 text-[11px] text-foreground/70 overflow-x-auto no-scrollbar">
                  {profile.trajectory.slice(0, 5).map((t, j) => (
                    <React.Fragment key={j}>
                      {j > 0 && <span className="text-muted-foreground/30">→</span>}
                      <span className="whitespace-nowrap">{t}</span>
                    </React.Fragment>
                  ))}
                </div>
              </div>
            )}
            {(profile.strengths.length > 0 || profile.concerns.length > 0) && (
              <div className="px-3.5 pb-3 space-y-1">
                {profile.strengths.map((s, j) => (
                  <div key={`s-${j}`} className="flex items-start gap-1.5 text-[11px]">
                    <CheckCircle2 className="h-3 w-3 text-success shrink-0 mt-0.5" />
                    <span className="text-foreground/70">{s}</span>
                  </div>
                ))}
                {profile.concerns.map((c, j) => (
                  <div key={`c-${j}`} className="flex items-start gap-1.5 text-[11px]">
                    <AlertTriangle className="h-3 w-3 text-warning shrink-0 mt-0.5" />
                    <span className="text-foreground/70">{c}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
};

/**
 * Chips cliquables pour les options proposées par l'IA. Chaque chip utilise
 * ThreadPrimitive.Suggestion avec `send`, donc le clic envoie automatiquement
 * la string en tant que prochain message utilisateur (même pattern que les
 * suggestions d'accueil sur thread vide).
 */
const OptionsChips = ({ options }: { options: string[] }) => {
  // Une option courte (≤ 28 chars) tient sur une pill ; sinon on stack en
  // lignes pleine largeur (lisibilité > densité).
  const longest = Math.max(...options.map((o) => o.length));
  const stacked = longest > 28 || options.length > 4;

  return (
    <div
      className={cn(
        'flex',
        stacked ? 'flex-col gap-1.5' : 'flex-wrap gap-1.5',
        'mt-1',
      )}
    >
      {options.map((opt, i) => (
        <ThreadPrimitive.Suggestion
          key={`${i}-${opt.slice(0, 24)}`}
          prompt={opt}
          send
          className={cn(
            'group flex items-center gap-2 rounded-2xl border border-border/70 bg-card/60 px-3 py-2 text-left',
            'text-[13px] text-foreground/80 transition-all',
            'hover:border-primary/40 hover:bg-accent hover:text-foreground',
            'active:scale-[0.98]',
            stacked ? 'w-full' : 'rounded-full text-xs px-3 py-1.5',
          )}
        >
          <span className="flex-1 leading-snug">{opt}</span>
          {stacked && (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground/40 transition-transform group-hover:translate-x-0.5 group-hover:text-primary" />
          )}
        </ThreadPrimitive.Suggestion>
      ))}
    </div>
  );
};

/** Single assistant message — full-width, no bubble (Claude/ChatGPT style) */
const AssistantMessage = () => {
  const isRunning = useMessage((s) => s.status?.type === 'running');
  const hasText = useMessage((s) =>
    s.content?.some((part: any) => part.type === 'text' && part.text?.trim())
  );
  const hasReasoning = useMessage((s) =>
    s.content?.some((part: any) => part.type === 'reasoning' && part.text?.trim())
  );
  const hasToolCalls = useMessage((s) =>
    s.content?.some((part: any) => part.type === 'tool-call')
  );

  // Nothing streamed yet at all → single shimmer line (no double indicator).
  // Les chips de tools comptent comme du contenu : on les montre dès qu'un
  // outil démarre au lieu de rester sur le shimmer.
  if (isRunning && !hasText && !hasReasoning && !hasToolCalls) {
    return <ShimmerThinking />;
  }

  return (
    <div className="flex gap-3 animate-fade-in">
      <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-muted/60 mt-0.5">
        <AnimatedOrb size={20} speed={isRunning ? 6 : 2} />
      </div>
      <div className="flex-1 min-w-0 space-y-2 pt-0.5">
        <MessagePrimitive.Content
          components={{
            Text: ({ text }) => <MarkdownText text={text} />,
            Reasoning: ({ text }) => <ReasoningBlock text={text} />,
            // Chips de progression des tools de la boucle backend — les tool
            // UIs enregistrées par nom (tool-uis.tsx) gardent la priorité.
            tools: { Fallback: ToolFallbackChip as any },
          }}
        />
        {isRunning && hasText && (
          <span className="inline-block w-1.5 h-4 bg-foreground/40 animate-pulse rounded-sm align-middle" />
        )}
      </div>
    </div>
  );
};

/** User message — soft right-aligned bubble (ChatGPT/Claude style) */
const UserMessage = () => (
  <div className="flex justify-end animate-fade-in">
    <div className="max-w-[80%] rounded-3xl rounded-br-md bg-muted px-4 py-2.5 text-[14px] leading-relaxed text-foreground">
      <MessagePrimitive.Content components={{ Text: ({ text }) => <span className="whitespace-pre-wrap">{text}</span> }} />
    </div>
  </div>
);

export const SkalrThread: React.FC<SkalrThreadProps> = ({ contextMode, modelSlot, filesBridge }) => {
  const w = WELCOME[(contextMode as string) || 'free'] ?? WELCOME.free;
  const [files, setFiles] = useState<File[]>([]);

  const addFiles = (added: File[]) =>
    setFiles((prev) => [...prev, ...added].slice(0, 5));
  const removeFile = (idx: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== idx));

  // Publie l'état courant vers le pont — lu par l'adaptateur à l'envoi.
  if (filesBridge) {
    filesBridge.current.files = files;
    filesBridge.current.clear = () => setFiles([]);
  }

  return (
    <ThreadPrimitive.Root className="flex flex-col h-full bg-background">
      {/* Messages area */}
      <ThreadPrimitive.Viewport className="flex-1 overflow-y-auto px-4 py-5">
        <div className="mx-auto w-full max-w-2xl space-y-5">
          {/* Notion-style welcome — only on an empty thread */}
          <ThreadPrimitive.Empty>
            <div className="flex flex-col items-center text-center pt-10 pb-7">
              <AnimatedOrb size={48} />
              <h3 className="mt-4 text-xl font-display font-bold tracking-tight text-foreground">
                {w.title}
              </h3>
              <p className="mt-1.5 text-[13px] text-muted-foreground max-w-[20rem] leading-relaxed">
                {w.subtitle}
              </p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-md mx-auto">
              {w.suggestions.map((s) => (
                <ThreadPrimitive.Suggestion
                  key={s.prompt}
                  prompt={s.prompt}
                  send
                  className="group flex w-full items-center gap-3 rounded-2xl border border-border/70 bg-card/40 px-3.5 py-3 text-left transition-all hover:border-primary/40 hover:bg-accent active:scale-[0.99]"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-xl bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                    <s.icon className="h-4 w-4" />
                  </span>
                  <span className="text-[13px] font-medium text-foreground/80 group-hover:text-foreground">
                    {s.label}
                  </span>
                </ThreadPrimitive.Suggestion>
              ))}
            </div>
          </ThreadPrimitive.Empty>

          <ThreadPrimitive.Messages
            components={{
              UserMessage,
              AssistantMessage,
            }}
          />
        </div>
      </ThreadPrimitive.Viewport>

      {/* Composer — prompt-kit-style pill with Notion/Claude toolbar */}
      <div className="shrink-0 px-3 pb-3 pt-1">
        <div className="mx-auto w-full max-w-2xl">
          {/* Formats alignés sur ingest-user-file (PDF + texte). Word/images : pas encore supportés. */}
          <FileUpload onFilesAdded={addFiles} multiple accept=".pdf,.txt,.md,.csv">
            <ComposerPrimitive.Root className="relative flex flex-col rounded-[1.75rem] border border-border bg-background p-2 shadow-sm transition-all focus-within:border-primary/40 focus-within:ring-4 focus-within:ring-primary/5">
              {/* Attached files */}
              {files.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-2 pt-1.5 pb-1">
                  {files.map((f, i) => (
                    <span
                      key={`${f.name}-${i}`}
                      className="group flex items-center gap-1.5 rounded-lg border border-border bg-muted/50 py-1 pl-2 pr-1 text-[11px] text-foreground/80"
                    >
                      <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="max-w-[140px] truncate">{f.name}</span>
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                        aria-label="Retirer le fichier"
                      >
                        <X className="h-3 w-3" />
                      </button>
                    </span>
                  ))}
                </div>
              )}

              <ComposerPrimitive.Input
                placeholder={
                  contextMode === 'sourcing'
                    ? 'Décris le profil recherché…'
                    : contextMode === 'brief'
                    ? 'Pose une question sur le brief…'
                    : 'Écris un message à Konekt IA…'
                }
                rows={1}
                autoFocus
                className="w-full resize-none bg-transparent px-3 py-2.5 text-[14px] leading-relaxed text-foreground placeholder:text-muted-foreground/50 outline-none max-h-40 min-h-[24px]"
              />

              {/* Toolbar */}
              <div className="flex items-center gap-1 pl-1 pr-0.5 pt-1">
                <FileUploadTrigger asChild>
                  <button
                    type="button"
                    title="Joindre un fichier"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <Paperclip className="h-4 w-4" />
                  </button>
                </FileUploadTrigger>

                {modelSlot}

                <ComposerPrimitive.Send
                  className={cn(
                    'ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-all',
                    'bg-primary text-primary-foreground hover:bg-primary/90 hover:scale-105 active:scale-95',
                    'disabled:opacity-30 disabled:cursor-not-allowed disabled:hover:scale-100'
                  )}
                >
                  <ArrowUp className="h-4 w-4" strokeWidth={2.5} />
                </ComposerPrimitive.Send>
              </div>
            </ComposerPrimitive.Root>

            {/* Drag-and-drop overlay */}
            <FileUploadContent>
              <div className="flex flex-col items-center gap-3 rounded-2xl border-2 border-dashed border-primary/50 bg-background px-10 py-8 shadow-xl">
                <Paperclip className="h-7 w-7 text-primary" />
                <p className="text-sm font-medium text-foreground">Dépose tes fichiers ici</p>
                <p className="text-xs text-muted-foreground">Images, PDF, Word, texte — 5 max</p>
              </div>
            </FileUploadContent>
          </FileUpload>

          <p className="mt-2 text-center text-[10.5px] text-muted-foreground/50">
            Konekt IA peut faire des erreurs — vérifie les infos importantes.
          </p>
        </div>
      </div>
    </ThreadPrimitive.Root>
  );
};

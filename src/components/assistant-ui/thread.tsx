import React, { useState } from 'react';
import {
  AuiIf,
  ThreadPrimitive,
  ComposerPrimitive,
  MessagePrimitive,
  useMessage,
} from '@assistant-ui/react';
import {
  ArrowUp, ChevronRight, Paperclip, X, FileText,
  Search, PenLine, BarChart3, Lightbulb, SlidersHorizontal,
  ClipboardList, MessageSquare, CheckCircle2, XCircle, AlertTriangle,
  MapPin, Briefcase, Loader2, Square,
} from 'lucide-react';
import KonektLogo from '@/components/KonektLogo';
import { Badge } from '@/components/ui/badge';
import { ScoreBadge } from '@/components/ui/score-badge';
import { aiRecommendationMeta } from '@/lib/verdicts';
import { cn } from '@/lib/utils';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { useNavigate } from 'react-router-dom';
import { useAgent } from '@/contexts/AgentContext';
import { ToolFallbackChip } from './tool-uis';
import { FileUpload, FileUploadTrigger, FileUploadContent } from '@/components/prompt-kit/file-upload';

interface SkalrThreadProps {
  contextMode?: string | null;
  /** Notion-style: model selector rendered inside the composer toolbar */
  modelSlot?: React.ReactNode;
  /** Menu + : fichiers joints et connecteurs disponibles pour le chat. */
  toolsSlot?: React.ReactNode;
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
    title: 'Comment puis-je vous aider ?',
    subtitle: 'Sourcing, messages d’approche, analyse de profils, prochaines actions.',
    suggestions: [
      { icon: Search, label: 'Sourcer des candidats', prompt: 'Je cherche des candidats pour un poste. Aide-moi à définir les critères.' },
      { icon: PenLine, label: 'Rédiger un message d’approche', prompt: 'Aide-moi à rédiger un message d’approche personnalisé pour un candidat.' },
      { icon: BarChart3, label: 'Analyser mes priorités', prompt: 'Analyse mes missions ouvertes et dis-moi quoi prioriser aujourd’hui.' },
      { icon: Lightbulb, label: 'Ce que l’assistant sait faire', prompt: 'Que pouvez-vous faire pour m’aider dans mon recrutement ?' },
    ],
  },
  sourcing: {
    title: 'Calibrons votre recherche',
    subtitle: 'Décrivez le poste : je structure les critères, puis je lance la recherche.',
    suggestions: [
      { icon: Search, label: 'Lancer le sourcing sur ce poste', prompt: 'Lançons le sourcing pour cette mission. Posez-moi les questions nécessaires pour calibrer.' },
      { icon: SlidersHorizontal, label: 'Affiner les critères', prompt: 'Aide-moi à affiner les critères de recherche pour ce poste.' },
    ],
  },
  brief: {
    title: 'Construisons le brief',
    subtitle: 'Je vous aide à cadrer le besoin, poste par poste.',
    suggestions: [
      { icon: ClipboardList, label: 'Compléter le brief', prompt: 'Aide-moi à compléter le brief de ce poste, champ par champ.' },
      { icon: MessageSquare, label: 'Questions à poser au client', prompt: 'Quelles questions dois-je poser au client pour bien cadrer ce recrutement ?' },
    ],
  },
  process: {
    title: 'Définissons le process',
    subtitle: 'Étapes d’évaluation, critères, points rédhibitoires.',
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
 * Raisonnement du modèle, replié par défaut une fois la réponse commencée.
 * Texte fixe (« Réflexion en cours… »), sans étincelle ni miroitement ; le
 * contenu replié n'est pas monté (revue design E-36).
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
    <div className="text-sm">
      <button
        type="button"
        onClick={() => setUserToggled(!open)}
        aria-expanded={open}
        className="group flex items-center gap-1.5 rounded-sm py-0.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ChevronRight
          className={cn('h-3.5 w-3.5 text-muted-foreground transition-transform duration-150', open && 'rotate-90')}
          aria-hidden="true"
        />
        <span className="text-xs font-medium text-muted-foreground group-hover:text-foreground">
          {streaming ? 'Réflexion en cours…' : 'Réflexion'}
        </span>
      </button>
      {open && (
        <div className="ml-1.5 mt-1 whitespace-pre-wrap border-l border-border pl-3 text-xs leading-relaxed text-muted-foreground">
          {text}
        </div>
      )}
    </div>
  );
};

/** Avatar de l'assistant : le monogramme Konekt, fixe (plus d'œil animé, E-14). */
const AssistantAvatar = ({ size = 'sm' }: { size?: 'sm' | 'lg' }) => (
  <span
    className={cn(
      'flex shrink-0 items-center justify-center rounded-full bg-muted',
      size === 'lg' ? 'h-10 w-10' : 'h-7 w-7',
    )}
    aria-hidden="true"
  >
    <KonektLogo variant="mark" theme="auto" size={size === 'lg' ? 20 : 14} ariaLabel="" />
  </span>
);

/** Avant le premier contenu : une ligne d'état en texte, avec l'indicateur de chargement. */
const ThinkingLine = () => (
  <div className="flex items-center gap-3 px-1" role="status">
    <AssistantAvatar />
    <span className="flex items-center gap-2 text-sm text-muted-foreground">
      <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden="true" />
      L’assistant prépare sa réponse…
    </span>
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
            'text-md leading-relaxed text-foreground',
            '[&>*:first-child]:mt-0 [&>*:last-child]:mb-0',
            '[&_p]:my-2 [&_ul]:my-2 [&_ol]:my-2 [&_ul]:pl-5 [&_ol]:pl-5 [&_ul]:list-disc [&_ol]:list-decimal',
            '[&_li]:my-1 [&_li]:break-words [&_li]:marker:text-muted-foreground [&_li>p]:my-0.5',
            '[&_strong]:font-semibold [&_strong]:text-foreground',
            '[&_a]:text-brand [&_a]:underline [&_a]:underline-offset-2 [&_a]:cursor-pointer hover:[&_a]:text-foreground',
            '[&_code]:bg-muted [&_code]:px-1.5 [&_code]:py-0.5 [&_code]:rounded-md [&_code]:text-xs [&_code]:font-mono',
            '[&_pre]:bg-muted [&_pre]:p-3 [&_pre]:rounded-xl [&_pre]:overflow-x-auto [&_pre]:my-2 [&_pre_code]:bg-transparent [&_pre_code]:p-0',
            '[&_h1]:text-base [&_h1]:font-semibold [&_h1]:mt-4 [&_h1]:mb-1.5',
            '[&_h2]:text-md [&_h2]:font-semibold [&_h2]:mt-4 [&_h2]:mb-1.5',
            '[&_h3]:text-sm [&_h3]:font-semibold [&_h3]:mt-3 [&_h3]:mb-1',
            '[&_blockquote]:border-l-2 [&_blockquote]:border-border [&_blockquote]:pl-3 [&_blockquote]:text-muted-foreground [&_blockquote]:my-2',
            '[&_hr]:my-3 [&_hr]:border-border/60',
          )}
        >
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              table: ({ children }) => (
                <div
                  className="my-3 w-full max-w-full overflow-x-auto rounded-xl border border-border bg-card focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  role="region"
                  aria-label="Tableau de résultats, à faire défiler horizontalement si nécessaire"
                  tabIndex={0}
                >
                  <table className="w-full min-w-[520px] border-collapse text-left text-xs leading-relaxed">
                    {children}
                  </table>
                </div>
              ),
              thead: ({ children }) => <thead className="bg-muted text-foreground">{children}</thead>,
              tbody: ({ children }) => <tbody className="divide-y divide-border">{children}</tbody>,
              tr: ({ children }) => <tr className="transition-colors hover:bg-accent/40">{children}</tr>,
              th: ({ children }) => (
                <th className="whitespace-nowrap px-3 py-2 font-semibold text-foreground">{children}</th>
              ),
              td: ({ children }) => (
                <td className="min-w-[5rem] px-3 py-2 align-top text-foreground-secondary">{children}</td>
              ),
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
    <div className="my-2 overflow-hidden rounded-xl border border-border bg-card">
      <div className="flex items-center gap-2 border-b border-border px-3.5 py-2.5">
        <Search className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
        <span className="text-sm font-semibold text-foreground">Plan de recherche</span>
        {typeof targetGo === 'number' && (
          <Badge variant="muted" className="ml-auto">
            Objectif : {targetGo} profils
          </Badge>
        )}
      </div>
      <dl className="space-y-2.5 px-3.5 py-3">
        {items.map((item, i) => (
          <div key={i} className="min-w-0">
            <dt className="eyebrow">{item.label}</dt>
            <dd className="mt-0.5 break-words text-sm leading-relaxed text-foreground">{item.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
};

/** Card pour le bloc [SCORING_TEST] — preview du scoring sur quelques profils. */
const ScoringTestCard = ({ data }: { data: ScoringTestData }) => {
  // Critère rempli, partiel ou manquant : icône et mot, la couleur n'est qu'un appoint.
  const verdictCfg: Record<string, { icon: typeof CheckCircle2; cls: string; label: string }> = {
    pass: { icon: CheckCircle2, cls: 'text-success', label: 'Rempli' },
    partial: { icon: AlertTriangle, cls: 'text-warning', label: 'En partie' },
    fail: { icon: XCircle, cls: 'text-danger', label: 'Manquant' },
  };

  return (
    <div className="my-2 overflow-hidden rounded-xl border border-border bg-card">
      <div className="border-b border-border px-3.5 py-2.5">
        <div className="flex items-center gap-2">
          <BarChart3 className="h-4 w-4 text-muted-foreground" aria-hidden="true" />
          <span className="text-sm font-semibold text-foreground">Test du scoring</span>
        </div>
        {data.purpose && <p className="mt-1 text-xs leading-relaxed text-muted-foreground">{data.purpose}</p>}
      </div>
      <ul className="divide-y divide-border">
        {data.profiles.map((profile, i) => {
          const rec = aiRecommendationMeta(profile.recommendation === 'go' ? 'shortlist' : profile.recommendation);
          return (
            <li key={i} className="space-y-2 px-3.5 py-3">
              <div className="flex items-center gap-3">
                <ScoreBadge score={profile.score} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold text-foreground">{profile.name}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {[profile.title, profile.company].filter(Boolean).join(' · ')}
                  </p>
                </div>
                {rec && (
                  <Badge variant={rec.tone} className="shrink-0">
                    {rec.label}
                  </Badge>
                )}
              </div>
              <ul className="space-y-1">
                {profile.criteria.map((c, j) => {
                  const v = verdictCfg[c.verdict] ?? verdictCfg.partial;
                  const VI = v.icon;
                  return (
                    <li key={j} className="flex items-start gap-2 text-xs">
                      <VI className={cn('mt-0.5 h-3.5 w-3.5 shrink-0', v.cls)} aria-hidden="true" />
                      <span className="min-w-0 leading-snug">
                        <span className="sr-only">{v.label} : </span>
                        <span className="font-medium text-foreground">{c.label}</span>
                        {c.detail && <span className="text-muted-foreground"> : {c.detail}</span>}
                      </span>
                    </li>
                  );
                })}
              </ul>
            </li>
          );
        })}
      </ul>
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
        return (
          <div key={i} className="overflow-hidden rounded-xl border border-border bg-card">
            <div className="flex items-start gap-3 px-3.5 py-3">
              <span
                className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-semibold text-foreground"
                aria-hidden="true"
              >
                {initials}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="truncate text-sm font-semibold text-foreground">{profile.name}</p>
                  <ScoreBadge score={profile.score} />
                </div>
                {profile.title && (
                  <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-muted-foreground">
                    <Briefcase className="h-3 w-3 shrink-0" aria-hidden="true" />
                    {[profile.title, profile.company].filter(Boolean).join(' · ')}
                  </p>
                )}
                {(profile.location || profile.yearsExp > 0) && (
                  <p className="mt-0.5 flex items-center gap-2 text-xs text-muted-foreground">
                    {profile.location && (
                      <span className="flex items-center gap-1">
                        <MapPin className="h-3 w-3" aria-hidden="true" /> {profile.location}
                      </span>
                    )}
                    {profile.yearsExp > 0 && <span>{profile.yearsExp} ans d’expérience</span>}
                  </p>
                )}
              </div>
            </div>
            {profile.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 px-3.5 pb-2">
                {profile.tags.slice(0, 8).map((tag, j) => (
                  <Badge key={j} variant="muted">
                    {tag}
                  </Badge>
                ))}
              </div>
            )}
            {profile.trajectory.length > 0 && (
              <div className="px-3.5 pb-2">
                <p className="eyebrow mb-1">Parcours</p>
                <p className="text-xs leading-relaxed text-foreground-secondary">
                  {profile.trajectory.slice(0, 5).join(' → ')}
                </p>
              </div>
            )}
            {(profile.strengths.length > 0 || profile.concerns.length > 0) && (
              <ul className="space-y-1 px-3.5 pb-3">
                {profile.strengths.map((s, j) => (
                  <li key={`s-${j}`} className="flex items-start gap-1.5 text-xs">
                    <CheckCircle2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-success" aria-hidden="true" />
                    <span className="text-foreground-secondary">
                      <span className="sr-only">Point fort : </span>
                      {s}
                    </span>
                  </li>
                ))}
                {profile.concerns.map((c, j) => (
                  <li key={`c-${j}`} className="flex items-start gap-1.5 text-xs">
                    <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-warning" aria-hidden="true" />
                    <span className="text-foreground-secondary">
                      <span className="sr-only">Point de vigilance : </span>
                      {c}
                    </span>
                  </li>
                ))}
              </ul>
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
            'group flex items-center gap-2 border border-border bg-card text-left text-sm text-foreground transition-colors',
            'hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
            stacked ? 'w-full rounded-lg px-3 py-2' : 'rounded-full px-3 py-1.5 text-xs',
          )}
        >
          <span className="flex-1 leading-snug">{opt}</span>
          {stacked && (
            <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground group-hover:text-foreground" aria-hidden="true" />
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

  // Rien encore reçu : une seule ligne d’état (pas de double indicateur).
  // Les chips de tools comptent comme du contenu : on les montre dès qu'un
  // outil démarre au lieu de rester sur la ligne d’état.
  if (isRunning && !hasText && !hasReasoning && !hasToolCalls) {
    return <ThinkingLine />;
  }

  return (
    <div className="flex gap-3 animate-fade-in">
      <div className="mt-0.5">
        <AssistantAvatar />
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
          <span className="inline-block h-4 w-1.5 animate-pulse rounded-sm bg-muted-foreground align-middle" aria-hidden="true" />
        )}
      </div>
    </div>
  );
};

/** User message — soft right-aligned bubble (ChatGPT/Claude style) */
const UserMessage = () => (
  <div className="flex justify-end animate-fade-in">
    <div className="max-w-[80%] rounded-xl rounded-br-sm bg-muted px-4 py-2.5 text-md leading-relaxed text-foreground">
      <MessagePrimitive.Content components={{ Text: ({ text }) => <span className="whitespace-pre-wrap">{text}</span> }} />
    </div>
  </div>
);

export const SkalrThread: React.FC<SkalrThreadProps> = ({ contextMode, modelSlot, toolsSlot, filesBridge }) => {
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
              <AssistantAvatar size="lg" />
              <h3 className="mt-4 text-lg font-semibold text-foreground">{w.title}</h3>
              <p className="mt-1.5 max-w-[20rem] text-sm leading-relaxed text-muted-foreground">{w.subtitle}</p>
            </div>
            <div className="flex flex-col gap-2 w-full max-w-md mx-auto">
              {w.suggestions.map((s) => (
                <ThreadPrimitive.Suggestion
                  key={s.prompt}
                  prompt={s.prompt}
                  send
                  className="group flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3.5 py-3 text-left transition-colors hover:bg-accent/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground-secondary" aria-hidden="true">
                    <s.icon className="h-4 w-4" />
                  </span>
                  <span className="text-sm font-medium text-foreground">{s.label}</span>
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
      {/* Marge basse = max(0.75rem, safe-area) : évite que la barre de saisie
          soit rognée par la barre de navigation système sur mobile. */}
      <div className="shrink-0 px-3 pb-3 pt-1" style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}>
        <div className="mx-auto w-full max-w-2xl">
          {/* Formats alignés sur ingest-user-file (PDF, Word .docx, images, texte). */}
          <FileUpload onFilesAdded={addFiles} multiple accept=".pdf,.docx,.txt,.md,.csv,image/png,image/jpeg,image/webp,image/gif">
            <ComposerPrimitive.Root className="relative flex flex-col rounded-xl border border-input bg-background p-2 transition-colors focus-within:border-brand">
              {/* Attached files */}
              {files.length > 0 && (
                <div className="flex flex-wrap gap-1.5 px-2 pt-1.5 pb-1">
                  {files.map((f, i) => (
                    <span
                      key={`${f.name}-${i}`}
                      className="group flex items-center gap-1.5 rounded-lg border border-border bg-muted py-1 pl-2 pr-1 text-2xs text-foreground-secondary"
                    >
                      <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                      <span className="max-w-[140px] truncate">{f.name}</span>
                      <button
                        type="button"
                        onClick={() => removeFile(i)}
                        className="rounded p-0.5 text-muted-foreground hover:bg-background hover:text-foreground"
                        aria-label={`Retirer le fichier ${f.name}`}
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
                    ? 'Décrivez le profil recherché…'
                    : contextMode === 'brief'
                    ? 'Posez une question sur le brief…'
                    : 'Écrivez à l’assistant…'
                }
                aria-label="Message à l’assistant"
                rows={1}
                autoFocus
                className="w-full resize-none bg-transparent px-3 py-2.5 text-md leading-relaxed text-foreground placeholder:text-muted-foreground outline-none max-h-40 min-h-[24px]"
              />

              {/* Toolbar */}
              <div className="flex items-center gap-1 pl-1 pr-0.5 pt-1">
                {toolsSlot ?? (
                  <FileUploadTrigger asChild>
                    <button
                      type="button"
                      title="Joindre un fichier"
                      aria-label="Joindre un fichier"
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      <Paperclip className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </FileUploadTrigger>
                )}

                {modelSlot}

                {/* Pendant la réponse, « Arrêter » remplace l'envoi (E-36). */}
                <AuiIf condition={(st) => !st.thread.isRunning}>
                  <ComposerPrimitive.Send
                    aria-label="Envoyer"
                    title="Envoyer"
                    className={cn(
                      'ml-auto flex h-8 w-8 shrink-0 items-center justify-center rounded-full transition-colors',
                      'bg-foreground text-background hover:bg-foreground/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2',
                      'disabled:cursor-not-allowed disabled:opacity-40'
                    )}
                  >
                    <ArrowUp className="h-4 w-4" strokeWidth={2.5} aria-hidden="true" />
                  </ComposerPrimitive.Send>
                </AuiIf>
                <AuiIf condition={(st) => st.thread.isRunning}>
                  <ComposerPrimitive.Cancel className="ml-auto flex h-8 shrink-0 items-center gap-1.5 rounded-full border border-border px-3 text-xs font-medium text-foreground transition-colors hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    <Square className="h-3 w-3 fill-current" aria-hidden="true" />
                    Arrêter
                  </ComposerPrimitive.Cancel>
                </AuiIf>
              </div>
            </ComposerPrimitive.Root>

            {/* Drag-and-drop overlay */}
            <FileUploadContent>
              <div className="flex flex-col items-center gap-3 rounded-xl border-2 border-dashed border-brand bg-background px-10 py-8 shadow-xl">
                <Paperclip className="h-7 w-7 text-brand" aria-hidden="true" />
                <p className="text-sm font-medium text-foreground">Déposez vos fichiers ici</p>
                <p className="text-xs text-muted-foreground">Images, PDF, Word ou texte, 5 au plus</p>
              </div>
            </FileUploadContent>
          </FileUpload>

          <p className="mt-2 text-center text-3xs text-muted-foreground">
            L’assistant peut se tromper : vérifiez les informations importantes.
          </p>
        </div>
      </div>
    </ThreadPrimitive.Root>
  );
};

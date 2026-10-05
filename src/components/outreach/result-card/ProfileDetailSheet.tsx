import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import linkedinLogo from '@/assets/linkedin-logo.svg';
import { emitQuotaAction } from '@/lib/quotaEvents';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Button } from '@/components/ui/button';
import { PersonAvatar } from '@/components/ui/person-avatar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';

import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { LinkedInProfile } from '../types';
import { JobMatchResult, JobScoreDisplay, SalaryBadge, isDegradedScore } from '../JobScoreDisplay';
import { Job } from '@/types/jobs';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { missionIdOfJob } from '@/hooks/useEnrollmentPreview';
import { CardExpandedContent } from './CardExpandedContent';
import { CardStatusBadges } from './CardStatusBadges';
import { useProfileData } from './useProfileData';
import { useCandidateHistory } from '@/hooks/useCandidateHistory';
import { CandidateHistoryPanel } from '../CandidateHistoryPanel';
import { useAircallHistory } from '@/hooks/useAircallHistory';
import { AircallHistoryPanel } from '../AircallHistoryPanel';
import { OutreachMessageModal } from '../OutreachMessageModal';
import { SequenceEnrollButton } from '../SequenceEnrollButton';
import { AddToProjectButton } from '../projects/AddToProjectButton';
import { EnrichContactButton } from './EnrichContactButton';
import {
  Building2, MapPin, TrendingUp, ExternalLink, Loader2, Mail, Phone,
  Target, PenLine, Archive, X, Link2,
  ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Check,
} from 'lucide-react';
import { invokeUnipile } from '@/lib/invokeUnipile';
import { invokeCoresignal } from '@/lib/invokeCoresignal';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';
import { scoreReasons } from '@/components/missions/v3/panels/candidateAdapters';

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;
const PHONE_REGEX = /^(\+?[\d().\s-]{6,})$/;

// Fusionne un profil complet (retour get_profile) sur un profil de liste,
// sans jamais écraser une donnée existante par du vide. Utilisé par
// l'auto-enrich vivier ET par le scoring profond.
function mergeUnipileFullProfile(base: LinkedInProfile, p: Record<string, any>): LinkedInProfile {
  const enrichedSkills = p.skills?.map((s: any) => typeof s === 'string' ? s : s.name).filter(Boolean);
  const enrichedWorkExp = (p.positions || p.experiences || p.work_experience || []).map((exp: any) => ({
    role: exp.title || exp.role,
    company: exp.company_name || exp.company,
    company_logo: exp.company_logo || exp.logo_url || exp.logo,
    description: exp.description,
    start: exp.start_date || exp.starts_at || exp.start,
    end: exp.end_date || exp.ends_at || exp.end,
  }));
  const enrichedEducation = (p.education || []).map((edu: any) => ({
    school: edu.school_name || edu.school,
    degree: edu.degree_name || edu.degree,
    field_of_study: edu.field_of_study || edu.field,
    start: edu.start_date || edu.starts_at || edu.start,
    end: edu.end_date || edu.ends_at || edu.end,
  }));

  return {
    ...base,
    summary: p.about || p.summary || base.summary,
    skills: enrichedSkills?.length ? enrichedSkills : (base.skills || []),
    work_experience: enrichedWorkExp.length ? enrichedWorkExp : (base.work_experience || []),
    education: enrichedEducation.length ? enrichedEducation : ((base as any).education || []),
    location: p.location?.name || p.location || base.location,
    profile_picture_url: p.profile_picture_url || p.picture_url || base.profile_picture_url,
    connections_count: p.connections_count || base.connections_count,
    network_distance: p.network_distance || base.network_distance,
  } as LinkedInProfile;
}

// Un blob linkedin_profile_data est « complet » s'il contient le résumé
// (À propos) ou au moins une description d'expérience — la signature des
// données issues d'une visite de profil. Nécessaire car le scoring de masse
// persiste AUSSI cette colonne, mais avec les données MINCES de la liste :
// sans ce test, le scoring profond croirait détenir le profil complet et
// re-noterait les mêmes données en les marquant « complètes » à tort.
function looksLikeFullProfileData(d: Record<string, any> | null | undefined): boolean {
  if (!d) return false;
  if (d.about || d.summary) return true;
  const exps = d.positions || d.experiences || d.work_experience || [];
  return Array.isArray(exps) && exps.some((e: any) => e?.description);
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizeValue = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const collectStrings = (input: unknown, depth = 0): string[] => {
  if (depth > 3 || input == null) return [];
  if (typeof input === 'string') return normalizeValue(input) ? [input.trim()] : [];
  if (Array.isArray(input)) return input.flatMap((item) => collectStrings(item, depth + 1));
  if (isRecord(input)) return Object.values(input).flatMap((value) => collectStrings(value, depth + 1));
  return [];
};

const unique = (values: string[]) => Array.from(new Set(values.map((value) => value.trim())));

/** Coordonnée copiable (adresse e-mail ou numéro) de l'en-tête de la fiche. */
const ContactChip: React.FC<{ icon: React.ElementType; value: string; title: string; onCopy: () => void }> = ({ icon: Icon, value, title, onCopy }) => (
  <button
    type="button"
    onClick={onCopy}
    title={title}
    className="inline-flex h-6 max-w-full items-center gap-1 rounded-md border border-border px-2 text-xs text-foreground-secondary transition-colors duration-150 hover:border-border-strong hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
  >
    <Icon className="h-3 w-3 shrink-0 text-muted-foreground" aria-hidden="true" />
    <span className="max-w-[200px] truncate">{value}</span>
  </button>
);


const CompanyLogo: React.FC<{ company: string; logoUrl?: string }> = ({ company, logoUrl }) => {
  const [fallbackIndex, setFallbackIndex] = useState(0);

  const domainSlug = company
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\b(inc|inc\.|ltd|ltd\.|llc|sarl|sas|sa|gmbh|group|corp|corp\.)\b/g, '')
    .replace(/[^a-z0-9]+/g, '')
    .trim();

  const sources = [
    logoUrl,
    domainSlug ? `https://logo.clearbit.com/${domainSlug}.com` : null,
    domainSlug ? `https://www.google.com/s2/favicons?domain=${domainSlug}.com&sz=128` : null,
  ].filter(Boolean) as string[];

  if (!sources[fallbackIndex]) {
    return <Building2 className="w-3.5 h-3.5 sm:w-4 sm:h-4 shrink-0" />;
  }

  return (
    <img
      src={sources[fallbackIndex]}
      alt={company}
      className="w-4 h-4 sm:w-5 sm:h-5 object-contain shrink-0 rounded-sm"
      onError={() => setFallbackIndex((prev) => prev + 1)}
    />
  );
};

/**
 * Tab supplémentaire à injecter dans CardExpandedContent. Permet aux
 * surfaces qui réutilisent ProfileDetailSheet (typiquement le pipeline)
 * d'ajouter leurs onglets spécifiques (Évaluation, Séquences, Activité,
 * Notes, Actions) sans dupliquer toute la modale.
 */
export interface ProfileDetailExtraTab {
  /** Identifiant unique de l'onglet. */
  key: string;
  /** Label affiché dans le tab trigger. */
  label: string;
  /** Label court (mobile). */
  shortLabel?: string;
  /** Icône Lucide à afficher (composant). */
  icon: React.ComponentType<{ className?: string }>;
  /** Contenu rendu quand l'onglet est actif. */
  content: React.ReactNode;
  /** Compteur affiché en badge sur le tab trigger (ex: nb de notes). */
  count?: number;
}

/**
 * Métadonnées pipeline-spécifiques à afficher dans le header (stage
 * selector, tags, etc.). Ne sont rendues que si fournies — la modale
 * sourcing reste identique sans ces props.
 */
export interface ProfileDetailPipelineMeta {
  /** Étape pipeline courante (ex: "Contacté"). */
  stage: string;
  /** Liste des étapes possibles ({ key, label }). */
  stageOptions: Array<{ key: string; label: string }>;
  /** Callback de changement de stage. */
  onStageChange: (newStage: string) => void;
  /** Score IA (0-100) cliquable pour ouvrir l'onglet Évaluation. */
  score?: number | null;
  onScoreClick?: () => void;
  /** Tags du candidat (mutables). */
  tags?: string[];
  onTagsChange?: (tags: string[]) => void;
  /** Action "Générer lien portail" pour partager au client. */
  onCreatePortalLink?: () => void;
  /** Slot pour rendre un éditeur de contacts manuels (email/phone) dans
   *  la zone CONTACT INFO du header. Permet à l'user d'ajouter manuellement
   *  ce que l'enrichissement auto n'a pas trouvé. */
  contactsEditor?: React.ReactNode;
  /** Contacts manuels supplémentaires à afficher en chips (en plus des
   *  contacts venant de profile.contact_info). Typiquement le résultat
   *  d'un fetch sur candidate_contacts. */
  manualEmail?: string | null;
  manualPhone?: string | null;
}

interface ProfileDetailSheetProps {
  profile: LinkedInProfile | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  selectedJob: Job | null;
  jobScore?: JobMatchResult;
  accountId?: string;
  activeProject?: SourcingProject | null;
  candidateStatus?: { status: string; score?: number | null; recommendation?: string | null; updated_at: string } | null;
  airtableMatch?: any;
  onScoreProfile?: () => void;
  /** Scoring profond : appelé quand l'user clique "Analyse complète" avec
   *  le profil complet (après visite du profil). Le hook re-score avec ces
   *  données riches → score marqué 'deep' qui remplace le score de liste. */
  onDeepScore?: (fullProfile: LinkedInProfile) => Promise<void> | void;
  onArchive?: () => void;
  onMessageSent?: () => void;
  onSequenceEnroll?: () => void;
  onProfileTreated?: () => void;
  onNavigatePrev?: () => void;
  onNavigateNext?: () => void;
  currentIndex?: number;
  totalCount?: number;
  /** Tabs supplémentaires (pipeline-spécifiques) ajoutés en premier en
   *  mode pipeline, ou après les tabs standards en mode sourcing. */
  extraTabs?: ProfileDetailExtraTab[];
  /** Métadonnées pipeline (stage, tags, score) à afficher dans le header.
   *  Si absent → modale en mode sourcing pur (comportement legacy). */
  pipelineMeta?: ProfileDetailPipelineMeta;
  /** Si true, masque les tabs standards LinkedIn (Exp/Form/Skills/Msg/Posts).
   *  Utilisé en mode pipeline pour les remplacer par des extraTabs reformulés
   *  (ex: Profil = Exp+Form+Skills combinés). Réduit le bruit visuel de
   *  13 tabs → 8 onglets pertinents. */
  hideStandardTabs?: boolean;
  /** Tab à activer par défaut à l'ouverture (clé d'un extraTab ou tab standard).
   *  Permet d'ouvrir la modale directement sur "evaluation" depuis un
   *  deep-link (ex: CTA "Préparer l'entretien" du calendar). */
  initialTab?: string;
  /** Nouvelle page mission (Sourcing) : les décisions de tri se prennent depuis la
   *  fiche, dans les mots de la page (Retenir, Écarter, Remettre à trier). Une
   *  action absente n'est pas proposée. Sans cette prop, la fiche garde ses
   *  actions d'origine (Retenir vers une mission, Archiver). */
  decisions?: {
    /** Où en est le profil dans la mission (« À trier », « Retenu »…). */
    stageLabel?: string;
    onRetain?: () => Promise<void> | void;
    onDismiss?: () => Promise<void> | void;
    onRestore?: () => Promise<void> | void;
  };
  /** Nouvelle page mission : la fiche s'affiche dans le panneau de droite de la
   *  coquille (PanelHost), comme celle du Pipeline, au lieu d'une fenêtre latérale. */
  asPanel?: { titleId: string; onClose: () => void };
}

export const ProfileDetailSheet: React.FC<ProfileDetailSheetProps> = ({
  profile,
  open,
  onOpenChange,
  selectedJob,
  jobScore,
  accountId,
  activeProject,
  candidateStatus,
  airtableMatch,
  onScoreProfile,
  onDeepScore,
  onArchive,
  onMessageSent,
  onSequenceEnroll,
  onProfileTreated,
  onNavigatePrev,
  onNavigateNext,
  currentIndex,
  totalCount,
  extraTabs,
  pipelineMeta,
  hideStandardTabs,
  initialTab,
  decisions,
  asPanel,
}) => {
  const [showMessageModal, setShowMessageModal] = useState(false);
  // Décision en cours : les boutons attendent la fin de l'écriture, pas de double clic.
  const [deciding, setDeciding] = useState(false);
  const decide = useCallback(async (action: (() => Promise<void> | void) | undefined) => {
    if (!action || deciding) return;
    setDeciding(true);
    try {
      await action();
    } finally {
      setDeciding(false);
    }
  }, [deciding]);

  // Panneau : flèches haut et bas depuis n'importe où dans la page (la fenêtre
  // latérale, elle, les lit sur son propre contenu, plus bas).
  const neighbors = useRef({ prev: onNavigatePrev, next: onNavigateNext });
  neighbors.current = { prev: onNavigatePrev, next: onNavigateNext };
  const panelRootRef = useRef<HTMLDivElement>(null);
  const isPanel = !!asPanel;
  useEffect(() => {
    if (!isPanel) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
      if (event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      const target = event.target as HTMLElement | null;
      if (target?.closest?.('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('[role="dialog"][data-state="open"], [role="alertdialog"][data-state="open"], [role="menu"][data-state="open"], [role="listbox"][data-state="open"]')) return;
      const panel = panelRootRef.current?.closest('[data-testid="mission-panel"]') ?? panelRootRef.current;
      const inPanel = target instanceof Node && !!panel?.contains(target);
      if (!inPanel && target !== document.body) return;
      const go = event.key === 'ArrowUp' ? neighbors.current.prev : neighbors.current.next;
      if (!go) return;
      event.preventDefault();
      go();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isPanel]);

  // Flèches haut et bas : candidat voisin, comme dans la fiche du Pipeline,
  // sauf dans un champ, un menu ou une liste.
  const handleArrowKeys = useCallback((e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
    if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return;
    const target = e.target as HTMLElement | null;
    if (target?.closest?.('input, textarea, select, [contenteditable="true"], [role="menu"], [role="listbox"], [role="combobox"]')) return;
    const go = e.key === 'ArrowUp' ? onNavigatePrev : onNavigateNext;
    if (!go) return;
    e.preventDefault();
    go();
  }, [onNavigatePrev, onNavigateNext]);

  // Swipe gesture for mobile navigation
  const touchStartX = useRef<number | null>(null);
  const touchStartY = useRef<number | null>(null);
  const swipeBlocked = useRef(false);

  // Check if touch started inside a horizontally scrollable element
  const isInsideScrollable = (el: HTMLElement | null): boolean => {
    while (el) {
      if (el.scrollWidth > el.clientWidth + 2) return true;
      if (el.dataset?.noSwipe) return true;
      el = el.parentElement;
    }
    return false;
  };

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    touchStartX.current = e.touches[0].clientX;
    touchStartY.current = e.touches[0].clientY;
    swipeBlocked.current = isInsideScrollable(e.target as HTMLElement);
  }, []);

  const handleTouchEnd = useCallback((e: React.TouchEvent) => {
    if (touchStartX.current == null || touchStartY.current == null || swipeBlocked.current) {
      touchStartX.current = null;
      touchStartY.current = null;
      return;
    }
    const dx = e.changedTouches[0].clientX - touchStartX.current;
    const dy = e.changedTouches[0].clientY - touchStartY.current;
    touchStartX.current = null;
    touchStartY.current = null;
    // Only trigger if horizontal swipe is dominant and > 80px
    if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.5) {
      if (dx > 0 && onNavigatePrev) onNavigatePrev();
      if (dx < 0 && onNavigateNext) onNavigateNext();
    }
  }, [onNavigatePrev, onNavigateNext]);

  // Swipe hint animation — show only once per session on first candidate
  const [showSwipeHint, setShowSwipeHint] = useState(false);
  const hasShownHint = useRef(false);

  useEffect(() => {
    if (open && currentIndex === 0 && !hasShownHint.current && (onNavigateNext || onNavigatePrev)) {
      hasShownHint.current = true;
      const timer = setTimeout(() => setShowSwipeHint(true), 800);
      return () => clearTimeout(timer);
    }
  }, [open, currentIndex, onNavigateNext, onNavigatePrev]);

  useEffect(() => {
    if (showSwipeHint) {
      const timer = setTimeout(() => setShowSwipeHint(false), 3500);
      return () => clearTimeout(timer);
    }
  }, [showSwipeHint]);

  const [isScoring, setIsScoring] = useState(false);

  const handleScore = async () => {
    if (!onScoreProfile) return;
    setIsScoring(true);
    try {
      await onScoreProfile();
    } finally {
      setIsScoring(false);
    }
  };

  // Auto-enrich pool profiles that have no work_experience data
  const [enrichedProfile, setEnrichedProfile] = useState<LinkedInProfile | null>(null);
  const [isEnriching, setIsEnriching] = useState(false);

  useEffect(() => {
    setEnrichedProfile(null);
  }, [profile?.id]);

  useEffect(() => {
    if (!open || !profile || !accountId) {
      setIsEnriching(false);
      return;
    }

    const isDatabaseProfile =
      (profile as any)._source === 'database' ||
      (profile as any).source === 'database';
    const isPoolProfile = Boolean((profile as any)._fromPool);
    // Les profils Base Konekt sont enrichis via Coresignal collect (effet
    // dédié ci-dessous), JAMAIS via Unipile/LinkedIn (« Coresignal pour lire »).
    const needsEnrichment =
      isPoolProfile && !isDatabaseProfile &&
      (!profile.work_experience?.length); // Only enrich if missing work experience — don't enrich just for summary/skills

    if (!needsEnrichment) {
      setIsEnriching(false);
      return;
    }

    const profileUrl = profile.public_profile_url || profile.profile_url;
    if (!profileUrl) {
      setIsEnriching(false);
      return;
    }

    let cancelled = false;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    setIsEnriching(true);

    (async () => {
      try {
        const response = await Promise.race([
          invokeUnipile({
            body: {
              action: 'get_profile',
              account_id: accountId,
              profile_url: profileUrl,
            },
          }),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(() => {
              reject(new Error('Auto-enrich timeout after 15s'));
            }, 15000);
          }),
        ]);

        if (cancelled) return;

        const unipileResponse = response.data;
        if (unipileResponse?.success && unipileResponse.profile) {
          emitQuotaAction('profileVisits', 1, accountId);
          const p = unipileResponse.profile as Record<string, any>;

          // Only replace fields that are ACTUALLY better than what we already have
          // This prevents Apollo data from being overwritten with empty Unipile responses
          setEnrichedProfile(mergeUnipileFullProfile(profile, p));

          const { error } = await supabase
            .from('job_candidate_status')
            .update({ linkedin_profile_data: unipileResponse.profile as any })
            .eq('candidate_id', profile.id)
            .is('linkedin_profile_data', null);

          if (error) {
            console.warn('[ProfileDetail] Failed to persist enriched data:', error);
          }
        }
      } catch (err) {
        if (!cancelled) {
          console.warn('[ProfileDetail] Auto-enrich failed:', err);
        }
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        if (!cancelled) setIsEnriching(false);
      }
    })();

    return () => {
      cancelled = true;
      if (timeoutId) clearTimeout(timeoutId);
      setIsEnriching(false);
    };
  }, [open, profile?.id, accountId]);

  // ─── Base Konekt : révélation de la fiche complète à l'ouverture ─────────
  // L'aperçu ne contient que le poste courant. Le collect Coresignal ramène
  // tout le parcours, la formation, les compétences, le résumé et la photo.
  // Résultat mis en cache 30 j côté serveur → réouverture gratuite. Ne touche
  // jamais le compte LinkedIn (contrairement à l'auto-enrich pool ci-dessus).
  useEffect(() => {
    if (!open || !profile) return;
    const isDb = (profile as any).source === 'database' || (profile as any)._source === 'database';
    if (!isDb) return;
    // Déjà complet (fiche collectée en cache) si une expérience a une description.
    const hasFull = Array.isArray(profile.work_experience)
      && profile.work_experience.some((w) => !!w?.description);
    if (hasFull) return;

    let cancelled = false;
    setIsEnriching(true);
    (async () => {
      try {
        const { data } = await invokeCoresignal({ body: { action: 'collect', id: profile.id } });
        if (!cancelled && data?.success && data.profile) {
          setEnrichedProfile({ ...(data.profile as LinkedInProfile), source: 'database' } as LinkedInProfile);
        }
      } catch (err) {
        if (!cancelled) console.warn('[ProfileDetail] Base Konekt collect failed:', err);
      } finally {
        if (!cancelled) setIsEnriching(false);
      }
    })();

    return () => { cancelled = true; };
  }, [open, profile?.id]);

  // ─── Scoring profond à la demande ───────────────────────────────────────
  // Le score de liste ('quick') est calculé sur les seules données de
  // recherche. L'analyse complète récupère le profil entier (visite de
  // profil réelle, quota vérifié côté serveur via le ledger) et re-score
  // avec — résultat marqué 'deep'. Déclenchée MANUELLEMENT via le bouton
  // "Analyse complète" : avant 2026-07 elle partait toute seule 1,5 s après
  // l'ouverture de la fiche (scoring + visite LinkedIn non sollicités).
  const [isDeepScoring, setIsDeepScoring] = useState(false);
  // Ref pour lire le callback sans dépendance : le parent le recrée à chaque
  // render (arrow inline).
  const onDeepScoreRef = useRef(onDeepScore);
  onDeepScoreRef.current = onDeepScore;

  const runDeepScore = useCallback(async () => {
    if (!profile || !accountId || !onDeepScoreRef.current || !selectedJob) return;
    if (isDeepScoring) return;
    setIsDeepScoring(true);
    try {
      // 1. Données complètes déjà en main (auto-enrich vivier passé par là).
      let full: LinkedInProfile | null = enrichedProfile;

      // 2. Sinon, profil complet persisté lors d'une précédente visite
      //    → zéro visite LinkedIn supplémentaire. Le test looksLikeFull…
      //    écarte les blobs minces écrits par le scoring de masse.
      if (!full) {
        const { data: row } = await supabase
          .from('job_candidate_status')
          .select('linkedin_profile_data')
          .eq('candidate_id', profile.id)
          .not('linkedin_profile_data', 'is', null)
          .limit(1)
          .maybeSingle();
        const cachedData = row?.linkedin_profile_data as Record<string, any> | null;
        if (looksLikeFullProfileData(cachedData)) {
          full = mergeUnipileFullProfile(profile, cachedData!);
        }
      }

      // 3. Sinon, visite du profil (1 vue LinkedIn, gated par le ledger).
      if (!full) {
        const profileUrl = profile.public_profile_url || profile.profile_url;
        if (!profileUrl) return;
        const { data: resp } = await invokeUnipile({
          body: { action: 'get_profile', account_id: accountId, profile_url: profileUrl },
        });
        if (!resp?.success || !resp.profile) return;
        emitQuotaAction('profileVisits', 1, accountId);
        full = mergeUnipileFullProfile(profile, resp.profile as Record<string, any>);
        setEnrichedProfile(full); // profite aussi à l'affichage de la fiche
        // Persist best-effort → les prochaines analyses ne re-visitent pas.
        // Écrasement volontaire : les données de visite sont strictement plus
        // riches que le blob mince éventuellement écrit par le scoring de masse.
        supabase
          .from('job_candidate_status')
          .update({ linkedin_profile_data: resp.profile as any })
          .eq('candidate_id', profile.id)
          .then(({ error }) => {
            if (error) console.warn('[ProfileDetail] persist full profile failed:', error);
          });
      }

      if (!full) return;
      await onDeepScoreRef.current?.(full);
    } catch (err) {
      console.warn('[ProfileDetail] Deep scoring failed:', err);
    } finally {
      setIsDeepScoring(false);
    }
  }, [profile, accountId, selectedJob?.id, enrichedProfile, isDeepScoring]);

  const effectiveProfile = enrichedProfile || profile;

  const dummyProfile = { id: '', name: '' } as LinkedInProfile;
  const profileData = useProfileData(effectiveProfile || dummyProfile);
  const candidateProfileUrl = (effectiveProfile || dummyProfile).public_profile_url || (effectiveProfile || dummyProfile).profile_url;

  // Airtable history — fetch by both URL and direct airtable_id for reliability
  const { data: historyData, loading: historyLoading } = useCandidateHistory(
    airtableMatch
      ? { linkedinUrl: candidateProfileUrl, airtableId: airtableMatch.airtable_id }
      : candidateProfileUrl
        ? { linkedinUrl: candidateProfileUrl }
        : null
  );

  // Aircall history
  const aircallHistory = useAircallHistory(
    airtableMatch?.airtable_id || null,
    profile ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') : null,
    historyData?.candidate?.phone || null
  );

  const formatHistoryDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return null;
    const isoMatch = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (isoMatch) return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1].slice(2)}`;
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return null;
    return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: '2-digit' });
  };

  const historyLatestDate = historyData
    ? [
        ...historyData.placements.map((p: any) => p.start_date),
        ...historyData.shortlists.map((s: any) => s.date_added),
        ...historyData.notes.map((n: any) => n.note_date),
        ...historyData.appointments.map((a: any) => a.appointment_date),
      ]
        .filter((d): d is string => Boolean(d))
        .sort((a, b) => (a > b ? -1 : a < b ? 1 : 0))[0] ?? null
    : null;
  const historyLatestDateLabel = formatHistoryDate(historyLatestDate);

  const contactInfo = useMemo(() => {
    const rawValues = [
      (enrichedProfile || profile)?.contact_info?.emails,
      (enrichedProfile || profile)?.contact_info?.phones,
      airtableMatch,
      historyData?.candidate,
    ].flatMap((value) => collectStrings(value));

    const emails = unique(rawValues.filter((value) => EMAIL_REGEX.test(value.toLowerCase()))).slice(0, 4);
    const phones = unique(
      rawValues
        .map((value) => value.replace(/\s+/g, ' ').trim())
        .filter((value) => PHONE_REGEX.test(value) && !EMAIL_REGEX.test(value.toLowerCase()))
    ).slice(0, 3);

    return { emails, phones };
  }, [airtableMatch, enrichedProfile, historyData?.candidate, profile]);

  if (!profile) return null;

  // Use enriched version if available (pool profiles auto-fetched from Unipile)
  const displayProfile = enrichedProfile || profile;

  const {
    fullName, initials, currentCompany, currentRole, currentJobTenure,
    networkDistance, profileUrl, skills, education, educationPreview,
    otherCurrentJobs, pastJobs, connectionsCount, isLikelyToRespond, totalExperience,
  } = profileData;


  const hasHistory = historyData && (
    historyData.placements.length > 0 ||
    historyData.shortlists.length > 0 ||
    historyData.notes.length > 0 ||
    historyData.appointments.length > 0 ||
    historyData.candidate
  );

  const messageModal = selectedJob ? (
    <OutreachMessageModal
      open={showMessageModal}
      onOpenChange={setShowMessageModal}
      profile={profile}
      job={selectedJob}
      selectedAccount={accountId}
      calendlyLink={activeProject?.calendly_link}
      projectId={missionIdOfJob(activeProject?.id)}
      candidateHistory={historyData ? {
        shortlists: historyData.shortlists,
        placements: historyData.placements,
        notes: historyData.notes,
        appointments: historyData.appointments,
      } : undefined}
      onMessageSent={() => {
        // « Contacté » est posé par le serveur à l'envoi (lot 0b) : plus
        // d'écriture du pipeline depuis le navigateur.
        onMessageSent?.();
        onProfileTreated?.();
      }}
    />
  ) : null;

  // ─── PANNEAU DE DROITE (nouvelle page mission) ───
  // Même structure que la fiche du Pipeline : en-tête collant (visage, nom,
  // place dans la liste, flèches, croix), l'étape et les gestes, la raison de la
  // note, puis les onglets.
  if (asPanel) {
    const reasons = jobScore
      ? scoreReasons({ ...(jobScore.scoring_details ?? {}), summary: jobScore.summary })
      : null;
    const position = displayProfile.headline || [currentRole, currentCompany].filter(Boolean).join(', ') || null;
    const note = jobScore && jobScore.match_score > 0 ? `Note ${Math.round(jobScore.match_score)}` : null;
    const meta = [displayProfile.location, totalExperience, note].filter(Boolean).join(' · ');
    const rank = currentIndex != null && totalCount != null ? `${currentIndex + 1} sur ${totalCount}` : null;
    const canScore = !!selectedJob && !!onScoreProfile && (!jobScore || isDegradedScore(jobScore));
    const showDecisionRow = !!decisions && (decisions.onRetain || decisions.onRestore);

    return (
      <>
        <div ref={panelRootRef} className="flex min-h-full min-w-0 flex-col">
          <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-border bg-background py-3 pl-5 pr-3">
            <PersonAvatar name={fullName} src={displayProfile.profile_picture_url} size={40} className="mt-0.5" />
            <div className="flex min-w-0 flex-1 flex-col gap-0.5">
              <div className="flex items-center gap-0.5">
                <h2
                  id={asPanel.titleId}
                  tabIndex={-1}
                  title={fullName}
                  className="min-w-0 flex-1 break-words text-lg font-semibold leading-tight text-foreground outline-none line-clamp-2"
                >
                  {fullName || 'Profil LinkedIn'}
                </h2>
                {rank && (
                  <span className="mr-1.5 whitespace-nowrap text-xs tabular-nums text-muted-foreground max-sm:hidden">{rank}</span>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Candidat précédent"
                  title="Candidat précédent (flèche haut)"
                  className="min-h-11 min-w-11 shrink-0 lg:min-h-0 lg:min-w-0"
                  disabled={!onNavigatePrev}
                  onClick={() => onNavigatePrev?.()}
                >
                  <ChevronUp className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Candidat suivant"
                  title="Candidat suivant (flèche bas)"
                  className="min-h-11 min-w-11 shrink-0 lg:min-h-0 lg:min-w-0"
                  disabled={!onNavigateNext}
                  onClick={() => onNavigateNext?.()}
                >
                  <ChevronDown className="h-4 w-4" aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon-sm"
                  aria-label="Fermer le panneau"
                  title="Fermer (Échap)"
                  className="min-h-11 min-w-11 shrink-0 lg:min-h-0 lg:min-w-0"
                  onClick={asPanel.onClose}
                >
                  <X className="h-4 w-4" aria-hidden="true" />
                </Button>
              </div>
              {position && (
                <p title={position} className="truncate text-sm text-foreground-secondary">{position}</p>
              )}
              {(meta || profileUrl || rank) && (
                <p className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs tabular-nums text-muted-foreground">
                  {meta && <span>{meta}</span>}
                  {rank && <span className="sm:hidden">{rank}</span>}
                  {profileUrl && (
                    <a
                      href={profileUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 rounded-sm underline-offset-4 transition-colors duration-150 hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    >
                      Profil LinkedIn
                      <ExternalLink className="h-3 w-3" aria-hidden="true" />
                      <span className="sr-only">(nouvel onglet)</span>
                    </a>
                  )}
                </p>
              )}
            </div>
          </header>

          <section aria-label="Étape du candidat" className="flex flex-col gap-3 px-5 py-4">
            {decisions?.stageLabel && (
              <div className="flex items-start gap-2">
                <p className="min-w-0 flex-1 pt-1 text-md font-semibold text-foreground">{decisions.stageLabel}</p>
                {decisions.onDismiss && (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    disabled={deciding}
                    onClick={() => void decide(decisions.onDismiss)}
                    className="-mr-2.5 shrink-0 text-danger hover:bg-danger-muted hover:text-danger"
                  >
                    Écarter
                  </Button>
                )}
              </div>
            )}
            {showDecisionRow && (
              <div className="flex flex-wrap items-center gap-2">
                {decisions?.onRetain && (
                  <Button type="button" variant="outline" disabled={deciding} onClick={() => void decide(decisions.onRetain)}>
                    Retenir
                  </Button>
                )}
                {decisions?.onRestore && (
                  <Button type="button" variant="outline" disabled={deciding} onClick={() => void decide(decisions.onRestore)}>
                    Remettre à trier
                  </Button>
                )}
              </div>
            )}
            <div className="-mx-2.5 flex flex-wrap items-center gap-1">
              {canScore && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={handleScore}
                  loading={isScoring}
                  className="shrink-0 text-foreground-secondary hover:text-foreground"
                >
                  {!isScoring && <Target aria-hidden="true" />}
                  {jobScore ? 'Relancer la note' : 'Noter'}
                </Button>
              )}
              {accountId && jobScore?.recommendation !== 'skip' && (
                <SequenceEnrollButton
                  selectedProfiles={[profile]}
                  accountId={accountId}
                  selectedJob={selectedJob ?? undefined}
                  onSuccess={() => { onSequenceEnroll?.(); onProfileTreated?.(); }}
                  quiet
                />
              )}
              {selectedJob && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowMessageModal(true)}
                  className="shrink-0 text-foreground-secondary hover:text-foreground"
                >
                  <PenLine aria-hidden="true" />
                  Message
                </Button>
              )}
              {profileUrl && <EnrichContactButton profile={profile} compact mode="button-only" quiet />}
            </div>
            {(contactInfo.emails.length > 0 || contactInfo.phones.length > 0) && (
              <div className="flex flex-wrap items-center gap-1.5">
                {contactInfo.emails.map((email) => (
                  <ContactChip key={email} icon={Mail} value={email} title="Cliquer pour copier" onCopy={() => { navigator.clipboard.writeText(email); toast.success('Adresse e-mail copiée.'); }} />
                ))}
                {contactInfo.phones.map((phone) => (
                  <ContactChip key={phone} icon={Phone} value={phone} title="Cliquer pour copier" onCopy={() => { navigator.clipboard.writeText(phone); toast.success('Numéro copié.'); }} />
                ))}
              </div>
            )}
          </section>

          {jobScore && (
            <section aria-label="Pourquoi cette note" className="border-t border-border px-5 py-4 text-sm">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-medium text-foreground">Pourquoi cette note</p>
                {isDeepScoring ? (
                  <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                    <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
                    Analyse complète en cours
                  </span>
                ) : jobScore.scoringDepth === 'deep' ? (
                  <span className="text-xs text-muted-foreground" title="Évalué sur le profil complet (parcours détaillé, À propos…)">Évaluation complète</span>
                ) : (
                  <span className="inline-flex items-center gap-2 text-xs text-muted-foreground">
                    <span title="Évalué sur les données de la liste de recherche">Évaluation rapide</span>
                    {accountId && onDeepScore && (
                      <Button
                        type="button"
                        variant="link"
                        size="xs"
                        onClick={runDeepScore}
                        disabled={isEnriching}
                        title={isEnriching ? 'Chargement du profil en cours' : 'Ré-évaluer sur le profil complet (peut consommer 1 visite de profil LinkedIn)'}
                        className="h-auto p-0 text-xs font-normal text-brand"
                      >
                        Analyse complète
                      </Button>
                    )}
                  </span>
                )}
              </div>
              {reasons?.summary && <p className="mt-1 text-muted-foreground">{reasons.summary}</p>}
              {reasons && (reasons.strengths.length > 0 || reasons.concerns.length > 0) && (
                <div className="mt-2 grid gap-3 sm:grid-cols-2">
                  {reasons.strengths.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-success">Points forts</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                        {reasons.strengths.map((item, i) => <li key={i}>{item}</li>)}
                      </ul>
                    </div>
                  )}
                  {reasons.concerns.length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-warning">Réserves</p>
                      <ul className="mt-1 list-disc space-y-0.5 pl-4 text-xs text-muted-foreground">
                        {reasons.concerns.map((item, i) => <li key={i}>{item}</li>)}
                      </ul>
                    </div>
                  )}
                </div>
              )}
            </section>
          )}

          {isEnriching && (
            <div className="mx-5 mb-2 flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
              Chargement du profil complet
            </div>
          )}

          <div className="min-w-0 px-4 pb-4 sm:px-5">
            <CardExpandedContent
              profile={displayProfile}
              profileData={profileData}
              selectedJob={selectedJob}
              jobScore={jobScore}
              accountId={accountId}
              projectId={missionIdOfJob(activeProject?.id)}
              candidateStatus={candidateStatus}
              airtableMatch={airtableMatch}
              historyData={null}
              historyLoading={false}
              onClose={() => asPanel.onClose()}
              hidePosts
              onOpenMessage={() => setShowMessageModal(true)}
              onMessageSent={onMessageSent}
              onProfileTreated={onProfileTreated}
            />
          </div>
        </div>
        {messageModal}
      </>
    );
  }

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="!w-full !max-w-[100vw] min-w-0 sm:!w-[95vw] sm:!max-w-[600px] p-0 flex flex-col overflow-hidden border-l border-border bg-background" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd} onKeyDown={handleArrowKeys}>
          {/* ─── SWIPE HINT ─── */}
          {showSwipeHint && (
            <div className="sm:hidden flex items-center justify-center gap-3 py-1.5 bg-primary/10 text-primary text-xs font-medium animate-fade-in shrink-0">
              <ChevronLeft className="w-3.5 h-3.5 animate-[pulse_1s_ease-in-out_infinite]" />
              <span>Swipez pour naviguer</span>
              <ChevronRight className="w-3.5 h-3.5 animate-[pulse_1s_ease-in-out_infinite]" />
            </div>
          )}

          {/* ─── HEADER ─── */}
          <SheetHeader className="shrink-0 space-y-0 border-b border-border bg-background py-4 pl-4 pr-3 text-left sm:pl-5">
            <div className="flex items-start gap-3">
              <PersonAvatar name={fullName} src={displayProfile.profile_picture_url} size={40} className="mt-0.5" />
              <div className="min-w-0 flex-1">
                {/* Rangée du nom : la place dans la liste et les flèches, à gauche de la croix de la fenêtre (pr-10). */}
                <div className="flex items-center gap-0.5 pr-10">
                  <div className="flex min-w-0 flex-1 items-center gap-2">
                    <SheetTitle className="min-w-0 break-words text-lg font-semibold leading-tight line-clamp-2 text-foreground">
                      {fullName || 'Profil LinkedIn'}
                    </SheetTitle>
                    {profileUrl && (
                      <a
                        href={profileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        aria-label="Ouvrir le profil LinkedIn"
                        title="Ouvrir le profil LinkedIn"
                        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-md transition-colors duration-150 hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                      >
                        <img src={linkedinLogo} alt="" className="h-3.5 w-3.5" />
                      </a>
                    )}
                  </div>
                  {(onNavigatePrev || onNavigateNext) && (
                    <>
                      {currentIndex != null && totalCount != null && (
                        <span className="mr-1.5 whitespace-nowrap text-xs tabular-nums text-muted-foreground">
                          {currentIndex + 1} sur {totalCount}
                        </span>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Candidat précédent"
                        title="Candidat précédent (flèche haut)"
                        className="shrink-0 max-sm:min-h-11 max-sm:min-w-11"
                        disabled={!onNavigatePrev}
                        onClick={onNavigatePrev}
                      >
                        <ChevronUp aria-hidden="true" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon-sm"
                        aria-label="Candidat suivant"
                        title="Candidat suivant (flèche bas)"
                        className="shrink-0 max-sm:min-h-11 max-sm:min-w-11"
                        disabled={!onNavigateNext}
                        onClick={onNavigateNext}
                      >
                        <ChevronDown aria-hidden="true" />
                      </Button>
                    </>
                  )}
                </div>
                <p className="mt-1 line-clamp-2 text-sm leading-snug text-foreground-secondary">
                  {displayProfile.headline || currentRole || 'Profil LinkedIn'}
                </p>
                <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                  {currentCompany && (
                    <span className="flex items-center gap-1.5">
                      <CompanyLogo company={currentCompany} logoUrl={profileData.currentJob?.company_logo} />
                      <span className="max-w-[160px] truncate sm:max-w-none">{currentCompany}</span>
                      {currentJobTenure && <span className="hidden sm:inline">· {currentJobTenure}</span>}
                    </span>
                  )}
                  {displayProfile.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="h-3 w-3 shrink-0" aria-hidden="true" />
                      <span className="max-w-[140px] truncate sm:max-w-none">{displayProfile.location}</span>
                    </span>
                  )}
                  {totalExperience && (
                    <span className="flex items-center gap-1">
                      <TrendingUp className="h-3 w-3 shrink-0" aria-hidden="true" />
                      {totalExperience}
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Statuts et note */}
            <div className="mt-2 flex flex-wrap items-center gap-1.5 empty:hidden">
              <CardStatusBadges
                candidateStatus={candidateStatus}
                jobScore={jobScore}
                profile={profile}
                isLikelyToRespond={isLikelyToRespond}
                airtableMatch={airtableMatch}
                historyData={historyData}
                historyLoading={historyLoading}
                historyLatestDateLabel={historyLatestDateLabel}
              />
              {/* Mode pipeline : la note ouvre l'onglet Évaluation */}
              {pipelineMeta?.score != null && pipelineMeta.score > 0 && (
                <button
                  type="button"
                  onClick={pipelineMeta.onScoreClick}
                  className="rounded-md text-xs tabular-nums text-muted-foreground transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  title={`Note ${pipelineMeta.score} sur 100, voir l'évaluation`}
                  aria-label={`Note ${pipelineMeta.score}, voir l'évaluation`}
                >
                  Note {pipelineMeta.score}
                </button>
              )}
            </div>

            {/* ─── PIPELINE META : étape et étiquettes (mode pipeline seulement) ─── */}
            {pipelineMeta && (
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <span className="hidden text-xs text-muted-foreground sm:inline">Étape</span>
                <Select value={pipelineMeta.stage} onValueChange={(value) => pipelineMeta.onStageChange(value)}>
                  <SelectTrigger aria-label="Étape" className="h-8 w-auto min-w-[10rem] gap-2 text-sm">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {pipelineMeta.stageOptions.map(o => (
                      <SelectItem key={o.key} value={o.key}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {pipelineMeta.tags?.map(tag => (
                  <button
                    key={tag}
                    type="button"
                    className="inline-flex h-6 items-center gap-1 rounded-full border border-border px-2 text-xs text-foreground-secondary transition-colors duration-150 hover:border-danger/40 hover:text-danger focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                    onClick={() => pipelineMeta.onTagsChange?.((pipelineMeta.tags || []).filter(t => t !== tag))}
                    title="Retirer cette étiquette"
                    aria-label={`Retirer l'étiquette ${tag}`}
                  >
                    {tag}
                    <X className="h-3 w-3" aria-hidden="true" />
                  </button>
                ))}
                {pipelineMeta.onCreatePortalLink && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={pipelineMeta.onCreatePortalLink}
                    className="ml-auto"
                    title="Générer un lien à partager au client"
                  >
                    <Link2 aria-hidden="true" />
                    Portail
                  </Button>
                )}
              </div>
            )}

            {/* ─── COORDONNÉES ─── */}
            {/* En mode pipeline, la ligne reste affichée même vide pour garder
                l'accès à « Ajouter contacts ». En Sourcing, elle apparaît
                seulement si des coordonnées existent. */}
            {(contactInfo.emails.length > 0 || contactInfo.phones.length > 0 || pipelineMeta?.manualEmail || pipelineMeta?.manualPhone || pipelineMeta?.contactsEditor) && (
              <div className="mt-3 flex flex-wrap items-center gap-1.5">
                {pipelineMeta?.manualEmail && (
                  <ContactChip icon={Mail} value={pipelineMeta.manualEmail} title="Saisi manuellement, cliquer pour copier" onCopy={() => { navigator.clipboard.writeText(pipelineMeta.manualEmail!); toast.success('Adresse e-mail copiée.'); }} />
                )}
                {pipelineMeta?.manualPhone && (
                  <ContactChip icon={Phone} value={pipelineMeta.manualPhone} title="Saisi manuellement, cliquer pour copier" onCopy={() => { navigator.clipboard.writeText(pipelineMeta.manualPhone!); toast.success('Numéro copié.'); }} />
                )}
                {contactInfo.emails.map((email) => (
                  <ContactChip key={email} icon={Mail} value={email} title="Cliquer pour copier" onCopy={() => { navigator.clipboard.writeText(email); toast.success('Adresse e-mail copiée.'); }} />
                ))}
                {contactInfo.phones.map((phone) => (
                  <ContactChip key={phone} icon={Phone} value={phone} title="Cliquer pour copier" onCopy={() => { navigator.clipboard.writeText(phone); toast.success('Numéro copié.'); }} />
                ))}
                {pipelineMeta?.contactsEditor && (
                  <div className="ml-auto">{pipelineMeta.contactsEditor}</div>
                )}
              </div>
            )}

            {/* ─── ACTIONS ─── */}
            <div className="mt-3 flex flex-wrap items-center gap-2" data-no-swipe>
              {selectedJob && onScoreProfile && (!jobScore || isDegradedScore(jobScore)) && (
                <Button
                  variant="primary"
                  size="sm"
                  onClick={handleScore}
                  loading={isScoring}
                  className="shrink-0"
                >
                  {!isScoring && <Target aria-hidden="true" />}
                  {/* Note dégradée (passe IA échouée) : proposer la relance */}
                  {jobScore ? 'Relancer la note' : 'Noter'}
                </Button>
              )}

              {accountId && jobScore?.recommendation !== 'skip' && (
                <SequenceEnrollButton
                  selectedProfiles={[profile]}
                  accountId={accountId}
                  selectedJob={selectedJob ?? undefined}
                  onSuccess={() => { onSequenceEnroll?.(); onProfileTreated?.(); }}
                />
              )}

              {selectedJob && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowMessageModal(true)}
                  className="shrink-0"
                >
                  <PenLine aria-hidden="true" />
                  Message
                </Button>
              )}

              {selectedJob && (
                <AddToProjectButton
                  candidateId={profile.id}
                  candidateName={fullName}
                  candidateHeadline={profile.headline}
                  linkedinProfileUrl={profileUrl}
                  score={jobScore?.match_score}
                  recommendation={jobScore?.recommendation}
                  skipReason={jobScore?.missing_skills?.join(', ')}
                  jobId={selectedJob.id}
                  activeProject={activeProject}
                  compact
                  onAdded={onProfileTreated}
                />
              )}

              {/* Email et téléphone par cascade : toujours affiché en mode
                  « button-only », les coordonnées existantes le sont au-dessus. */}
              {profileUrl && (
                <EnrichContactButton
                  profile={profile}
                  compact
                  mode="button-only"
                />
              )}

              {onArchive && (
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={onArchive}
                  className="ml-auto shrink-0 text-danger hover:bg-danger-muted hover:text-danger"
                >
                  <Archive aria-hidden="true" />
                  <span className="hidden sm:inline">Archiver</span>
                </Button>
              )}
            </div>
          </SheetHeader>

          {/* ─── CONTENT ─── */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="min-w-0 max-w-full space-y-4 px-4 py-4 sm:px-5">
              {/* Job Score */}
              {jobScore && (
                <div className="overflow-hidden rounded-xl border border-border">
                  <details open className="group">
                    <summary className="flex items-center justify-between p-3 sm:p-4 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                      <div className="flex items-center gap-2 min-w-0">
                        <h3 className="text-md font-semibold text-foreground">Note</h3>
                        {/* Profondeur de l'éval : rapide (données de liste) vs
                            complète (profil visité). Pendant le re-score → spinner. */}
                        {isDeepScoring ? (
                          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Analyse complète en cours…
                          </span>
                        ) : jobScore.scoringDepth === 'deep' ? (
                          <span
                            className="rounded-md bg-success-muted px-1.5 py-0.5 text-xs text-success"
                            title="Évalué sur le profil complet (parcours détaillé, À propos…)"
                          >
                            Évaluation complète
                          </span>
                        ) : (
                          <>
                            <span
                              className="rounded-md bg-muted px-1.5 py-0.5 text-xs text-muted-foreground"
                              title="Évalué sur les données de la liste de recherche"
                            >
                              Évaluation rapide
                            </span>
                            {/* Lancement MANUEL de l'analyse complète (avant :
                                auto à l'ouverture de la fiche). stopPropagation
                                + preventDefault : le bouton vit dans le <summary>
                                du collapsible, un clic ne doit pas le replier. */}
                            {accountId && onDeepScore && (
                              <button
                                onClick={(e) => { e.preventDefault(); e.stopPropagation(); runDeepScore(); }}
                                disabled={isEnriching}
                                title={isEnriching
                                  ? 'Chargement du profil en cours…'
                                  : 'Ré-évaluer sur le profil complet (parcours détaillé, À propos…) — peut consommer 1 visite de profil LinkedIn'}
                                className="rounded-md text-xs font-semibold text-brand underline-offset-4 transition-colors duration-150 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                              >
                                Analyse complète
                              </button>
                            )}
                          </>
                        )}
                      </div>
                      <ChevronRight className="w-3.5 h-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
                    </summary>
                    <div className="px-3 sm:px-4 pb-4">
                      <JobScoreDisplay result={jobScore} jobTitle={selectedJob?.title} compact={false} />
                    </div>
                  </details>
                </div>
              )}

              {/* Panels au-dessus des tabs : MASQUÉS en mode pipeline.
                  Pourquoi : en pipeline, l'onglet "Aperçu" (premier extraTab,
                  default actif) est censé être visible immédiatement à
                  l'ouverture. Si on garde Airtable History + Aircall +
                  About au-dessus, ils poussent les tabs sous la fold →
                  l'user ne voit pas le dashboard Aperçu sans scroller.
                  Les infos sont déjà accessibles ailleurs :
                  - About → section "À propos" dans Aperçu
                  - Aircall stats → card Engagement dans Aperçu
                  - Airtable history → onglet Activité
                    (timeline) qui les incorpore déjà.
                  En mode sourcing pur (pas de pipelineMeta), comportement
                  inchangé : panels visibles avant les tabs comme avant. */}
              {!pipelineMeta && (
                <>
                  {/* Airtable History Panel */}
                  {(historyLoading || hasHistory) && (
                    <div className="overflow-hidden rounded-xl border border-border">
                      <CandidateHistoryPanel data={historyData} loading={historyLoading} compact={false} />
                    </div>
                  )}

                  {/* Aircall History */}
                  {(aircallHistory.loading || aircallHistory.calls.length > 0) && (
                    <div className="overflow-hidden rounded-xl border border-border p-3 sm:p-4">
                      <AircallHistoryPanel
                        calls={aircallHistory.calls}
                        loading={aircallHistory.loading}
                        totalCalls={aircallHistory.totalCalls}
                        totalDuration={aircallHistory.totalDuration}
                      />
                    </div>
                  )}

                  {/* À propos */}
                  {displayProfile.summary && (
                    <div className="overflow-hidden rounded-xl border border-border">
                      <details className="group">
                        <summary className="flex items-center justify-between p-3 sm:p-4 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                          <h3 className="text-md font-semibold text-foreground">À propos</h3>
                          <ChevronRight className="w-3.5 h-3.5 text-muted-foreground transition-transform group-open:rotate-90" />
                        </summary>
                        <div className="px-3 sm:px-4 pb-3 sm:pb-4">
                          <p className="text-sm text-muted-foreground leading-relaxed whitespace-pre-line">{displayProfile.summary}</p>
                        </div>
                      </details>
                    </div>
                  )}
                </>
              )}

              {/* Loading indicator for pool profile enrichment */}
              {isEnriching && (
                <div className="flex items-center gap-2 rounded-xl border border-border p-3 text-sm text-muted-foreground">
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Chargement du profil complet…
                </div>
              )}

              {/* Tabs : extraTabs en premier (pipeline) puis tabs
                  standards LinkedIn (Exp/Form/Skills/Msg/Posts) sauf si
                  hideStandardTabs (mode pipeline qui les remplace par
                  Profil + Messages reformulés). */}
              <CardExpandedContent
                profile={displayProfile}
                profileData={profileData}
                selectedJob={selectedJob}
                jobScore={jobScore}
                accountId={accountId}
                projectId={missionIdOfJob(activeProject?.id)}
                candidateStatus={candidateStatus}
                airtableMatch={airtableMatch}
                historyData={null}
                historyLoading={false}
                onClose={() => onOpenChange(false)}
                onOpenMessage={() => setShowMessageModal(true)}
                onMessageSent={onMessageSent}
                onProfileTreated={onProfileTreated}
                extraTabs={extraTabs}
                hideStandardTabs={hideStandardTabs}
                initialTab={initialTab}
              />
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {messageModal}
    </>
  );
};

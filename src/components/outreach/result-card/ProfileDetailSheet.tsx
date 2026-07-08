import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import linkedinLogo from '@/assets/linkedin-logo.svg';
import { emitQuotaAction } from '@/lib/quotaEvents';
import { Sheet, SheetContent, SheetHeader, SheetTitle } from '@/components/ui/sheet';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';

import { Separator } from '@/components/ui/separator';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { LinkedInProfile } from '../types';
import { JobMatchResult, JobScoreDisplay, SalaryBadge, isDegradedScore } from '../JobScoreDisplay';
import { Job } from '@/types/jobs';
import { SourcingProject } from '@/hooks/useSourcingProjects';
import { CardExpandedContent } from './CardExpandedContent';
import { CardStatusBadges } from './CardStatusBadges';
import { useProfileData } from './useProfileData';
import { useCandidateHistory } from '@/hooks/useCandidateHistory';
import { NotionShortlistHistoryItem } from '@/hooks/useCandidateHistory';
import { CandidateHistoryPanel } from '../CandidateHistoryPanel';
import { useAircallHistory } from '@/hooks/useAircallHistory';
import { AircallHistoryPanel } from '../AircallHistoryPanel';
import { useNotionShortlist } from '@/hooks/useNotionCandidates';
import { OutreachMessageModal } from '../OutreachMessageModal';
import { SequenceEnrollButton } from '../SequenceEnrollButton';
import { AddToProjectButton } from '../projects/AddToProjectButton';
import { EnrichContactButton } from './EnrichContactButton';
import {
  Building2, MapPin, TrendingUp, ExternalLink, Loader2, Mail, Phone,
  Target, PenLine, Archive,
  ChevronLeft, ChevronRight,
} from 'lucide-react';
import { invokeUnipile } from '@/lib/invokeUnipile';
import { invokeCoresignal } from '@/lib/invokeCoresignal';
import { supabase } from '@/integrations/supabase/client';
import { invokeEdgeFunction } from '@/lib/invokeEdgeFunction';
import { toast } from 'sonner';

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
  notionMatch?: any;
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
  notionMatch,
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
}) => {
  const [showMessageModal, setShowMessageModal] = useState(false);

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

  // Notion shortlist data for this candidate
  const { data: notionShortlistData, isLoading: notionShortlistLoading } = useNotionShortlist();

  // Aircall history
  const aircallHistory = useAircallHistory(
    airtableMatch?.airtable_id || null,
    profile ? [profile.first_name, profile.last_name].filter(Boolean).join(' ') : null,
    historyData?.candidate?.phone || null
  );

  const notionShortlistsForCandidate: NotionShortlistHistoryItem[] = React.useMemo(() => {
    if (!notionShortlistData) return [];

    const normalizeName = (value?: string | null) =>
      (value || '')
        .toLowerCase()
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z0-9\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    const profileNames = [
      profileData.fullName,
      profile?.name,
      [profile?.first_name, profile?.last_name].filter(Boolean).join(' '),
    ]
      .map(normalizeName)
      .filter(Boolean);

    const matched = notionShortlistData.filter((s: any) => {
      if (!s.candidate) return false;
      if (notionMatch && s.candidate.id === notionMatch.id) return true;

      const candidateName = normalizeName(s.candidate.name);
      if (!candidateName || profileNames.length === 0) return false;

      return profileNames.some((profileName) =>
        profileName === candidateName ||
        profileName.includes(candidateName) ||
        candidateName.includes(profileName)
      );
    });

    const seen = new Set<string>();
    return matched
      .filter((s: any) => {
        if (!s.id || seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      })
      .map((s: any) => ({
        id: s.id,
        name: s.name,
        stage: s.stage,
        entity: s.entity,
        positions: s.positions || [],
        createdAt: s.createdAt,
        preQualifDate: s.preQualifDate,
        cvPresentationDate: s.cvPresentationDate,
        startDate: s.startDate,
      }));
  }, [notionMatch, notionShortlistData, profileData.fullName, profile?.name, profile?.first_name, profile?.last_name]);

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


  const shouldWaitForNotionHistory = Boolean(notionMatch) && notionShortlistsForCandidate.length === 0 && !historyData;
  const historyPanelLoading = historyLoading || (shouldWaitForNotionHistory && notionShortlistLoading);
  const hasHistory = notionShortlistsForCandidate.length > 0 || (historyData && (
    historyData.placements.length > 0 ||
    historyData.shortlists.length > 0 ||
    historyData.notes.length > 0 ||
    historyData.appointments.length > 0 ||
    historyData.candidate
  ));

  return (
    <>
      <Sheet open={open} onOpenChange={onOpenChange}>
        <SheetContent side="right" className="!w-full !max-w-[100vw] min-w-0 sm:!w-[95vw] sm:!max-w-[820px] p-0 flex flex-col overflow-hidden rounded-xl border-l border-border bg-muted" onTouchStart={handleTouchStart} onTouchEnd={handleTouchEnd}>
          {/* ─── NAV BAR ─── */}
          {(onNavigatePrev || onNavigateNext) && (
            <div className="flex items-center justify-between px-3 sm:px-5 py-2 bg-background border-b border-border shrink-0">
              <Button
                variant="ghost"
                size="sm"
                onClick={onNavigatePrev}
                disabled={!onNavigatePrev}
                className="h-7 gap-1 text-xs rounded-lg px-2 text-muted-foreground hover:text-foreground"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Préc.
              </Button>
              {currentIndex != null && totalCount != null && (
                <span className="text-xs text-muted-foreground tabular-nums font-medium">
                  {currentIndex + 1} / {totalCount}
                </span>
              )}
              <Button
                variant="ghost"
                size="sm"
                onClick={onNavigateNext}
                disabled={!onNavigateNext}
                className="h-7 gap-1 text-xs rounded-lg px-2 text-muted-foreground hover:text-foreground"
              >
                Suiv.
                <ChevronRight className="w-3.5 h-3.5" />
              </Button>
            </div>
          )}

          {/* ─── SWIPE HINT ─── */}
          {showSwipeHint && (
            <div className="sm:hidden flex items-center justify-center gap-3 py-1.5 bg-primary/10 text-primary text-xs font-medium animate-fade-in shrink-0">
              <ChevronLeft className="w-3.5 h-3.5 animate-[pulse_1s_ease-in-out_infinite]" />
              <span>Swipez pour naviguer</span>
              <ChevronRight className="w-3.5 h-3.5 animate-[pulse_1s_ease-in-out_infinite]" />
            </div>
          )}

          {/* ─── HEADER ─── */}
          <SheetHeader className="px-3 sm:px-5 pt-4 pb-3 bg-background border-b border-border shrink-0">
            <div className="flex items-start gap-3">
              <Avatar className="w-12 h-12 sm:w-14 sm:h-14 border border-border shrink-0 rounded-xl shadow-sm">
                <AvatarImage src={displayProfile.profile_picture_url} alt={fullName} className="object-cover" />
                <AvatarFallback className="bg-muted text-foreground text-base sm:text-lg font-semibold rounded-xl">
                  {initials || '?'}
                </AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0 space-y-1">
                <div className="flex items-center gap-2">
                  <SheetTitle className="text-base sm:text-lg font-bold text-foreground leading-tight truncate">
                    {fullName || 'Profil LinkedIn'}
                  </SheetTitle>
                  {profileUrl && (
                    <a href={profileUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center justify-center w-6 h-6 rounded-md hover:bg-muted transition-colors shrink-0">
                      <img src={linkedinLogo} alt="LinkedIn" className="w-3.5 h-3.5" />
                    </a>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground line-clamp-2 leading-snug">
                  {displayProfile.headline || currentRole || 'Profil LinkedIn'}
                </p>
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-0.5 text-xs text-muted-foreground">
                  {currentCompany && (
                    <span className="flex items-center gap-1.5 font-medium text-foreground/80">
                      <CompanyLogo company={currentCompany} logoUrl={profileData.currentJob?.company_logo} />
                      <span className="truncate max-w-[120px] sm:max-w-none">{currentCompany}</span>
                      {currentJobTenure && <span className="text-muted-foreground/60 font-normal hidden sm:inline">· {currentJobTenure}</span>}
                    </span>
                  )}
                  {displayProfile.location && (
                    <span className="flex items-center gap-1">
                      <MapPin className="w-3 h-3 shrink-0" />
                      <span className="truncate max-w-[100px] sm:max-w-none">{displayProfile.location}</span>
                    </span>
                  )}
                  {totalExperience && (
                    <span className="flex items-center gap-1 font-medium text-foreground/80">
                      <TrendingUp className="w-3 h-3 shrink-0" />
                      {totalExperience}
                    </span>
                  )}
                </div>

                {/* Status badges */}
                <div className="flex flex-wrap items-center gap-1 pt-0.5">
                  <CardStatusBadges
                    candidateStatus={candidateStatus}
                    jobScore={jobScore}
                    profile={profile}
                    isLikelyToRespond={isLikelyToRespond}
                    airtableMatch={airtableMatch}
                    notionMatch={notionMatch}
                    historyData={historyData}
                    historyLoading={historyLoading}
                    historyLatestDateLabel={historyLatestDateLabel}
                  />
                  {/* Pipeline mode : score badge cliquable pour ouvrir l'onglet Évaluation */}
                  {pipelineMeta?.score != null && pipelineMeta.score > 0 && (
                    <button
                      onClick={pipelineMeta.onScoreClick}
                      className={`inline-flex items-center gap-1 px-1.5 py-0.5 text-[10.5px] font-bold tabular-nums border rounded-full transition-colors hover:opacity-90 ${
                        pipelineMeta.score >= 70
                          ? 'bg-success/15 text-success border-success/40'
                          : pipelineMeta.score >= 50
                            ? 'bg-warning/15 text-warning border-warning/40'
                            : 'bg-destructive/15 text-destructive border-destructive/40'
                      }`}
                      title={`Score IA : ${pipelineMeta.score}/100 — clic pour voir l'évaluation`}
                    >
                      <Target className="w-3 h-3" />
                      {pipelineMeta.score}
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* ─── PIPELINE META : stage selector + tags (mode pipeline only) ─── */}
            {pipelineMeta && (
              <div className="flex flex-wrap items-center gap-2 pt-2 mt-2 border-t border-border">
                <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground hidden sm:inline">
                  Étape
                </span>
                <select
                  value={pipelineMeta.stage}
                  onChange={(e) => pipelineMeta.onStageChange(e.target.value)}
                  className="h-7 px-2.5 text-[11.5px] font-medium rounded-full bg-background border border-border focus:outline-none focus:ring-2 focus:ring-foreground/10"
                >
                  {pipelineMeta.stageOptions.map(s => (
                    <option key={s.key} value={s.key}>{s.label}</option>
                  ))}
                </select>
                {pipelineMeta.tags?.map(tag => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 text-[10.5px] px-2 py-0.5 rounded-full bg-accent/20 text-foreground border border-accent/40 font-medium cursor-pointer hover:bg-destructive/10 hover:border-destructive/40 hover:text-destructive transition-colors"
                    onClick={() => pipelineMeta.onTagsChange?.((pipelineMeta.tags || []).filter(t => t !== tag))}
                    title="Cliquer pour supprimer ce tag"
                  >
                    {tag} ×
                  </span>
                ))}
                {pipelineMeta.onCreatePortalLink && (
                  <button
                    onClick={pipelineMeta.onCreatePortalLink}
                    className="ml-auto inline-flex items-center gap-1.5 h-7 px-3 rounded-full bg-success text-success-foreground text-[11px] font-bold hover:bg-success/90 transition-colors shadow-sm"
                    title="Générer un lien portail à partager au client"
                  >
                    🔗 Portail
                  </button>
                )}
              </div>
            )}

            {/* ─── CONTACT INFO ─── */}
            {/* En mode pipeline, on affiche TOUJOURS la ligne contacts
                (même vide) pour donner accès au bouton "Ajouter contacts".
                En sourcing, on garde l'ancien comportement (visible si
                contacts présents). */}
            {(contactInfo.emails.length > 0 || contactInfo.phones.length > 0 || pipelineMeta?.manualEmail || pipelineMeta?.manualPhone || pipelineMeta?.contactsEditor) && (
              <div className="flex flex-wrap items-center gap-1.5 pt-2 mt-2 border-t border-border">
                {/* Manual email/phone (saisis par le recruteur) — affichés en pills success */}
                {pipelineMeta?.manualEmail && (
                  <Badge
                    variant="outline"
                    className="gap-1 rounded-md border-success/40 bg-success/10 px-2 py-0.5 text-xs font-medium text-success cursor-pointer hover:bg-success/15 transition-colors"
                    onClick={() => { navigator.clipboard.writeText(pipelineMeta.manualEmail!); toast.success('Email copié'); }}
                    title="Saisi manuellement"
                  >
                    <Mail className="h-3 w-3" />
                    <span className="max-w-[160px] truncate">{pipelineMeta.manualEmail}</span>
                  </Badge>
                )}
                {pipelineMeta?.manualPhone && (
                  <Badge
                    variant="outline"
                    className="gap-1 rounded-md border-success/40 bg-success/10 px-2 py-0.5 text-xs font-medium text-success cursor-pointer hover:bg-success/15 transition-colors"
                    onClick={() => { navigator.clipboard.writeText(pipelineMeta.manualPhone!); toast.success('Téléphone copié'); }}
                    title="Saisi manuellement"
                  >
                    <Phone className="h-3 w-3" />
                    <span>{pipelineMeta.manualPhone}</span>
                  </Badge>
                )}
                {contactInfo.emails.map((email) => (
                  <Badge
                    key={email}
                    variant="outline"
                    className="gap-1 rounded-md border-border bg-muted/50 px-2 py-0.5 text-xs font-normal text-foreground cursor-pointer hover:bg-muted transition-colors"
                    onClick={() => { navigator.clipboard.writeText(email); toast.success('Email copié'); }}
                  >
                    <Mail className="h-3 w-3 text-muted-foreground" />
                    <span className="max-w-[160px] truncate">{email}</span>
                  </Badge>
                ))}
                {contactInfo.phones.map((phone) => (
                  <Badge
                    key={phone}
                    variant="outline"
                    className="gap-1 rounded-md border-border bg-muted/50 px-2 py-0.5 text-xs font-normal text-foreground cursor-pointer hover:bg-muted transition-colors"
                    onClick={() => { navigator.clipboard.writeText(phone); toast.success('Téléphone copié'); }}
                  >
                    <Phone className="h-3 w-3 text-muted-foreground" />
                    <span>{phone}</span>
                  </Badge>
                ))}
                {/* Editor manuel (pipeline mode) — bouton "Modifier" / "Ajouter contacts" */}
                {pipelineMeta?.contactsEditor && (
                  <div className="ml-auto">{pipelineMeta.contactsEditor}</div>
                )}
              </div>
            )}

            {/* ─── ACTIONS BAR ─── */}
            <div className="flex items-center gap-1.5 mt-2 pt-2 border-t border-border overflow-x-auto no-scrollbar" data-no-swipe>
              {selectedJob && onScoreProfile && (!jobScore || isDegradedScore(jobScore)) && (
                <Button
                  size="sm"
                  onClick={handleScore}
                  disabled={isScoring}
                  className="h-7 gap-1.5 text-xs rounded-lg bg-primary text-primary-foreground hover:bg-primary/90 px-3 font-medium shrink-0"
                >
                  {isScoring ? <Loader2 className="w-3 h-3 animate-spin" /> : <Target className="w-3 h-3" />}
                  {/* Score dégradé (passe IA échouée) → proposer la relance */}
                  {jobScore ? 'Relancer le score' : 'Score'}
                </Button>
              )}

              {accountId && jobScore?.recommendation !== 'skip' && (
                <SequenceEnrollButton
                  selectedProfiles={[profile]}
                  accountId={accountId}
                  selectedJob={selectedJob ? { id: selectedJob.id, title: selectedJob.title } : undefined}
                  onSuccess={() => { onSequenceEnroll?.(); onProfileTreated?.(); }}
                />
              )}

              {selectedJob && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowMessageModal(true)}
                  className="h-7 gap-1.5 text-xs rounded-lg px-3 font-medium shrink-0"
                >
                  <PenLine className="w-3 h-3" />
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

              {/* Récupérer email/téléphone via cascade waterfall — toujours
                  affiché en mode 'button-only' car le block CONTACT INFO
                  au-dessus gère déjà l'affichage des contacts existants. */}
              {profileUrl && (
                <EnrichContactButton
                  profile={profile}
                  compact
                  mode="button-only"
                />
              )}

              {onArchive && (
                <Button variant="ghost" size="sm" onClick={onArchive} className="h-7 gap-1.5 text-xs rounded-lg text-muted-foreground hover:text-destructive hover:bg-destructive/10 px-2 font-medium shrink-0 ml-auto">
                  <Archive className="w-3 h-3" />
                  <span className="hidden sm:inline">Archiver</span>
                </Button>
              )}
            </div>
          </SheetHeader>

          {/* ─── CONTENT ─── */}
          <div className="flex-1 overflow-y-auto overflow-x-hidden">
            <div className="p-2.5 sm:p-5 space-y-3 sm:space-y-4 min-w-0 max-w-full">
              {/* Job Score */}
              {jobScore && (
                <div className="bg-background rounded-lg border border-border overflow-hidden">
                  <details open className="group">
                    <summary className="flex items-center justify-between p-3 sm:p-4 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                      <div className="flex items-center gap-2 min-w-0">
                        <h3 className="text-xs font-semibold text-foreground">Scoring</h3>
                        {/* Profondeur de l'éval : rapide (données de liste) vs
                            complète (profil visité). Pendant le re-score → spinner. */}
                        {isDeepScoring ? (
                          <span className="inline-flex items-center gap-1 text-3xs font-medium text-muted-foreground">
                            <Loader2 className="w-3 h-3 animate-spin" />
                            Analyse complète en cours…
                          </span>
                        ) : jobScore.scoringDepth === 'deep' ? (
                          <span
                            className="text-3xs font-medium px-1.5 py-0.5 rounded bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                            title="Évalué sur le profil complet (parcours détaillé, À propos…)"
                          >
                            Éval. complète
                          </span>
                        ) : (
                          <>
                            <span
                              className="text-3xs font-medium px-1.5 py-0.5 rounded bg-foreground/5 text-muted-foreground"
                              title="Évalué sur les données de la liste de recherche"
                            >
                              Éval. rapide
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
                                className="text-3xs font-semibold px-1.5 py-0.5 rounded border border-primary/40 text-primary hover:bg-primary/10 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
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
                  - Airtable history + Notion shortlists → onglet Activité
                    (timeline) qui les incorpore déjà.
                  En mode sourcing pur (pas de pipelineMeta), comportement
                  inchangé : panels visibles avant les tabs comme avant. */}
              {!pipelineMeta && (
                <>
                  {/* Airtable History Panel */}
                  {(historyPanelLoading || hasHistory) && (
                    <div className="bg-background rounded-lg border border-border overflow-hidden">
                      <CandidateHistoryPanel data={historyData} loading={historyPanelLoading} compact={false} notionShortlists={notionShortlistsForCandidate} />
                    </div>
                  )}

                  {/* Aircall History */}
                  {(aircallHistory.loading || aircallHistory.calls.length > 0) && (
                    <div className="bg-background rounded-lg border border-border overflow-hidden p-3 sm:p-4">
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
                    <div className="bg-background rounded-lg border border-border overflow-hidden">
                      <details className="group">
                        <summary className="flex items-center justify-between p-3 sm:p-4 cursor-pointer select-none list-none [&::-webkit-details-marker]:hidden">
                          <h3 className="text-xs font-semibold text-foreground">À propos</h3>
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
                <div className="flex items-center gap-2 p-3 rounded-lg border border-border bg-background text-sm text-muted-foreground">
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

      {/* Outreach message modal */}
      {selectedJob && (
        <OutreachMessageModal
          open={showMessageModal}
          onOpenChange={setShowMessageModal}
          profile={profile}
          job={selectedJob}
          selectedAccount={accountId}
          calendlyLink={activeProject?.calendly_link}
          candidateHistory={historyData ? {
            shortlists: historyData.shortlists,
            placements: historyData.placements,
            notes: historyData.notes,
            appointments: historyData.appointments,
          } : undefined}
          onMessageSent={async () => {
            try {
              const { data: { user } } = await supabase.auth.getUser();
              const userId = user?.id || '00000000-0000-0000-0000-000000000000';
              const pUrl = profile.profile_url || profile.public_profile_url;
              await supabase.from('job_candidate_status').upsert({
                job_id: selectedJob.id,
                candidate_id: profile.id,
                candidate_name: fullName,
                candidate_headline: profile.headline || null,
                linkedin_profile_url: pUrl || null,
                status: 'messaged',
                created_by: userId,
                project_id: activeProject?.id || null,
              }, { onConflict: 'job_id,candidate_id,created_by' });
            } catch (err) {
              console.error('Error saving messaged status:', err);
            }
            onMessageSent?.();
            onProfileTreated?.();
          }}
        />
      )}
    </>
  );
};

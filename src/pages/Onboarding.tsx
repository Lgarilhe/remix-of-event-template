import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion';
import { toast } from 'sonner';
import { useOrganization, ORG_ALREADY_EXISTS } from '@/hooks/useOrganization';
import { withPreviewAccessToken } from '@/lib/previewToken';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { supabase } from '@/integrations/supabase/client';
import { updateOrganization } from '@/lib/organizationUpdate';
import { InvitationBanner } from '@/components/InvitationBanner';
import { OnboardingShell } from '@/components/onboarding/OnboardingShell';
import { ChapterInterstitial } from '@/components/onboarding/ChapterInterstitial';
import { SceneOrganization } from '@/components/onboarding/SceneOrganization';
import { SceneLinkedIn } from '@/components/onboarding/SceneLinkedIn';
import { SceneOrgType } from '@/components/onboarding/SceneOrgType';
import { SceneOrgDetails, type OrgDetailsData } from '@/components/onboarding/SceneOrgDetails';
import { SceneSpecializations } from '@/components/onboarding/SceneSpecializations';
import { SceneLaunch, type LaunchChecklistItem } from '@/components/onboarding/SceneLaunch';
import {
  FLOWS,
  DEFAULT_FLOW,
  chaptersForFlow,
  chapterIndexOfScene,
  type OrgType,
  type SceneKey,
} from '@/components/onboarding/onboardingMeta';
import {
  loadOnboardingProgress,
  saveOnboardingProgress,
  clearOnboardingProgress,
} from '@/components/onboarding/onboardingStorage';

export interface OnboardingCompanyData {
  /** Id de l'organisation créée (le hook `useOrganization` n'est pas encore rafraîchi à ce moment). */
  orgId: string | null;
  name: string;
  domain: string | null;
  linkedinUrl: string | null;
  careersUrl: string | null;
}

const Onboarding = () => {
  const [restored] = useState(loadOnboardingProgress);

  const [orgType, setOrgType] = useState<OrgType | null>(restored?.orgType ?? null);
  const [step, setStep] = useState(() => {
    if (!restored?.orgType) return 0;
    const flow = FLOWS[restored.orgType];
    // Repli : la progression est reprise sur la scène persistée ; si cette scène
    // n'existe plus (tunnel raccourci), on repart de la première scène.
    const idx = restored.scene ? flow.indexOf(restored.scene) : -1;
    return idx >= 0 ? idx : 0;
  });
  const [direction, setDirection] = useState(1);
  const [orgCreated, setOrgCreated] = useState(false);
  // F3 : verrou anti double clic sur la création silencieuse (flux freelance)
  const orgCreateInFlightRef = useRef(false);
  // Id de l'espace créé dans CE tunnel. `orgCreated` ne convient pas comme
  // garde : il passe à true dès l'entrée pour un collaborateur venu via `?new=1`.
  // Sauvegardé avec la progression : après un rechargement, le réessai reprend
  // cet espace au lieu d'échouer sur « déjà membre » ou d'en créer un second.
  const [createdOrgId, setCreatedOrgId] = useState<string | null>(restored?.createdOrgId ?? null);
  const tunnelStartedRef = useRef(false);
  const [completedScenes, setCompletedScenes] = useState<Set<SceneKey>>(
    () => new Set(restored?.completed ?? [])
  );
  const [orgDetailsData, setOrgDetailsData] = useState<OrgDetailsData | null>(restored?.orgDetails ?? null);
  const [specializations, setSpecializations] = useState<string[]>(restored?.specializations ?? []);

  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const reduceMotion = useReducedMotion();
  const { organization, createOrganization, refetchOrganization, isLoading: isOrgLoading } = useOrganization();
  const { accounts } = useLinkedInAccounts();
  // F3 : `?new=1` = création d'un second espace demandée explicitement
  // (accueil collaborateur dans Auth.tsx). Sans ce flag, un utilisateur qui a
  // déjà un espace est renvoyé au dashboard (voir avant le `return`).
  const isExplicitNewWorkspace = new URLSearchParams(location.search).get('new') === '1';

  const flow = useMemo(() => (orgType ? FLOWS[orgType] : DEFAULT_FLOW), [orgType]);
  const chapters = useMemo(() => chaptersForFlow(flow), [flow]);
  const currentScene = flow[step] ?? 'orgtype';
  const trackableSteps = flow.length - 1;
  const completedInFlow = useMemo(
    () => flow.filter((s) => s !== 'launch' && completedScenes.has(s)).length,
    [flow, completedScenes]
  );
  const scorePercent = Math.round((completedInFlow / Math.max(trackableSteps, 1)) * 100);

  const linkedInConnected = accounts.some(
    (a: any) => a.type !== 'WHATSAPP' && a.provider !== 'WHATSAPP'
  );

  // ─── Interstitiel de chapitre ───
  const [interstitialIdx, setInterstitialIdx] = useState<number | null>(null);
  const prevChapterRef = useRef(chapterIndexOfScene(currentScene, chapters));
  useEffect(() => {
    const idx = chapterIndexOfScene(currentScene, chapters);
    if (idx > 0 && idx !== prevChapterRef.current && direction > 0) {
      setInterstitialIdx(idx);
    }
    prevChapterRef.current = idx;
  }, [currentScene, chapters, direction]);

  // ─── Persistance de la progression ───
  useEffect(() => {
    saveOnboardingProgress({
      step,
      scene: flow[step] ?? null,
      orgType,
      orgDetails: orgDetailsData,
      specializations,
      completed: Array.from(completedScenes),
      createdOrgId,
    });
  }, [step, flow, orgType, orgDetailsData, specializations, completedScenes, createdOrgId]);

  useEffect(() => {
    if (organization && !orgCreated) {
      setOrgCreated(true);
    }
  }, [organization, orgCreated]);

  const markCompleted = useCallback((scene: SceneKey) => {
    setCompletedScenes((prev) => {
      if (prev.has(scene)) return prev;
      const next = new Set(prev);
      next.add(scene);
      return next;
    });
  }, []);

  const goNext = useCallback(() => {
    setDirection(1);
    setStep((s) => Math.min(s + 1, flow.length - 1));
  }, [flow.length]);

  const goBack = useCallback(() => {
    setDirection(-1);
    setStep((s) => Math.max(0, s - 1));
  }, []);

  const completeAndNext = useCallback(
    (scene: SceneKey) => {
      markCompleted(scene);
      goNext();
    },
    [markCompleted, goNext]
  );

  // ─── Handlers ───
  const handleOrgTypeSelected = useCallback(
    (type: OrgType) => {
      setOrgType(type);
      markCompleted('orgtype');
      setDirection(1);
      setStep(1);
    },
    [markCompleted]
  );

  const handleOrgDetailsSubmitted = useCallback(
    (data: OrgDetailsData) => {
      setOrgDetailsData(data);
      completeAndNext('orgdetails');
    },
    [completeAndNext]
  );

  const handleSpecializationsSubmitted = useCallback(
    async (specs: string[]) => {
      if (orgCreateInFlightRef.current) return; // double clic pendant la création
      setSpecializations(specs);
      setDirection(1);

      if (orgType === 'freelance' && orgDetailsData) {
        orgCreateInFlightRef.current = true;
        try {
          // Réessai après un échec d'écriture de l'activité : l'espace existe
          // déjà (créé avec son type), on ne le recrée pas.
          let orgId = createdOrgId;
          if (!orgId) {
            const { data: { user } } = await supabase.auth.getUser();
            const userName = user?.user_metadata?.full_name || user?.email?.split('@')[0] || 'Mon espace';
            const slug = userName.toLowerCase().replace(/[^a-z0-9]/g, '-').replace(/-+/g, '-').slice(0, 30);
            try {
              const org = await createOrganization({
                name: userName,
                slug: `${slug}-${Date.now().toString(36)}`,
                // Type écrit dans l'INSERT : l'espace n'existe jamais sans type
                orgType: 'freelance',
                // F3 : création silencieuse (pas de clic dédié) → autorisée pour un
                // second espace uniquement si demandé explicitement via `?new=1`
                confirmSecond: isExplicitNewWorkspace,
              });
              orgId = org.id;
            } catch (createErr) {
              // Espace déjà créé par ce tunnel sans que l'id soit connu (réponse
              // perdue après l'INSERT, progression sauvegardée avant l'ajout de
              // createdOrgId) : on le reprend s'il a été créé par l'utilisateur et
              // qu'il est de type indépendant, plutôt que de bloquer le tunnel.
              if ((createErr as { code?: string })?.code !== ORG_ALREADY_EXISTS) throw createErr;
              const { data: fresh } = await refetchOrganization();
              const own = fresh?.organization as { id: string; created_by: string; org_type?: string | null } | undefined;
              if (!user || !own || own.created_by !== user.id || own.org_type !== 'freelance') throw createErr;
              orgId = own.id;
            }
            setCreatedOrgId(orgId);
            setOrgCreated(true);
          }
          try {
            await updateOrganization(orgId, {
              team_size: orgDetailsData.teamSize,
              specializations: specs,
              freelance_mode: orgDetailsData.freelanceMode,
              annual_hires: orgDetailsData.annualHires ?? null,
            });
          } catch (detailsErr) {
            // Pas d'avancée sans écriture : l'utilisateur revalide depuis cet écran.
            console.error('[Onboarding] freelance details update failed:', detailsErr);
            toast.error("Votre activité n'a pas pu être enregistrée. Vérifiez votre connexion puis réessayez.");
            return;
          }
        } catch (err) {
          console.error('[Onboarding] Auto-create org failed:', err);
          if ((err as { code?: string })?.code === ORG_ALREADY_EXISTS) {
            // F3 : la mutation ne toaste pas ce cas ; l'utilisateur garde son
            // espace existant et ne poursuit pas un tunnel sans organisation
            toast.error('Vous faites déjà partie d’un espace de travail. Retrouvez-le depuis le tableau de bord.');
          } else if (/duplicate key|organizations_slug_key/.test((err as Error)?.message ?? '')) {
            // onError de la mutation tait ce cas : sans ce toast, le clic ne produirait rien
            toast.error("Votre espace n'a pas pu être créé. Réessayez.");
          }
          // Autre échec : la mutation l'a déjà signalé (onError) ; on reste sur cet écran.
          return;
        } finally {
          orgCreateInFlightRef.current = false;
        }
      }

      markCompleted('specializations');
      setStep((s) => Math.min(s + 1, flow.length - 1));
    },
    [markCompleted, createOrganization, refetchOrganization, createdOrgId, orgType, orgDetailsData, flow.length, isExplicitNewWorkspace]
  );

  const handleOrgCreated = useCallback(
    (data: OnboardingCompanyData) => {
      setOrgCreated(true);
      if (data.orgId) setCreatedOrgId(data.orgId);
      markCompleted('org');
      // org_type est écrit dans l'INSERT (SceneOrganization → createOrganization) :
      // plus d'UPDATE séparé ici, donc plus d'espace sans type.
      goNext();
    },
    [markCompleted, goNext]
  );

  const handleLinkedInNext = useCallback(
    (connected: boolean) => {
      if (connected) markCompleted('linkedin');
      goNext();
    },
    [markCompleted, goNext]
  );

  const handleFinish = useCallback(async () => {
    clearOnboardingProgress();
    await queryClient.invalidateQueries({ queryKey: ['active-organization'] });
    await queryClient.refetchQueries({ queryKey: ['active-organization'] });
    // Une organisation qui vient d'être créée n'a aucune mission : on ouvre
    // directement la création (ProjectsListV2 honore ?create=brief).
    navigate('/missions?create=brief', { replace: true });
  }, [navigate, queryClient]);

  // ─── Récap de lancement ───
  const launchItems = useMemo<LaunchChecklistItem[]>(() => {
    const items: LaunchChecklistItem[] = [
      { key: 'org', label: 'Espace de travail créé', done: orgCreated || !!organization },
    ];
    if (flow.includes('specializations')) {
      items.push({ key: 'activity', label: 'Activité & secteurs renseignés', done: completedScenes.has('specializations') });
    }
    items.push({ key: 'linkedin', label: 'Compte LinkedIn connecté', done: linkedInConnected, settingsPath: '/settings?tab=account' });
    return items;
  }, [orgCreated, organization, completedScenes, flow, linkedInConnected]);

  // ─── Transitions de scène ───
  const variants = reduceMotion
    ? {
        enter: () => ({ opacity: 0 }),
        center: { opacity: 1 },
        exit: () => ({ opacity: 0 }),
      }
    : {
        enter: (dir: number) => ({
          x: dir > 0 ? 90 : -90,
          opacity: 0,
          scale: 0.96,
          filter: 'blur(8px)',
        }),
        center: { x: 0, opacity: 1, scale: 1, filter: 'blur(0px)' },
        exit: (dir: number) => ({
          x: dir > 0 ? -90 : 90,
          opacity: 0,
          scale: 0.96,
          filter: 'blur(8px)',
        }),
      };

  // F3 : un utilisateur qui a déjà un espace et arrive à l'ENTRÉE du tunnel
  // (step 0, pas de progression en cours) sans `?new=1` n'a rien à faire ici →
  // dashboard. `step === 0` est sans effet de bord : toute création d'org dans
  // le tunnel a lieu à un step > 0 (scènes `org` / `specializations`), donc un
  // utilisateur en cours d'onboarding n'est jamais renvoyé.
  // Un utilisateur qui est déjà entré dans le tunnel (step > 0 à un moment,
  // y compris après rechargement avec progression restaurée) et revient au
  // premier écran ne doit pas être éjecté : son org vient peut-être d'être créée.
  useEffect(() => {
    if (step > 0) tunnelStartedRef.current = true;
  }, [step]);
  if (step === 0 && !isExplicitNewWorkspace && !tunnelStartedRef.current) {
    if (isOrgLoading) {
      return (
        <div className="min-h-screen flex items-center justify-center">
          <div className="w-6 h-6 border border-border border-t-foreground rounded-full animate-spin" />
        </div>
      );
    }
    if (organization) {
      return <Navigate to={withPreviewAccessToken('/dashboard')} replace />;
    }
  }

  return (
    <OnboardingShell
      flow={flow}
      stepIndex={step}
      chapters={chapters}
      completedScenes={completedScenes}
      orgName={organization?.name}
    >
      <div className="w-full max-w-lg mx-auto mb-4 empty:mb-0">
        <InvitationBanner />
      </div>

      <div className="w-full relative" style={{ minHeight: 340 }}>
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={step}
            custom={direction}
            variants={variants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
            className="w-full"
          >
            {currentScene === 'orgtype' && (
              <SceneOrgType onSelect={handleOrgTypeSelected} onBack={() => {}} />
            )}
            {currentScene === 'orgdetails' && orgType && (
              <SceneOrgDetails orgType={orgType} onSubmit={handleOrgDetailsSubmitted} onBack={goBack} />
            )}
            {currentScene === 'specializations' && (
              <SceneSpecializations
                onSubmit={handleSpecializationsSubmitted}
                onBack={goBack}
                savedSpecializations={specializations}
              />
            )}
            {currentScene === 'org' && orgType && (
              <SceneOrganization orgType={orgType} onComplete={handleOrgCreated} onBack={goBack} allowSecondWorkspace={isExplicitNewWorkspace} />
            )}
            {/* Pas de retour : la scène précédente crée l'espace de travail */}
            {currentScene === 'linkedin' && (
              <SceneLinkedIn onNext={handleLinkedInNext} />
            )}
            {currentScene === 'launch' && (
              <SceneLaunch
                items={launchItems}
                scorePercent={scorePercent}
                orgName={organization?.name}
                onFinish={handleFinish}
              />
            )}
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Interstitiel de chapitre */}
      <AnimatePresence>
        {interstitialIdx !== null && chapters[interstitialIdx] && (
          <ChapterInterstitial
            chapter={chapters[interstitialIdx]}
            chapterIndex={interstitialIdx}
            totalChapters={chapters.length}
            onDismiss={() => setInterstitialIdx(null)}
          />
        )}
      </AnimatePresence>
    </OnboardingShell>
  );
};

export default Onboarding;

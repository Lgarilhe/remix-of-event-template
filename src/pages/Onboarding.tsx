import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { AnimatePresence, motion } from 'framer-motion';
import { toast } from 'sonner';
import { useOrganization } from '@/hooks/useOrganization';
import { useAuthReady } from '@/hooks/useAuthReady';
import { useLinkedInAccounts } from '@/contexts/LinkedInAccountsContext';
import { useCompanyLookup } from '@/hooks/onboarding/useCompanyLookup';
import type { PreviewResults } from '@/hooks/onboarding/useFirstSearch';
import { updateOrganization } from '@/lib/organizationUpdate';
import { withPreviewAccessToken } from '@/lib/previewToken';
import { companyContext } from '@/lib/onboarding/company';
import type { BriefDraft } from '@/lib/onboarding/brief';
import { connectedAccounts } from '@/lib/onboarding/linkedin';
import { createFirstMission, type ProcessKey } from '@/lib/onboarding/mission';
import { guessFirstName, normalizeFirstName } from '@/lib/onboarding/names';
import type { WritingTone } from '@/lib/onboarding/outreach';
import { saveFirstName, saveWritingTone } from '@/lib/onboarding/profile';
import { InvitationBanner } from '@/components/InvitationBanner';
import { Spinner } from '@/components/ui/spinner';
import { Stage } from '@/components/onboarding/stage/Stage';
import { Desk, type DeskKey, type DeskState } from '@/components/onboarding/stage/Desk';
import { SceneHello } from '@/components/onboarding/scenes/SceneHello';
import { SceneProfile } from '@/components/onboarding/scenes/SceneProfile';
import { SceneStructure } from '@/components/onboarding/scenes/SceneStructure';
import { SceneRole } from '@/components/onboarding/scenes/SceneRole';
import { SceneBrief } from '@/components/onboarding/scenes/SceneBrief';
import { SceneLinkedIn } from '@/components/onboarding/scenes/SceneLinkedIn';
import { SceneCandidates } from '@/components/onboarding/scenes/SceneCandidates';
import { SceneMessage } from '@/components/onboarding/scenes/SceneMessage';
import { SceneFinale, type FinaleStat } from '@/components/onboarding/scenes/SceneFinale';
import {
  ACTS,
  ORG_TYPE_LABEL,
  actIndexOf,
  buildFlow,
  progressOf,
  remainingMinutes,
  type OrgType,
  type SceneKey,
} from '@/components/onboarding/onboardingMeta';
import {
  clearOnboardingProgress,
  loadOnboardingProgress,
  saveOnboardingProgress,
  type PersistedProgress,
} from '@/components/onboarding/onboardingStorage';

/** Ordre de référence des scènes : le bureau s'éveille objet par objet dans cet ordre, quel que soit le parcours suivi. */
const ORDER: SceneKey[] = ['hello', 'profile', 'structure', 'role', 'brief', 'linkedin', 'candidates', 'message', 'finale'];
const reached = (scene: SceneKey, at: SceneKey) => ORDER.indexOf(scene) >= ORDER.indexOf(at);

const TRAIL = ACTS.map((a) => ({ key: a.id, label: a.label }));

const Onboarding = () => {
  const [restored] = useState(loadOnboardingProgress);
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const { organization, isLoading: isOrgLoading } = useOrganization();
  const { user } = useAuthReady();
  const { accounts, ready: accountsReady } = useLinkedInAccounts();

  // `?new=1` : création d'un second espace demandée explicitement (accueil collaborateur, Auth.tsx).
  const isExplicitNewWorkspace = new URLSearchParams(location.search).get('new') === '1';
  // `?li=ok|ko` : retour du formulaire de connexion LinkedIn. Lu une fois, puis retiré de l'adresse.
  const [returning] = useState<'ok' | 'ko' | null>(() => {
    const value = new URLSearchParams(location.search).get('li');
    return value === 'ok' || value === 'ko' ? value : null;
  });

  // ─── État du parcours ───
  const [scene, setScene] = useState<SceneKey>(() => (returning ? 'linkedin' : restored?.scene ?? 'hello'));
  const [completed, setCompleted] = useState<Set<SceneKey>>(() => new Set(restored?.completed ?? []));
  const [firstName, setFirstName] = useState(restored?.firstName ?? '');
  const [orgType, setOrgType] = useState<OrgType | null>(restored?.orgType ?? null);
  const [orgName, setOrgName] = useState(restored?.orgName ?? '');
  const [createdOrgId, setCreatedOrgId] = useState<string | null>(restored?.createdOrgId ?? null);
  const [jobTitle, setJobTitle] = useState(restored?.jobTitle ?? '');
  const [clientName, setClientName] = useState(restored?.clientName ?? '');
  const [missionId, setMissionId] = useState<string | null>(restored?.missionId ?? null);
  const [linkedinSkipped, setLinkedinSkipped] = useState(restored?.linkedinSkipped ?? false);
  const [tone, setTone] = useState<WritingTone | null>(restored?.tone ?? null);

  // Ce qui vit le temps du parcours : le brief est gardé avec la progression, le reste se refait au besoin
  const [brief, setBrief] = useState<BriefDraft | null>(restored?.brief ?? null);
  const [processKey, setProcessKey] = useState<ProcessKey>('standard');
  const [creatingMission, setCreatingMission] = useState(false);
  const [preview, setPreview] = useState<PreviewResults | null>(null);
  const [savingHello, setSavingHello] = useState(false);
  const [profilePreview, setProfilePreview] = useState<OrgType | null>(null);
  const [briefPhase, setBriefPhase] = useState<'loading' | 'ready' | 'failed'>('loading');
  const [plug, setPlug] = useState<'none' | 'connecting' | 'connected'>('none');
  const [scanning, setScanning] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);

  const lookup = useCompanyLookup();
  const flow = useMemo(() => buildFlow({ linkedinSkipped }), [linkedinSkipped]);
  const sceneRef = useRef<HTMLDivElement>(null);
  const account = useMemo(() => connectedAccounts(accounts)[0] ?? null, [accounts]);

  // Départ dans le tunnel : un utilisateur qui a déjà un espace et arrive à l'accueil, sans reprise, n'a rien à faire ici.
  const tunnelStartedRef = useRef(scene !== 'hello' || !!returning);
  useEffect(() => {
    if (scene !== 'hello') tunnelStartedRef.current = true;
  }, [scene]);

  // Le focus suit la scène : un champ qui prend le focus de lui-même le garde, sinon la scène le reçoit
  // (clavier et lecteur d'écran repartent de son titre, pas du bouton de la scène précédente).
  useEffect(() => {
    const frame = requestAnimationFrame(() => {
      const el = sceneRef.current;
      if (el && !el.contains(document.activeElement)) el.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [scene]);

  // Adresse propre après la lecture du retour de LinkedIn
  useEffect(() => {
    if (returning) navigate({ pathname: location.pathname }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Prénom proposé : celui du compte s'il existe, sinon le début de l'adresse e-mail quand elle en porte un
  useEffect(() => {
    if (firstName || !user) return;
    const guess = guessFirstName({ metadata: user.user_metadata, email: user.email });
    if (guess) setFirstName(guess);
  }, [user, firstName]);

  // ─── Persistance ───
  const progress: PersistedProgress = {
    scene,
    completed: Array.from(completed),
    firstName,
    orgType,
    orgName,
    createdOrgId,
    jobTitle,
    clientName,
    missionId,
    linkedinSkipped,
    tone,
    brief,
  };
  const progressRef = useRef(progress);
  progressRef.current = progress;
  useEffect(() => {
    saveOnboardingProgress(progressRef.current);
  }, [scene, completed, firstName, orgType, orgName, createdOrgId, jobTitle, clientName, missionId, linkedinSkipped, tone, brief]);

  // ─── Navigation ───
  const markCompleted = useCallback((key: SceneKey) => {
    setCompleted((prev) => (prev.has(key) ? prev : new Set(prev).add(key)));
  }, []);

  const goNext = useCallback(
    (from: SceneKey) => {
      const i = flow.indexOf(from);
      setScene(flow[Math.min(i + 1, flow.length - 1)] ?? 'finale');
    },
    [flow],
  );

  const goBack = useCallback(() => {
    const i = flow.indexOf(scene);
    if (i > 0) setScene(flow[i - 1]);
  }, [flow, scene]);

  // Reprises après rechargement : ce qui n'a pas survécu (aperçu, brief) renvoie à la scène qui le refait.
  useEffect(() => {
    if (scene === 'brief' && missionId && !brief) setScene('linkedin');
  }, [scene, missionId, brief]);
  useEffect(() => {
    if ((scene === 'candidates' || scene === 'message') && accountsReady && !account) setScene('linkedin');
  }, [scene, accountsReady, account]);
  useEffect(() => {
    if ((scene === 'candidates' || scene === 'message') && !missionId) setScene('role');
  }, [scene, missionId]);
  useEffect(() => {
    if (scene === 'message' && !(preview && preview.candidates.length > 0)) setScene('candidates');
  }, [scene, preview]);
  useEffect(() => {
    if (scene !== 'hello' && scene !== 'profile' && !orgType) setScene('profile');
  }, [scene, orgType]);

  // ─── Fiche société en arrière-plan ───
  const isEnterprise = orgType === 'enterprise';
  const lookupClient = isEnterprise ? orgName : clientName;
  const lastLookupRef = useRef<string>('');
  const { start: lookupStart } = lookup;
  const startLookup = useCallback(
    (name: string, selectedId?: string) => {
      const clean = name.trim();
      if (clean.length < 2) return;
      lastLookupRef.current = clean.toLowerCase();
      void lookupStart(clean, selectedId);
    },
    [lookupStart],
  );

  // Arrivée sur le poste après un rechargement : la fiche repart (le cache serveur la rend en moins d'une seconde).
  useEffect(() => {
    if (scene !== 'role' || lookup.state.status !== 'idle') return;
    if (lookupClient.trim().length >= 2 && lastLookupRef.current === '') startLookup(lookupClient);
  }, [scene, lookup.state.status, lookupClient, startLookup]);

  const company = lookup.state.status === 'ready' ? lookup.state.company : null;

  // Le logo trouvé pour l'entreprise devient celui de l'espace (jamais un logo deviné)
  const logoSyncedRef = useRef(false);
  useEffect(() => {
    if (!isEnterprise || !createdOrgId || !company || logoSyncedRef.current) return;
    if (!company.logoUrl && !company.websiteUrl) return;
    logoSyncedRef.current = true;
    updateOrganization(createdOrgId, {
      ...(company.logoUrl ? { logo_url: company.logoUrl } : {}),
      ...(company.websiteUrl ? { website: company.websiteUrl } : {}),
    }).catch((e) => console.warn('[onboarding] logo non enregistré :', e));
  }, [isEnterprise, createdOrgId, company]);

  // ─── Handlers de scènes ───
  const handleHello = useCallback(async () => {
    const name = normalizeFirstName(firstName);
    if (name.length < 2 || savingHello) return;
    setSavingHello(true);
    setFirstName(name);
    try {
      if (user) await saveFirstName(user.id, name);
    } catch (e) {
      // Non bloquant : le prénom reste dans le parcours, il sera réécrit à la prochaine occasion.
      console.warn('[onboarding] prénom non enregistré :', e);
    } finally {
      setSavingHello(false);
    }
    markCompleted('hello');
    goNext('hello');
  }, [firstName, savingHello, user, markCompleted, goNext]);

  const handleProfile = useCallback(
    (type: OrgType) => {
      setOrgType(type);
      markCompleted('profile');
      goNext('profile');
    },
    [markCompleted, goNext],
  );

  const handleStructureCreated = useCallback(
    ({ orgId, name }: { orgId: string; name: string }) => {
      setCreatedOrgId(orgId);
      setOrgName(name);
      markCompleted('structure');
      if (orgType === 'enterprise') startLookup(name);
      goNext('structure');
    },
    [orgType, markCompleted, goNext, startLookup],
  );

  const handleClientCommit = useCallback(
    (client: string) => {
      const clean = client.trim();
      if (clean.length >= 2 && clean.toLowerCase() !== lastLookupRef.current) startLookup(clean);
    },
    [startLookup],
  );

  const handleRoleSubmit = useCallback(() => {
    if (jobTitle.trim().length < 3) return;
    markCompleted('role');
    // Nouveau poste : l'ancien brief ne vaut plus (tant que la mission n'est pas créée).
    if (brief && brief.title !== jobTitle.trim() && !missionId) setBrief(null);
    goNext('role');
  }, [jobTitle, brief, missionId, markCompleted, goNext]);

  const missionClient = isEnterprise ? orgName.trim() : clientName.trim() || null;
  const briefRequest = useMemo(
    () => ({ title: jobTitle.trim(), client: missionClient, sector: company?.industry ?? null, context: companyContext(company) }),
    [jobTitle, missionClient, company],
  );

  const handleCreateMission = useCallback(async () => {
    const orgId = createdOrgId ?? organization?.id ?? null;
    if (!brief || !orgId || !user || creatingMission) return;
    setCreatingMission(true);
    try {
      const created = await createFirstMission({
        orgId,
        userId: user.id,
        draft: brief,
        processKey,
        context: {
          client: missionClient,
          sector: company?.industry ?? null,
          website: company?.websiteUrl ?? null,
          logoUrl: company?.logoUrl ?? null,
          briefText: [briefRequest.title, missionClient ? `chez ${missionClient}` : '', briefRequest.context].filter(Boolean).join(' '),
        },
      });
      setMissionId(created.id);
      void queryClient.invalidateQueries({ queryKey: ['sourcing-projects'] });
      void queryClient.invalidateQueries({ queryKey: ['sidebar'] });
      if (!created.processApplied) toast.info("Les étapes d'entretien n'ont pas pu être posées : vous les choisirez depuis l'onglet Process de la mission.");
      markCompleted('brief');
      goNext('brief');
    } catch (e) {
      console.error('[onboarding] mission non créée :', e);
      toast.error("La mission n'a pas pu être créée. Vérifiez votre connexion puis réessayez.");
    } finally {
      setCreatingMission(false);
    }
  }, [brief, createdOrgId, organization?.id, user, creatingMission, processKey, missionClient, company, briefRequest, queryClient, markCompleted, goNext]);

  const handleLinkedInContinue = useCallback(() => {
    markCompleted('linkedin');
    goNext('linkedin');
  }, [markCompleted, goNext]);

  const handleLinkedInSkip = useCallback(() => {
    setLinkedinSkipped(true);
    setScene('finale');
  }, []);

  const handleCandidatesWrite = useCallback(() => {
    markCompleted('candidates');
    goNext('candidates');
  }, [markCompleted, goNext]);

  const handleCandidatesSkip = useCallback(() => {
    markCompleted('candidates');
    setScene('finale');
  }, [markCompleted]);

  const handleMessageDone = useCallback(
    async (chosen: WritingTone | null) => {
      if (chosen && user) {
        setTone(chosen);
        try {
          await saveWritingTone(user.id, chosen);
        } catch (e) {
          console.warn('[onboarding] ton non enregistré :', e);
          toast.error("Votre ton d'écriture n'a pas pu être enregistré. Vous pourrez le régler dans les Paramètres.");
        }
      }
      markCompleted('message');
      goNext('message');
    },
    [user, markCompleted, goNext],
  );

  const handleFinish = useCallback(
    async (destination: 'mission' | 'dashboard') => {
      const target = destination === 'mission' ? (missionId ? `/missions/${missionId}?tab=sourcing` : '/missions?create=brief') : '/dashboard';
      clearOnboardingProgress();
      await queryClient.invalidateQueries({ queryKey: ['active-organization'] });
      await queryClient.refetchQueries({ queryKey: ['active-organization'] });
      navigate(target, { replace: true });
    },
    [missionId, navigate, queryClient],
  );

  // ─── Le bureau ───
  const desk = useMemo(() => {
    const state = (at: SceneKey): DeskState => (reached(scene, at) ? 'ready' : 'idle');
    const states: Record<DeskKey, DeskState> = {
      card: 'ready',
      cup: 'ready',
      folder: state('structure'),
      clipboard: state('role'),
      plug: state('linkedin'),
      search: linkedinSkipped ? 'idle' : state('candidates'),
      plane: linkedinSkipped ? 'idle' : state('message'),
    };
    const focusByScene: Record<SceneKey, DeskKey | null> = {
      hello: 'card',
      profile: 'card',
      structure: 'folder',
      role: 'clipboard',
      brief: briefPhase === 'loading' ? 'cup' : 'clipboard',
      linkedin: 'plug',
      candidates: 'search',
      message: 'plane',
      finale: null,
    };
    const visibleType = scene === 'profile' ? profilePreview ?? orgType : orgType;
    return (
      <Desk
        states={states}
        focus={focusByScene[scene]}
        data={{
          firstName: firstName.trim(),
          profileLabel: visibleType ? ORG_TYPE_LABEL[visibleType] : '',
          orgName: orgName.trim(),
          logoUrl: isEnterprise ? company?.logoUrl ?? null : null,
          jobTitle: jobTitle.trim(),
          skills: brief?.skills,
          linkedIn: plug,
          candidates: (preview?.candidates ?? []).slice(0, 3).map((c) => ({ photo: c.photo, initials: c.initials })),
          scanning,
          messageReady: hasDraft,
          stamped: scene === 'finale',
        }}
      />
    );
  }, [scene, linkedinSkipped, briefPhase, profilePreview, orgType, firstName, orgName, isEnterprise, company, jobTitle, brief, plug, preview, scanning, hasDraft]);

  // ─── Garde d'entrée : un utilisateur qui a déjà un espace n'a rien à faire à l'accueil ───
  if (scene === 'hello' && !isExplicitNewWorkspace && !tunnelStartedRef.current) {
    if (isOrgLoading) {
      return (
        <div className="flex min-h-screen items-center justify-center bg-background">
          <Spinner size="lg" label="Chargement de votre espace" />
        </div>
      );
    }
    if (organization) return <Navigate to={withPreviewAccessToken('/dashboard')} replace />;
  }

  const topCandidate = (() => {
    if (!preview || preview.candidates.length === 0) return null;
    if (preview.scoring !== 'done') return preview.candidates[0];
    return [...preview.candidates].sort((a, b) => (preview.scores[b.id]?.score ?? -1) - (preview.scores[a.id]?.score ?? -1))[0];
  })();

  const finaleStats: FinaleStat[] = [];
  if (missionId) finaleStats.push({ key: 'mission', value: 1, label: 'mission créée' });
  if (brief && brief.skills.length > 0) finaleStats.push({ key: 'skills', value: brief.skills.length, label: 'compétences au brief' });
  if (preview && preview.candidates.length > 0) finaleStats.push({ key: 'profiles', value: preview.total ?? preview.candidates.length, label: 'profils trouvés sur LinkedIn' });
  if (account) finaleStats.push({ key: 'linkedin', value: null, check: true, label: 'LinkedIn connecté' });

  const orgReady = !!(createdOrgId || organization);

  return (
    <Stage
      steps={TRAIL}
      activeIndex={actIndexOf(scene)}
      progress={scene === 'finale' ? 100 : progressOf(flow, scene)}
      desk={desk}
      onLeave={orgReady && scene !== 'finale' ? () => void handleFinish('dashboard') : undefined}
    >
      {(scene === 'hello' || scene === 'profile' || scene === 'structure') && (
        <div className="empty:hidden">
          <InvitationBanner />
        </div>
      )}
      <AnimatePresence mode="wait">
        <motion.div key={scene} ref={sceneRef} tabIndex={-1} className="outline-none" exit={{ opacity: 0, x: -28 }} transition={{ duration: 0.18, ease: 'easeIn' }}>
          {scene === 'hello' && (
            <SceneHello minutes={remainingMinutes(flow, 'hello')} value={firstName} onChange={setFirstName} onSubmit={() => void handleHello()} saving={savingHello} />
          )}
          {scene === 'profile' && <SceneProfile initial={orgType} onPreview={setProfilePreview} onSelect={handleProfile} />}
          {scene === 'structure' && orgType && (
            <SceneStructure
              orgType={orgType}
              value={orgName}
              onChange={setOrgName}
              createdOrgId={createdOrgId}
              allowSecondWorkspace={isExplicitNewWorkspace}
              onCreated={handleStructureCreated}
              onBack={goBack}
            />
          )}
          {scene === 'role' && orgType && (
            <SceneRole
              orgType={orgType}
              companyName={lookupClient}
              title={jobTitle}
              onTitleChange={setJobTitle}
              client={clientName}
              onClientChange={setClientName}
              onClientCommit={handleClientCommit}
              lookup={lookup.state}
              onPickCandidate={(id) => startLookup(lookupClient, id)}
              onNoCandidate={() => startLookup(lookupClient, '__none__')}
              onRetryLookup={() => startLookup(lookupClient)}
              onSubmit={handleRoleSubmit}
              onBack={goBack}
              locked={!!missionId}
            />
          )}
          {scene === 'brief' && (
            <SceneBrief
              request={briefRequest}
              draft={brief}
              onDraft={setBrief}
              processKey={processKey}
              onProcessKey={setProcessKey}
              locked={!!missionId}
              creating={creatingMission}
              onCreate={() => void handleCreateMission()}
              onContinue={() => goNext('brief')}
              onBack={goBack}
              onPhase={setBriefPhase}
            />
          )}
          {scene === 'linkedin' && (
            <SceneLinkedIn
              orgName={orgName || organization?.name || null}
              returning={returning}
              onLeave={() => saveOnboardingProgress(progressRef.current)}
              onContinue={handleLinkedInContinue}
              onSkip={handleLinkedInSkip}
              onBack={goBack}
              onState={setPlug}
            />
          )}
          {scene === 'candidates' && missionId && account && (
            <SceneCandidates
              missionId={missionId}
              account={account}
              results={preview}
              onResults={setPreview}
              onWriteFirst={handleCandidatesWrite}
              onSkip={handleCandidatesSkip}
              onBack={goBack}
              onScanning={setScanning}
            />
          )}
          {scene === 'message' && missionId && topCandidate && brief && (
            <SceneMessage
              candidate={topCandidate}
              missionId={missionId}
              jobTitle={brief.title}
              client={missionClient ? { name: missionClient, sector: company?.industry ?? '' } : null}
              skills={brief.skills}
              description={briefRequest.context || brief.rationale || ''}
              location={brief.location || null}
              senderName={firstName}
              tone={tone}
              onTone={setTone}
              onDone={(chosen) => void handleMessageDone(chosen)}
              onBack={goBack}
              onDraft={setHasDraft}
            />
          )}
          {scene === 'finale' && (
            <SceneFinale
              firstName={firstName}
              jobTitle={brief?.title ?? jobTitle}
              missionReady={!!missionId}
              linkedInConnected={!!account}
              stats={finaleStats}
              onOpenMission={() => void handleFinish('mission')}
              onDashboard={() => void handleFinish('dashboard')}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </Stage>
  );
};

export default Onboarding;

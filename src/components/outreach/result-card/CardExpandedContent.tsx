import React, { useCallback, useEffect, useRef, useState } from 'react';
import { LinkedInProfile } from '../types';
import { JobMatchResult } from '../JobScoreDisplay';
import { Job } from '@/types/jobs';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import {
  Briefcase, GraduationCap, Zap, ThumbsUp,
  MessageSquare, Newspaper, Loader2,
} from 'lucide-react';
import { CardMessageThread } from './CardMessageThread';
import { ProfileData } from './types';
import { invokeUnipile } from '@/lib/invokeUnipile';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';

/**
 * Tab supplémentaire injecté après les tabs standard. Permet aux
 * surfaces qui réutilisent ProfileDetailSheet (ex: pipeline) d'ajouter
 * leurs onglets spécifiques sans modifier ce composant.
 */
export interface ExpandedContentExtraTab {
  key: string;
  label: string;
  shortLabel?: string;
  icon: React.ComponentType<{ className?: string }>;
  content: React.ReactNode;
  count?: number;
}

interface CardExpandedContentProps {
  profile: LinkedInProfile;
  profileData: ProfileData;
  selectedJob?: Job | null;
  jobScore?: JobMatchResult;
  accountId?: string;
  /** Mission des envois du fil de messages (uuid), passée à CardMessageThread. */
  projectId?: string;
  candidateStatus?: { status: string; score?: number | null; recommendation?: string | null; updated_at?: string } | null;
  airtableMatch?: any;
  historyData?: any;
  historyLoading?: boolean;
  onClose: () => void;
  onOpenMessage: () => void;
  onMessageSent?: () => void;
  onProfileTreated?: () => void;
  /** Tabs supplémentaires injectés (en premier en pipeline mode, en dernier en sourcing). */
  extraTabs?: ExpandedContentExtraTab[];
  /** Si true, masque les tabs standard (Expérience/Formation/Skills/Messages/Posts).
   *  Utilisé en mode pipeline où ces infos sont reformulées dans extraTabs
   *  (Profil = Exp+Form+Skills, Messages = LinkedIn DMs) pour réduire le
   *  bruit de 13 onglets → 8 onglets pertinents. Default false (sourcing). */
  hideStandardTabs?: boolean;
  /** Tab à activer par défaut à l'ouverture (clé d'un extraTab ou tab standard). */
  initialTab?: string;
  /** Masque l'onglet Posts (pas encore branché) : la nouvelle page mission le retire. */
  hidePosts?: boolean;
  /** Onglet imposé par le parent (la note de l'en-tête ouvre Évaluation) ; absent, `initialTab` puis le choix de l'utilisateur. */
  activeTab?: string;
  /** Appelé à chaque changement d'onglet, par un clic ou au clavier. */
  onActiveTabChange?: (tab: string) => void;
}

/** Un onglet de la barre : texte seul, soulignement de la couleur de marque pour l'onglet ouvert. */
const TAB_TRIGGER_CLASS =
  'relative h-10 shrink-0 gap-1.5 rounded-none px-2 text-sm font-normal text-muted-foreground shadow-none transition-colors duration-150 after:absolute after:inset-x-2 after:bottom-0 after:h-0.5 after:rounded-full after:bg-transparent hover:text-foreground focus-visible:ring-inset focus-visible:ring-offset-0 data-[state=active]:bg-transparent data-[state=active]:font-medium data-[state=active]:text-foreground data-[state=active]:shadow-none data-[state=active]:ring-0 data-[state=active]:after:bg-brand';

/** Marge, en px, laissée à gauche ou à droite quand l'onglet ouvert est ramené dans la barre. */
const TAB_SCROLL_MARGIN = 24;

const getTenureLabel = (start?: { year?: number; month?: number }, end?: { year?: number; month?: number }) => {
  if (!start?.year) return null;
  const s = new Date(start.year, (start.month || 1) - 1);
  const e = end?.year ? new Date(end.year, (end.month || 12) - 1) : new Date();
  const diff = (e.getFullYear() - s.getFullYear()) * 12 + (e.getMonth() - s.getMonth());
  const y = Math.floor(diff / 12);
  const m = diff % 12;
  if (y > 0 && m > 0) return `${y} an${y > 1 ? 's' : ''} ${m} mois`;
  if (y > 0) return `${y} an${y > 1 ? 's' : ''}`;
  if (m > 0) return `${m} mois`;
  return null;
};

export const CardExpandedContent: React.FC<CardExpandedContentProps> = ({
  profile,
  profileData,
  accountId,
  projectId,
  onOpenMessage,
  onMessageSent,
  onProfileTreated,
  extraTabs,
  hideStandardTabs,
  initialTab,
  hidePosts = false,
  activeTab,
  onActiveTabChange,
}) => {
  const { education, skills, fullName } = profileData;
  const workExperience = profile.work_experience || [];

  // Si extraTabs présents (pipeline mode), on default sur le premier
  // extraTab — typiquement plus utile à voir en premier que l'XP brute
  // (ex: l'user vient de cliquer sur un candidat pour voir son scoring).
  // Sauf si initialTab explicite (ex: deep-link "?tab=evaluation").
  const fallbackTab = extraTabs && extraTabs.length > 0 ? extraTabs[0].key : 'experience';
  const defaultTab = initialTab || fallbackTab;

  // L'onglet est toujours tenu ici ; le parent peut le forcer (`activeTab`) et le suivre.
  const [chosenTab, setChosenTab] = useState(defaultTab);
  const tab = activeTab ?? chosenTab;
  const changeTab = (next: string) => {
    setChosenTab(next);
    onActiveTabChange?.(next);
  };

  // Barre d'onglets : sans barre de défilement visible. Un fondu marque le côté
  // où d'autres onglets attendent, et l'onglet ouvert est ramené dans la vue.
  const barRef = useRef<HTMLDivElement>(null);
  const [edges, setEdges] = useState({ start: false, end: false });
  const syncEdges = useCallback(() => {
    const bar = barRef.current;
    if (!bar) return;
    const next = {
      start: bar.scrollLeft > 4,
      end: bar.scrollLeft + bar.clientWidth < bar.scrollWidth - 4,
    };
    setEdges((prev) => (prev.start === next.start && prev.end === next.end ? prev : next));
  }, []);
  useEffect(() => {
    const bar = barRef.current;
    if (!bar) return;
    syncEdges();
    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(syncEdges);
    observer.observe(bar);
    return () => observer.disconnect();
  }, [syncEdges, extraTabs?.length]);
  useEffect(() => {
    const bar = barRef.current;
    const active = bar?.querySelector<HTMLElement>('[data-state="active"]');
    if (!bar || !active) return;
    const left = active.offsetLeft;
    const right = left + active.offsetWidth;
    if (left < bar.scrollLeft) bar.scrollLeft = Math.max(0, left - TAB_SCROLL_MARGIN);
    else if (right > bar.scrollLeft + bar.clientWidth) bar.scrollLeft = right - bar.clientWidth + TAB_SCROLL_MARGIN;
  }, [tab]);
  const fade = (stop: string) => `linear-gradient(to right, ${stop})`;
  const barMask = edges.start || edges.end
    ? fade(`${edges.start ? 'transparent' : 'black'} 0, black 28px, black calc(100% - 28px), ${edges.end ? 'transparent' : 'black'} 100%`)
    : undefined;

  // 🔧 Ordre des tabs (fix 2026-05-06) :
  // Si extraTabs présents (pipeline mode) → ils sont rendus EN PREMIER,
  // les onglets standards (Experience/Education/Skills/Messages/Posts)
  // viennent ensuite. Comme ça :
  //   - L'onglet "Aperçu" est visuellement en position 1 → cohérent
  //     avec le defaultValue qui pointe sur lui
  //   - Les onglets pipeline (Aperçu, Évaluation, CV, Séquences, etc.)
  //     sont mis en avant car c'est ce que l'user pipeline veut voir
  //   - Les tabs sourcing (XP/Form/Skills/Msg/Posts) restent dispos
  //     mais en deuxième vague — secondaires en mode pipeline
  // Si pas d'extraTabs (mode sourcing pur) → ordre inchangé : tabs
  // standards en 1er comme avant.
  const standardTabs = [
    { value: 'experience', icon: Briefcase, label: 'Expérience', shortLabel: 'Exp.' },
    { value: 'education', icon: GraduationCap, label: 'Formation', shortLabel: 'Form.' },
    { value: 'skills', icon: Zap, label: 'Compétences', shortLabel: 'Skills' },
    { value: 'messages', icon: MessageSquare, label: 'Messages', shortLabel: 'Msg' },
    { value: 'posts', icon: Newspaper, label: 'Posts', shortLabel: 'Posts' },
  ].filter((tab) => !(hidePosts && tab.value === 'posts'));

  return (
    <div className="overflow-hidden">
      <Tabs value={tab} onValueChange={changeTab} className="w-full">
        <div className={cn('border-b border-border', !extraTabs?.length && 'border-t')}>
          <div
            ref={barRef}
            onScroll={syncEdges}
            className="no-scrollbar relative overflow-x-auto"
            style={{ maskImage: barMask, WebkitMaskImage: barMask }}
          >
            <TabsList className="h-10 w-max min-w-full justify-start gap-0 rounded-none bg-transparent p-0">
              {/* Extra tabs (pipeline mode) — rendus EN PREMIER pour
                  que l'onglet par défaut (premier extraTab = "Aperçu")
                  soit aussi visuellement en position 1. */}
              {extraTabs?.map(extra => (
                <TabsTrigger key={extra.key} value={extra.key} className={TAB_TRIGGER_CLASS}>
                  {extra.label}
                  {extra.count != null && extra.count > 0 && (
                    <span className="text-xs tabular-nums text-muted-foreground">{extra.count}</span>
                  )}
                </TabsTrigger>
              ))}
              {/* Onglets standards LinkedIn — masqués en mode pipeline
                  (les infos sont reformulées dans extraTabs : Profil =
                  Exp+Form+Skills, Messages = LinkedIn DMs). */}
              {!hideStandardTabs && standardTabs.map(standard => (
                <TabsTrigger key={standard.value} value={standard.value} className={TAB_TRIGGER_CLASS}>
                  {standard.label}
                </TabsTrigger>
              ))}
            </TabsList>
          </div>
        </div>

        {/* Contenus des onglets standards : absents en mode pipeline. Sinon le contenu
            « Messages » standard s'affiche en double de celui de l'onglet Messages
            du pipeline (même valeur d'onglet). */}
        {!hideStandardTabs && (
        <>
        {/* Experience Tab : une ligne par poste, séparées par des filets (docs/design/06-simplicite.md, règle 3) */}
        <TabsContent value="experience" className="mt-0 px-0 py-2">
          {workExperience.length > 0 ? (
            <ul className="divide-y divide-border">
              {workExperience.map((exp: any, index: number) => {
                const isCurrent = !exp.end;
                const tenure = getTenureLabel(exp.start, exp.end);
                return (
                  <li key={index} className="flex items-start gap-3 py-4 first:pt-2">
                    {exp.logo ? (
                      <img
                        src={exp.logo}
                        alt={exp.company || ''}
                        className="mt-0.5 h-10 w-10 shrink-0 rounded-lg border border-border bg-background object-contain p-0.5"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling && ((e.target as HTMLImageElement).nextElementSibling as HTMLElement).classList.remove('hidden'); }}
                      />
                    ) : null}
                    <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground ${exp.logo ? 'hidden' : ''}`}>
                      <Briefcase className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-md font-semibold leading-tight text-foreground">{exp.role}</p>
                        {isCurrent && (
                          <span className="shrink-0 rounded-md bg-muted px-1.5 py-0.5 text-xs text-foreground-secondary">
                            En poste
                          </span>
                        )}
                      </div>
                      {exp.company && <p className="mt-0.5 text-sm text-foreground-secondary">{exp.company}</p>}
                      {(exp.start?.year || exp.end?.year) && (
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {exp.start?.year || '?'} → {exp.end?.year || 'Présent'}
                          {tenure && <span> · {tenure}</span>}
                        </p>
                      )}
                      {exp.description && (
                        <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-foreground-secondary">{exp.description}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={Briefcase} text="Aucune expérience disponible" />
          )}
        </TabsContent>

        {/* Education Tab */}
        <TabsContent value="education" className="mt-0 px-0 py-2">
          {education.length > 0 ? (
            <ul className="divide-y divide-border">
              {education.map((edu: any, index: number) => {
                const schoolLogo = edu.logo || edu.school_logo || edu.school_details?.logo;
                return (
                  <li key={index} className="flex items-start gap-3 py-4 first:pt-2">
                    {schoolLogo ? (
                      <img
                        src={schoolLogo}
                        alt={edu.school || ''}
                        className="mt-0.5 h-10 w-10 shrink-0 rounded-lg border border-border bg-background object-contain p-0.5"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; (e.target as HTMLImageElement).nextElementSibling && ((e.target as HTMLImageElement).nextElementSibling as HTMLElement).classList.remove('hidden'); }}
                      />
                    ) : null}
                    <div className={`mt-0.5 flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground ${schoolLogo ? 'hidden' : ''}`}>
                      <GraduationCap className="h-4 w-4" aria-hidden="true" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className="text-md font-semibold leading-tight text-foreground">{edu.school}</p>
                      {(edu.degree || edu.field_of_study) && (
                        <p className="mt-0.5 text-sm text-foreground-secondary">
                          {edu.degree}{edu.field_of_study && ` · ${edu.field_of_study}`}
                        </p>
                      )}
                      {(edu.start?.year || edu.end?.year) && (
                        <p className="mt-0.5 text-sm text-muted-foreground">
                          {edu.start?.year || '?'}{edu.end?.year && ` → ${edu.end.year}`}
                        </p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          ) : (
            <EmptyState icon={GraduationCap} text="Aucune formation disponible" />
          )}
        </TabsContent>

        {/* Skills Tab */}
        <TabsContent value="skills" className="mt-0 px-0 py-4">
          {skills.length > 0 ? (
            <SkillsWithEndorse
              skills={skills}
              profileId={profile.id}
              accountId={accountId}
            />
          ) : (
            <EmptyState icon={Zap} text="Aucune compétence disponible" />
          )}
        </TabsContent>

        {/* Messages Tab */}
        <TabsContent value="messages" className="mt-0 px-0 py-4">
          <CardMessageThread
            accountId={accountId}
            profileId={profile.id}
            profileName={fullName}
            projectId={projectId}
            onMessageSent={onMessageSent}
            onProfileTreated={onProfileTreated}
          />
        </TabsContent>

        {/* Posts Tab */}
        <TabsContent value="posts" className="mt-0 px-0 py-4">
          <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
            <p className="text-sm text-foreground">Publications LinkedIn</p>
            <p className="mb-4 mt-1 text-xs text-muted-foreground">
              Consultez les dernières publications de ce candidat.
            </p>
            <Button variant="outline" size="sm">
              <Newspaper aria-hidden="true" />
              Voir les posts
            </Button>
          </div>
        </TabsContent>
        </>
        )}

        {/* Extra tabs (pipeline-only) — leur contenu est rendu via la prop. */}
        {extraTabs?.map(tab => (
          <TabsContent key={tab.key} value={tab.key} className="mt-0 px-0 py-4">
            {tab.content}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
};

const EmptyState: React.FC<{ icon: React.FC<any>; text: string }> = ({ icon: Icon, text }) => (
  <div className="rounded-xl border border-dashed border-border px-4 py-8 text-center">
    <p className="text-sm text-muted-foreground">{text}</p>
  </div>
);

/** Skills list with inline endorsement buttons */
const SkillsWithEndorse: React.FC<{
  skills: any[];
  profileId: string;
  accountId?: string;
}> = ({ skills, profileId, accountId }) => {
  const [endorsedIds, setEndorsedIds] = useState<Set<number>>(new Set());
  const [loadingId, setLoadingId] = useState<number | null>(null);

  const handleEndorse = async (skill: any) => {
    if (!accountId || !skill.endorsement_id) return;
    setLoadingId(skill.endorsement_id);
    try {
      const { data } = await invokeUnipile({
        body: {
          action: 'endorse_skill',
          account_id: accountId,
          profile_id: profileId,
          skill_endorsement_id: skill.endorsement_id,
        },
      });
      if (data.success) {
        setEndorsedIds(prev => new Set(prev).add(skill.endorsement_id));
        toast.success(`Compétence "${skill.name}" endorsée`);
      } else {
        toast.error(data.error || 'Erreur lors de l\'endorsement');
      }
    } catch {
      toast.error('Erreur réseau');
    } finally {
      setLoadingId(null);
    }
  };

  return (
    <div className="flex flex-wrap gap-1.5">
      {skills.map((skill: any, index: number) => {
        const hasEndorsementId = !!skill.endorsement_id;
        const isEndorsed = skill.endorsed || endorsedIds.has(skill.endorsement_id);
        const isLoading = loadingId === skill.endorsement_id;

        return (
          <span
            key={index}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-sm text-foreground"
          >
            {skill.name || skill}
            {skill.endorsement_count != null && (
              <span className="text-xs text-muted-foreground font-normal">+{skill.endorsement_count}</span>
            )}
            {hasEndorsementId && accountId && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={() => !isEndorsed && !isLoading && handleEndorse(skill)}
                    disabled={isEndorsed || isLoading}
                    className={`ml-0.5 p-0.5 rounded transition-colors ${
                      isEndorsed
                        ? 'text-primary cursor-default'
                        : 'text-foreground hover:text-primary cursor-pointer'
                    }`}
                  >
                    {isLoading ? (
                      <Loader2 className="w-3 h-3 animate-spin" />
                    ) : (
                      <ThumbsUp className={`w-3 h-3 ${isEndorsed ? 'fill-current' : ''}`} />
                    )}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="top">
                  {isEndorsed ? 'Endorsé ✓' : 'Endorser cette compétence'}
                </TooltipContent>
              </Tooltip>
            )}
          </span>
        );
      })}
    </div>
  );
};

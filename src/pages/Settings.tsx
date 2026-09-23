import { useEffect, useRef, useSyncExternalStore, type RefObject } from 'react';
import { Link, NavLink, Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { cn } from '@/lib/utils';
import { SEOHead } from '@/components/SEOHead';
import { useOrganization } from '@/hooks/useOrganization';
import { useOrgManagerName } from '@/hooks/useOrgManagerName';
import { hasFeature } from '@/lib/featureGates';
import { SETTINGS_PATHS, landingPath, managedBySentence, sectionAccess, type SettingsDoor, type SettingsSectionId, type SettingsViewer } from '@/lib/settingsRoutes';
import { SETTINGS_SECTIONS, type SettingsSection } from '@/components/settings/shell/sections';

/**
 * Paramètres : coquille à deux portes (Mon compte, Mon organisation).
 * Les rubriques viennent du registre shell/sections.tsx ; les anciennes adresses
 * à ?tab=… sont redirigées avant la garde de connexion (LegacySettingsRedirect).
 */

/** Seuil = lg de Tailwind (1024 px), lu en JS et synchrone dès le premier rendu. Le hook mobile
 *  partagé (768 px, false au premier rendu) redirigerait un téléphone avant qu'il voie la liste. */
const DESKTOP_QUERY = '(min-width: 1024px)';
const subscribeDesktop = (onChange: () => void) => {
  const mql = window.matchMedia(DESKTOP_QUERY);
  mql.addEventListener('change', onChange);
  return () => mql.removeEventListener('change', onChange);
};
const readDesktop = () => window.matchMedia(DESKTOP_QUERY).matches;
const useIsDesktop = () => useSyncExternalStore(subscribeDesktop, readDesktop);

type NavState = { focusHeading?: boolean; fromList?: boolean } | null;

/** Téléphone : rubrique quittée par le lien « Paramètres ». La liste lui rend le focus. */
let lastPhoneSection: SettingsSectionId | null = null;

const Settings = () => {
  const isDesktop = useIsDesktop();
  const { isAdmin, isOwner, orgType } = useOrganization();
  const viewer: SettingsViewer = { isAdmin, isOwner, orgType, hasTeam: hasFeature(orgType, 'team_management') };
  const { pathname } = useLocation();
  const current = SETTINGS_SECTIONS.find((s) => pathname === SETTINGS_PATHS[s.id]);

  const routes = (
    <Routes>
      <Route index element={<SettingsIndex viewer={viewer} isDesktop={isDesktop} />} />
      {SETTINGS_SECTIONS.map((s) => (
        // key sur SectionFrame : sans elle, React réutiliserait le même cadre d'une rubrique à l'autre.
        <Route key={s.id} path={s.path} element={<SectionFrame key={s.id} section={s} viewer={viewer} isDesktop={isDesktop} />} />
      ))}
      <Route path="*" element={<Navigate to="/settings" replace />} />
    </Routes>
  );

  return (
    <div className="min-h-screen bg-background">
      <SEOHead title={current ? `${current.label} · Paramètres` : 'Paramètres'} description="Vos réglages et ceux de votre organisation" />
      <div className="max-w-[1600px] mx-auto px-4 sm:px-6 lg:px-8 py-6 pb-8">
        {/* Même arbre dans les deux dispositions : seuls le titre, le rail et les classes changent.
            Déplacer {routes} d'un parent à l'autre remontait la rubrique ouverte au passage du
            seuil (fenêtre redimensionnée, tablette tournée) et perdait la saisie en cours. */}
        {isDesktop && <h1 className="text-2xl font-bold text-foreground tracking-tight mb-4">Paramètres</h1>}
        <div className={isDesktop ? 'flex gap-10' : undefined}>
          {isDesktop && <SettingsNav viewer={viewer} variant="rail" className="w-60 shrink-0 sticky top-6 self-start max-h-[calc(100vh-3rem)] overflow-y-auto" />}
          <div className={isDesktop ? 'flex-1 min-w-0 max-w-3xl' : undefined}>{routes}</div>
        </div>
      </div>
    </div>
  );
};
export default Settings;

function SettingsIndex({ viewer, isDesktop }: { viewer: SettingsViewer; isDesktop: boolean }) {
  const location = useLocation();
  if (isDesktop) return <Navigate replace to={{ pathname: landingPath(viewer), search: location.search, hash: location.hash }} />;
  return <SettingsList viewer={viewer} />;
}

function SettingsNav({ viewer, variant, className }: { viewer: SettingsViewer; variant: 'rail' | 'list'; className?: string }) {
  const manager = useOrgManagerName(!viewer.isAdmin);
  const group = (door: SettingsDoor, title: string) => {
    const headingId = `settings-nav-${door}`;
    const managed = door === 'org' && !viewer.isAdmin;
    const items = SETTINGS_SECTIONS.filter((s) => s.door === door && sectionAccess(s.id, viewer) === 'open');
    return (
      <section aria-labelledby={headingId}>
        <h2 id={headingId} className="px-3 mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h2>
        {managed ? (
          manager.isLoading
            ? <div className="mx-3 h-5 w-56 max-w-full rounded bg-muted animate-pulse" aria-hidden="true" />
            : <p className="px-3 text-sm text-muted-foreground">{managedBySentence(manager.name)}</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {items.map((s) => <li key={s.id}><SectionLink section={s} variant={variant} /></li>)}
          </ul>
        )}
      </section>
    );
  };
  return (
    <nav aria-label="Rubriques des paramètres" className={cn('flex flex-col gap-6', className)}>
      {group('account', 'Mon compte')}
      {group('org', 'Mon organisation')}
    </nav>
  );
}

function SectionLink({ section, variant }: { section: SettingsSection; variant: 'rail' | 'list' }) {
  const Icon = section.icon;
  return (
    <NavLink
      to={SETTINGS_PATHS[section.id]}
      state={{ focusHeading: true, fromList: variant === 'list' }}
      data-section={section.id}
      className={({ isActive }) => cn(
        'flex items-center gap-2.5 rounded-lg px-3 text-sm font-medium transition-colors',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring',
        variant === 'rail' ? 'h-9' : 'min-h-12',
        variant === 'rail' && isActive ? 'bg-foreground text-background' : 'text-foreground/80 hover:bg-muted hover:text-foreground',
      )}
    >
      <Icon className="w-4 h-4 shrink-0" aria-hidden="true" />
      <span className="flex-1">{section.label}</span>
      {variant === 'list' && <ChevronRight className="w-4 h-4 text-muted-foreground" aria-hidden="true" />}
    </NavLink>
  );
}

function SettingsList({ viewer }: { viewer: SettingsViewer }) {
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const id = lastPhoneSection;
    lastPhoneSection = null;
    if (id) listRef.current?.querySelector<HTMLElement>(`[data-section="${id}"]`)?.focus();
  }, []);
  return (
    <div ref={listRef}>
      <h1 className="text-xl font-bold text-foreground tracking-tight mb-4">Paramètres</h1>
      <SettingsNav viewer={viewer} variant="list" />
    </div>
  );
}

function SectionFrame({ section, viewer, isDesktop }: { section: SettingsSection; viewer: SettingsViewer; isDesktop: boolean }) {
  const location = useLocation();
  const navigate = useNavigate();
  const headingRef = useRef<HTMLHeadingElement>(null);
  const paneRef = useRef<HTMLDivElement>(null);
  const access = sectionAccess(section.id, viewer);
  const Heading = (isDesktop ? 'h2' : 'h1') as 'h2';
  const fromList = (location.state as NavState)?.fromList === true;

  // Focus au titre seulement après un choix dans la navigation ; une arrivée par lien ne vole pas le focus.
  useEffect(() => {
    if (!(location.state as NavState)?.focusHeading) return;
    headingRef.current?.focus({ preventScroll: true });
    if (!location.hash) window.scrollTo({ top: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useHashScroll(paneRef);

  const Body = section.Component;
  return (
    <div ref={paneRef}>
      {!isDesktop && (
        <Link
          to="/settings"
          aria-label="Retour aux paramètres"
          onClick={(e) => {
            lastPhoneSection = section.id;
            // Venu de la liste : on y revient dans l'historique, sans empiler une entrée de plus (D14).
            if (fromList) { e.preventDefault(); navigate(-1); }
          }}
          className="inline-flex items-center gap-1 h-11 -ml-2 px-2 mb-1 rounded-md text-sm font-medium text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <ChevronLeft className="w-4 h-4" aria-hidden="true" />
          Paramètres
        </Link>
      )}
      <header className="mb-6">
        <Heading ref={headingRef} tabIndex={-1} className="text-lg font-semibold tracking-tight text-foreground focus:outline-none">{section.label}</Heading>
        <p className="text-sm text-muted-foreground mt-1">{section.intro}</p>
      </header>
      {access === 'open' ? <div className="space-y-6"><Body /></div>
        : access === 'managed' ? <ManagedNotice note={section.managedNote} />
        : <TeamUnavailable isOwner={viewer.isOwner} />}
    </div>
  );
}

function ManagedNotice({ note }: { note?: string }) {
  const { name, isLoading } = useOrgManagerName(true);
  if (isLoading) return <div className="h-16 rounded-xl bg-muted animate-pulse" aria-hidden="true" />;
  return (
    <div role="note" className="rounded-xl border border-border bg-card p-5 space-y-1.5">
      <p className="text-sm text-foreground">{managedBySentence(name)}</p>
      {note && <p className="text-sm text-muted-foreground">{note}</p>}
    </div>
  );
}

function TeamUnavailable({ isOwner }: { isOwner: boolean }) {
  return (
    <div role="note" className="rounded-xl border border-border bg-card p-5">
      {/* Le type est réservé au propriétaire : un admin n'est pas envoyé vers un réglage fermé. */}
      {isOwner ? (
        <p className="text-sm text-foreground">
          Équipe n’est proposée qu’aux organisations Entreprise et Cabinet. Le type se règle dans{' '}
          <Link to={SETTINGS_PATHS.general} className="font-medium underline underline-offset-2">Général</Link>.
        </p>
      ) : (
        <p className="text-sm text-foreground">
          Équipe n’est proposée qu’aux organisations Entreprise et Cabinet. Seul le propriétaire peut choisir le type de l’organisation.
        </p>
      )}
    </div>
  );
}

const safeDecode = (value: string) => { try { return decodeURIComponent(value); } catch { return value; } };

/** #ancre : recale tant que les blocs au-dessus passent du chargement à leur taille finale,
 *  jusqu'au premier geste (3 s au plus). Seule une navigation qui porte un hash fixe une
 *  nouvelle cible (lien vers une ancre de la rubrique déjà ouverte, même rejoué). Les lecteurs
 *  de retour (paiement, Notion) réécrivent l'adresse sans hash via setSearchParams : ce
 *  remplacement n'interrompt pas l'alignement en cours. */
function useHashScroll(paneRef: RefObject<HTMLElement>) {
  const { hash, key } = useLocation();
  const target = useRef({ id: safeDecode(hash.slice(1)), key });
  if (hash.length > 1 && key !== target.current.key) target.current = { id: safeDecode(hash.slice(1)), key };
  const trigger = target.current.key;
  useEffect(() => {
    const id = target.current.id;
    const pane = paneRef.current;
    if (!id || !pane || typeof ResizeObserver === 'undefined') return;
    let done = false;
    const stop = () => { done = true; };
    const align = () => { if (!done) document.getElementById(id)?.scrollIntoView({ block: 'start' }); };
    const observer = new ResizeObserver(align);
    observer.observe(pane);
    align();
    const timer = window.setTimeout(stop, 3000);
    const events = ['wheel', 'touchstart', 'keydown', 'pointerdown'] as const;
    events.forEach((e) => window.addEventListener(e, stop, { passive: true, once: true }));
    return () => { stop(); observer.disconnect(); window.clearTimeout(timer); events.forEach((e) => window.removeEventListener(e, stop)); };
  }, [paneRef, trigger]);
}

# 02 — SHELL + DASHBOARD / AGENTS / MARKETPLACE

## 0. Tokens de référence (contexte)

`tailwind.config.ts` + `src/index.css`
- Radius : `--radius: 0.75rem` → `sm=8px, md=10px, lg=12px, xl=16px, 2xl=24px`
- Fonts : `sans=Instrument Sans`, `display=Outfit`, `brand=Bricolage Grotesque`, `serif=Instrument Serif`, `mono=Space Mono`
- FontSize custom : `3xs = 10px/14`, `2xs = 11px/15`
- Couleurs sémantiques : `success/warning/info` (+ `.muted`, `.foreground`), `destructive`, `brand.{purple,pink,blue,cyan,green}`, `linkedin`, `whatsapp`, `sidebar.*`
- Jeu parallèle non utilisé par ces écrans : `--k-*` (search redesign)
- Shadows : `--shadow-2xs … --shadow-2xl`
- Thème : **dark par défaut**, `.light` sur `<html>` ; persisté `localStorage['konekt-theme']`
- Breakpoint mobile JS : `useIsMobile()` = **768px** (`src/hooks/use-mobile.tsx`)

---

## 1. `src/App.tsx` — routes, guards, providers

### Arbre de providers (extérieur → intérieur)
`TooltipProvider` → `LinkedInAccountsProvider` → `AgentProvider` → `AppContent`
Dans `AppContent`, avant `<Routes>` : `<Toaster />` (shadcn) + `<Sonner />` (sonner). Après `<Routes>` : `SectionErrorBoundary(fallbackTitle="Erreur dans le copilot IA") > AgentDrawer`, `NavigationPalette`, `SessionExpiredDialog`.

### Suspense fallback global (lazy pages)
`min-h-screen bg-background text-foreground flex items-center justify-center px-6` → spinner `w-9 h-9 rounded-full border border-border border-t-foreground animate-spin` + texte **« Chargement en cours »** (`text-xs font-medium uppercase tracking-wider text-muted-foreground`).

### Table des routes (ordre du fichier)

| # | Path | Élément | Guards | Layout |
|---|---|---|---|---|
| 1 | `/` | SkalrLanding (lazy) | — | aucun |
| 2 | `/index` | `Navigate → /` (replace, preserve token) | — | — |
| 3 | `/auth` | Auth (eager) | — | aucun |
| 4 | `/onboarding` | Onboarding | ProtectedRoute | aucun |
| 5 | `/portal/:token` | CandidatePortal | — | aucun |
| 6 | `/client/:token` | ClientPortalV2 | — | aucun |
| 7 | `/mission-invite/:token` | AcceptMissionInvite | ProtectedRoute | aucun |
| 8 | `/unsubscribe` | Unsubscribe (Suspense fallback `null`) | — | aucun |
| 9 | `/privacy` | Privacy (fallback `null`) | — | aucun |
| 10 | `/privacy-extension` | PrivacyExtension (fallback `null`) | — | aucun |
| 11 | `/r/:slug` | RecruiterPublicProfile | — | aucun |
| 12 | `/candidates` | `Navigate → /pipeline` (replace, **sans** preview token) | — | — |
| 13 | `/missions` | Outreach | Protected+OrgGuard | AppLayout |
| 14 | `/missions/:id` | MissionWorkspace | Protected+OrgGuard | AppLayout |
| 15 | `/sourcing` | SourcingSearches | Protected+OrgGuard | AppLayout |
| 16 | `/sourcing/:id` | SourcingSearch | Protected+OrgGuard | AppLayout |
| 17 | `/agents` | Agents | Protected+OrgGuard | AppLayout |
| 18 | `/pipeline` | ATS | Protected+OrgGuard | AppLayout |
| 19 | `/inbox` | Inbox | Protected+OrgGuard | AppLayout |
| 20 | `/calendar` | Calendar | Protected+OrgGuard | AppLayout |
| 21 | `/tasks` | Tasks | Protected+OrgGuard | AppLayout |
| 22 | `/outreach` | `Navigate → /missions` | — | — |
| 23 | `/ats` | `Navigate → /pipeline` | — | — |
| 24 | `/dashboard` | Dashboard | Protected+OrgGuard | AppLayout |
| 25 | `/qualification/:id` | Qualification | Protected+OrgGuard | AppLayout |
| 26 | `/pipeline/scorecard/:candidateId` | ScorecardFullPage | Protected+OrgGuard | **sans AppLayout** (plein écran) |
| 27 | `/ats/scorecard/:candidateId` | idem | idem | idem |
| 28 | `/settings` | Settings | Protected+OrgGuard | AppLayout |
| 29 | `/pricing` | Pricing | **aucun** (page publique) | aucun |
| 30 | `/marketplace` | Marketplace | Protected+OrgGuard | AppLayout |
| 31 | `*` | NotFound | — | aucun |

`PUBLIC_ROUTES = ['/', '/index', '/auth', '/portal', '/client', '/pricing']` — sert au détecteur de session expirée.

### Effets globaux
- `loadAnalytics()` (Plausible) au mount.
- Preview access token : persistance via query `?…`, redirection `navigate(replace)` si le token manque dans l'URL.
- `supabase.auth.onAuthStateChange` : sur `SIGNED_OUT` / `TOKEN_REFRESHED` sans session → `clearOrgIdCache()`, `clearOnboardingProgress()`, `queryClient.clear()`, `Sentry.setUser(null)`, et si route non publique et ≠ `/auth` → **ouverture du SessionExpiredDialog**. Sur `SIGNED_IN` → si changement d'user, purge caches ; `Sentry.setUser({id})`.
- Fermeture du dialog → `navigate('/auth', { state: { from } })`.

---

## 2. Shell

### 2.1 `AppLayout.tsx`
```
SidebarProvider
 ├ <a href="#main-content" class="skip-to-content">Aller au contenu principal</a>
 └ div.min-h-screen.flex.w-full
    ├ AppSidebar
    └ div.flex-1.flex.flex-col.min-w-0
       ├ AppHeader
       └ main#main-content.flex-1.min-h-0.flex.flex-col
          └ motion.div key={pathname} (fade+y:6→0, 0.22s, ease [0.22,1,0.36,1]) .flex-1.min-h-0.flex.flex-col
+ WelcomeOnboardingModal (auto via localStorage `konekt_welcome_pending`)
+ GlobalTaskShortcut (Cmd/Ctrl+T → CreateTaskModal)
```
- `.skip-to-content` = `sr-only focus:not-sr-only focus:fixed focus:top-4 focus:left-4 focus:z-[9999] focus:px-4 focus:py-2 focus:bg-primary focus:text-primary-foreground focus:rounded-lg focus:text-sm focus:font-medium`.
- `useReducedMotion()` désactive l'`initial`.
- **Pas de max-width ici** : chaque page gère la sienne.

### 2.2 `AppHeader.tsx` (19 lignes)
`<header class="h-12 flex items-center gap-3 border-b border-border px-4 shrink-0 bg-background">`
| Élément | Détail |
|---|---|
| `SidebarTrigger` | `h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent transition-colors`, icône `PanelLeft w-4 h-4`. Raccourci global **Cmd/Ctrl+B**. |
| `{children}` | slot jamais utilisé par les pages inventoriées |
| Zone droite | `ml-auto flex items-center gap-1` → `NotificationDropdown` uniquement |

### 2.3 `AppSidebar.tsx`
`<Sidebar collapsible="icon" className="border-r border-border bg-sidebar">`
Largeurs (`ui/sidebar.tsx`) : expanded **16rem**, icon **3rem**, mobile (Sheet) **18rem**. Sous 768px, la sidebar est un `Sheet` ; chaque clic nav appelle `setOpenMobile(false)`.

**Header** — `px-3 py-3` (collapsed `px-2 py-3`) : `<Link to="/dashboard">` avec logo org (`img h-7 w-7 rounded-md object-cover`) ou fallback tile `h-7 w-7 rounded-md bg-foreground text-background font-display font-bold text-xs` portant l'initiale. Nom org `text-[13px] font-display font-bold tracking-tight truncate` (masqué si collapsed). Hover `hover:bg-sidebar-accent/40`.

**Bouton recherche** (sous le header, `mb-2`) :
- expanded : `w-full h-9 px-2.5 rounded-md bg-sidebar-accent/40 text-muted-foreground text-[12px]`, icône `Search h-4 w-4 strokeWidth=1.5`, label **« Rechercher… »**, `kbd` `⌘K` (`text-[10px] font-mono`). aria-label « Rechercher (Ctrl+K) ».
- collapsed : `h-9 w-9` carré, `Search h-5 w-5`, title « Rechercher (⌘K) ».
- Action : `toggleAgent()` — **ouvre le copilot IA, pas une recherche**.

**Nav** — `SidebarMenu gap-1` :

| Ordre | Label FR | Icône lucide | Route | Badge |
|---|---|---|---|---|
| 1 | Dashboard | `Home` | `/dashboard` | — |
| 2 | Missions | `Briefcase` | `/missions` | — |
| 3 | Recherche | `Search` | `/sourcing` | — |
| 4 | Pipeline | `Columns3` | `/pipeline` | — |
| 5 | Calendrier | `Calendar` | `/calendar` | — |
| 6 | Tâches | `ListTodo` | `/tasks` | — |
| 7 | Messages | `Inbox` | `/inbox` | `unread` |
| 8 | Marketplace | `Store` | `/marketplace` | — |

- Pas de groupe / pas d'eyebrow. Filtrage possible par `feature` (`hasFeature(orgType, …)`) — **aucun item n'en déclare actuellement**.
- Item : `rounded-lg text-[13.5px] font-medium`, expanded `h-11 px-2` / collapsed `h-10 w-10 px-0 justify-center`. Actif = `bg-sidebar-accent text-sidebar-foreground`, sinon `text-sidebar-foreground/80 hover:bg-sidebar-accent/50`.
- Tile icône : `rounded-lg` `h-8 w-8` (collapsed `h-7 w-7`), `bg-emerald-500/15` → **`bg-emerald-500/30` si actif**, icône `text-foreground strokeWidth=2` `h-[19px] w-[19px]` (collapsed `h-[18px] w-[18px]`).
- Badge non-lus expanded : `min-w-[18px] h-[18px] px-1.5 text-[10px] font-bold tabular-nums bg-destructive text-destructive-foreground rounded-full`, `99+` au-delà de 99. Collapsed : pastille `absolute top-0.5 right-0.5 w-2 h-2 bg-destructive rounded-full ring-2 ring-sidebar`.
- Actif de `/missions` : match `/missions` **ou** `/missions/*` ; sinon `pathname === path || startsWith(path + '/')`.
- Tooltip natif shadcn (`tooltip={item.label}`) en mode collapsed.

**Footer** — `px-2 py-2` : `SidebarUserMenu` puis bloc branding `pt-2 mt-2 border-t border-sidebar-border` avec `KonektLogo variant="mark" size={14} className="opacity-50"` + texte `Konekt` (`text-[10px] uppercase tracking-wider text-sidebar-foreground/40 font-medium`), masqué si collapsed.

**Toggle thème** : état local `isDark` initialisé depuis `!documentElement.classList.contains('light')`, écrit `localStorage['konekt-theme']`, passé au `SidebarUserMenu`.

### 2.4 `sidebar/SidebarUserMenu.tsx`
Trigger : `<button>` `w-full flex items-center rounded-lg hover:bg-sidebar-accent/60`, expanded `gap-2.5 px-2 py-1.5` / collapsed `h-10 w-10 justify-center mx-auto`. `CandidateAvatar size=28` (avatar LinkedIn > profil > initiales), nom `text-[13px] font-medium truncate` (fallback **« Utilisateur »**), `ChevronsUpDown w-3.5 h-3.5 opacity-50 group-hover:opacity-100`. aria-label « Menu utilisateur ».

Contenu : `side="top" sideOffset={8} align={collapsed?'start':'end'} w-60 rounded-xl`
| Item | Icône | Trailing | Action |
|---|---|---|---|
| *Label* : avatar 36px + `displayName` (`text-sm font-semibold`) + `organizationName` (`text-xs text-muted-foreground`) | — | — | — |
| — separator — | | | |
| **Notifications** | `Bell w-4 h-4` | badge non-lus (`min-w-[18px] h-[18px] … bg-destructive`, `99+`) | pose un ref puis, sur `onCloseAutoFocus`, `window.dispatchEvent('konekt:open-notifications')` (ouvre le popover du header) |
| **Crédits IA** | `Sparkles` (rouge si `isOut`, ambre si `isLow`) | solde compact : `...` si loading, `n/d` si pas de solde, `12,3k` si >9999, sinon `toLocaleString('fr-FR')` | `navigate('/settings?tab=credits')` |
| — separator — | | | |
| **Mon profil** | `UserIcon` | | `/settings?tab=account` |
| **Paramètres** | `Settings` | | `/settings` |
| **Mode clair** / **Mode sombre** | `Sun` si dark / `Moon` si light | | `onToggleTheme()` |
| — separator — | | | |
| **Déconnexion** | `LogOut` | | `supabase.auth.signOut()` — classe `text-destructive focus:text-destructive` |

### 2.5 `notifications/NotificationDropdown.tsx`
Trigger : `relative h-8 w-8 rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent`, `Bell h-4 w-4`. Badge : `absolute top-0.5 right-0.5 min-w-[16px] h-4 px-1 text-3xs font-bold tabular-nums bg-destructive text-destructive-foreground rounded-full`, **`9+` au-delà de 9** (≠ `99+` ailleurs). aria-label dynamique : `Notifications, N non lue(s)` / `Notifications`.

Popover : `align="end" sideOffset={8} w-[calc(100vw-1rem)] sm:w-80 p-0 overflow-hidden`.
- Header `px-3 py-2 border-b` : titre **« Notifications »** (`text-xs font-bold uppercase tracking-wider`) + si non-lus, bouton **« Tout marquer lu »** (`CheckCheck w-3 h-3`, `text-xs text-muted-foreground hover:text-foreground`) → `markAllAsRead()`.
- Liste : `max-h-[400px] overflow-y-auto`.
- **Vide** : `py-8`, `Bell w-5 h-5 opacity-30`, texte **« Aucune notification »** (`text-xs font-medium uppercase tracking-wider`).
- Item : bouton pleine largeur `px-3 py-2.5 border-b last:border-b-0 hover:bg-muted/50`, non lu → `bg-primary/5` + dot `mt-1.5 w-2 h-2 bg-primary rounded-full`. Titre `text-xs` (`font-bold text-foreground` non lu / `font-medium text-muted-foreground` lu), body `text-xs line-clamp-2`, date relative `formatDistanceToNow(fr, addSuffix)` en `text-xs text-muted-foreground/60`.
- Clic → `markAsRead(id)` si non lu, ferme, `navigate(notif.link)` si lien.
- Écoute l'événement DOM `konekt:open-notifications`.

### 2.6 `layout/NavigationPalette.tsx` (monté globalement)
`CommandDialog` (cmdk), raccourci **Cmd/Ctrl+J** (toggle), `Escape` ferme. Input placeholder : **« Chercher une page, une action… »**. Empty : **« Aucun résultat »**. `run()` ferme puis `setTimeout(action, 50)`.

| Groupe | Item | Icône | Shortcut affiché | Action |
|---|---|---|---|---|
| Navigation | Dashboard | `LayoutDashboard` | `G D` | `/dashboard` |
| | Missions | `Target` | `G M` | `/missions` |
| | Recherche | `Search` | — | `/sourcing` |
| | Pipeline | `Kanban` | `G P` | `/pipeline` |
| | Calendrier | `Calendar` | — | `/calendar` |
| | Tâches | `CheckSquare` | — | `/tasks` |
| | Messages | `MessageSquare` | — | `/inbox` |
| Actions | Ouvrir le copilot IA | `Sparkles` | `⌘K` | `toggleAgent()` |
| | Créer une mission | `Plus` | — | `/missions?create=brief` |
| | Gérer l'équipe *(si `!isCollaborator && hasFeature(orgType,'team_management')`)* | `Users` | — | `/settings?tab=team` |
| | Abonnement & facturation *(si `isAdmin`)* | `CreditCard` | — | `/settings?tab=billing` |
| Paramètres | Paramètres | `SettingsIcon` | — | `/settings` |
| | Basculer le thème clair/sombre | `Sun`/`Moon` (via `dark:hidden`/`hidden dark:block`) | — | toggle classe `.light` |
| | Se déconnecter | `LogOut` | — | `signOut()` + `/auth` — `text-destructive data-[selected=true]:text-destructive` |

⚠ Les raccourcis `G D` / `G M` / `G P` sont **affichés mais non implémentés**. Le toggle thème ici **n'écrit pas `localStorage`** (contrairement à la sidebar).

### 2.7 Guards & états
**`ProtectedRoute.tsx`** — `!isReady` → `min-h-screen flex items-center justify-center` + spinner `w-6 h-6 border border-border border-t-foreground rounded-full animate-spin`. `!session` → `Navigate → /auth` avec `state.from`.

**`OrganizationGuard.tsx`**
- loading : même spinner `w-6 h-6` plein écran.
- `isError && !organization` : carte `max-w-md w-full border border-destructive/30 bg-destructive/5 p-6 text-center` (**pas de radius**), `AlertTriangle w-5 h-5 text-destructive`, titre **« Impossible de charger votre espace de travail »** (`text-xs font-bold uppercase tracking-wider`), texte **« Vérifiez votre connexion, puis réessayez. »**, bouton `h-8 px-4 text-xs font-medium uppercase tracking-wider border border-border bg-background disabled:opacity-60` avec `RefreshCw w-3 h-3` (spin si refetch) et label **« Réessayer »** ↔ **« Nouvelle tentative… »**.
- `needsOnboarding` → `Navigate → /onboarding`.
- Sinon : `<div class="shrink-0">` (LowCreditBanner + TrialBanner) puis `<div class="flex-1 min-h-0">{children}</div>`.

**`LowCreditBanner`** (`src/components/ai/`) — bandeau pleine largeur `px-4 py-2 text-xs font-medium`, `bg-destructive/10 text-destructive border-b border-destructive/20` si critique sinon `bg-warning/10 text-warning border-b border-warning/20`. Textes : « Plus de crédits IA disponibles : les fonctionnalités IA sont désactivées. » / « Il vous reste {N} crédits IA ({P}% du forfait du mois). ». CTA lien souligné **« Acheter des crédits »** + `ArrowUpRight w-3 h-3` → `/settings?tab=credits`. Bouton fermer `X w-3.5 h-3.5`, `hover:bg-black/5` (⚠ couleur en dur), aria-label « Fermer ». Réapparaît sous 10 % / après 30 min.

**`TrialBanner`** (`src/components/billing/`) — `role="status"`, `border-b border-border bg-warning/10 px-4 py-2 text-xs text-foreground`. Textes : « Votre essai se termine aujourd'hui. » / « Essai : N jour(s) restant(s). » / « Essai terminé : votre espace est sur le plan gratuit. Vos données restent accessibles, sans envoi de séquences ni enrichissement de contact. ». CTA `Link → /pricing` **« Choisir un plan »** si `isAdmin`, sinon texte muted **« Demandez à un administrateur de choisir un plan. »**.

**`SessionExpiredDialog.tsx`** — `AlertDialog`, `max-w-md`. Cercle `mx-auto w-12 h-12 rounded-full bg-warning/10` + `LogIn w-6 h-6 text-warning`. Titre **« Session expirée »**, description **« Votre session a expiré pour des raisons de sécurité. Veuillez vous reconnecter pour continuer à utiliser l'application. »** (centrés). Footer `sm:justify-center`, `AlertDialogAction` **« Se reconnecter »** classé `bg-info text-info-foreground hover:bg-info/90 px-8` → `/auth` avec `state:{from, sessionExpired:true}`. Pas de bouton Annuler.

**`ErrorBoundary.tsx`** (global) — auto-reload une fois sur `ChunkLoadError` (`sessionStorage['chunk-reload']`), sinon `Sentry.captureException`. UI : `min-h-screen bg-background flex items-center justify-center p-6`, carte `max-w-md border border-border p-8 text-center` (pas de radius), carré `h-14 w-14 bg-foreground text-background` + `AlertTriangle w-7 h-7`, h1 **« Une erreur est survenue »** (`text-lg font-semibold uppercase tracking-wide`), p **« L'application a rencontré un problème inattendu. Essayez de rafraîchir la page. »**, message d'erreur tronqué à 150 car. (`text-xs font-mono text-muted-foreground/60 break-all`). Deux boutons `h-9 px-5 text-xs font-medium uppercase tracking-wider` : **« Réessayer »** (bg-background) et **« Rafraîchir »** (bg-foreground text-background, `RefreshCw w-3.5 h-3.5`).

**`SectionErrorBoundary.tsx`** — `border border-destructive/30 bg-destructive/5 p-6 text-center my-4`, `AlertTriangle w-5 h-5`, titre = prop `fallbackTitle` (défaut **« Erreur dans cette section »**), message tronqué 200 car. en `font-mono`, bouton **« Réessayer »** `h-8 px-4 … uppercase tracking-wider border border-border`.

**`InvitationBanner.tsx`** — ⚠ **jamais importé** dans les fichiers du shell/pages inventoriés. Liste `space-y-2 mb-4` ; ligne `px-4 py-3 bg-primary/10 border border-primary/20 rounded-md`, `UserPlus w-4 h-4 text-primary`, texte « Vous êtes invité à rejoindre **{org}** en tant que {Admin|Collaborateur|Membre} ». Bouton shadcn `size="sm"` `h-8 gap-1.5` **« Accepter »**, `Loader2 w-3.5 h-3.5 animate-spin` pendant, `disabled={isAccepting}`.

**`KonektLogo.tsx`** — `variant: 'full'|'mark'`, `theme: 'auto'|'dark'|'light'` (light = PNG blanc), `size` px (défaut 32 mark / 36 full). Rend `<img src="/konekt-{logo|mark}{-white}.png">`, `inline-block select-none`, `draggable=false`.

**`SEOHead.tsx`** — react-helmet-async ; titre suffixé ` | Konekt` si absent ; meta title/description/keywords (défaut `recrutement, sourcing, LinkedIn, ATS, IA, scoring, séquences outreach`), viewport, canonical, OG (`type/url/title/description/image`), Twitter (`summary_large_image`). Image par défaut `/konekt-logo.png`.

**`help/TutorialVideoDialog.tsx`** — bouton `h-6 w-6 rounded-full text-muted-foreground hover:bg-muted/60`, `CircleHelp w-3.5 h-3.5`, title « Aide — tutoriel vidéo », aria-label « Ouvrir le tutoriel vidéo ». Dialog `max-w-2xl p-0 overflow-hidden gap-0` : header `px-5 pt-4 pb-3` (`DialogTitle font-display text-[16px]`, description `text-2xs`), `<video controls autoPlay muted loop playsInline class="w-full aspect-[16/10] bg-black">` (fallback texte « La vidéo n'a pas pu être chargée. »), liste de points `px-5 py-3 border-t` avec puce `•` en `text-brand-purple`, footer optionnel avec `Checkbox` **« Ne plus afficher automatiquement »** (cochée par défaut) + bouton **« C'est compris »** (`h-7 px-3 rounded-full bg-foreground text-background text-2xs font-semibold`). Auto-open après 700 ms, clé `localStorage['konekt:tuto:seen:{key}']`. ⚠ **Non monté** sur Dashboard/Agents/Marketplace.

### 2.8 Primitives `src/components/layout/`

| Composant | Structure clé |
|---|---|
| **PageLayout** | `min-h-screen bg-background` > `py-6 pb-8` (+ `animate-in fade-in-0 slide-in-from-bottom-1 duration-300` sauf `noAnimation`) > `mx-auto px-3 sm:px-6 lg:px-8` + max-width : `sm=max-w-3xl`, `md=max-w-5xl`, `lg=max-w-[1200px]`, `xl=max-w-[1400px]`, `2xl=max-w-[1600px]` (défaut), `full=max-w-none` |
| **PageHeader** | `<header class="flex items-start justify-between gap-3 mb-4 flex-wrap">`, icône `w-5 h-5`, h1 `text-xl sm:text-2xl font-bold tracking-tight truncate`, meta `text-xs font-mono uppercase tracking-wider text-muted-foreground`, subtitle `text-xs text-muted-foreground max-w-2xl`, actions `flex gap-2 shrink-0` |
| **Section** | `border border-border bg-background` (pas de radius), header `px-4 py-2.5 border-b`, icône `w-3.5 h-3.5`, h3 `text-xs uppercase tracking-wider font-bold`, subtitle `— {x}` masqué `<sm`, body `p-4` si `padded` |
| **EmptyState** | `flex flex-col items-center text-center border border-dashed border-border bg-background/50`, default `py-12 px-6` / compact `py-6 px-4`, `animate-in fade-in-0 duration-300`, `role="status"`, icône `w-10 h-10` (compact `w-6 h-6`) `text-muted-foreground/40`, h3 `font-bold uppercase tracking-wider` `text-sm`/`text-xs`, description `text-xs sm:text-sm max-w-md mt-1.5`, action `mt-4` |
| **StatTile** | `border border-border p-3 sm:p-4 flex flex-col gap-1`, label `text-xs uppercase tracking-wider text-muted-foreground font-medium`, valeur `text-xl sm:text-2xl font-bold font-mono tracking-tight tabular-nums`. Variants `default/primary/success/warning/destructive/info` (icône+valeur+bg). |
| **StatGrid** | `grid -mx-px [&>*]:-ml-px [&>*]:-mt-px relative`, cols 1–7 par breakpoint. ⚠ **classes construites dynamiquement (`sm:${…}`) → purgées par Tailwind, ne fonctionnent pas.** |

⚠ **Aucun** des trois écrans inventoriés n'utilise `PageHeader`, `Section`, `EmptyState`, `StatTile`/`StatGrid`. Seul `Dashboard` utilise `PageLayout`.

---

## 3. `/dashboard` — Dashboard

**Route** `/dashboard` · guards `ProtectedRoute > OrganizationGuard` · layout `AppLayout` · wrapper `PageLayout maxWidth="2xl"` → **max-w-[1600px]**, `px-3 sm:px-6 lg:px-8`, `py-6 pb-8`, `animate-in fade-in-0 slide-in-from-bottom-1 duration-300`.
**SEO** : titre « Dashboard | Konekt », description « Votre point de départ : ce qui demande votre attention aujourd'hui. »

### Structure
1. `DashboardGreeting` (fixe)
2. `Reorder.Group axis="y" className="space-y-0 list-none"` — 5 sections drag-to-reorder, ordre persisté `localStorage['dashboard-layout-{userId}']` (fallback `dashboard-layout-anon`) : `connections`, `focus`, `missions-today`, `week`, `activity`.
3. Bouton reset (si `isCustomized`) : `flex justify-end mt-2`, `inline-flex gap-1.5 text-xs text-muted-foreground hover:text-foreground`, `Undo2 w-3 h-3`, label **« Réinitialiser l'ordre »**.
4. Modals : `CandidateDetailModal` (si candidat sélectionné, depuis le feed), `JobDetailSheet` (state `selectedJobId` — **jamais setté ≠ null**, code mort).

**Conditions de rendu des sections** (une section `null` est retirée du flux) :
| Section | Condition |
|---|---|
| connections | `!connections.isLoading` |
| focus | `!loading` (ATS) |
| missions-today | toujours |
| week | `!loading && candidates.length > 0` |
| activity | `!loading` |

⚠ **Pas de skeleton global** : pendant le chargement ATS, les sections disparaissent purement (saut de layout).

**Compteurs dérivés** : `stagnant` (jours en stage > `STAGE_GUIDE_TIMES` : Nouveau 3, Contacté 5, Répondu 3, Pressenti 5, Pré-qualif 7, CV envoyé 5, ITW en cours 10, Offre 7), `pending` (stage `Répondu` ≥ 1 j), `remindersToday` (`today + overdue`), `activeCandidatesCount` (hors `Gagné`/`Perdu`), `activeMissionsCount` (`status === 'active'`).

### 3.1 `DashboardSortableItem`
`Reorder.Item` `dragListener={false}`, `whileDrag={{scale:1.01, boxShadow:'0 20px 40px -12px rgba(0,0,0,0.18)', zIndex:50, cursor:'grabbing'}}`, spring `stiffness 320 / damping 28`. Deux handles `GripVertical w-4 h-4` :
- desktop `hidden lg:flex absolute -left-7 top-3 h-7 w-5 rounded-md opacity-0 group-hover/sortable:opacity-100`
- mobile `lg:hidden absolute right-2 top-2 h-7 w-7` (toujours visible)
aria-label « Réorganiser cette section », title « Glisser pour réorganiser ».
⚠ Le handle desktop en `-left-7` sort du conteneur → **coupé sur écran étroit**.

### 3.2 `DashboardGreeting`
`motion.header` `relative overflow-hidden rounded-2xl border border-border bg-gradient-to-br from-foreground/[0.04] via-card to-card mb-6`, blob décoratif `absolute -top-24 -right-16 h-64 w-64 rounded-full bg-foreground/[0.04] blur-3xl`.
Contenu `flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4 px-6 py-6 sm:py-7`.
- Avatar `h-12 w-12 sm:h-14 sm:w-14 rounded-full object-cover ring-2 ring-card shadow-sm` (fallback initiales `bg-foreground/[0.06] font-display font-bold text-base sm:text-lg`, bascule via `onError` en manipulant `style.display` du sibling). Live dot `absolute bottom-0 right-0 h-3 w-3 bg-success ring-2 ring-card` + ping infini (2 s).
- H1 `font-display font-bold text-2xl sm:text-3xl tracking-tight leading-tight` : **« Bonsoir »** (<5 h et ≥18 h, emoji 🌙) / **« Bonjour »** (5–11 h, ☀️) / **« Bon après-midi »** (12–17 h, 👋), + `, {prénom}`. Emoji animé (spring, delay 0.4).
- Sous-titre `text-sm text-muted-foreground mt-1.5` : date `EEEE d MMMM` locale fr capitalisée + ` · {N} candidat(s) actif(s)` + ` sur {M} mission(s)` — compteurs animés `useCountUp(900ms)`, `tabular-nums`.
- **Pills d'action** `flex gap-1.5 flex-wrap`, stagger 0.07 / delay 0.25, `whileHover scale 1.03`, `whileTap 0.97` :

| Label FR | Icône | Style | Action |
|---|---|---|---|
| **Nouvelle mission** | `Plus w-3.5 h-3.5` | `h-9 px-4 rounded-full bg-foreground text-background text-[12px] font-medium shadow-sm` | `/missions?create=brief` |
| **Rechercher** | `Search w-3.5 h-3.5` | `h-9 px-3.5 rounded-full border border-border bg-background hover:bg-accent text-[12px]` | `/missions` ⚠ (pas `/sourcing`) |
| **Inbox** | `Sparkles w-3.5 h-3.5` + suffix `ArrowRight w-3 h-3 opacity-60` | idem secondaire | `/inbox` ⚠ (icône Sparkles pour l'inbox) |

### 3.3 `DashboardConnections`
Wrapper `mb-6`. Eyebrow `flex items-center gap-2 mb-3` : **« Vos canaux »** (`text-[10px] uppercase tracking-wider text-muted-foreground font-medium`), filet `flex-1 h-px bg-border`, puis statut global :
- `hasIssue` → `AlertTriangle w-3 h-3` + **« Action requise »** (`text-destructive`, `text-[10px] uppercase tracking-wider font-bold`)
- `allConnected` → `CheckCircle2 w-3 h-3` + **« Tout actif »** (`text-success`)

Grille `grid-cols-1 sm:grid-cols-3 gap-2.5`, stagger 0.05. Trois cartes, ordre **LinkedIn → Email → WhatsApp** :

| Carte | Marque |
|---|---|
| LinkedIn | `<img src=@/assets/linkedin-logo.webp w-5 h-5 object-contain>` |
| Email | `Mail w-5 h-5 text-info` |
| WhatsApp | `<img src=@/assets/whatsapp-logo.svg w-5 h-5 object-contain>` |

Carte = `motion.button` `rounded-xl border p-3.5 flex items-center gap-3 overflow-hidden`, `whileHover y:-2`, `whileTap scale .98` ; fond selon état : action requise `bg-destructive/[0.04] hover:bg-destructive/[0.08] border-destructive/20`, ok `bg-card hover:bg-muted/30 border-border`, autre `bg-muted/20 border-border`. Tile marque `h-10 w-10 rounded-xl` (`bg-foreground/[0.04]` si ok sinon `bg-muted/40`). Nom `font-display font-bold text-[13px] tracking-tight`.

**Statuts** (`STATUS_LABEL` / `STATUS_TONE`) — dot `h-1.5 w-1.5 rounded-full` + label `text-[10.5px] uppercase tracking-wider font-bold` :
| Statut | Libellé FR | Dot / texte |
|---|---|---|
| `connected` | **Connecté** | `bg-success` / `text-success` (+ ping infini 2.4 s) |
| `connecting` | **Connexion…** | `bg-warning` / `text-warning` (+ `LivePulse tone="info"` à côté du nom) |
| `error` | **À reconnecter** | `bg-destructive` / `text-destructive` |
| `disconnected` | **Non connecté** | `bg-muted-foreground/40` / `text-muted-foreground` |

Si connecté et `channel.label` : ` · {label}` en `text-[10.5px] text-muted-foreground`. Si action requise : `ArrowRight w-4 h-4` apparaît au hover (`opacity-0 -translate-x-1 → …`). Clic (toutes cartes) → `/settings?tab=account`.

### 3.4 `DashboardFocusPanel`
**État « tout est à jour »** (somme des compteurs = 0) : carte `rounded-xl bg-card border border-border p-6 flex items-center gap-4 mb-6`, halo `bg-success/10 blur-3xl` pulsant, cercle `h-10 w-10 rounded-full bg-success/10 text-success` + `CheckCircle2 w-5 h-5`, h2 **« Tout est à jour »** (`font-display font-bold text-base tracking-tight`), p **« Pas d'action urgente — bon moment pour sourcer ou peaufiner un brief. »** (`text-sm text-muted-foreground`).

**État normal** : eyebrow **« Pour aujourd'hui »** + filet + pastille total `min-w-[22px] h-5 px-1.5 rounded-full text-[11px] bg-foreground/10 font-bold tabular-nums`. Grille `grid-cols-2 lg:grid-cols-4 gap-3`, stagger 0.06.

| Clé | Label FR | Description (count>0 / =0) | Icône | Route | Tone | Live |
|---|---|---|---|---|---|---|
| unread | **Réponses non lues** | « À traiter dans l'inbox » / « Inbox à jour » | `MessageCircle w-4 h-4` | `/inbox` | info | oui |
| pending | **Candidats à relancer** | « Ont répondu, en attente » / « Aucune relance urgente » | `UserCheck` | `/pipeline` | warning | non |
| stagnant | **Candidats stagnants** | « Au-delà du temps cible » / « Pipeline fluide » | `AlertTriangle` | `/pipeline?view=analytics` | destructive | non |
| reminders | **Rappels du jour** | « À traiter aujourd'hui » / « Aucun rappel » | `Bell` | `/tasks` | success | non |

Carte : `rounded-xl border p-4 overflow-hidden`, active → `bg-{tone}/[0.04] hover:bg-{tone}/[0.08] border-{tone}/20 hover:border-{tone}/40` + halo `-top-12 -right-12 h-32 w-32 blur-2xl` pulsant (3 s) ; inactive → `bg-card border-border hover:bg-muted/40`. Tile icône `h-9 w-9 rounded-lg` (`bg-{tone}/10 text-{tone}` si actif, sinon **`bg-emerald-500/15 text-foreground`**). Compteur `font-display text-2xl font-bold tabular-nums` (`text-muted-foreground/60` si 0), label `text-[13px] font-semibold`, description `text-xs truncate`. `ArrowRight w-4 h-4` en hover-reveal. `LivePulse` si actif + `live`.

### 3.5 Ligne combo `missions-today`
`grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6` — `DashboardMissionsPanel` sur `lg:col-span-2`, `DashboardTodayPanel` sur 1 col.

#### `DashboardMissionsPanel`
Carte `rounded-xl bg-card border border-border overflow-hidden` (entrée y:12, delay 0.1).
Header `flex justify-between px-5 py-4 border-b border-border bg-muted/20` : tile `h-9 w-9 rounded-lg bg-emerald-500/15 text-foreground` + `Briefcase w-4 h-4` ; h2 **« Mes missions »** (`font-display font-bold text-[15px] tracking-tight leading-none`) ; sous-titre `text-xs text-muted-foreground mt-1` = **« Aucune mission active »** ou **« N mission(s) active(s) »**.
Actions header :
- **« Déplier » / « Réduire »** (si ≥1 mission) — `h-7 px-2.5 rounded-full border border-border bg-background hover:bg-accent text-[11px] font-medium`, icônes `Maximize2` / `Minimize2` `w-3 h-3`, aria-label et title « Tout déplier » / « Tout réduire ». Toggle global des cards.
- **« Voir tout »** + `ArrowRight w-3 h-3` — `text-xs text-muted-foreground hover:text-foreground font-medium` → `/missions`.

Corps `p-3 space-y-2`, stagger 0.06 / delayChildren 0.1. Max **5 missions**, filtre `status==='active'`, tri par `last_search_at || updated_at` desc.
- **Loading** : 3 blocs `h-[60px] rounded-xl bg-muted/40 animate-pulse`.
- **Vide** : `rounded-xl border border-dashed border-border p-8 text-center`, cercle `h-10 w-10 rounded-full bg-emerald-500/15` + `Sparkles w-5 h-5`, **« Aucune mission active »** (`text-sm font-medium`), **« Créez une mission pour commencer à sourcer »** (`text-xs text-muted-foreground`), bouton **« Créer une mission »** `h-9 px-4 rounded-full bg-foreground text-background text-[12px] font-medium` + `Plus w-3.5 h-3.5` → `/missions?create=brief`.
- **Card** : `rounded-xl bg-card border border-border hover:shadow-md hover:border-foreground/20 overflow-hidden`, `whileHover y:-2`. Ligne principale = bouton `p-3 flex items-center gap-3` → `/missions/{id}` : `MissionCompanyLogo size=40`, titre `font-display font-bold text-[14px]`, pill statut, résumé inline si collapsed (`client_name · 👥total 📤messaged ✅shortlisted`, icônes `w-3 h-3`, `CheckCircle2 text-success/70`), `ArrowRight` hover-reveal.
- **Pills statut** `text-[10px] px-2 py-0.5 rounded-full border uppercase tracking-wider font-semibold` : **Active** `border-success/40 bg-success/10 text-success` · **En pause** `border-warning/40 bg-warning/10 text-warning` · **Terminée** `border-info/40 bg-info/10 text-info` · **Archivée** `border-border bg-muted/40 text-muted-foreground`.
- Chevron expand : `absolute right-3 bottom-3 h-6 w-6 rounded-md opacity-0 group-hover:opacity-100`, `ChevronDown w-4 h-4` (rotate-180 si ouvert), aria-label « Réduire »/« Voir le détail », `aria-expanded`. ⚠ Positionné `absolute` mais la card n'est pas `relative` (le `relative` est sur le wrapper parent) → **chevauche la ligne suivante**.
- Détail expandé (`AnimatePresence`, height auto, 0.25 s) `px-3 pb-3 space-y-1.5 pt-1 border-t` : 3 `ProgressRow` — **Sourcés** (`Users`, barre `bg-foreground/60`), **Contactés** (`Send`, `bg-info/60`), **Shortlist** (`CheckCircle2`, `bg-success/60`) — barre `h-1.5 bg-muted/60 rounded-full`, valeur `font-bold tabular-nums w-8 text-right`, compteur animé 700 ms. Puis « il y a {distance} » (`Clock w-3 h-3`, `text-xs text-muted-foreground/70 pt-2 mt-2 border-t border-border/60`).
- Persistance des cards ouvertes : `localStorage['dashboard-missions-expanded']` (array d'ids).

#### `DashboardTodayPanel`
Carte `rounded-xl bg-card border border-border overflow-hidden h-full flex flex-col` (delay 0.15).
Header identique en structure : tile `bg-emerald-500/15` + `CalendarClock w-4 h-4`, h2 **« Aujourd'hui »**, sous-titre = **« Pas d'événement programmé »** / **« {done}/{total} fait(s) · {upcoming} à venir »** / **« {N} événement(s) à venir »**.
Actions header :
- bouton `+` `h-7 w-7 rounded-lg text-muted-foreground hover:bg-muted/60`, `Plus w-3.5 h-3.5`, title **« Ajouter une tâche (Cmd+T) »** → ouvre `CreateTaskModal`.
- **« Calendrier »** + `ArrowRight w-3 h-3` (si ≥1 item) → `/calendar`.

Barre de progression (si `done>0`) : `h-0.5 bg-muted/40` + `bg-success/60` animée.
Corps `p-2 flex-1 overflow-y-auto`. Agrège **entretiens qualif (`useCalendarEvents from=today days=1`) + messages programmés + rappels**, tri chronologique, **max 12**.
- **Loading** : 3 blocs `h-16 rounded-lg bg-muted/40 animate-pulse` dans `space-y-1.5 p-2`.
- **Vide** : `rounded-xl border border-dashed border-border py-8 px-6 text-center mx-1`, halo `bg-success/10 blur-2xl` pulsant, cercle `h-10 w-10 rounded-full bg-success/10 text-success` + `CheckCircle2 w-5 h-5`, **« Rien à l'agenda »** (`text-sm font-medium`), **« Aucun entretien, envoi ou rappel pour aujourd'hui. »**, bouton **« Ajouter une tâche »** `h-8 px-3 rounded-full border border-border bg-background hover:bg-accent text-2xs font-medium` + `Plus w-3.5 h-3.5`.

**Item type `event` (entretien)** — `rounded-lg p-2.5` ; états :
- live (`start ≤ now ≤ end`, ou <60 min) → `bg-success/[0.08] ring-1 ring-success/40`
- imminent (<30 min) → `bg-warning/[0.06] ring-1 ring-warning/30`
- sinon `hover:bg-muted/40` ; passé/fait → `opacity-60`
Colonne heure `w-12` : `font-display text-[12px] font-bold tabular-nums` (success / warning / `line-through text-muted-foreground` si passé). Sous l'heure : `LivePulse tone="success"` + **« Live »** (`text-3xs uppercase tracking-wider font-bold`), ou **« {N}min »** en warning, ou `— HH:mm` de fin.
`CandidateAvatar size=32` (fallback nom **« Profil LinkedIn »**) + overlay `MissionCompanyLogo size=14` en `absolute -bottom-0.5 -right-0.5 ring-2 ring-card rounded-md`.
Badges round `text-3xs font-bold uppercase tracking-wider px-1.5 h-3.5 rounded-full` : **Final** `bg-warning/15 text-warning` · **1er** `bg-foreground/[0.08] text-foreground/80` · **{n}e** `bg-info/10 text-info`. Icône `Sparkles w-2.5 h-2.5` si `calendlyEventId`. Ligne meta `text-2xs` : `clientName` (semi-gras) ` · ` `jobTitle`.
Indicateur droit : `CheckCircle2 w-3.5 h-3.5 text-success` (fait) / `Video` (visio) / `Clock`.
CTA visio (si live ou imminent + lien http) : `<a target="_blank" rel="noopener noreferrer">` `h-7 px-2.5 rounded-full text-2xs font-medium`, **« Rejoindre maintenant »** (`bg-success text-success-foreground`) si live sinon **« Rejoindre »** (`bg-foreground text-background`), icônes `Video w-3 h-3` + `ExternalLink w-2.5 h-2.5`, conteneur `mt-2 pl-[60px]`.

**Item type `reminder`** — heure (rouge `text-destructive` si en retard, barrée si fait), checkbox custom `h-5 w-5 rounded-md border-2` (fait : `bg-success/20 border-success/60 text-success` + `CheckCircle2 w-3 h-3`), title **« Marquer fait » / « Marquer non fait »** ; toggle → `supabase.update(candidate_reminders.completed_at)` puis `invalidateQueries(['all-reminders'])` (**aucun toast, aucun état d'erreur affiché**). Tile `h-7 w-7 rounded-lg bg-warning/10 text-warning` + `Bell w-3.5 h-3.5`. Titre `text-xs font-medium` (`line-through` si fait), sous-titre `text-2xs` = `candidate_name || job_title || 'Rappel'`. Clic contenu → **`window.location.href`** (`/pipeline?candidate={id}` ou `/tasks`) ⚠ full reload.

**Item type `message`** — `motion.button` `whileHover x:2` → `/missions`. Heure, `CandidateAvatar size=28` (`avatarUrl` toujours `null`), nom (`recipientName || 'Profil LinkedIn'`), badge `text-3xs … rounded-full` : **InMail** `bg-info/15 text-info` + `Mail w-2 h-2` · **Séq.** `bg-foreground/[0.08] text-foreground/70` + `Send w-2 h-2`. Sous-titre = sujet InMail, ou `{sequenceName} · Étape {n+1}`, ou headline, ou `—`. Indicateur droit `CheckCircle2 text-success` / `Clock`.

Sheets/modals montés : `EventDetailSheet`, `CreateTaskModal`.

### 3.6 `DashboardWeekHighlight`
Carte `rounded-xl bg-card border border-border overflow-hidden` (delay 0.2). Header `flex flex-col lg:flex-row lg:items-center justify-between gap-4 px-5 py-4 border-b bg-muted/20`, halo `bg-success/10 blur-3xl` si tone positif. Tile `h-9 w-9 rounded-lg ring-1` + `Sparkles w-4 h-4` — tone : positif `bg-success/10 text-success ring-success/30`, négatif `bg-destructive/10 text-destructive ring-destructive/30`, neutre **`bg-emerald-500/15 text-foreground ring-border`**. Eyebrow **« Cette semaine »**, h2 headline `font-display font-bold text-[15px] tracking-tight truncate`.

Headline calculée (seuil : delta ≥ 10 %, base ≥ 3) : `« +32% de réponses cette semaine »` / `« … de candidats contactés … »` / `« … de nouveaux candidats … »`, fallback `« N candidat(s) contacté(s) cette semaine »`, `« N nouveau(x) candidat(s) cette semaine »`, sinon **« Pas encore d'activité cette semaine »**.

Bouton **« Analytics complet »** + `ArrowRight w-3 h-3` : `h-8 px-3 rounded-full border border-border bg-background hover:bg-accent text-[11.5px] font-medium` → `/pipeline?view=analytics`.

Grille stats `grid grid-cols-2 lg:grid-cols-4 divide-x divide-y lg:divide-y-0 divide-border`, cellules `px-4 py-3.5` :
| Label | Icône | Sparkline tone |
|---|---|---|
| **Ajoutés** | `Users w-3.5 h-3.5` | neutral |
| **Contactés** | `Send` | info |
| **Réponses** | `MessageCircle` | positive/negative selon delta |
| **Placements** | `CheckCircle2` | positive (`threshold=1`) |
Tile `h-7 w-7 rounded-lg bg-emerald-500/15 text-foreground`, `Sparkline width=64 height=20`, valeur `font-display text-xl font-bold tabular-nums`, label `text-[10px] uppercase tracking-wider font-medium mt-1.5`.
Trend badge (si `prev ≥ threshold`) : `text-[10px] font-bold tabular-nums px-1.5 py-0.5 rounded-full`, `bg-success/10 text-success` ou `bg-destructive/10 text-destructive`, `TrendingUp`/`TrendingDown w-2.5 h-2.5`, `+N%`. Si |delta| < 5 % → `Minus w-2.5 h-2.5 text-muted-foreground/70`.

### 3.7 `DashboardActivityFeed`
Carte `rounded-xl bg-card border border-border overflow-hidden` (delay 0.25). Header : tile `bg-emerald-500/15` + `Activity w-4 h-4`, h2 **« Activité récente »**, sous-titre **« Derniers mouvements sur vos candidats »**, bouton **« Tout voir »** + `ArrowRight w-3 h-3` → `/pipeline?view=timeline`.
Corps `p-2`, **8 entrées max**, triées par date desc.
- **Vide** : `rounded-xl border border-dashed border-border py-10 px-6 text-center mx-1`, cercle `h-10 w-10 rounded-full bg-emerald-500/15` + `Clock w-5 h-5`, **« Aucune activité récente »**, **« Les mouvements de candidats s'afficheront ici. »**
- Entrée : `motion.button` `rounded-lg px-3 py-2.5 hover:bg-muted/40`, `whileHover x:2`, clic → `CandidateDetailModal`. `CandidateAvatar size=36` (photos LinkedIn batch via `useCandidateAvatars`) + pastille action `absolute -bottom-0.5 -right-0.5 h-4 w-4 rounded-full ring-2 ring-card` avec icône `w-2.5 h-2.5`.
- Texte : `{nom}` (`font-display font-semibold tracking-tight`) + ` {verbe}` (muted), description `text-xs text-muted-foreground truncate`. `LivePulse` si <30 min. Temps relatif `il y a {x}` en `text-[10.5px] tabular-nums`.

| Condition | Verbe | Description | Icône / tons |
|---|---|---|---|
| stage `Gagné` | **placé** | « Sur {jobTitle} » / « Placement confirmé » | `CheckCircle2`, `bg-success/10 text-success` |
| stage `Perdu` | **perdu** | « Sur {jobTitle} » / « Candidat fermé » | `XCircle`, `bg-destructive/10 text-destructive` |
| réponse (`replied`/`interested`/stage Répondu) | **a répondu** | headline / jobTitle / « Nouvelle réponse » | `MessageCircle`, `bg-info/10 text-info` |
| stage ITW/Pré-qualif/CV envoyé/Offre | **avance** | « Étape : {stage} » | `TrendingUp`, `bg-emerald-500/15 text-foreground` |
| `messaged` / stage Contacté | **contacté** | sequenceName / jobTitle / « Outreach lancé » | `ArrowRight`, `bg-emerald-500/15` |
| stage Nouveau & createdAt = lastDate | **sourcé** | « Pour {jobTitle} » / « Ajouté au pipeline » | `UserPlus`, `bg-emerald-500/15` |
| `notesCount > 0` | **commenté** | « N note(s) » | `StickyNote`, `bg-emerald-500/15` |

### 3.8 Atomes dashboard
- **`LivePulse`** : `h-2 w-2 rounded-full` + ping infini 1.6 s ; tones `success/warning/destructive/info` ; label optionnel `text-[10px] uppercase tracking-wider font-bold text-muted-foreground`. Commentaire annonce « respecte prefers-reduced-motion » — ⚠ **faux, aucun `useReducedMotion`**.
- **`CandidateAvatar`** : `rounded-full ring-1 ring-border`, taille en `style` inline, palette **déterministe 8 couleurs** (`blue/emerald/violet/amber/rose/cyan/indigo/pink` `-500/15` + `text-{c}-700 dark:text-{c}-300`), `font-display font-bold tracking-tight`, `text-[10px]` <32 / `text-xs` 32-39 / `text-sm` ≥40, `aria-hidden` sur le fallback.
- **`MissionCompanyLogo`** : `rounded-xl object-contain bg-white ring-1 ring-border` ; cascade `logoUrl` → `logo.clearbit.com/{slug}.com` → `.fr` → `google.com/s2/favicons?sz=128` → tile initiales (palette 8 couleurs `-500/10`). ⚠ **appels réseau tiers non consentis + `bg-white` en dur**.
- **`Sparkline`** : SVG maison, `stroke hsl(var(--success|destructive|foreground/0.6|info))`, fill `/0.15`–`/0.08`, `strokeWidth 1.5`, dot `r=2.5`, `pathLength` animé 0.8 s.

---

## 4. `/agents` — Agents IA

**Route** `/agents` · `ProtectedRoute > OrganizationGuard > AppLayout` · **pas de `PageLayout`, pas de `SEOHead`**.
Conteneur : `min-h-screen bg-background` > `max-w-[1200px] mx-auto px-4 sm:px-6 py-6` ⚠ (max-width et paddings ≠ Dashboard/Marketplace).
Données : `useQuery(['agent-conversations', organizationId])` sur `agent_conversations` (`archived_at is null`, tri `updated_at` desc, `staleTime 30s`, `enabled: !!organizationId`).

**Loading** : conteneur `max-w-[1200px] mx-auto px-4 sm:px-6 py-6` + `<BrutalLoader variant="default" rows={3} messages={['Chargement des agents...']} />` (⚠ ellipse ASCII `...`, pas `…`).

**Header** `flex items-center justify-between mb-6` :
- h1 **« Agents IA »** `text-xl font-bold uppercase tracking-tight` ⚠ (uppercase, `text-xl` fixe — ≠ `text-xl sm:text-2xl` ailleurs)
- p **« Vos agents de sourcing autonomes »** `text-xs text-muted-foreground mt-0.5`
- bouton **« Nouvel agent »** : `flex items-center gap-2 h-9 px-4 text-xs font-medium border border-border bg-foreground text-background hover:bg-foreground/90` (**pas de radius**), `Plus w-3.5 h-3.5` → `navigate('/missions')`

**Groupe « Agents actifs (N) »** (si ≥1 `running`) : titre `text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3` précédé d'un dot `w-2 h-2 rounded-full bg-accent animate-pulse`. Liste `space-y-2`.
**Groupe « Historique (N) »** (status ≠ running) : même titre, sans dot.

**AgentCard** — `<button>` `w-full flex items-center gap-4 p-4 border border-border bg-card hover:bg-muted/30 text-left rounded-lg group` → `openConversation(agent.id)` (ouvre l'`AgentDrawer`).
- Tile `w-10 h-10 border border-border rounded-lg bg-muted/30` + `Bot w-5 h-5 text-muted-foreground`
- Titre `text-sm font-semibold truncate` = `title || job_title || search_config.summary || 'Agent sans titre'`
- **Badges statut** `inline-flex gap-1 px-2 py-0.5 text-[10px] font-medium border rounded-full` + icône `w-2.5 h-2.5` :

| status | Libellé FR | Icône | Classes |
|---|---|---|---|
| `calibrating` | **Calibration** | `Clock` | `text-warning bg-warning/10 border-warning/30` |
| `plan_proposed` | **Plan proposé** | `AlertCircle` | `text-primary bg-primary/10 border-primary/30` |
| `running` | **En cours** | `Play` | `text-accent bg-accent/10 border-accent/30` |
| `completed` | **Terminé** | `CheckCircle` | `text-muted-foreground bg-muted border-border` |
| `paused` | **En pause** | `Pause` | `text-warning bg-warning/10 border-warning/30` |
| `failed` | **Erreur** | `AlertCircle` | `text-destructive bg-destructive/10 border-destructive/30` |
*(fallback = `calibrating`)*
- Meta `text-xs text-muted-foreground gap-3` : « {N} shortlistés » (`font-medium text-accent`, si >0), « {N} scannés », date `toLocaleDateString('fr-FR', {day:'numeric', month:'short', hour:'2-digit', minute:'2-digit'})`
- `ChevronRight w-4 h-4 text-muted-foreground/40 group-hover:text-foreground`

**Vide** (aucune conversation) : `flex flex-col items-center py-16 text-center`, carré `w-14 h-14 border border-border` (**pas de radius**) + `Bot w-6 h-6`, h2 **« Aucun agent »** (`text-sm font-bold uppercase tracking-wider mb-2`), p **« Créez un agent depuis une mission pour lancer le sourcing autonome. »** (`text-xs max-w-md mb-6`), bouton **« Aller aux missions »** `h-9 px-5 text-xs font-medium border border-border bg-foreground text-background` (⚠ pas de `hover:`).

⚠ **Aucun état d'erreur de requête** (`isError` non traité) : un échec affiche l'état vide. Pas de toast, pas de dialog, pas de menu contextuel, pas de filtre/onglet.

---

## 5. `/marketplace` — Marketplace

**Route** `/marketplace` · `ProtectedRoute > OrganizationGuard > AppLayout` · **pas de `PageLayout`** mais copie manuelle : `min-h-screen bg-background` > `py-6 pb-14` > `max-w-[1600px] mx-auto px-3 sm:px-6 lg:px-8` ⚠ (`pb-14` vs `pb-8` du `PageLayout`).
**SEO** : « Marketplace | Konekt » / « Missions en mode chasse et cercle de recruteurs partenaires ».

**Header** `flex items-center justify-between mb-6` : `Target w-6 h-6 text-foreground`, h1 **« Marketplace »** `text-xl sm:text-2xl font-bold tracking-tight`, sous-titre `text-xs text-muted-foreground uppercase tracking-wider mt-0.5` :
- entreprise → « Vos missions proposées aux recruteurs partenaires »
- cabinet/indépendant partenaire → « Missions confiées par les entreprises »
- cabinet/indépendant non partenaire → « Cercle de recruteurs partenaires »
- sinon → « Missions en mode chasse »

**Aiguillage du body**
| Condition | Rendu |
|---|---|
| `orgLoading \|\| (isRecruiterOrg && partnerLoading)` | spinner `py-20`, `w-5 h-5 border border-border border-t-foreground animate-spin` (**carré**, pas `rounded-full`) |
| `orgType === 'enterprise'` | `EnterpriseHuntMissions` |
| recruteur + partenaire | `PartnerMarketplace` |
| recruteur + suspendu | `PartnerCircleCard` (max-w-2xl) + `PartnerMissionsSection` |
| recruteur autre | `PartnerCircleCard` (max-w-2xl) |
| **orgType absent** | bloc `border border-border p-12 text-center max-w-2xl mx-auto space-y-3`, `Target w-8 h-8`, « Indiquez le type de votre organisation pour utiliser la marketplace. » (`text-sm`), « Une entreprise publie ses missions, un cabinet ou un indépendant rejoint le cercle de recruteurs partenaires. » (`text-xs`), lien **« Ouvrir les paramètres »** `h-9 px-4 border border-border text-xs font-medium uppercase tracking-wider hover:bg-muted` → `/settings` |
Puis toujours `PlatformAdminPanel` (rend `null` si non admin plateforme).

### 5.1 `PartnerMarketplace` — onglets
Barre `flex items-center gap-1 border-b border-border mb-6 overflow-x-auto` ; onglet `h-10 px-4 text-xs font-medium uppercase tracking-wider border-b-2 -mb-px whitespace-nowrap`, actif `border-foreground text-foreground`, inactif `border-transparent text-muted-foreground hover:text-foreground`. **Onglets locaux non persistés en URL.**
1. **Missions ouvertes** (défaut) · 2. **Mes candidatures** · 3. **Missions en cours**

Atomes partagés du module :
- `Spinner` : `py-20`, `w-5 h-5 border border-border border-t-foreground animate-spin` (carré)
- `EmptyBox` : `border border-dashed border-border p-12 text-center`, `Target w-8 h-8 mx-auto mb-3`, h3 `text-sm font-bold uppercase tracking-wider mb-2`, p `text-xs text-muted-foreground`
- `Tag` : `inline-flex gap-0.5 px-2 py-0.5 text-xs font-bold uppercase tracking-wider border border-border`, `muted` → `text-muted-foreground`
- `ErrorBox` : `border border-destructive/30 bg-destructive/5 p-6 space-y-3`, `AlertTriangle w-4 h-4 text-destructive`, titre `text-sm`, detail `text-xs`, `<Button size="sm" variant="outline" className="rounded-full">Réessayer</Button>`

#### Onglet « Missions ouvertes »
**Toolbar** `flex flex-wrap items-center gap-3 mb-6` :
| Contrôle | Détail |
|---|---|
| Champ recherche | `input` natif, `w-full h-9 pl-9 pr-3 text-sm border border-border bg-background focus:outline-none`, wrapper `flex-1 min-w-[200px] max-w-[400px]`, icône `Search w-3.5 h-3.5 absolute left-3`. Placeholder : **« Rechercher un poste, une entreprise... »**. Filtre sur name / client_name / organization_name / job title / location. ⚠ `focus:outline-none` **sans** focus-visible → a11y. |
| Select contrat | `<select>` natif `h-9 px-3 text-xs font-medium uppercase tracking-wider border border-border bg-background`. Options : **Tous les contrats**, CDI, CDD, Freelance, Alternance, Stage, Intérim |
| Select mode | idem. Options : **Tous les modes**, Sur site, Hybride, Télétravail à 100 % |
| Compteur | `ml-auto`, `text-xs text-muted-foreground uppercase tracking-wider` : « N mission(s) » |

**États** : loading → `Spinner` · erreur → `ErrorBox("Impossible de charger les missions ouvertes.")` · vide → `EmptyBox("Aucune mission disponible", "Aucune entreprise ne propose de mission pour le moment." | "Aucune mission ne correspond à vos filtres.")`.

**Grille** `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4` ; card `border border-border bg-background hover:shadow-sm flex flex-col` (**pas de radius**), corps `p-4 space-y-3 flex-1` :
- h3 `text-sm font-bold uppercase tracking-wider` = `jd.title || mission.name`
- société `text-xs uppercase tracking-wider mt-0.5` + `Building2 w-3 h-3` (fallback « Entreprise »)
- Tags : contrat (`muted={false}`), lieu (`MapPin w-2.5 h-2.5`), remote, séniorité
- Skills (5 max) : `px-1.5 py-0.5 text-xs font-medium bg-foreground text-background uppercase tracking-wider` ; surplus `+N` en `text-xs text-muted-foreground`
- Bloc rému `pt-2 border-t border-border space-y-1 text-xs` : `Percent w-3 h-3` + « {X} % du salaire annuel » ou **« Rémunération à confirmer avec l'entreprise »** ; `Users w-3 h-3` + « {accepted}/{max} recruteurs » (max défaut 3) ; si deadline `Calendar w-3 h-3` + **« Date limite : {jj/mm/aaaa} »** en `text-warning`
- Footer `border-t border-border p-3` :
  - déjà candidat → `ApplicationBadge` `w-full h-9 border text-xs font-medium uppercase tracking-wider` : **« Candidature envoyée »** (pending, `border-warning/40 text-warning`), **« Collaboration terminée »** (ended, `border-border text-muted-foreground`), **« Candidature acceptée / non retenue / retirée »** (`border-success/40 text-success` si accepted)
  - sinon bouton `w-full h-9 border border-border text-xs font-medium uppercase tracking-wider bg-foreground text-background disabled:bg-muted disabled:text-muted-foreground` : **« Postuler »**, ou **« Places pourvues »** si `accepted_count >= max` (disabled)

**Dialog « Postuler »** (`Dialog` shadcn, taille par défaut) :
- Titre **« Postuler à cette mission »**, description = `{titre}` + ` chez {client}`
- Label `text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5` : **« Message (facultatif) »**
- `Textarea rows={4} maxLength={1000}` placeholder **« Pourquoi cette mission vous correspond, vos placements similaires, votre disponibilité. »**
- Encart `text-xs text-muted-foreground border border-border p-3` : « Rémunération : {X} % du salaire annuel, facturée par vous à l'entreprise à l'embauche. » ou « L'entreprise n'a pas encore fixé la rémunération. Demandez-la dans votre message. »
- Footer : **« Annuler »** (`h-9 px-4 border border-border text-xs font-medium uppercase tracking-wider`, disabled si `isApplying`) · **« Envoyer ma candidature »** (`bg-foreground text-background`, `Loader2 w-3 h-3 animate-spin` si en cours, `disabled:opacity-60`)
- Fermeture bloquée pendant `isApplying`
- Toasts : succès **« Candidature envoyée »** (sonner) / erreur = `err.message`

#### Onglet « Mes candidatures »
Liste `border border-border divide-y divide-border` ; ligne `p-4 flex items-center gap-4 flex-wrap` :
- titre `text-sm font-bold uppercase tracking-wider`
- meta `text-xs text-muted-foreground mt-0.5` : société · « {X} % du salaire annuel » · « envoyée le {date} » · statut chasse si ≠ published/in_progress
- message éventuel `text-xs italic line-clamp-2` entre « … »
- Badge statut : `px-2 py-0.5 text-xs font-bold uppercase tracking-wider border border-border text-muted-foreground` — libellés **En attente / Acceptée / Non retenue / Retirée / Terminée** ⚠ **toujours gris, aucune couleur sémantique**
- si `pending` → bouton **« Retirer »** `h-8 px-3 border border-border text-xs … hover:bg-muted disabled:opacity-50`
- si `accepted` → bouton **« Ouvrir la mission »** + `ArrowRight w-3 h-3`, `bg-foreground text-background` → `/missions/{project_id}`
- États : `Spinner` · `ErrorBox("Impossible de charger vos candidatures.")` · `EmptyBox("Aucune candidature", "Vos candidatures aux missions ouvertes apparaîtront ici.")`
- **AlertDialog retrait** : titre **« Retirer cette candidature ? »**, description « Votre candidature à « {titre} » sera retirée. Vous ne pourrez pas postuler de nouveau à cette mission. », **« Annuler »** / **« Retirer »** (`bg-destructive text-destructive-foreground hover:bg-destructive/90`). Toast succès **« Candidature retirée »**.
⚠ Le `AlertDialog` est rendu **à l'intérieur** de la liste `divide-y` (dernier enfant) → bordure fantôme.

#### Onglet « Missions en cours »
Grille `grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4` ; card-bouton `text-left border border-border bg-background p-4 hover:shadow-sm` → `/missions/{id}`. Titre `text-sm font-bold uppercase tracking-wider`, société + `Building2 w-3 h-3`, pied `mt-3 pt-3 border-t border-border text-xs` : statut chasse (uppercase) + « {X} % du salaire annuel ».
États : `Spinner` · `ErrorBox("Impossible de charger vos missions en cours.")` · `EmptyBox("Aucune mission en cours", "Les missions sur lesquelles une entreprise vous a accepté apparaîtront ici.")`.

### 5.2 `PartnerCircleCard`
Carte `rounded-xl border border-border bg-card p-4 sm:p-6 space-y-5`.
- **loading** : même carte, `p-6 flex items-center justify-center`, `Loader2 w-4 h-4 animate-spin text-muted-foreground`
- **erreur** : `AlertTriangle w-4 h-4 text-destructive`, « Impossible de charger votre statut partenaire. » + detail, `<Button size="sm" variant="outline" rounded-full>Réessayer</Button>`
- **Header** : `IconTile icon={Shield} size="md"` (= `h-9 w-9 rounded-lg bg-emerald-500/15 text-foreground`), h3 **« Cercle partenaires »** (`font-display text-sm font-bold tracking-tight`), p « Missions confiées par des entreprises aux recruteurs validés par Konekt. »

**Statuts** :
| Statut | Bloc |
|---|---|
| `active` | `rounded-lg border border-success/30 bg-success/10 p-4`, `CheckCircle2 w-4 h-4 text-success`, « Votre organisation fait partie du cercle partenaires depuis le {date}. » + lien **« Voir les missions ouvertes »** + `ArrowRight w-3 h-3` (`underline underline-offset-4`) → `/marketplace` (⚠ lien vers la page courante) |
| `pending_validation` | `rounded-lg border border-warning/30 bg-warning/10 p-4`, `Clock w-4 h-4 text-warning`, « Demande envoyée le {date}. L'équipe Konekt examine chaque demande avant d'ouvrir l'accès. Vous pouvez encore modifier votre fiche ci dessous. » (⚠ « ci dessous » sans trait d'union) |
| `suspended` | `rounded-lg border border-destructive/30 bg-destructive/10 p-4`, `Ban w-4 h-4`, « Votre accès au cercle est suspendu : … » + `mailto:l.garilhe@konekt.fr` **« Écrivez à l'équipe Konekt »** ⚠ **email en dur dans le code** |
| `inactive` && `!canRequest` | « Seul un propriétaire ou un administrateur de votre organisation peut envoyer cette demande. » (`text-xs text-muted-foreground`) |

**Pitch** (3 paragraphes, `text-sm text-foreground/90 leading-relaxed`) affiché si ≠ active.

**Formulaire** (masqué si `suspended`; `readOnly` si active/suspended/`!canRequest`) — `space-y-4 pt-4 border-t border-border`, labels `FieldLabel` = `text-[10px] uppercase tracking-wider text-muted-foreground font-semibold mb-1.5` :
| Champ | Composant | Placeholder | Contraintes |
|---|---|---|---|
| **Titre** | `Input` | « Recruteur tech senior, 8 ans en cabinet » | `maxLength=120`, requis (toast « Indiquez un titre ») |
| **Présentation** | `Textarea rows={4}` | « Vos secteurs, vos méthodes, vos derniers placements. » | `maxLength=1500`, requis (toast « Ajoutez une présentation ») |
| **Spécialisations** | pills + `Input` | « Ajoutez une spécialisation puis appuyez sur Entrée » | `maxLength=60`, ajout sur `Enter` **et** `onBlur`, dédoublonnage insensible à la casse. Pill = `inline-flex gap-1 px-2 py-0.5 rounded-full border border-border bg-muted/50 text-xs` + bouton `X w-3 h-3` (aria-label « Retirer {s} »). Lecture seule vide → « Aucune spécialisation renseignée. » |
| **URL LinkedIn** | `Input inputMode="url"` | « https://www.linkedin.com/in/votre-profil » | regex `^https:\/\/([a-z0-9-]+\.)?linkedin\.com\/` ; toast « Indiquez l'adresse de votre profil LinkedIn (https://www.linkedin.com/in/...) » |

Submit : `<Button type="submit" size="sm" className="rounded-full" disabled={isRequesting}>` + `Loader2 w-3.5 h-3.5 animate-spin mr-1.5`, label **« Demander à rejoindre le cercle »** ou **« Mettre à jour ma demande »** (si pending). Toast succès **« Demande envoyée »**.
⚠ Pré-remplissage du profil une seule fois par `userId` (`prefilledFor` ref).

### 5.3 `EnterpriseHuntMissions`
`space-y-6`. Deux groupes, titres `text-xs font-bold uppercase tracking-wider text-muted-foreground mb-3` : **« Proposées aux recruteurs »** (statuts published/in_progress/filled/cancelled) et **« En préparation »** (le reste, affiché seulement si non vide).
Liste `border border-border divide-y divide-border` ; `MissionRow` `p-4 flex items-center gap-4 flex-wrap` :
- titre `text-sm font-bold uppercase tracking-wider`
- meta `text-xs gap-3 flex-wrap` : client, « {X} % du salaire annuel », `Calendar w-3 h-3` + date
- si deadline dépassée (statut published/in_progress) : « Date limite dépassée : la mission n'est plus proposée aux recruteurs. » `text-xs text-warning mt-1`
- badge statut chasse `px-2 py-0.5 text-xs font-bold uppercase tracking-wider border border-border text-muted-foreground` (**Brouillon / Publiée / En cours / Pourvue / Annulée**)
- `Clock w-3 h-3` + « {N} en attente » · `Users w-3 h-3` + « {a}/{max} recruteurs »
- bouton **« Gérer »** + `ArrowRight w-3 h-3` : `h-8 px-3 border border-border text-xs … bg-foreground text-background` → `/missions/{id}?tab=config`
États : spinner inline `py-20` `w-5 h-5 border border-border border-t-foreground animate-spin` · `ErrorBox("Impossible de charger vos missions publiées.")` · vide `border border-dashed border-border p-12 text-center` + `Target w-8 h-8`, **« Aucune mission publiée »**, « Activez le mode chasse dans la configuration d'une mission, puis publiez-la pour la proposer aux recruteurs partenaires. » ⚠ **duplique `EmptyBox` au lieu de l'importer**.

### 5.4 `PartnerMissionsSection`
Rend `null` si org non recruteur ou 0 mission. Erreur → ligne `mb-6 flex gap-3 text-xs` : « Vos missions partenaires n'ont pas pu être chargées. » + bouton **« Réessayer »** `h-7 px-2.5 border border-border text-[11px] font-medium uppercase tracking-wider hover:bg-muted`.
Header `Handshake w-4 h-4 text-muted-foreground` + **« Missions partenaires »** (`text-[11px] uppercase tracking-wider font-semibold`) + « N mission(s) confiée(s) par une entreprise » (`text-[10px] text-muted-foreground/70`).
Card `w-full text-left bg-card border border-border rounded-xl p-4 hover:border-foreground/30 hover:shadow-md hover:-translate-y-px transition-all duration-200` → `/missions/{id}` ; titre `font-semibold text-[14px] truncate`, badge statut `text-[10px] px-1.5 py-0.5 rounded-full bg-muted text-muted-foreground`, meta `text-[12px]` avec `Building2 w-3 h-3`.
⚠ **Style radicalement différent** (rounded-xl, hover-lift) des autres listes marketplace (brutalist, sans radius).

### 5.5 `PlatformAdminPanel`
`<section class="mt-12 pt-8 border-t border-border">` — rendu seulement si `isPlatformAdmin` (edge function `marketplace-admin` / `whoami`).
Header : h2 **« Administration du cercle »** (`text-xs font-bold uppercase tracking-wider text-muted-foreground`), p « Demandes d'adhésion des cabinets et indépendants. Visible de l'équipe Konekt seulement. », bouton **« Actualiser »** `h-8 px-3 border border-border text-xs … hover:bg-muted` + `RefreshCw w-3 h-3` (`disabled={isLoading}`).
États : loading `py-10` + `Loader2 w-4 h-4 animate-spin` · `ErrorBox("Impossible de charger les demandes.")` · vide `text-xs text-muted-foreground border border-dashed border-border p-6 text-center` **« Aucune demande pour le moment. »**
Table shadcn dans `border border-border overflow-x-auto`, en-têtes `text-[10px] uppercase tracking-wider` : **Organisation · Type · Demandeur · Date · Statut · Membres (droite) · Actions (droite)**.
Cellules : org `text-sm font-medium` ; type via `orgTypeLabel` (**Entreprise / Cabinet / Indépendant / Organisation**) ; date `formatDate` + « (validé le {date}) » si actif ; statut badge `px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider border border-border text-muted-foreground` — **Inactif / En attente / Actif / Suspendu** ; membres `tabular-nums`.
Actions : **« Valider »** (si ≠ active) `h-7 px-3 border border-border text-[11px] … bg-foreground text-background disabled:opacity-50` · **« Suspendre »** (si ≠ suspended) `h-7 px-3 … hover:bg-muted disabled:opacity-50`.
AlertDialog : titre **« Valider ce partenaire ? »** / **« Suspendre ce partenaire ? »** ; descriptions « Tous les membres de « {org} » verront les missions ouvertes et pourront postuler. Les propriétaires et administrateurs recevront une notification. » / « Les membres de « {org} » ne verront plus les missions ouvertes. Les collaborations en cours ne sont pas modifiées. » ; actions **« Annuler »** / **« Valider »**|**« Suspendre »** (destructive sur suspend). Toasts : **« Partenaire validé »** / **« Partenaire suspendu »**.

### 5.6 Autres toasts du module (`useMarketplace.ts`)
« Demande envoyée » · « Candidature envoyée » · « Candidature retirée » · « Candidature acceptée » / « Candidature refusée » · « Collaboration terminée » · « Partenaire validé » / « Partenaire suspendu » · « Mission publiée sur la marketplace » / « Réglages enregistrés ». Erreurs : `toast.error(err.message)` — **message serveur brut, non traduit**.

---

## 6. `/‌*` — `NotFound.tsx`
Aucun guard, aucun layout. `flex min-h-screen items-center justify-center bg-background`, `SEOHead` (« 404 — Page introuvable | Konekt » / « La page que vous cherchez n'existe pas. »).
- h1 **« 404 »** `mb-4 text-4xl font-bold text-foreground uppercase tracking-wider`
- p **« Page introuvable »** `mb-4 text-xl text-muted-foreground`
- `<a href="/">` **« Retour à l'accueil »** `text-foreground underline hover:opacity-70 text-sm uppercase tracking-wider` ⚠ `<a>` natif → **full page reload**, et perd le preview token
- `console.error` en DEV uniquement

---

## 7. Responsive — synthèse

| Zone | Comportement |
|---|---|
| Sidebar | `< 768px` : Sheet 18rem, fermé au clic nav. `≥ 768px` : 16rem / 3rem (icon), toggle Cmd+B ou bouton header |
| Header | hauteur fixe `h-12`, jamais responsive |
| PageLayout | `px-3` → `sm:px-6` → `lg:px-8`, max 1600px |
| Greeting | `flex-col` → `lg:flex-row`, avatar `h-12→sm:h-14`, h1 `text-2xl→sm:text-3xl`, pills `flex-wrap` |
| Connections | `grid-cols-1 → sm:grid-cols-3` |
| Focus | `grid-cols-2 → lg:grid-cols-4` |
| Missions/Today | `grid-cols-1 → lg:grid-cols-3` (2+1) |
| Week stats | `grid-cols-2 divide-y → lg:grid-cols-4 lg:divide-y-0` |
| Drag handle | desktop `-left-7` (`hidden lg:flex`), mobile `right-2 top-2` |
| Notif popover | `w-[calc(100vw-1rem)] → sm:w-80` |
| Agents | `px-4 → sm:px-6`, cartes pleine largeur, **header non wrappé** (risque de débordement) |
| Marketplace grilles | `1 → md:2 → lg:3` ; toolbar `flex-wrap` ; lignes `flex-wrap` ; onglets `overflow-x-auto` |
| Marketplace tableau admin | `overflow-x-auto` |

Breakpoints utilisés : `sm 640`, `md 768`, `lg 1024`. **`xl` / `2xl` jamais utilisés** dans ces écrans.

---

## 8. ANOMALIES DESIGN

### 8.1 Valeurs en dur / hors échelle
- **Tailles de police arbitraires** (alors que `2xs`/`3xs` existent explicitement « pour bannir text-[Npx] ») : `text-[13.5px]`, `text-[13px]`, `text-[12px]`, `text-[11.5px]`, `text-[11px]`, `text-[10.5px]`, `text-[10px]`, `text-[14px]`, `text-[15px]`, `text-[16px]` — répartis dans `AppSidebar`, `SidebarUserMenu`, `DashboardGreeting`, `DashboardConnections`, `DashboardFocusPanel`, `DashboardMissionsPanel`, `DashboardTodayPanel`, `DashboardWeekHighlight`, `DashboardActivityFeed`, `PartnerMissionsSection`, `TutorialVideoDialog`. Cohabitation `text-[10px]` / `text-3xs` (= 10px) et `text-[11px]` / `text-2xs` (= 11px) : **doublons purs**.
- **Dimensions arbitraires** : `h-[19px] w-[19px]`, `h-[18px] w-[18px]`, `min-w-[18px] h-[18px]`, `min-w-[16px] h-4`, `min-w-[22px] h-5`, `h-[60px]`, `h-3.5` pour badge, `w-[calc(100vw-1rem)]`, `pl-[60px]`, `min-w-[200px] max-w-[400px]`, `max-h-[400px]`, `max-w-[1200px]`, `max-w-[1600px]`.
- **Couleurs hors tokens** : `rgba(0,0,0,0.18)` (boxShadow drag), `hover:bg-black/5` (LowCreditBanner), `bg-white` (MissionCompanyLogo), `bg-black` (vidéo tuto).
- **Opacités arbitraires** : `bg-foreground/[0.04]`, `/[0.06]`, `/[0.08]`, `bg-destructive/[0.04]`, `/[0.08]`, `bg-warning/[0.06]`, `/[0.10]`, `bg-success/[0.08]`, `/[0.12]` — pas de palette d'états définie.

### 8.2 Vert `emerald` hors système
`bg-emerald-500/15` (et `/30` en actif) est le **tile signature** mais provient de la palette Tailwind brute, **hors tokens CSS**. Occurrences : AppSidebar (nav), IconTile (`tone="default"`), DashboardFocusPanel (état inactif), MissionsPanel (header + empty), TodayPanel (header), WeekHighlight (header neutre + 4 StatCell), ActivityFeed (header, empty, 4 types d'événements). → **10+ duplications inline** alors que `IconTile` existe exactement pour ça, et qu'aucun token `--konekt-tile` n'est défini. Ne suit pas le thème clair/sombre.

### 8.3 Deux design languages coexistants
| Langage | Où | Signature |
|---|---|---|
| **« Brutalist »** | Agents, Marketplace (tous les sous-composants sauf PartnerCircleCard/PartnerMissionsSection), OrganizationGuard, ErrorBoundary, SectionErrorBoundary, `Section`, `StatTile`, `EmptyState`, NotFound | pas de radius, `border border-border`, `text-xs font-bold uppercase tracking-wider`, `bg-foreground text-background`, `bg-background` |
| **« Soft SaaS »** | Dashboard entier, PartnerCircleCard, PartnerMissionsSection, sidebar, header | `rounded-xl/2xl`, `bg-card`, `font-display`, boutons `rounded-full`, `shadow-md`, framer-motion partout |
Les deux se croisent **dans la même page** : `/marketplace` mêle cards sans radius (PartnerMarketplace) et cards `rounded-xl` hover-lift (PartnerMissionsSection, PartnerCircleCard).

### 8.4 Boutons — aucune primitive commune
Le composant `Button` shadcn n'est utilisé que dans 3 endroits (`InvitationBanner`, `ErrorBox`, `PartnerCircleCard`). Partout ailleurs : `<button>` nu stylé inline. Inventaire des « variants » de fait :
- `h-9 px-4 rounded-full bg-foreground text-background text-[12px] font-medium` (Dashboard primaire)
- `h-9 px-3.5 rounded-full border border-border bg-background hover:bg-accent text-[12px]` (Dashboard secondaire)
- `h-8 px-3 rounded-full border border-border bg-background hover:bg-accent text-[11.5px]` (WeekHighlight)
- `h-7 px-2.5 rounded-full border border-border … text-[11px]` (MissionsPanel toggle)
- `h-8 px-3 rounded-full … text-2xs` (TodayPanel empty)
- `h-9 px-4 border border-border bg-foreground text-background text-xs font-medium` **sans radius** (Agents, Marketplace, Dialog)
- `h-9 px-5 …` (Agents empty)
- `h-8 px-3 border border-border text-xs font-medium uppercase tracking-wider` (Marketplace secondaire)
- `h-7 px-3 border border-border text-[11px]` (admin)
- `h-8 px-4 text-xs … relative overflow-hidden` (OrganizationGuard, SectionErrorBoundary — classes `relative overflow-hidden group` **inutiles**, vestige d'un effet supprimé)
→ **≥ 10 tailles/formes** pour le même rôle sémantique. Hauteurs : 7, 8, 9 ; radius : `full`, `lg`, aucun ; casse : uppercase vs sentence case.

### 8.5 Incohérences de spacing / layout
- Max-width : `1600px` (Dashboard, Marketplace) vs `1200px` (Agents) vs `max-w-2xl` (blocs marketplace).
- Padding horizontal : `px-3 sm:px-6 lg:px-8` (Dashboard, Marketplace) vs `px-4 sm:px-6` (Agents).
- Padding vertical bas : `pb-8` (`PageLayout`) vs `pb-14` (Marketplace, recopie manuelle).
- Marketplace et Agents **réimplémentent `PageLayout`** au lieu de l'importer ; les trois pages ignorent `PageHeader` → 3 styles de titre : `text-xl sm:text-2xl font-bold tracking-tight` (Marketplace), `text-xl font-bold uppercase tracking-tight` (Agents), `font-display text-2xl sm:text-3xl` (Dashboard greeting).
- Espacement inter-sections Dashboard : chaque section porte son propre `mb-6` (parfois via un wrapper `div.mb-6` dans `Dashboard.tsx`, parfois en interne) → **`Reorder.Group` en `space-y-0`**, l'espacement dépend du composant. `missions-today` a `mb-6` sur la grille, `week` et `activity` sur un wrapper externe, `connections`/`focus` en interne. Fragile au réordonnancement.

### 8.6 Radius incohérents
Même famille de composants, radius différents : cards Dashboard `rounded-xl`, greeting `rounded-2xl`, tiles `rounded-lg`, avatars/`LivePulse` `rounded-full`, MissionCompanyLogo `rounded-xl`, badges `rounded-full` (Dashboard) vs **aucun radius** (Marketplace/Agents), boutons `rounded-full` vs `rounded-lg` vs rien, dropdown `rounded-xl` (override sur un composant shadcn déjà `rounded-md`).

### 8.7 Badges / pills — 5 systèmes parallèles
1. Statut mission Dashboard : `rounded-full border` + tone success/warning/info/muted
2. Statut agent : `rounded-full border` + tone warning/primary/accent/muted/destructive
3. Statut hunt/candidature marketplace : **carré, monochrome `border-border text-muted-foreground`** (aucune sémantique de couleur)
4. Badge candidature (`ApplicationBadge`) : pleine largeur `w-full h-9`, colorée — **un badge déguisé en bouton**
5. Badge compteur : `rounded-full bg-destructive` avec seuil **`99+`** (sidebar, user menu) vs **`9+`** (cloche header) → incohérent
Et `PartnerMissionsSection` en ajoute un 6e : `rounded-full bg-muted text-muted-foreground`.

### 8.8 Patterns dupliqués
- **Spinner** : 5 implémentations — `w-9 h-9 rounded-full` (App), `w-6 h-6 rounded-full` (ProtectedRoute, OrganizationGuard), `w-5 h-5` **carré** (Marketplace, EnterpriseHuntMissions, PartnerMarketplace), `Loader2` lucide (PartnerCircleCard, PlatformAdminPanel), `BrutalLoader` (Agents). Aucune primitive.
- **Empty state** : `EmptyState` du design system **jamais utilisé** ; 6 réimplémentations (`EmptyBox` marketplace, empty inline `EnterpriseHuntMissions`, `Agents`, `MissionsPanel`, `TodayPanel`, `ActivityFeed`, `NotificationDropdown`) avec paddings `py-8` / `py-10` / `py-12` / `py-16` / `p-8` / `p-12`.
- **Header de carte Dashboard** : `flex justify-between px-5 py-4 border-b bg-muted/20` + tile emerald + h2 `font-display text-[15px]` — copié **4 fois** à l'identique (Missions, Today, Week, Activity), aucun composant partagé.
- **Bouton « Voir tout / Tout voir / Calendrier »** : `inline-flex gap-1 text-xs text-muted-foreground hover:text-foreground font-medium` + `ArrowRight w-3 h-3` — 3 copies, **3 libellés différents pour le même rôle**.
- **`getInitials()`** dupliqué 3 fois (DashboardGreeting, CandidateAvatar, MissionCompanyLogo) ; **`TILE_PALETTE`** dupliquée 2 fois avec opacités différentes (`/15` vs `/10`).
- **ErrorBox** (marketplace) vs bloc erreur `OrganizationGuard` vs `SectionErrorBoundary` : même design, 3 implémentations.
- **Toggle thème** implémenté 2 fois (AppSidebar avec persistance, NavigationPalette **sans**) → désynchronisation possible.

### 8.9 Accessibilité / comportement
- `focus:outline-none` sans `focus-visible` sur l'input de recherche marketplace et les deux `<select>`.
- `<select>` et `<input>` **natifs** dans marketplace alors que `Select`/`Input` shadcn existent → styles hors système, flèches natives.
- `window.location.href` (TodayPanel rappels) et `<a href="/">` (NotFound) → rechargement complet, perte de contexte SPA + preview token.
- `Reorder.Item` sans alternative clavier (drag pointer uniquement).
- `LivePulse` et toutes les animations infinies (halos pulsants, pings) **ignorent `prefers-reduced-motion`** — seul `AppLayout` l'honore.
- Chevron expand de `MissionCard` positionné `absolute` sans parent `relative` sur la card.
- `StatGrid` : classes `sm:${…}` construites dynamiquement → **purgées par Tailwind**, les breakpoints ne fonctionnent pas.
- Agents : `isError` non géré (erreur ⇒ écran « Aucun agent »).
- Dashboard : aucun skeleton global, les sections apparaissent/disparaissent (CLS).
- Toasts d'erreur marketplace = `err.message` serveur brut, non localisé.
- Raccourcis `G D` / `G M` / `G P` affichés dans la palette mais non implémentés.
- `InvitationBanner` et `TutorialVideoDialog` : composants existants **jamais montés** sur ces écrans.
- `selectedJobId` / `JobDetailSheet` dans `Dashboard.tsx` : code mort.
- `AppHeader` accepte `children` — jamais utilisé, donc **aucune page ne peut poser d'action dans le header** ; toutes les toolbars sont réimplémentées dans le corps de page.

---

**Résumé (10 lignes)**
1. Shell = `App.tsx` (31 routes, `ProtectedRoute > OrganizationGuard > AppLayout`), `AppLayout` (sidebar 16rem/3rem/18rem-mobile + header `h-12`), transitions framer-motion enter-only.
2. Sidebar : 8 entrées à plat (Dashboard, Missions, Recherche, Pipeline, Calendrier, Tâches, Messages+badge, Marketplace), tiles `bg-emerald-500/15`, footer user-menu 7 items + branding.
3. Dashboard : `PageLayout` 1600px, greeting + 5 sections drag-to-reorder persistées en localStorage, ~40 éléments interactifs, tous les libellés FR relevés.
4. Agents : page autonome 1200px, 6 badges de statut, 1 CTA, 1 empty state, **aucun état d'erreur**.
5. Marketplace : 4 branches d'affichage selon `orgType`/statut partenaire, 3 onglets, 2 selects, 1 dialog de candidature, 1 formulaire 4 champs, panneau admin en table.
6. Deux design languages incompatibles cohabitent (« brutalist » sans radius vs « soft SaaS » `rounded-xl`), parfois dans la même page.
7. Les primitives `layout/` (PageHeader, Section, EmptyState, StatTile) sont **inutilisées** par les 3 écrans ; `StatGrid` est cassé (classes dynamiques purgées).
8. ≥ 10 « variants » de bouton inline, 5 spinners, 6 empty states, 5 systèmes de badges, headers de cartes copiés 4×.
9. Nombreuses valeurs en dur : `text-[Npx]` (10 variantes, doublonnant `2xs`/`3xs`), `rgba()`/`bg-white`/`bg-black`, `emerald-500` hors tokens.
10. A11y : `focus:outline-none`, inputs natifs, `window.location.href`, animations infinies sans `prefers-reduced-motion`.

**Chemin cible du fichier** (non écrit — mode lecture seule) : `/tmp/claude-0/-home-user-remix-of-event-template/1e4c1f57-e74c-58fe-8aea-c74377091c17/scratchpad/inventory/02-shell-dashboard.md`

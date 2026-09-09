# 08 — Pages publiques, Auth, Onboarding, Portails

Repo `/home/user/remix-of-event-template` · React 18 + Vite + TS · shadcn/ui + Tailwind · FR

## 0. Cadre global

**Routes publiques** (`src/App.tsx` L153-191) — aucune n'est enveloppée dans `<AppLayout>` (contrairement à toutes les routes app : `/missions`, `/pipeline`, `/dashboard`… = `ProtectedRoute > OrganizationGuard > AppLayout`).

| Route | Composant | Fichier | AppLayout | Protected |
|---|---|---|---|---|
| `/` | `SkalrLanding` (lazy) | `src/pages/SkalrLanding.tsx` | non | non |
| `/index` | `<Navigate to="/">` | — | — | — |
| `/auth` | `Auth` (eager) | `src/pages/Auth.tsx` | non | non |
| `/onboarding` | `Onboarding` (lazy) | `src/pages/Onboarding.tsx` | non | **oui** (`ProtectedRoute`, pas d'`OrganizationGuard`) |
| `/portal/:token` | `CandidatePortal` | `src/pages/CandidatePortal.tsx` | non | non |
| `/client/:token` | `ClientPortalV2` | `src/pages/ClientPortalV2.tsx` | non | non |
| `/r/:slug` | `RecruiterPublicProfile` | `src/pages/RecruiterPublicProfile.tsx` | non | non |
| `/privacy` | `PrivacyPage` | `src/pages/Privacy.tsx` | non | non |
| `/privacy-extension` | `PrivacyExtensionPage` | `src/pages/PrivacyExtension.tsx` | non | non |
| `/unsubscribe` | `Unsubscribe` | `src/pages/Unsubscribe.tsx` | non | non |
| `/pricing` | `Pricing` | — | non | non |

`PUBLIC_ROUTES = ['/', '/index', '/auth', '/portal', '/client', '/pricing']` (App.tsx L52) — **`/r/`, `/privacy`, `/privacy-extension`, `/unsubscribe` n'y figurent pas** → un `SIGNED_OUT` sur ces routes déclenche le `SessionExpiredDialog`.

**Thème** (`src/index.css`) : `:root` = **dark par défaut** (`--background: 40 3% 11%`), classe `.light` = clair. `darkMode: ["class"]` (tailwind.config.ts L4).
Toutes les pages ci-dessus héritent du **dark**, **sauf `/`** qui force `.light` :

```tsx
// SkalrLanding.tsx L87-94
root.classList.add('light');
return () => { if (!hadLight) root.classList.remove('light'); };
```

**Polices** (`tailwind.config.ts` L16-60 + `index.html` L20-30, chargées via Google Fonts) :
`font-brand` = Bricolage Grotesque → Outfit · `font-sans` (body) = Instrument Sans · `font-display` = Outfit · `font-serif` = Instrument Serif · `font-mono` = Space Mono · `.font-editorial` (utility CSS, index.css L296) = `'Instrument Serif', Georgia, serif`.
`h1,h2,h3` globaux forcés en `Outfit / 700` (index.css L241-244) — écrasé au cas par cas par `font-editorial`/`font-brand`.
Space Grotesk est préchargée dans `index.html` mais **absente** de la config Tailwind (police morte).

**Échelle typo custom** : `text-3xs` (10px/14px), `text-2xs` (11px/15px) — tailwind.config.ts L143-149, avec commentaire « Bannit l'usage de `text-[Npx]` arbitraires ».

**Tokens couleurs spécifiques** (index.css L54-88) :
- `--skalr-purple: 271 81% 56%`, `--skalr-pink: 330 81% 60%`, `--skalr-blue: 217 91% 60%`, `--skalr-cyan`, `--skalr-green`
- `--landing-sky-start: 200 80% 95%` / `--landing-sky-end: 220 70% 92%` / `--landing-accent-yellow: 50 100% 60%`
- `--brand-linkedin: 201 100% 35%` → `bg-linkedin` / `hover:bg-linkedin-hover`
- statuts : `--status-success|warning|info` (+ `-muted`, `-foreground`)
- jeu `--k-*` (Linear/Qonto, accent indigo) — **jamais utilisé sur les pages publiques**

**Utilitaires visuels** (index.css L283-308, L393-434) :
`.skalr-gradient-text`, `.skalr-gradient-bg`, `.skalr-gradient-border` (linear-gradient 135° violet→rose→bleu) · `.landing-sky-gradient` (180°, sky-start→sky-end) · `.konekt-skalr-bg` (gradient animé `konektBgPan` 8s) · `.konekt-skalr-bg-soft` · `.konekt-skalr-text` · `.konekt-glow` · `.konekt-shine` (balayage 2.5s) · `.konekt-fade-up` · `.konekt-shimmer-text` · `.stagger-in` · `@media (prefers-reduced-motion)` neutralise `.interactive-card/.interactive-row/.stagger-in` **mais pas** `.konekt-shine`/`.konekt-skalr-bg`/`.konekt-glow`.

**Où sont employées ces classes sur le périmètre :**
| Classe | Emplois |
|---|---|
| `.font-editorial` | landing (h1 `<em>`, h2 features/values/stats/FAQ/CTA, blockquote témoignage), toutes les h2 des scènes onboarding, `ChapterInterstitial`, `SceneLaunch` h1, `CollaboratorWelcome` h1, ClientPortalV2 (prénom client dans header + overlay) |
| `.landing-sky-gradient` | landing HERO (L303) + CTA FINAL (L588) uniquement |
| `--landing-sky-start/end` en dur | carte visuelle features `bg-gradient-to-br from-[hsl(var(--landing-sky-start))] to-[hsl(var(--landing-sky-end))]` (L391) |
| `--landing-accent-yellow` | badge « Match IA » (L394) — **seul emploi de l'app** |
| `.skalr-gradient-border` | `LandingProductDemo` filet supérieur (L147) |
| `.konekt-skalr-bg` | ClientPortalV2 : barre 1px du header (L296), avatar fallback (L303), overlay onboarding (L360, L362), bouton « C'est parti » (L396), filet du sheet (L989) |
| `.konekt-shine` | ClientPortalV2 (avatar, icône overlay, CTA) + `SceneLaunch` bouton « Lancer Konekt » |
| `.konekt-fade-up` | ClientPortalV2 overlay + sheet + backdrop |
| `.konekt-shimmer-text` | `SceneOrganization` — dernière bulle agent pendant le scan (L407) |
| `--skalr-purple/pink` en dur | `RecruiterPublicProfile` avatar initiales (L123), `Pill variant="ai"` |

---

## 1. `/` — SkalrLanding (`src/pages/SkalrLanding.tsx`, 717 l.)

**Thème** : `.light` forcé au mount, retiré au unmount. **Largeur** : `max-w-6xl mx-auto px-6` (nav, features, values, stats, footer) · `max-w-5xl` (hero) · `max-w-3xl` (témoignage, CTA final) · `max-w-2xl` (FAQ) · `max-w-3xl` (démo produit).
**Racine** : `min-h-screen bg-background text-foreground`.
**SEO** : title `Konekt — Plateforme de recrutement tout-en-un`, desc `Trouvez, engagez et recrutez vos meilleurs talents. Sourcing LinkedIn, séquences automatisées et suivi candidat.`, keywords `recrutement saas, sourcing linkedin, ats, talent acquisition`.
**Redirection** : `useRedirectIfAuthenticated` → si session valide, `navigate('/missions')` (L19-49).

### Composant local `BrutalButton` (L54-79) — **non shadcn**
```
relative group inline-flex items-center gap-2 h-12 px-7 text-xs font-semibold uppercase tracking-wider
border-2 border-border transition-all duration-200
primary : bg-foreground text-background hover:shadow-md
outline : bg-background text-foreground hover:shadow-md
```
Pas de `variant`/`size` shadcn, pas de `type="submit"` explicite (il sert quand même de submit dans la modale contact), **pas de `disabled`** (le bouton d'envoi reste cliquable pendant `isSubmitting`).

### 1.1 NAV (L175-222)
`fixed top-0 z-50 bg-background/90 backdrop-blur-md border-b border-border`, hauteur `h-14`.
- `<KonektLogo variant="full" theme="dark" size={28} ariaLabel="Konekt — accueil" />` (⚠️ `theme="dark"` = logo **bleu navy**, cf. KonektLogo.tsx : `light` = logo blanc)
- Liens ancre (`hidden md:flex`, `text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground font-medium`) : **Produit** → `#produit`, **Résultats** → `#resultats`, **FAQ** → `#faq` (scrollIntoView smooth)
- **Tarifs** → `navigate('/pricing')`
- **Démo** (`hidden sm:inline-flex`) → ouvre modale Calendly
- **Commencer** `<BrutalButton className="h-9 px-5 text-xs">` + `ArrowRight h-3 w-3` → `/auth`
- Burger `md:hidden`, `h-9 w-9 rounded-md border`, `aria-label="Ouvrir le menu"`, icône `Menu`

### 1.2 Drawer mobile (L225-300)
`fixed inset-0 z-[60] md:hidden bg-background`, fade in/out (framer). Header : logo + bouton `X` `aria-label="Fermer le menu"`.
Items pleine largeur `py-4 text-base font-display font-bold uppercase tracking-wide … border-b` : **Produit**, **Résultats**, **FAQ** (ferme puis scroll après 250 ms), **Tarifs** (200 ms), **Démo** (250 ms). Puis `BrutalButton w-full h-12 text-sm` **Commencer** + `ArrowRight`.

### 1.3 HERO (L303-363) — `landing-sky-gradient pt-28 pb-20 px-6`, `text-center`
- Eyebrow : `inline-flex … text-xs uppercase tracking-wider font-semibold border-2 border-border px-4 py-1.5 bg-background shadow-sm` + carré `w-2 h-2 bg-accent` — texte **« Plateforme de recrutement »**
- H1 : `font-brand font-extrabold text-5xl sm:text-6xl md:text-7xl lg:text-[5.25rem] leading-[1.0] tracking-[-0.035em]` — **« Le recrutement, *simplifié* et accéléré »** (`simplifié` = `<em className="font-editorial italic font-normal">`)
- Sous-titre `text-base md:text-lg text-muted-foreground max-w-2xl` : « Trouvez, engagez et recrutez vos meilleurs talents — avec clarté et efficacité. »
- CTAs : `BrutalButton` primary **« Réserver une démo »** → modale Calendly ; `BrutalButton variant="outline"` **« Essai gratuit 14 jours, sans carte »** + `ArrowRight h-3.5` → `/auth`
- `<LandingProductDemo />` dans `max-w-3xl`
- Animations : opacity/y avec delays 0 / 0.1 / 0.2 / 0.3 / 0.4 s

### 1.4 LandingProductDemo (`src/components/landing/LandingProductDemo.tsx`, 328 l.)
Fausse fenêtre d'app **câblée en dur sur le thème sombre** (`bg-[hsl(40,3%,14%)]`, `text-[hsl(0,0%,98%)]`, `border-white/10`, `text-[hsl(40,2%,56%)]`) alors que la page est en `.light`. `aria-hidden`, `aria-label` sur le conteneur.
Chorégraphie en boucle de **11 s** (`LOOP_MS = 11000`), timings : frappe 38 ms/car. dès 350 ms, focus 1900, lignes 2050, score 2900 (count-up 900 ms, ease cubic), pill 3900, curseur 4300, clic 5350, « Ajoutée » 5520, toast 5900, curseur off 9600, fade 10300. `useReducedMotion` → `FINAL_STATE` figé.
Contenu : titre fenêtre `konekt.app — Mission · Product Designer Senior` ; onglets `Aperçu / Brief / Sourcing / Pipeline` (Sourcing actif) ; compteur `Entretiens 4→5` ; recherche `Product Designer Senior · Paris` + kbd `⌘K` ; bouton `Scorer les profils` ; ligne principale **Camille Roy — Product Designer Senior · Paris · 8 ans**, chips `Figma / Design system / B2B SaaS`, pill `✓ À contacter`, anneau score **92**, bouton `Ajouter à la séquence` → `✓ Ajoutée` ; 3 lignes secondaires (Noah Bertrand 86 · Léa Mercier 81 · Théo Nguyen 78) ; toast « Camille ajoutée à la séquence / Mission · Product Designer Senior ».

### 1.5 FEATURES `#produit` (L366-441) — `py-24 bg-background`
Eyebrow `Fonctionnalités` ; H2 `font-editorial text-4xl sm:text-5xl md:text-6xl tracking-tight leading-[1.1]` : « Tout ce qu'il faut pour sourcer, / qualifier et recruter ».
Grille `md:grid-cols-2 gap-12` :
- **Gauche** : carte `aspect-[4/3] border-2 border-border` en `bg-gradient-to-br from-[hsl(var(--landing-sky-start))] to-[hsl(var(--landing-sky-end))] shadow-md`, encart `bg-background border-2 p-4 max-w-[280px]` avec badge **« Match IA »** (`bg-[hsl(var(--landing-accent-yellow))] text-xs font-bold uppercase`), texte « Score 94% — profil idéal pour votre poste », légende « Ajuster les critères → ». ⚠️ `absolute bottom-6 left-6` **sans parent `relative`** (le parent `relative` est le wrapper motion → positionnement fortuit).
- **Droite** : liste numérotée `border-b border-border last:border-b-0`, icône `w-10 h-10 border-2` + `group-hover:bg-accent` :
  1. `001` **Sourcer** (`Search`) — « Recherche LinkedIn avancée avec filtres intelligents sur tout votre vivier de talents. »
  2. `002` **Qualifier** (`Brain`) — « Scoring IA automatique de chaque profil par rapport à vos offres d'emploi. »
  3. `003` **Engager** (`Send`) — « Séquences d'InMails personnalisées par l'IA avec relances automatiques. »
  4. `004` **Suivre** (`LayoutGrid`) — « Pipeline kanban, inbox unifiée et notes collaboratives pour tout centraliser. »
  Puis `BrutalButton` **« Découvrir la plateforme »** + `ArrowRight` → `/auth`.
  Numéros en `font-mono` (Space Mono).

### 1.6 VALUES (L444-477) — `py-24 border-t border-b bg-muted/30`
H2 `font-editorial text-4xl sm:text-5xl` : « Conçu pour la clarté. / *Pensé pour l'action.* ».
3 cartes `border-2 border-border bg-background p-6 hover:shadow-md`, pastille `w-8 h-8 border-2 bg-accent` avec `01/02/03` :
1. **La vitesse crée la valeur** — « Contactez 3× plus de candidats qualifiés chaque semaine grâce à l'automatisation intelligente. »
2. **Le recrutement est un système** — « Nous connectons sourcing, engagement et suivi dans un flux continu et mesurable. »
3. **La qualité avant le volume** — « Le scoring IA priorise les profils pertinents pour maximiser votre taux de conversion. »

### 1.7 STATS `#resultats` (L480-514)
Eyebrow `Résultats` ; H2 `font-editorial` « Des résultats concrets ». 3 cartes `text-center py-14 border-2`, valeur `text-5xl md:text-6xl font-bold` :
`×3` / « Profils contactés par semaine » — `−60%` / « Temps de sourcing » — `+80%` / « Taux de réponse ».

### 1.8 TÉMOIGNAGE (L517-543) — `py-20 border-t border-b bg-foreground text-background` (inversion)
Eyebrow `Témoignage` (`text-background/60`). Blockquote `font-editorial text-2xl sm:text-3xl md:text-4xl leading-[1.3]` : « "Konekt a transformé notre façon de recruter. On contacte 3× plus de candidats qualifiés, et notre taux de réponse a explosé." ». Avatar carré `w-10 h-10 border-2 border-background bg-accent` lettre `T`, **« Head of Talent, Scale-up Tech »** / « Équipe de 80 personnes ». Témoignage **fictif, non attribué**.

### 1.9 FAQ `#faq` (L546-585) — `max-w-2xl`, `border-2 border-border divide-y-2 divide-foreground`
Boutons accordéon `w-full py-5 px-6 … hover:bg-muted/30`, libellé `font-semibold text-sm uppercase tracking-wide`, chevron `rotate-180` à l'ouverture. Un seul ouvert (`openFaq`).
1. **Comment ça marche ?** — « Connectez votre compte LinkedIn via notre intégration sécurisée, configurez vos filtres de recherche, et laissez Konekt trouver, scorer et contacter les meilleurs profils pour vous. »
2. **Mon compte LinkedIn est-il protégé ?** — long paragraphe (heures ouvrées, plafonds quotidiens/hebdo, montée en charge, pause automatique, pas de double sollicitation, identifiants jamais en clair).
3. **Combien de messages puis-je envoyer ?** — « Cela dépend de votre abonnement LinkedIn et de votre plan Konekt… »
4. **C'est gratuit ?** — « Konekt propose un essai gratuit… Nos plans sont ensuite adaptés à la taille de votre équipe. »
⚠️ Animation `height: 0 → auto` **sans `opacity`** et sans `aria-expanded`/`aria-controls`.

### 1.10 CTA FINAL (L588-613) — `py-28 landing-sky-gradient border-t`
H2 `font-editorial text-4xl sm:text-5xl md:text-6xl` : « Vos prochains talents *vous attendent* ». P : « Rejoignez les équipes qui recrutent mieux, plus vite et à moindre coût. »
Boutons — **ordre inversé par rapport au hero** : primary **« Essai gratuit 14 jours, sans carte »** → `/auth` ; outline **« Réserver une démo »** → Calendly.

### 1.11 FOOTER (L616-627) — `py-8 border-t-2`
Logo `size={24}` · **Tarifs** (button → `/pricing`) · **Mentions légales** (`<a href="/privacy#mentions">` — ⚠️ ancre `#mentions` **inexistante** dans `Privacy.tsx`) · **Confidentialité** (`<a href="/privacy">` — full reload) · **Contact** (button → modale) · `© {année} Konekt`.

### 1.12 Modale Calendly (L630-656)
Overlay `fixed inset-0 z-50 bg-foreground/40 backdrop-blur-sm`, panneau `max-w-3xl h-[80vh] bg-background border-2 shadow-lg`, bouton `X` `w-9 h-9 border-2 hover:bg-accent`, `<iframe src={CALENDLY_URL} title="Réserver une démo">`.
⚠️ `CALENDLY_URL = 'https://calendly.com/demo/30min'` (L51) — **URL placeholder en dur**. Pas de fermeture ESC, pas de focus trap, `role="dialog"` absent.

### 1.13 Modale Contact (L659-711)
Titre **« Nous contacter »** (`text-lg font-bold uppercase tracking-wide`), sous-titre « Laissez-nous un message, nous revenons vers vous rapidement. »
Champs (`<Input>`/`<Textarea>` shadcn + `className="rounded-lg border-2 border-border"`), labels `text-xs font-semibold uppercase tracking-wider` :

| Label | Placeholder | Type | Validation |
|---|---|---|---|
| `Nom *` | `Votre nom` | text | `required` + trim non vide |
| `Email *` | `vous@entreprise.com` | email | `required` + trim non vide |
| `Entreprise` | `Nom de votre entreprise` | text | optionnel |
| `Message *` | `Comment pouvons-nous vous aider ?` | textarea `min-h-[120px]` | `required` + trim non vide |

Submit : `BrutalButton w-full justify-center` → `Envoyer` + `ArrowRight`, ou `<Loader2 animate-spin /> Envoi...` si `isSubmitting`.
Actions : insert `contact_submissions` (Supabase) puis `invokeEdgeFunction('notify-notion', …)` (échec silencieux, `console.warn`).
**Toasts exacts** :
- validation KO → `{ title: "Erreur", description: "Veuillez remplir tous les champs obligatoires.", variant: "destructive" }`
- succès → `{ title: "Message envoyé !", description: "Nous vous recontacterons très vite." }` + reset + fermeture
- échec → `{ title: "Erreur", description: "Une erreur est survenue.", variant: "destructive" }`

---

## 2. `/auth` — Auth (`src/pages/Auth.tsx`, 441 l.)

**Thème** : dark (aucun forçage). **Layout** : `min-h-screen flex items-center justify-center bg-background px-4`, colonne `w-full max-w-md space-y-8`. Pas d'AppLayout, pas de visuel/illustration, **pas de `landing-sky-gradient`** → rupture nette avec `/`.
**SEO dynamique** : `Connexion — Konekt` / `Inscription — Konekt` (+ descriptions « Connectez-vous à Konekt pour gérer vos recrutements » / « Créez votre compte Konekt pour piloter vos recrutements »).

### 2.1 Modes (4 états booléens, pas de tabs)
`isLogin` (défaut **true**, sauf arrivée `?invitation=` → **signup**), `isForgotPassword`, `isResettingPassword` (déclenché par hash `#type=recovery` ou `#type=magiclink`, ou event `PASSWORD_RECOVERY`), + écran `CollaboratorWelcome`.
**Pas de magic-link en émission** : le hash `type=magiclink` est capté mais traité comme un reset de mot de passe (L172).

| Mode | H2 (`text-2xl sm:text-4xl font-normal uppercase`) | Sous-titre |
|---|---|---|
| Connexion | `Connexion` | « Connectez-vous pour accéder à votre espace recrutement » |
| Inscription | `Inscription` | « Créez votre compte pour commencer à recruter » |
| Oubli MDP | `Mot de passe oublié` | « Entrez votre email pour recevoir un lien de réinitialisation » |
| Reset | `Nouveau mot de passe` | « Entrez votre nouveau mot de passe » |

### 2.2 Bandeau invitation (L308-321) — si `?invitation=`
`bg-info/10 border border-info/30 rounded-lg p-4 text-sm`.
Titre : `Vous êtes invité·e à rejoindre {?org=}` sinon « Vous avez été invité·e à rejoindre une équipe ».
Sous-titre : login → « Vous avez déjà un compte ? Connectez-vous pour accepter l'invitation. » ; signup → « Créez votre compte ci-dessous pour rejoindre l'équipe. »

### 2.3 Champs
| Mode | Champ | Placeholder | Type | Validation |
|---|---|---|---|---|
| login/signup/forgot | Email | `Email` | `email` | `required` |
| login/signup | Mot de passe | `Mot de passe` | `password` | `required` (aucun minLength) |
| reset | Nouveau MDP | `Nouveau mot de passe` | `password` | `required minLength={6}` |

**Aucun `<label>`** — placeholders seuls. Classe : `border-border text-foreground` sur `<Input>` shadcn.

### 2.4 Boutons / liens
- **Submit** (bouton `<button>` natif, pas shadcn) : `relative overflow-hidden w-full h-11 bg-foreground text-background border border-border text-xs font-medium uppercase tracking-wider group disabled:opacity-50`. Libellés : `Chargement...` | `Mettre à jour` | `Envoyer le lien` | `Connexion` | `Inscription`.
- Séparateur : trait + `<span className="bg-background px-2 text-muted-foreground">ou</span>` (masqué en reset/forgot).
- **`Continuer avec Google`** — `<Button variant="outline" className="w-full border-border text-foreground">` + SVG Google 4 couleurs inline (`#4285F4/#34A853/#FBBC05/#EA4335`). `signInWithOAuth({ provider: 'google' })`. Pas de `disabled` pendant l'appel.
- **`Mot de passe oublié ?`** — `text-sm text-muted-foreground hover:opacity-70` (visible en mode login seulement)
- Bascule — `text-sm text-foreground hover:opacity-70` : `Retour à la connexion` (forgot) | `Pas encore de compte ? S'inscrire` | `Déjà un compte ? Se connecter`
  ⚠️ ces deux `<button>` sont **hors `<form>` mais sans `type="button"`** → `type="submit"` par défaut (ici sans effet car hors form, mais fragile).
- Logo : `<Link to="/" aria-label="Retour à l'accueil"><KonektLogo variant="full" theme="dark" size={32} /></Link>`

### 2.5 Messages exacts (toasts)
| Événement | title | description |
|---|---|---|
| Reset OK | `Mot de passe mis à jour` | `Votre mot de passe a été changé avec succès.` |
| Forgot OK | `Email envoyé` | `Vérifiez votre boîte mail pour réinitialiser votre mot de passe.` |
| Login OK | `Connexion réussie` | `Bienvenue sur Konekt` |
| Signup OK (avec invit.) | `Compte créé` | `Vérifiez votre email puis revenez via le lien reçu : l'invitation sera acceptée automatiquement.` |
| Signup OK (sans) | `Compte créé` | `Compte créé avec succès.` |
| **Toute erreur** | `Erreur` | `error.message` — **message brut Supabase, en anglais** (`Invalid login credentials`, `User already registered`…) → aucune traduction FR |
| Invitation acceptée | `Invitation acceptée` | `Vous avez bien rejoint votre équipe.` |
| Invitation échouée | `Invitation non acceptée` | `error.message` |
| Plus de siège (`/siège/i`) | `Invitation en attente` | `${error.message} Rouvrez le lien d'invitation une fois un siège ajouté.` — `destructive`, `duration: 15000`, puis `signOut()` |
| Google OAuth KO | `Erreur` | `error.message` |

Erreur interne non affichée : `Impossible d'accepter l'invitation` (L100).

### 2.6 Redirections post-auth
Invitation `collaborator` → écran `CollaboratorWelcome`. Autre invitation → `markWelcomePending()` puis `/settings`. Sinon → `location.state.from` ou **`/missions`** (⚠️ jamais `/onboarding` : le tunnel n'est atteignable que par URL directe ou via `CollaboratorWelcome`).

### 2.7 `CollaboratorWelcome` (`src/components/onboarding/CollaboratorWelcome.tsx`, 77 l.)
`min-h-screen flex items-center justify-center bg-background px-4`, colonne `max-w-md text-center gap-6`.
Icône carrée `w-16 h-16 bg-foreground text-background` + `Building2`, `boxShadow: '0 4px 16px hsl(var(--primary) / 0.15)'` **en dur**.
H1 `font-editorial font-normal italic text-3xl sm:text-4xl` : « Vous avez rejoint {orgName}. » / « en tant que collaborateur externe. » / « Souhaitez-vous aussi créer votre propre espace de travail ? »
Boutons : **`Créer mon espace`** + `ArrowRight` (`bg-foreground text-background`, box-shadow inline) → `/onboarding?new=1` · **`Plus tard`** + `Clock` (`variant="outline"`) → `/dashboard`.

---

## 3. `/onboarding` — tunnel (`src/pages/Onboarding.tsx` + `src/components/onboarding/*`)

**Thème** : dark. **Protégé** par `ProtectedRoute` uniquement.
**Garde d'entrée** (L304-318) : si `step === 0`, pas de `?new=1`, tunnel jamais démarré → spinner `w-6 h-6 border border-border border-t-foreground rounded-full animate-spin` pendant `isOrgLoading`, puis `<Navigate to="/dashboard" replace />` si une org existe.
**Persistance** : `localStorage['konekt_onboarding_progress_v5']` (`onboardingStorage.ts`) — `{ step, scene, orgType, orgDetails, specializations, completed }`, purge des clés v4, purgé au `SIGNED_OUT` (App.tsx).

### 3.1 Flows (`onboardingMeta.ts`)
```
enterprise : orgtype → org → linkedin → launch          (4 étapes)
agency     : orgtype → org → linkedin → launch          (4 étapes)
freelance  : orgtype → orgdetails → specializations → linkedin → launch  (5 étapes)
```
Durées estimées (s) : `orgtype 10 · orgdetails 20 · specializations 20 · org 45 · linkedin 60`.
Chapitres : **Votre activité** (« Quelques questions pour adapter Konekt à votre métier. ») · **Votre société** (« On construit votre espace de travail automatiquement. ») · **Votre LinkedIn** (« Connectez votre compte LinkedIn, le moteur du sourcing. »).

### 3.2 `OnboardingShell` (127 l.)
`min-h-screen flex flex-col relative overflow-x-clip bg-background` + `<OnboardingBackdrop />`.
- **Barre de progression** : `fixed top-0 inset-x-0 h-px z-50 bg-foreground/10`, remplissage `bg-foreground`, largeur `(stepIndex+1)/flow.length * 100 %`, transition 0.6 s ease `[0.22,1,0.36,1]` — **1 px de haut, unique indicateur**.
- **Header** `px-5 sm:px-10 py-5` : logo `skalr-logo-concept-3.webp` `h-6` (⚠️ **pas** `KonektLogo`) + nom d'org (`text-xs`, `border-l pl-2.5`, `hidden sm:inline`) ; à droite `font-mono text-xs` : `01 / 4` (`tabular-nums`) + `≈ N min` (masqué sur la scène finale).
- **Fil de chapitres** `<nav aria-label="Chapitres">` `max-w-2xl`, `<ol>` `text-2xs font-mono uppercase tracking-wider`, séparateur `·`. Chapitre courant : `text-foreground underline decoration-emerald-500/70 decoration-2 underline-offset-4` + `aria-current="step"` ; fait : `text-muted-foreground` + `✓` (`text-success`) ; à venir : `text-muted-foreground/40`.
- **Main** : `mx-auto w-full max-w-2xl px-5 sm:px-8 py-8 sm:py-12`, colonne unique **alignée à gauche**.
- Zone scène : `min-height: 340px` en style inline.

**Transitions de scène** (Onboarding.tsx L274-294) : `x: ±90, opacity 0, scale .96, filter blur(8px)` → centre, `duration .45`, ease `[0.22,1,0.36,1]` ; `useReducedMotion` → simple fade.
`<InvitationBanner />` en haut (`max-w-lg mx-auto mb-4 empty:mb-0`).

### 3.3 `OnboardingBackdrop` (102 l.) — décoratif, `aria-hidden pointer-events-none`
3 blobs radiaux floutés (`blur(48px)`), tailles 640/560/460 px, couleurs `--foreground` (α .045 / .035) et **`--success`** (α .05), dérive 46/52/58 s en boucle infinie · grille 56 px `hsl(var(--foreground)/0.025)` avec masque radial · grain `feTurbulence` data-URI `opacity .5 mix-blend-overlay` · vignette radiale. Respecte `useReducedMotion` (blobs figés).

### 3.4 `ChapterInterstitial` (83 l.)
Overlay `fixed inset-0 z-40 bg-background/85 backdrop-blur-xl`, `role="status"`, cliquable, **auto-dismiss 2400 ms** (1200 ms si reduced motion).
`{i+1} — {total}` en `font-mono text-xs`, puis H2 `font-editorial italic text-5xl sm:text-6xl` révélé ligne par ligne (`y: 110% → 0`, 0.7 s, delays .1/.22) : « **Chapitre un —** / **votre activité.** » (ordinaux FR `un…six`, titre en minuscules), puis tagline `text-base mt-5`.

### 3.5 Étape 1 — `SceneOrgType` (70 l.)
H2 `font-editorial font-normal italic text-4xl sm:text-5xl leading-[1.08]` : **« Qui êtes-vous ? »**
P : « Konekt ne montre pas la même chose à une entreprise, un cabinet ou un indépendant. Tout part d'ici. »
`EditorialChoiceList mode="single"` — 3 options (auto-avance après **420 ms**, verrou `firedRef`) :

| Touche | Label | Description |
|---|---|---|
| `A` | **Je recrute pour mon entreprise** | Recrutements internes, avec ou sans cabinets externes. |
| `B` | **Je suis un cabinet de recrutement** | Vous recrutez pour vos clients, avec une équipe. |
| `C` | **Je suis recruteur indépendant** | En solo — missions RPO, succès, chasse. |

Note bas d'écran (`text-xs text-muted-foreground/60 mt-8`, delay .6 s) : « Cliquez ou tapez la lettre — la suite s'enchaîne toute seule. »
**Aucun bouton Précédent/Suivant.**

**`EditorialChoiceList`** (121 l.) : liste purement typographique, pas de cartes. Raccourcis clavier A-Z (`window keydown`, ignoré si focus INPUT/TEXTAREA/SELECT ou modificateur). Pastille lettre `w-5 h-5 text-2xs font-mono rounded-sm border` (sélectionnée : `bg-foreground text-background`). Label `text-lg` (ou `text-[15px]` en `dense`), sélection = `underline decoration-emerald-500/70 decoration-2 underline-offset-[6px]`. Hover : `translate-x-1`. Apparition échelonnée `delay 0.12 + i*0.045`. `role="radiogroup"|"group"`, `role="radio"|"checkbox"` + `aria-checked`.

### 3.6 Étape freelance A — `SceneOrgDetails` (233 l.)
H2 : freelance → **« Votre activité, concrètement. »** ; sinon → **« Votre équipe, concrètement. »** (branche non atteignable : `orgdetails` n'est que dans le flow freelance).
P : « Taille et volume calibrent vos quotas d'envoi et ce que l'IA Konekt vous recommande. »
Labels `text-xs font-bold uppercase tracking-wider text-muted-foreground`, `<Select>` shadcn `h-10 text-sm`, placeholder **`Sélectionnez`** partout.

- **Quel est votre mode d'intervention ?** (freelance, requis) : `RPO (embedded)` / `Au succès / Missions ponctuelles` / `Les deux`
- **Fourchette TJM indicative** (si `rpo` ou `both`, accordéon height auto) : double `<input type="range">` 200→1500 pas 50, défaut `[400, 700]`, `aria-label="TJM minimum"/"TJM maximum"`, thumbs `h-6 w-6 rounded-full border-[3px] border-background bg-foreground` via variants arbitraires `[&::-webkit-slider-thumb]:…`. Affichage `200€ … 400€ — 700€ / jour … 1500€`. Mention : « Facultatif — à titre indicatif uniquement. »
- **Taille de l'équipe recrutement** (non-freelance) : `Juste moi` / `2 – 5 personnes` / `6 – 20 personnes` / `21 – 50 personnes` / `50+`
- **Recrutements visés sur 12 mois** (freelance) / **Recrutements prévus sur 12 mois** : `1 – 5 recrutements` / `6 – 15 recrutements` / `16 – 40 recrutements` / `Plus de 40 recrutements`. Aide : « Sert à dimensionner vos quotas et vos suggestions de missions. »

Navigation : `<Button variant="ghost">` **`Retour`** + `ArrowLeft w-4` ‖ `<Button>` **`Suivant`** + `ArrowRight w-4`, `className="gap-2 border border-border bg-foreground text-background hover:bg-foreground/90 text-sm px-6"`, `disabled={!canSubmit}` (`teamSize && (!isFreelance || freelanceMode)`; `teamSize` pré-rempli à `'1'` en freelance).
⚠️ `tjm` est calculé et envoyé mais **jamais persisté** en base (`handleSpecializationsSubmitted` n'écrit que `org_type/team_size/specializations/freelance_mode/annual_hires`).

### 3.7 Étape freelance B — `SceneSpecializations` (93 l.)
H2 : **« Vos terrains de chasse ? »**
P : « Vos secteurs donnent son vocabulaire à l'IA Konekt : briefs, scoring des candidats et filtres de recherche pré-remplis avec les bons mots. »
`EditorialChoiceList mode="multi" columns={2} dense` — 22 options, raccourcis A→V :
`Tech / IT` · `Data / IA / ML` · `Product / Design` · `Finance / Compta` · `Sales / Business Dev` · `Marketing / Com` · `Ingénierie / Industrie` · `Santé / Pharma / Biotech` · `Juridique / Compliance` · `RH / People` · `Executive / C-level` · `Supply Chain / Logistique` · `BTP / Immobilier` · `Retail / E-commerce` · `Hôtellerie / Restauration` · `Éducation / Formation` · `Secteur public / ESS` · `Média / Édition / Créatif` · `Énergie / Environnement` · `Télécom / Réseaux` · `Généraliste` · `Autre`
Navigation : `<button>` texte **`Retour`** (`text-xs`, `ArrowLeft w-3.5`) ‖ `<Button>` **`Continuer`** + `ArrowRight`, `disabled={selected.size === 0}`.
Effet de bord : en freelance, la validation **crée l'organisation en silence** (nom = `full_name` ou préfixe email ou `Mon espace`, slug + `Date.now().toString(36)`) puis `update` de `organizations`. Erreur `ORG_ALREADY_EXISTS` → `toast.error('Vous faites déjà partie d'un espace de travail. Retrouvez-le depuis le tableau de bord.')` et **le tunnel se bloque** (pas d'avance).

### 3.8 Étape entreprise/cabinet — `SceneOrganization` (961 l.)
H2 : **« Votre société, en un mot. »**
P : « Donnez-nous son nom — on récupère logo, description et postes ouverts, et votre espace se construit tout seul. »
4 phases : `idle → scanning → disambiguate → results`.

**Barre de recherche** : bouton icône retour (`h-11 w-11 border`, `aria-label="Étape précédente"`) + `<Input>` `h-11 pl-11` placeholder **`Le nom de votre société...`** (`autoFocus`, submit sur `Enter`) avec icône `icon-search-3d.webp` + `<Button>` **`Rechercher`** (`h-11 px-5 bg-foreground text-background`, `disabled` si `< 2` car. ou scan en cours ; spinner `Loader2` pendant le scan).

**Phase scanning** — grille `sm:grid-cols-[180px_1fr]`, `min-h-[200px]`, durée minimale 2 s :
- 5 sources cochées une par une (800 ms + i×700) : `Base entreprises` · `LinkedIn` · `Web` · `WTTJ` · `Site carrière` — pastille `w-6 h-6 rounded-md border` → `bg-success/15 text-success` + `Check`
- 6 bulles agent (600 ms + i×800), dernière en `konekt-shimmer-text` : « Je recherche des infos sur cette société... » / « Enrichissement des données... » / « Lecture du site web en cours... » / « Recherche des décideurs clés... » / « Analyse des postes ouverts... » / « Enrichissement terminé. Voici ce que j'ai trouvé. »

**Phase disambiguate** : « Plusieurs entreprises trouvées pour "{query}" » / « Sélectionnez la bonne pour un enrichissement précis. » ; cartes cliquables (logo `logoUrl` → `logo.clearbit.com/{domain}` → icône `Building2`), méta `domain · industry · location · size emp.`, `ArrowRight`. Lien d'échappement : **« Aucune ne correspond — continuer sans ces données »** (`underline underline-offset-2`).

**Phase results** :
- Carte société `rounded-lg border p-3 sm:p-4` : logo 48 px (cascade clearbit → `google.com/s2/favicons` → `ui-avatars.com`), nom `text-lg`, badge **`Enrichi`** (`style={{ background:'hsl(var(--success) / 0.15)', color:'hsl(var(--success))' }}` ⚠️ variable inexistante), badge `{n} filiale(s)` (`GitBranch`), badge **`Signal d'achat détecté`** / **`Signal faible`** (`Signal`, couleurs **en dur** `hsl(142,71%,45%)` / `hsl(32,95%,44%)`), méta `size / location / funding` (`Users`/`MapPin`/`TrendingUp`).
- Onglets `border-b-2`, `px-4 py-2 text-xs font-semibold uppercase tracking-wider` : **`Aperçu`** · **`Insights`** (conditionnel) · **`Postes ouverts (n)`**
  - *Aperçu* : « Analyse recrutement » (`Sparkles`) — cartes insights structurés (`difficulty/salary/attractivity/timing` → `Target/DollarSign/Heart/Zap`) ou fallback liste plate (`border-l-2 border-l-emerald-500/50`) ; boutons `<Button variant="outline" size="sm" h-8>` **`Site web`** (`Globe`) et **`Page carrière`** (`Briefcase`), `target="_blank"`.
  - *Insights* : « Répartition des équipes » (barres `h-2 bg-success`), « Historique de levées » (timeline, montants `1.2B$/40M$/500K$`, dates `fr-FR month short`), « Actualités » (3 articles, `ExternalLink`, dates relatives FR : `Aujourd'hui` / `Il y a Nj` / `Il y a N sem.` / `Il y a N mois` / `Il y a N an(s)`).
  - *Postes ouverts* : `<Checkbox>` shadcn par poste, titre lié (`underline decoration-foreground/30`), `SourceBadge` (logos LinkedIn/WTTJ), `MapPin` + lieu. Vide → « Aucun poste ouvert détecté. Vous pourrez en créer manuellement plus tard. » ; doublons → « N doublon(s) masqué(s) » ; pied → « Les postes sélectionnés seront créés comme missions dans votre espace. »
- Navigation : `justify-end`, `<Button>` **`Continuer`** (`ArrowRight`) → **`Création...`** (`Loader2`) pendant l'appel. **Pas de bouton Retour dans cette phase.**

**AlertDialog second espace** : titre « Vous avez déjà un espace de travail », description longue (« …vos missions, crédits et comptes LinkedIn resteront dans l'espace existant. Voulez-vous vraiment créer un second espace ? »), boutons **`Annuler`** / **`Créer un second espace`** (`className="bg-destructive"`).
**Toasts** : `Impossible d'enrichir cette société. Les données de base seront utilisées.` · `Erreur lors de l'enrichissement.` · `Cette organisation existe déjà.` · `Erreur lors de la création`.

### 3.9 Étape LinkedIn — `SceneLinkedIn` (242 l.)
H2 : **« Branchez le moteur. »** · P : « Sans LinkedIn connecté, pas de sourcing ni de messages. »
Carte `rounded-xl border p-4 sm:p-5` — connectée : `border-success/40 bg-success/5` ; sinon `border-border bg-background/40`.
En-tête : `linkedin-logo.webp` `w-9 h-9`, **LinkedIn** / « Le moteur de votre sourcing. », badge **`Connecté`** (`Check`, spring) si connecté.
Bénéfices (`CheckCircle2 text-success`, apparition `.15 + i*.08`) :
1. « Invitations, messages et relances entièrement automatisés »
2. « Fonctionne 24h/24, même ordinateur éteint »
3. « Connexion sécurisée, déconnectable à tout moment »

**`Connecter LinkedIn`** — `<Button className="w-full h-10 text-sm font-semibold text-white bg-linkedin hover:bg-linkedin-hover">` + `ExternalLink` (ou `Loader2` si `connecting`). Ouvre `hosted_auth_link` Unipile dans un nouvel onglet, puis polling toutes les **8 s pendant 3 min** + reload sur `focus`/`visibilitychange`.
Ligne de confiance : `🔒 Connexion sécurisée` (`Lock`) · `Déconnectable à tout moment` (`Unplug`) · bouton **`Actualiser`** (`RefreshCw`, `aria-label="Actualiser la connexion"`, spin pendant refresh) — tous en `text-2xs`.
Navigation : pas de `Retour` (prop `onBack` non passée depuis Onboarding.tsx, commentaire L360 : « la scène précédente crée l'espace de travail ») ; **`Connecter plus tard`** (`variant="ghost"`, visible seulement si non connecté) ‖ **`Continuer`** + `ArrowRight`, `disabled={!linkedInConnected}`.
**Toasts** : `toast.info('Fenêtre de connexion LinkedIn ouverte. Revenez ici après connexion.')` · `toast.error('Erreur lors de la connexion')` / message d'erreur.

### 3.10 Étape finale — `SceneLaunch` (154 l.)
Colonne centrée `max-w-lg`, `<ConfettiBurst />` au mount.
**Anneau de score** : SVG 128 px, `r=44`, `stroke-width 3`, piste `hsl(var(--foreground) / 0.08)`, arc `hsl(var(--success))` ⚠️, animation `strokeDashoffset` 1.4 s delay .3 s. Centre : `<NumberTicker value={scorePercent} delay={0.4} />%` en `text-3xl font-bold tabular-nums` avec **`style={{ fontFamily: "'Space Mono', monospace" }}` en dur** (idem pour le label `configuré` en `text-3xs uppercase`).
Score = `completedScenes (hors launch) / (flow.length - 1) * 100`.
H1 `font-editorial italic text-4xl md:text-5xl` : **`Configuration parfaite.`** si `scorePercent >= 70`, sinon **`Votre espace est prêt.`**
P : `{orgName} est prêt à sourcer.` (ou « Tout est en place pour votre premier sourcing. ») + `{done}/{total} éléments configurés.`
Checklist (`divide-y divide-border/40`, apparition `.5 + i*.08`) :
- **Espace de travail créé**
- **Activité & secteurs renseignés** (flow freelance uniquement)
- **Compte LinkedIn connecté** — si non fait, lien `Terminer plus tard` + `ArrowUpRight` → `/settings?tab=account`
Si restants : « Pas d'inquiétude : tout se termine en 2 clics depuis les Réglages. »
CTA : `<motion.button className="konekt-shine relative w-full py-3 rounded-lg text-sm font-semibold … bg-foreground text-background">` + `Rocket` — **`Lancer Konekt`**, `whileHover {scale:1.02, y:-1}`, `whileTap {scale:.97}` → `clearOnboardingProgress()` + invalidate/refetch `active-organization` + `navigate('/missions?create=brief')`.

**`ConfettiBurst`** (127 l.) : canvas plein écran, 3 canons × 70 particules, gravité .18, 3200 ms, palette sobre `hsl(142 71% 45%)` / `hsl(142 60% 60%)` / blanc / gris / doré `hsl(45 90% 55%)` — **valeurs en dur**. Inerte si `prefers-reduced-motion`.

### 3.11 `WelcomeOnboardingModal` (227 l.) — onboarding *invité*, hors tunnel
Déclenché par `localStorage['konekt_welcome_pending']` posé par Auth.tsx, affiché par `AppLayout` (donc **dans** l'app authentifiée). `<Dialog>` shadcn `max-w-md p-0`, `DialogTitle` sr-only « Bienvenue sur Konekt ».
Progression : 3 dots `h-1.5 rounded-full`, actif `w-8 bg-foreground`, inactifs `w-1.5 bg-muted`.
- **Étape 1** — icône `w-14 h-14 rounded-2xl bg-foreground` + `Sparkles` ; H2 `text-2xl font-bold` « Bienvenue dans l'équipe {org} 👋 » ; « Vous venez de rejoindre Konekt. En 2 minutes, on vous montre comment lancer votre premier sourcing. » ; `<Button className="w-full">` **`Commencer`** + `ArrowRight` ; lien **`Passer le tutoriel`**.
- **Étape 2** (sautée si LinkedIn déjà connecté) — icône `bg-info/10 text-info` + `Linkedin` ; « Connectez votre LinkedIn » ; texte + note italique « LinkedIn Recruiter ou Sales Navigator recommandé… » ; **`Connecter mon LinkedIn`** → `/settings?tab=account` ; **`Retour`** (`ChevronLeft`) ‖ **`Plus tard →`**.
- **Étape 3** — icône `bg-success/10 text-success` + `Target` ; « Vous êtes prêt·e ! » ou « Vous y êtes presque » ; **`Voir les missions`** → `/missions` ; badge `LinkedIn connecté` (`Check`, `rounded-full bg-success/10`) ; **`Retour`** ‖ **`Fermer`** (`X`).

---

## 4. `/portal/:token` — CandidatePortal (`src/pages/CandidatePortal.tsx`, 440 l.)

**Thème** dark, **largeur `max-w-2xl mx-auto px-4 py-10 sm:py-16`**, `min-h-screen bg-background`. Langage visuel **brutaliste/carré** : `border border-border` (pas de `rounded-*` du tout), `font-black`, `uppercase tracking-wider`.
**Données** : RPC Supabase `get_portal_by_token({ p_token })` → premier élément du tableau.

**États** :
- *Chargement* : `<Loader2 className="w-8 h-8 animate-spin text-foreground" />` centré, **sans texte**
- *Token invalide/expiré* : `<ShieldX className="w-12 h-12 text-muted-foreground" />`, H1 `text-xl font-bold` **« Lien invalide ou expiré »**, P « Ce lien de suivi n'est plus actif. Contactez votre recruteur pour obtenir un nouveau lien. » (SEO : `Portail candidat` / « Suivez l'avancement de votre candidature »)
- *Succès* : SEO `Suivi candidature — {job_title | 'Poste'}`

**Sections** (chacune `motion` opacity/y, delays 0 → .45) :
1. **Header/branding** `p-6 sm:p-8 mb-6` — logo société ou carré `h-10 w-10 bg-foreground text-background font-black` (initiale) ; eyebrow **`Portail candidat`** + nom société ; « Bonjour **{candidate_name}**, » ; H1 `text-2xl sm:text-3xl font-black uppercase tracking-tight` = `job_title` ou **« Votre candidature »** ; description société ; **barre de progression** (`Progression` / `{n}%`, `h-2 bg-muted/30 border`, remplissage `bg-foreground`, 0.8 s easeOut). `progressPercent = order / 7 * 100`.
2. **2 tuiles** `grid-cols-2 gap-3` — **`Étape actuelle depuis`** : `{n}` `text-2xl font-black` + `jour(s)` + date `fr-FR {day, month short}` ; **`Prochaine étape dans`** : `~{n}` (`text-emerald-600` si ≤ 1 ⚠️ couleur Tailwind brute) + « estimation moyenne », sinon **`À déterminer`**.
3. **Timeline** — bandeau `bg-foreground text-background` **`Avancement du processus`** ; 8 étapes (`STAGE_PROGRESS`), pastille `w-8 h-8 border-2` (passée `bg-foreground`, courante `bg-accent scale-110`, future `bg-muted/30`), connecteur `w-0.5 h-8` :

| Clé DB | Icône | Label | Description | avgDays |
|---|---|---|---|---|
| `Nouveau` | `Users` | Candidature reçue | Votre candidature a bien été reçue et est en cours de revue par notre équipe. | 2 |
| `Contacté` | `Send` | Premier contact | Nous avons pris contact avec vous pour en savoir plus sur votre parcours. | 3 |
| `Répondu` | `CheckCircle2` | Échange en cours | Nous sommes en discussion active pour évaluer l'adéquation avec le poste. | 5 |
| `Pré-qualif` | `Clock` | Pré-qualification | Un entretien de pré-qualification est prévu pour valider les critères clés. | 5 |
| `CV envoyé` | `FileText` | Dossier transmis au client | Votre dossier a été présenté à notre client. Nous attendons leur retour. | 7 |
| `ITW en cours` | `Calendar` | Entretiens client | Les entretiens avec le client sont en cours. Bonne chance ! | 10 |
| `Offre` | `Briefcase` | Proposition d'embauche | Une proposition est en cours de finalisation. Vous êtes presque au bout ! | 5 |
| `Gagné` | `CheckCircle2` | Finalisé 🎉 | Le processus est terminé avec succès. Félicitations ! | — |

Badges : étape courante **`En cours`** (`bg-accent border animate-pulse`), étapes passées **`✓`** (`bg-foreground text-background`). `Gagné` masqué tant qu'il n'est pas atteint.
4. **Prochaines étapes** (si `next_steps`) — `ArrowRight` + **`Prochaines étapes`**, texte `whitespace-pre-wrap`
5. **Documents & Ressources** (si `documents.length`) — en-tête `FileText` **`Documents & Ressources`** ; lignes `<a target="_blank">` avec `Download`, nom, badge type (uppercase), `ExternalLink` au survol
6. **FAQ** — en-tête `HelpCircle` **`Questions fréquentes`** ; accordéon (`ChevronDown/Up`, height+opacity 0.2 s). FAQ par défaut si absente en base :
   - « Combien de temps dure le processus de recrutement ? » → « En moyenne, le processus complet prend entre 3 et 6 semaines… »
   - « Comment me préparer à l'entretien ? » → « Renseignez-vous sur l'entreprise, préparez des exemples concrets… »
   - « Puis-je postuler à d'autres postes en parallèle ? » → « Bien sûr ! Nous pouvons même vous proposer d'autres opportunités… »
   - « Quand aurai-je un retour après l'entretien ? » → « Nous nous engageons à vous faire un retour dans les 48h… »
7. **Votre recruteur** — bloc inversé `bg-foreground text-background p-5` ; avatar `h-12 w-12 bg-background/15` + `Users` ; nom ou **« Votre recruteur dédié »** ; « N'hésitez pas à me contacter pour toute question » ; boutons `mailto:` **`Email`** (`Mail`) et `tel:` **`Appeler`** (`Phone`) — `bg-background text-foreground text-xs font-bold uppercase`
8. **Footer** : « Dernière mise à jour : {date fr-FR long} »

**Actions possibles** : aucune écriture — portail 100 % lecture (+ liens mailto/tel/documents).

---

## 5. `/client/:token` — ClientPortalV2 (`src/pages/ClientPortalV2.tsx`, 1076 l.)

**Thème** dark, **`max-w-[1280px] mx-auto px-4 sm:px-6`**. Langage visuel **arrondi** (`rounded-xl`, `rounded-2xl`, `bg-card`) + **gradient Skalr** — opposé au portail candidat.
**Données** : `fetch('{VITE_SUPABASE_URL}/functions/v1/client-portal-data?token=…')` avec `Authorization: Bearer {anonKey}` + `apikey`. `notFound` si `!res.ok` ou `!client_name`.
**Tutoiement** partout (« ton recruteur », « Donne ton feedback ») — vouvoiement ailleurs dans l'app.

**États** :
- *Chargement* : `Loader2 w-6 h-6` + « **Chargement du portail…** »
- *Invalide* : emoji `🔒` `text-5xl`, H1 `font-display text-[24px] font-bold` **« Lien invalide ou expiré »**, « Ce lien d'accès n'est plus valide. Contactez votre recruteur pour obtenir un nouveau lien. »
- *Vide (0 candidat)* : carte `border-dashed p-12`, `Users`, « **Aucun candidat pour le moment** », « Ton recruteur n'a pas encore présenté de candidat. Tu seras notifié dès qu'il en partagera. »
- *Aucune mission* : `border-dashed`, `Briefcase`, « Aucune mission active. »
- *Recherche vide* : `Search`, « **Aucun candidat trouvé** », « Essaie d'autres mots-clés ou enlève les filtres. »

**Permissions** (depuis l'edge function) : `can_comment`, `can_see_names` (sinon affichage `Candidat #{id.slice(0,6)}` et initiale `#`, headline masquée), `can_fill_scorecard`.

### 5.1 Overlay d'accueil (1re visite, flag `localStorage['konekt:portal:onboarding:{token}']`)
`fixed inset-0 z-50 bg-black/50 backdrop-blur-sm` + `konekt-fade-up` ; carte `bg-card rounded-2xl shadow-2xl max-w-lg` avec filet `h-1 konekt-skalr-bg`.
Icône `h-14 w-14 rounded-2xl konekt-skalr-bg konekt-shine` + `Sparkles`. Eyebrow **« Bienvenue sur ton portail »** ; H2 `font-display text-[28px] font-bold` « Bonjour *{clientName}* » (`font-editorial italic`) ; « **{orgName}** a préparé un espace dédié pour suivre les candidatures de ton recrutement. Voici ce que tu peux faire ici : ».
3 lignes emoji :
- 📊 **Suivre l'avancement** — « Vois en temps réel où en sont les candidatures, étape par étape. »
- 🎯 **Évaluer les candidats** — « Donne ton feedback via la scorecard pour chaque profil présenté. »
- 🔒 **Confidentiel & sécurisé** — « Ce lien est privé. Toi seul peux y accéder. »
Bouton `w-full h-11 rounded-full … text-white konekt-skalr-bg konekt-shine active:scale-[0.97]` : **`C'est parti`** + `ArrowRight`.
⚠️ Pas d'ESC, pas de focus trap, pas de `role="dialog"`.

### 5.2 Header
`border-b`, filet `h-1 konekt-skalr-bg`. Logo org (`h-10 w-10 rounded-md`) ou fallback dégradé + `Sparkles`. Eyebrow « **Portail recrutement · {org_name | Konekt}** » ; H1 `font-display text-[18px] sm:text-[22px] font-bold` « Bienvenue, *{client_name}* ». À droite : `{n} mission(s)` (`Briefcase`) · `{n} candidat(s)` (`Users`).

### 5.3 Onglets (`nav sticky top-0 z-20 border-b`)
`TabButton` : `px-4 py-3 text-[13px] font-medium border-b-2`, actif `border-foreground text-foreground`.
**`Vue d'ensemble`** (`TrendingUp`) · **`Pipeline`** (`Briefcase`) · **`Tous les candidats`** (`Users`) + compteur `({total})` en `text-[10px] opacity-60`.

### 5.4 Onglet Vue d'ensemble
- **4 KPI** `bg-card border rounded-xl p-4`, valeur `font-display text-[28px] font-bold tabular-nums` : **Total candidats** (`Users`) · **À évaluer** (`Eye`, coloré `--status-warning` si > 0) · **En process** (`TrendingUp`) · **Embauchés** (`Award`, `--status-success` si > 0)
- **Funnel de recrutement** — sous-titre « Répartition des candidats par étape » ; `<Pill variant="ai" icon={Star}>Score moyen {n}/100</Pill>` ; 6 barres horizontales `h-7 rounded-md` (fond `variantColor + '33'`, `border-left: 3px solid`), `—` si 0
- **⭐ Top candidats** (score ≥ 70, top 5) + lien **`Voir tous`** (`ChevronRight`) → onglet candidats. Vide : « Aucun candidat avec score ≥ 70 pour le moment. »
- **📈 Activité récente** (5 derniers `updated_at`) + lien **`Pipeline`** → onglet pipeline

### 5.5 Onglet Pipeline
Une carte par mission : `Briefcase` + nom (`font-display text-[15px] font-bold`) + « · {n} candidat(s) ». Kanban horizontal scrollable, colonnes `w-[260px]`, en-tête emoji + label + compteur (`font-mono` `bg-muted rounded`), corps `max-h-[400px] overflow-y-auto`, `—` si vide. **Read-only** (pas de drag & drop).

**`STAGE_CONFIG`** (clés normalisées `lowercase` + `_`) :
`sourced` 🆕 **Nouveau** (muted) · `presented` 👋 **Présenté** (info) · `to_evaluate` 🔍 **À évaluer** (warning) · `interview` 🎯 **Entretien** (info) · `offer` 📨 **Offre** (warning) · `hired` ✅ **Embauché** (success) · `rejected` ❌ **Refusé** (muted, order 7 — **exclu du funnel et du kanban**).
⚠️ Ces clés **ne correspondent pas** à celles du portail candidat (`Nouveau`, `Contacté`, `CV envoyé`…) : deux taxonomies de pipeline coexistent.

`PipelineCard` : avatar `w-7 h-7 rounded-full bg-foreground/10`, nom `text-[12px] font-semibold`, headline, `ScoreBadge`, `Clock` + `formatDistanceToNow(locale: fr)`.

### 5.6 Onglet Tous les candidats
Filtres : `<input>` natif `h-9 pl-9 rounded-md border bg-card text-[13px]` placeholder **`Rechercher un candidat, une mission…`** (`Search` absolu) ; `<select>` natif **`Toutes étapes`** + les 7 étapes (emoji + label) ; `<select>` **`Toutes missions`** (si > 1 mission).
⚠️ `<input>`/`<select>` **natifs**, pas les composants shadcn `Input`/`Select` utilisés partout ailleurs.
Résultats : liste `bg-card border rounded-xl divide-y` de `CandidateRow` (`showProject showTime`).

**`CandidateRow`** : avatar rond, nom, `· {project.name}`, headline, `<Pill variant={stage.variant}>{emoji} {label}</Pill>`, `ScoreBadge`, temps relatif FR.
**`ScoreBadge`** : carré `w-9/w-10 rounded-md font-display font-bold tabular-nums`, ≥ 80 → success-muted/success, ≥ 60 → info-muted/info, sinon muted.

### 5.7 Sheet de détail candidat
Backdrop `fixed inset-0 z-30 bg-black/50 backdrop-blur-sm konekt-fade-up` ; panneau `fixed right-0 z-40 w-full sm:max-w-lg bg-background border-l shadow-2xl` + filet `h-1 konekt-skalr-bg`. **ESC ferme** (seul overlay du périmètre à le faire).
Header : avatar `h-12 w-12`, nom `font-display text-[18px] font-bold`, headline, bouton `X` `h-8 w-8` `aria-label="Fermer"`.
Corps : Pills étape / `Score {n}/100` (`variant="ai"`, `Star`) / nom de mission (`Briefcase`) ; carte **`Activité`** — `Présenté · il y a X` (`CheckCircle` vert) et `Mise à jour · il y a X` (`Clock`) ; carte **`Évaluation`** si `can_fill_scorecard` : « Donne ton feedback — il sera transmis à ton recruteur » + `<PortalCandidateScoring />`.
**Pas de CV, pas de commentaires, pas de scroll-lock du body.**

### 5.8 `PortalCandidateScoring` (`src/components/portal/PortalCandidateScoring.tsx`, 198 l.)
Accordéon `border border-border` (carré, **sans `rounded`** — jure dans un sheet tout en `rounded-lg`).
Toggle : **`Évaluer ce candidat`** (`Star`, `text-xs font-bold uppercase tracking-wider`) + `ChevronDown/Up`.
5 critères, notes 1→5 en boutons carrés `w-8 h-8 text-xs font-bold border` (actif `bg-foreground text-background`) :

| Clé | Label | Description |
|---|---|---|
| `technical` | Compétences techniques | Maîtrise des outils et technologies requises |
| `experience` | Expérience pertinente | Adéquation du parcours avec le poste |
| `soft_skills` | Soft skills | Communication, leadership, travail en équipe |
| `culture_fit` | Culture fit | Adéquation avec les valeurs et l'environnement |
| `motivation` | Motivation | Intérêt pour le poste et le projet |

**Recommandation** : `✅ Oui absolument` (`strong_yes`) · `👍 Oui` (`yes`) · `🤔 À revoir` (`maybe`) · `👎 Non` (`no`) — boutons `px-2 py-1 text-xs font-bold uppercase border`.
**Commentaire (optionnel)** : `<textarea>` natif `min-h-[60px]`, placeholder **`Vos impressions sur ce candidat...`** (⚠️ vouvoiement ici, tutoiement au-dessus).
**Submit** : `w-full h-9 bg-foreground text-background border text-xs font-bold uppercase tracking-wider`, `disabled` si aucune note ; `Envoi...` ou `Envoyer mon évaluation` (`Send`).
Calcul : `overall_score = moyenne des notes, arrondie à 0.1` (échelle **/5**, envoyée avec `summary: "Évaluation par {clientName} — Score: {n}/5"`) alors que l'UI affiche des scores **/100** ailleurs.
POST vers `client-portal-data` avec `criteria[].weight = 2` en dur.
**Toasts** : `toast.error('Donnez au moins une note')` · `toast.success('Merci pour votre évaluation !')` · `toast.error('Erreur lors de l'envoi')`.
État envoyé : `<Check /> Évaluation envoyée` (`bg-accent/50 border`), non réversible et non persisté (reset au refresh).

### 5.9 Footer
`border-t py-6 text-center` : « Portail propulsé par **Konekt** » (`font-display font-bold`).

---

## 6. `/r/:slug` — RecruiterPublicProfile (298 l.)

**Thème** dark, `max-w-2xl mx-auto px-4 py-12 space-y-6`. Style **néo-brutaliste avec ombre décalée** : `style={{ boxShadow: '4px 4px 0px 0px hsl(var(--primary))' }}` sur la carte principale et `3px 3px 0px 0px` sur le CTA — **unique dans tout le repo**.
**Données** : `profiles` filtré sur `public_slug`, `maybeSingle()`. `notFound` si erreur, absence, **ou `recruiter_bio` vide**.

**États** : *chargement* → carré `w-5 h-5 border border-border border-t-foreground animate-spin` (**sans `rounded-full`** → carré qui tourne) ; *introuvable* → H1 `text-2xl font-bold uppercase tracking-wider` **« Profil introuvable »**, « Ce profil n'existe pas ou n'est plus disponible. », lien souligné **`Retour à l'accueil`**.
**SEO** : `{name} — Recruteur | Konekt`, description = 160 premiers car. de la bio.

**Anatomie** :
- Barre haute `border-b-2 px-4 py-3` : `<Link to="/">` `ArrowLeft` + **`Konekt`** ‖ lien **`LinkedIn`** (`Linkedin w-3.5`, `target="_blank"`)
- Avatar carré `w-16 h-16 text-xl font-bold text-white border` avec `background: linear-gradient(135deg, hsl(var(--skalr-purple)), hsl(var(--skalr-pink)))` (initiales, 2 lettres max)
- H1 `text-xl md:text-2xl font-bold uppercase tracking-tight` = `display_name` ou **`Recruteur`** ; headline ; méta : `{n} ans` (`Briefcase`), `job_title` (`Award`), `{rating}/5` (`Star`, `font-bold`)
- **Vidéo d'intro** (si `intro_video_url`) : bouton plein largeur `border p-6` avec carré `w-12 h-12` + `Play`, **`Vidéo d'introduction`** / « Découvrez {name} en quelques minutes » → remplace par `<video controls autoPlay className="object-cover">` (⚠️ `object-cover` sur une vidéo = recadrage)
- **Bio** : `border-l-4 border-border pl-4`, `whitespace-pre-wrap`
- **Stats** `grid-cols-2 sm:grid-cols-4` — `StatCard` `border p-3 text-center` : **Placements** (`Award`), **Délai moyen** `{n}j` (`Clock`), **Passage 1er tour** `{n}%` (`TrendingUp`), **Mid-round rate** `{n}%` (`Star`) ⚠️ label anglais isolé au milieu d'une UI FR
- **Spécialisations** : `specializations` + `linkedin_skills` dédupliqués, **20 max**, chips `px-2.5 py-1 text-xs font-semibold border`
- **Témoignages clients** : cartes `border p-4`, `Quote` + texte italique, nom client `uppercase tracking-wider` + date
- **CTA** : `<a>` `px-5 py-2.5 text-sm font-semibold border bg-foreground text-background` + ombre décalée — **`Contacter sur LinkedIn`** (`Linkedin`)
- Footer : « Profil généré par Konekt » (`text-xs text-muted-foreground/50`)

---

## 7. `/privacy` — Privacy (224 l.)

Dark, `max-w-3xl mx-auto px-6 py-12 space-y-10`. Header `border-b-2` : `<Link to="/">` `ArrowLeft` + **`Konekt`** ‖ « Dernière mise à jour : mars 2026 ».
H1 `text-2xl font-black uppercase tracking-wider` **« Politique de confidentialité »** ; sous-titre « Konekt Services SAS — Plateforme SaaS de recrutement assisté par intelligence artificielle. »
Composant local `Section({icon, title})` : H2 `flex items-center gap-2 text-lg font-bold uppercase tracking-wider` + icône `w-5 h-5`, corps `text-sm text-muted-foreground leading-relaxed space-y-2`.
Sections : **1. Responsable de traitement** (`Shield`) · **2. Données collectées et traitées** (`Database`) · **3. Scoring IA — Traitement automatisé** (`Brain`) · **4. Sous-traitants ultérieurs** (`Globe`, `<table>` 3 colonnes `Sous-traitant / Données / Localisation`) · **5. Durées de conservation** (`Clock`, `<table>` `Données / Durée / Action`) · **6. Vos droits** (`UserX`) · **7. Cookies et traceurs** (`FileDown`) · **8. Mesures de sécurité** (`Shield`).
Contact : `privacy@konekt.io` (liens `underline text-foreground hover:text-muted-foreground`).
⚠️ **Aucune ancre `#mentions`** malgré le lien « Mentions légales » du footer landing ; **aucune section « Mentions légales »**. Adresse `privacy@konekt.io` vs `l.garilhe@konekt.fr` dans PrivacyExtension → **deux domaines de contact différents**.

## 8. `/privacy-extension` — PrivacyExtension (159 l.)

Même squelette (`max-w-3xl`, `Section`), header `border-b-2` : `Konekt` ‖ lien **`Privacy général →`**.
H1 `text-3xl font-bold tracking-tight` **« Privacy — Extension Chrome »** + icône `Puzzle w-8 h-8` (⚠️ H1 **non uppercase** ici, contrairement à `/privacy`).
« Dernière mise à jour : 2026-04-23 · Contact : l.garilhe@konekt.fr » (⚠️ date **ISO brute**, non localisée ; l'autre page dit « mars 2026`).
Sections : **Cookie LinkedIn (li_at, li_a)** (`Cookie`) · **URLs de profils LinkedIn visités** (`Globe`) · **Token API Konekt** (`Key`) · **Données PAS collectées** (`UserX`, liste ❌) · **Destinataires des données** (`Database`) · **Sécurité** (`Lock`) · **Durée de conservation** (`Clock`) · **Droits RGPD** (`Shield`) · **Contact** (`Mail`).
Liens : `text-info underline` (vers `/settings`, `/settings?tab=account`, `mailto:`, unipile.com/privacy) — ⚠️ liens vers des **routes protégées** depuis une page publique. `<code className="text-xs bg-muted px-1">` pour les identifiants techniques.

## 9. `/unsubscribe` — Unsubscribe (83 l.)

Dark, `min-h-screen flex items-center justify-center p-4`, colonne `max-w-md text-center space-y-6`. **Pas de `SEOHead`, pas de logo, pas de lien retour.**
Flux : `?token=` → GET `handle-email-unsubscribe?token=` (header `apikey`) pour valider, puis POST via `supabase.functions.invoke` à la confirmation.
6 états :
| État | Icône | H1 (`text-xl font-semibold`) | Texte | Action |
|---|---|---|---|---|
| `loading` | `Loader2 w-8 animate-spin` | — | — | — |
| `valid` | `MailX w-12 text-muted-foreground` | **Se désabonner** | « Vous ne recevrez plus d'emails de notre part. » | `<Button className="gap-2">` **`Confirmer la désinscription`** (+ `Loader2` si `processing`, `disabled`) |
| `success` | `CheckCircle w-12 text-emerald-500` ⚠️ | **Désinscription confirmée** | « Vous avez été désinscrit avec succès. » | — |
| `already` | `CheckCircle w-12 text-muted-foreground` | **Déjà désinscrit** | « Vous êtes déjà désinscrit de nos emails. » | — |
| `invalid` / `error` | `XCircle w-12 text-destructive` | **Lien invalide** | « Ce lien de désinscription est invalide ou a expiré. » | — |

⚠️ `error` (échec réseau du POST) affiche **« Lien invalide »**, message faux.

---

# ANOMALIES DESIGN

## A. Rupture de langage visuel entre surfaces
1. **La landing est la seule page en `.light`** — forçage impératif de `document.documentElement.classList` dans un `useEffect` (SkalrLanding L87-94). Passer `/` → `/auth` fait basculer clair → sombre sans transition. Aucun mécanisme de thème centralisé (pas de ThemeProvider).
2. **Quatre dialectes visuels coexistants sur des pages publiques** :
   - *Néo-brutaliste* : landing (`border-2`, `BrutalButton`, `uppercase tracking-wider`, angles droits) + CandidatePortal (`border`, `font-black`, **zéro `rounded`**) + RecruiterPublicProfile (ombres décalées `4px 4px 0px`)
   - *Éditorial serif* : onboarding (`font-editorial italic`, listes typographiques sans cartes, backdrop mesh + grain)
   - *SaaS arrondi / gradient* : ClientPortalV2 (`rounded-xl/2xl`, `bg-card`, `konekt-skalr-bg` animé, emojis)
   - *shadcn brut* : Auth, Unsubscribe, Privacy — aucun caractère, aucune illustration
3. **`BrutalButton` (landing) ignore totalement le `Button` shadcn** : pas de `variant`/`size`, pas de `disabled`, hauteur `h-12` vs `h-10` du DS, radius 0 vs `--radius: 0.75rem`. Idem pour les `<button>` bruts de Auth (submit `h-11`) et de PortalCandidateScoring (`h-9`).
4. **Nomenclature de pipeline dédoublée** : `CandidatePortal.STAGE_PROGRESS` (`Nouveau / Contacté / Répondu / Pré-qualif / CV envoyé / ITW en cours / Offre / Gagné`, 8 étapes, labels FR affichés différents des clés) vs `ClientPortalV2.STAGE_CONFIG` (`sourced / presented / to_evaluate / interview / offer / hired / rejected`, 7 étapes anglaises). Deux vocabulaires pour le même pipeline métier.
5. **Échelle de score incohérente** : `/client` affiche `Score {n}/100` partout, mais la scorecard envoie un `overall_score` **/5**. Le portail candidat n'affiche aucun score.
6. **Ton éditorial incohérent** : ClientPortalV2 tutoie (« Donne ton feedback », « Ton recruteur », « Toi seul »), tout le reste vouvoie — et le `<textarea>` de la scorecard, *dans* ce même portail, revouvoie (« Vos impressions sur ce candidat... »).
7. **Deux logos différents** : `KonektLogo` (PNG `/konekt-logo.png`) sur landing/auth/footers, mais `skalr-logo-concept-3.webp` importé directement dans `OnboardingShell`. Sur la landing en `.light`, le logo est appelé avec `theme="dark"` (= navy) — nommage inversé et piégeux (`light` = fichier blanc).
8. **Emojis comme système d'icônes** dans ClientPortalV2 (🆕👋🔍🎯📨✅❌, ⭐ Top candidats, 📈 Activité, 📊🎯🔒 dans l'overlay) alors que tout le reste du produit utilise lucide-react.

## B. Valeurs en dur / tokens contournés
9. **`hsl(var(--success))` n'existe pas** — seule `--status-success` est définie (index.css L67). Emplois cassés : `SceneLaunch` arc du score (`stroke="hsl(var(--success))"`), `OnboardingBackdrop` blob n°2, `SceneOrganization` badge « Enrichi » (`background`/`color` inline). Les classes Tailwind `text-success`/`bg-success/15` fonctionnent (mappées sur `--status-success`) — d'où un rendu partiellement correct qui masque le bug.
10. **Couleurs hex/HSL littérales** : `text-emerald-600` (CandidatePortal), `decoration-emerald-500/70` (EditorialChoiceList, OnboardingShell), `border-l-emerald-500/50` (SceneOrganization), `hsl(142,71%,45%)` / `hsl(32,95%,44%)` (badges signal), `hsl(142 71% 45%)` / `hsl(45 90% 55%)` (ConfettiBurst), `#4285F4/#34A853/#FBBC05/#EA4335` (SVG Google), `bg-black/50` (ClientPortalV2 backdrops, au lieu de `bg-foreground/50`), `hsl(40,3%,14%)` / `hsl(0,0%,98%)` / `border-white/10` sur **tout** LandingProductDemo.
11. **`font-family` inline** : `style={{ fontFamily: "'Space Mono', monospace" }}` × 2 dans `SceneLaunch` — alors que `font-mono` existe.
12. **`box-shadow` inline** : `'0 4px 16px hsl(var(--primary) / 0.15)'` (CollaboratorWelcome × 2), `'4px 4px 0px 0px hsl(var(--primary))'` / `'3px 3px 0px 0px'` (RecruiterPublicProfile) — aucun token d'ombre décalée dans le DS.
13. **`text-[Npx]` arbitraires massifs** dans ClientPortalV2 (`text-[10px]`, `[10.5px]`, `[11px]`, `[11.5px]`, `[12px]`, `[12.5px]`, `[13px]`, `[14px]`, `[15px]`, `[18px]`, `[22px]`, `[24px]`, `[28px]`) — la config Tailwind interdit explicitement cette pratique (commentaire L145-146 : « Bannit l'usage de text-[Npx] arbitraires »). Idem `text-[15px]` dans les scènes d'onboarding, `text-[13px]/[11.5px]` dans LandingProductDemo.
14. **URL placeholder en production** : `CALENDLY_URL = 'https://calendly.com/demo/30min'` (SkalrLanding L51) — les CTA « Réserver une démo » (nav, hero, drawer, CTA final) ouvrent une iframe morte.
15. **Domaines de logo tiers en dur** : `logo.clearbit.com`, `google.com/s2/favicons`, `ui-avatars.com?background=6366f1` (indigo hors palette), `welcometothejungle.com/assets/…svg` + fallback CDN.
16. **Origine applicative en dur** : `'https://konekt-app-navy.vercel.app'` (Auth L18) et canonical dans `index.html`.

## C. Animations / motion
17. **Trois systèmes d'animation** : framer-motion (landing, onboarding, portails), keyframes CSS custom `konekt*` (index.css), et timers `setTimeout` impératifs (LandingProductDemo ~15 timers, SceneOrganization ~11).
18. **`prefers-reduced-motion` partiel** : respecté par `LandingProductDemo`, `ConfettiBurst`, `OnboardingBackdrop`, `ChapterInterstitial`, transitions de scène. **Non respecté** par : `.konekt-shine` (CTA `Lancer Konekt`, portail client), `.konekt-skalr-bg` (pan 8 s infini sur le header, les filets et le CTA du portail client), `.konekt-shimmer-text`, `animate-pulse` du badge « En cours » (CandidatePortal), toutes les animations d'entrée `whileInView` de la landing.
19. **Animations décoratives coûteuses non conditionnées** : `OnboardingBackdrop` = 3 blobs `blur(48px)` animés en boucle 46-58 s + grain SVG en `mix-blend-overlay` plein écran ; `LandingProductDemo` = cycle infini de 11 s même hors viewport (aucun `IntersectionObserver`).
20. **FAQ landing** : animation `height: 0 → auto` sans `opacity` ni `overflow` géré au repos, et `exit` sans transition explicite → saut visuel.

## D. Cohérence des CTA
21. **Ordre des CTA inversé entre hero et CTA final** : hero = *Réserver une démo* (primary) + *Essai gratuit* (outline) ; bas de page = *Essai gratuit* (primary) + *Réserver une démo* (outline). Aucune hiérarchie de conversion stable.
22. **Cinq libellés pour la même action « aller vers /auth »** : `Commencer` (nav), `Essai gratuit 14 jours, sans carte` (hero + CTA final), `Découvrir la plateforme` (features), `Commencer` (drawer mobile).
23. **Vocabulaire d'avancement inconsistant dans l'onboarding** : `Suivant` (SceneOrgDetails), `Continuer` (SceneSpecializations, SceneOrganization, SceneLinkedIn), `Lancer Konekt` (SceneLaunch), `C'est parti` (portail client). Le retour aussi : `<Button variant="ghost">Retour` (OrgDetails), `<button>` texte 12 px `Retour` (Specializations), `<Button size="icon">` `ArrowLeft` seul (Organization), aucun retour (OrgType, LinkedIn, Launch).
24. **Étape 1 sans navigation** : `SceneOrgType` auto-avance après 420 ms sans possibilité d'annuler ; `onBack={() => {}}` est passé mais non branché.
25. **`/onboarding` est orphelin** : Auth redirige toujours vers `/missions` ou `/settings` — le tunnel n'est atteignable que via `CollaboratorWelcome` (`?new=1`) ou une URL tapée. Un nouvel inscrit sans organisation atterrit sur `/missions` derrière `OrganizationGuard`.

## E. Accessibilité & robustesse
26. **Aucune modale du périmètre n'est un vrai dialog** sauf `WelcomeOnboardingModal` (Radix) : Calendly, Contact, drawer mobile, `OnboardingOverlay`, `CandidateSheet` → `<div>` sans `role="dialog"`, sans `aria-modal`, sans focus trap, sans scroll-lock. Seul `CandidateSheet` gère ESC.
27. **Auth sans `<label>`** — 4 champs sur placeholders seuls ; les deux boutons de bascule sont `type="submit"` implicite.
28. **Messages d'erreur d'authentification non traduits** : `toast({ title: 'Erreur', description: error.message })` remonte les chaînes Supabase en anglais dans une UI 100 % FR.
29. **FAQ landing** : `<button>` sans `aria-expanded`/`aria-controls`.
30. **Spinners incohérents** : `Loader2` lucide (Landing, CandidatePortal, ClientPortalV2, Unsubscribe) vs `div` CSS `rounded-full animate-spin` (Onboarding garde) vs `div` **carré** `animate-spin` sans `rounded-full` (RecruiterPublicProfile L62 — bug visuel).
31. **`PUBLIC_ROUTES` incomplet** (App.tsx L52) : `/r/`, `/privacy`, `/privacy-extension`, `/unsubscribe` absents → `SessionExpiredDialog` peut s'ouvrir sur des pages 100 % publiques.
32. **Liens morts / incohérents** : `href="/privacy#mentions"` (ancre inexistante) ; `<a href="/privacy">` dans le footer landing = rechargement complet au lieu de `<Link>` ; PrivacyExtension pointe vers `/settings` (route protégée) depuis une page publique.
33. **`ClientPortalV2` court-circuite le client Supabase** : `fetch` manuel avec `VITE_SUPABASE_PUBLISHABLE_KEY` exposée en header (idem `PortalCandidateScoring`, `Unsubscribe`) — trois façons différentes d'appeler une edge function dans le même périmètre (`fetch` brut, `supabase.functions.invoke`, `invokeEdgeFunction`).
34. **États manquants** : aucun portail ne distingue *token expiré* de *token inexistant* ; `Unsubscribe` affiche « Lien invalide » sur une erreur réseau ; aucun état d'erreur réseau distinct nulle part ; pas de skeletons (spinner nu partout).
35. **Landing, features** : `absolute bottom-6 left-6` sans parent `relative` direct (SkalrLanding L392) — l'encart « Match IA » se positionne par rapport au wrapper motion, pas à la carte gradient.
36. **Donnée non persistée** : la fourchette TJM saisie en onboarding freelance est calculée et transmise à `onSubmit` mais jamais écrite en base.
37. **Police morte** : Space Grotesk préchargée dans `index.html` mais absente de `tailwind.config.ts` — 1 requête de font inutile sur toutes les pages.

---

Résumé (le fichier n'a pas pu être écrit — contenu ci-dessus à sauvegarder) :

1. Périmètre couvert : 11 routes publiques/auth/onboarding/portails, aucune sous `AppLayout` ; seule `/` force `.light`, tout le reste hérite du dark.
2. Landing (717 l.) : nav + drawer mobile, hero `landing-sky-gradient` + démo produit animée 11 s câblée en dark, 4 features, 3 valeurs, 3 stats, témoignage fictif inversé, FAQ 4 items, CTA final, footer, 2 modales (Calendly placeholder + contact 4 champs).
3. Auth : 4 modes (connexion / inscription / oubli / reset via hash `recovery|magiclink`), Google OAuth, bandeau invitation, aucun `<label>`, erreurs Supabase non traduites, redirige vers `/missions` — jamais vers `/onboarding`.
4. Onboarding : 3 flows (enterprise/agency 4 étapes, freelance 5), shell éditorial serif, barre 1 px, interstitiels « Chapitre un — », scènes OrgType/OrgDetails/Specializations/Organization/LinkedIn/Launch documentées au champ et au bouton près.
5. Portail candidat : lecture seule, 8 étapes de timeline, FAQ par défaut, bloc recruteur inversé, brutalisme sans `rounded`.
6. Portail client : 3 onglets, KPI/funnel/kanban read-only, sheet + scorecard 5 critères notée /5 affichée /100, overlay 1re visite, tutoiement, gradients Skalr animés.
7. `/r/:slug`, `/privacy`, `/privacy-extension`, `/unsubscribe` : tous les états, libellés et liens relevés (dont un spinner carré et un « Lien invalide » affiché sur erreur réseau).
8. Typo/couleurs : `font-editorial` (Instrument Serif), `landing-sky-gradient`, `--landing-accent-yellow` (1 seul emploi), `skalr-gradient-*`/`konekt-skalr-bg` cantonnés à la démo et au portail client.
9. **37 anomalies** listées : 4 dialectes visuels concurrents, `--success` inexistant utilisé 3 fois, ~14 `text-[Npx]` interdits, Calendly placeholder, TJM non persisté, modales sans focus trap, `PUBLIC_ROUTES` incomplet, ancre `#mentions` morte, 2 taxonomies de pipeline, scores /5 vs /100.
10. Fichiers clés : `src/pages/{SkalrLanding,Auth,Onboarding,CandidatePortal,ClientPortalV2,RecruiterPublicProfile,Privacy,PrivacyExtension,Unsubscribe}.tsx`, `src/components/{landing,onboarding,portal}/*`, `src/index.css`, `tailwind.config.ts`.

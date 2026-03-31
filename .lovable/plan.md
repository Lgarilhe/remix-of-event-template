

# Migration Navigation Top → Sidebar laterale

## Architecture

```text
AVANT                              APRES
┌────────────────────────┐         ┌──────┬─────────────────┐
│      TOP NAVBAR        │         │  S   │                 │
├────────────────────────┤         │  I   │    CONTENT      │
│                        │         │  D   │    (full height) │
│      CONTENT           │         │  E   │                 │
│      (pt-20)           │         │  B   │                 │
│                        │         │  A   │                 │
│                        │         │  R   │                 │
└────────────────────────┘         └──────┴─────────────────┘
                                   Mobile: hamburger menu (pas de sidebar)
```

## Scope

### Ce qui change
1. **Nouveau `AppSidebar` component** — navigation laterale avec les memes liens (Dashboard, Missions, Pipeline, Messages, Settings)
2. **Layout wrapper dans `App.tsx`** — `SidebarProvider` + sidebar + content area pour les routes authentifiees
3. **Supprimer `<Navbar />` des pages internes** — Dashboard, Missions, Pipeline, Inbox, Settings, etc.
4. **Supprimer le `pt-20`** de toutes les pages internes (plus besoin de compenser la navbar fixe)
5. **Header compact** — barre horizontale fine en haut du contenu avec `SidebarTrigger`, titre de page, credits, notifications, avatar

### Ce qui ne change PAS
- Landing page (`/`) garde sa propre nav
- Pages publiques (`/portal`, `/client`, `/auth`, `/onboarding`) pas de sidebar
- Mobile : hamburger menu (le `SidebarProvider` gere ca nativement avec le mode `offcanvas`)
- Toute la logique metier

## Design Sidebar — Brutal Clean

- **Largeur** : 220px expanded, 48px collapsed (icones only)
- **Style** : `bg-background border-r border-foreground`, pas de radius, pas de glass
- **Items** : icone + label, hover = `bg-foreground text-background` (meme signature que les boutons actuels)
- **Active** : `bg-foreground text-background` permanent + accent bar gauche (`border-l-2 border-brutal-accent`)
- **Footer sidebar** : avatar utilisateur + nom org, bouton sign out
- **Toggle** : `Cmd+B` (deja supporte par le composant shadcn)

## Navigation items

| Icone | Label | Route | Badge |
|---|---|---|---|
| LayoutDashboard | Dashboard | /dashboard | — |
| Target | Missions | /missions | — |
| Kanban | Pipeline | /pipeline | — |
| MessageSquare | Messages | /inbox | unread count |
| Settings | Parametres | /settings | — |

Plus en footer : Credits AI, Notifications, Profil/Deconnexion

## Fichiers impactes

| Fichier | Action |
|---|---|
| `src/components/AppSidebar.tsx` | **Creer** — nouveau composant sidebar |
| `src/components/AppHeader.tsx` | **Creer** — barre horizontale fine (trigger + titre + actions) |
| `src/components/AppLayout.tsx` | **Creer** — layout wrapper (SidebarProvider + Sidebar + Header + content) |
| `src/App.tsx` | Wrapper les routes authentifiees dans `AppLayout` |
| `src/components/Navbar.tsx` | Garder pour la landing page uniquement, renommer en `LandingNavbar` |
| ~12 pages internes | Supprimer `<Navbar />` et `pt-20` |

## Implementation sequentielle

1. **Creer AppSidebar + AppHeader + AppLayout** — les 3 nouveaux composants
2. **Integrer dans App.tsx** — wrapper les routes protegees
3. **Nettoyer les pages** — supprimer Navbar + pt-20 de chaque page interne
4. **Renommer Navbar → LandingNavbar** — utilisee uniquement sur `/`


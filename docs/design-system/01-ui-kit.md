# Inventaire UI Kit — `src/components/ui/` (Konekt)

## 0. Fondations

**`src/lib/utils.ts`** — un seul export : `cn(...inputs: ClassValue[]) => twMerge(clsx(inputs))`. Pas d'autre helper (pas de `focusRing`, pas de `sizeMap`).

**Tokens (`tailwind.config.ts` + `src/index.css`)**
- `--radius: 0.75rem` (12px) → `rounded-sm` = 8px, `rounded-md` = 10px, `rounded-lg` = 12px, `rounded-xl` = 16px, `rounded-2xl` = 24px.
- Ombres via CSS vars `--shadow-2xs → --shadow-2xl` (dark : `hsl(0 0% 0% / 0.15→0.4)`, light : `/0.04→0.15`).
- Couleurs sémantiques : `border input ring background foreground primary secondary destructive muted accent popover card sidebar.* success.{DEFAULT,foreground,muted} warning.* info.* brand.{purple,pink,blue,cyan,green} linkedin.* whatsapp`.
- `--ring` dark = `0 0% 100% / 25%`, light = `40 3% 60%`.
- fontSize étendus `3xs` (10/14px) et `2xs` (11/15px) — commentaire explicite dans la config : « Bannit l'usage de `text-[Npx]` arbitraires ».
- Fonts : `brand` (Bricolage Grotesque), `sans` (Instrument Sans), `display` (Outfit), `serif` (Instrument Serif), `mono` (Space Mono).
- Keyframes maison : `accordion-down/up`, `zoom-in`, `fade-zoom-in`, `fade-in`, `slide-in-right/left`, `scroll-left`, `scan`, `shimmer`.
- Plugins : `tailwindcss-animate`, `@tailwindcss/typography`.

**Fichiers contenant des `cva`** : `button.tsx`, `badge.tsx`, `sheet.tsx`, `toast.tsx`, `alert.tsx`, `toggle.tsx`, `label.tsx` (cva sans variante), `sidebar.tsx`. Deux composants utilisent des **maps objets** au lieu de cva : `IconTile.tsx` (`TONE_CLASSES`/`SIZE_CLASSES`), `ChannelIcon.tsx` (`SIZES`).

---

## 1. Composants détaillés

### button.tsx — custom (`@radix-ui/react-slot`)
Base : `inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-full text-sm font-medium ring-offset-background transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0`

| variant | classes |
|---|---|
| `default` | `border border-border bg-transparent text-foreground hover:bg-accent` |
| `primary` | `bg-primary text-primary-foreground hover:bg-primary/90` |
| `destructive` | `bg-destructive text-destructive-foreground hover:bg-destructive/90` |
| `outline` | `border border-border bg-transparent text-foreground hover:bg-accent` (**identique à `default`**) |
| `secondary` | `bg-secondary text-secondary-foreground hover:bg-secondary/80` |
| `ghost` | `hover:bg-accent hover:text-accent-foreground` |
| `link` | `text-foreground underline-offset-4 hover:underline` |

| size | classes | hauteur |
|---|---|---|
| `default` | `h-10 px-5 py-2` | 40px |
| `xs` | `h-8 px-3 text-xs` | 32px |
| `sm` | `h-9 px-4` | 36px |
| `lg` | `h-11 px-8` | 44px |
| `icon` | `h-10 w-10` | 40px |

`defaultVariants: { variant: "default", size: "default" }`. Icônes forcées à `size-4` (16px), gap 2 (8px).
API : `asChild?: boolean`, `loading?: boolean` (rend `<Loader2 className="animate-spin"/>` avant children, et force `disabled = disabled || loading`). **Bug latent** : en mode `asChild`, `disabled` est passé à un `Slot` (attribut invalide sur `<a>`), et le spinner n'est pas rendu.

### badge.tsx — custom `<div>`
Base : `inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2` (**`focus:` et non `focus-visible:`**, contrairement au reste du kit).

| variant | classes |
|---|---|
| `default` | `border-transparent bg-primary text-primary-foreground hover:bg-primary/80` |
| `secondary` | `border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80` |
| `destructive` | `border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80` |
| `outline` | `text-foreground border-border` |
| `success` | `border-transparent bg-[hsl(var(--status-success))] text-[hsl(var(--status-success-foreground))]` |
| `warning` | `border-transparent bg-[hsl(var(--status-warning))] text-[hsl(var(--status-warning-foreground))]` |
| `info` | `border-transparent bg-[hsl(var(--status-info))] text-[hsl(var(--status-info-foreground))]` |
| `muted` | `border-transparent bg-muted text-muted-foreground` |

`defaultVariants: { variant: "default" }`. Pas de `size`. `forwardRef<HTMLDivElement>`.
**Anomalie** : `success/warning/info` écrivent `bg-[hsl(var(--status-*))]` alors que les tokens `bg-success` / `bg-warning` / `bg-info` existent déjà dans `tailwind.config.ts`.

### card.tsx — custom, aucune cva
- `Card` : `rounded-xl border border-border bg-card text-card-foreground shadow-sm`
- `CardHeader` : `flex flex-col space-y-1.5 p-6`
- `CardTitle` (`<h3>`) : `text-2xl font-semibold leading-none tracking-tight`
- `CardDescription` (`<p>`) : `text-sm text-muted-foreground`
- `CardContent` : `p-6 pt-0`
- `CardFooter` : `flex items-center p-6 pt-0`

Aucune variante (pas de `padding`, `elevated`, `interactive`). `CardTitle` à `text-2xl` est très gros pour un usage dashboard → surchargé partout par `className`.

### input.tsx — `<input>` natif
`flex h-10 w-full rounded-lg border border-input bg-background px-3 py-2 text-base ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm`
API : `error?: boolean` → ajoute `aria-invalid` + `border-destructive focus-visible:ring-destructive`. Pas de `size`.

### textarea.tsx — `<textarea>` natif
`flex min-h-[80px] w-full rounded-lg border border-input bg-background px-3 py-2 text-base ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm`
**Pas de prop `error`** (asymétrie avec `Input`). `min-h-[80px]` arbitraire.

### select.tsx — `@radix-ui/react-select`
- `SelectTrigger` : `flex h-10 w-full items-center justify-between rounded-lg border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 [&>span]:line-clamp-1` + `ChevronDown h-4 w-4 opacity-50`. **`focus:` au lieu de `focus-visible:`**, et `text-sm` alors qu'`Input` est `text-base md:text-sm`.
- `SelectContent` : `relative z-[9999] max-h-96 min-w-[8rem] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-md` + anims `data-[state=open]:animate-in data-[state=closed]:animate-out fade-out-0/fade-in-0 zoom-out-95/zoom-in-95 slide-in-from-{top,bottom,left,right}-2`. `position="popper"` par défaut + translate 1px par side. Viewport `p-1`.
- `SelectItem` : `relative flex w-full cursor-default select-none items-center rounded-sm py-1.5 pl-8 pr-2 text-sm outline-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground`, indicator `Check h-4 w-4` dans `absolute left-2 h-3.5 w-3.5`.
- `SelectLabel` : `py-1.5 pl-8 pr-2 text-sm font-semibold` — `SelectSeparator` : `-mx-1 my-1 h-px bg-muted`.
- Scroll buttons : `flex cursor-default items-center justify-center py-1`.

### dialog.tsx — `@radix-ui/react-dialog`
- `DialogOverlay` : `fixed inset-0 z-[9998] bg-black/80` + fade in/out.
- `DialogContent` : `fixed left-[50%] top-[50%] z-[9999] grid w-full max-w-lg translate-x-[-50%] translate-y-[-50%] gap-4 border border-border bg-card p-6 shadow-lg duration-200 … zoom-out-95/zoom-in-95 slide-out-to-left-1/2 slide-out-to-top-[48%] slide-in-from-left-1/2 slide-in-from-top-[48%] rounded-xl`. Note : fond `bg-card`, pas `bg-background`.
- Close : `absolute right-2 top-2 p-2 rounded-sm opacity-70 ring-offset-background transition-opacity data-[state=open]:bg-accent data-[state=open]:text-muted-foreground hover:opacity-100 focus:ring-2 focus:ring-ring focus:ring-offset-2 disabled:pointer-events-none`, `aria-label="Fermer"` (FR), icône `X h-4 w-4`.
- `DialogHeader` : `flex flex-col space-y-1.5 text-center sm:text-left` — `DialogFooter` : `flex flex-col-reverse sm:flex-row sm:justify-end sm:space-x-2`.
- `DialogTitle` : `text-lg font-semibold leading-none tracking-tight` — `DialogDescription` : `text-sm text-muted-foreground`.

### alert-dialog.tsx — `@radix-ui/react-alert-dialog`
Classes de `Content`/`Overlay` **strictement identiques à dialog.tsx** (duplication littérale). Différences : `AlertDialogHeader` utilise `space-y-2` (vs `space-y-1.5` de Dialog), `AlertDialogTitle` = `text-lg font-semibold` (sans `leading-none tracking-tight`), **pas de bouton close**. `AlertDialogAction` = `buttonVariants()` → variante `default` = bouton **outline transparent**, pas un CTA plein ; `AlertDialogCancel` = `buttonVariants({variant:"outline"}) + "mt-2 sm:mt-0"` → **Action et Cancel sont visuellement identiques**.

### sheet.tsx — `@radix-ui/react-dialog` + cva
Overlay identique à Dialog (`z-[9998] bg-black/80`).
Base cva : `fixed z-[9999] gap-4 bg-background p-6 shadow-lg transition ease-in-out data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:duration-300 data-[state=open]:duration-500`

| side | classes |
|---|---|
| `top` | `inset-x-0 top-0 border-b slide-out-to-top / slide-in-from-top` |
| `bottom` | `inset-x-0 bottom-0 border-t slide-out-to-bottom / slide-in-from-bottom` |
| `left` | `inset-y-0 left-0 h-full w-3/4 border-r … sm:max-w-sm` |
| `right` | `inset-y-0 right-0 h-full w-3/4 border-l …` (**pas de `sm:max-w-sm`**, asymétrie avec `left`) |

`defaultVariants: { side: "right" }`. **Pas de `rounded-*`** (angles droits) alors que Dialog/Drawer sont `rounded-xl`. Fond `bg-background` vs `bg-card` du Dialog.
Logique custom notable : `onPointerDownOutside` + `onInteractOutside` `preventDefault()` si la cible est dans `[data-radix-popper-content-wrapper]`, `[role="listbox"]`, `[role="dialog"]`, `[role="menu"]`, `[data-radix-select-viewport]` (fix Select-dans-Sheet).
`SheetHeader` : `space-y-2` — `SheetTitle` : `text-lg font-semibold text-foreground`.

### drawer.tsx — `vaul` (`DrawerPrimitive`)
`Drawer` wrappe `Root` avec `shouldScaleBackground = true`. Overlay : `fixed inset-0 z-[9998] bg-black/80` (**sans animation**, contrairement aux 3 autres overlays). Content : `fixed inset-x-0 bottom-0 z-[9999] mt-24 flex h-auto flex-col rounded-t-xl border bg-background` + poignée `mx-auto mt-4 h-2 w-[100px] rounded-full bg-muted`. `DrawerHeader` : `grid gap-1.5 p-4 text-center sm:text-left` (padding `p-4` vs `p-6` de Dialog/Sheet). `DrawerFooter` : `mt-auto flex flex-col gap-2 p-4`.

### dropdown-menu.tsx — `@radix-ui/react-dropdown-menu`
- `Content` : `z-[9999] min-w-[8rem] overflow-hidden rounded-xl border border-border bg-popover p-1 text-popover-foreground shadow-md` + anims standard. `sideOffset = 4`.
- `SubContent` : idem mais `shadow-lg` (**incohérence md/lg**).
- `Item` : `relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none transition-colors data-[disabled]:pointer-events-none data-[disabled]:opacity-50 focus:bg-accent focus:text-accent-foreground` + `inset && "pl-8"`.
- `SubTrigger` : `… rounded-sm px-2 py-1.5 text-sm outline-none data-[state=open]:bg-accent focus:bg-accent` (**pas de `focus:text-accent-foreground`, pas de `transition-colors`**) + `ChevronRight ml-auto h-4 w-4`.
- `CheckboxItem` / `RadioItem` : `py-1.5 pl-8 pr-2`, indicateur `absolute left-2 h-3.5 w-3.5` avec `Check h-4 w-4` / `Circle h-2 w-2 fill-current`.
- `Label` : `px-2 py-1.5 text-sm font-semibold` — `Separator` : `-mx-1 my-1 h-px bg-muted` — `Shortcut` : `ml-auto text-xs tracking-wider opacity-60`.
- API : `inset?: boolean` sur `Item`, `SubTrigger`, `Label`.

### popover.tsx — `@radix-ui/react-popover`
`z-[9999] w-72 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-md outline-none` + anims standard. `align="center"`, `sideOffset=4`. Hack : `style={{ pointerEvents: 'auto', ...props.style }}`.

### tooltip.tsx — `@radix-ui/react-tooltip`
`z-[9999] overflow-hidden rounded-lg border border-border bg-popover px-3 py-1.5 text-sm text-popover-foreground shadow-md animate-in fade-in-0 zoom-in-95 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:zoom-out-95 + slide-in-from-*-2`. `sideOffset=4`. `rounded-lg` alors que popover/dropdown/hover-card sont `rounded-xl`.

### hover-card.tsx — `@radix-ui/react-hover-card`
`z-[9999] w-80 rounded-xl border border-border bg-popover p-4 text-popover-foreground shadow-lg outline-none` + anims. `sideOffset=6` (**seul composant à 6**, les autres 4).

### tabs.tsx — `@radix-ui/react-tabs`
- `TabsList` : `inline-flex h-10 items-center justify-center rounded-full bg-muted p-1 text-muted-foreground`
- `TabsTrigger` : `inline-flex items-center justify-center whitespace-nowrap rounded-full px-3 py-1.5 text-sm font-medium ring-offset-background transition-all data-[state=active]:bg-background data-[state=active]:text-foreground data-[state=active]:shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50`
- `TabsContent` : `mt-2 ring-offset-background focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2`
Aucune variante (pas de `underline`/`pills`). Le style est « pill » codé en dur.

### table.tsx — custom, aucune cva
- `Table` : wrapper `relative w-full overflow-auto` + `<table>` `w-full caption-bottom text-sm`
- `TableHeader` : `[&_tr]:border-b` — `TableBody` : `[&_tr:last-child]:border-0`
- `TableFooter` : `border-t bg-muted/50 font-medium [&>tr]:last:border-b-0`
- `TableRow` : `border-b border-border transition-colors data-[state=selected]:bg-muted hover:bg-accent/50`
- `TableHead` : `h-12 px-4 text-left align-middle font-medium text-muted-foreground [&:has([role=checkbox])]:pr-0`
- `TableCell` : `p-4 align-middle [&:has([role=checkbox])]:pr-0`
- `TableCaption` : `mt-4 text-sm text-muted-foreground`
Pas de variante densité ; `p-4` (16px) est très aéré, header `text-sm` non uppercase.

### toast.tsx / toaster.tsx / use-toast.ts / sonner.tsx — **DOUBLON**
`toast.tsx` (`@radix-ui/react-toast`) :
- `ToastViewport` : `fixed top-0 z-[100] flex max-h-screen w-full flex-col-reverse p-4 sm:bottom-0 sm:right-0 sm:top-auto sm:flex-col md:max-w-[420px]` — **`z-[100]`, sous les overlays `z-[9998/9999]` : un toast est masqué par un Dialog ouvert.**
- cva base : `group pointer-events-auto relative flex w-full items-center justify-between space-x-4 overflow-hidden rounded-md border p-6 pr-8 shadow-lg transition-all` + swipe `data-[swipe=cancel]:translate-x-0 data-[swipe=end]:translate-x-[var(--radix-toast-swipe-end-x)] data-[swipe=move]:translate-x-[var(--radix-toast-swipe-move-x)] data-[swipe=move]:transition-none` + `data-[state=closed]:fade-out-80 slide-out-to-right-full slide-in-from-top-full sm:slide-in-from-bottom-full`.
- variants : `default: "border bg-background text-foreground"`, `destructive: "destructive group border-destructive bg-destructive text-destructive-foreground"`. `defaultVariants: { variant: "default" }`. **Pas de success/warning/info** alors que `Badge` en a.
- `ToastAction` : `inline-flex h-8 shrink-0 items-center justify-center rounded-md border bg-transparent px-3 text-sm font-medium ring-offset-background transition-colors group-[.destructive]:border-muted/40 hover:bg-secondary … focus:ring-2 focus:ring-ring focus:ring-offset-2 group-[.destructive]:focus:ring-destructive disabled:opacity-50` — **ré-implémente un bouton au lieu d'utiliser `buttonVariants`**.
- `ToastClose` : `absolute right-2 top-2 rounded-md p-1 text-foreground/50 opacity-0 group-hover:opacity-100 …`
- `ToastTitle` : `text-sm font-semibold` — `ToastDescription` : `text-sm opacity-90`.
- `rounded-md` + `p-6` : radius et padding hors norme du kit (dialogs = `rounded-xl`).

`toaster.tsx` : consomme `useToast()` de `@/hooks/use-toast`, mappe en `<Toast>`. `use-toast.ts` n'est qu'un **re-export** de `@/hooks/use-toast` (fichier redondant, 2 lignes).
`sonner.tsx` : `Toaster` de `sonner` + `useTheme()` de `next-themes`, classNames `group-[.toaster]:bg-background/text-foreground/border-border/shadow-lg`, `description: group-[.toast]:text-muted-foreground`, `actionButton: group-[.toast]:bg-primary …`, `cancelButton: group-[.toast]:bg-muted …`. Réexporte aussi `toast`.
**Dans `App.tsx` : les deux sont importés (`Toaster`, `Toaster as Sonner`) mais seul `<Toaster />` (radix) est monté ligne 148 → `sonner.tsx` est du code mort.**

### alert.tsx — custom `<div role="alert">`
Base : `relative w-full rounded-lg border p-4 [&>svg~*]:pl-7 [&>svg+div]:translate-y-[-3px] [&>svg]:absolute [&>svg]:left-4 [&>svg]:top-4 [&>svg]:text-foreground`
variants : `default: "bg-background text-foreground"`, `destructive: "border-destructive/50 text-destructive [&>svg]:text-destructive"`. `defaultVariants: { variant: "default" }`. **Pas de success/warning/info.**
`AlertTitle` (`<h5>`) : `mb-1 font-medium leading-none tracking-tight` — `AlertDescription` (`<div>`) : `text-sm [&_p]:leading-relaxed`.

### sidebar.tsx — custom (637 l.), utilise Sheet/Tooltip/Button/Input/Separator/Skeleton
Constantes : `SIDEBAR_COOKIE_NAME="sidebar:state"`, max-age 7j, `SIDEBAR_WIDTH="16rem"`, `SIDEBAR_WIDTH_MOBILE="18rem"`, `SIDEBAR_WIDTH_ICON="3rem"`, raccourci `Cmd/Ctrl+B`.
Contexte : `state: "expanded"|"collapsed"`, `open`, `setOpen`, `openMobile`, `setOpenMobile`, `isMobile`, `toggleSidebar`. `useSidebar()` throw hors provider.
- `SidebarProvider` : `group/sidebar-wrapper flex min-h-svh w-full has-[[data-variant=inset]]:bg-sidebar`, injecte `--sidebar-width` / `--sidebar-width-icon`, `TooltipProvider delayDuration={0}`.
- `Sidebar` props : `side: "left"|"right"` (déf. `left`), `variant: "sidebar"|"floating"|"inset"` (déf. `sidebar`), `collapsible: "offcanvas"|"icon"|"none"` (déf. `offcanvas`). Mobile → `<Sheet>` avec `w-[--sidebar-width] bg-sidebar p-0 [&>button]:hidden` et `--sidebar-width: 18rem`. Desktop : spacer `relative h-svh w-[--sidebar-width] bg-transparent transition-[width] duration-200 ease-linear` + panneau `fixed inset-y-0 z-10 … transition-[left,right,width] duration-200 ease-linear md:flex`. Variante floating → `rounded-lg border border-sidebar-border shadow`.
- `SidebarTrigger` : `<Button variant="ghost" size="icon" className="h-7 w-7">` — **override de la taille `icon` (h-10 w-10) → contrôle 28px hors échelle.**
- `SidebarRail` : `absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border sm:flex` + curseurs `cursor-w-resize`/`cursor-e-resize`.
- `SidebarInset` (`<main>`) : `relative flex min-h-svh flex-1 flex-col bg-background` + `peer-data-[variant=inset]:min-h-[calc(100svh-theme(spacing.4))] md:…:m-2 md:…:rounded-xl md:…:shadow`.
- `SidebarInput` : `h-8 w-full bg-background shadow-none focus-visible:ring-2 focus-visible:ring-sidebar-ring` — **h-8 vs h-10 de `Input`**.
- `SidebarHeader`/`SidebarFooter` : `flex flex-col gap-2 p-2` — `SidebarSeparator` : `mx-2 w-auto bg-sidebar-border` — `SidebarGroup` : `relative flex w-full min-w-0 flex-col p-2` — `SidebarGroupContent` : `w-full text-sm` — `SidebarMenu` : `flex w-full min-w-0 flex-col gap-1` — `SidebarMenuItem` : `group/menu-item relative`.
- `SidebarGroupLabel` : `flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 outline-none ring-sidebar-ring transition-[margin,opa] duration-200 ease-linear focus-visible:ring-2 [&>svg]:size-4 [&>svg]:shrink-0` + `group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0`.
- `SidebarGroupAction` / `SidebarMenuAction` : `absolute … aspect-square w-5 items-center justify-center rounded-md p-0 text-sidebar-foreground ring-sidebar-ring transition-transform hover:bg-sidebar-accent focus-visible:ring-2 [&>svg]:size-4` + `after:absolute after:-inset-2 after:md:hidden` (hit area mobile). `showOnHover` → `md:opacity-0 group-hover/menu-item:opacity-100 group-focus-within/menu-item:opacity-100 data-[state=open]:opacity-100`.
- **`sidebarMenuButtonVariants`** — base : `peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-none ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 group-has-[[data-sidebar=menu-action]]/menu-item:pr-8 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent group-data-[collapsible=icon]:!size-8 group-data-[collapsible=icon]:!p-2 [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0`

  | variant | classes |
  |---|---|
  | `default` | `hover:bg-sidebar-accent hover:text-sidebar-accent-foreground` (redondant avec la base) |
  | `outline` | `bg-background shadow-[0_0_0_1px_hsl(var(--sidebar-border))] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground hover:shadow-[0_0_0_1px_hsl(var(--sidebar-accent))]` |

  | size | classes |
  |---|---|
  | `default` | `h-8 text-sm` |
  | `sm` | `h-7 text-xs` |
  | `lg` | `h-12 text-sm group-data-[collapsible=icon]:!p-0` |

  `defaultVariants: { variant: "default", size: "default" }`. API : `asChild`, `isActive`, `tooltip` (string ou props de `TooltipContent`).
- `SidebarMenuBadge` : `pointer-events-none absolute right-1 flex h-5 min-w-5 select-none items-center justify-center rounded-md px-1 text-xs font-medium tabular-nums text-sidebar-foreground` + offsets `peer-data-[size=sm]:top-1 / default:top-1.5 / lg:top-2.5`.
- `SidebarMenuSkeleton` : `flex h-8 items-center gap-2 rounded-md px-2`, `Skeleton size-4 rounded-md` optionnel + `h-4 max-w-[--skeleton-width] flex-1` avec **largeur aléatoire `Math.random()*40+50` %** (non déterministe → mismatch SSR/hydratation potentiel).
- `SidebarMenuSub` : `mx-3.5 flex min-w-0 translate-x-px flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5`.
- `SidebarMenuSubButton` (`<a>`) : `flex h-7 min-w-0 -translate-x-px items-center gap-2 overflow-hidden rounded-md px-2 text-sidebar-foreground ring-sidebar-ring hover:bg-sidebar-accent focus-visible:ring-2 active:bg-sidebar-accent [&>svg]:size-4 [&>svg]:text-sidebar-accent-foreground` + `data-[active=true]:bg-sidebar-accent`, `size: "sm"→text-xs | "md"→text-sm`.
**Focus ring sidebar = `ring-sidebar-ring` sans `ring-offset` — divergent du reste du kit (`ring-ring` + `ring-offset-2`).**

### skeleton.tsx
`animate-pulse rounded-md bg-muted`. Pas de forwardRef, pas de variante (`text`/`circle`/`rect`).

### EmptyState.tsx — maison
Wrapper : `rounded-xl border border-border bg-card text-center` + `compact ? "p-6 sm:p-8" : "p-8 sm:p-12"`.
Tile icône : `bg-accent text-foreground rounded-xl flex items-center justify-center mx-auto mb-4` + `compact ? "h-10 w-10" : "h-14 w-14"`.
Titre `<h2>` : `text-base sm:text-lg font-semibold text-foreground mb-2` — description : `text-muted-foreground text-xs sm:text-sm mb-6 max-w-md mx-auto leading-relaxed`.
CTA : **`<button>` natif** `inline-flex items-center gap-2 h-9 px-5 rounded-full bg-transparent text-foreground border border-border text-xs font-medium hover:bg-accent transition-colors` → **duplique `buttonVariants({variant:"default", size:"sm"})` au lieu d'utiliser `<Button>`** (et `text-xs` au lieu de `text-sm`).
Icône du CTA **codée en dur** à `<Settings className="w-4 h-4" />` quel que soit `actionLabel`. `ArrowRight` importé mais inutilisé.
API : `icon: ReactNode`, `title`, `description`, `actionLabel?`, `actionHref?`, `onAction?`, `className?`, `compact?`. Navigation via `useNavigate()`.

### IconTile.tsx — maison, map objets (pas cva)
| tone | classes |
|---|---|
| `default` | `bg-emerald-500/15 text-foreground` ← **couleur palette Tailwind en dur, hors tokens** |
| `success` | `bg-success/15 text-success` |
| `warning` | `bg-warning/15 text-warning` |
| `destructive` | `bg-destructive/15 text-destructive` |
| `info` | `bg-info/15 text-info` |
| `muted` | `bg-foreground/[0.04] text-foreground` |

| size | tile | icon | rounded |
|---|---|---|---|
| `xs` | `h-6 w-6` | `w-3 h-3` | `rounded-md` |
| `sm` | `h-7 w-7` | `w-3.5 h-3.5` | `rounded-md` |
| `md` | `h-9 w-9` | `w-4 h-4` | `rounded-lg` |
| `lg` | `h-12 w-12` | `w-5 h-5` | `rounded-xl` |

Base : `grid place-items-center shrink-0`. Défauts `tone="default"`, `size="md"`. API : `icon?: LucideIcon`, `iconClassName?`, `children?`. `forwardRef` + `export default`.
Commentaire du fichier : pattern « auparavant dupliqué inline ~60 fois ».

### UpgradePrompt.tsx — maison
`rounded-lg border border-border bg-muted/50 p-3 text-sm space-y-2` ; titre `flex items-center gap-2 font-medium text-foreground` + `Sparkles w-4 h-4 shrink-0` ; description `text-xs text-muted-foreground leading-relaxed` ; CTA `<Button variant="outline" size="sm" className="h-8 w-full text-xs">` → **override de `h-9` en `h-8`**, hors échelle. Route en dur `/pricing`. API : `title?` (déf. `'Abonnement requis'`), `description`, `className?`.

### ChannelIcon.tsx — maison
`SIZES = { xs:'w-3 h-3', sm:'w-4 h-4', md:'w-5 h-5', lg:'w-6 h-6' }` (déf. `sm`). Rend un `<img>` (SVG importé depuis `@/assets/{whatsapp,linkedin}-logo.svg`) `rounded-sm` dans un `span inline-flex items-center gap-1`. `showLabel` → `text-xs font-medium text-whatsapp` / `text-linkedin`. Export secondaire `detectChannel(accountType?: string): ChannelType`.
**Échelle de tailles différente de `IconTile`** (`xs/sm/md/lg` mais valeurs 12/16/20/24 vs 24/28/36/48 pour le tile).

### chart.tsx — wrapper Recharts
`ChartConfig` : `Record<string, { label?, icon? } & ({color?} | {theme: Record<"light"|"dark", string>})>`. `THEMES = { light: "", dark: ".dark" }`.
- `ChartContainer` : `flex aspect-video justify-center text-xs` + une longue série de sélecteurs Recharts (`[&_.recharts-cartesian-axis-tick_text]:fill-muted-foreground`, `[&_.recharts-cartesian-grid_line[stroke='#ccc']]:stroke-border/50`, `[&_.recharts-curve.recharts-tooltip-cursor]:stroke-border`, `[&_.recharts-dot[stroke='#fff']]:stroke-transparent`, `[&_.recharts-layer]:outline-none`, `[&_.recharts-polar-grid_[stroke='#ccc']]:stroke-border`, `[&_.recharts-radial-bar-background-sector]:fill-muted`, `[&_.recharts-rectangle.recharts-tooltip-cursor]:fill-muted`, `[&_.recharts-reference-line_[stroke='#ccc']]:stroke-border`, `[&_.recharts-sector[stroke='#fff']]:stroke-transparent`, `[&_.recharts-sector]:outline-none`, `[&_.recharts-surface]:outline-none`).
- `ChartStyle` : **injecte un `<style>` avec `dangerouslySetInnerHTML`** générant `--color-<key>: <color>` par thème.
- `ChartTooltipContent` : `grid min-w-[8rem] items-start gap-1.5 rounded-lg border border-border/50 bg-background px-2.5 py-1.5 text-xs shadow-xl` ; indicateurs `shrink-0 rounded-[2px] border-[--color-border] bg-[--color-bg]` avec `h-2.5 w-2.5` (dot) / `w-1` (line) / `w-0 border-[1.5px] border-dashed bg-transparent` (dashed). Valeur : `font-mono font-medium tabular-nums text-foreground`. API : `hideLabel`, `hideIndicator`, `indicator: "line"|"dot"|"dashed"` (déf. `dot`), `nameKey`, `labelKey`, `labelClassName`.
- `ChartLegendContent` : `flex items-center justify-center gap-4` + `pb-3`/`pt-3` selon `verticalAlign`, puce `h-2 w-2 shrink-0 rounded-[2px]` avec `backgroundColor` inline. API : `hideIcon`, `nameKey`, `verticalAlign` (déf. `bottom`).

### progress.tsx — `@radix-ui/react-progress`
Root : `relative h-4 w-full overflow-hidden rounded-full bg-secondary` ; Indicator : `h-full w-full flex-1 bg-primary transition-all` + `transform: translateX(-${100-value}%)` inline. **`h-4` (16px) très épais**, pas de variantes de taille.

### switch.tsx — `@radix-ui/react-switch`
Root : `peer inline-flex h-6 w-11 shrink-0 cursor-pointer items-center rounded-full border-2 border-transparent transition-colors data-[state=checked]:bg-primary data-[state=unchecked]:bg-input focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:cursor-not-allowed disabled:opacity-50`
Thumb : `pointer-events-none block h-5 w-5 rounded-full bg-background shadow-lg ring-0 transition-transform data-[state=checked]:translate-x-5 data-[state=unchecked]:translate-x-0`

### checkbox.tsx — `@radix-ui/react-checkbox`
`peer h-4 w-4 shrink-0 rounded-sm border border-border ring-offset-background data-[state=checked]:bg-primary data-[state=checked]:border-primary data-[state=checked]:text-primary-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50` ; indicator `flex items-center justify-center text-current` + `Check h-4 w-4`.
**`rounded-sm` = 8px sur une boîte de 16px** (radius token = 12px − 4px) → visuellement presque rond. **Icône `h-4 w-4` dans une boîte `h-4 w-4`** → le check déborde.
Pas d'état `indeterminate` géré.

### radio-group.tsx — `@radix-ui/react-radio-group`
`RadioGroup` : `grid gap-2`. `RadioGroupItem` : `aspect-square h-4 w-4 rounded-full border border-border text-primary ring-offset-background focus:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 data-[state=checked]:border-primary` ; indicator `Circle h-2.5 w-2.5 fill-current text-current`.

### slider.tsx — `@radix-ui/react-slider`
Root : `relative flex w-full touch-none select-none items-center` ; Track : `relative h-2 w-full grow overflow-hidden rounded-full bg-secondary` ; Range : `absolute h-full bg-primary` ; Thumb : `block h-5 w-5 rounded-full border-2 border-primary bg-background ring-offset-background transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50`. Pas de support `orientation="vertical"` stylé.

### command.tsx — `cmdk`
- `Command` : `flex h-full w-full flex-col overflow-hidden rounded-md bg-popover text-popover-foreground` (**`rounded-md` alors que les autres surfaces popover sont `rounded-xl`**)
- `CommandDialog` : `<DialogContent className="overflow-hidden p-0 shadow-lg">` + overrides `[&_[cmdk-group-heading]]:px-2 … [&_[cmdk-input]]:h-12 [&_[cmdk-item]]:px-2 [&_[cmdk-item]]:py-3 [&_[cmdk-item]_svg]:h-5 [&_[cmdk-item]_svg]:w-5`
- `CommandInput` : wrapper `flex items-center border-b px-3` + `Search mr-2 h-4 w-4 shrink-0 opacity-50` + input `flex h-11 w-full rounded-md bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50` (**h-11, encore une hauteur de contrôle différente**)
- `CommandList` : `max-h-[300px] overflow-y-auto overflow-x-hidden` — `CommandEmpty` : `py-6 text-center text-sm` (**className non mergeable, hardcodé**)
- `CommandGroup` : `overflow-hidden p-1 text-foreground [&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-xs [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:text-muted-foreground`
- `CommandItem` : `relative flex cursor-default select-none items-center rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled=true]:pointer-events-none data-[selected='true']:bg-accent data-[selected=true]:text-accent-foreground data-[disabled=true]:opacity-50`
- `CommandSeparator` : `-mx-1 h-px bg-border` (**`bg-border`, alors que select/dropdown utilisent `bg-muted`**) — `CommandShortcut` : `ml-auto text-xs tracking-wider text-muted-foreground`

### calendar.tsx — `react-day-picker` (DayPicker)
`className: "p-3"`. `nav_button` = `buttonVariants({variant:"outline"}) + "h-7 w-7 bg-transparent p-0 opacity-50 hover:opacity-100 rounded-lg"` (**override radius `rounded-full` → `rounded-lg` et taille hors échelle**). `head_cell: "text-muted-foreground w-9 font-normal text-[0.8rem]"` (**`text-[0.8rem]` arbitraire alors que `text-3xs`/`text-2xs` existent**). `cell: "h-9 w-9 text-center text-sm p-0 relative … focus-within:relative focus-within:z-20"`. `day` = `buttonVariants({variant:"ghost"}) + "h-9 w-9 p-0 font-normal aria-selected:opacity-100 rounded-lg"`.
`day_selected: "bg-primary !text-white hover:bg-primary hover:!text-white focus:bg-primary focus:!text-white"` — **`!text-white` codé en dur (3×) au lieu de `text-primary-foreground`**. `day_today: "border border-border aria-selected:!bg-primary aria-selected:!text-white bg-transparent"`. `day_outside: "day-outside text-muted-foreground opacity-50 aria-selected:bg-accent/50 aria-selected:text-muted-foreground aria-selected:opacity-30"`, `day_disabled: "text-muted-foreground opacity-50"`, `day_range_middle: "aria-selected:bg-accent aria-selected:text-accent-foreground"`, `day_hidden: "invisible"`. Icônes `ChevronLeft/Right h-4 w-4`.

### avatar.tsx — `@radix-ui/react-avatar`
`Avatar` : `relative flex h-10 w-10 shrink-0 overflow-hidden rounded-full` (taille unique, pas de variante `size`). `AvatarImage` : `aspect-square h-full w-full`. `AvatarFallback` : `flex h-full w-full items-center justify-center rounded-full bg-muted` (**pas de `text-*` ni `font-*` → typo des initiales non maîtrisée**).

### separator.tsx — `@radix-ui/react-separator`
`shrink-0 bg-border` + `horizontal ? "h-[1px] w-full" : "h-full w-[1px]"`. `decorative = true` par défaut.

### accordion.tsx — `@radix-ui/react-accordion`
`AccordionItem` : `border-b` (`border-b` sans couleur explicite → `border` par défaut). `AccordionTrigger` : `flex flex-1 items-center justify-between py-4 font-medium transition-all hover:underline [&[data-state=open]>svg]:rotate-180` + `ChevronDown h-4 w-4 shrink-0 transition-transform duration-200`. `AccordionContent` : `overflow-hidden text-sm transition-all data-[state=closed]:animate-accordion-up data-[state=open]:animate-accordion-down` + inner `pb-4 pt-0`. **Le `className` de `AccordionContent` est appliqué à l'inner div, pas au Content** (piège d'API).

### collapsible.tsx — `@radix-ui/react-collapsible`
Ré-export brut de `Root`, `CollapsibleTrigger`, `CollapsibleContent`. Zéro style.

### scroll-area.tsx — `@radix-ui/react-scroll-area`
Root `relative overflow-hidden`, Viewport `h-full w-full rounded-[inherit]`, Corner. `ScrollBar` : `flex touch-none select-none transition-colors` + vertical `h-full w-2.5 border-l border-l-transparent p-[1px]` / horizontal `h-2.5 flex-col border-t border-t-transparent p-[1px]` ; Thumb `relative flex-1 rounded-full bg-border`.

### breadcrumb.tsx — custom + `@radix-ui/react-slot`
`Breadcrumb` (`<nav aria-label="breadcrumb">`) — **la prop `separator` est déclarée dans le type mais jamais utilisée**. `BreadcrumbList` : `flex flex-wrap items-center gap-1.5 break-words text-sm text-muted-foreground sm:gap-2.5`. `BreadcrumbItem` : `inline-flex items-center gap-1.5`. `BreadcrumbLink` : `transition-colors hover:text-foreground` (+ `asChild`). `BreadcrumbPage` : `font-normal text-foreground` avec `role="link" aria-disabled aria-current="page"`. `BreadcrumbSeparator` : `[&>svg]:size-3.5` + `ChevronRight` par défaut. `BreadcrumbEllipsis` : `flex h-9 w-9 items-center justify-center` + `MoreHorizontal h-4 w-4` + `<span className="sr-only">More</span>` (**texte EN dans une app FR**). `displayName = "BreadcrumbElipssis"` (typo).

### toggle.tsx / toggle-group.tsx — `@radix-ui/react-toggle(-group)`
Base : `inline-flex items-center justify-center rounded-md text-sm font-medium ring-offset-background transition-colors hover:bg-muted hover:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50 data-[state=on]:bg-accent data-[state=on]:text-accent-foreground`

| variant | classes | | size | classes |
|---|---|---|---|---|
| `default` | `bg-transparent` | | `default` | `h-10 px-3` |
| `outline` | `border border-input bg-transparent hover:bg-accent hover:text-accent-foreground` | | `sm` | `h-9 px-2.5` |
| | | | `lg` | `h-11 px-5` |

`defaultVariants: { variant: "default", size: "default" }`. **`rounded-md` alors que `Button` est `rounded-full`** — Toggle et Button ne peuvent pas cohabiter dans une même barre. `hover:text-muted-foreground` sur la base est douteux (assombrit au survol).
`ToggleGroup` : `flex items-center justify-center gap-1` + contexte propageant `variant`/`size` (fallback `context.variant || variant`).

### form.tsx — `react-hook-form`
`Form = FormProvider`. `FormField` = `Controller` + contexte de nom. `useFormField()` renvoie `{id, name, formItemId, formDescriptionId, formMessageId, ...fieldState}` — **le `throw` sur `!fieldContext` arrive APRÈS `getFieldState(fieldContext.name)`, donc il crash avant** (bug). `FormItem` : `space-y-2` + `React.useId()`. `FormLabel` : `Label` + `error && "text-destructive"`. `FormControl` : `Slot` avec `aria-describedby` / `aria-invalid`. `FormDescription` : `text-sm text-muted-foreground`. `FormMessage` : `text-sm font-medium text-destructive`, retourne `null` si vide.
**Ne branche pas la prop `error` de `Input`** → la bordure rouge de l'input n'apparaît pas via le form.

### carousel.tsx — `embla-carousel-react`
API : `opts`, `plugins`, `orientation: "horizontal"|"vertical"` (déf. `horizontal`), `setApi`. Contexte `useCarousel()`. Root `relative` + `role="region" aria-roledescription="carousel"` ; `CarouselContent` : wrapper `overflow-hidden` + `flex` + `-ml-4` (h) / `-mt-4 flex-col` (v) ; `CarouselItem` : `min-w-0 shrink-0 grow-0 basis-full` + `pl-4` / `pt-4`. `CarouselPrevious/Next` : `<Button variant="outline" size="icon">` + `absolute h-8 w-8 rounded-full` + `-left-12/-right-12 top-1/2 -translate-y-1/2` (h) ou `-top-12/-bottom-12 left-1/2 -translate-x-1/2 rotate-90` (v) ; `disabled={!canScroll*}`. Textes `sr-only` en anglais.

### aspect-ratio.tsx
`export { AspectRatio }` = `AspectRatioPrimitive.Root`. Zéro style.

### label.tsx — `@radix-ui/react-label`
`labelVariants = cva("text-sm font-medium leading-none peer-disabled:cursor-not-allowed peer-disabled:opacity-70")` — **cva sans bloc `variants`, donc inutile** ; `VariantProps<typeof labelVariants>` est un type vide.

---

## 2. Composants « maison » animés

| Fichier | Techno | API | Notes |
|---|---|---|---|
| `AnimatedOrb.tsx` | `<canvas>` + `requestAnimationFrame`, DPR-aware | `size = 40`, `speed = 1`, `className`, `children` (ignoré, « kept for compat ») | Palette `SKALR_COLORS` **RGB en dur** : `[124,58,237]` purple, `[236,72,153]` pink, `[59,130,246]` blue, `[225,112,255]` magenta. Fonds `rgba(15,15,20,0.95)` (dark) / `rgba(255,255,255,0.97)` (light), pupille `#050508`, highlights `rgba(255,255,255,0.85)` / `0.5`. Wrapper `shrink-0` + `style={{width:size,height:size}}` |
| `AnimatedChatBubble.tsx` | idem canvas | `size = 40`, `speed = 1`, `className` | Même palette RGB en dur ; gradients `rgba(...,0.18/0.06)`, particules `rgba(c,alpha)` |
| `AnimatedCompass.tsx` | idem canvas | `size = 40`, `speed = 1`, `className` | Graduations `rgba(255,255,255,0.2)` / `rgba(0,0,0,0.15)` en dur |
| `AnimatedFunnel.tsx` | idem canvas + système de `Particle {x,y,vy,r,color,opacity}` | `size = 40`, `speed = 1`, `className` | Glow `rgba(...,0.15)`, drip gradient pulsé |
| `background-paths.tsx` | `framer-motion` `<motion.path>` sur SVG `viewBox="0 0 1600 900"` `preserveAspectRatio="xMidYMid slice"` | `className?`, `pathCount = 8` | **Seul animé tokenisé** : `color = hsl(var(--primary) / ${0.08 + (i%4)*0.04})`. Chemins déterministes via PRNG `Math.sin(seed*9301 + n*49297 + 233280)`. Anim `pathLength [0,1,0]`, `opacity [0,0.6,0]`, `repeat: Infinity` |
| `text-rotate.tsx` | `framer-motion` + `AnimatePresence mode="wait"` | `texts: string[]`, `interval = 3000`, `className?`, `rotationType: 'slide'\|'flip'\|'blur'` (déf. `slide`) | `slide` : y ±30 + `blur(4px)` ; `flip` : `rotateX ∓90` ; `blur` : `scale 0.8→1→1.2` + `blur(12px)`. Transition spring `stiffness 300, damping 30, mass 0.8`. Wrapper `relative inline-flex overflow-hidden` + `perspective: 500px` inline |
| `brutal-loader.tsx` | CSS/Tailwind, pas de lib | `className?`, `variant: 'default'\|'search'\|'sequences'`, `messages?: string[]`, `rows = 3`, `compact?` | `BrutalSpinner({size=44})` : track `absolute inset-0 border border-foreground/15`, arc `border-2 border-transparent border-t-foreground border-r-foreground animate-[spin_1s_linear_infinite]`, carré interne `bg-foreground animate-pulse` (`animationDuration: '1.6s'`, taille `size*0.32`). Messages FR rotatifs (3 sets), fade 300ms toutes les 2400ms. Skeleton rows : `h-11 border border-foreground/[0.06] bg-muted/40 relative overflow-hidden animate-fade-in` + shimmer `linear-gradient(90deg, transparent, hsl(var(--primary)/0.04), hsl(var(--primary)/0.08), …)` inline, `animate-[shimmer_2s_ease-in-out_infinite]`, largeurs `${60+(i%3)*15}%` / `${35+(i%2)*20}%`. Mode compact : `flex items-center gap-3 py-4` + spinner 20px + `text-xs text-muted-foreground tracking-wider` |

**`magicui/` : le dossier n'existe pas** dans ce repo (aucun fichier).

---

## 3. ANOMALIES

### 3.1 Valeurs en dur (couleurs)
| Fichier | Valeur | Devrait être |
|---|---|---|
| `badge.tsx` ×3 | `bg-[hsl(var(--status-success))]` / `--status-warning` / `--status-info` + `text-[hsl(var(--status-*-foreground))]` | `bg-success text-success-foreground`, etc. (tokens existants) |
| `IconTile.tsx` | `bg-emerald-500/15` (tone `default`) | token `--skalr-green` / `bg-success/15` |
| `calendar.tsx` ×5 | `!text-white`, `aria-selected:!text-white` | `text-primary-foreground` |
| `dialog.tsx`, `alert-dialog.tsx`, `sheet.tsx`, `drawer.tsx` | `bg-black/80` (4×) | token d'overlay (`bg-foreground/80` ou `--overlay`) |
| `AnimatedOrb/ChatBubble/Compass/Funnel` | `rgba(124,58,237)`, `(236,72,153)`, `(59,130,246)`, `(225,112,255)`, `rgba(15,15,20,0.95)`, `rgba(255,255,255,0.97)`, `#050508`, `rgba(0,0,0,0.15)` | dérivés de `--skalr-*` / `--background` |
| `sidebar.tsx` | `shadow-[0_0_0_1px_hsl(var(--sidebar-border))]` | `border` normal |
| `AnimatedOrb`+co | palette **SKALR** (violet/rose) alors que le design 2026 est monochrome (cf. commentaire de `brutal-loader.tsx` : « Ne matchait plus le design Konekt monochrome actuel ») | à réaligner |

### 3.2 Valeurs arbitraires `-[...]`
`textarea.tsx:11` `min-h-[80px]` · `drawer.tsx:39` `w-[100px]` · `toast.tsx:17` `md:max-w-[420px]` · `command.tsx:63` `max-h-[300px]` · `calendar.tsx:29` `text-[0.8rem]` (**alors que `text-3xs`/`text-2xs` ont été ajoutés à la config pour ça**) · `chart.tsx:185,262` `rounded-[2px]`, `border-[1.5px]` · `sidebar.tsx:257` `after:w-[2px]`, `:278` `min-h-[calc(100svh-theme(spacing.4))]` · `scroll-area.tsx:27-28` `p-[1px]` · `separator.tsx:14` `h-[1px] w-[1px]` · `dialog.tsx`/`alert-dialog.tsx` `slide-*-to-top-[48%]` · `brutal-loader.tsx` largeurs inline `${60+(i%3)*15}%`.
Aucun `text-[Npx]` en pixels bruts (la règle de la config est respectée sur ce point), mais `text-[0.8rem]` la contourne.

### 3.3 Hauteurs de contrôle non alignées
| Hauteur | Composants |
|---|---|
| 28px `h-7` | `SidebarTrigger` (override de `size="icon"`), `calendar` nav_button, `SidebarMenuSubButton`, `sidebarMenuButton size=sm` |
| 32px `h-8` | `Button size=xs`, `ToastAction`, `SidebarInput`, `sidebarMenuButton default`, `SidebarMenuSkeleton`, `SidebarGroupLabel`, `CarouselPrevious/Next` (override de `size="icon"`), `UpgradePrompt` CTA (override de `size="sm"`) |
| 36px `h-9` | `Button size=sm`, `Toggle size=sm`, `EmptyState` CTA (bouton natif), `BreadcrumbEllipsis`, `calendar` cell/day, `IconTile md` |
| 40px `h-10` | `Button default`/`icon`, `Input`, `SelectTrigger`, `TabsList`, `Toggle default`, `Avatar` |
| 44px `h-11` | `Button size=lg`, `Toggle size=lg`, `CommandInput`, `brutal-loader` skeleton rows |
| 48px `h-12` | `TableHead`, `sidebarMenuButton size=lg`, `CommandDialog` `[&_[cmdk-input]]:h-12` |
→ **6 échelles concurrentes**, et 4 endroits overrident la taille du `Button` via `className`.

### 3.4 Radius incohérents
| Radius | Composants |
|---|---|
| `rounded-full` | Button, Badge, TabsList/Trigger, Progress, Switch, RadioGroupItem, Slider, Avatar, Drawer handle, ScrollBar thumb, Carousel buttons, EmptyState CTA |
| `rounded-xl` (16px) | Card, DialogContent, AlertDialogContent, DrawerContent (`rounded-t-xl`), SelectContent, DropdownMenuContent/SubContent, PopoverContent, HoverCardContent, EmptyState wrapper + tile, IconTile `lg`, SidebarInset inset |
| `rounded-lg` (12px) | Input, Textarea, SelectTrigger, Alert, TooltipContent, UpgradePrompt, ChartTooltip, IconTile `md`, calendar day/nav, Sidebar floating |
| `rounded-md` (10px) | Skeleton, Toggle/ToggleGroup, Toast, ToastAction/Close, Command root, CommandInput, tous les éléments Sidebar (menu button, badge, group label, actions), IconTile `xs`/`sm` |
| `rounded-sm` (8px) | Checkbox, DialogClose, SheetClose, tous les `*Item` de menus (Select/Dropdown/Command), ChannelIcon `<img>` |
| aucun | SheetContent (angles droits), Table, BrutalLoader |
→ **Tooltip `rounded-lg` vs Popover/Dropdown `rounded-xl`** ; **Toggle `rounded-md` vs Button `rounded-full`** ; **Input `rounded-lg` vs Card `rounded-xl`** ; **Sheet sans radius vs Dialog `rounded-xl`**.

### 3.5 Focus ring non uniforme
| Pattern | Composants |
|---|---|
| `focus-visible:ring-2 ring-ring ring-offset-2` (référence) | Button, Input, Textarea, Tabs, Toggle, Switch, Checkbox, Slider, RadioGroupItem |
| `focus:ring-2 ring-ring ring-offset-2` (**pas `focus-visible`**) | **Badge**, **SelectTrigger**, DialogClose, SheetClose, ToastAction, ToastClose |
| `focus:bg-accent` sans ring | tous les items de menu (Select/Dropdown/Command) |
| `focus-visible:ring-2 ring-sidebar-ring` **sans offset** | tout `sidebar.tsx` |
| `focus-visible:ring-2 ring-destructive` | Input en état `error` |
| aucun | Accordion trigger, BreadcrumbLink, Popover/HoverCard content (`outline-none`) |
De plus `src/index.css` définit un `outline: 2px solid hsl(var(--ring))` global (lignes 224 et 363) qui coexiste avec les rings Tailwind — double halo possible.

### 3.6 Doublons / code mort
1. **Deux systèmes de toast** : `toast.tsx` + `toaster.tsx` + `use-toast.ts` (Radix) **et** `sonner.tsx` (Sonner). `App.tsx` importe les deux (`Toaster`, `Toaster as Sonner`) mais **ne monte que `<Toaster />` (ligne 148)** → `sonner.tsx` + son import sont morts. À trancher : garder un seul système.
2. `use-toast.ts` : fichier de 2 lignes qui re-export `@/hooks/use-toast` — indirection inutile (mais `toaster.tsx` importe directement le hook, donc ce fichier n'est même pas utilisé par lui).
3. `alert-dialog.tsx` duplique **mot pour mot** les classes de `dialog.tsx` (Overlay + Content) — extraire un `overlayClasses`/`modalSurfaceClasses` partagé.
4. `button.variant.default` et `button.variant.outline` sont **strictement identiques**.
5. `sidebarMenuButtonVariants.variant.default` répète les classes hover déjà dans la base.
6. `ToastAction` ré-implémente un bouton au lieu d'utiliser `buttonVariants`.
7. `EmptyState` ré-implémente un bouton (`h-9 px-5 rounded-full border border-border …`) au lieu d'utiliser `<Button>`.
8. `labelVariants` (cva sans variantes) — code inutile.
9. `EmptyState.tsx` importe `ArrowRight` sans l'utiliser ; `breadcrumb.tsx` déclare la prop `separator` sans l'utiliser ; `AnimatedOrb` déclare `children` « ignored, kept for compat ».
10. `IconTile` et `ChannelIcon` utilisent des maps objets au lieu de cva → deux conventions de variantes dans le même dossier.

### 3.7 Composants non utilisés ailleurs dans `src/` (vérifié par grep sur l'import ET sur le symbole)
**0 usage** : `accordion.tsx`, `aspect-ratio.tsx`, `background-paths.tsx`, `breadcrumb.tsx`, `carousel.tsx`, `chart.tsx`, `drawer.tsx`, `form.tsx`, `slider.tsx`, `text-rotate.tsx`, `toggle-group.tsx`, `use-toast.ts`, `AnimatedChatBubble.tsx`, `AnimatedCompass.tsx`.
**1 usage** : `AnimatedFunnel.tsx`, `UpgradePrompt.tsx`, `command.tsx`, `hover-card.tsx`, `sonner.tsx` (importé mais non rendu → 0 réel), `toaster.tsx`, `toggle.tsx`.
**2 usages** : `ChannelIcon.tsx`, `alert.tsx`, `radio-group.tsx`, `toast.tsx`.
**Top usages** : `button` (114), `badge` (58), `input` (57), `alert-dialog` (38), `select` (35), `dialog` (34), `textarea` (30), `label` (25), `card` (24), `tooltip` (23), `scroll-area` (23), `brutal-loader` (20).
→ **~14 fichiers supprimables immédiatement** (dont `chart.tsx`, 303 l., et `carousel.tsx`, 224 l.), + `sonner.tsx` après arbitrage toast.

### 3.8 Autres écarts notables
- `z-index` : overlays/contents à `z-[9998]`/`z-[9999]` en dur partout, **sauf `ToastViewport` à `z-[100]`** (toasts invisibles derrière un modal) et `Sidebar` à `z-10`/`z-20`. Aucune échelle de z-index tokenisée.
- Surfaces incohérentes : `DialogContent` = `bg-card`, `SheetContent`/`DrawerContent` = `bg-background`, popovers = `bg-popover`.
- Séparateurs : `bg-muted` (select, dropdown) vs `bg-border` (command, Separator).
- Ombres : SubContent `shadow-lg` vs Content `shadow-md` dans le même `dropdown-menu.tsx` ; ChartTooltip `shadow-xl` (seul usage).
- `sideOffset` : 4 partout sauf `hover-card` (6).
- i18n : `aria-label="Fermer"` (FR) dans Dialog/Sheet mais `sr-only "More"`, `"Previous slide"`, `"Next slide"`, `"Toggle Sidebar"` (EN).
- `Textarea` n'a pas de prop `error` alors que `Input` en a ; `form.tsx` ne relaie pas `error` à `Input`.
- `Skeleton` et les `*Header/*Footer` de Dialog/Sheet/Drawer ne sont pas `forwardRef`.
- `chart.tsx` utilise `dangerouslySetInnerHTML` pour injecter du CSS.
- `SidebarMenuSkeleton` utilise `Math.random()` dans un `useMemo` (non déterministe).
- Bug `form.tsx` : le `throw` de garde arrive après la déréférence de `fieldContext.name`.
- Espacements de header : `space-y-1.5` (Dialog, Card) vs `space-y-2` (Sheet, AlertDialog) vs `gap-1.5` (Drawer).

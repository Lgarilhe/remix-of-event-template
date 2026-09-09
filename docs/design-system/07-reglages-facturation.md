# INVENTAIRE RÉGLAGES & FACTURATION — Konekt

## 0. Route & shell

`/settings` — `src/App.tsx:187` : `<ProtectedRoute><OrganizationGuard><AppLayout><Settings/></AppLayout></OrganizationGuard></ProtectedRoute>`.
`/pricing` — `src/App.tsx:189`, publique (dans `PUBLIC_ROUTES` L52), **hors** AppLayout (header propre).

`src/pages/Settings.tsx`
- Wrapper : `min-h-screen bg-background` > `py-6 pb-8` > `max-w-[1600px] mx-auto px-3 sm:px-6 lg:px-8`.
- SEO : title `Paramètres | Konekt`, description `Gérez les paramètres de votre organisation`.
- H1 : **« Paramètres »** — `text-xl sm:text-2xl font-bold text-foreground tracking-tight mb-4`.
- Layout : `flex flex-col lg:flex-row lg:gap-10`.
- Nav `role="tablist"` aria-label **« Sections des paramètres »** : `lg:w-60 lg:shrink-0 lg:sticky lg:top-6 lg:max-h-[calc(100vh-3rem)] overflow-y-auto`, mobile `border-b border-border`, `overflow-x-auto no-scrollbar`.
  - Mobile (`flex lg:hidden`) : pills `px-3 h-8 rounded-full text-xs font-medium`, actif `bg-foreground text-background`, inactif `text-foreground/70 hover:bg-muted`. **Pas de groupes.**
  - Desktop (`hidden lg:flex flex-col gap-6`) : label de section `text-[10px] font-bold uppercase tracking-[0.08em] text-muted-foreground/70 px-3 mb-1.5` ; items `px-3 h-9 rounded-lg text-sm font-medium` ; pill animée framer-motion `layoutId="settings-active-pill"`, `bg-foreground rounded-lg shadow-sm`, spring `stiffness:400 damping:32`. Séparateur inter-groupe `mt-3 -mx-1 border-t border-border/60`.
  - Clavier : ArrowLeft/Right/Up/Down/Home/End, roving `tabIndex`.
- Panneau : `role="tabpanel"` `flex-1 min-w-0 max-w-3xl space-y-6 focus:outline-none`.

### Groupes d'onglets (Settings.tsx:153-187)

| Groupe | value | Label exact | Icône | Condition | Deep link |
|---|---|---|---|---|---|
| **Workspace** | `general` | Général | `Building2` | toujours | `/settings` (param supprimé) |
| | `presets` | ICP sociétés | `Bookmark` | `!isCollaborator` | `?tab=presets` |
| | `templates` | Templates | `MessageSquare` | toujours | `?tab=templates` |
| | `ai-context` | Contexte IA | `Wand2` | toujours | `?tab=ai-context` |
| | `agent-actions` | Actions IA | `History` | toujours | `?tab=agent-actions` |
| **Compte & accès** | `account` | Mon compte | `UserCircle` | toujours | `?tab=account` |
| | `team` | Équipe | `Users` | `!isCollaborator && hasFeature(orgType,'team_management')` → **freelance exclu** | `?tab=team` |
| | `connectors` | Connecteurs | `Plug` | `!isCollaborator && hasConnectors` (count `connector_registry.is_active`) | `?tab=connectors` |
| | `integrations` | Intégrations | `Plug` (**doublon d'icône**) | `isAdmin` | `?tab=integrations` |
| **Facturation** | `billing` | Abonnement | `CreditCard` | `isAdmin` | `?tab=billing` |
| | `credits` | Crédits IA | `Sparkles` | toujours | `?tab=credits` |
| **Plus** | `agency` | Agence | `Briefcase` | `hasFeature(orgType,'agency_settings')` → **agency seulement** | `?tab=agency` |
| | `marketplace` | Marketplace | `Store` | toujours | `?tab=marketplace` |

`resolveTab()` (L114-128) : tab non autorisé → fallback `'general'`. `useEffect` re-résout après chargement des droits. `setActiveTab` sync URL en `replace`.

---

## 1. Onglet GÉNÉRAL

`<Card>` unique. `CardTitle` : `flex items-center gap-2 text-sm font-bold uppercase tracking-wider` + `<Building2 className="w-4 h-4"/>` **« Organisation »**. `CardContent className="space-y-4"`.

### OrgLogoEditor (`OrgLogoEditor.tsx`)
- Vignette logo `w-16 h-16 border border-border bg-muted` ; fallback initiales (2 char maj) `text-lg font-bold text-muted-foreground`. Logo effectif = `logo_url` **ou favicon dérivé** `https://www.google.com/s2/favicons?domain=…&sz=128` (**appel Google en dur**).
- Boutons (owner uniquement) :
  - `outline` `size=sm` `h-7 text-xs uppercase tracking-wider gap-1.5` — **« Changer le logo »** / loading **« Upload… »**, icône `Upload`/`Loader2`.
  - `ghost` `h-7 text-xs uppercase … text-destructive` — **« Supprimer »** (`Trash2`), **sans AlertDialog**.
- Validation upload : type `image/*` sinon toast `Fichier image uniquement` ; `> 2 Mo` → `Image trop lourde (max 2 Mo)`. Bucket `org-logos`, path `{orgId}/logo.{ext}`, cache-bust `?v=Date.now()`.
- Champ **Site web** : label `text-sm text-muted-foreground` + icône `Globe w-3.5`. Lecture : valeur ou `Non renseigné` (italic). Bouton crayon = **icône `Building2`** (incohérent : ailleurs c'est `Pencil`), aria-label `Modifier le site web`.
  - Édition : `Input` placeholder `https://monentreprise.com`, `h-9 text-sm max-w-xs`, Enter = save. Bouton **« Sauver »** (`size=sm h-9 gap-1`, spinner ou **caractère `✓` littéral** — pas d'icône Lucide) + **« Annuler »** ghost.
- Aide (si `!logoUrl && website`) : *« Le logo est récupéré automatiquement depuis le domaine. Uploadez un logo custom pour le remplacer. »*
- Toasts : `Logo mis à jour` / `Logo supprimé` / `Site web mis à jour` / `Erreur lors de l'upload` / `Erreur lors de la suppression` / `Erreur lors de la mise à jour`.

### Bloc infos (`border-t border-border pt-3 space-y-3`)
- **Nom** — label `text-sm text-muted-foreground`. Lecture : `<p className="text-foreground font-medium">`, bouton crayon `ghost icon h-7 w-7` (owner). Édition : `Input h-9 text-sm max-w-xs` autoFocus, Enter=save ; **« Sauver »** (disabled si `savingName || !newName.trim()`), **« Annuler »** ghost. Toasts : `Nom mis à jour` / `Erreur lors de la mise à jour`.
- **OrgTypeSetting** (`OrgTypeSetting.tsx`) — label **« Type »**. Admin : 3 pills `h-9 px-4 rounded-full text-[12px] font-medium border`, actif `bg-foreground text-background border-foreground`.
  - `enterprise` → **Entreprise** — *« Vous recrutez pour votre propre entreprise. »*
  - `agency` → **Cabinet** — *« Vous recrutez pour des entreprises clientes. »*
  - `freelance` → **Indépendant** — *« Vous recrutez seul, pour vos clients. »*
  - Fallback aide : *« Choisissez le type de votre espace : il commande les droits et l'accès à la marketplace. »*
  - Non-admin : texte simple, sinon `Non renseigné`. Toasts : `Type mis à jour` / `Le type n'a pas pu être enregistré`.
- **Identifiant** — label `text-sm text-muted-foreground`, valeur `font-mono text-sm` (slug, lecture seule).

---

## 2. Onglet MON COMPTE (`account`)

`<div className="space-y-6">` — 5 cartes empilées, **sans en-tête d'onglet** :
`MyLinkedInAccount` → `ExtensionTokens` → `MyEmailAccount` → `EmailSignatures` → `MyWhatsAppAccount`.

### 2.1 MyLinkedInAccount (969 l.)
CardTitle **`text-lg`** (≠ `text-sm uppercase` du reste) + logo LinkedIn webp — **« Mon compte LinkedIn »**.

**État connecté & sain** : ligne `p-3 bg-muted/50 rounded-lg`, avatar 40px, pastille `w-1.5 h-1.5 rounded-full` `bg-success`/`bg-destructive`, label `Actif` ou `statusLabel(status)`.
`statusLabel()` (L522) : OK→`Actif`, CREDENTIALS→`Session LinkedIn expirée`, CONNECTING→`Connexion en cours…`, CREATION_SUCCESS→`Connexion réussie (sync initiale)`, RECONNECTED→`Reconnecté`, SYNC_SUCCESS→`Synchronisation terminée`, ERROR/STOPPED→`Erreur — arrêté`, DELETED→`Supprimé`, RATE_LIMITED→`Rate limit LinkedIn (patientez)`, CAPTCHA→`Captcha LinkedIn requis`, défaut→brut, null→`Inconnu`.

Boutons : **« Reconnecter »** (`default sm`, `KeyRound`, si non sain) ; **« Dissocier »** (`ghost sm text-destructive`, `Unlink`) → AlertDialog :
- Titre **« Dissocier ce compte LinkedIn ? »**
- Desc : *« Vous ne pourrez plus envoyer de messages ou faire de recherches LinkedIn depuis Konekt jusqu'à ce que vous reconnectiez un compte. Cette action n'efface pas votre compte côté LinkedIn ni les messages déjà envoyés. »*
- Actions : **Annuler** / **Dissocier** (`bg-destructive text-destructive-foreground`).

**État « mapping orphelin »** : encart `bg-warning/5 border-warning/30` — titre *« Compte LinkedIn introuvable »*, desc *« Le mapping pointe vers `<code>` mais ce compte n'existe plus. »*. Boutons **Rafraîchir** (outline) / **Dissocier** (ghost destructive, **sans dialog ici**).

**État non lié** : texte *« Connectez votre compte LinkedIn pour pouvoir effectuer des recherches et envoyer des messages. »*
- Si comptes non mappés : titre `Compte(s) disponible(s) :`, ligne par compte avec badge `Actif` (secondary) et bouton **« C'est mon compte »** (`outline sm`).
- Sinon : **« Connecter mon LinkedIn »** (full-width `sm`, `ExternalLink`/`Loader2`) + **« Rafraîchir les comptes »** (outline full-width, `RefreshCw`).
- `<details>` **« Reconnecter avec un cookie li_at »** (`KeyRound`, chevrons) → `ReconnectForm`.

**ReconnectForm** (`space-y-3 p-3 border rounded-lg bg-muted/30`) :
- Encart statut (si ≠ OK) : `bg-warning/5 border-warning/30`, titre = `statusLabel`, aide *« Récupérez un cookie li_at frais depuis votre navigateur connecté à LinkedIn. »*
- Encart rouge `bg-destructive/5 border-destructive/40` : **« ⚠️ À lire avant de reconnecter »** — mentionne explicitement **LinkedIn Recruiter**, **Chrome**, navigation privée, profil Chrome séparé.
- `<details open>` **« Comment récupérer le cookie li_at (étape par étape) »** — 7 étapes numérotées, `<kbd>Ctrl+Shift+N</kbd>`, `F12`, `Cmd+Opt+I`, onglets Application/Storage, `AQEDATxxxxxx...`, avertissement rouge « Copiez UNIQUEMENT la valeur ».
- Champs :
  1. **Cookie li_at** — `type=password`, placeholder `Coller uniquement la valeur (ex: AQEDAT...)`, `text-xs font-mono`, aria-invalid. Validation `looksLikeLiAt()` : vide→`Cookie vide` ; <30→`Cookie trop court (< 30 caractères)` ; espace/\n→`Cookie contient des espaces ou retours ligne` ; `@`→`Cela ressemble à un email, pas à un cookie` ; `=`→`Copiez uniquement la VALEUR du cookie (pas "li_at=...")`. Aide sous champ = raccourci DevTools.
  2. **Cookie li_a (Recruiter / Sales Navigator, optionnel)** — password, placeholder `Coller la valeur du cookie li_a (uniquement si Recruiter / Sales Nav)`.
  3. **User-Agent \*** — placeholder `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36...` ; lien texte **« Utiliser mon navigateur actuel »** ; erreur *« Ceci ne ressemble pas à un User-Agent. Un UA commence par "Mozilla/" — utilisez le bouton ci-dessus. »* ; aide *« Obligatoire — chaîne technique de votre navigateur… »*
  4. **Pays du proxy \*** — `w-20 uppercase font-mono`, placeholder `FR`, maxLength 2, regex `^[A-Z]{2}$`, aide ISO.
- Submit **« Reconnecter »** / loading **« Connexion… »** (`CheckCircle2`/`Loader2`), disabled si une validation échoue. **« Annuler »** ghost (masqué si `hideCancel`).
- Toasts : `Compte LinkedIn reconnecté ✓` ; `Veuillez coller votre cookie li_at` ; `Session expirée, reconnectez-vous` ; warning `LinkedIn demande une vérification (<type>). Validez-la dans LinkedIn puis réessayez.` (8 s) ; `Le service de connexion LinkedIn n'a pas renvoyé d'identifiant. Réessayez.` ; `Cookie li_at invalide ou expiré. Récupérez un nouveau cookie depuis votre navigateur.` ; `Ce compte LinkedIn est déjà associé à un autre utilisateur de votre organisation.` ; `Compte dissocié. Vous pouvez maintenant reconnecter.` ; success `Compte LinkedIn connecté avec succès !` + desc *« Vous pouvez maintenant lancer votre première recherche dans une mission. »* (6 s) ; info `Une fenêtre LinkedIn s'est ouverte. La connexion sera détectée automatiquement.` (5 s) ; message `Connexion LinkedIn non détectée` + desc *« Si vous avez bien connecté votre compte, cliquez sur "Rafraîchir les comptes". »*

**LinkedInQuotaCard** (`Gauge`, CardTitle `text-lg`) — **« Plafonds du jour »** + Badge `secondary ml-auto` = `rampStageLabel(ramp_stage)`.
- Loading : *« Chargement des plafonds… »*. Si pas de status → `null` (rien).
- Encart déconnecté (`CREDENTIALS`/`ERROR`) : *« Compte déconnecté, reconnectez-le. »* + *« Les séquences qui utilisent ce compte sont en pause et reprendront automatiquement après reconnexion. »*
- Encart pause : *« Pause en cours jusqu'à [demain] HH:MM. »* + *« Une limite a été approchée ou signalée par LinkedIn : les actions reprendront d'elles-mêmes. »*
- 5 `QuotaRow` (`Progress h-1.5`, `used / cap` tabular-nums ; ≥80 % `text-warning`+`[&>div]:bg-warning`, ≥95 % destructive, sinon `[&>div]:bg-linkedin`) : **Actions visibles**, **Visites de profils**, **Recherches**, **InMails**, **Invitations sur 7 jours**.
- Pied : *« Heures ouvrées : HH:00 à HH:00 (TZ), du lundi au vendredi. Compteurs du jour remis à zéro à HH:MM. »*

**LinkedInSafetySettings** (rendu en enfant de MyLinkedInAccount, pas dans Settings.tsx) — CardTitle `text-lg` + `Shield text-primary` — **« Plages & limites de sécurité »**.
- Encart succès `bg-success/5 border-success/30` : **« Comment Konekt protège votre compte LinkedIn »** + 7 puces `CheckCircle2` (valeurs **en dur** : 80 actions/j, 100 invitations/7 j, 5-15 s entre actions, pause 16 h à 90 %, ramp 25/50/75 % sur 3 semaines, anti-doublon 90 j).
- Encart info `bg-info/5 border-info/30` avec gras *« Indispensable si le même compte LinkedIn est aussi utilisé par un autre outil »*.
- Champs : **Début (heure locale)** / **Fin (heure locale)** — Selects 00:00→23:00 et 01:00→24:00, `SelectContent max-h-[70vh]`. Erreur *« L'heure de fin doit être après l'heure de début. »*
- **Fuseau horaire** — Select 6 options exactes : `Europe/Paris`, `Europe/London`, `Europe/Brussels`, `Europe/Zurich`, `America/New_York`, `America/Los_Angeles` (valeurs techniques affichées telles quelles).
- **Cap d'actions visibles / jour** — `Input type=number min=0 max=500`, **disabled si `!isAdmin`** + icône `Lock` dans le label. Aide admin : *« Total cumulé messages + invitations + InMails par jour. Recommandé : 60-80 si le compte est partagé avec un autre outil, 100 max si Konekt est seul. »* Aide non-admin : *« Les plafonds sont définis par les propriétaires et administrateurs de l'organisation. Vous pouvez ajuster vos horaires et votre fuseau horaire. »* Erreur : *« Valeur entre 0 et 500. »*
- Boutons : **« Enregistrer »** (`sm gap-1.5`, `Save`, disabled si `!dirty||!hoursValid||!capValid||isSaving||!userId`) / **« Valeurs par défaut »** (`outline sm`, `RotateCcw`). Toasts hook : `Quotas mis à jour` / `Erreur lors de la mise à jour des quotas`.

### 2.2 ExtensionTokens
CardTitle `text-lg` + `Puzzle text-info` — **« Extension Chrome Konekt »**.
- Intro + `<ul list-disc>` 4 puces (reconnecter LinkedIn 1 clic, badges overlay, ajout au pipeline, notes rapides).
- Token créé : encart `border-2 border-success bg-success/5`, **« Token créé ! »**, *« ⚠️ Copiez ce token **maintenant** — il ne sera **plus jamais ré-affiché** pour des raisons de sécurité. »*, `<code select-all>`, bouton **Copier**/**Copié**, note `KeyRound` (*« …puis cliquez sur "OK je l'ai copié" ci-dessous. »*), bouton full-width **« OK, je l'ai copié »**.
- Vide : `border-dashed`, `Aucun token actif` + `Créez un token pour activer l'extension Chrome`.
- Liste : compteur `N token(s) actif(s)`, ligne = label, `token_prefix` mono, `Utilisé il y a X` ou `Jamais utilisé` · `créé il y a X`. Bouton corbeille `ghost icon h-7 w-7` aria-label `Révoquer le token {label}` → AlertDialog **« Révoquer ce token ? »** / desc *« L'extension utilisant ce token cessera immédiatement de fonctionner et devra être reconfigurée avec un nouveau token. Cette action est irréversible. »* / **Annuler** / **Révoquer** (destructive).
- Dialog création : titre **« Créer un nouveau token extension »**, desc *« Ce token autorisera votre extension Chrome à se connecter à votre compte Konekt. Il sera affiché une seule fois — copiez-le immédiatement. »* ; champ **Étiquette (optionnel)** placeholder `ex: Mon Chrome au bureau` maxLength 100, aide *« Pour identifier ce token dans la liste (utile si vous installez l'extension sur plusieurs ordinateurs). »* ; encart warning *« Le token est équivalent à un mot de passe — ne le partagez pas et ne le commitez pas dans git. »* ; footer **Annuler** / **« Créer le token »**.
- Dialog **« Comment installer l'extension »** (`max-w-2xl`) : 3 étapes. ⚠️ **`<pre>` contient un chemin machine en dur : `cd C:\Users\Hugo\dev\remix-of-event-template\extensions\chrome`**. Mentions `chrome://extensions/`, « Mode développeur », « Charger l'extension non empaquetée », `kekt_...`, encarts info/warning « Chrome Web Store publication à venir ». **Tutoiement** (« Ouvre Chrome », « ignore-le ») vs vouvoiement partout ailleurs.
- Toasts : `Token révoqué`, `Token copié dans le presse-papiers`, `Impossible de copier — sélectionnez manuellement le token`, `Erreur de chargement`, `Erreur de création`, `Erreur lors de la révocation`.

### 2.3 MyEmailAccount
CardTitle `text-lg` + `Mail` — **« Mon compte email »**.
- Lié : ligne `p-3 bg-muted/50 rounded-lg`, pastille `bg-primary`/`bg-destructive`, `Actif` ou statut brut + `(provider)`. Boutons `RefreshCw` (ghost icon) et **« Dissocier »** (`ghost sm text-destructive`, `Unlink`) — **sans AlertDialog**.
- Lié mais compte absent : `Compte lié : {email|id}` + Rafraîchir + Dissocier.
- Non lié : *« Connectez votre compte email pour envoyer des emails d'outreach directement depuis vos séquences. »*
  - Comptes dispo : `Compte(s) disponible(s) :`, badges `Actif` (secondary) et `{type}` (outline), bouton **« C'est mon compte »**.
  - Boutons **« Gmail »** / **« Outlook »** (`ExternalLink`), + **« Rafraîchir les comptes »** (outline full). **Aucun bouton IMAP** alors que `handleConnect` accepte `'IMAP'` — code mort.
- Toasts : `Nouveau compte email détecté ! Sélectionnez-le ci-dessous.`, info `Une fenêtre de connexion {Gmail|Outlook|IMAP} s'est ouverte. Le compte sera détecté automatiquement.`, hook : `Compte email associé` / `Ce compte email est déjà associé à un autre membre` / `Erreur lors de l'association` / `Association email retirée` / `Erreur lors de la suppression`.

### 2.4 EmailSignatures
CardTitle `text-sm font-bold uppercase tracking-wider` (**style ≠ voisins**) + `Mail` — **« Signatures email »** + bouton **« Nouvelle »** (`sm gap-1`, `Plus`) dans le titre.
- Vide : *« Aucune signature. Créez-en une pour l'utiliser dans vos séquences email. »*
- Ligne : nom + Badge `Par défaut` (`Star`, secondary `text-[10px] h-4`), extrait `content.replace(/<[^>]*>/g,'').slice(0,120)`. Actions `opacity-0 group-hover:opacity-100` : crayon, corbeille destructive.
- AlertDialog **« Supprimer cette signature ? »** / *« Cette action est irréversible. »* / **Annuler** / **Supprimer**.
- Dialog (`max-w-lg`) : titre `Nouvelle signature`/`Modifier la signature` ; **Nom \*** placeholder `Ex: Signature principale` ; **Contenu HTML \*** Textarea rows 5 `font-mono text-xs` placeholder `<p>Cordialement,<br/>Jean Martin</p>` ; **Aperçu** (`dangerouslySetInnerHTML` — XSS auto-infligé) ; Switch + Label **« Signature par défaut »** ; boutons **Annuler** (outline) / **Sauvegarder** (loading `Enregistrement...`). ⚠️ Footer **manuel** (`flex justify-end gap-2`) au lieu de `DialogFooter`.
- Toasts : `Signature créée` / `Signature mise à jour` / `Signature supprimée` / `Erreur lors de la création|mise à jour|suppression`.

### 2.5 MyWhatsAppAccount
CardTitle `text-lg` + logo SVG — **« Mon compte WhatsApp »**.
- Connecté : pastille `bg-primary`/`bg-destructive`, cercle 40px avec `style={{background:'hsl(var(--brand-whatsapp))'}}` (**style inline**), bouton `RefreshCw` seul — **aucun moyen de déconnecter**.
- Non connecté : *« Connectez WhatsApp pour envoyer des messages dans vos séquences multicanales. La connexion se fait via QR code, comme WhatsApp Web. »* ; **« Connecter WhatsApp »** (full `sm`) ; **« Rafraîchir »** (outline full).
- Toast info : `Scannez le QR code dans la fenêtre qui s'est ouverte pour connecter WhatsApp.` / erreur `Erreur lors de la connexion`.
- Imports morts : `Badge`, `Unlink`.

---

## 3. Onglet ÉQUIPE (`team`)

`<div className="space-y-6">` : `TeamManagement` + (si `isAdmin && !isCollaborator`) Card **« Invitations »** (`UserPlus`).

### TeamManagement (617 l.)
Card, titre `Users` + **« Équipe »** + Badge `secondary ml-auto` `{n} membre(s)`. `CardContent className="p-0"` + `divide-y divide-border`.
Loading : `BrutalLoader compact` py-8.

**Ligne membre repliée** (`px-4 py-3`, expanded → `bg-muted`) :
- Avatar carré `w-8 h-8 bg-foreground text-background rounded` = 1ʳᵉ lettre.
- Nom (`profiles.display_name` sinon `user_id.slice(0,8)+'...'`).
- Badge rôle `outline text-xs px-1.5 py-0` + icône : `owner`→**Propriétaire** `Crown` ; `admin`→**Admin** `Shield` ; `member`→**Membre** `User` ; `collaborator`→**Collaborateur** `UserCog`.
- Badge supplémentaire collaborator : **« Externe »** `border-info text-info uppercase`.
- Sous-ligne : compte LinkedIn (logo + nom, ou `Connecté`) ou italique `Pas de LinkedIn` ; Badge `{n} séq` (`Activity`) ; Badge `{n} cand/30j` (`Briefcase`).
- Actions (si `isOwner && role !== 'owner'`) : **Select rôle** `w-28 h-8 text-xs` → options **Admin / Membre / Collaborateur** (⚠️ **pas d'option `owner`**, et libellé « Collaborateur » ≠ « Collaborateur externe » du formulaire d'invitation) ; bouton corbeille `ghost icon h-8 w-8 hover:text-destructive` aria-label `Supprimer {nom}`.
- Chevron `ChevronDown` rotatif, aria-label `Réduire`/`Détails`.

**Panneau déplié (admin)** `bg-muted/30` :
- 2 mini-Cards `grid-cols-2` : **Séquences actives** / **Candidats (30j)** — `text-2xl font-bold tabular-nums`.
- `SectionRow` **« Compte LinkedIn »** : lié → carte `p-2.5 bg-background border rounded`, nom + `ID: {12 premiers}…`, bouton **« Dissocier »** (`ghost sm h-7 text-destructive`, `Unlink`). Non lié → Select placeholder **« Associer un compte LinkedIn… »** (pastille verte si `status==='OK'`) + bouton **« Lier »** (`outline sm h-8`, `Link2`).
- `SectionRow` **« Missions assignées »** : badges `default` avec ✕ (aria-label `Retirer`). Vide global : *« Aucune mission créée. Créez d'abord une mission depuis l'onglet Missions pour pouvoir y assigner ce membre. »* Sinon Select placeholder **« Sélectionner une mission… »** + bouton **« Assigner »** (`Plus`).
- `SectionRow` **« Quota journalier »** + bouton **« Modifier »** (ghost sm h-7). Un seul champ : **« Actions visibles / jour »** (`Gauge`, max 200), barre `h-1 bg-border` (fill `bg-accent` si ≥80 %, sinon `bg-foreground/40`), hint `text-[10px]` *« InMails + messages + invitations envoyés depuis le compte LinkedIn de ce membre »*. Édition : `Input type=number h-6 w-16 text-right`. Boutons **« Sauvegarder »** (`Save`) / **« Annuler »** (ghost).
  ⚠️ **max 200 ici vs max 500 dans LinkedInSafetySettings** pour le même champ `max_actions_per_day`.
- Non-admin déplié : *« Les détails de gestion (LinkedIn, missions, quota) sont visibles uniquement par les administrateurs. »*

**AlertDialogs** :
- **« Supprimer ce membre ? »** — *« **{nom}** sera retiré de l'équipe. Cette personne perd l'accès à tous les missions, candidats et données de l'agence. Cette action est irréversible (vous pouvez réinviter ensuite). »* (⚠️ *« tous les missions »* — faute d'accord ; *« l'agence »* alors que l'espace peut être une entreprise). **Annuler** / **Supprimer** (`bg-destructive hover:bg-destructive/90`).
- **« Dissocier ce compte LinkedIn ? »** — *« Le compte **{nom}** ne sera plus rattaché à ce membre. Le compte LinkedIn lui-même n'est pas affecté côté LinkedIn. »* **Annuler** / **Dissocier**.

Toasts (hooks) : `Rôle mis à jour`, `Impossible de mettre à jour le rôle`, `Membre retiré`, `Impossible de retirer ce membre`, `Recruteur assigné au poste`, `Ce recruteur est déjà assigné à ce poste`, `Erreur lors de l'assignation`, `Assignation retirée`, `Compte LinkedIn associé`, `Ce compte LinkedIn appartient à une autre organisation`, `Ce compte LinkedIn est déjà associé à un autre membre`, `Association LinkedIn retirée`, `Quotas mis à jour`.

### Card « Invitations » (Settings.tsx:420-440)
`PendingInvitations` puis `InviteMemberForm`.

**PendingInvitations** — sous-titre `Invitations` (`Clock w-3.5`) — **doublon du titre de Card**. `pt-4 border-t`.
- Vide : `rounded-md border bg-muted/30 px-3 py-3` *« Aucune invitation envoyée pour le moment. »*
- Ligne : avatar rond `Mail`, email, `{Rôle} · envoyée il y a X`. Rôles : `Admin`/`Membre`/`Collaborateur`.
- Badges de statut (**classes en dur, pas de variant Badge**) : `Acceptée` `border-primary/30 bg-primary/10 text-primary` ; `Annulée` `border-border bg-muted/60 text-muted-foreground` ; `Expirée` (idem) ; `En attente` `border-accent/40 bg-accent/10 text-foreground`.
- Actions : **« Renvoyer »** (`ghost sm h-7`, `RotateCw` animé) ; copier lien (`ghost icon h-7 w-7`, title/aria `Copier le lien d'invitation`, `Check` 2 s après copie) ; ✕ aria-label `Annuler l'invitation` — **sans confirmation**.
- Tri par priorité : pending(0) → expired(1) → accepted(2) → cancelled(3).
- Toast : `Lien d'invitation copié !` ; hooks : `Invitation envoyée par email`, `Invitation renvoyée par email`, `Invitation annulée`.

**InviteMemberForm** (`pt-4 border-t border-border`) :
- **Email** — label `text-xs text-muted-foreground`, `type=email`, placeholder `collegue@entreprise.com`, `h-9 text-sm`, required.
- **Rôle** — Select `w-28 h-9 text-xs`, défaut `member` : **Admin / Membre / Collaborateur externe**.
- Bouton **« Inviter »** (`sm h-9 gap-1.5`, `UserPlus`/`Loader2`), disabled si `isLoading || isQuotaLoading || seatsExhausted || !email.trim()`.
- Sièges épuisés : `<p className="text-xs text-muted-foreground">` — plan gratuit : *« Choisissez un plan pour inviter votre équipe. »* + lien **« Voir les plans »** → `/pricing` ; sinon `SEAT_LIMIT_MESSAGE` = **« Tous vos sièges sont utilisés. Ajoutez un siège dans Abonnement. »** + lien **« Ajouter un siège »** → `/settings?tab=billing`.
- Toasts : `Vérification des limites en cours...` (info), `Tous vos sièges sont utilisés. Ajoutez un siège dans Abonnement.` (error).
- Comptage sièges : `seatsRemaining - pendingInvitations` (`useQuotaGate`).

---

## 4. Onglet CONNECTEURS (`connectors`)

`ConnectorSettings.tsx` — 2 Cards. Loading = `Loader2 w-5` centré py-12 (**pas `BrutalLoader`** — incohérent).

**Card 1** : `CheckCircle2 text-success` + **« Connecteurs actifs »** + Badge `secondary ml-auto` = count.
- Vide : *« Aucun connecteur activé. »*
- Ligne : tuile `w-8 h-8 rounded bg-success/10` + `Power text-success` ; nom ; Badge outline **`ACTIF`** `border-success text-success` ; `Sync : 12 mars 2026 14:30` ; erreur éventuelle `text-destructive` + `AlertCircle` + `error_message` brut. Bouton **« Désactiver »** (`ghost sm h-8 text-xs text-destructive`, `PowerOff`) — **sans confirmation**.

**Card 2** : **« Connecteurs disponibles »** (pas d'icône). Groupé par catégorie, `<h3>` `text-xs font-bold uppercase tracking-wider border-b pb-1.5`.
- `CATEGORY_LABELS` : `ats`→ATS, `sourcing`→SOURCING, `communication`→MESSAGERIE, `telephony`→TÉLÉPHONIE, `scheduling`→CALENDRIER, `crm`→CRM, `sirh`→SIRH, `evaluation`→ÉVALUATION, `enrichment`→ENRICHISSEMENT, `custom`→CUSTOM, `other`→AUTRE. Ordre : ats, crm, sourcing, communication, telephony, scheduling, evaluation, sirh, enrichment, custom, other.
- Ligne : nom + description tronquée `max-w-[280px]` ; bouton **« Activer »** (`outline sm h-8`, `Power`).
- Tout activé : *« Tous les connecteurs sont déjà activés. »*
- ⚠️ `icon_url` et `config_schema` du registre **jamais utilisés**.
- Toasts : `Connecteur activé` / `Connecteur désactivé` / `Erreur lors de l'activation` / `Erreur lors de la désactivation`.

---

## 5. Onglet INTÉGRATIONS (`integrations`, admin)

`IntegrationsSettings.tsx` — `<div className="space-y-3">` (**pas `space-y-6`**), pas de titre d'onglet. Loading `BrutalLoader compact` py-8.

Catalogue `INTEGRATIONS` :
| id | name | description | connectedKey | champs |
|---|---|---|---|---|
| `notion` | **Notion** | *Synchronisation des postes, candidats et shortlists avec vos bases Notion.* | `notion_connected` | **Clé API Notion** `ntn_...` (secret) ; **ID base Postes** / **ID base Candidats** / **ID base Shortlist** `xxxxxxxx-xxxx-...` |
| `calendly` | **Calendly** | *Synchronisation automatique des rendez-vous de qualification.* | `calendly_connected` | **Clé API Calendly** `eyJ...` (secret) |
| `unipile` | **Comptes LinkedIn de l'agence** | *Gérez tous les comptes LinkedIn connectés par les membres : statut, proxys par compte, dissociation admin. Pour connecter votre propre compte, allez dans Mon compte.* | `unipile_connected` | hostedAuth |
| `aircall` | **Aircall** | *Suivi des appels et correspondance automatique avec les candidats.* | `aircall_connected` | **API ID Aircall** `xxx...` ; **API Token Aircall** `xxx...` (secret) |

**Anatomie carte** : `<Card>` avec `<button className="w-full text-left">` englobant `CardHeader py-3` (⚠️ **bouton non typé, pas de `type="button"`, pas de `aria-expanded`**) : logo `w-12 h-12` conteneur / `w-10 h-10 object-contain`, `CardTitle text-sm font-semibold` (≠ style uppercase du reste), `CardDescription text-xs`, Badge d'état + chevron `ChevronUp/Down`.
- États badge : **Connecté** (`default` + `bg-success text-success-foreground`) / **Non configuré** (`secondary`).
- LinkedIn : **Vérification…** (`secondary` + spinner) / **`{n} compte(s) connecté(s)`** (`bg-success`) / **Non connecté** (`secondary`).

**Corps carte générique** : champ par field, label `text-xs font-medium`, `Input` `pr-10 text-sm border-border`, `type=password` si secret, placeholder remplacé si hint existant : ``Clé enregistrée ({hint}), saisir pour remplacer``. Lien texte **« Retirer la clé »** → `confirmAlert()` (AlertDialog impératif) : titre **« Retirer cette clé ? »**, desc *« L'intégration sera déconnectée jusqu'à la saisie d'une nouvelle clé. »*, confirm **« Retirer »**, cancel **« Annuler »**, destructive. Bouton **« Enregistrer »** (`w-full mt-2 sm`, `Check`/`Loader2`), disabled `!hasChanges || isSaving`.

**Corps carte LinkedIn** : liste comptes `p-3 bg-muted/50 rounded-lg` (avatar, nom, pastille `bg-success`/`bg-warning`, `Actif` ou statut brut) ; bouton corbeille → AlertDialog **« Déconnecter ce compte LinkedIn ? »** / *« Le compte **{nom}** sera supprimé de la plateforme. Vous pourrez le reconnecter ultérieurement. »* / **Annuler** / **Déconnecter** (destructive). `ProxyConfigPanel` par compte OK. Boutons **« Connecter un compte LinkedIn »** (flex-1 `sm`) + refresh `outline` icône seule (**pas d'aria-label**). `WebhookManager` si ≥1 compte. Vide : *« Aucun compte LinkedIn connecté. »* Loading : *« Chargement des comptes... »*

**Bouton d'ajout** : `outline sm w-full border-dashed border-2` — libellé littéral **« + Ajouter une intégration »** (le `+` est du texte, pas une icône). Menu absolu `bg-background border rounded-lg shadow-lg z-10` listant les intégrations masquées.
Toasts : `Intégration mise à jour`, `Erreur: {message}`, `Une fenêtre de connexion LinkedIn s'est ouverte. Revenez ici une fois la connexion effectuée.`, `Compte LinkedIn déconnecté`, `Erreur lors de la déconnexion`, `Erreur lors de la connexion`.

---

## 6. Onglet ABONNEMENT (`billing`, admin) — `BillingSettings.tsx`

Loading : `BrutalLoader compact` centré `py-12`. Racine `space-y-6`.

### Card 1 — `CreditCard` **« Abonnement »**
- Ligne principale : `plan_name` (`text-lg font-semibold`) ou `Gratuit`, + Badge de statut (`statusBadge()` L36) :
  - `trialing` → **`Essai : {n} jour restant|jours restants`** — variant `info`
  - `canceled` → **`Résilié`** — `muted`
  - `past_due|incomplete|unpaid` → **`Paiement en attente`** — `warning`
  - `cancel_at_period_end` → **`Résiliation programmée le JJ/MM/AAAA`** — `warning`
  - free → **`Gratuit`** — `secondary` ; sinon **`Actif`** — `success`
- Sous-texte contextuel :
  - essai payé : *« Essai en cours, déjà couvert par votre abonnement. La facturation démarre à la fin de l'essai. »*
  - essai : *« Essai gratuit, sans carte bancaire. Choisissez un plan pour continuer après l'essai. »*
  - gratuit : *« Vos données restent accessibles, sans envoi de séquences. »*
  - payant : *« Facturé par siège et par mois. »*
- Boutons : **« Changer de plan »** / **« Choisir un plan »** (`outline sm gap-1.5`, `ArrowUpRight`) → portail Stripe si `has_stripe_subscription`, sinon `navigate('/pricing')`. Puis (si abonnement) **« Gérer l'abonnement »** (`default sm`, `ExternalLink`/`Loader2`).
- Bloc `border-t` : `Users` + `{n} siège(s) facturé(s), {n} membre(s)` ou `{n} membre(s), {n} siège(s) inclus` ; `Calendar` + `Fin de l'essai le JJ/MM/AAAA` ; `Calendar` + `Prochaine échéance le` / `Accès jusqu'au` + date.
- Sur-quota sièges : `bg-destructive/10 text-destructive p-3 rounded-md` + `AlertTriangle` — *« Votre espace compte plus de membres que de sièges facturés. Ajoutez un siège depuis « Gérer l'abonnement ». »*
- Note : *« Moyen de paiement, factures et annulation se gèrent depuis « Gérer l'abonnement ». »*

### Card 2 — `Sparkles` **« Limites du plan »** (masquée si aucune valeur)
`grid grid-cols-2 gap-4`, tuiles `p-3 bg-muted/50 rounded-lg` : **Missions actives**, **Crédits IA / mois**, **Contacts enrichis / mois**. `-1` → `Illimité`, sinon `toLocaleString('fr-FR')`.
⚠️ **Aucune barre de progression ni consommation réelle ici** — que des plafonds statiques ; `grid-cols-2` non responsive (pas de `sm:`).

### Card 3 — `Download` **« Export des données (RGPD) »**
Aide : *« Téléchargez toutes les données de votre organisation au format JSON : candidats, missions, transactions IA, membres. »* Bouton **« Télécharger mes données »** / loading **« Export en cours... »** (`outline gap-2`, `Download`/`Loader2`). Fichier `konekt-export-YYYY-MM-DD.json`.

**Toasts billing** : `Abonnement activé` (retour `?checkout=success`) ; info `Paiement annulé, votre plan reste inchangé.` (`?checkout=cancel`) ; `Impossible d'ouvrir la gestion de l'abonnement. Réessayez.` ; `Export téléchargé` ; `Erreur lors de l'export des données`.
Rafraîchissement post-checkout : invalidation de `subscription-state`, `org-subscription`, `subscription-plan`, `ai-credits`, `ai-credit-history` + relance à **5 000 ms**.

### TrialBanner (`src/components/billing/TrialBanner.tsx`, hors Settings — sous l'en-tête app)
`role="status"`, `border-b bg-warning/10 px-4 py-2 text-xs`. Seuil J-7 (`TRIAL_WARNING_DAYS = 7`).
- `Essai : {n} jour(s) restant(s).` ou `Votre essai se termine aujourd'hui.`
- Fin d'essai : *« Essai terminé : votre espace est sur le plan gratuit. Vos données restent accessibles, sans envoi de séquences ni enrichissement de contact. »*
- Admin → lien **« Choisir un plan »** (`/pricing`) ; sinon *« Demandez à un administrateur de choisir un plan. »*
- Masqué si `isTrialPaid`.

---

## 7. Onglet CRÉDITS IA (`credits`) — `AICreditsSettings.tsx`

Loading `BrutalLoader compact` py-12. Racine `space-y-6`. **Visible par tous** (pas de gate).

### Card 1 — `Sparkles` **« Crédits IA »**
- Solde illisible : *« Solde indisponible pour le moment. Réessayez dans quelques instants. »* + bouton **« Réessayer »** (`outline sm`).
- Solde : `text-3xl font-bold` — `text-destructive` si épuisé, `text-warning` si bas, sinon `text-foreground` + `crédits restants`. Bouton **« Changer de plan »** (`outline sm`, `ArrowUpRight`) affiché seulement si `isLow || isOut` → `/pricing`.
- `<Progress className="h-2">` uniquement si `usagePercent !== null`.
- Répartition : `Coins` **Plan : {n}** ; `Sparkles` **Recharges : {n}** (si >0).
- Ligne : `{n}% utilisé ce mois` (gauche) ; `Clock` + `Crédits plan réinitialisés le 12 mars` (droite).
- Épuisé : `bg-destructive/10 text-destructive p-3 rounded-md` — *« Plus de crédits disponibles. Achetez un pack de crédits ou passez à un plan supérieur. »*

### Card 2 — `Brain` **« Modèle IA par défaut »**
Aide : *« Ce modèle sera utilisé pour toutes les actions IA (sauf classification et tri qui restent sur modèles rapides). Chaque utilisateur peut changer ponctuellement sur chaque action. »*
Select full-width, options : **Automatique** (`✨`, value `__auto__`) puis catalogue `MODEL_CATALOG` avec `ModelLogo` + badge `×{multiplier}` :
- **Rapide** ×0.35 (`claude-haiku-4-5`)
- **Standard** ×1 (`claude-sonnet-4-5`)
- **Avancé** ×1 (`claude-sonnet-4-6`)
- **Expert** ×1.8 (`claude-opus-4-6`)
Toast : `Modèle auto-routé activé` ou `Modèle par défaut : {name}`.
⚠️ **`ProviderLabel` importé et jamais utilisé** ; les noms sont neutralisés mais `ModelLogo` affiche vraisemblablement le logo du fournisseur.

### Card 3 — `ShoppingCart` **« Recharger des crédits »** (admin)
Aide : *« Les crédits rechargés n'expirent jamais et sont utilisés après les crédits du plan. »*
`grid grid-cols-1 sm:grid-cols-3 gap-3`, chaque pack = `<button>` `p-4 border-2 rounded-md`, badge absolu `bg-foreground text-background text-xs uppercase` :
- `pack_400` — **400** crédits, **12 €**, `3.0c€/crédit`, pas de badge
- `pack_1500` — **1 500** crédits, **39 €**, `2.6c€/crédit`, badge **« Populaire »**
- `pack_5000` — **5 000** crédits, **119 €**, `2.38c€/crédit`, badge **« -20% »**
⚠️ `pack.badge ? "border-border" : "border-border"` — **ternaire inutile, les deux branches identiques**.
Non-admin : Card nue `py-4 text-xs` — *« Pour recharger des crédits, demandez à un administrateur de votre espace. »*
Toasts : `Paiement réussi. Vos crédits arrivent.` ; info `Achat annulé.` ; `Erreur lors de la création du paiement. Réessayez.` ; `Impossible d'ouvrir le paiement. Réessayez.` Refresh différé **5 000 ms**.

### Card 4 — `BaseKonektCard` (`Database` **« Base Konekt »**)
Sous-titre : *« Une base de profils professionnels consultable sans compte LinkedIn, en plus de la recherche LinkedIn. »*
- États : **Suspendue** (activée mais plan insuffisant) / **Activée** / **Non activée**, avec descriptions respectives :
  - *« Votre formule ne donne plus accès à la Base Konekt : les recherches en base sont refusées. »*
  - *« Tous les membres de votre espace peuvent choisir cette source dans le panneau de recherche. »*
  - *« Vos recherches passent uniquement par LinkedIn. »*
- `<Switch aria-label="Activer la Base Konekt">` visible si `canActivate || (canManage && isEnabled)`.
- `Progress h-2` + `{used} / {total} recherches incluses ce mois` (+ ` (essai)`) + `Clock` `Remise à zéro le JJ/MM` (formatage UTC manuel).
- Sans quota inclus : *« Votre formule ne comprend pas de recherche incluse : chaque page est facturée en crédits. »*
- Tarif : *« Page de 20 profils : {n} crédits une fois vos recherches incluses épuisées. Fiche complète : {n} crédits, qu'il reste ou non des recherches incluses. »* (défauts 2 et 2).
- Non-gestionnaire : *« Pour activer ou désactiver la Base Konekt, demandez à un administrateur de votre organisation. »*
- Plan insuffisant : *« La Base Konekt est disponible à partir de la formule Solo. Votre espace est sur la formule gratuite. »* + bouton **« Voir les plans »** (`outline sm`, `ArrowUpRight`) → `/pricing`. (**Encart maison, pas `UpgradePrompt`**.)
- AlertDialog **« Désactiver la Base Konekt ? »** — *« Les membres de votre espace ne pourront plus lancer de recherche en base. Vous pourrez la réactiver quand vous voulez. »* / **Annuler** / **Désactiver** (destructive).
- Loading : Card `py-4 text-xs` *« Chargement de la Base Konekt. »* ; Erreur : *« Impossible de charger la Base Konekt. »*
- Toasts : `Base Konekt activée` / `Base Konekt désactivée`.

### Card 5 — `TrendingDown` **« Coût par action »**
Aide : *« Estimation basée sur les tokens typiques. Coût réel calculé après chaque appel. »*
`grid grid-cols-1 sm:grid-cols-2 gap-2`, ligne `p-2 bg-muted/50 rounded-md` : label + Badge `secondary` `~{n} cr` + fourchette `{min}–{max}`.
⚠️ Les ids de modèles **`claude-haiku-4-5` / `claude-sonnet-4-6` / `claude-opus-4-6` sont codés en dur** dans le composant.
Labels d'actions (extraits `ACTION_COSTS`) : Scoring candidat, Message d'approche, Analyse réponse, Screening rapide, Scorecard, Compte-rendu d'appel, Coaching live (par minute), **Agent — calibration**, **Copilot — titre de conversation / routage d'intention / résumé de conversation / mémorisation / chat (par message)**, Agent — recherche, Assistant texte inline, Recherche sémantique — re-ranking, Lecture de fichier joint, Filtres IA auto, Chat filtres, Affiner recherche, Analyse nurturing, Enrichissement profil, Suggestion de réponse, Reformuler un texte, Traduire un texte, Résumer une conversation…

### Card 6 — **« Historique récent »** (CardTitle **sans icône**)
Loading `BrutalLoader compact` ; erreur *« Historique indisponible pour le moment »* ; vide *« Aucune utilisation pour le moment »*. Liste `max-h-80 overflow-y-auto`, 30 max. `topup_purchase` → **« Achat de crédits »** (`CheckCircle2 text-success`) `+{n} cr` en `text-success`, sinon `-{n} cr` en `text-destructive` + date `dd/MM HH:mm`.

### EnrichmentAnalytics (fin d'onglet)
⚠️ **`<Card className="p-6 space-y-6">` nue — pas de `CardHeader/CardTitle`**, titre en `<h3 className="text-base font-bold">` **« Enrichissement de contact »** + `30 derniers jours`.
- Bandeau forfait : `Package` **« Contacts inclus ce mois »**, `{used} / {total}` + `(reset le JJ/MM)` ; barre **maison** `bg-muted rounded-full h-1.5` (fill `bg-destructive` si ≥100 %, sinon `bg-foreground`) — **pas le composant `Progress`**. Sans forfait : *« Aucun contact inclus dans votre forfait actuel : les enrichissements de contact sont facturés en crédits. »*
- Vide : *« Aucun enrichissement de contact terminé dans les 30 derniers jours. Lancez votre premier enrichissement depuis le sourcing pour voir vos statistiques ici. »*
- 4 KPI `grid grid-cols-2 md:grid-cols-4` : **Total**, **Emails trouvés** (+%), **Téléphones trouvés** (+%), **Crédits hors forfait**.
- **« Activité quotidienne »** : barres CSS 30 j `h-20`, `title="{date} : {n} enrichissement(s)"`, bornes `Il y a 30 jours` / `Aujourd'hui`.
- Table **« Derniers enrichissements »** : colonnes **Candidat · Date · Email · Téléphone · Facturation · Demandeur**. Cellules email/tel : `Trouvé` (`Check text-success`) / `Non trouvé` (`X`) / `…`. Facturation : `En cours` / `Erreur` / `Inclus` / `{n} crédit(s)`. Demandeur : nom ou `Membre`.
- Loading : `Card p-6` + *« Chargement des statistiques d'enrichissement de contact… »*
- ⚠️ Le commentaire d'en-tête mentionne **« cascade Better Contact »** (fournisseur) — commentaire seulement, pas visible utilisateur.

---

## 8. Onglet TEMPLATES (`templates`) — `MessageTemplatesSettings.tsx`

`space-y-6` : `TemplatesSection` + `CustomVariablesSettings`.

### Card **« Templates de messages »** (`FileText`) + bouton **« Nouveau template »** (`sm gap-1.5`, `Plus`) dans le header
Aide : *« Créez des réponses-types réutilisables. Insérez-les dans le composer en tapant `/` suivi du nom ou du raccourci. »*
- **État vide** : encart `border-dashed rounded-lg p-6 bg-muted/20` — `Sparkles` + **« Démarrer avec des templates suggérés »** + *« Ajoutez en un clic des templates classiques (intro, relance, Calendly, remerciement). Vous pourrez les modifier ensuite. »* Grille 2 colonnes de 6 suggestions :
  `👋 Intro générale /intro` (Intro) · `⏰ Relance J+3 /relance` (Relance) · `📅 Lien Calendly /calendly` (Calendly) · `🙏 Remerciement /merci` (Closing) · `💼 Présentation poste /poste` (Présentation) · `🗓 Demande disponibilité /dispo` (Coordination). ⚠️ **« Calendly » — nom de fournisseur visible dans une catégorie et un libellé de template.**
- Liste : ligne `p-3 rounded-lg border hover:border-foreground/20 group`, emoji `text-xl`, nom, `<kbd>` raccourci, chip catégorie, `Utilisé {n}×`, extrait 2 lignes. Actions `opacity-0 group-hover:opacity-100` : crayon (aria `Modifier`), corbeille destructive (aria `Supprimer`).
- Loading : `Loader2` + `Chargement...`
- AlertDialog **« Supprimer ce template ? »** — *« "{nom}" sera définitivement supprimé. Cette action est irréversible. »* / **Annuler** / **Supprimer**.

**Dialog formulaire** (`max-w-5xl max-h-[90vh] p-0 flex flex-col`) — titre `Nouveau template` / `Modifier le template`. Grille `[1fr_320px]` :
- Gauche : **Nom \*** (`Ex: Intro générale`) sur 3 colonnes ; **Raccourci** (`/intro`, `font-mono`) ; **Emoji** (`👋`, maxLength 4) ; **Catégorie** (`Intro, Relance...`) ; **Contenu \*** Textarea rows 12 `font-mono resize-y` placeholder `Bonjour {{prenom}}, ...`. Aide : *« 💡 Cliquez sur une variable à droite pour l'insérer · Astuce : utilisez `{{client | fallback:"votre boîte"}}` pour gérer les valeurs manquantes »*.
- Droite `PlaceholdersPanel` : header sticky **« Variables disponibles »**, `Input` placeholder `Rechercher (prenom, client, lien...)`, aide *« Cliquez pour insérer · Le placeholder sera remplacé automatiquement »*. Catégories : `👤 Contact`, `✨ Données enrichies`, `🎯 Mission`, `✍️ Vous (sender)`, `📅 Date & contexte`, `💬 Conversation`, puis **« Mes variables custom »** (`Variable`). Vide : *« Aucune variable trouvée pour "{search}" »*. Encart **« 💡 Filtres avancés »** : `{{prenom | upper}}` — MAJ ; `{{prenom | capitalize}}` — Prénom ; `{{client | fallback:"votre boîte"}}` ; `{{headline | truncate:50}}`.
- Footer : **Annuler** (ghost) / **Créer** ou **Enregistrer**.
- Validation : `Nom et contenu sont obligatoires` (toast). Normalisation : `/` ajouté au raccourci.
- Toasts : `Template créé` / `Template mis à jour` / `Template supprimé` / `Erreur création template` / `Erreur modification` / `Erreur suppression` (avec `description: err.message`).
- ⚠️ Import mort : `Settings as SettingsIcon`.

### Card **« Variables custom »** (`Variable`) + bouton **« Nouvelle variable »**
Aide avec `<code>{{lien_demo}}</code>`, `<code>{{prix_offre}}</code>`.
- Vide : `border-dashed rounded-lg p-4 bg-muted/20 text-center` — *« Aucune variable custom encore. Ajoutez-en pour personnaliser vos templates. »*
- Liste : conteneur `border rounded-lg divide-y`, `<code>{{key}}</code>` + valeur + description. Actions hover : crayon / corbeille.
- Dialog (`max-w-md`) : **Nom de la variable \*** placeholder `lien_demo`, `font-mono`, **disabled en édition**, normalisation `[^a-z0-9_] → _`, aide dynamique `Sera utilisée comme {{nom_variable}} dans vos templates` ; **Valeur \*** Textarea rows 3 placeholder `https://demo.konekt.fr/booking` ; **Description** placeholder `Lien de réservation démo (mettre à jour si change)`. Footer **Annuler** / **Créer**|**Enregistrer**.
- Validation toasts : `Nom et valeur sont obligatoires` ; `Le nom doit être en minuscules + chiffres/underscores (ex: lien_demo)`.
- AlertDialog **« Supprimer cette variable ? »** — *« `{{key}}` sera supprimée. Les templates qui l'utilisent afficheront le placeholder tel quel jusqu'à ce que vous le retiriez. »*
- Toasts : `Variable créée` / `Variable mise à jour` / `Variable supprimée` + erreurs.

---

## 9. Onglet CONTEXTE IA (`ai-context`) — `AiContextSettings.tsx`

`space-y-6` : `UserContextCard` + (admin) `OrgContextCard`.
- Card 1 : `User` **« Mon contexte IA »** — *« Décrivez à l'IA Konekt qui vous êtes, comment vous vous exprimez, vos do/don't. Ce contexte est injecté dans toutes les générations IA qui vous représentent (messages outreach, suggestions réponses, assistant IA…). »*
- Card 2 : `Building2` **« Contexte IA agence »** + encart `Info` `border bg-muted/20 p-3` — *« Ce contexte s'applique à **tous les membres** de l'agence (voix de marque, secteurs cibles, do/don't communs). Le contexte personnel de chaque user vient s'ajouter par-dessus. »*

**Formulaire partagé** (`space-y-5`) :
- **Ton** — Select `h-9`, placeholder `Auto (l'IA décide)`. Options : **Auto** / *L'IA décide selon le contexte* ; **Tutoiement** / *Direct, candidat-friendly (tech, scale-up)* ; **Vouvoiement** / *Plus formel (corporate, profils seniors)* ; **Décontracté** / *Familier, ton "pote" (DTC, startup early)* ; **Formel** / *Soutenu (banque, conseil, secteurs régulés)*.
- **Ma spécialité** / **Spécialité de l'agence** — Input maxLength **200**, placeholders `Ex: Tech recruiter senior, focus IC & lead Dev FR remote` / `Ex: Cabinet tech specialiste scale-ups SaaS FR/EU` (⚠️ *specialiste* sans accent). Compteur `{n}/200`.
- **À faire ({n}/10)** — hint *« Patterns à appliquer systématiquement dans les générations »*. Chips `bg-foreground/5 border-foreground/15` + ✕. Input placeholder `Ex: toujours mentionner la flexibilité remote`, maxLength 200, Enter = ajout, bouton **« Ajouter »** (`outline sm h-8`, `Plus`).
- **À éviter ({n}/10)** — hint *« Formulations ou pratiques à proscrire dans les générations »*. Chips `bg-destructive/5 border-destructive/20`. Placeholder `Ex: jamais 'belle opportunité' ou 'défi passionnant'`.
- **Nuances additionnelles (optionnel)** — Textarea rows 5, maxLength **1000**, compteur. Placeholders distincts user/org.
- Pied : état `Modifications non enregistrées` / `À jour` (`text-[10px] italic`) ; **Annuler** (ghost, seulement si dirty) ; **Enregistrer** / **« Enregistrement… »** (`sm gap-1.5`, `Sparkles`), disabled si `!isDirty || isSaving`.
- Toasts : `Contexte IA enregistré` / `Contexte IA agence enregistré` / `Erreur enregistrement`.
- ⚠️ Détection dirty par `JSON.stringify` ; re-export inutile `EMPTY_AI_CONTEXT` en fin de fichier.

---

## 10. Onglet ACTIONS IA (`agent-actions`) — `AgentActionsSettings.tsx`

⚠️ **Seul onglet avec un titre de section rendu dans le contenu** : `<h2 className="text-lg font-semibold">` `History` **« Actions IA »** + *« Toutes les actions proposées par le copilot et leur statut d'exécution. Source de vérité — mis à jour en temps réel. »* + bouton **« Rafraîchir »** (`outline sm`, `RefreshCw` animé).

### AgentPoliciesSettings (imbriqué)
`<Card><CardContent className="p-4">` — **pas de CardHeader**. `<h3 className="text-sm font-semibold">` `ShieldCheck` **« Politiques d'autonomie »** + *« Pour chaque action, choisissez si le copilot l'exécute directement (visible dans l'audit ci-dessous) ou attend votre approbation. Les envois externes et les actions destructives exigent toujours une approbation. »* (+ ` Réservé aux administrateurs.` si non-admin).
- Ligne **Digest matinal** (`Sunrise`, `rounded-lg border px-3 py-2.5`) + Switch : *« Chaque matin de semaine, le copilot résume vos missions actives, les entretiens des prochaines 24 h et les actions IA en attente d'approbation dans une conversation, et envoie ce digest par email au propriétaire de l'organisation (ou à un administrateur). »*
- Liste `divide-y rounded-lg border` — 26 actions. Select `w-[190px] h-8 text-xs`, valeur par défaut `approve`. Options : **Automatique** (`Zap`, seulement si `autoEligible`), **Avec approbation**, **Désactivée**. Non-admin → Badge outline lecture seule.
- Auto-éligibles : Modifier le stade candidat, Ajouter à la shortlist, Ajouter une note candidat, Assigner un candidat, Créer une mission, Modifier le brief mission, Régénérer les filtres LinkedIn, Appliquer les filtres de recherche, Enrôler dans une séquence, Créer une séquence, Mettre en pause une séquence, Reprendre une séquence, Rédiger un message d'approche, Enrichir un contact, Planifier un entretien, Déplacer plusieurs candidats, **Scorer une mission en tâche de fond** (*« Consomme des crédits (scoring en masse) — par défaut soumis à approbation »*).
- Verrouillées (`Lock`) : **Envoyer un message LinkedIn** / **Envoyer un email** (*« Envoi externe — approbation obligatoire »*) ; **Lancer la recherche autonome** (*« Consomme crédits + compte LinkedIn — approbation obligatoire »*) ; **Écarter un candidat** / **Écarter plusieurs candidats** (*« Destructif — approbation obligatoire »*) ; **Modifier le statut mission** (*« Archivage/clôture — approbation obligatoire »*) ; **Inviter un membre** / **Modifier les quotas d'un membre** (*« Équipe — approbation obligatoire »*).
- Toasts : `Politique enregistrée. Prise en compte sous ~1 minute.` / `Impossible d'enregistrer la politique : {msg}`.

### AgentConnectorsSettings (imbriqué)
`space-y-3` : `NotionConnectionCard` + `Collapsible` **« Options avancées pour développeurs »** (`SlidersHorizontal`, `border-border/70 bg-muted/20`, chevron rotatif).
- Card interne : `<h3>` `Plug` **« Connecteurs du copilot (MCP) »** + *« Branchez des serveurs MCP (Notion, Slack, calendrier, outils internes…) : leurs outils deviennent utilisables par le copilot dans le chat. »* ⚠️ **noms de fournisseurs (Notion, Slack) dans un texte visible**.
- Bouton **« Ajouter »** (`outline sm`, `Plus`, admin).
- Encart sécurité `border-warning/40 bg-warning/5` : *« Sécurité renforcée : seuls les outils en lecture seule inscrits dans la liste blanche sont exposés au copilot. Les écritures via MCP sont interdites ; utilisez les actions Konekt avec approbation pour modifier ou envoyer des données. »*
- Formulaire (labels **`sr-only`**, `h-8 text-xs`) : placeholder `Nom court (ex : notion)` ; `URL du serveur MCP (https://…)` ; `Token d'autorisation (optionnel — jamais réaffiché)` (password) ; `Outils autorisés en lecture seule (ex : search read_page)` + aide *« Noms exacts fournis par le serveur MCP, séparés par des espaces ou des virgules. 50 maximum. »* Boutons **Annuler** (ghost) / **« Ajouter le connecteur »**.
- Validations toasts : `Nom invalide : 2-40 caractères, minuscules/chiffres/tirets (ex : notion, slack-recrutement).` ; `L'URL du connecteur doit commencer par https://` ; `Ajoutez au moins un nom d'outil MCP en lecture seule à la liste blanche.` ; `Maximum 5 connecteurs par organisation.` ; `Un connecteur porte déjà ce nom.` ; `Ajout impossible : {msg}` ; `Connecteur « {slug} » ajouté. Actif dans le chat immédiatement.` ; `Définissez d'abord les outils en lecture seule autorisés.` ; `Liste blanche mise à jour. Vous pouvez activer le connecteur.` ; `Connecteur « {name} » supprimé.` ⚠️ Apostrophes typographiques `’` mélangées avec `'` dans les mêmes fichiers.
- Vide : *« Aucun connecteur configuré. »*
- Ligne connecteur : nom + Badge outline **`désactivé`** (minuscule, incohérent avec les autres badges), URL tronquée, `{n} outil(s) autorisé(s) en lecture`. Switch (aria `Activer|Désactiver le connecteur {name}`), crayon (title `Modifier la liste blanche`), corbeille.
- AlertDialog **« Supprimer le connecteur ? »** — *« Le copilot perdra immédiatement l'accès aux outils de « {name} ». Cette action est irréversible (le token devra être ressaisi pour le rebrancher). »* / **Annuler** / **Supprimer** (`className="bg-destructive"` seul, sans `text-destructive-foreground`).

### NotionConnectionCard
`<Card className="overflow-hidden"><CardContent className="p-0">` + `p-4 sm:p-5`. Tuile logo `h-11 w-11 rounded-xl border bg-white` (**`bg-white` en dur → invisible en dark**).
- `<h3 className="text-sm font-semibold">` **« Notion »** + Badge d'état :
  - **Vérification** (`secondary` + spinner) · **Statut indisponible** (`destructive`) · **Connecté** (`bg-success` + `CheckCircle2`) · **À reconnecter** (`destructive`) · **Non connecté** (`secondary`).
- Desc : *« Connecte ton compte Notion personnel pour que ton assistant puisse chercher et lire les contenus auxquels tu as accès. »* — **tutoiement**.
- Bouton (si `can_manage`) : **« Connecter »** (`ExternalLink`) / **« Reconnecter »** / **« Modifier l'accès »** (`outline`, `RefreshCw`).
- Erreur : `border-destructive/30 bg-destructive/5` — *« Impossible de vérifier la connexion Notion. »* + **« Réessayer »** (ghost sm).
- Connecté : encart `border-success/25 bg-success/5 rounded-xl` — *« Disponible immédiatement dans le chat IA · workspace @{domaine} »* + *« Cette connexion t'est personnelle : les autres membres ne peuvent pas utiliser tes accès Notion. Konekt autorise uniquement la recherche et la lecture, jamais la modification. »* + bouton **« Déconnecter »** (`ghost h-7 text-[11px]`, `Unplug`) → AlertDialog **« Déconnecter Notion ? »** / *« L'assistant perdra immédiatement l'accès aux contenus Notion. Tu pourras le reconnecter plus tard. »* / **Annuler** / **Déconnecter**.
- Sans permission : *« La connexion Notion n'est pas disponible pour ce compte. »*
- Toasts OAuth : `Notion est connecté à l'assistant IA.` / `Notion est déconnecté de l'assistant IA.` / `Impossible d'ouvrir Notion.` / `Déconnexion impossible.` / `La connexion Notion a échoué. Réessaie.` + mapping `notion_error` : `access_denied`→*« Connexion Notion annulée. Aucun accès n'a été ajouté. »* ; `state_expired`→*« Le lien de connexion a expiré. Clique sur Reconnecter pour recommencer. »* ; `state_missing`→*« Le retour de Notion est incomplet. Relance la connexion. »* ; `permission_changed`→*« Tu n'as plus les droits nécessaires pour connecter Notion. »* ; `exchange_failed`→*« Notion n'a pas pu finaliser la connexion. Réessaie dans un instant. »* ; `authorization_failed`→*« Notion a refusé la connexion. Réessaie ou choisis un autre workspace. »* ; `callback_failed`→*« La connexion n'a pas pu être finalisée. Réessaie dans un instant. »*

### Stats + filtres + liste (audit)
- 4 mini-Cards `grid grid-cols-2 sm:grid-cols-4` : **En attente** (`Clock`, `bg-warning/10 text-warning border-warning/40`), **Exécutée** (`CheckCircle2`, success), **Échec** (`XCircle`, destructive), **Rejetée** (`Ban`, muted). Couleur appliquée seulement si count > 0.
- Filtres : Select statut `w-40 h-9 text-xs` — **Tous les statuts / En attente / Exécutées / Échecs / Rejetées / Approuvées / Lectures** ⚠️ (mélange singulier/pluriel vs `STATUS_CONFIG` : « En attente », « Approuvée », « Exécutée », « Lecture », « Échec », « Rejetée »). Select portée (admin/owner) — **Mes actions / Toute l'organisation**. Bouton bascule **« Inclure les lectures »** / **« Masquer les lectures »** (variant `default`↔`outline`).
- Vide : `Card border-dashed` `py-12 text-center` — *« Aucune action ne correspond à ces filtres. »*
- `ActionRow` : Badge statut `h-6` (+ sous-statut **« Programmée »** `bg-info/10 text-info` quand `approved` + `scheduled_for` futur), label via `TOOL_LABEL` (~45 entrées FR), résumé, warning `⚠️` `text-warning`, `Envoi prévu : {date longue fr-FR}`, erreur `text-destructive`, message succès `text-success`, temps relatif à droite (`title` = date complète).
- Boutons inline `h-7 px-2 text-[11px]` : **Approuver** (`Check`), **Rejeter** (`X`), **Annuler la programmation** (`Ban`, `text-warning border-warning/40`), **Relancer** (`RotateCcw`).
- AlertDialog actions sensibles : titre **« Confirmer cette action sensible »**, corps *« Tu vas approuver l'action **{label}**. »* (+ summary, + `⚠️ {warning}`), **Annuler** / **« Oui, j'approuve »** (**pas de style destructive**). Sensibles : `send_linkedin_message`, `dismiss_candidate`, `invite_team_member`, `update_member_quota`, `update_mission_status` (archived/completed seulement).
- Toasts : `Action rejetée` ; `Action exécutée ✓` ; `Action programmée pour {date}` (6 s) ; `Action {approve|reject} a échoué` (⚠️ **verbe anglais interpolé dans un message FR**) ; `Relance échouée : {msg}` ; `Action remise en attente — approuve-la depuis le chat ou ici` ; `Annulation échouée : {msg}` ; `Programmation annulée`.
- ⚠️ **Tutoiement systématique** dans cet onglet (« Tu vas approuver », « approuve-la ») vs vouvoiement partout ailleurs.

---

## 11. Onglet ICP SOCIÉTÉS (`presets`) — `PedigreePresetsSettings.tsx`

Card unique. CardTitle `Bookmark` **« ICP par société »** + bouton **« Nouvel ICP »** (`sm ml-auto h-7 gap-1.5 text-xs`, `Plus`) **placé à l'intérieur du `<CardTitle>`** (les autres écrans le mettent dans un `<div>` frère).
- Aide `max-w-2xl` : *« Configurez l'ICP (Ideal Candidate Profile) de chaque société — ce qui définit un bon candidat pour elle (écoles, entreprises, séniorité, stade de financement). L'ICP s'applique automatiquement à toutes les missions de la société et le scoring IA l'honore avec priorité sur les règles d'équité par défaut. »*
- Encart RGPD `border-amber-500/20 bg-amber-500/5` + `AlertCircle text-amber-500`, texte `text-amber-700 dark:text-amber-400` — ⚠️ **couleurs Tailwind brutes `amber-500/700/400` au lieu des tokens `warning`**. Contenu : **« Note RGPD »** — *« ces critères ciblent l'objectif (école, type d'entreprise) et non l'origine du candidat. Discriminer sur la nationalité ou l'origine ethnique est illégal en France. Préférez "diplôme délivré par établissement français" à toute formulation excluant explicitement des candidats étrangers. »*
- Loading `BrutalLoader compact` py-8. Vide : `border-dashed rounded-lg p-8 text-center` + `Settings w-8 h-8` — *« Aucun ICP configuré. Créez-en un pour automatiser les critères de sélection sur vos missions par société. »*
- Grille `grid-cols-1 md:grid-cols-2 gap-3`. **PresetCard** : `<div className="border rounded-lg p-4 bg-card">` (pas un `<Card>`), nom, société (`Building2`) + Badge **« Par défaut »** `border-emerald-500/30 text-emerald-600` (**couleurs brutes**), description, badges de résumé `secondary text-[10px]` (`{n} école(s)`, label origine diplôme, `{n} provenance(s)`, `{n} entreprise(s) cible(s)`, `Min. {séniorité}`) + Badge **« Mode strict »** (`Shield`, `bg-amber-500/10 text-amber-700 border-amber-500/30`).
- Actions : crayon `ghost icon h-7 w-7` (**pas d'aria-label**) ; corbeille destructive → AlertDialog **« Supprimer cet ICP ? »** — *« L'ICP "{nom}" sera retiré. Les missions qui l'utilisent garderont les critères en snapshot dans leur brief, mais ne seront plus liées à l'ICP. »* / **Annuler** / **Supprimer** (`className="bg-destructive"` nu).
- Dialog (`max-w-2xl max-h-[90dvh]`) : titre `Nouvel ICP` / `Modifier l'ICP`, desc *« Configurez les critères qui définissent un bon candidat pour cette société. Appliqués automatiquement au scoring de toutes ses missions. »*
  - **Nom de l'ICP \*** placeholder `ex: BlaBlaCar — Top tech FR` ⚠️ **marque tierce en dur dans un placeholder**.
  - **Description (note interne)** Textarea rows 2, placeholder `Pour quoi sert cet ICP, contexte société...`
  - **Nom de la société (auto-application)** placeholder `ex: BlaBlaCar`, aide *« Si renseigné + "par défaut" coché ci-dessous, cet ICP sera automatiquement appliqué aux nouvelles missions créées pour cette société. »*
  - Switch conditionnel **« Appliquer par défaut pour cette société »** + *« Un seul ICP peut être par défaut par société. »*
  - `<PedigreeRequirementsEditor>` (composant externe).
  - Footer : **Annuler** (`outline`) / **Créer** | **Mettre à jour** | loading `Enregistrement…`.
- Toasts : `ICP créé` / `ICP mis à jour` / `ICP supprimé` / `Erreur lors de la création|mise à jour|suppression : {msg}` / `Non connecté`.
- Imports morts : `Label` non utilisé partiellement, `SENIORITY_LABELS` ok, `COMPANY_PROVENANCE_LABELS`/`COMPANY_AVOID_LABELS` **importés et jamais utilisés**.

---

## 12. Onglet AGENCE (`agency`) — `AgencySettings.tsx`

⚠️ **Aucun `<Card>` — deux `<div className="border border-border p-4 sm:p-6">`.** Rupture de structure la plus visible du module.
Loading : `<div className="w-5 h-5 border border-border border-t-foreground animate-spin" />` — **spinner maison, ni `Loader2` ni `BrutalLoader`**.

**Bloc 1 « Infos cabinet »** (`<h3 className="text-xs font-bold uppercase tracking-wider text-muted-foreground mb-4">`) : `grid-cols-1 sm:grid-cols-3`, 3 tuiles `border p-4 text-center` : **Membres**, **Owners** (⚠️ **anglicisme**), **Recruteurs** (= rôle `member`).

**Bloc 2 « Permissions agence »** : si `!isOwner`, *« Seuls les propriétaires peuvent modifier les permissions. »* Puis 5 lignes `flex justify-between px-4 py-3 border` :
| Libellé | Description | Défaut |
|---|---|---|
| **Masquer les montants** | *Les membres ne voient pas les bounties et commissions* (⚠️ anglicisme « bounties ») | off |
| **Partager les candidats** | *Les candidats sourcés sont visibles par tous les membres* | on |
| **Partager les appels** | *Les transcripts d'appels sont accessibles à tous les membres* (⚠️ « transcripts ») | off |
| **Soumission réservée aux owners** | *Seuls les propriétaires peuvent soumettre des candidats aux clients* (⚠️ « owners » dans le libellé, « propriétaires » dans la desc) | off |
| **Création de missions par les membres** | *Les membres peuvent créer de nouvelles missions* | on |

⚠️ **Le contrôle n'est PAS un `<Switch>`** : `<button className="h-8 px-4 text-xs font-bold uppercase tracking-wider border">` affichant **« Activé »** / **« Désactivé »**, `bg-foreground text-background` si actif. Aucun `role="switch"`, aucun `aria-pressed`. `hover:border-border` sur une bordure déjà `border-border` = no-op.
Toasts : `Permission mise à jour` / `Erreur` (ou `err.message` brut).

---

## 13. Onglet MARKETPLACE (`marketplace`) — `MarketplaceActivation.tsx`

Loading `Loader2 w-4` centré py-10.

**Entreprise → `HuntModeCard`** : `<div className="rounded-xl border border-border bg-card p-4 sm:p-6">` (pas de `<Card>`). `IconTile icon={Target} size="md"`, `<h3 className="font-display text-sm font-bold">` **« Mode chasse »** + *« Proposez vos missions aux recruteurs partenaires »*. 3 paragraphes (pourcentage du salaire annuel, activation dans l'onglet Configuration de la mission, visibilité pour le recruteur). Lien **« Voir mes missions publiées »** (`text-xs font-medium underline underline-offset-4` + `ArrowRight`) → `/marketplace`.

**Cabinet / indépendant → `PartnerCircleCard`** : `IconTile icon={Shield}` **« Cercle partenaires »** + *« Missions confiées par des entreprises aux recruteurs validés par Konekt. »*
- **active** : encart `border-success/30 bg-success/10` — *« Votre organisation fait partie du cercle partenaires depuis le {date}. »* + lien **« Voir les missions ouvertes »**.
- **pending_validation** : encart `border-warning/30 bg-warning/10` (`Clock`) — *« Demande envoyée le {date}. L'équipe Konekt examine chaque demande avant d'ouvrir l'accès. Vous pouvez encore modifier votre fiche ci dessous. »* (⚠️ **« ci dessous » sans trait d'union**).
- **suspended** : encart `border-destructive/30 bg-destructive/10` (`Ban`) — *« Votre accès au cercle est suspendu : vous ne voyez plus les missions ouvertes et ne pouvez plus postuler. Vos missions en cours restent accessibles depuis Missions. Écrivez à l'équipe Konekt pour comprendre cette décision. »* → ⚠️ **`mailto:l.garilhe@konekt.fr` en dur dans le JSX**.
- **inactive sans droit** : *« Seul un propriétaire ou un administrateur de votre organisation peut envoyer cette demande. »*
- Formulaire (`FieldLabel` = `text-[10px] uppercase tracking-wider font-semibold`) : **Titre** (`Recruteur tech senior, 8 ans en cabinet`, max 120) ; **Présentation** (Textarea rows 4, `Vos secteurs, vos méthodes, vos derniers placements.`, max 1500) ; **Spécialisations** (chips `rounded-full` + ✕ aria `Retirer {s}` ; input `Ajoutez une spécialisation puis appuyez sur Entrée`, max 60 ; `Aucune spécialisation renseignée.` en lecture seule) ; **URL LinkedIn** (`https://www.linkedin.com/in/votre-profil`, `inputMode=url`).
- Bouton `rounded-full` **« Demander à rejoindre le cercle »** / **« Mettre à jour ma demande »**.
- Validations toasts : `Indiquez un titre` / `Ajoutez une présentation` / `Indiquez l'adresse de votre profil LinkedIn (https://www.linkedin.com/in/...)`.
- Erreur : *« Impossible de charger votre statut partenaire. »* + **Réessayer** (`outline sm rounded-full`).

**Sans type d'org** : `rounded-xl border bg-card p-6` — *« Indiquez le type de votre organisation pour utiliser la marketplace. »* + *« Une entreprise publie ses missions, un cabinet ou un indépendant rejoint le cercle de recruteurs partenaires. Le type se règle dans l'onglet Général. »* + lien **« Ouvrir l'onglet Général »** → `/settings`.

---

## 14. Page PRICING publique (`src/pages/Pricing.tsx`)

`min-h-screen bg-background`. SEO title **« Tarifs »**, desc *« Plans Konekt par siège et par mois : Solo, Cabinet et Entreprise. 14 jours d'essai gratuit, sans carte bancaire, crédits IA inclus. »*, keywords `pricing, tarifs, recrutement, ATS, sourcing`.
Constantes : `RECOMMENDED_PLAN_ID = 'cabinet'` (→ `'solo'` si `orgType === 'freelance'`), `TRIAL_DAYS = 14`.

**Header** `border-b h-14`, conteneur `max-w-5xl px-4 sm:px-6` : `KonektLogo variant="full" theme="dark" size={28}` (⚠️ **`theme="dark"` forcé**) aria-label `Konekt, accueil` ; lien droit **« Retour à l'application »** / **« Se connecter »** (`text-xs uppercase tracking-wider`).

**Hero** (`max-w-5xl px-4 sm:px-6 pt-8 pb-20`, `text-center mb-12 sm:mb-16`) :
- Badge `inline-flex px-3.5 py-1 border` + carré `w-1.5 h-1.5 bg-accent` — **« Tarifs transparents »**.
- H1 `font-display text-3xl sm:text-4xl md:text-5xl font-black` : **« Le bon plan pour »** / `<span className="skalr-gradient-text">` **« votre recrutement »**.
- Sous-titre : *« 14 jours d'essai gratuit, sans carte bancaire. Ensuite, un prix par siège et par mois, crédits IA inclus. »*
- Bandeau essai (connecté + trialing) : `border-2 border-[hsl(var(--skalr-purple))] bg-muted/30 text-xs font-bold uppercase` — **« Essai en cours : {n} jour restant|jours restants »** + ` — abonnement déjà en place` si `isTrialPaid`.
- **Bascule mensuel/annuel** : label **« Mensuel »** ; `<button role="switch" aria-checked aria-label="Facturation annuelle">` `w-14 h-7 border-2`, thumb `w-5 h-5`, `translate-x-7 bg-accent` en annuel ; label **« Annuel »** + chip remise `skalr-gradient-bg text-white` — **`-{n} %`** ou **`jusqu'à -{n} %`** (calculée depuis les prix, `yearlyDiscountPercent`).
- ⚠️ **Toutes les animations d'entrée sont des `style={{opacity, transform, transition, transitionDelay}}` inline**, pas des classes ni framer-motion (délais 80/160/240/400/500/700 ms + `i*120`, `fi*40`).

**Cartes de plans** :
- Loading `BrutalLoader`. Erreur/vide : `border-2 border-dashed px-4 py-8 text-center text-sm` — *« Impossible de charger les tarifs. Réessayez plus tard. »*
- Plans filtrés : `free` toujours exclu ; `freelance` → pas d'`entreprise` ; `enterprise`/`agency` → pas de `solo`.
- Carte `flex-1 border-2`, recommandée `border-[hsl(var(--skalr-purple))] bg-muted/30 z-10` + barre `h-[3px] skalr-gradient-bg` animée `gradientShift 3s`. Bordures fusionnées `md:-ml-[2px]` / `-mt-[2px]`.
- Hover via **handlers JS inline** `onMouseEnter/Leave` modifiant `style.transform` et `style.boxShadow` (⚠️ pas de CSS `:hover`).
- Badge absolu `-top-3.5` : **« Plan actuel »** (`bg-foreground text-background`) ou **« Recommandé »** (`bg-[hsl(var(--skalr-purple))]`). ⚠️ classe `text-white` appliquée aux deux alors que « Plan actuel » surcharge en `text-background`.
- Contenu : nom `text-xs uppercase tracking-wider font-bold text-muted-foreground`, description `text-xs text-muted-foreground/70`, prix `font-display text-4xl sm:text-5xl font-extrabold` + **`/ siège / mois`** ; sous-prix : `facturé {X} par an, soit -{n} %` ou **`sans engagement`**. Format `Intl.NumberFormat('fr-FR', EUR, 0-2 décimales)`.
- Features : `<ul>` puces `w-4 h-4 border` + `Check w-2.5`, texte `text-foreground/80` (issues de `subscription_plans.features`, données DB).

**CTA (`renderCta`)** — bouton `w-full h-12 text-xs uppercase tracking-wider font-bold border-2` :
| Condition | Libellé |
|---|---|
| résolution en cours | **Chargement** (`Loader2`), disabled |
| non connecté | **Commencer l'essai gratuit** → `/auth` (state `from: '/pricing'`) |
| erreur org | `<p>` `border-2 border-dashed` — *« Impossible de charger votre espace. Réessayez plus tard. »* |
| pas d'org | **Créer mon espace** → `/onboarding` |
| plan courant | **Plan actuel**, disabled |
| non-admin | `<p>` `border-2 border-dashed` — *« Demandez à un administrateur de votre espace »* |
| abonnement Stripe existant | **Changer de plan** / loading **Ouverture de la gestion** → portail |
| sinon | **Choisir {plan.name}** / loading **Redirection vers le paiement** → checkout |

Note sous les cartes : *« Après l'essai de 14 jours, le plan Gratuit conserve vos données. »*

**Comparatif** : `<h2 className="text-xs uppercase tracking-wider font-bold text-muted-foreground">` + carré `w-2 h-2 bg-accent` — **« Comparatif détaillé »**. Table `border-2`, colonne 1 **« Fonctionnalité »**, lignes : **Missions actives** (`max_jobs`), **Crédits IA / mois** (`ai_credits`), **Contacts enrichis / mois** (`contacts_included`), **Recherches Base Konekt / mois** (`database_searches_included`). Valeurs : `Illimité` (-1), `Non inclus` (undefined/null), sinon `fr-FR`.
⚠️ **La ligne « Recherches Base Konekt / mois » est absente de « Limites du plan » dans BillingSettings** — les deux tableaux divergent.

**FAQ** : **« Questions fréquentes »**, accordéons `border border-border` + `Plus` rotatif 45°. 4 entrées :
1. **« Comment fonctionne l'essai gratuit ? »** — 14 j sur plan Cabinet, sans CB, retour au plan Gratuit.
2. **« Comment sont comptés les sièges ? »** — un siège par membre, prix par siège/mois, *« ajustez la quantité depuis Paramètres, Abonnement »*.
3. **« Les crédits IA sont-ils inclus ? »** — volume mensuel inclus, packs *« depuis Paramètres, Crédits IA »*.
4. **« Puis-je changer de plan ou résilier ? »** — sans engagement, tout depuis *« Paramètres, Abonnement »*.
⚠️ Les renvois « Paramètres, Abonnement » sont du **texte brut sans lien** vers `/settings?tab=billing`.

**Toasts Pricing** : `Impossible d'ouvrir le paiement. Réessayez.` (ou message serveur FR) ; `Impossible d'ouvrir la gestion de l'abonnement. Réessayez.`

---

## 15. États transverses

**Loaders — 5 traitements différents pour le même besoin :**
| Composant | Loader |
|---|---|
| BillingSettings, AICreditsSettings, AgentActionsSettings | `BrutalLoader compact` dans `flex justify-center py-12` |
| IntegrationsSettings, TeamManagement, PedigreePresets, EmailSignatures, AiContext | `BrutalLoader compact` py-6/py-8 |
| ConnectorSettings | `Loader2 w-5 animate-spin text-muted-foreground` py-12 |
| MarketplaceActivation | `Loader2 w-4` py-10 |
| AgencySettings | `<div className="w-5 h-5 border border-t-foreground animate-spin"/>` maison |
| BaseKonektCard | texte `Chargement de la Base Konekt.` dans une Card |
| CustomVariables / MessageTemplates | `Loader2 w-3/w-4` + texte `Chargement...` |
| Pricing | `BrutalLoader` (non compact) |

**Messages « sans permission » (5 formulations distinctes)** :
- `Pour recharger des crédits, demandez à un administrateur de votre espace.` (crédits)
- `Pour activer ou désactiver la Base Konekt, demandez à un administrateur de votre organisation.`
- `Seuls les propriétaires peuvent modifier les permissions.` (agence)
- `Les plafonds sont définis par les propriétaires et administrateurs de l'organisation.` (LinkedIn safety)
- `Les détails de gestion (LinkedIn, missions, quota) sont visibles uniquement par les administrateurs.` (équipe)
- `Demandez à un administrateur de votre espace` (Pricing) / `Demandez à un administrateur de choisir un plan.` (TrialBanner)
- `La connexion Notion n'est pas disponible pour ce compte.` / ` Réservé aux administrateurs.` (policies)

**`UpgradePrompt`** (`src/components/ui/UpgradePrompt.tsx`, titre par défaut **« Abonnement requis »**, bouton **« Voir les plans »**) : ⚠️ **n'est utilisé nulle part dans `settings/` ni `billing/`** — seulement dans `outreach/SequenceEnrollButton.tsx`. Les upsells de Settings sont tous réimplémentés à la main (BaseKonektCard, AICreditsSettings, InviteMemberForm).

---

## ANOMALIES DESIGN

**A. Structure — Card vs non-Card**
1. `AgencySettings` : deux `<div className="border border-border p-4 sm:p-6">` au lieu de `<Card>` ; titres en `<h3 text-xs uppercase>` au lieu de `CardTitle`.
2. `MarketplaceActivation` / `HuntModeCard` / `PartnerCircleCard` : `<div className="rounded-xl border border-border bg-card p-4 sm:p-6">` = duplication manuelle des classes de `Card` (`rounded-xl border border-border bg-card` — sans `shadow-sm`).
3. `EnrichmentAnalytics` : `<Card className="p-6">` sans `CardHeader/CardTitle`, titre en `<h3 text-base font-bold>`.
4. `AgentPoliciesSettings` / `AgentConnectorsSettings` / `NotionConnectionCard` / `ActionRow` : `<Card><CardContent className="p-0|p-3|p-4">` sans `CardHeader`, titres en `<h3 text-sm font-semibold>`.
5. `IntegrationsSettings` : racine `space-y-3` alors que tous les autres onglets utilisent `space-y-6`.

**B. Typographie des titres de carte — 4 conventions concurrentes**
- `text-sm font-bold uppercase tracking-wider` (Général, Billing, Crédits, Équipe, Templates, ICP, Contexte IA, Signatures, Connecteurs, BaseKonekt)
- `text-lg` (MyLinkedInAccount, MyEmailAccount, MyWhatsAppAccount, ExtensionTokens, LinkedInSafetySettings, LinkedInQuotaCard)
- `text-sm font-semibold` (IntegrationsSettings cards, NotionConnectionCard, AgentPolicies, AgentConnectors)
- `text-lg font-semibold` en `<h2>` (AgentActionsSettings) — seul onglet à afficher un titre de page dans le contenu.

**C. Interrupteurs**
- `AgencySettings` : bouton **« Activé/Désactivé »** au lieu de `<Switch>`, sans `role="switch"` ni `aria-pressed` — 5 réglages inaccessibles au lecteur d'écran.
- `Pricing` : bascule mensuel/annuel = `<button role="switch">` maison `w-14 h-7 border-2`, pas le `<Switch>` du DS.
- `AgentActionsSettings` : « Inclure/Masquer les lectures » = bouton bascule sans état ARIA.
- Vrais `<Switch>` : BaseKonekt, AgentPolicies (digest + connecteurs MCP), EmailSignatures, PedigreePresets.

**D. Confirmations destructives — 4 mécanismes**
- `AlertDialog` inline (TeamManagement ×2, BaseKonekt, ExtensionTokens, MessageTemplates, CustomVariables, EmailSignatures, PedigreePresets, IntegrationsSettings LinkedIn, AgentConnectors, NotionConnection, MyLinkedInAccount, AgentActions).
- `confirmAlert()` impératif (IntegrationsSettings « Retirer la clé » — **seul usage dans tout Settings**).
- **Aucune confirmation** : suppression du logo d'org, désactivation d'un connecteur (`ConnectorSettings`), annulation d'invitation (`PendingInvitations` ✕), dissociation email (`MyEmailAccount`), dissociation LinkedIn depuis l'état « mapping orphelin ».
- **`window.confirm` : aucun** dans le périmètre audité (bon point).
- Styles du bouton de confirmation destructif incohérents : `bg-destructive hover:bg-destructive/90` (Team, Templates, Variables, Signatures) vs `bg-destructive text-destructive-foreground hover:bg-destructive/90` (BaseKonekt, ExtensionTokens, Notion, MyLinkedIn, Integrations) vs `bg-destructive` nu (PedigreePresets, AgentConnectors) vs **aucun style** (AgentActions « Oui, j'approuve »).

**E. Couleurs / tokens contournés**
- `PedigreePresetsSettings` : `amber-500/20`, `amber-500/5`, `text-amber-500`, `text-amber-700 dark:text-amber-400`, `emerald-500/30`, `text-emerald-600` — palette Tailwind brute au lieu de `warning` / `success`.
- `NotionConnectionCard` : `bg-white` en dur sur la tuile logo.
- `MyWhatsAppAccount` : `style={{background:'hsl(var(--brand-whatsapp))'}}` inline.
- `PendingInvitations` : badges de statut avec classes ad hoc (`border-primary/30 bg-primary/10 text-primary`…) au lieu des variants `success|warning|info|muted` existants dans `badge.tsx`.
- `Pricing` : `hsl(var(--skalr-purple))` répété 6 fois en littéral, `skalr-gradient-bg` / `skalr-gradient-text` (préfixe **`skalr`** — nom d'un ancien produit, incohérent avec « Konekt »).
- `Pricing` : animations et hover en **style inline JS** (`onMouseEnter` mutant `e.currentTarget.style`).

**F. Valeurs en dur**
- Chemin machine personnel dans l'UI : `cd C:\Users\Hugo\dev\remix-of-event-template\extensions\chrome` (`ExtensionTokens.tsx:353`).
- Email d'équipe `mailto:l.garilhe@konekt.fr` (`PartnerCircleCard.tsx`).
- URL favicon Google `https://www.google.com/s2/favicons?domain=…&sz=128` (`OrgLogoEditor.tsx:24`).
- Marque tierce **BlaBlaCar** dans 2 placeholders (`PedigreePresetsSettings`).
- Ids de modèles `claude-haiku-4-5` / `claude-sonnet-4-6` / `claude-opus-4-6` codés dans le JSX (`AICreditsSettings:284-286`).
- `TRIAL_DAYS = 14` dans `Pricing.tsx` **et** `TRIAL_WARNING_DAYS = 7` dans `TrialBanner.tsx` — pas de source unique.
- Délais magiques dupliqués : `CHECKOUT_REFRESH_DELAY_MS = 5000` (Billing) et `PACK_REFRESH_DELAY_MS = 5000` (Crédits).
- Plafond `max_actions_per_day` : **max 200** dans `TeamManagement` vs **max 500** dans `LinkedInSafetySettings` — même champ DB.
- 7 mécanismes de protection LinkedIn écrits en dur en français (`LinkedInSafetySettings:28-36`) avec chiffres (80, 100, 5-15 s, 16 h, 90 %, 25/50/75 %, 90 j) qui doivent rester synchrones avec le backend.

**G. Noms de fournisseurs visibles utilisateur**
Notion, Calendly, Aircall, LinkedIn, LinkedIn Recruiter, Sales Navigator, Gmail, Outlook, WhatsApp, WhatsApp Web, Chrome, Chrome Web Store, DevTools, Slack (dans « Branchez des serveurs MCP (Notion, Slack, calendrier…) » et dans un message d'erreur `slack-recrutement`), Stripe (implicite via « le paiement » — jamais nommé, bon point), Google (favicon, non nommé mais URL visible dans le DOM), MCP / Model Context Protocol. « Calendly » sert aussi de **catégorie de template** et de nom de template suggéré.

**H. Ton et langue**
- **Tutoiement** : tout l'onglet Actions IA (`Tu vas approuver`, `approuve-la depuis le chat`), `NotionConnectionCard` (`Connecte ton compte`, `t'est personnelle`, `Réessaie`), dialog d'installation de l'extension (`Ouvre Chrome`, `ignore-le`, `Clique`). **Vouvoiement** partout ailleurs.
- Apostrophes typographiques `’` mêlées aux apostrophes droites `'` dans le même fichier (`AgentConnectorsSettings`, `NotionConnectionCard`).
- Fautes : *« tous les missions »* (TeamManagement AlertDialog), *« ci dessous »* (PartnerCircleCard), *« specialiste »* (AiContextSettings placeholder).
- Anglicismes en libellé : **Owners**, **bounties**, **transcripts** (AgencySettings), `Chargement...` avec points ASCII vs `Chargement…` avec ellipse typographique selon les fichiers.
- Casse des badges : `ACTIF` (majuscules, ConnectorSettings) vs `Connecté` vs `désactivé` (minuscule, AgentConnectors) vs `Actif`.
- Statuts au singulier dans les badges (`Exécutée`) mais au pluriel dans le Select de filtre (`Exécutées`) — même écran.
- Message d'erreur mixte FR/EN : `` `Action ${action} a échoué` `` où `action` vaut `approve`/`reject`.

**I. Accessibilité**
- Cartes d'intégration : `<button className="w-full text-left">` sans `type="button"` ni `aria-expanded` (2 occurrences, `IntegrationsSettings`).
- Boutons icône sans `aria-label` : refresh LinkedIn (`IntegrationsSettings:334`), crayon `PresetCard`, corbeille `IntegrationsSettings` (dans `AlertDialogTrigger`).
- `AgencySettings` : 5 pseudo-switches sans sémantique.
- Labels `sr-only` uniquement dans `AgentConnectorsSettings` (placeholders comme seuls labels visibles) — pattern non répliqué ailleurs.
- `EmailSignatures` : `dangerouslySetInnerHTML` pour l'aperçu de signature (contenu utilisateur non sanitisé).

**J. Divers**
- Icône `Plug` utilisée pour **deux onglets distincts** (Connecteurs / Intégrations) dans le même groupe de nav.
- `AICreditsSettings:236` : `pack.badge ? "border-border" : "border-border"` — ternaire sans effet.
- `AgencySettings:131` : `border-border hover:border-border` — hover sans effet.
- `Pricing.tsx:74-76` : `open ? 'border-border' : 'hover:border-border'` — sans effet.
- Imports morts : `ProviderLabel` (AICredits), `Badge`+`Unlink` (MyWhatsApp), `SettingsIcon` (MessageTemplates), `COMPANY_PROVENANCE_LABELS`/`COMPANY_AVOID_LABELS` (PedigreePresets), `Select`/`Badge`/`BrutalLoader` partiellement (Settings.tsx).
- `BillingSettings` « Limites du plan » : `grid-cols-2` sans variante responsive, et n'affiche **aucune consommation** (pas de `Progress`) alors que Crédits IA et Base Konekt en ont — le seul onglet « facturation » sans jauge d'usage.
- `PendingInvitations` affiche un sous-titre « Invitations » à l'intérieur d'une Card déjà intitulée « Invitations ».

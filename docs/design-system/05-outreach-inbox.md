# 05 — OUTREACH (hors recherche) + INBOX — Inventaire exhaustif

## 0. Cartographie des fichiers par sous-domaine

`src/components/outreach/` — 102 fichiers. Hors périmètre (couvert par l'agent recherche) : `search/**`, `filters/**`, `filter-wizard/**`, `LinkedInSearch.tsx`, `LinkedInFilters.tsx`, `LinkedInResultCard.tsx`, `result-card/**`, `CompanyFilter.tsx`, `FilterComponents.tsx`, `JobScoreDisplay.tsx`, `JobSelector.tsx`, `BatchScoring*`, `Scoring*`, `Criteria*`, `LikelyToSwitchBadge`, `AutoFillFiltersButton`, `icp/**`, `projects/**`, `filterApiSupport.ts`, `topSchools.ts`, `calculateExperience.ts`.

**Séquences — liste & cycle de vie**
- `SequencesList.tsx` (1108) — écran liste + toolbar globale
- `SequenceTemplateSelector.tsx` (475) — choix création + `SaveAsTemplateModal`
- `SequenceAnalytics.tsx` (644, lazy/recharts), `SequenceDiagnostic.tsx` (474), `SequenceActivityLog.tsx` (651)
- `activity-log/EditScheduledMessageModal.tsx` (189)

**Séquences — éditeur**
- `SequenceBuilder.tsx` (1466) — plein écran portal, mode Guidé/Expert
- `sequence/SequenceWizardStepper.tsx` (111), `sequence/SequenceValidationChecklist.tsx` (226)
- `sequence/StopConditionsSettings.tsx`, `sequence/MultiSenderSettings.tsx` (311), `sequence/VariableInserter.tsx` (132)
- `sequence/VisualSequenceEditor.tsx` (338), `sequence/StepEditor.tsx` (410), `sequence/WorkflowCanvas.tsx` (383), `sequence/nodes/{WorkflowStepNode,WorkflowAddNode,WorkflowBranchLabelNode}.tsx`, `sequence/edges/AnimatedEdge`
- `sequence/conditionTypes.ts`, `sequence/messageTypeUtils.ts`, `sequence/ABTestResults.tsx`

**Enrôlements**
- `SequenceEnrollButton.tsx` (248), `SequenceEnrollModal.tsx` (660), `EnrollmentPreviewModal.tsx` (1580)
- `enrollment-preview/{SequenceTreeView(943),CandidateSidebarCard(270),CandidateContextHeader(289),DynamicSummaryBanner(95),ScoringPopover(85),HistoryPopover(71),types.ts}`
- `SequenceEnrollmentsPanel.tsx` (1054), `CandidateSequencesPanel.tsx` (441)

**InMails / messages IA**
- `BulkInMailModal.tsx` (918), `InMailTextEditor.tsx` (420), `inmailEditor/transforms.ts`, `OutreachMessageModal.tsx` (593)

**Invitations LinkedIn** — `InvitationsPanel.tsx` (508)

**Comptes / santé / quotas** — `LinkedInAccountManager.tsx` (664), `ProxyConfigPanel.tsx` (275), `WebhookManager.tsx` (245), `QuotaDisplay.tsx` (227)

**Inbox** — `src/pages/Inbox.tsx` (96), `MessagesInbox.tsx` (399), `inbox/{ChatListSidebar(456),ChatListItem(430),MessageView(1372),MessageComposer(729),InlineAIPanel(448),SmartReplies(99),SnoozeArchiveButtons(205),TemplatesPicker(186),ToneSelector(136),CtaReplyButton(291),ActivityEventCard(120),textFormat.ts}`
Hooks : `useMessagesInbox`, `useMessagesInboxHelpers`, `useMessageActions`, `useChatCategories`, `useChatIntents`, `useChatStatus`, `useChatDraft`, `useTextActions`, `useMessageTemplates`, `useEnrollmentPreview`, `useLinkedInQuotaStatus`, `lib/sequenceErrorMessages.ts`.

**Annexes** — `AddToPipelineModal.tsx` (342, ouvert depuis l'inbox), `CandidateHistoryPanel`, `AircallHistoryPanel`.

**Montage** : `MissionOutreach.tsx` (sous-onglets ⚡ Séquences / 📨 Invitations) monte `SequencesList` + `InvitationsPanel`. `pages/Outreach.tsx` (43 l.) = juste `ProjectsListV2`. `pages/Inbox.tsx` monte `MessagesInbox`.

---

## 1. INBOX

### 1.1 Page `Inbox.tsx`
- `SEOHead title="Messages — Konekt"` / description "Messagerie LinkedIn unifiée".
- Wrapper : `div.bg-background.overflow-hidden` + `style={{height:'calc(100dvh - 124px)'}}` (64 AppHeader + 50 bandeau crédits + 10 buffer, **en dur**).
- `AttendeePicturesProvider` → `<MessagesInbox key={initialChatId ?? 'inbox'} … fullHeight />`.
- Sécurité : n'affiche QUE le compte LinkedIn du user courant (`getUserLinkedAccountId`), sinon liste vide.
- Effet : marque les notifications `type='new_message'` comme lues à l'ouverture.
- Deep link `/inbox?chatId=<id>`.

### 1.2 `MessagesInbox.tsx` — coquille
**États d'écran (avant rendu du layout, `!selectedAccount`)** — conteneur `h-full grid place-items-center`, carte `text-center max-w-md px-6` :
- *Loading* : spinner `w-6 h-6 border-2 border-border border-t-foreground rounded-full animate-spin` + « **Chargement de votre compte LinkedIn...** » (`text-xs uppercase tracking-wider`).
- *Aucun compte* : carré `h-14 w-14 bg-foreground/5 rounded-md` + icône `MessageSquare w-6 h-6` ; titre « **Aucun compte LinkedIn connecté** » (`text-sm font-medium text-foreground/70`) ; sous-titre « **Connectez votre LinkedIn dans les paramètres pour voir vos messages.** » (`text-xs`). Aucun bouton d'action (pas de lien vers les paramètres).

**Layout** : `div.h-full.bg-background.overflow-hidden.flex` (`data-component="messages-inbox-grid"`).
- Sidebar (`ChatListSidebar`) + panneau conversation `hidden md:block md:flex-1 md:min-w-0 h-full max-w-full overflow-hidden`.
- Mobile : quand un chat est sélectionné, `MessageView` est dupliqué dans un `fixed inset-0 z-[2100] bg-background md:hidden` (**le composant est instancié 2 fois avec ~30 props identiques**).
- Commentaire d'en-tête annonce « CSS Grid 2 colonnes (sidebar 360px | 1fr) » — **obsolète**, c'est un flex avec sidebar 300px.

**Modale « Choisir une séquence »** (`Dialog max-w-sm`) :
- Titre `text-sm` « **Choisir une séquence** ».
- Description `text-xs` : « Vous verrez les messages et les avertissements avant d'engager **{nom}**. » / fallback « …avant d'engager le candidat. »
- Vide : « **Aucune séquence active pour l'instant.** » (`text-xs text-muted-foreground py-4 text-center`).
- Item : `button w-full p-3 text-left border border-border rounded-md hover:bg-accent/20` — icône `GitBranch w-4 h-4` + nom (`font-medium text-sm`) + « **{n} étape(s)** ».
- Le choix n'inscrit pas : il ouvre `SequenceEnrollModal` (constat UX05).
- Puis `AddToPipelineModal` si `showPipelineModal`.

### 1.3 `ChatListSidebar.tsx`
**Structure** : `h-full flex flex-col transition-[width] duration-200`, largeur `md:w-[64px]` (rail) ou `md:w-[300px]`, `w-full md:flex-shrink-0 md:border-r`. Masquée sur mobile quand un chat est ouvert (`selectedChat ? "hidden md:flex" : "flex"`). Préférence persistée dans `localStorage['konekt_inbox_sidebar_collapsed']`.

**Header** (`border-b bg-background/95 backdrop-blur-sm`, `px-3 pt-3 pb-2 space-y-2` / `px-2 py-3` en rail) :
- Titre `h3` « **Messages** » (`font-semibold text-base tracking-tight`) — masqué en rail.
- Bouton `variant="ghost" size="icon" h-7 w-7 rounded-md` — icône `RefreshCw w-3.5` (`animate-spin` si `loadingChats`), `disabled={loadingChats}`, `aria-label="Rafraîchir les messages"`. Masqué en rail.
- Bouton collapse `ghost/icon h-7 w-7 hidden md:inline-flex` — `PanelLeftClose`/`PanelLeftOpen`, `aria-label`+`title` = « **Réduire la sidebar** » / « **Étendre la sidebar** ».
- Champ recherche : `Input` `pl-9 h-9 text-[13px] bg-muted/40 border-transparent rounded-lg`, icône `Search w-4 h-4` à `left-3`, placeholder « **Rechercher une conversation...** », `aria-label="Rechercher dans les messages"`.

**Filtres (4 rangées de pills, toutes `h-7 text-[11px] font-medium rounded-md`, actif = `bg-foreground text-background`, inactif = `bg-muted/40 hover:bg-muted`)** :
1. Source (`flex-1`) : **Tous** (n=chats.length) · **Classic** · **Recruiter** — compteur `text-[10px] tabular-nums opacity-70/50`.
2. Attente : **Tous** (sans compteur) · **Att. cand.** (`ArrowUpRight`, chats dont `last_message.is_sender===true`) · **Att. moi** (`ArrowDownLeft`).
3. Statut (toujours visible) : **Actives** 💬 · **Sommeil** ⏰ · **Archivées** 📦 · **Toutes** ∗ — **seul l'emoji + le compteur sont affichés**, le libellé n'existe que dans `title`.
4. Toggle collapsible : icône `Tag w-3 h-3` + « **Tags** » (+ « (n) » si filtres actifs) + `ChevronDown` rotatif.

**Bloc Tags déplié** :
- Pills catégories : **Tous** puis, pour chaque `CHAT_CATEGORIES`, emoji + compteur uniquement (libellé en `title`) — 🟢 Intéressé / 🔴 Pas intéressé / 🟡 À recontacter / ⚪ Sans réponse. Re-clic = retour à 'all'.
- Bouton pleine largeur « **Non lus uniquement** » + badge rond compteur (`min-w-[18px] h-[18px] text-[10px] font-bold rounded-full`).

**Liste** (`flex-1 min-h-0 overflow-y-auto overflow-x-hidden`, div natif — commentaire : Radix ScrollArea rejeté à cause du `display:table`) :
- *Loading* : 6 skeletons `flex items-center gap-3 p-3 animate-pulse` avec `animationDelay: i*80ms` (avatar rond `h-9 w-9`, 2 barres).
- *Vide* : `MessageSquare w-10 h-10 opacity-30` + « **Aucune conversation trouvée** » (si recherche) / « **Aucune conversation** ». Si recherche + `hasMoreChats` : bouton `bg-foreground text-background h-8` « 🔍 **Rechercher partout** » / état chargement « **Recherche en cours...** ».
- Pied : « **Rechercher partout** » (recherche active) ou « **Charger plus** » / « **Chargement...** » (`bg-muted/40`).

### 1.4 `ChatListItem.tsx` — anatomie d'une ligne
**Mode rail (64px)** : `button w-full p-1.5 rounded-lg`, avatar `w-9 h-9 rounded-full` (`ring-2 ring-accent-foreground/20` si sélectionné, sinon `ring-1 ring-border/40`), fallback initiales sur `bg-gradient-to-br from-foreground/15 to-foreground/5`. Badge non-lu en overlay `-top-0.5 -right-0.5 min-w-[16px] h-4 text-3xs bg-foreground text-background rounded-full ring-2 ring-background`, « 9+ » au-delà. `title` = « Nom — aperçu ».

**Mode normal** : `button w-full px-2.5 py-2 flex items-start gap-2.5 rounded-lg`, sélectionné `bg-accent text-accent-foreground`, hover `bg-muted/60`.
- **Zone 1** : avatar `w-10 h-10 rounded-full` + pastille canal en bas-droite (`h-3.5 w-3.5 rounded-full bg-background ring-1 ring-border` contenant `<ChannelIcon size="xs">`).
- **Zone 2 ligne 1** : nom (`text-sm truncate`, `font-semibold` si non-lu sinon `font-medium text-foreground/90`) + heure relative (`text-2xs tabular-nums`, `formatChatTime`).
- **Zone 2 ligne 2** : aperçu du dernier message `text-[13px] truncate leading-snug`, préfixé « **Tu : ** » si `is_sender` ; fallback headline `text-[12px]` ; fallback sujet « 📧 {subject} » en italique.
- **Zone 2 ligne 3 (badges, `flex-wrap`, tous `text-3xs px-1.5 py-0.5 rounded-md`)** :
  - ⏰ « **Réveil {dans 2h | demain 9h | vendredi 9h | 5 mai}** » `bg-warning/10 text-warning`, `title` = « En sommeil jusqu'au … ».
  - 📦 « **Archivée {aujourd'hui|hier|il y a 3j|il y a 2 sem|5 mars}** » `bg-gray-500/10 text-gray-600 dark:text-gray-400`.
  - Intent IA (masqué si snooze/archive) : 🟢 Intéressé / 🔴 Décline / 💬 Demande info / 📞 Veut appel / ⏰ Timing pas bon / 🚫 Déjà placé / ⚪ Neutre ; `title` = résumé IA.
  - Type de source : **InMail Recruiter** / **InMail** (`bg-brand-purple/10`), **Recruiter** (`bg-warning/10`), **Sales Nav** (`bg-info/10`), **Classic** (`bg-muted/60`).
  - Catégorie manuelle (emoji + label tronqué `max-w-[80px]`).
  - Fallback statut (si ni source ni catégorie) : « **À répondre · {poste}** » (`text-amber-600`, icône Reply), « **En attente · {poste|Séquence}** » (`text-blue-600`, Hourglass), ou le titre du poste (`text-violet-600`, Briefcase).
  - Compteur non-lus `ml-auto` (`min-w-[18px] h-[18px] bg-foreground text-background rounded-full`, « 99+ »).
- **Actions au hover** (`absolute top-3 right-3 opacity-0 group-hover:opacity-100`, boutons `h-7 w-7 bg-background/95 backdrop-blur border rounded-md shadow-sm`) :
  - `Trash2` — `aria-label="Supprimer"` → AlertDialog « **Supprimer cette conversation ?** » / « Cette action est irréversible. La conversation sera définitivement supprimée. » / [**Annuler**] [**Supprimer** `bg-destructive`, spinner si `isDeletingChat`].
  - `Tag` — `aria-label="Catégoriser"` → DropdownMenu `min-w-[160px]` : les 4 catégories (emoji + label, ✓ si active, re-clic = retire) + séparateur + « ✕ **Retirer le tag** ».

### 1.5 `MessageView.tsx` — fil de conversation
**Layout** : `div.h-full.min-w-0.bg-background.overflow-hidden` avec `display:grid; gridTemplateRows:'auto minmax(0,1fr) auto'` (`data-component="message-view"`). Docblock détaille le choix grid vs flex.

**État vide (aucun chat)** : carré `h-14 w-14 bg-foreground/5 rounded-md` + `MessageSquare` ; « **Sélectionnez une conversation** » ; « **Vos messages LinkedIn et InMail apparaîtront ici.** ».

**ROW 1 — Header** (`border-b bg-background/95 backdrop-blur-md`, `flex items-center gap-3 px-5 py-3.5`) :
- Retour mobile : `Button ghost icon h-9 w-9 rounded-full md:hidden`, `ChevronLeft w-5 h-5`, `aria-label="Retour"`.
- Avatar `w-11 h-11 rounded-full ring-2 ring-background` + pastille canal `h-4 w-4`.
- `h2` nom `text-[15px] font-semibold tracking-tight` + **badge statut séquence** (`SequenceStatusBadge`, `text-[10px] font-semibold px-1.5 py-0.5 rounded-md border`) :
  - active → « **En séquence** » `bg-info/10 text-info border-info/30`
  - replied (ou `replied_at` non nul, override) → « **✓ A répondu** » `bg-success/10`
  - paused → « **⏸ En pause** » `bg-warning/10`
  - completed → « **Terminé** » `bg-muted/40`
  - cancelled → « **Annulé** », stopped → « **Stoppé** » `bg-destructive/10`
  - sinon « **Hors séquence** » `bg-muted/40 text-muted-foreground` (mission inférée, pas d'enrollment).
- Headline `text-[13px] truncate`.
- **Bandeau contexte mission** (`flex gap-2 flex-wrap mt-1.5`, chips `text-[11px] px-2 py-0.5 rounded-md border`) :
  - 💼 titre du poste (`bg-foreground/8`).
  - « **Étape {n+1}** » `text-info bg-info/10 border-info/30` (si active).
  - Bouton **Arrêter** (`StopCircle w-3 h-3`, `text-destructive bg-destructive/8 border-destructive/30 hover:bg-destructive/15`), `title` = « Arrêter la séquence — annule toutes les relances programmées pour ce candidat ».
  - Après arrêt : chip « **Séquence stoppée** » (`bg-muted/40`).
  - Mode recrutement : « **🏢 Interne** » / « **🤝 Cabinet** », `title` = « L'IA parle en "on / nous / chez nous" » / « L'IA parle en cabinet externe ».
  - « **🕶 Anonyme** » `text-warning bg-warning/10`, `title` = « Le nom du client est masqué dans les réponses générées (alias : …) ».
  - Nom du client (si non anonymisé).
- Sujet : « **Objet : {subject}** » `hidden md:block text-xs italic`.
- **Actions droite (`hidden md:flex`)** : `SnoozeArchiveButtons compact` | séparateur `w-px h-5 bg-border` | `ToneSelector` | bouton **Résumer** (`h-8 px-3 text-xs rounded-lg`, `FileText`/`Loader2`, visible si ≥ 4 messages, `title="Générer un résumé de la conversation"`) | lien **Profil** (`User w-3.5`, `title="Voir le profil LinkedIn"`, ouvre `profile_url`).
- **Panneau Résumé IA** (sous le header, `border-t bg-gradient-to-br from-foreground/5 to-foreground/[0.02] px-5 py-3`) : carré `h-8 w-8 rounded-md bg-foreground/10` + `FileText` ; `h3` « **Résumé IA** » + bouton texte « **Fermer** » (`text-[10px]`) ; corps `text-[13px]` ; puces `key_points` ; chip « **Prochaine étape :** {next_action} » avec `ArrowRight`.

**ROW 2 — Messages** (`overflow-y-auto overscroll-y-contain px-6 py-6`) :
- *Loading* : 5 barres `h-12 bg-muted/40 animate-pulse rounded-2xl` alternées gauche/droite, largeurs 40/28/56/36/32 %, `animationDelay i*80ms`.
- *Vide, 3 variantes* (icône `h-16 w-16 rounded-2xl bg-gradient-to-br from-muted to-muted/40` + `MessageSquare w-7 h-7 opacity-40`) :
  1. **Historique indisponible** — « LinkedIn n'a pas renvoyé les messages de cette conversation. Voici le dernier message connu : » + bulle du `last_message` + bouton **Recharger les messages** (`bg-foreground text-background`).
  2. **Synchronisation de l'historique…** (spinner inline) — « LinkedIn récupère les messages de cette conversation. Ça peut prendre quelques secondes. » + bouton secondaire **Forcer le rechargement**.
  3. **Aucun message** — « Cette conversation est vide ou LinkedIn n'a pas encore renvoyé l'historique. » + **Recharger les messages**.
- *Toasts du rechargement* : info « **Synchronisation en cours...** » / desc « Si l'historique n'est pas en cache, on force une resync (~10-30s) » (4 s) ; warning « **LinkedIn n'a pas pu récupérer les messages** » / « Cette conversation a été supprimée côté LinkedIn ou son historique n'est plus accessible. » (6 s) ; success « **{n} message(s) chargé(s)** ».
- Auto-sync silencieux d'un chat vide, guardé par `sessionStorage['inbox.autoSyncedChats']`.
- **Timeline** = messages + événements d'activité + séparateurs de date. Séparateur : deux filets `h-px bg-border/60` + libellé `text-[11px] text-muted-foreground/70` (« **Aujourd'hui** », « **Hier** », jour de la semaine < 7 j, « 12 mars », « 12 mars 2025 »).
- **Bulle** : `motion.div` (spring `stiffness:480 damping:38 mass:0.7`, `initial{opacity:0,y:6,scale:0.985}`), `max-w-[85%] md:max-w-[75%]`, `px-4 py-2.5 text-sm leading-relaxed shadow-sm group-hover:shadow-md`.
  - Envoyé : `bg-foreground text-background`, `rounded-2xl` + `rounded-tr-md` (1er du groupe) + `rounded-br-md` (dernier). Reçu : `bg-muted text-foreground` + `rounded-tl-md`/`rounded-bl-md`.
  - Groupage : `mt-4` entre groupes ; avatar `w-8 h-8` à gauche uniquement sur le **dernier** message reçu du groupe.
  - Texte : `whitespace-pre-wrap break-words text-pretty` + `overflowWrap:'anywhere'` ; placeholders (pièce jointe / supprimé) en `italic opacity-75`.
  - **Réactions** sous la bulle : chips `bg-background border rounded-full shadow-sm` groupées par emoji + compteur si > 1.
  - **Horodatage + accusés** (dernier du groupe) : `text-[10.5px] tabular-nums` + `CheckCheck` (lu) / `Check` (délivré) / `Clock` (en attente).
  - **Barre de réactions au hover** (messages reçus) : `absolute -bottom-3 left-2`, pilule `bg-background border rounded-full shadow-md`, 6 boutons `h-7 w-7 rounded-full` : 👍 ❤️ 🔥 👏 😂 😮, `aria-label="Réagir avec {emoji}"`.
  - **Suppression au hover** (messages envoyés) : `absolute -top-2 -right-2 h-6 w-6 bg-destructive rounded-full`, `aria-label="Supprimer ce message"`.
- **`ActivityEventCard`** (pilule centrée `border-dashed rounded-sm max-w-[85%]`) : Visite de profil (blue-500) · Invitation envoyée (green-500) · Message séquence · InMail séquence (purple-500) · Smart message · Attente connexion (amber-500) · Vérification connexion · 📅 RDV planifié (emerald-500, cliquable → `/qualification/{id}`) · Appel Aircall (logo Aircall, `bg-whatsapp/10 border-whatsapp/30`, « 📞 Appel entrant/sortant (2m30s) — {user} »). Statuts : `CheckCircle2` sent, `XCircle` failed (+ 40 premiers caractères de l'erreur), `SkipForward` skipped (+ raison), `Clock` waiting_event.

**ROW 3 — Composer** : `InlineAIPanel` (si ouvert, `max-h-[40vh] overflow-y-auto border-t`) → `SmartReplies` (si suggestions et panneau fermé) → `MessageComposer`.

**Dialogues de confirmation** :
- « **Supprimer ce message ?** » — « LinkedIn : la suppression n'est possible que dans les 60 premières minutes après l'envoi. Cette action est irréversible. » / [Annuler] [Supprimer].
- « **Arrêter la séquence ?** » — « Toutes les actions programmées pour ce candidat (relances, InMails, emails) seront annulées. Tu pourras reprendre la séquence depuis l'écran de gestion outreach si besoin. » / [Annuler] [**Arrêter la séquence**].
- Toasts : « Profil candidat introuvable », « Aucune séquence active pour ce candidat », « Séquence arrêtée » / « {n} séquences arrêtées », « Erreur lors de l'arrêt ». Écriture DB : `status='paused', pause_reason='manual'` + executions `cancelled` avec `skip_reason='Stoppé depuis Inbox'`.

### 1.6 `MessageComposer.tsx`
Carte `rounded-xl border bg-card` dans `border-t px-4 py-3` (`data-component="message-composer"`), ring de focus `border-foreground/20 ring-2 ring-foreground/10 shadow-sm`.

**Barre de formatage** (`px-2 pt-2 pb-1 border-b border-border/50`, boutons `h-7 w-7 rounded-md`) :
- **Gras** (`Bold`, tooltip « Gras (⌘+B) »), **Italique** (« Italique (⌘+I) »), **Lien** (« Lien (⌘+K) ») → `promptDialog` titre « **Insérer un lien** », defaultValue `https://`, placeholder `https://exemple.com`.
- séparateur | **Liste à puces**, **Liste numérotée**.
- séparateur | **Reformuler** (`Wand2`, `h-7 px-2 text-[11px]`, désactivé si vide, tooltip « Reformule le texte (sélectionné ou tout) en 3 variantes »).
- **Traduire** (`Languages`, `title="Traduire le message"`) → Popover `w-44` : « Traduire vers » + 🇬🇧 **Anglais** / 🇫🇷 **Français**.
- **Réponse + CTA** (`CtaReplyButton`).
- séparateur | **Emoji** (`Smile`, `aria-label="Insérer un emoji"`) → Popover grille 5 col : 👋 🤝 💼 🚀 ⭐ 🙏 😊 👍 🔥 💡 ✨ 🎯 📌 ✅ 💬.
- Droite : compteur « **{n} car.** » (`text-[10px] hidden lg:inline`).

**Textarea** : `rows={1}`, auto-resize `minHeight 24px / maxHeight 160px`, placeholder « **Écrivez votre message... (tapez "/" pour insérer un template)** ». Raccourcis ⌘/Ctrl+Entrée (envoi), +B, +I, +K. Slash-commands → `TemplatesPicker`. Brouillon auto-sauvé par chat (`useChatDraft`), effacé après envoi.

**Barre d'actions** (`px-2 pb-2 pt-1 border-t border-border/50`) :
- **IA** (`Sparkles`, `h-8 px-2.5 rounded-lg`) — `bg-foreground text-background shadow-sm` + badge compteur quand suggestions ; tooltip « Suggestions IA contextuelles ».
- **RDV** (`CalendarPlus`) — `disabled={!hasCalendlyLink}`, tooltip « Insérer un lien de rendez-vous » / « **Configurez un Calendly dans le projet** ».
- Droite : `kbd` « {CANAL} · ⌘+↵ » (**le canal est affiché brut en majuscules**, ex. `LINKEDIN`).
- **Envoyer** (`h-8 px-3 rounded-lg`, `bg-foreground text-background active:scale-95` / `bg-muted text-muted-foreground/40 cursor-not-allowed`), `aria-label="Envoyer le message"` ; état « **Envoi...** » + `Loader2`.

**Dialog Traduction** (`max-w-2xl`) : titre « **Traduction en 🇬🇧 Anglais / 🇫🇷 Français** », description « Vérifiez la traduction et cliquez sur Appliquer pour remplacer votre texte. », blocs **Original** (`bg-muted/20`) / **Traduction** (`border-2 border-foreground/20 bg-foreground/5`), [Annuler (ghost)] [**Appliquer** + `Check`].
**Dialog Reformulation** (`max-w-2xl`) : « **Choisissez une reformulation** » / « Click sur une variante pour remplacer votre texte. Vous pourrez encore l'éditer après. » ; cartes cliquables avec badge label + « {n} caractères » ; vide → « **Aucune variante générée** ».

### 1.7 `TemplatesPicker.tsx`
Popover `absolute bottom-full left-4 mb-2 w-80 max-h-72 bg-popover border rounded-lg shadow-lg z-50`.
- En-tête : `FileText` + « **Templates (n)** » + aide « **↑↓ pour naviguer · ↵ pour insérer** ».
- Item : emoji + nom (`text-sm font-medium`) + badge raccourci (`font-mono bg-muted`) + extrait 80 car. ; actif = `bg-accent` + `ArrowRight`.
- Pied : « **+ Nouveau template** » → ouvre `/settings?tab=templates` dans un nouvel onglet.
- Vide global : « **Templates** » / « Créez vos premiers templates (intro, relance, présentation poste...) pour les insérer rapidement avec un slash command. » + bouton **Créer mon premier template**.
- Vide filtré : « **Aucun template trouvé pour "{query}"** ».

### 1.8 `ToneSelector.tsx`
Trigger `Button ghost sm h-7 px-2` : emoji + label (`hidden sm:inline`) + `Palette w-3 h-3`. Popover `w-56 p-2` : titre « **Ton des réponses IA** » puis 4 options (emoji `text-lg` + label + description + `Check` si active) :
- 👔 **Formel** — « Professionnel et structuré »
- 😊 **Décontracté** — « Amical et accessible »
- 🎯 **Direct** — « Concis et efficace »
- 💬 **Empathique** — « Chaleureux et à l'écoute »

### 1.9 `SnoozeArchiveButtons.tsx`
- Si snoozé/archivé : un seul bouton `outline sm` « **Restaurer** » (`RotateCcw`), `title` = « En sommeil jusqu'au … » / « Conversation archivée ».
- Sinon : **Snooze** (`ghost`, `Clock`, `title="Mettre en sommeil"`, label masqué en mode compact) → Popover `w-72 p-2` : titre « **Mettre en sommeil** » + « La conversation reviendra dans la liste à la date choisie. » ; presets `SNOOZE_PRESETS` avec date calculée à droite :
  « **Plus tard aujourd'hui (3h)** », « **Demain matin (9h)** », « **Cette semaine (vendredi 9h)** », « **Semaine prochaine (lundi 9h)** », « **Dans 1 mois** ».
  Puis « 📅 **Date personnalisée** » : `input type="datetime-local"` (min = maintenant) + bouton **OK**.
- **Archiver** (`ghost`, `Archive`, `hover:text-destructive`) → AlertDialog « **Archiver cette conversation ?** » / « La conversation sera masquée de votre liste principale mais restera accessible via le filtre "Archivées". Vous pourrez la restaurer à tout moment. » / [Annuler] [**Archiver**].
- Toasts (`useChatStatus`) : « **En sommeil jusqu'au {date}** », « **Conversation archivée** », « **Conversation restaurée** », « Impossible de mettre en sommeil / d'archiver / de restaurer » + description.

### 1.10 `SmartReplies.tsx`
Barre `flex items-center gap-1.5 px-4 py-2 border-t bg-muted/20 overflow-x-auto` (`data-component="smart-replies"`) : `Sparkles w-3 h-3` + libellé « **Suggestions** » (`text-[10px]`), max 3 pills `h-7 px-3 text-[12px] rounded-full border bg-background hover:bg-foreground hover:text-background active:scale-95` (texte tronqué à 47 car. + « … », `title` = texte complet), puis « **Plus** › » si > 3. État loading : 3 barres pulse (60/80/50 px).

### 1.11 `InlineAIPanel.tsx`
`border-t bg-background` (`data-component="inline-ai-panel"`), contenu `max-h-[280px] overflow-y-auto p-3`.
- **Header** (`px-3 py-2 border-b bg-muted/20`) : `Sparkles` + « **Assistant IA** » ; onglets pills `h-7 px-2.5 rounded-md` **Réponses** (n) / **Postes** (n) ; `ModelPicker actionId="analyze_response" compact` ; bouton `RefreshCw` (`title/aria-label="Relancer l'analyse"`) ; bouton `X` (`title/aria-label="Fermer"`).
- *Loading* : 3 `Skeleton h-12 rounded-lg` (100/100/75 %).
- *Erreur* : message `text-xs text-destructive` + bouton `outline sm` « **Réessayer** ».
- **Réponses** : sections « 👍 **Positives** » (`text-emerald-600 uppercase`), « 👎 **Clôture** » (`text-destructive`), « ❓ **Questions à poser** » (`text-amber-600`, items `→ {question}`). Vide → « **Aucune suggestion disponible** ».
  - `SuggestionItem` : carte `p-3 rounded-lg border` verte (`emerald-500/20`) ou rouge (`destructive/20`) ; clic = insère dans le composer + ferme ; bouton `Send` `h-7 w-7` apparaissant au hover (`bg-emerald-600 text-white` / `bg-destructive`) = envoi direct, `title/aria-label="Envoyer directement"` ; sous-texte `intent_match` en italique.
- **Postes** : cartes avec pastille de score `w-9 h-9` (`bg-emerald-500` ≥75, `bg-amber-500` 50-74, `bg-muted-foreground` <50) + titre + badge ✓/?/✗ selon `recommendation` (go/maybe/skip) + chips compétences (3 matchées vertes `✓`, 2 manquantes rouges `✗`). Clic → `onAddToPipeline(jobId, jobTitle)`. Vide → « **Aucun poste matché** ».
- Cache : `message_analysis_cache` (stale > 24 h, invalidé si le nombre de messages change, marqueur `_marker` ignoré).

### 1.12 `CtaReplyButton.tsx`
Bouton `h-7 px-2 text-[11px]` « **Réponse + CTA** » (`Sparkles`/`Loader2`, `title="Générer une réponse avec un CTA"`, désactivé si historique vide).
Popover `w-72 p-1` — « **Choisis un CTA** » puis 8 options (icône + label + description) :
| Valeur | Label | Description |
|---|---|---|
| auto | **Suggestion auto** | L'IA choisit le CTA le plus pertinent selon le contexte |
| rdv | **Proposer un RDV** | Insère le lien Calendly de la mission |
| call | **Appel rapide** | Demande 15 min au téléphone, propose des créneaux |
| cv | **Demander le CV** | Demande à recevoir CV / portfolio pour qualifier |
| job_details | **Détailler le poste** | Propose d'envoyer la fiche détaillée de la mission |
| check_interest | **Vérifier l'intérêt** | Relance soft sans pression — utile après silence |
| referral | **Demander une reco** | Si décline, demande s'il connaît quelqu'un |
| close | **Clôturer poliment** | Garde la porte ouverte pour plus tard |

Dialog `max-w-lg` : titre « **Suggestion de réponse** », description = chip du CTA utilisé + « — {raison} » ; message dans `rounded-md bg-muted/50 border p-3` ; footer [**Régénérer** (outline, `RefreshCw`)] [**Insérer dans le message** (`Check`)]. Insertion : remplace si vide, sinon append après `\n\n`.

### 1.13 Hooks / textes système inbox
- Toasts `useMessagesInbox` : « Conversations actualisées », « {n} conversations supplémentaires chargées », « Erreur lors du chargement des conversations / du chargement / du chargement complet », « Erreur lors du chargement des messages », « Impossible de synchroniser » (+ desc), « Conversation supprimée côté LinkedIn », « Synchronisation trop longue, arrêt », « Erreur pendant la synchronisation », « LinkedIn n'a pas pu synchroniser cette conversation », « Message envoyé », « Erreur lors de l'envoi du message », « Impossible d'identifier le profil », « Déjà inscrit dans cette séquence », « ✨ Inscrit dans "{séquence}" » + « {nom} va recevoir les étapes de la séquence. », « Erreur lors de l'inscription », « **Aucune séquence active** » + « Créez une séquence dans l'onglet Séquences d'abord. », « 📅 Lien Calendly inséré dans le message », « 📅 Aucun lien Calendly configuré » + action « **Copier le nom** » → « Nom copié ! ».
  - Message Calendly injecté : « Voici un lien pour réserver un créneau afin de discuter du poste avec notre équipe : {lien} ».
- `useMessageActions` : « Session expirée », « Réaction envoyée », « Message supprimé », « Impossible de supprimer le message », « Conversation supprimée », « Impossible de supprimer la conversation ».
- `useTextActions` : « Reformulation échouée », « Traduction échouée », « Résumé échoué », « Suggestion IA échouée », « Réponse IA invalide », « Aucun historique de conversation ».
- Polling : `setInterval 30_000` (×2), sync poll `2500 ms`.

---

## 2. SÉQUENCES

### 2.1 `MissionOutreach.tsx` (conteneur)
- `accountsLoading` → `BrutalLoader variant="default" rows={2} messages={['Chargement des comptes…']}`.
- 0 compte → `EmptyLinkedInAccountState message="Pour gérer vos séquences d'outreach, connectez d'abord un compte LinkedIn."`.
- Bandeau CTA (si candidats Go et 0 inscription) : « **{n} candidat(s) Go prêt(s) à être contacté(s)** » / « Créez une séquence pour les inscrire automatiquement. » + bouton **Créer une séquence** →.
- Sélecteur de compte : `<select>` HTML natif `h-8 px-2 text-xs` précédé de « Compte : » (**pas le `Select` shadcn**).
- Barre de stats : « {n} inscrits · {n} en cours · {n} répondu · **{x}% taux de réponse** ».
- Sous-onglets boutons `h-8 px-3 rounded-md border` : ⚡ **Séquences** / 📨 **Invitations** (actif = `bg-foreground text-background`).

### 2.2 `SequencesList.tsx`
**Header** : `h1` « **Séquences** » (`text-lg sm:text-xl font-semibold`) + barre d'actions `overflow-x-auto no-scrollbar` (tous `h-8 px-3 text-xs rounded-lg`, libellés `hidden sm:inline`) :
- **Analytics** (`BarChart3`, `border bg-background`)
- **Envoyer tout** / « **En cours…** » (`Zap`, `bg-accent/40`, `disabled` pendant), `title` = « Avance toutes les actions du jour à maintenant (sauf invitations LinkedIn — quota safety) » → action edge `nudge_sequences`. Toasts : « **{n} action(s) avancée(s) — elles partent dans la minute qui vient.** », « Aucune action à avancer pour le moment », « Erreur lors de l'accélération ».
- **Diagnostic** (`Activity`, `title="Vérifier l'état du système d'envoi"`)
- **Journal** (`FileText`, `title="Voir le journal détaillé des actions envoyées"`)
- **Créer une séquence** / « **Créer** » sur mobile (`Send`, `bg-foreground text-background font-semibold`)

**Recherche** : `Input pl-9 rounded-lg`, placeholder « **Rechercher une séquence...** », `max-w-sm`.

**Bandeau sélection** (si profils sélectionnés) : `bg-accent/20 border p-3` — `Users` + « **{n} candidat(s) sélectionné(s)** » + badge du poste + « Cliquez sur une séquence pour y inscrire les candidats ».

**Empty state** : `py-16 bg-card rounded-xl border`, emoji `🔗` `text-4xl`, `h3` « **Séquences automatisées** », texte « Les séquences envoient automatiquement des messages personnalisés à vos candidats en plusieurs étapes. L'IA adapte chaque message au profil du candidat et au poste. », bouton **Créer ma première séquence**.

**Table desktop** (`bg-card rounded-xl border`, grille `grid-cols-[auto_auto_1fr_100px_80px_100px_100px_80px] gap-4 px-4 py-3`) — en-tête `bg-muted/40 text-[11px] font-semibold` : (vide) | **Statut** | **Nom de la séquence** | **Prospects** | **Funnel** | **Créé à** | **Actions** | (vide).
Ligne :
- `Switch` actif/inactif (`data-[state=checked]:bg-foreground`) — si désactivation avec actifs → AlertDialog de confirmation.
- Emoji cyclique parmi 🎯 🚀 💼 ✨ 🔥 💡 📈 🎨 ⚡ 🏆 💪 🌟 (`SEQUENCE_EMOJIS[index % 12]`) + nom + badge « **✨ Template** » (`bg-info/10 text-info border-info/30`, `title` = « Séquence globale réutilisable depuis toutes les missions ») si `project_id === null` + description tronquée.
- Bouton prospects (`bg-muted border`) : `Users` + « **{actifs} / {total}** », `title` = « {n} actif(s) • {n} répondu(s) • {n} terminé(s) — clic pour voir le détail » → ouvre `SequenceEnrollmentsPanel`.
- Pills statuts : « **{n} actif(s)** » (`bg-success/10`), « 💬 {n} » (`bg-info/10`), « ✓ {n} » (`bg-foreground/8`, `title` = « {n} candidat(s) ont parcouru toute la séquence sans répondre ») ; sinon « *Aucune inscription* » en italique.
- Date `formatDistanceToNow(locale:fr)` sans suffixe.
- Bouton `BarChart3` (`title/aria-label="Voir les analytics"`).
- `DropdownMenu` (`MoreHorizontal`) : **Modifier** (`Edit2`) · **Dupliquer** (`Plus`) · **Sauvegarder comme template** (`FileText`) · séparateur · **Supprimer** (`Trash2`, `text-destructive`).

**Cartes mobile** (`sm:hidden p-3`) : même contenu, menu réduit à **Modifier / Analytics / Supprimer** (pas de Dupliquer ni de Sauvegarder comme template).

**AlertDialogs** :
- « **Supprimer cette séquence ?** » — « Cette action est **irréversible**. Tous les candidats inscrits seront retirés et leur historique d'envoi (étapes programmées et envoyées) supprimé. » + encart d'impact `bg-destructive/5` : « **⚠ Impact :** {n} candidat(s) inscrit(s) (dont {n} actif(s) en cours d'envoi). » / [Annuler] [**Supprimer définitivement**].
- « **Désactiver cette séquence ?** » — « Les **{n}** candidat(s) actuellement en cours seront mis en pause. Aucun nouveau message ne partira tant que la séquence est désactivée. » + « Tu pourras la réactiver à tout moment — les enrollments reprendront là où ils en étaient. » / [Annuler] [**Désactiver**].

**Paywall** : `useSubscriptionState` + `hasPlanFeature(planId,'sequences_send')`. À l'activation sans plan : `toast.error("L'envoi de séquences nécessite un abonnement")` avec action « **Voir les plans** » → `/pricing`. **Aucun état visuel de paywall dans la liste** (le Switch reste actif).

**Toasts** : « Séquence mise à jour » / « Séquence créée », « Séquence désactivée — enrollments mis en pause » / « Séquence réactivée — enrollments relancés », « Séquence supprimée », « **Séquence dupliquée : "{nom}"** » + « Inactive par défaut. Active-la quand tu es prêt. », « Erreur lors du chargement des séquences / de la modification / de la suppression / de la duplication ».

### 2.3 `SequenceTemplateSelector.tsx` + `SaveAsTemplateModal`
Dialog `max-w-lg max-h-[85vh]`, titre `uppercase tracking-wide text-sm` : « **Nouvelle séquence** » / « **Choisir un template** » / « **Dupliquer une séquence** » (avec bouton retour `ArrowLeft`).
Étape « choice » — 3 cartes `p-4 border` (carré `w-10 h-10 bg-foreground text-background` avec emoji) :
- 🆕 **Partir de zéro** — « Créer une séquence vide et ajouter vos étapes manuellement »
- 📋 **Depuis un template** — « Utiliser un modèle prédéfini et l'adapter à votre besoin »
- 🔄 **Dupliquer une existante** — « Copier une séquence existante comme point de départ »

Étape « templates » : spinner `h-6 w-6 border-b-2` ; vide → `FileText w-10 h-10` + « **Aucun template disponible** » + « Sauvegardez une séquence comme template pour la retrouver ici ». Carte template : nom + badge « **Konekt** » si `is_system` + badge catégorie (🎯 Sourcing / 🌱 Nurturing / 🔄 Réactivation / ⚙️ Personnalisé) + description `line-clamp-2` + 6 mini-icônes d'étapes `w-5 h-5 bg-muted` + « **{n} étapes** ».
Étape « duplicate » : vide → « **Aucune séquence existante à dupliquer** » ; sinon nom + mini-icônes + compteur. Nom généré : « **Copie de {nom}** ».

`SaveAsTemplateModal` (`max-w-md`) : titre « **Sauvegarder comme template** » ; champs **Nom du template *** , **Description** (`Textarea rows=3`, placeholder « Décrivez l'usage de ce template... »), **Catégorie** (`Select`, 4 options emoji+label) ; [Annuler] [**Sauvegarder** / « Sauvegarde... »]. Toasts « Template sauvegardé ! » / « Erreur lors de la sauvegarde ».

### 2.4 `SequenceBuilder.tsx` — éditeur plein écran
**Enveloppe** : `createPortal` → `fixed inset-0 z-[4000] bg-background flex flex-col`.

**Barre supérieure** (`h-12 sm:h-14 border-b px-3 sm:px-5`) :
- Bouton texte `ArrowLeft` + « **Retour** ».
- Séparateur + « **Nouvelle séquence** » / « **Modifier** » + nom tronqué.
- Toggle pill `bg-muted rounded-full p-0.5` : **Guidé** / **Expert** (actif = `bg-background shadow-sm`). Par défaut : Expert en édition, Guidé en création.
- Bouton **Enregistrer** (`Save`, `h-8 px-4 text-xs`), `disabled` si nom vide ou 0 étape ; état « **Enregistrement...** ».

**Colonne gauche** (`w-56 border-r bg-muted/20 hidden lg:flex`) : `SequenceWizardStepper` en mode guidé, sinon titre « **Validation** » + `SequenceValidationChecklist`.

**Contenu** : `max-w-3xl mx-auto p-4 sm:p-8`, transitions `AnimatePresence` (fade + y 8px, 0.2 s).

**Barre inférieure wizard** (`h-14 sm:h-16 border-t`) : [**Précédent** ghost, disabled sur 'info'] · points d'étape animés (largeur 20 px si actif, 6 px sinon ; `bg-foreground` / `bg-foreground/30` / `bg-border`) · [**Suivant** + `ArrowRight`] ou, sur 'review', [**Activer** + `CheckCircle`].

**Étapes du wizard (`SequenceWizardStepper`)** — nav verticale avec ligne de progression animée, pastille `22×22 rounded-full border-2` (numéro / `Check` vert / `AlertCircle` rouge), libellé `text-[11px]` + description `text-[10px]` (ou « {n} problème(s) ») :
1. **Informations** — Nom et objectif
2. **Expéditeurs** — Comptes & rotation
3. **Étapes** — Actions & messages
4. **Garde-fous** — Limites & sécurité
5. **Vérification** — Aperçu final

**Écran Informations** : `h2` « **Informations** » / « Nommez votre séquence et décrivez son objectif. » ; champ **Nom de la séquence *** placeholder « **Ex: Prospection développeurs React** » ; **Description (optionnel)** placeholder « **Décrivez l'objectif de cette séquence** ».

**Écran Expéditeurs** : `h2` « **Expéditeurs** » / « Configurez qui envoie les messages. Activez le multi-sender pour répartir la charge. » → `MultiSenderSettings`.

**Écran Étapes** : `h2` « **Étapes de la séquence** » / « **{n} étape(s) configurée(s)** » ; si 0 étape, bouton `outline` « ✨ **Charger séquence recommandée** » ; onglets `TabsList h-8` : **Liste** (`List`) / **Visuel** (`Workflow`).

**Écran Garde-fous** : `h2` « **Garde-fous** » / « Définissez quand arrêter la séquence et protégez vos comptes. » → `StopConditionsSettings` + alertes :
- « **Limites élevées détectées** » (`Shield`, `border-amber-500/30 bg-warning/10`) : « Un ou plusieurs senders ont une limite quotidienne > 80. Cela peut compromettre la sécurité de vos comptes LinkedIn. Nous recommandons 30-50 actions/jour pour les comptes récents, 50-80 pour les comptes établis. »
- « **Alertes canal** » : « 📧 Cette séquence utilise des étapes **Email**. Les candidats sans adresse email seront automatiquement skippés. » / « 📱 … **WhatsApp** … sans numéro de téléphone … skippés. »

**Écran Vérification** : `h2` « **Vérification** » / « Vérifiez que tout est prêt avant d'activer la séquence. » ; carte récapitulative (nom `uppercase` ou « **(Sans nom)** », badge « {n} étapes », description) ; « **Aperçu du flux** » = suite d'icônes `w-6 h-6` séparées par `ArrowRight` (20 max + « +n ») ; `SequenceValidationChecklist` ; liste d'erreurs « ❌ {erreur} » (`border-destructive/30 bg-destructive/5`).

**Mode Expert** : tout empilé dans un `space-y-10` — Nom/Description, `StopConditionsSettings`, `MultiSenderSettings`, encart **Séquence recommandée** (`p-5 border-dashed`, carré `w-10 h-10 bg-foreground rounded-lg` + `Sparkles`, « Visite → Vérification → Messages + relances », bouton **Charger**), puis Tabs Liste/Visuel.

#### Anatomie d'une étape (mode Liste — `renderStepsList`)
Carte `border rounded-lg overflow-hidden`, `bg-muted/20 shadow-sm` si dépliée, `border-l-[3px] border-l-amber-400` si trigger.
**En-tête cliquable** (`p-2.5 sm:p-3 cursor-pointer`) : `GripVertical` (décoratif, `hidden sm:block` — **le drag & drop n'est pas implémenté**) · pastille `w-7/8 h-7/8` colorée du type · badge « **Étape {n}** » · badge « **TRIGGER** » / « **ACTION** » · label du type · badge « **⚠ Incomplet (message + objet + trop long)** » (`bg-destructive/10 border-destructive/30`, `title="Manque : …"`) · sous-ligne : « ⏱ **Après {n}j** », « ✨ **IA** », « ⏲ **Timeout {n}j** ».
Actions à droite : bouton `FlaskConical` (`title="Créer un A/B test"`) ou badge « **A/B** » ; bouton `Trash2` (désactivé si une seule étape).

**Corps déplié** (`px-3 sm:px-4 pb-3 pt-2 border-t space-y-4`) :
1. **Délai** (si index > 0) — grille 3 colonnes `Jours` / `Heures` (0-23) / `Minutes` (0-59), inputs `type=number`.
2. **Condition d'exécution** (actions uniquement) — `Select` alimenté par `getConditionsForActionType` ; avertissement « ⚠️ **Cette condition ne fonctionne qu'avec des steps email** » ; si `if_score_above` : champ « **Seuil de score (0-100)** » placeholder `70` (bordure rouge si vide).
3. **Collapsible « ▸ Fenêtre d'envoi »** — **Heure début** / **Heure fin** (inputs number 0-23, `h-8 text-xs`).
4. **Configuration du trigger** (`bg-muted/20 border rounded-md`) — « **Timeout (jours)** » (min 1) + « **Si timeout** » : *Passer à l'étape suivante* / *Exécuter étape alternative* / *Terminer la séquence* ; si alternative → « **Step alternatif** » (`Select`, option « Sélectionner... », items « Step {n} — {label} »).
5. **Vérification du degré** (`check_connection`) — « **Si connecté (1er degré) → aller à** » et « **Si non connecté → aller à** », `Select` avec « **Étape suivante** » + les étapes suivantes (« Étape {n}: {label} »).
6. **Champs message** (`needsMessage`) :
   - Bandeau WhatsApp « 📱 Message WhatsApp. Les candidats sans numéro seront skippés. » (`bg-success/10 border-emerald-500/30 text-emerald-400`).
   - Ligne « ✨ **Personnalisation IA** » + `Switch`.
   - Si IA : « **Ton du message** » (`Select` : Professionnel / Décontracté / Enthousiaste) + « L'IA générera un message personnalisé basé sur le profil LinkedIn et le brief. »
   - Sinon : **Objet** (+ `VariableInserter`, placeholder « Objet de l'email » / « Objet de l'InMail », erreur « **Objet requis** ») ; **Message** (+ `VariableInserter` + compteur « {n}/300 » pour les invitations, `maxLength=300`, placeholder « **Note d'invitation (max 300 car.)** » ou « **Bonjour {{first_name}}, ...** », `rows` 2/3).
   - **Aperçu** (`<details>` natif, visible si le template contient `{{`) : résumé « 👁 **Aperçu (exemple "Laurent Garilhe / Konekt")** » → rendu avec substitutions **codées en dur** : `first_name`→Laurent, `last_name`→Garilhe, `full_name`→Laurent Garilhe, `company`→Konekt, `job_title`→Lead Developer, `sender_name`→« Anna (Konekt) » ou « Toi », `calendly_link`→`https://calendly.com/konekt/call`, `signature`→« — L.G., Konekt », `ai_snippet`→« [snippet IA généré par profil] » ; fallback « Tape ton message ci-dessus pour voir l'aperçu ».
   - Bloc email : Collapsible « ▸ **CC / BCC** » (deux `Input`, placeholders `email1@ex.com`/`email@ex.com`), toggle « **Lien de désinscription** », `Select` « **Signature** » (« Aucune » + signatures, « ⭐ » sur la signature par défaut).
7. **Bloc A/B** (si variantes) : bandeau `FlaskConical` + « **A/B TEST** » + bouton « **+ Variante** » (max 3) ; `Tabs` « **Variante A (50%)** … » ; par variante : champ « **Poids (%)** » (1-100), bouton `Trash2` (sauf A), toggle « **IA** », **Objet**, **Message** (placeholder « Bonjour {{firstName}}, … » — **camelCase, incohérent avec `{{first_name}}` ailleurs**) ; pied « **Total : {n}%** » + « — doit être 100% » en rouge.

**Sélecteur d'étape** (`p-5 border-dashed rounded-lg`) : titre « **Commencer par ajouter une étape** » / « **Ajouter une étape** » + bouton `X` ; sections « ⚡ **ACTIONS** » et « ⏲ **TRIGGERS** » en grille 1-2 colonnes ; chaque carte `p-3 border rounded-lg` = pastille colorée + label + description. Si rien de disponible : « **Séquence complète !** ». Bouton pied « **+ Ajouter une étape** » (`outline border-dashed w-full`).

**Catalogue (SequenceBuilder)** :
- ACTIONS : **Invitation LinkedIn** (`UserPlus`, « Envoyer une demande de connexion », exclue si déjà présente) · **InMail** (`Mail`, « Envoyer un InMail (payant) ») · **Email** (`Mail`, « Envoyer un email ») · **Visite de profil** (`Eye`, « Visiter le profil du prospect ») · **Message LinkedIn** (`MessageSquare`, « Message direct (1er degré requis) », `requiresConnection`) · **Message LinkedIn IA** (`Sparkles`, « Message personnalisé par IA (1er degré) », `bg-foreground text-background`) · **WhatsApp** (`MessageSquare`, « Envoyer un message WhatsApp », `bg-success/10 text-success`).
- TRIGGERS : **Vérifier connexion** (« Route selon le degré ») · **Attendre connexion** (« Pause jusqu'à acceptation », exige `connection_request`) · **Attendre réponse** (« Pause jusqu'à réponse », exige un step message) · **Attendre visite retour** (« Pause si visite profil », exige `profile_visit`).

**Séquence recommandée générée** (17 étapes) : Visite → Vérification connexion (délai 2 min) → branche connecté (Smart message → attente réponse 3 j → relance → attente 4 j → relance) / branche non connecté (Invitation → attente connexion 3 j → message → attente → relance ×2, timeout → InMail → attente 5 j → relance InMail).

**Validation à l'enregistrement (toasts + `validationErrors`)** :
- « **Nom requis** » / « Donnez un nom à votre séquence avant de l'enregistrer. »
- « **Ajoutez au moins une étape** » / « Une séquence doit contenir au moins une action. »
- Par étape (`Étape {n} (variante)`) : « message requis », « un objet est requis pour les steps email », « note d'invitation trop longue (max 300 caractères) », « le seuil de score est requis », « un délai max (timeout) est requis pour les étapes d'attente », « les délais ne peuvent pas être négatifs », « les heures de délai doivent être entre 0 et 23 », « les minutes de délai doivent être entre 0 et 59 », « la plage horaire d'envoi est incohérente (début ≥ fin) ».
- A/B : « Étape {n} : poids des variantes A/B = {x}% (doit être 100%) ».
- Toast agrégé : « **{n} erreur(s) à corriger** » + première erreur + « (+n autres) ».
- Succès : « **Séquence enregistrée** » ; échec : « **Erreur à l'enregistrement** » + « Réessayez dans un instant. »
- **Brouillon** : `localStorage` clé `sequence-new` ; à la reprise, toast info « **Brouillon de séquence repris** » / « Votre travail du {date} à {heure} a été conservé. »

#### `SequenceValidationChecklist.tsx`
Bandeau `border-l-2` : « **{n} bloquant(s)** » (`X`, destructive) / « **{n} recommandation(s)** » (`AlertTriangle`, warning) / « **Prêt — {n}/{total}** » (`CheckCircle2`, success).
Sections « **OBLIGATOIRE** » / « **RECOMMANDÉ** », items `py-1.5 px-2 rounded-md` avec pastille `w-4 h-4 rounded-full` :
Nom de la séquence (« Non défini ») · Étapes définies (« {n} étape(s) ») · Messages rédigés (« À compléter : Étape 2, Étape 4 » / « Tous remplis ») · Objets email (« Tous définis ») · Longueur invitation (« > 300 caractères ») · Timeout sur attentes (« **Risque blocage : Étape 3** ») · Expéditeurs (« Mono-sender » / « {n} configuré(s) ») · Limites quotidiennes (« {n} sender(s) > 80/jour ») · Délais entre étapes (« {n} sans délai ») · Conditions d'arrêt (« Configurées » / « Aucune »).

#### `StopConditionsSettings.tsx`
Label `text-xs font-bold uppercase tracking-wider` « **Conditions d'arrêt** » + 4 lignes `p-2.5 border` avec icône + `Switch` :
- **Arrêter si le candidat répond** (défaut ON)
- **Arrêter si le candidat clique un lien** (OFF)
- **Arrêter si le candidat se désinscrit** (ON)
- **Arrêter si un meeting est booké** (OFF)

#### `MultiSenderSettings.tsx`
Ligne « **MULTI-SENDER** » + `Switch`. Déplié (`p-4 sm:p-5 border`) :
- Liste des senders : carré `w-8 h-8 bg-muted` + `Mail`, email, input `h-7 w-16` (1-200) + « **actions/jour** », bouton `Trash2` visible au hover.
- Vide : `Users w-5 h-5 opacity-40` + « **Aucun sender configuré** » (`border-dashed`).
- Bouton **+ Ajouter un sender** (`outline border-dashed w-full h-9`).
- « **Mode de rotation** » : *Round-robin (équitable)* / *Aléatoire* / *Moins utilisé*.
- Modale « **Sélectionner un membre** » (`max-w-md p-0`) : liste des membres (avatar `w-9 h-9`, nom, email) + badges à droite : logo LinkedIn ✓ (`border-linkedin/20 bg-linkedin/5`), `Mail` ✓, « **Aucun compte** » (`AlertCircle`), badge « **Ajouté** ». Membres sans compte désactivés (`opacity-40 cursor-not-allowed`). Vide : « **Aucun membre trouvé** ». Pied conditionnel : « Les membres grisés doivent connecter leur compte LinkedIn ou Email dans les paramètres. » Toast « Ce membre n'a aucun compte LinkedIn ou email connecté ». Limite par défaut 50/jour.

#### `VariableInserter.tsx`
Bouton `ghost sm h-6 px-2 text-xs` « `{}` **Variables** ». Menu `w-64` avec groupes et exemples (`code` + label + exemple italique) :
- **Candidat** : `{{first_name}}` Prénom (Marie) · `{{last_name}}` Nom (Dupont) · `{{company}}` Entreprise (Acme Corp) · `{{job_title}}` Poste (CTO) · `{{city}}` Ville (Paris)
- **Recruteur** : `{{sender_name}}` Votre nom (Jean Martin) · `{{calendly_link}}` Lien Calendly
- **Email** (si step email) : `{{signature}}` Signature email
- **IA** : `{{ai_snippet}}` Passage IA (« (personnalisé à l'envoi) »)

#### `conditionTypes.ts` — options du select Condition
`always` **Toujours exécuter** · `if_connected` **Si connecté** · `if_not_connected` **Si non connecté** · `if_no_response` **Si pas de réponse** · `if_email_opened` **📧 Si email ouvert** · `if_email_not_opened` **📧 Si email PAS ouvert** · `if_link_clicked` **🔗 Si lien cliqué** · `if_link_not_clicked` **🔗 Si lien PAS cliqué** · `if_has_email` **📬 Si a un email** · `if_no_email` **📬 Si pas d'email** · `if_has_phone` **📞 Si a un téléphone** · `if_no_phone` **📞 Si pas de téléphone** · `if_bounced` **⚠️ Si email bouncé** · `if_unsubscribed` **🚫 Si désinscrit** · `if_score_above` **⭐ Si score au-dessus de...**
Filtrage par canal : LinkedIn = commun + connecté/non connecté/pas de réponse ; Email = commun + engagement + bounce/désinscription ; WhatsApp = commun seulement ; branch = tout.

#### Mode Visuel — `VisualSequenceEditor` + `WorkflowCanvas`
- Conteneur `flex-col sm:flex-row h-[400px] sm:h-[560px] border rounded-lg`. Gauche : canvas ReactFlow (`Workflow` + « **{n} étape(s)** » en en-tête). Droite : panneau `w-full sm:w-[300px]` titré « **Configuration** » / « **Ajouter une étape** » / « **Ajouter (1er degré)** » / « **Ajouter (2e/3e degré)** » + bouton `X`.
- Picker : contexte de branche (« **Connecté (1er degré)** » vert / « **Non connecté (2e/3e)** » orange), sections **ACTIONS** / **TRIGGERS**, lignes `px-3 py-2.5 rounded-md hover:bg-muted/60` avec pastille `w-7 h-7 rounded-md` + label + description + `ChevronRight`.
- Vide : rond `w-10 h-10 bg-muted/50` + « **Sélectionnez une étape** ».
- **Catalogue divergent** : Invitation LinkedIn (« Demande de connexion », vert) · InMail (« InMail payant », bleu) · Email (violet) · Visite de profil (« Visiter le profil ») · **Message direct** (« Si connecté », orange) · **Smart Message** (« Personnalisé par IA », violet) · WhatsApp (logo, « Si numéro dispo ») ; triggers + **Branchement** (« Si/Sinon », rouge).
- Filtrage par branche : branche vraie → message / smart_message / email / profile_visit / whatsapp ; branche fausse → connection_request / inmail / email / profile_visit / whatsapp ; triggers réduits à attendre connexion / attendre réponse.
- **Nœuds** (`WorkflowStepNode`) : carte `rounded-xl border-2 px-4 py-3 min-w-[200px] max-w-[220px]` (compact `px-3 py-2.5 min-w-[150px]`), sélection `ring-2 ring-primary/40 ring-offset-2 scale-[1.03]` ; libellés courts : InMail · Invitation · Visite profil · Message · **Smart Msg** · WhatsApp · Email · **Attendre** · **Att. réponse** · **Att. visite** · Branchement · Vérifier connexion ; sur-titre « ÉTAPE {n} », badge de type de message (`getStepMessageType`), délai « 2j 3h » avec `Clock` ; bouton suppression `-top-2 -right-2 w-5 h-5 bg-destructive rounded-full` au hover.
- **Labels de branche** : pilule « **✓ Connecté** » (`bg-success`) / « **✗ Non connecté** » (`bg-warning`).
- **Bouton d'ajout** : rond `w-9 h-9 border-2 border-dashed` avec `Plus`, variantes vert/orange/neutre.
- Arêtes : `EDGE_DEFAULT = hsl(var(--border))`, `EDGE_TRUE = hsl(152,68%,46%)`, `EDGE_FALSE = hsl(25,95%,53%)` (**HSL en dur**), pointillés `5 5` vers les boutons d'ajout. Constantes de layout : NODE_W 210, NODE_H 72, V_GAP 52, BRANCH_GAP 280.

#### `StepEditor.tsx` (panneau du mode visuel)
Formulaire parallèle à celui du mode Liste, **avec des libellés différents** : badge `trigger`/`action` (minuscules) · « Étape {n} · {type de message} » · sections **Délai** (Jours/Heures/**Min**) · Collapsible « **Créneau d'envoi** » avec `Select` d'heures (`0h`…`23h`) « **Pas avant** » / « **Pas après** » (vs deux inputs number côté Liste) · **Condition d'exécution** (« ⚠️ Condition email uniquement ») · **Étape suivante** (`Automatique (ordre)` / `Fin de séquence` / liste ; aide « Vers quelle étape aller après celle-ci ») — **absent du mode Liste** · **Trigger** (« Timeout (j) », « Si timeout » : *Passer à la suivante* / *Étape alternative* / *Terminer*) · **Branchement** check_connection (pastilles vertes/oranges « Si connecté » / « Si non connecté ») · **Branchement** condition_branch (Condition, Seuil, « Si faux ») · Message (toggle « Personnalisation IA » avec `Sparkles text-purple-500`, « **Ton** », « Message généré au moment de l'envoi, basé sur le profil et le brief. », Objet/Message + compteur 300, bloc email CC/BCC, « **Désinscription** », « **Signature** »). **Pas d'aperçu des variables ici.**

#### `messageTypeUtils.ts` — badges de type de message
**Invitation (pas de note)** / *Invitation* · **WhatsApp initial** / *WhatsApp* · **WhatsApp relance** / *WA relance* · **InMail initial (formel)** · **InMail relance** · **Premier message (accroche)** / *1er message* · **Suite invitation (merci + pitch)** / *Post-connexion* · **Relance 1** · **Relance 2**.

#### `ABTestResults.tsx`
Tableau `text-xs` sous en-tête « **RÉSULTATS A/B TEST** » : colonnes **Variante / Envoyés / Ouverts / Cliqués / Réponses / Taux rép.**, badge « ⭐ **Gagnant** » sur le meilleur taux de réponse.

### 2.5 `SequenceEnrollButton.tsx`
Bouton `outline sm h-7 px-2.5 rounded-lg` vert (`border-2 border-success/70 text-success bg-success/10`) : `GitBranch` + « **Séquence** » + `ChevronDown` ; `title="Inscrire dans une séquence d'outreach"`. Masqué si aucune sélection.
Menu `w-64 z-[9999]` :
- **Paywall** : `<UpgradePrompt title="Séquences" description="L'envoi de séquences nécessite un abonnement. Passez à un plan payant pour inscrire des candidats." />`.
- Loading : `Loader2`.
- Vide : « **Aucune séquence active** » + bouton `outline` « **+ Créer une séquence** ».
- Sinon : en-tête « **Inscrire {n} candidat(s) dans:** » + items (`GitBranch` vert + nom + badge « {n} étapes ») + « **+ Nouvelle séquence** ».
Garde-fous : toast « Impossible de charger les étapes de la séquence — réessaie. » et « Cette séquence ne contient aucune étape — ajoute au moins une étape avant d'inscrire des candidats. » (évite les enrollments dormants).

### 2.6 `SequenceEnrollModal.tsx` (voie sans message)
Redirige vers `EnrollmentPreviewModal` dès qu'une étape a un `message_template` non vide.
Dialog `max-w-lg max-h-[90vh]` : titre `GitBranch` + « **INSCRIRE DANS LA SÉQUENCE** » (uppercase), description « Ajouter les candidats sélectionnés à "{séquence}" ».
- Encart résumé (`p-4 bg-muted/50 border`) : `Users` + « **{n} / {total} candidat(s) à inscrire** » + badge du poste + « **Séquence de {n} étape(s)** ».
- **Avertissement compatibilité** (`border-warning/40 bg-warning/5`) : « **{n} profil(s) incompatibles avec cette séquence** » / « **{n} profil(s) avec un avertissement** » + liste (5 max, puis « … et {n} autre(s) ») + case à cocher « **Exclure les profils incompatibles ({n})** » (cochée par défaut).
- **Anti-doublon organisation (90 j)** : indicateur « ⟳ **Vérification des contacts récents de l'organisation** » ; puis « **{n} candidat(s) déjà contacté(s) par votre organisation ces {RECENT_CONTACT_WINDOW_DAYS} derniers jours** » + liste « {nom} : {label} » ; case « **Inscrire quand même ({n})** » réservée aux admins, sinon « Exclus de l'inscription. Seuls les propriétaires et administrateurs peuvent les inscrire quand même. » Toast d'échec : « Vérification des contacts récents impossible » / « Les candidats déjà contactés ne seront pas signalés. »
- `ScrollArea h-[200px] sm:h-[240px]` : lignes profil (photo ronde 40 px ou initiale, nom, headline).
- Résultats : « ✓ **{n} inscrit(s) avec succès** », « **{n} déjà inscrit(s)** », erreurs en rouge.
- Footer : [**Annuler** / **Fermer**] [**Inscrire {n} candidat(s)** (`GitBranch`) / « **Inscription...** »].
- Toasts : « Organisation non détectée » / « Recharge la page ou reconnecte-toi. », « Aucun profil compatible avec cette séquence », « Tous les candidats ont déjà été contactés récemment par votre organisation », « {n} candidat(s) inscrits dans la séquence », « {n} candidat(s) déjà inscrits », « **Inscriptions créées mais étapes non planifiées** » / « Lance "Traiter les séquences" depuis Outreach pour relancer. », « Erreur lors de l'inscription ».
- Planification locale (`calculateScheduledTime`) : respecte `preferred_hour_start/end`, saute samedi/dimanche, jitter ±5 min + 0-15 min.

### 2.7 `EnrollmentPreviewModal.tsx` — préparation d'inscription
Plein écran `fixed inset-0 z-[4000]` (portal), animation d'ouverture `opacity 0→1 / 0.18 s`.

**Header** (`h-14 sm:h-16 px-4 sm:px-6`) : bouton fermer rond `h-9 w-9 rounded-full border` (`aria-label="Fermer"`) · sur-titre « **INSCRIPTION EN SÉQUENCE** » (`hidden sm:block`) · `h2 font-display` nom de la séquence · « **{n} candidat(s) · {n} étape(s)** » · toggle pill **Résumé** / **Previews** (`bg-muted/40 p-0.5 rounded-full border`).

**`DynamicSummaryBanner`** (mode preview, multi-candidats) — pills `Pill` : « **{actifs}** / {total} candidat(s) ({n} retiré(s) · {n} passé(s)) » · « **tous avec email** » (success) ou « **{n} sans email** » (warning) · « **{n} sans tél** » · « **{gen}/{total}** previews · ~{n} cr » (variant `ai` avec gradient skalr, `pulse` en cours, `success` quand complet).

**Bandeau anti-doublon** (même wording que ci-dessus, `border-warning/40 bg-warning/5 px-4 sm:px-6 py-2.5`).

**Mode Résumé (`SummaryMode`, `max-w-xl mx-auto p-6 sm:p-8`)** :
- Hero : carré `w-14 h-14 rounded-xl konekt-skalr-bg konekt-shine` + `GitBranch` blanc (spring scale/rotate) ; sur-titre « **RÉCAPITULATIF** » ; `h3 font-display text-xl` « **Avant d'enrôler** » ; « **{n}** candidat(s) sélectionné(s) pour **{n} étapes** de séquence ».
- `SummaryRow` : « **Candidats avec LinkedIn** », « **Avec email** », encarts warning « **Sans email (steps email skippés)** » + `BulkEnrichButton` + « Enrichissez maintenant pour que ces candidats reçoivent les emails de la séquence. Sans enrichment, leurs steps email seront skippés silencieusement. » ; « **Sans téléphone (steps WhatsApp skippés)** » + « Enrichissez avec téléphone (10 cr/profil) pour que les steps WhatsApp partent. »
- Bloc « **Séquence — {n} étapes** » : 6 lignes « #1 {icône} {label} ✨ +2j 3h » puis « **+{n} autres étapes** ».
- Encart crédits (`bg-brand-purple/5 border-brand-purple/20 rounded-xl`) : « Estimation : **~{n} crédits IA** (personnalisation | génération) ».
- Footer 3 niveaux : bouton pleine largeur « 👁 **Ouvrir la préparation des previews** » (outline `rounded-full h-10`) ; puis [**Annuler** ghost] [**Shortlister sans message** outline `ListChecks`] [**Enrôler {n} candidat(s)** — `konekt-skalr-bg konekt-shine konekt-glow rounded-full h-10 text-white font-bold`, état « **Inscription en cours…** »].

**Mode Previews** :
- Onglets mobile : « **Candidats ({n})** » / « **Aperçu** » (soulignés `border-b-2 border-primary`).
- **Sidebar candidats** (`w-full sm:w-72 border-r bg-muted/10`) : en-tête « **CANDIDATS** » + « {filtrés} / {total} » ; recherche pill `h-8 rounded-full` placeholder « **Rechercher…** » ; pagination `pageSize=10` avec `‹ 1-10 / 42 ›`.
  - **`CandidateSidebarCard`** : `px-3 py-2.5 rounded-xl border`, sélection `bg-foreground/[0.04] border-foreground/20` + barre latérale `w-0.5 bg-foreground` ; avatar `w-9 h-9` + pastille verte `Check` si tous les messages générés (`title="Tous les messages générés"`) ; nom (barré si passé) + badge « **Passé** » + icône `Pencil` (`title="Édité manuellement"`) ; headline en 2 lignes (`-webkit-line-clamp:2`) ; méta : 📍 ville, 💼 « {n}ans », pastille de score colorée (≥70 vert / ≥50 orange / sinon gris) ; **badges canaux** `h-5 w-5 rounded border` (Mail lucide, logos LinkedIn/WhatsApp grisés+`grayscale` si indisponibles) avec tooltips « Email disponible » / « **Pas d'email — étapes Email skippées** » / « Pas de profil LinkedIn » / « **Pas de téléphone — étapes WhatsApp skippées** ».
  - Menu `MoreVertical` (`w-48`) : **Retirer de la sélection** · **Passer** / **Réintégrer** · **Voir le scoring** · **Voir l'historique** · **Ouvrir LinkedIn**.
  - Toast de retrait : « **{nom} retiré de la sélection** » avec action « **Annuler** ».
- **Barre de génération groupée** (`px-4 py-2.5 border-b bg-gradient-to-r from-brand-purple/[0.04] via-brand-pink/[0.03]`) : bouton `motion.button h-8 px-4 rounded-full konekt-skalr-bg konekt-shine text-white` « ✨ **Générer toutes les previews** » + « **~{n} cr** » ; en cours : `Progress h-1.5` + « {gen}/{total} » + bouton texte « **Annuler** ».
- **`CandidateContextHeader`** (`rounded-2xl border bg-gradient-to-br from-card to-muted/20 p-5 sm:p-6`) : avatar XL 64/80 px + pastille verte pulsée « Open to Work » ; `h2 font-display text-[20px]/[22px]` ; headline `line-clamp-2` ; **anneau de score SVG** 56 px animé (vert ≥70 / orange ≥50 / rouge) + `recommendation` en majuscules ; méta 📍 ville, 💼 « **{n}** ans XP », chip « Email », chip « Open to Work » ; sections **PARCOURS** (« A → B → C (n postes) ») et **FORMATION** ; tags compétences (6 max, `rounded-full bg-foreground/5`) ; collapsible « **Historique des interactions** » → « **Historique ({n} interactions)** » avec timeline `dd MMM · titre — détail`.
- **`SequenceTreeView`** — arborescence :
  - Chip initial cliquable : « ⏱ **démarre immédiatement** » / « **démarre dans 2j 3h** » + `Pencil`.
  - `ActionCard` non-message : carré `h-9 w-9 rounded-lg bg-emerald-500/15` + label + « **Étape {n}** ».
  - **Connecteur** : deux filets + `ArrowDown` + pill de délai cliquable « **+2j 3h** » / « **immédiat** » (violet `bg-brand-purple/10 border-brand-purple/30 font-semibold` si surchargé), `title` = « Délai modifié pour cette inscription (défaut : +1j) ».
  - **DecisionFork** : losange `rotate-45` `bg-brand-purple/15` dans une carte `border-2 border-dashed border-brand-purple/40` ; « **DÉCISION · ÉTAPE {n}** » + label + description contextuelle (« Attend que le candidat accepte la demande de connexion » / « Attend une réponse au message précédent » / « Attend que le candidat visite ton profil » / « Vérifie si une connexion existe déjà » / « Branchement conditionnel ») ; **TimeoutEditor** pill « ⏱ **Timeout : 3 jours** » + `Pencil`.
  - Fork CSS 2 colonnes avec en-têtes pills : `wait_connection` → « **si accepté** » / « **si timeout** » ; `wait_reply` → « **pas de réponse** » / « **si réponse** » ; `wait_profile_visit` → « **si visite** » / « **sinon** » ; `check_connection` → « **connecté** » / « **pas connecté** » ; `condition_branch` → « **oui** » / « **non** ».
  - Placeholders de branche : « Si le candidat n'accepte pas, la séquence passe à l'InMail de fallback. » (warning) · « Le candidat a répondu : la séquence s'arrête, conversation ouverte. » (success) · « Si le candidat ne visite pas, la séquence continue normalement. » · « Si pas connecté, le step suivant est skippé ou l'InMail est utilisé. » · « Branche alternative non définie dans cette séquence. »
  - `FallbackHint` : « ⓘ Utilisé uniquement si le candidat n'accepte pas la connexion dans le délai ».
  - **Popover DelayEditor** (`w-72 p-4`) : titre « **DÉLAI AVANT CE STEP** » / « **Délai avant le premier step** » + « Modifie le délai pour **cette inscription uniquement**. Le template de la séquence n'est pas modifié. » ; inputs **Jours** (0-90) / **Heures** (0-23) ; rappel « Défaut séquence : **1j 0h** » ; [**Réinitialiser** `RotateCcw`] [Annuler] [**Appliquer**].
  - **Popover TimeoutEditor** : « **TIMEOUT** » + « Nombre de jours d'attente avant de basculer sur la branche alternative (ex : InMail si l'invitation n'est pas acceptée). » ; **Jours d'attente** (1-90) ; mêmes actions.
- **`MessageStepCard`** : pastille numérotée sur le rail (`-left-22/-26`, active = `bg-foreground text-background shadow-md`) ; carte `rounded-xl border bg-card` ; en-tête `bg-muted/20` : pastille canal `h-7 w-7 rounded-lg` + label + badge « ✨ **IA** » (`bg-brand-purple/10`) + badge « **MODIFIÉ** » (`bg-warning/10`) + boutons `RefreshCw` (`title="Régénérer ce step"`) et `Pencil` (`title="Voir"/"Modifier"`, actif = `bg-foreground text-background`).
  - Génération : 4 `Skeleton`. Erreur : encart `bg-warning/10 border-warning/30` avec « **Impossible de générer — le message template sera utilisé tel quel** ».
  - Email : sur-titres « **OBJET** » / « **MESSAGE** » ; édition via `Input` et `AiTextarea` (placeholder « **Tape /ai pour générer ou améliorer le message** », `min-h-[140px]`).
  - « ✨ **POINTS DE PERSONNALISATION** » : lignes numérotées `bg-brand-purple/[0.04] border-brand-purple/15`.
  - Non généré : bouton `w-full py-5 border-2 border-dashed` « ✨ **Générer la preview de ce step** » + « **~2 crédits** ».
- **Raccourcis clavier** : ↑/↓ navigation candidats, `Suppr`/`x` retirer, `Espace` passer, `Entrée` générer.
- **Barre inférieure** : [**Annuler**] [**Shortlister sans message**] [**Enrôler {n} candidat(s)**].
- **Écran de résultats** (`EnrollmentResults`) : rond `w-20 h-20 bg-success/10 border-2 border-success/30` + `CheckCircle` (spring) ; « **Inscription terminée** » ; « ✓ {n} candidat(s) inscrit(s) » ; « {n} déjà inscrit(s) » ; encart d'erreurs ; bouton **Fermer** (skalr).
- **Fallback panneau** : « **Aucun candidat sélectionné.** » ou squelettes.
- Toasts : « Organisation non résolue — recharge la page et réessaie. », « Aucun candidat à inscrire », « Tous les candidats ont déjà été contactés récemment par votre organisation », « {n} candidat(s) inscrits dans la séquence », « {n} candidat(s) déjà inscrits », « Erreur lors de l'inscription », « Aucun poste associé pour la shortlist », « **{n} candidat(s) ajouté(s) à la shortlist** », « Erreur lors de l'ajout à la shortlist ». Erreur par candidat : « {nom}: planification impossible ({message}) » (l'enrollment est alors supprimé).
- **Génération jamais automatique** (retrait volontaire 2026-05-05, pour ne pas brûler des crédits).

### 2.8 `SequenceEnrollmentsPanel.tsx` — inscriptions d'une séquence
`Sheet` droite `w-full sm:w-[500px]`. Titre : carré `h-7 w-7 bg-foreground text-background` + `Users` + nom de la séquence (uppercase).
- **Bandeau actions en attente** : `AlertCircle` + « **{n} action(s) en attente** » + bouton « ⚡ **TRAITER MAINTENANT** » (`bg-foreground text-background uppercase tracking-wider h-8 px-4`). Toasts : « **{n} action(s) avancée(s) — elles partent dans la minute qui vient.** » / « **Aucune action à avancer : tout est déjà en file ou terminé.** » / « Erreur : … » / « Erreur réseau lors du traitement ».
- **Stats** : grille 3 cellules bordées — **ACTIFS** / **EN PAUSE** / **TERMINÉS** (`text-xl font-bold` + label `uppercase tracking-wider`).
- **Action groupée** : bouton pleine largeur `border-destructive text-destructive uppercase` « ⏹ **Arrêter toutes les séquences actives ({n})** ».
- Recherche : `Input h-8 pl-8 text-xs`, placeholder « **Rechercher un candidat…** ».
- Liste `h-[calc(100vh-340px)] overflow-y-auto` :
  - Loading : `BrutalLoader compact` messages ['Chargement des inscriptions…','Récupération des étapes…','Synchronisation…'].
  - Vide : « **Aucun candidat inscrit** » ; recherche vide : « **Aucun résultat pour « {q} »** ».
  - Ligne (Collapsible `border`) : chevron, nom (`font-medium`), lien `ExternalLink` vers LinkedIn, headline, **badge statut** (`rounded-full`) :
    - active « **Active** » `bg-info text-info-foreground` · paused « **En pause** » / « **En pause (compte déconnecté)** » / « **En pause (limite atteinte)** » / « **En pause (abonnement requis)** » `bg-warning` · completed « **Terminée** » `bg-success` · replied « **Répondu** » `bg-purple-500 text-white` · cancelled « **Annulée** » `bg-muted` · booked « **RDV pris** » `bg-success`.
    - Timing : « ✓ 12/03 à 09:15 » (vert) et « → **{action}** le 14/03 à 10:00 » (bleu), fallback « {n} étape(s) ».
  - Menu `MoreHorizontal` (`Button outline icon h-8 w-8`, `aria-label="Actions de l'inscription"`) : **Arrêter la séquence** (`StopCircle`, si active) · **Reprendre la séquence** (`Play`, si en pause) · **Marquer comme répondu** (`CheckCircle2`) · **Ré-enrôler** (`RefreshCw`) · **Voir sur LinkedIn**.
  - **Contenu déplié = timeline complète du workflow** (`bg-muted p-3`) : « **WORKFLOW :** » puis, pour chaque étape non masquée, carré `w-7 h-7` coloré + label + badge de statut d'exécution :
    pending « **À venir** » (`border-dashed`) · scheduled « **Planifié** » · executed « **Exécuté** » · sent « **Envoyé** » · skipped « **Ignoré** » · failed « **Échoué** » · cancelled « **Annulé** ».
    Détails : « Prévu : 14/03 10:00 » + lien souligné « **Sauter** » (`title="Sauter cette étape pour ce candidat"`) ; « ✓ 12/03 09:15 » ; « **Étape {n} skippée — canal indisponible** » (avec ⏭️, italique, `opacity-60`) ou la raison brute ; encart « **Erreur :** {formatSequenceError(...)} » ; aperçu du message envoyé (objet + 120 caractères) ; template en italique pour les étapes à venir (« « … » »).
  - Pagination : bouton « **Charger plus ({n} / {total})** » / « Chargement… » ; fin : « **Tous les candidats chargés ({n})** ».
- **AlertDialog unique** (titres/descriptions/CTA selon l'action) :
  - « **Arrêter la séquence** » — « Le candidat ne recevra plus de messages de cette séquence. » / [**Confirmer**]
  - « **Arrêter toutes les séquences actives ({n})** » — « Les {n} candidat(s) actif(s) ne recevront plus de messages de cette séquence. »
  - « **Marquer comme répondu** » — « L'enrollment passera en "Répondu" et toutes les étapes restantes seront annulées. Utile si le candidat a répondu hors de Konekt (téléphone, en personne, etc.). » / [**Marquer répondu**]
  - « **Ré-enrôler ce candidat** » — « Le candidat repassera en statut actif. La prochaine étape pending sera reschedulée à maintenant. Utile pour relancer un candidat après une réponse résolue. » / [**Ré-enrôler**]
  - « **Sauter cette étape ?** » — « Cette étape ne sera pas envoyée pour ce candidat. La séquence passera directement à l'étape suivante. » / [**Sauter l'étape**]
- Toasts : « Séquence arrêtée », « Séquence reprise », « {n} séquence(s) arrêtée(s) », « **Candidat ré-enrôlé** » / « La prochaine étape part dans les prochaines minutes. », « **Étape sautée** » / « La séquence passe à l'étape suivante. », « **Marqué comme répondu** » / « Les étapes restantes ont été annulées. », « Erreur lors de l'arrêt / de la reprise / de l'arrêt groupé / du ré-enrôlement / du saut d'étape / du marquage / du chargement ».
- `skip_reason` écrits : « Arrêt manuel », « Arrêt groupé », « Réponse marquée manuellement », « Stoppé depuis Inbox » (MessageView), « Annulé manuellement » (ActivityLog).

### 2.9 `CandidateSequencesPanel.tsx` (vue candidat)
En-tête « **Séquences ({n})** » ; carte par inscription : carré `h-9 w-9 rounded-lg bg-emerald-500/15` + `GitBranch`, nom de la séquence, badge statut (**En cours** / **En pause** (+ raison) / **Répondu** / **Terminé** / **Stoppé**), 💼 poste, **barre de progression** `h-1.5 rounded-full` + « {envoyés}/{total} », « ⏱ **Prochaine action : {label}** — dans 2 jours », « Répondu il y a 3 jours ».
Boutons : **Arrêter** (`StopCircle`) / **Reprendre** (`Play`), menu (`w-52`) : **Voir la timeline** / **Réduire**, **Marquer comme répondu**.
Timeline dépliée : « **TIMELINE ({n} ACTIONS)** » ; lignes numérotées avec label d'action + statut (**Envoyé** / **Programmé** / **En cours d'envoi** / **Échoué** / **Skippé** / **Annulé** / **En attente** / **Quota atteint**), date relative (« Envoyé il y a 2 jours » / « Prévu dans 3 heures »), « **Objet :** … », extrait du message (200 car.), « ⚠ {erreur formatée} », « *Raison : {skip_reason}* ».
Pied replié : « **Voir la timeline ({n} étapes)** ».
AlertDialogs : « **Arrêter cette séquence ?** » — « Toutes les actions programmées (messages, relances, InMails) seront annulées. Tu pourras reprendre la séquence plus tard depuis le step courant. » ; « **Marquer comme répondu ?** » — « La séquence sera arrêtée et marquée comme "Répondu". Utile si tu prends la conversation à la main ou si la réponse est venue hors LinkedIn. »

### 2.10 `SequenceActivityLog.tsx` — Journal
`Sheet` droite `w-full sm:w-[600px] p-0`. Titre `Activity` + « **Journal d'activité** ».
- **Stats** (4 cellules bordées) : **À venir** (bleu) · **En retard** (`bg-amber-400/10`, rouge) · **Envoyés** (vert) · **Échoués** (rouge).
- **Filtres** : recherche « **Rechercher...** » ; `Select` statut (**Tous / Planifiés / Envoyés / Échoués / Ignorés**) ; `Select` période (**Tout / Aujourd'hui / 7 derniers jours / À venir**) ; bouton `RefreshCw` (`aria-label="Rafraîchir les activités"`).
- Liste groupée par date : en-tête « 📅 **AUJOURD'HUI / HIER / DEMAIN / lundi 12 mars** » + filet + « {n} action(s) ».
- Item (Collapsible, `border rounded-lg`, `border-warning bg-warning/5` si en retard, `border-destructive bg-destructive/5` si échec) : carré `w-9 h-9 rounded-lg` coloré + nom du candidat + `ExternalLink` + badge de statut (**Planifié / Envoyé / Ignoré / Échoué / Annulé / Répondu**) ; sous-ligne « {action} · {séquence} · {HH:mm} ».
- Déplié : encart « **Erreur** » / « **Raison** » (`bg-destructive/10`) avec `formatSequenceError` ; aperçu du message (« **Objet :** … » + corps) ; actions si planifié : [**Modifier** `Pencil`] [**Annuler** `Ban`, `text-destructive`, « Annulation... »] ; métadonnées « ⏱ Planifié : 14/03 10:00 » / « ✓ Exécuté : 12/03 09:15 ».
- AlertDialog : « **Annuler cette étape ?** » — « L'envoi prévu pour **{candidat}** sera annulé. Cette action est irréversible — l'étape ne partira plus. » / [**Conserver l'envoi**] [**Annuler l'étape**].
- Toasts : « Action annulée », « **Cette action est déjà en cours d'envoi ou traitée — annulation impossible.** », « Erreur lors de l'annulation », « Erreur lors du chargement ».
- Types d'action affichés : **Visite profil / Invitation / Message / InMail / Smart Message** (les `wait_*` et `check_connection` sont masqués).

### 2.11 `EditScheduledMessageModal.tsx`
Dialog `sm:max-w-[550px]`, titre `Save text-blue-600` + « **Modifier le message planifié** ».
Encart destinataire (`bg-muted/50 rounded-lg`) : nom + « 📅 lundi 12 mars » + « ⏱ 10:00 ».
Champs : **Objet** (InMail uniquement, placeholder « Objet de l'InMail... ») · **Message** (`Textarea rows=8 resize-none`, placeholder « Contenu du message... ») + aide « **Les variables comme {firstName} seront remplacées automatiquement.** » (**syntaxe fausse : simple accolade et camelCase**).
Footer : [Annuler] [**Enregistrer** / « Enregistrement... »].
Toasts : « Le message ne peut pas être vide », « L'objet ne peut pas être vide pour un InMail », « Message mis à jour », « **Ce message est déjà en cours d'envoi ou envoyé — modification impossible.** », « Erreur lors de la mise à jour ».

### 2.12 `SequenceDiagnostic.tsx`
`Sheet` droite `sm:max-w-md`. Titre « **Diagnostic séquences** » + « État de santé du pipeline d'envoi (cette mission) / (toutes missions) ».
- Bouton **Actualiser** (`outline w-full`).
- **Carte heartbeat** (`p-4 rounded-xl`) : « **Pipeline actif** » (vert) / « **Pipeline silencieux** » (rouge) ; « Dernière exécution cron il y a 2 minutes » ou « **Aucune exécution cron enregistrée. Vérifie que pg_cron est branché.** » ; « ⚠ Plus de 5 min sans run — le cron est probablement gelé » ; « {n} erreur(s) cumulées · dernier run: {status} » ; « Dernier message envoyé il y a 1 heure ».
- **Quota invitations LinkedIn** : « {n} / 100 » + barre (`bg-success` / `bg-warning` ≥80 % / `bg-destructive` ≥95 %) + « Glissant 7 jours · LinkedIn limite ~100/semaine pour éviter le ban » + « ⚠ **Quota presque épuisé — les nouvelles invitations seront rejetées** » / « Attention : tu approches la limite hebdo ».
- **Stats 24 h** (grille 2×2) : **Envoyées 24h** / **Échecs 24h** / **En attente** / **Inscrits actifs**.
- **Erreurs récentes ({n})** : liste des messages via `formatSequenceError` + date relative.
- Bouton **Forcer un cycle maintenant** (`Zap`, « Exécution en cours… ») + « Lance immédiatement `process-sequences` sans attendre le cron (≤1 min). »
- Aide : « **Comment lire ce diagnostic ?** » — « Pipeline actif = cron a tourné dans les 10 dernières min » (**incohérent avec le seuil réel de 5 min**) · « En attente = étapes prévues dont l'heure n'est pas encore arrivée » · « Échecs 24h > 0 = vérifie les erreurs ci-dessus, souvent un compte LinkedIn déconnecté ».
- Toasts : « Erreur de chargement du diagnostic », « Erreur lors du déclenchement ».

### 2.13 `SequenceAnalytics.tsx`
`Sheet` droite `w-full sm:w-[580px] p-0`, header `bg-accent`, titre « **ANALYTICS — {nom}** » / « **ANALYTICS GLOBALES** ».
- Filtres : `Select` séquence (« Toutes les séquences »), `Select` période (**7 jours / 30 jours / 90 jours / Personnalisé**) + deux `input type="date"` (`aria-label` « Date de début » / « Date de fin »), bouton `RefreshCw`.
- **KPI strip** (cellules `min-w-[80px] flex-1 border -ml-px`) : **Visites** · **Invitations** (+ « {x}% taux ») · **Messages** (+ « {x}% taux ») · **Réponses** · **Prospects** · **Moy. rép.**
- **Funnel de conversion** : barres horizontales `h-6 bg-foreground` + `ArrowDown` et « {x}% » entre étages.
- **Répartition prospects** : barre empilée `h-3` (opacité 0.3 « Annulés », 0.5 « Pause ») + légende chiffrée.
- **Activité quotidienne** : `BarChart` recharts (Invitations / Messages / Réponses) + `LegendDot` (**bug : `LegendDot` « Réponses » utilise `bg-accent` alors que la barre est `--primary`**).
- Vide : `BarChart3 w-10 h-10` + « **AUCUNE DONNÉE** » + « Les analytics seront alimentées à mesure que les séquences s'exécutent. »
- `ABTestResults` si résultats.
- **Performance par étape** : lignes « Étape {n} | {action_type sans underscore} | **{n}** envoyé(s) · **{n}** réponse(s) | **{x}%** » + légende « Taux de réponse par étape — colore en vert si ≥20%, orange si ≥10%, gris sinon. »
- **Note structurelle** : les blocs A/B et « Performance par étape » sont **hors du ternaire de chargement** — ils s'affichent pendant le spinner.

---

## 3. INVITATIONS LINKEDIN — `InvitationsPanel.tsx`
Carte `border bg-background`.
- **Header** : carré `h-8 w-8 bg-foreground text-background` + `UserPlus` ; `h2` « **Invitations reçues** » ; badge compteur rond (« ... » pendant le chargement) ; `Select` de compte (`hidden sm:flex w-[140px]`, dupliqué en pleine largeur sur mobile) ; bouton `RefreshCw` (`h-8 w-8`, sans `aria-label`).
- **Progression batch** : « **Batch en cours** » + « {done}/{total} » + `Progress h-1.5`.
- **Toolbar** : `Checkbox` « Tout » / « Désélectionner » + « {n}/{total} » ; boutons **Accepter** (`variant="default"`, `Check`) et **Décliner** (`variant="destructive"`, `X`) — libellés `hidden sm:inline`.
- **Liste** (`max-h-[60vh]`) : skeletons 4 lignes ; vide → carré `h-14 w-14` + « **Aucune invitation** » + « Rafraîchissez pour récupérer les nouvelles demandes. ».
- **Ligne** (`article border p-3`) : checkbox + photo carrée `h-9 w-9` (ou initiales) liée au profil + nom (`hover:underline` + `ExternalLink`) + description + date relative ; boutons inline **OK** (`default`, `Check`, libellé masqué sous `sm`) et un bouton `X` **sans libellé ni `aria-label`** ; message d'invitation en citation `border-l-2 bg-muted/10 italic line-clamp-2`.
- **Charger plus** : « **Plus d'invitations** » / « Chargement... ».
- **AlertDialog** : « **Accepter / Décliner {n} invitation(s) ?** » — « Les invitations sélectionnées seront acceptées. » / « … seront refusées. Cette action est irréversible. » + encart `border-warning/30 bg-warning/10` : « ⏱ **Pourquoi c'est lent ?** » / « Pour protéger votre compte LinkedIn, chaque invitation est traitée individuellement avec un **délai de ~1.5 seconde** entre chaque action. LinkedIn détecte et bloque les actions trop rapides. » / « Estimation : ~{n} secondes pour {n} invitation(s). » ; [Annuler] [**Confirmer l'acceptation** / **Confirmer le refus**].

---

## 4. INMAILS & GÉNÉRATION IA

### 4.1 `BulkInMailModal.tsx`
Dialog `max-w-2xl max-h-[85vh] p-0`.
- **Header** : carré `w-8 h-8 rounded-lg bg-linkedin` + `Mail` blanc ; « **InMails personnalisés** » ; « Génération IA de messages pour {n} candidat(s) ».
- **Onglets** : « **Composer ({prêts}/{total})** » (`PenLine`) / « **File d'attente ({n})** » (`Clock`).
- **Composer — sans poste** : `Sparkles w-10 h-10 opacity-30` + « **Sélectionnez un poste** » + « Pour générer des messages personnalisés, sélectionnez d'abord un poste. »
- **Composer — setup** :
  - Ligne contexte : badge poste + badge client ; **indicateur de crédits** pill (`bg-destructive/10` si insuffisant, `bg-warning/10` si proche, sinon `bg-success/10`) « ✉ **{n} crédits** » + bouton `RefreshCw` (`aria-label="Rafraîchir le solde de crédits InMail"`).
  - Erreur crédits : « **Crédits insuffisants ({n} restants, {n} requis)** ».
  - Champs : **Ton prénom (signature)** (placeholder « Ex: Marc ») ; **Ton** = 3 boutons « 👔 **Pro** » / « 😊 **Cool** » / « 🚀 **Wow** » (actif = `bg-linkedin`).
  - Bouton `w-full h-11` : « ✨ **Générer {n} messages** » / « **Génération {i}/{n}...** » / « **Crédits insuffisants** » (`bg-muted cursor-not-allowed`).
  - Barre de progression `h-1.5 bg-linkedin`.
  - Note : « **Envoi entre 8h-19h ({tz}) • Délai 2-5 min entre chaque** ».
- **Composer — édition** : navigation [**Précédent**] « **{i} / {n}** » [**Suivant**] ; fiche destinataire (nom + headline) + « ✏ **modifié** » + bouton `RefreshCw` de régénération ; champs **Objet** (placeholder « Objet du message... ») et **Message** via `InMailTextEditor` (`maxCharacters=1900`, placeholder « Le message d'approche... ») + bouton **Sauvegarder** (`Check`, vert) ; « ✨ **Points de personnalisation** » (chips) ; **points de navigation** (15 max) `w-2 h-2 rounded-full` — `bg-linkedin scale-125` actif, `bg-success` généré, `bg-muted` sinon, puis « +{n} ».
- **File d'attente** : stats 5 colonnes **Planifiés / En cours / Envoyés / Échoués / Annulés** ; items `p-3 bg-muted rounded-lg` (nom, objet, « 📅 12/03 10:00 », erreur en rouge) + badge de statut (**Planifié / Envoi... / Envoyé / Échoué / Annulé**) ; vide → `Clock w-8 h-8 opacity-40` + « **Aucun InMail en file d'attente** » ; bouton ghost `text-destructive` « **Annuler les envois en attente** » (**sans confirmation**).
- **Footer** : [**Fermer**] [**Planifier {n} InMail(s)** `bg-linkedin` / « Planification... »].
- Toasts : « Sélectionnez un poste pour générer les messages », « **{n} messages générés ! Cliquez sur chaque message pour le visualiser et modifier.** », « Message sauvegardé », « Générez d'abord les messages », « Crédits InMail insuffisants ({n} restants, {n} requis) », « {n} InMails planifiés pour envoi », « Aucun InMail en attente à annuler », « {n} InMails annulés », « Erreur lors de la planification / de l'annulation ».

### 4.2 `InMailTextEditor.tsx`
`contentEditable` avec toolbar : **Gras (Ctrl+B)** · **Italique (Ctrl+I)** · **Insérer un lien** (prompt, placeholder `https://exemple.com`) · **Liste à puces** · **Liste numérotée**. Placeholder via `data-placeholder` + `empty:before:content-[attr(data-placeholder)]`. Compteur « **{n} / 1900 caractères** », dépassement signalé (`isOverLimit`).

### 4.3 `OutreachMessageModal.tsx` (message unitaire)
Dialog `max-w-2xl max-h-[90vh] rounded-xl`.
- Header : « **Message pour {nom}** » + « {poste} · {client} ».
- **Ton** : 3 boutons `h-8 px-2.5 rounded-md border` — 👔 **Professionnel**/Pro · 💬 **Décontracté**/Cool · ⚡ **Enthousiaste** (actif = `bg-foreground text-background`).
- **Signature** : `Input w-28 h-8` placeholder « Prénom ».
- **Instructions (optionnel)** : `textarea rows=2 bg-muted/20`, placeholder « **Ex: Mentionne son article récent, propose un call mardi…** ».
- Bouton « ✨ **Générer le message** » (`flex-1 h-10 bg-foreground`) + `ModelPicker actionId="outreach_message" compact`.
- Après génération : **Objet** (placeholder « Objet du message… ») + **Message** (`InMailTextEditor`, 1900 car.) + « 💡 **Points de personnalisation** ».
- Footer : [**Envoyer** / **Envoyer InMail** — devient « **Envoyé !** » `bg-success`] [bouton **Copier** (`Copy`/`Check` « Copié »)] [bouton icône régénérer].
- Toasts : « Erreur lors de la génération du message », « Message copié ! », « Aucun compte LinkedIn sélectionné », « Impossible d'identifier le destinataire », « Le message ne peut pas être vide », « **Message envoyé !** » / « **InMail envoyé !** », « Erreur lors de l'envoi du message ».
- Effets de bord : insertion `inmail_queue` (sujet fallback « (Message direct) ») + `add-to-shortlist` avec `entity:'Konekt'`, `etape:'Contacté'`, `etat:'En attente de réponse'`.

---

## 5. COMPTES LINKEDIN, SANTÉ, QUOTAS

### 5.1 `LinkedInAccountManager.tsx`
Grille `lg:grid-cols-2`.
**Carte « COMPTES CONNECTÉS »** (logo LinkedIn + « Gérez vos comptes LinkedIn connectés ») :
- Vide : « **Aucun compte connecté** ».
- Ligne compte (`p-3 bg-muted/50 rounded-lg border`) : carré `w-10 h-10 bg-linkedin` + logo ; nom ; **état** : « ✓ **Connecté** » (`text-success`) / « ⚠ **Reconnexion requise** » (`text-orange-600`) / « ⚠ **{status brut}** » (`text-warning`) ; badges d'abonnement « **Recruiter** » (`bg-brand-purple/10 text-purple-700`) et « **Sales Nav** » (`bg-info/10 text-info`).
- Toggle manuel « **Forcer Recruiter** » (`ToggleLeft`/`ToggleRight`, `text-purple-600`) + tooltip « Si la détection automatique ne fonctionne pas, activez manuellement le mode Recruiter. Assurez-vous d'avoir connecté le cookie depuis linkedin.com/talent. » — override en `localStorage['linkedin_subscription_overrides']`. Toasts « Mode Recruiter activé manuellement » / « Mode Recruiter désactivé ».
- `ProxyConfigPanel` si `status==='OK'`.
- Actions : **Reconnecter** (`outline`, `RefreshCw`, si `CREDENTIALS`) + bouton `Trash2` (`ghost text-destructive`, spinner pendant la déconnexion). **Aucune confirmation avant déconnexion.**

**Carte « CONNECTER UN COMPTE » / « RECONNECTER LE COMPTE »** (+ bouton **Annuler**) : « Ajoutez un nouveau compte LinkedIn Recruiter » / « Reconnectez "{nom}" avec de nouveaux identifiants ».
- **Checkpoint** : encart `bg-warning/10` « **Vérification requise :** {type brut} » + aide selon le type (« Entrez le code de votre application d'authentification » / « Entrez le code reçu par email ou SMS » / « Validez la connexion dans l'app LinkedIn mobile ») ; champ « **Code de vérification** » (`maxLength=6`, placeholder `123456`) ; [Annuler] [**Vérifier** / **J'ai validé**].
- **Onglets** : 🍪 **Cookie** / 🔑 **Identifiants**.
  - Cookie : encart bleu « **Comment obtenir le cookie li_at :** » (3 étapes, dont « Ouvrez les DevTools (F12) → Application → Cookies ») ; encart violet « **Plusieurs contrats Recruiter ?** » (3 étapes) ; champ « **Cookie li_at *** » (`type=password`, placeholder `AQEDATxxxxxxx...`) ; « **User Agent (optionnel)** » (placeholder `Mozilla/5.0...`) + « Recommandé pour éviter les déconnexions » ; bouton **Connecter** (`bg-linkedin`).
  - Identifiants : encart warning « **⚠️ Attention** — Cette méthode peut déclencher des vérifications de sécurité LinkedIn. » ; **Email LinkedIn** (placeholder `votre@email.com`) ; **Mot de passe** (`••••••••`) ; **Connecter**.
- **Carte « SIGNATURE DES MESSAGES »** : « Votre prénom utilisé comme signature dans les messages d'approche et les séquences » ; champ « **Prénom (signature)** » placeholder « **Ex: Laurent** » (Entrée = enregistrer) ; bouton **Enregistrer** → « **Enregistré** » (`CheckCircle`) ; « Ce prénom sera utilisé automatiquement dans tous vos messages d'approche et séquences. » Toast « Signature mise à jour ».
- `WebhookManager` en pied.
- Toasts : « Veuillez entrer le cookie li_at », « Veuillez remplir tous les champs », « Veuillez entrer le code de vérification », « Vérification requise : {type} », « Nouvelle vérification requise : {type} », « Code invalide », « Erreur de connexion », « Erreur lors de la déconnexion ».

### 5.2 `ProxyConfigPanel.tsx`
Ligne d'état : `Globe` + badge (**Aucun proxy** / « 🇫🇷 FR » / « IP: … » / « **Custom** ») + `Wifi`/`WifiOff`. Encart d'erreur `bg-destructive/10` avec `proxy_last_error` **brut**.
`RadioGroup` horizontal : **Pays** / **IP** / **Custom**.
- Pays : `Select h-7 w-[160px]`, placeholder « **Pays proxy** », 23 pays avec drapeau (France, États-Unis, Royaume-Uni, Allemagne, Espagne, Italie, Pays-Bas, Belgique, Suisse, Canada, Portugal, Irlande, Suède, Norvège, Danemark, Autriche, Pologne, Luxembourg, Singapour, Australie, Japon, Brésil, Inde).
- IP : `Input` placeholder `192.168.1.1`.
- Custom : protocole (**HTTPS / HTTP / SOCKS5**) + `proxy.example.com` + `8080` + « User (opt.) » + « Pass (opt.) ».
- Bouton de sauvegarde = **icône `CheckCircle2` seule, sans libellé ni `aria-label`**.
- Toasts : « Sélectionnez un pays », « Entrez une adresse IP », « **Host et port requis** », « Proxy mis à jour », « Erreur lors de la mise à jour du proxy ».

### 5.3 `WebhookManager.tsx`
`Card` : « **Webhooks Temps Réel** » / « Recevez des notifications instantanées quand un candidat répond ou accepte une invitation » + bouton `RefreshCw` (`aria-label="Rafraîchir les webhooks"`).
- Bandeau : « ✓ **Tous les webhooks sont configurés** » (`text-green-700`) ou « ✗ **{n} webhook(s) manquant(s): messaging, users** » (`text-amber-700`) — **noms de sources techniques exposés**.
- Ligne : badge **Messages / Connexions / Comptes** + description (« Détecte les réponses des candidats » / « Détecte les invitations acceptées » / « Changements de statut de compte ») + « {n} compte(s) ciblé(s) » ou « Tous les comptes » + bouton `Trash2` (`aria-label="Supprimer le webhook"`, **sans confirmation**).
- Bouton **Activer les webhooks temps réel** (`bg-linkedin w-full`) / « Enregistrement... ».
- Note de pied + toasts : « Webhooks enregistrés avec succès ! », « Certains webhooks n'ont pas pu être enregistrés: {sources} », « Webhook supprimé », « Erreur lors de la récupération / de l'enregistrement / de la suppression des webhooks ».

### 5.4 `QuotaDisplay.tsx`
- **Badge « Mode protégé »** (`Shield`, `bg-success/10 text-success`, `cursor-help`) + tooltip long : « Konekt protège votre compte LinkedIn : actions uniquement aux heures ouvrées, du lundi au vendredi, dans votre fuseau ; 80 actions visibles par jour ; 100 invitations par 7 jours ; 5 à 15 secondes entre deux actions d'une séquence ; pause automatique de 16 h dès 90 % d'usage ou au premier signal de limite ; montée en charge sur trois semaines pour un compte neuf ; anti-doublon dans votre organisation. »
- **Mode compact** : pill « **Quota : {x} %** » ou « **En pause** » (`CirclePause`), seuils 70 % warning / 90 % critique ; tooltip `w-64` = « **Plafonds LinkedIn du jour** » + badge + les 5 jauges + pied.
- **Mode complet** (`bg-background border p-4`) : `h4` « **Plafonds LinkedIn du jour** » + badge + `Info` tooltip « Compteurs mesurés côté serveur pour ce compte. Les plafonds tiennent compte du palier de montée en charge et des limites définies dans vos paramètres. »
- **Jauges** (`QuotaItem` : carré 24 px + label + « {n}/{max} » + `Progress h-1.5` — `bg-linkedin` / `bg-warning` ≥80 % / `bg-destructive` ≥95 % + `AlertTriangle`) : **Actions visibles** (`Send`) · **Visites de profils** (`User`) · **Recherches** (`Search`) · **InMails** (`Mail`) · **Invitations (7 jours)** (`UserPlus`).
- **Pied** : « ⏸ **Pause en cours jusqu'à {HH:mm}** » (warning) + « ℹ {rampStageLabel} . Compteurs du jour remis à zéro à {HH:mm}. »
- Rendu `null` si pas de compte ou pas de statut (**pas d'état de chargement**).

---

## 6. Récapitulatif des états couverts

| État | Où | Traitement |
|---|---|---|
| Loading liste chats | ChatListSidebar | 6 skeletons pulse décalés |
| Loading messages | MessageView | 5 bulles fantômes asymétriques |
| Loading séquences | SequencesList | `BrutalLoader variant="sequences" rows={4}` |
| Loading inscriptions | EnrollmentsPanel | `BrutalLoader compact` + 3 messages tournants |
| Loading analytics/templates | Analytics, TemplateSelector | spinner `border-b-2` |
| Loading quotas | QuotaDisplay | **aucun (retourne `null`)** |
| Vide chats | ChatListSidebar | « Aucune conversation (trouvée) » + « Rechercher partout » |
| Vide messages | MessageView | 3 variantes (historique indisponible / sync / vide) |
| Vide séquences | SequencesList | 🔗 + pitch + CTA |
| Vide inscriptions | EnrollmentsPanel | « Aucun candidat inscrit » |
| Vide journal | ActivityLog | « Aucune activité trouvée » |
| Vide invitations | InvitationsPanel | carré + « Aucune invitation » |
| Vide file InMail | BulkInMailModal | `Clock` + « Aucun InMail en file d'attente » |
| Vide analytics | SequenceAnalytics | « AUCUNE DONNÉE » |
| Erreur analyse IA | InlineAIPanel | message + **Réessayer** |
| Erreur génération preview | EnrollmentPreviewModal | encart warning inline |
| Erreur d'envoi | EnrollmentsPanel / ActivityLog / CandidateSequencesPanel | `formatSequenceError` |
| Compte déconnecté | MessagesInbox / MissionOutreach / AccountManager / pause_reason | **4 traitements distincts** |
| Quota atteint | QuotaDisplay, Diagnostic, pause_reason `quota_reached`, exec `quota_blocked` | libellés divergents |
| Plan requis | SequenceEnrollButton (`UpgradePrompt`), SequencesList (toast + « Voir les plans »), pause_reason `subscription_required` | **3 traitements, aucun dans l'inbox** |
| Séquence en pause | « En pause », « En pause (compte déconnecté) », « En pause (limite atteinte) », « En pause (abonnement requis) » | `PAUSE_REASON_LABELS` dupliqué |

---

## 7. ANOMALIES DESIGN

### 7.1 Deux langages visuels coexistent
- **« Brutaliste »** (bordures droites, `uppercase tracking-wider`, en-têtes `bg-muted`, cellules bordées `-ml-px`, `BrutalLoader`) : `SequenceEnrollmentsPanel`, `SequenceActivityLog`, `SequenceAnalytics`, `InvitationsPanel`, `SequenceTemplateSelector`, `SequenceEnrollModal`, `MultiSenderSettings`, `StopConditionsSettings`, `LinkedInAccountManager`.
- **« Moderne »** (`rounded-xl/2xl`, `shadow-sm`, gradients, `framer-motion`, `konekt-skalr-bg`) : inbox complète, `EnrollmentPreviewModal`, `enrollment-preview/*`, `CandidateSequencesPanel`, `SequenceBuilder` (partiellement).
- `SequenceBuilder` mélange les deux : sélecteur d'étapes en `rounded-lg`, mais bloc A/B et pastilles de type en carré non arrondi.

### 7.2 Typographie
- Échelle éclatée : `text-3xs`(10 px) / `text-2xs`(11 px) / `text-xs` / `text-sm` **coexistent avec** `text-[10px] [10.5px] [11px] [11.5px] [12px] [12.5px] [13px] [13.5px] [14px] [15px] [20px] [22px]`.
- `text-[10px]` ≡ `text-3xs` et `text-[11px]` ≡ `text-2xs` sont utilisés **dans le même fichier** (`ChatListItem`, `MessageView`, `EnrollmentPreviewModal`).
- Trois traitements de titre de section : `uppercase tracking-wider text-xs font-bold`, `text-[10px] uppercase tracking-wider font-semibold`, `text-sm font-semibold`.
- `font-display` utilisé seulement dans `EnrollmentPreviewModal`, `CandidateContextHeader`, `SequenceTreeView`.

### 7.3 Radius & espacements
- `rounded-none` implicite (brutalist) vs `rounded`, `rounded-md`, `rounded-lg`, `rounded-xl`, `rounded-2xl`, `rounded-full` — sans règle. Ex. `SequenceEnrollModal` : `DialogContent rounded-lg` mais tous les encarts internes carrés.
- Hauteurs de contrôles : `h-6`, `h-7`, `h-8`, `h-9`, `h-10`, `h-11` sans échelle ; le même « bouton secondaire » est `h-7 px-2` ici, `h-8 px-3` là, `h-9 px-4` ailleurs.
- Paddings de modale : `p-0`, `p-3`, `p-4`, `px-4 sm:px-6`, `p-5`, `p-6 sm:p-8`.

### 7.4 Valeurs en dur / magic numbers
- `Inbox.tsx` : `calc(100dvh - 124px)` (64 + 50 + 10).
- Sidebar `md:w-[300px]` / `md:w-[64px]` — commentaires contradictoires (« 360px » dans `MessagesInbox`, « 240px » dans `ChatListSidebar`).
- **Z-index sans échelle** : `z-10`, `z-50` (TemplatesPicker), `z-[2100]` (conversation mobile), `z-[4000]` (SequenceBuilder, EnrollmentPreviewModal), `z-[9999]` (dropdown SequenceEnrollButton, dialog global).
- Limites dupliquées côté front : 100 invitations/semaine (`WEEKLY_INVITE_LIMIT` Diagnostic + texte QuotaDisplay), 80 actions/jour (QuotaDisplay + garde-fou Builder), `daily_limit: 50` par défaut, 1900 caractères InMail (×2), 300 caractères d'invitation (×2), 90 jours anti-doublon.
- Pagination : 200 (enrollments), 10 (candidats preview), 500 (journal), 20 (dropdown séquences), 30 (messages résumés), 12 (historique CTA), 15 (points de navigation InMail), 6 (aperçu d'étapes).
- Timers : `30_000` ×2, `2500`, `80 ms` (scroll), `200 ms` (blur composer), `1500 ms` (fermeture modale), `1.5 s` (délai invitation), `2-5 min` (InMail).
- **Données personnelles codées en dur** : aperçu de variables du `SequenceBuilder` (« Laurent », « Garilhe », « Konekt », « Anna (Konekt) », `https://calendly.com/konekt/call », « — L.G., Konekt »), placeholder « Ex: Laurent » (signature), « Ex: Marc » (BulkInMail).
- Couleurs HSL brutes : `hsl(152, 68%, 46%)` / `hsl(25, 95%, 53%)` (WorkflowCanvas), `hsl(271 81% 56% / 0.4)` en `style` inline (SequenceTreeView).

### 7.5 Couleurs hors tokens (liste non exhaustive)
`emerald-{400,500,600,700,900}`, `purple-{400,500,600,700,800,900}`, `indigo-{400,500,700,900}`, `blue-{400,500,600,900}`, `amber-{400,500,600,700,900}`, `orange-{400,500,600}`, `green-{500,700}`, `red-500`, `gray-{400,500,600}`, `violet-600`.
Fichiers concernés : `InlineAIPanel`, `SequenceActivityLog`, `SequenceEnrollmentsPanel`, `ChatListItem`, `useChatIntents`, `useMessagesInboxHelpers`, `LinkedInAccountManager`, `WebhookManager`, `ProxyConfigPanel`, `AddToPipelineModal`, `EditScheduledMessageModal`, `WorkflowAddNode`, `messageTypeUtils`, `SequenceBuilder`, `EnrollmentPreviewModal`, `SequenceTreeView`, `CandidateSequencesPanel`.
Cas symptomatique — `SequenceBuilder` ligne WhatsApp : `bg-success/10 border-emerald-500/30 text-emerald-400` = **trois familles de couleurs dans une seule classe**.
`AddToPipelineModal` mélange `bg-info hover:bg-info/90` (token) et `text-blue-600 border-blue-500 ring-blue-500` (palette brute) pour le même élément.

### 7.6 Couleurs de canal — incohérence systémique
| Canal | Représentations trouvées |
|---|---|
| **LinkedIn** | `bg-linkedin` (token, AccountManager/BulkInMail/Webhook) · `bg-info/10 text-info` (EnrollmentPreview `CHANNEL_COLORS`, VisualSequenceEditor, WorkflowStepNode) · `bg-muted text-foreground` (SequenceBuilder ACTIONS) · `bg-blue-400 text-blue-900` (ActivityLog) · `bg-info` (EnrollmentsPanel) · logo SVG (`ChannelIcon`, `CandidateSidebarCard`, `SequenceTreeView`, `EnrollmentPreviewModal`) |
| **Email** | `bg-emerald-500/15` (EnrollmentPreview + SequenceTreeView `ActionCard` + CandidateSequencesPanel) · `bg-brand-purple/10` (VisualSequenceEditor + WorkflowStepNode) · `bg-muted` (SequenceBuilder) · `border-info/30 text-info` (`ChannelBadge`) → **l'email est vert, violet, gris ou bleu selon l'écran** |
| **WhatsApp** | `bg-whatsapp` (token, WorkflowStepNode) · `bg-success/10 text-success` (EnrollmentPreview, StepEditor) · `bg-green-500/10 text-green-500` (messageTypeUtils) · `bg-success/10 border-emerald-500/30 text-emerald-400` (SequenceBuilder) |
| **InMail** | `bg-info/10 text-info` · `bg-brand-purple/10 text-brand-purple` (badge source inbox) · `bg-purple-500` (EnrollmentsPanel) · `bg-purple-400` (ActivityLog) |
- **`ChannelIcon` ne connaît que `linkedin | whatsapp`** ; `detectChannel()` retombe sur `linkedin` par défaut → une conversation email/WhatsApp mal typée affiche le logo LinkedIn (pastille du `ChatListItem` et header du `MessageView`).
- `ActivityEventCard` colore les appels Aircall avec le token **WhatsApp** (`bg-whatsapp/10 border-whatsapp/30`).

### 7.7 Composants et constantes dupliqués
1. `ACTION_ICONS` + `ACTION_LABELS` + `makeBrandIcon` : **copiés à l'identique** dans `EnrollmentPreviewModal.tsx` et `enrollment-preview/SequenceTreeView.tsx`, avec une divergence (`wait_connection` = « Attendre connexion » vs « Attendre acceptation »).
2. Catalogue d'étapes ACTIONS/TRIGGERS : `SequenceBuilder.tsx` vs `sequence/VisualSequenceEditor.tsx` — **labels, descriptions et couleurs différents** (« Message LinkedIn » vs « Message direct », « Message LinkedIn IA » vs « Smart Message », « Attendre visite retour » vs « Attendre visite ») ; `condition_branch` n'existe que côté visuel.
3. Éditeur d'étape en double : `SequenceBuilder.renderStepsList` (mode Liste) vs `sequence/StepEditor.tsx` (mode Visuel) — champs divergents (« Fenêtre d'envoi » inputs number vs « Créneau d'envoi » selects ; « Étape suivante » absent du mode Liste ; **aperçu des variables absent du mode Visuel**).
4. `TIMEOUT_ACTIONS` ×2 avec des libellés différents (« Passer à l'étape suivante » / « Exécuter étape alternative » / « Terminer la séquence » vs « Passer à la suivante » / « Étape alternative » / « Terminer »).
5. `AI_TONES` ×2 ; **4 vocabulaires de ton** dans le produit : `professional|casual|enthusiastic` (Builder/StepEditor : Professionnel/Décontracté/Enthousiaste), le même avec des labels différents (BulkInMail : **Pro/Cool/Wow**), OutreachMessageModal (Professionnel/Décontracté/Enthousiaste + emoji ⚡), `ToneSelector` inbox (`formal|casual|direct|empathetic` : Formel/Décontracté/Direct/Empathique).
6. Config de statut d'inscription ×3 : `SequenceEnrollmentsPanel.statusConfig` (« Active », « Terminée », « Annulée », « RDV pris ») / `CandidateSequencesPanel.STATUS_CONFIG` (« En cours », « Terminé », « Stoppé ») / `MessageView.SequenceStatusBadge` (« En séquence », « ✓ A répondu », « ⏸ En pause »).
7. Config de statut d'exécution ×3 : « Ignoré » vs « Skippé », « Planifié » vs « Programmé », « Exécuté » vs « Envoyé ». `quota_blocked` et `waiting_event` **n'existent que dans `CandidateSequencesPanel`** → fallback silencieux ailleurs.
8. `PAUSE_REASON_LABELS` ×2, `HIDDEN_ACTION_TYPES` ×2, `formatSequenceError` importé sous deux alias.
9. **Deux taxonomies concurrentes affichées côte à côte sur la même ligne du `ChatListItem`** : `CHAT_CATEGORIES` manuelles (🟢 Intéressé / 🔴 Pas intéressé / 🟡 À recontacter / ⚪ Sans réponse, couleurs tokens) et `INTENT_META` IA (🟢 Intéressé / 🔴 Décline / 💬 Demande info / 📞 Veut appel / ⏰ Timing pas bon / 🚫 Déjà placé / ⚪ Neutre, couleurs brutes).
10. Deux modales d'enrôlement (`SequenceEnrollModal` brutaliste, `EnrollmentPreviewModal` moderne) avec **deux logiques de planification différentes** : la première respecte fenêtre horaire, week-end et jitter (`calculateScheduledTime`), la seconde applique un simple `now + délai`.
11. `MessageView` est monté **deux fois** (mobile fixed + desktop) avec ~30 props dupliquées manuellement.
12. Deux formulations du coût IA : « ~{n} cr », « ~2 crédits », « ~{n} crédits IA », « 10 cr/profil ».

### 7.8 Ton rédactionnel — vouvoiement / tutoiement mélangés
- **Vous** : « Connectez votre LinkedIn dans les paramètres », « Vérifiez la traduction et cliquez sur Appliquer », « Donnez un nom à votre séquence », « Nommez votre séquence », « Rafraîchissez pour récupérer les nouvelles demandes », « Vous pourrez la restaurer à tout moment », « Enrichissez maintenant ».
- **Tu** : « Tu pourras reprendre la séquence », « Choisis un CTA », « Tape ton message ci-dessus », « réessaie », « Active-la quand tu es prêt », « tu approches la limite hebdo », « Modifie le délai », « Vérifie que pg_cron est branché », « Ton prénom (signature) », « Utile si tu prends la conversation à la main », « ajoute au moins une étape ».
- Parfois dans le **même composant** (`SequenceBuilder` : « Donnez un nom à votre séquence » + « Tape ton message ci-dessus »).

### 7.9 Jargon technique / franglais visible utilisateur
- **Noms d'infrastructure exposés** : `process-sequences` dans un `<code>` (Diagnostic), « pg_cron », « cron », « heartbeat », « Pipeline silencieux », « messaging, users, accounts » (WebhookManager), types de checkpoint bruts (`2FA`, `OTP`, `IN_APP_VALIDATION`), `account.status` brut, `proxy_last_error` brut, « Host et port requis », « Custom », « SOCKS5 ».
- **`sequenceErrorMessages.ts` laisse passer « provider »** : « Échec de l'envoi (provider email indisponible) », « Quota provider atteint, réessaie plus tard », « Identifiants provider expirés (reconnecte le compte) » — le strip-vendor fonctionne (Unipile / Microsoft Graph / Resend / Anthropic→IA) mais le mot générique reste.
- **Franglais** : « step »/« steps » (partout, y compris libellés : « Step alternatif », « Générer la preview de ce step »), « skippé »/« Skippé »/« skippés », « enrollment(s) » dans des toasts utilisateur (« Séquence désactivée — enrollments mis en pause », « les enrollments reprendront là où ils en étaient », « L'enrollment passera en "Répondu" »), « enrôler », « preview(s) », « bulk », « trigger »/« TRIGGER », « Smart Message », « Round-robin », « Multi-sender », « sender », « Sales Nav », « Batch en cours », « quota safety » (tooltip).
- Message erroné : toast « Lance "Traiter les séquences" depuis Outreach pour relancer. » — **ce libellé de bouton n'existe pas** (les boutons réels sont « Traiter maintenant » et « Envoyer tout »).
- « Envoyer tout » ne fait qu'**avancer** les actions programmées : le libellé promet un envoi immédiat.
- Aide `EditScheduledMessageModal` : « les variables comme **{firstName}** » — **syntaxe fausse** (le produit utilise `{{first_name}}`) ; le placeholder A/B du Builder utilise aussi `{{firstName}}` alors que le champ principal utilise `{{first_name}}`.

### 7.10 Accessibilité & interaction
- **Filtres de statut de l'inbox réduits à un emoji + un compteur** (« ⏰ 3 »), libellé uniquement dans `title` — idem pour les pills de catégories.
- Emojis employés comme système d'icônes à part entière : ⏰ 📦 ∗ 💬 🟢 🔴 🟡 ⚪ 👔 😊 🎯 🚀 ⚡ 💼 🇬🇧 🇫🇷 📱 📧 🕶 🏢 🤝 ⚠ ⓘ ⏭️ 📞 📅 ✨ 🆕 📋 🔄 🔗 ⏱ ❌ ✓ ✗ — aucun mapping vers un jeu d'icônes.
- `QuotaDisplay` compact : `div` avec `cursor-help`, **non focusable** → tooltip inaccessible au clavier. Même problème pour `SafeModeBadge` (`span`) et le `TooltipTrigger` nu de la variante complète.
- Boutons sans libellé ni `aria-label` : décliner une invitation (`X`), sauvegarder le proxy (`CheckCircle2`), rafraîchir les invitations (`RefreshCw`), analytics mobile.
- « **OK** » = accepter une invitation (libellé non explicite).
- Actions destructives **sans confirmation** : déconnecter un compte LinkedIn, supprimer un webhook, « Annuler les envois en attente » (file InMail) — alors que supprimer un message, une conversation, une séquence ou annuler une étape du journal en demandent une.
- `GripVertical` affiché sur chaque étape du Builder alors qu'**aucun drag & drop n'est implémenté** (affordance mensongère) ; le réordonnancement n'existe pas — seuls l'ajout, la suppression et le rebranchement par `Select`/canvas sont possibles.
- `MessageComposer` affiche le canal brut en majuscules dans le hint clavier (`LINKEDIN · ⌘+↵`).
- Le composant `Button` de shadcn est très peu utilisé dans l'inbox : `ChatListSidebar`, `MessageView` (bulles/actions), `MessageComposer`, `InlineAIPanel`, `SmartReplies`, `SequencesList` (toolbar), `EnrollmentPreviewModal` réimplémentent tous leurs boutons en `<button>` + classes → **aucune variante de bouton centralisée** ; les mêmes styles (`bg-foreground text-background hover:opacity-90 active:scale-95 rounded-lg h-8`) sont recopiés dans une dizaine de fichiers.
- Deux boutons « générer » à sémantique et style opposés dans le même écran (`konekt-skalr-bg` gradient pour le bulk, `border-2 border-dashed` pour l'unitaire).
- `EnrollmentPreviewModal` : `mode` initialisé une seule fois depuis `hasMessageSteps` (valeur du hook au premier rendu) → si les étapes arrivent après, le mode reste erroné.
- `SequenceAnalytics` : `LegendDot` « Réponses » en `bg-accent` alors que la barre est `hsl(var(--primary))`.
- `SequenceDiagnostic` : l'aide dit « 10 dernières min », le code teste 5 min.
- `SequencesList` : le `Switch` d'activation reste actionnable sans abonnement (échec révélé seulement par un toast) — pas d'état désactivé ni de cadenas.

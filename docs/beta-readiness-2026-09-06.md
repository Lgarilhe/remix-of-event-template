# Revue « prêt pour la bêta » du front : 6 septembre 2026

Objet : l'app doit pouvoir être ouverte à des testeurs externes. Cette revue
porte sur le front et l'expérience utilisateur : cohérence des fonctions,
trous, fonctions à cacher, qualité visuelle. Elle s'appuie sur trois sources :
le build de production servi en local et capturé sur desktop (1440×900) et
mobile (390×844), la lecture du code des écrans connectés, et les 111
constats front de l'audit du 1er septembre (`docs/audit-2026-09-01.md`).

Limite à connaître : aucun compte de test n'existe et la production est hors
limites. Les écrans derrière la connexion (missions, sourcing, inbox,
pipeline, paramètres) n'ont donc pas été capturés, seulement lus. Une passe
Playwright sur un Supabase de test reste à faire (brief déjà écrit dans
`docs/audit-2026-09-01-lot-sequences-e2e.md`).

## 1. Corrigé dans cette session

Onze correctifs, tous vérifiés (lint identique à la base sur les fichiers
touchés, `tsc` à 31 erreurs sous la baseline de 32, build de production et 35
tests unitaires au vert).

Landing. En thème sombre, qui est le thème par défaut, le titre du hero
(« Le recrutement, simplifié et accéléré ») et celui du bloc final (« Vos
prochains talents vous attendent ») étaient blancs sur le dégradé ciel :
invisibles. La page a été dessinée pour le thème clair (cartes blanches,
sections gris clair). Elle force maintenant le thème clair tant qu'elle est
affichée et restaure le choix de l'utilisateur en la quittant
(`src/pages/SkalrLanding.tsx`).

Titres d'onglet. Toutes les pages publiques se terminaient par « | EventHub »,
un résidu du template d'origine (`src/components/SEOHead.tsx`). Suffixe
remplacé par « | Konekt » quand le titre ne contient pas déjà la marque ;
mots-clés SEO et image de partage par défaut (« events, discover events… »,
`placeholder.svg`) remplacés.

Copilote IA. Le bouton flottant et le raccourci ⌘K s'affichaient aux
visiteurs non connectés (landing, 404, page de désinscription), sans aucun
contexte derrière. Masqués sans session (`src/components/agent/AgentDrawer.tsx`).

Thème. Le choix clair/sombre fait dans la barre latérale était perdu à chaque
rechargement. Il est mémorisé (`konekt-theme`) et appliqué avant le premier
rendu, sans flash (`src/main.tsx`, `src/components/AppSidebar.tsx`).

Dialogues natifs. Trois `prompt()` du navigateur (insertion de lien dans
l'éditeur InMail et dans le composer de l'inbox) passent par un dialogue
Konekt, `promptDialog`, construit sur le même modèle que `confirmAlert`
(`src/lib/promptDialog.tsx`). La sélection de l'éditeur est restaurée après le
dialogue.

Organisation. Le cache d'identifiant d'organisation figeait un `null` pour
toute la session au premier appel, y compris pendant l'onboarding. Résultat
déterministe pour chaque nouvelle organisation : bandeau rouge « Plus de
crédits IA disponibles » et recherche LinkedIn en échec dès la première
session. Un `null` n'est plus définitif, et le cache est invalidé après
création ou changement d'organisation (`src/lib/orgContext.ts`,
`src/hooks/useOrganization.ts`).

Fiche candidat. Notes, rappels et lien du portail candidat étaient insérés
sans `organization_id` alors que les policies l'exigent : « Erreur lors de
l'ajout de la note » pour tout le monde. Colonne renseignée, action refusée
si l'organisation n'est pas résolue (`src/components/ats/CandidateDetailModal.tsx`).

Prévisualisation d'enrôlement. Le message était injecté en HTML avec les
champs LinkedIn interpolés tels quels (headline, entreprise) : XSS stockée
possible depuis un profil tiers. Rendu en texte, plus de conversion `\n` →
`<br>` (`src/components/outreach/EnrollmentPreviewModal.tsx`,
`src/hooks/useEnrollmentPreview.ts`).

Inbox, composer. Le texte rédigé pour un contact restait affiché, et
envoyable, après avoir cliqué sur un autre contact. Le composer est vidé au
changement de conversation dans le même rendu, et le brouillon du nouveau chat
est lu directement dans le stockage (`src/hooks/useMessagesInbox.ts`,
`src/components/outreach/inbox/MessageView.tsx`, `src/hooks/useChatDraft.ts`).

Inbox, chargement. Une réponse en retard pour la conversation précédente
écrasait le fil de la conversation courante (jusqu'à 30 s, ou définitivement
si la nouvelle était vide). Les réponses périmées sont ignorées, y compris le
remplissage des fils fusionnés et l'extinction du spinner.

Copilote, erreurs. Session expirée, crédits épuisés ou quota atteint donnaient
un tour assistant vide. Un message en français s'affiche dans le fil selon le
statut HTTP (`src/components/assistant-ui/chat-adapter.ts`).

## 2. Avant d'ouvrir la bêta

Ces points bloquent. Ils sont classés par ordre de traitement.

1. Merger `claude/repository-audit-pcgg0y` sur `main`. Rien de ce qui a été
   corrigé depuis le 1er septembre n'est en production : le merge déploie les
   migrations RLS et les edge functions. Ensuite : rotation de
   `UNIPILE_WEBHOOK_SECRET`, `KONEKT_PLATFORM_ADMIN_USER_IDS` à renseigner,
   `types.ts` à régénérer, QA manuelle du moteur de séquences (personne ne l'a
   encore fait tourner dans un navigateur).
2. Landing : le bouton « Réserver une démo » ouvre
   `https://calendly.com/demo/30min`, une adresse fictive
   (`SkalrLanding.tsx`, constante `CALENDLY_URL`). Les chiffres « ×3, −60 %,
   +80 % » et le témoignage « Head of Talent, Scale-up Tech » n'ont pas de
   source nommée. À remplacer ou retirer avant que des inconnus lisent la page.
3. Passe QA sur les quatre personas (skill `qa.md`) sur le parcours de bout en bout :
   inscription, onboarding, connexion LinkedIn, création de mission,
   sourcing, séquence, inbox, pipeline. Aucun de ces écrans n'a été vu dans un
   navigateur pendant cette revue.
4. Les cinq constats « haute » du front d'effort moyen ont été corrigés dans
   le second lot du 6 septembre (section 8). Ils restent à valider à la main
   dans un navigateur, comme le reste.
5. Les 48 constats front de sévérité moyenne (audit du 1er septembre) sont à
   trier après l'ouverture, pas avant.

## 3. À cacher ou désactiver pour la bêta

Des fonctions inachevées sont visibles. Un testeur qui tombe dessus retient
l'inachevé, pas le reste.

Création de mission (`src/components/missions/v2/CreateMissionV2.tsx`). Le
mode voix est un placeholder marqué « à venir ». Le dépôt d'un PDF ou DOCX
affiche « extraction automatique bientôt disponible » après le dépôt : retirer
la zone de dépôt ou l'annoncer avant, pas après.

Extension Chrome (`src/components/settings/ExtensionTokens.tsx:395`).
« Chrome Web Store publication à venir » : l'utilisateur ne peut rien
installer. Masquer la section derrière un feature gate jusqu'à la publication,
ou la réserver à l'organisation Konekt.

Calendrier (`src/components/calendar/CreateEventModal.tsx:171-173`). Les
options « Google Meet » et « Zoom » stockent le texte « lien à venir » comme
lieu : retirer ces deux options tant qu'aucune intégration ne génère le lien.

Marketplace et agents. `/marketplace` est dans la barre latérale (agences),
`/agents` n'est accessible que par la palette de navigation. Un marketplace
vide et une page d'agents sans contenu font mauvaise impression : les retirer
de la navigation pour la bêta, ou les alimenter avant.

Sélecteur de modèle IA (`src/types/aiCredits.ts`, `src/components/ai/ModelLogo.tsx`,
Paramètres → Crédits et sélecteur du copilote). Les noms « Claude Haiku 4.5 »,
« Claude Sonnet 4.6 », « Claude Opus 4.6 » et le libellé « Anthropic »
apparaissent à l'écran, avec le logo du fournisseur. C'est contraire à la règle
de marque de `CLAUDE.md` (noms de fournisseurs jamais visibles). Deux options :
assumer la transparence et lever la règle, ou renommer en paliers Konekt
(par exemple Flash, Standard, Pro, Max) et retirer les logos. Une demi-heure
de travail une fois le choix fait.

Onboarding (`src/components/onboarding/onboardingMeta.ts`). Seize scènes pour
entreprise et agence, treize pour freelance. Pour une bêta, garder le chemin
minimal (organisation, connexion LinkedIn, première mission) et déporter le
reste en conseils contextuels dans l'app.

Paramètres (`src/pages/Settings.tsx`). Treize onglets : général, presets,
templates, contexte IA, actions agent, compte, équipe, connecteurs,
intégrations, facturation, crédits, agence, marketplace. Un regroupement en
cinq (compte, organisation, IA, intégrations, facturation) se fera après la
bêta ; d'ici là, vérifier que les onglets agence et marketplace n'apparaissent
qu'aux organisations concernées.

## 4. Cohérence et trous

Tarifs. `/pricing` est une page protégée, dans l'app ; la landing n'y renvoie
pas. Un visiteur ne peut pas connaître les prix avant de créer un compte,
alors que le bouton principal dit « Commencer gratuitement ». Décider : tarifs
publics, ou « sur demande » assumé pendant la bêta, avec un texte cohérent sur
la landing.

Deux entrées pour le sourcing. La recherche vit à la fois dans l'onglet
Sourcing d'une mission et dans « Recherche » (`/sourcing`, recherche sans
mission). C'est défendable, mais les états vides doivent expliquer la
différence, sinon le testeur ne sait pas où commencer.

Connexion Google. Le bouton est présent sur `/auth` ; vérifier dans le
dashboard Supabase que le fournisseur Google est activé et que les URL de
redirection listées dans `CLAUDE.md` sont bien posées, sinon le bouton mène à
une erreur.

Polices. `index.html` charge quatre feuilles Google Fonts, soit sept familles
(Space Grotesk, Space Mono, Outfit, Instrument Serif, Instrument Sans,
Bricolage Grotesque, plus les italiques). Deux ou trois suffisent ; le reste
coûte en chargement et en cohérence typographique.

`theme-color`. La méta vaut `#0a0a0a` (sombre) alors que la landing est
claire : sur mobile, la barre du navigateur reste noire au-dessus d'une page
blanche. À rendre dynamique ou à passer en clair sur la landing.

Préférence système. Le thème mémorisé ne tient pas compte de
`prefers-color-scheme` au premier lancement ; l'app démarre sombre pour tout
le monde. Acceptable en bêta, à noter.

Résidus techniques. `withPreviewAccessToken` (`src/lib/previewToken.ts`),
hérité de l'ancien hébergeur, entoure encore la plupart des navigations.
Inoffensif, à nettoyer après la bêta.

## 5. Ce qui a été vu à l'écran

Landing, desktop et mobile : cohérente une fois le thème clair forcé. Le
titre passe sur quatre lignes à 390 px, lisible. Les deux boutons d'appel à
l'action s'empilent proprement. La maquette produit (fenêtre « konekt.app »)
est nette. Le menu mobile fonctionne (bouton hamburger).

Page de connexion : sobre, sombre, centrée ; champs, bouton Google, liens
« mot de passe oublié » et « s'inscrire » présents, pas d'erreur console.

Page 404 et page de désinscription sans jeton (« Lien invalide ») : correctes.

Console : les seules erreurs de chargement sont les quatre feuilles Google
Fonts, bloquées par le bac à sable de test, pas par l'app.

Reste dans le code un rendu HTML de contenu utilisateur :
`src/components/settings/EmailSignatures.tsx:176` (signature d'email). Le
contenu vient de l'utilisateur lui-même, risque faible ; à assainir si les
signatures deviennent partagées dans l'organisation.

## 6. Décisions à prendre

1. Noms des modèles IA : fournisseur visible ou paliers Konekt.
2. Marketplace et agents : dans la bêta ou retirés de la navigation.
3. Extension Chrome : masquée, ou réservée à Konekt avec chargement manuel.
4. Tarifs : publics ou sur demande.
5. Onboarding : chemin court pour la bêta, ou parcours actuel en seize scènes.
6. Landing : adresse Calendly réelle, chiffres sourcés ou retirés.

## 7. Méthode

Build `vite build --mode production` avec l'URL Supabase publique et la clé
anon, servi par `vite preview`, capturé par Chromium headless via Playwright.
Pages capturées : `/`, `/auth`, `/privacy`, `/unsubscribe`, une adresse
inexistante, `/missions` (redirige vers `/auth` sans session) et `/pricing`
(protégée, redirige aussi). Vérifications après correctifs : `eslint` sur les
dix-sept fichiers touchés (mêmes 56 erreurs préexistantes qu'avant), `tsc`
(31 erreurs, baseline 32, ensemble d'erreurs identique à celui d'avant les
modifications), `vite build`, `npm run test:agent` (35 tests).

## 8. Second lot du 6 septembre : les cinq bugs « haute » restants

Cinq correctifs d'effort moyen, préparés par cinq agents lecteurs (un plan
par constat, extraits de code vérifiés), implémentés en une passe, puis
relus par dix agents contradictoires (deux lentilles par correctif :
exactitude et régressions, puis sécurité multi-tenant ou SQL selon le cas).
Les relecteurs SQL ont rejoué les deux migrations sur un Postgres 16 jetable
au schéma reconstruit. Leurs 35 constats (2 bloquants, 11 importants, 22
mineurs) ont été traités dans un second commit, sauf les mineurs listés plus
bas. Contrôles locaux : lint identique à la base sur les quinze fichiers
front touchés, `tsc` à 31 erreurs sous la baseline de 32 avec le même
ensemble d'erreurs qu'avant, `deno check` sans erreur nouvelle sur les
quatre edge functions, build de production et 35 tests unitaires au vert.

Ce que la relecture a attrapé et qui est corrigé : la vue publique des
intégrations restait modifiable par tout utilisateur connecté (privilèges
par défaut du bootstrap, insertion possible chez une autre organisation) ;
un verrou de ligne dans la fonction de remplacement des étapes pouvait
bloquer en cycle avec un déplacement kanban simultané (verrou advisory à la
place) ; l'analyse automatique facturait Haiku alors qu'elle appelle Sonnet ;
le marqueur « aucun message du candidat » était pris pour une analyse par le
panneau IA ; une sélection de conversation pendant son préchargement perdait
les suggestions de réponse (promesse partagée entre les trois déclencheurs) ;
un candidat en « Pressenti » ou ayant répondu pouvait encore être ramené à
« Contacté » par le flux inbox ; un pointeur d'organisation périmé donnait un
écran d'erreur permanent (retour aux appartenances) ; un double clic dans le
flux freelance créait deux organisations ; le formulaire d'intégrations
perdait la saisie à chaque rendu tant qu'aucune ligne n'existait ; il n'était
plus possible de retirer une clé (bouton « Retirer la clé » avec confirmation).

Chaîne d'analyse automatique des messages. `auto-analyze-message` appelait
`analyze-response` et `fetch-notion-jobs` avec la clé anonyme, refusée en
401 : le cache d'analyse n'était jamais écrit, le webhook de réception
échouait de la même façon, et les crédits étaient imputés à un identifiant
LinkedIn au lieu d'un utilisateur. Les appels internes passent en clé
service avec l'organisation et l'utilisateur du compte, le cache est écrit
aussi pour les conversations sans réponse du candidat ou à faible confiance,
le webhook envoie la clé service et l'organisation, et le front ne relance
l'analyse qu'une fois par conversation et par session (`src/lib/autoAnalyzeGuard.ts`).

Envoi depuis l'inbox. Chaque message envoyé remettait le candidat à
« Contacté » sur toutes ses missions, et dans Notion, y compris depuis
« Entretien » ou « Offre », et créait une page Notion pour n'importe quel
interlocuteur. Le statut n'est posé que s'il n'existe pas ou vaut
« découvert » ou « scoré », la synchronisation Notion n'a lieu qu'avec un job
rattaché, et l'edge function `add-to-shortlist` ne rétrograde plus un stage
avancé ni n'étend le changement aux autres missions.

Chargement de l'organisation. Une erreur transitoire renvoyait un utilisateur
existant dans l'onboarding, avec création possible d'une seconde
organisation. Les erreurs sont levées (donc retentées), le garde affiche un
écran « Réessayer », la création d'une organisation par un utilisateur déjà
membre demande une confirmation explicite, et `/onboarding` renvoie au
tableau de bord quand l'organisation est déjà chargée.

Secrets d'intégration. Les clés API tierces étaient lisibles en clair par
tout administrateur via `select *` et un bouton œil. Migration
`20260906085151_integration_secrets_write_only.sql` : plus aucun privilège
direct sur la table pour les rôles clients, une vue publique sans secret
(suffixe masqué des quatre clés saisies par le client, clés Konekt jamais
exposées) et deux fonctions d'écriture réservées aux owners et admins. Le
hook lit la vue, écrit par ces fonctions, et l'écran des intégrations n'a
plus de bouton œil.

Process d'une mission. « Réoptimiser avec l'IA » et les templates ajoutaient
les étapes aux étapes existantes. Migration
`20260906084418_replace_process_steps_rpc.sql` : une fonction transactionnelle
remplace les étapes, repositionne les candidats (même nom d'étape, sinon
première étape) et retourne le nombre repositionné, affiché dans une boîte
de confirmation avant tout remplacement.

Choix produit faits par défaut, à confirmer :

1. Analyse automatique : l'analyse facturée est lancée dès le préchargement
   des dix conversations récentes (une fois par session), pas seulement à
   l'ouverture. Les crédits du flux webhook sont imputés au premier membre
   rattaché au compte LinkedIn.
2. Inbox : « Pressenti », « Répondu » et tout stage plus avancé sont
   protégés ; seul « Nouveau » ou « Contacté » passe à « Contacté » (la
   relecture a montré que Pressenti est au-dessus de Contacté dans le kanban).
3. Organisation : un second espace reste possible après confirmation ; le
   dialogue propose seulement Annuler ou Créer.
4. Secrets : un secret enregistré se remplace ou se retire (bouton « Retirer
   la clé », confirmation) ; `unipile_connected` et `coresignal_enabled`
   sont en lecture seule pour les clients ; `aircall_api_id` est traité
   comme non secret. Les clés Unipile et Coresignal déjà lues par des admins
   clients restent à faire tourner côté ops.
5. Process : remplacement pur (pas d'option « ajouter à la suite »).

Points de déploiement : les deux migrations partent avec le merge sur
`main` ; Vercel et le workflow de migrations ne sont pas synchronisés, donc
une fenêtre d'une à deux minutes existe où l'ancien front ou le nouveau
appelle une base pas encore migrée (erreur affichée, aucune donnée
corrompue). `types.ts` a été édité à la main pour la vue et les deux
fonctions : à régénérer après application en production. Le linter Supabase
signalera la vue comme « security definer view » : c'est voulu, le prédicat
owner/admin est dans la vue.

Constats mineurs laissés tels quels, par choix : pas de limite de débit sur
la chaîne d'analyse en appel interne (le webhook et la garde de session
bornent déjà le volume) ; les messages Postgres restent en anglais quand un
payload de process viole une contrainte CHECK (le front n'envoie que des
valeurs valides) ; le nombre de candidats affiché avant remplacement est
compté sous la RLS de l'appelant et peut différer du remap serveur ;
l'attribution des crédits du flux webhook au premier membre rattaché au
compte reste arbitraire pour un compte partagé ; `types.ts` porte les
nouvelles fonctions hors ordre alphabétique jusqu'à régénération.


## 9. Lot de nettoyage du 6 septembre (soir)

Décisions prises avec Laurent : la marketplace reste dans l'app et se lance en
cercle fermé (pas de gel), la Base Konekt se vend en crédits, trois formules
par siège plus crédits IA. Le lot applique le reste de la revue produit.

Retiré du dépôt : 20 edge functions sans aucun appelant (dont analyse de
profil, nurturing, débrief, screening Notion, snippets et templates de
séquences, scans de pages carrière, n8n, Airtable, Aircall en lecture) et
leurs sections de configuration ; le parcours mission V1 à huit onglets et
ses composants (brief, process, configuration, vue d'ensemble, barre de
progression, copilote de mission) ; les pages Admin, portail client V1 et
Candidats ; quatorze composants et hooks orphelins ; le repli Microsoft Graph
de l'envoi d'email et le code PDL partagé ; la carte et le badge Airtable.
Le dépôt perd environ vingt et un mille lignes.

Retiré de l'écran : le mode voix et l'import PDF « bientôt » de la création
de mission, la promesse de commentaires du portail client, les métriques
d'agence « prochainement », le bouton de paiement sans action, l'entrée
Notifications sans page, les options Meet et Zoom « lien à venir », le texte
« Coordonnées à venir » du portail candidat. L'extension Chrome n'est plus
rendue dans les paramètres (le code reste).

Onboarding : quatre écrans pour une entreprise ou un cabinet (type, organisation,
LinkedIn, fin), cinq pour un freelance (type, détails, spécialisations,
LinkedIn, fin). Les scènes audit de marque employeur, profil recruteur,
équipe, ICP, ton IA, intégrations, quotas, objectif, outils et découverte sont
supprimées. La progression persistée change de version : un tunnel commencé
avant repart du premier écran.

Droits : un freelance a les mêmes droits qu'un cabinet sur ses missions
(création, brief, process) ; il ne voit ni l'onglet Équipe ni « Gérer
l'équipe ». L'onglet Agence passe par la matrice de droits.

Documentation : README réécrit pour Konekt (l'ancien décrivait le template
d'événements), CLAUDE.md aligné (routes, parcours V2, 73 fonctions, secrets
réellement lus).

À faire après le merge, côté Supabase, une seule fois :

```
for f in analyze-linkedin-profile backfill-knowledge-lake chat-filter-assistant \
  estimate-search-count fetch-aircall fetch-airtable fetch-notion-schema \
  n8n-create-workflow nurturing-analyzer preview-transactional-email \
  process-debrief scan-career-pages scrape-job-url screen-candidate \
  sequence-snippets-crud sequence-templates-crud check-invitation-status \
  audit-employer-brand generate-recruiter-bio scan-recruiter-linkedin; do
  supabase functions delete "$f" --project-ref crckfywoyjxkawathdff
done
```

Puis retirer les secrets `N8N_API_KEY`, `N8N_INSTANCE_URL`, `MICROSOFT_GRAPH_TOKEN`
et `PDL_API_KEY`, que plus aucune fonction ne lit.

Relecture contradictoire du lot (trois lentilles, lecture seule), corrigée
dans la foulée : plus de bouton « Retour » sur l'écran LinkedIn (il ramenait
sur l'écran qui crée l'espace et bloquait le tunnel), entrée « Abonnement »
de la palette réservée aux admins comme l'onglet, écran des tokens de
l'extension Chrome remis dans « Mon compte » (l'extension y renvoie), pastille
de notifications retirée du menu utilisateur tant qu'aucun écran ne les
affiche, preset « Visio » reconnu par le calendrier, nom d'expéditeur des
emails de séquence lu sur la bonne colonne de `profiles` (la requête
précédente échouait en silence), script de déploiement pointant sur l'ancien
projet supprimé, test unitaire des coûts IA réparé (les actions à coût fixe
ont zéro token). Les tables sans lecteur ni
écrivain (dont `event_registrations`, `jarvis_kb`, `jarvis_messages`, les six
tables `airtable_*`) n'ont pas été supprimées : aucune migration destructive
dans ce lot, décision à part si tu veux les retirer.

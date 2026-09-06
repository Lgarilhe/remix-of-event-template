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
4. Cinq constats « haute » du front restent ouverts, tous d'effort moyen :
   - `src/hooks/useOrganization.ts:61` : une erreur transitoire au chargement
     de l'organisation envoie un utilisateur existant dans l'onboarding, avec
     risque d'organisation en double s'il le termine.
   - `src/hooks/useMessagesInbox.ts:1072` : chaque envoi depuis l'inbox
     rétrograde le candidat à « Contacté » sur toutes ses missions, et dans
     Notion, même depuis « Entretien » ou « Offre ».
   - `src/hooks/useAutoPrefetchAnalyses.ts:66` : jusqu'à dix appels IA à
     chaque ouverture de l'inbox, jamais mis en cache ni facturés.
   - `src/components/missions/MissionProcess.tsx:749` : « Réoptimiser avec
     l'IA » ajoute les étapes du process au lieu de les remplacer.
   - `src/hooks/useOrganizationIntegrations.ts:40` : les clés API tierces sont
     lisibles en clair par tout admin d'organisation (migration de GRANT par
     colonne à écrire).
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

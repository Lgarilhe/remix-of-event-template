# Revue produit : ce qui est en trop, ce qui manque, et face à qui

6 septembre 2026. Deux sources : un inventaire du code (deux agents, lecture
seule, chaque affirmation appuyée par un fichier et une ligne ou une commande
`grep`), et sept fiches concurrents établies par le web (Juicebox, Metaview,
Gem, Loxo, Dover, le segment outreach LinkedIn HeyReach / lemlist / Waalaxy /
La Growth Machine, et le marché français Hunteed / Taleez / Flatchr / Welcome
to the Jungle / Beetween / Jobaffinity / Teamtailor).

Limite des fiches concurrents : le proxy réseau de la session a bloqué la
lecture directe des sites, des pages tarifs et des plateformes d'avis. Les
agents ont travaillé sur les extraits du moteur de recherche, recoupés entre
sources. Les prix cités sont des ordres de grandeur d'août 2026 à revérifier
sur les pages officielles avant tout usage commercial. Les fiches détaillées
sont dans le journal de la session, pas dans le dépôt.

## 1. Ce que Konekt est vraiment, vu du code

Le dépôt contient bien plus que ce qu'un utilisateur voit, et une partie de ce
qu'il voit n'est pas finie.

Côté serveur : 93 edge functions. 45 sont appelées depuis le front, 12
tournent en tâche de fond (crons, triggers, appels internes), 5 sont des
webhooks externes, et 21 n'ont aucun appelant, nulle part. Dix tables ne sont
lues ni écrites par personne, dont deux héritées du template événementiel
d'origine (`event_registrations`) et deux d'un projet personnel (`jarvis_kb`,
`jarvis_messages`). Le `README.md` décrit encore une « Event Management
Platform ».

Côté front : 29 pages, huit entrées de navigation. Deux générations coexistent
pour le parcours mission (V1 à huit onglets, V2 à trois phases, V2 par défaut
mais V1 toujours livré derrière un flag), pour le brief, le process, la
configuration, la vue d'ensemble, le portail client et la liste des missions.
Quatorze composants n'ont plus d'importeur. La matrice des droits par type
d'organisation (`featureGates.ts`) déclare quatorze fonctions mais n'est
vérifiée que pour cinq : un freelance peut créer des missions et gérer une
équipe alors que la matrice dit non.

Intégrations, état réel de bout en bout :

| Intégration | État |
|---|---|
| LinkedIn (recherche, séquences, inbox, webhook) | câblée et active |
| Anthropic, Deepgram (IA, dictée, coach) | câblées et actives |
| Resend (emails transactionnels, désabonnement) | câblée et active |
| Stripe | packs de crédits complets ; abonnements : webhook et gating prêts, aucun bouton d'achat (la page Tarifs renvoie vers Abonnement, qui renvoie vers Tarifs) |
| Notion | fonctionne, mais deux chemins de connexion coexistent (clé API et OAuth pour le copilote) |
| Calendly | webhook fonctionnel seulement s'il est enregistré à la main ; la clé saisie dans l'écran ne sert à rien |
| Aircall | webhook seul ; identifiant et jeton saisis dans l'écran jamais utilisés |
| Airtable | écran de saisie sans aucune fonction active derrière ; six tables jamais alimentées |
| Base Konekt (Coresignal) | active derrière un drapeau en base que seul un administrateur peut poser |
| Apollo, PDL | résidus : enrichissement société et pedigree pour Apollo, code partagé sans appelant pour PDL |
| n8n, Microsoft Graph | orphelins |

Écrans qui promettent quelque chose qui n'existe pas : dictée vocale et import
PDF « bientôt » dans la création de mission, commentaires « arrive bientôt »
dans le portail client alors que l'onboarding du client les annonce, métriques
d'agence « prochainement », extension Chrome « publication à venir » avec un
chemin de disque codé en dur, bouton « Gérer les moyens de paiement » sans
action, entrée « Notifications » du menu qui ouvre un onglet inexistant, options
« Google Meet » et « Zoom » qui stockent le texte « lien à venir », scène
d'onboarding « équipe » qui appelle une edge function supprimée
(`apollo-search`).

## 2. Ce que les concurrents vendent, et où Konekt est seul

Les sept fiches convergent sur un point : personne ne combine ce que Konekt
combine. Les outils de sourcing (Juicebox, Gem, Loxo) cherchent dans leur
propre base et réduisent LinkedIn à des tâches manuelles ou à une extension de
capture. Les outils d'outreach (HeyReach, lemlist, Waalaxy, La Growth Machine)
automatisent LinkedIn mais sans brief, sans scoring, sans pipeline. Les ATS
français vendent la multidiffusion d'annonces et le tri de l'entrant. Metaview
vend les notes d'entretien et pousse vers l'ATS du client.

Ce que Konekt a et qu'aucun des sept n'a en même temps :

1. La recherche LinkedIn depuis l'outil, avec la licence que le recruteur paie
   déjà (Classic, Recruiter, Sales Navigator), filtres générés depuis un brief
   structuré. Les autres capturent profil par profil ou cherchent ailleurs.
2. Le scoring de profils sourcés par rapport au brief, avant enrôlement. Les
   outils d'outreach enrôlent une liste brute ; les ATS scorent l'entrant.
3. Les séquences LinkedIn réellement automatisées (invitation, message,
   InMail Recruiter) avec rotation d'expéditeurs et email, dans le même moteur.
4. L'inbox LinkedIn rapatriée dans l'outil, avec détection d'intention et
   suggestions de réponse.
5. Le pipeline, les scorecards, le portail client et le portail candidat sur
   la même mission.
6. Un produit en français, hébergé en Europe, avec export et effacement RGPD
   déjà codés, face à des acteurs américains en dollars (Juicebox, Metaview,
   Gem, Loxo, Dover) dont les recruteurs européens critiquent la qualité des
   données de contact et l'hébergement.

Ce que les concurrents ont et que Konekt n'a pas, par ordre d'importance pour
un acheteur :

1. Un prix public par siège, un essai sans carte, souvent un palier gratuit
   (Juicebox, Metaview, Waalaxy, Dover, Jobaffinity). Konekt n'a pas de bouton
   d'achat d'abonnement.
2. La protection contre les restrictions LinkedIn : montée en charge
   progressive des quotas (lemlist part de deux invitations par jour, La
   Growth Machine ajoute dix messages par jour jusqu'au plafond), plafonds
   documentés, anti-doublon entre recruteurs d'une même équipe. Konekt n'a
   qu'une limite journalière fixe par compte. Depuis la suppression de la page
   LinkedIn de HeyReach en mars 2026, c'est la première question d'un acheteur.
3. L'enrichissement email et téléphone inclus dans le plan (500 crédits chez
   Metaview et Waalaxy, 1 500 chez lemlist). L'infrastructure existe chez
   Konekt (file d'attente, fournisseur), pas l'offre.
4. Le notetaker d'entretien qui rejoint la visio et remplit la scorecard
   (Metaview, Loxo, Gem, Dover Premium). Konekt a le coach en direct par micro
   et la scorecard IA, pas le robot qui rejoint Meet, Teams ou Zoom.
5. Les connecteurs vers les ATS du marché (Greenhouse, Lever, Ashby,
   Teamtailor, Welcome ATS). Un cabinet dont le client impose son ATS, ou une
   équipe interne déjà équipée, ne changera pas d'ATS pour Konekt.
6. Un flux entrant : lien de candidature, tri IA des candidatures, détection
   de faux profils (Metaview Application Review, Gem, Welcome ATS). Konekt est
   sortant d'abord ; l'edge function `submit-application` existe déjà.
7. Le reporting d'outreach par séquence et par expéditeur, avec A/B
   (lemlist, HeyReach). Konekt a les données en base et un onglet Insights par
   mission, pas la vue par séquence.
8. Une base de profils propriétaire avec coordonnées (800 millions chez
   Juicebox et Gem, 850 chez Loxo). Konekt n'a pas à la construire : la
   « Base Konekt » via Coresignal existe déjà comme complément, à assumer ou à
   retirer.
9. La liquidité d'une marketplace : Hunteed revendique 3 000 consultants,
   Dover 50 recruteurs vérifiés avec facturation intégrée. Une marketplace
   sans offre le jour de l'ouverture est une page vide.
10. Les preuves : notes G2 et Capterra, SOC 2, logos. Konekt n'a aucune
    présence sur les plateformes d'avis ; une page « Sécurité et données »
    avec DPA et liste de sous-traitants coûte peu et compte beaucoup.

Repères de prix relevés (à vérifier) : Juicebox 119 à 199 $ par siège et par
mois plus 199 $ par agent ; Metaview notes 60 $, sourcing 100 à 300 $ par
utilisateur ; Gem 99 à 149 $ par siège pour les cabinets, 270 $ par mois
forfait startup ; Loxo 149 à 199 $ par utilisateur en annuel ; Dover ATS
gratuit puis 199 $ par mois ; La Growth Machine 60 à 120 € par identité ;
Waalaxy 19 à 69 € par compte ; Jobaffinity 79 à 110 € par utilisateur ;
Flatchr 49 € par offre active ; Hunteed 8 à 12 % du salaire au succès.

## 3. À retirer, à geler, à garder

Le tableau donne le verdict par fonction. « Retirer » : supprimer du code
avant l'ouverture (ou juste après, mais en un seul lot). « Geler » : garder le
code, masquer l'accès jusqu'à une décision ou une condition. « Garder » :
périmètre bêta.

| Fonction | Verdict | Motif |
|---|---|---|
| Parcours mission V1 (8 onglets) et ses composants : BriefWizard, MissionProcess V1, MissionConfig V1, MissionBentoDashboard, MissionProgressBar, MissionCopilot, CopilotRail | retirer | V2 est le défaut ; V1 n'est atteignable que par un flag console ; double maintenance |
| Portail client V1, page Admin (template événementiel), page Candidats, 14 composants sans importeur, 10 tables sans lecteur ni écrivain | retirer | code mort prouvé |
| 21 edge functions sans appelant (dont analyze-linkedin-profile, chat-filter-assistant, estimate-search-count, fetch-airtable, fetch-aircall, fetch-notion-schema, n8n-create-workflow, nurturing-analyzer, process-debrief, scan-career-pages, scrape-job-url, screen-candidate, sequence-templates-crud, sequence-snippets-crud, backfill-*, preview-transactional-email, check-invitation-status) | retirer | surface d'attaque et coût de maintenance sans usage ; rgpd-erase-contact et rgpd-purge font exception : à câbler, pas à supprimer |
| Airtable (carte, six tables, fonction) | retirer | rien d'actif derrière l'écran |
| n8n, Microsoft Graph, PDL | retirer | orphelins |
| Marketplace, mode chasse, activation marketplace, onglet Marketplace des paramètres | geler | aucune offre côté recruteurs, aucune interface pour qu'une entreprise accepte une candidature, listes de contrôle en lecture seule ; à relancer quand vingt recruteurs sont inscrits |
| Extension Chrome | geler | non publiée ; chemin de disque codé en dur dans l'écran |
| Profil public recruteur (`/r/:slug`) | geler | aucune interface ne crée ni n'affiche le lien |
| Page Agents (`/agents`) | geler ou relier | sans entrée de navigation ; soit une entrée sous le copilote, soit retirée |
| Session de qualification Calendly | geler | dépend d'un webhook enregistré à la main |
| Onglet Agence des paramètres | geler | métriques « prochainement » |
| Base Konekt (Coresignal) | décider | soit une offre facturée en crédits avec un écran d'activation, soit retirer le bouton |
| Onboarding : scènes équipe (fonction absente), audit marque employeur, profil recruteur (Apollo) | retirer de la bêta | seize scènes ; garder organisation, LinkedIn, première mission |
| Création de mission : voix, PDF, import multiple | retirer les placeholders | la dictée existe déjà dans le brief |
| Calendrier : options Meet et Zoom | retirer les options | texte « lien à venir » stocké comme lieu |
| Onglet Shortlist client du pipeline (Notion) | garder, masqué sans Notion | usage interne Konekt |
| Deux fonctions de réécriture de texte, quatre fonctions de filtres | fusionner après la bêta | pas bloquant |
| Dashboard, missions V2, brief, process, sourcing, séquences, inbox, pipeline, scorecards, coach, tâches, calendrier, copilote, portails, crédits IA, équipe, intégrations Notion et Calendly | garder | c'est le produit |

Ce que ce tri change : la navigation passe à sept entrées (sans Marketplace),
les paramètres à neuf onglets, l'onboarding à six scènes, et le dépôt perd
environ un cinquième de ses edge functions.

## 4. Les trous à combler

Classés par effet sur la vente et par effort. P0 : avant l'ouverture de la
bêta ou pendant. P1 : les trois mois suivants. P2 : plus tard, ou jamais.

P0, sans quoi le produit ne se vend pas :

1. Une grille tarifaire publique et achetable. Trois plans par siège (Solo
   pour les freelances autour de 49 à 69 € par mois avec un compte LinkedIn ;
   Cabinet autour de 129 à 149 € par siège ; Entreprise autour de 179 à 199 €
   par siège), crédits IA inclus par palier, packs au-delà, remise annuelle,
   essai de quatorze jours sans carte. Le webhook Stripe et le gating existent ;
   il manque le bouton d'achat et la page. Les marges sont à valider avec le
   coût réel par compte LinkedIn et par tokens.
2. La sécurité LinkedIn visible : montée en charge progressive des quotas par
   compte, plafonds affichés, pause automatique sur signal de restriction,
   anti-doublon entre recruteurs d'une même organisation. C'est aussi un
   argument de vente à écrire noir sur blanc.
3. L'enrichissement email et téléphone packagé : N contacts inclus par plan,
   coût par contact affiché, bouton sur la fiche candidat. L'infrastructure
   est là.
4. Un centre de notifications qui existe : l'entrée du menu, le composant
   orphelin et le digest quotidien de l'agent (déjà en cron) convergent vers
   un seul écran et un email quotidien.
5. Le temps jusqu'à la première valeur : connexion LinkedIn, fiche de poste
   collée, filtres générés, première recherche, vingt profils scorés, en dix
   minutes. C'est la démo. L'onboarding court sert à ça.

P1, ce qui fait basculer un acheteur qui compare :

1. Notetaker d'entretien qui rejoint la visio et remplit la scorecard. Ne pas
   construire le robot : un fournisseur d'enregistrement de réunions par API
   suffit, le reste (transcription, scorecard IA) existe.
2. Flux entrant par mission : lien de candidature public, analyse du CV,
   scoring avec le même moteur que le sourcing, détection de faux profils
   (déjà présente). Sans multidiffusion : ce n'est pas le métier.
3. Connecteur vers un ou deux ATS que les clients des cabinets imposent en
   France et en Europe (Teamtailor, Welcome ATS), plus un export générique
   (CSV, webhook). Avant les grands ATS américains.
4. Commentaires et validation dans le portail client : promis à l'écran,
   attendu par tout hiring manager (Loxo en fait un argument).
5. Reporting par séquence et par expéditeur : acceptation, réponse, A/B.
6. Recherche dans son propre vivier en langage naturel via le copilote : le
   RAG (`retrieve-context`) existe sans écran.
7. Page « Sécurité et données » : hébergement, sous-traitants, DPA à
   télécharger, procédure d'effacement (à brancher sur les fonctions RGPD
   orphelines). Puis une présence sur Appvizer, Capterra et G2.

P2, à ne pas faire maintenant :

1. CRM commercial et prospection B2B pour cabinets (Loxo). Autre produit.
2. Base de profils propriétaire. Coresignal en complément suffit si l'offre
   est assumée.
3. API publique et serveur MCP pour piloter l'outreach depuis des outils
   tiers (HeyReach, Juicebox). Utile pour les agences, pas pour la bêta.
4. Agent autonome par mission qui tourne en continu (Juicebox Agents,
   Metaview fillmore, Loxo Agent Workforce). Le copilote et les tâches
   planifiées de l'agent posent les bases ; l'agent persistant vient après
   que le sourcing manuel assisté est irréprochable.
5. Application mobile.

## 5. Positionnement proposé

Konekt est fort là où les autres sont faibles : la chasse sur LinkedIn, de
bout en bout, dans l'outil. Le message qui tient face aux sept fiches :

« Le poste de travail du chasseur de têtes. Du brief à l'entretien, sur
LinkedIn, en français. »

Cibles dans l'ordre : cabinets de recrutement et chasseurs indépendants
(c'est le segment de Loxo, avec ses prix en dollars et son support américain),
puis les équipes internes qui font du sourcing sortant. Les entreprises qui
recrutent surtout par annonces ne sont pas la cible : elles achètent Taleez,
Flatchr ou Welcome, et Konekt s'y branchera par connecteur (P1) plutôt que de
les remplacer.

Le modèle tri-persona reste un atout de récit (un freelance peut rejoindre
l'équipe d'une mission d'un cabinet) à condition que la matrice de droits soit
réellement appliquée, ce qui n'est pas le cas aujourd'hui. La marketplace est
une seconde étape, pas un argument d'ouverture.

## 6. Ordre de marche

1. Décisions à prendre sur ce document : les gels de la section 3, le sort
   de la Base Konekt, la grille tarifaire.
2. Lot de nettoyage : suppression du code mort et des placeholders, matrice
   de droits appliquée, README réécrit. Une session.
3. Lot P0 : abonnement Stripe achetable et page tarifs, sécurité LinkedIn,
   enrichissement packagé, notifications, onboarding court. Deux à trois
   sessions.
4. Bêta sur le périmètre gardé, avec les tests de bout en bout sur staging
   (voir `docs/beta-readiness-2026-09-06.md`).
5. Lots P1 dans l'ordre : notetaker, flux entrant, portail client, connecteur
   ATS, reporting séquences, page sécurité.

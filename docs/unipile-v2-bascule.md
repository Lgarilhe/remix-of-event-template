# Bascule vers la nouvelle connexion LinkedIn et messagerie (API v2) : guide du propriétaire

Public : le propriétaire de Konekt, sans connaissance technique. Les étapes disent où cliquer et quoi coller.
Version du code décrite : branche `ccr-6c73a178-thbl61`, commits `7c1e042`, `1cbb8ec`, `1bcdac6`, `67c8953`, `9c1f537`. Document rédigé le 12 octobre 2026.

> **Ne fusionnez pas cette branche avant d'avoir lu ce guide en entier.**
> La fusion déploie automatiquement toutes les fonctions du serveur (workflow GitHub existant) et le site. Le nouveau code n'accepte que les nouveaux identifiants de compte. Si vous fusionnez avant d'avoir posé les secrets (partie 3) et sans suivre l'ordre de la partie 6, la messagerie LinkedIn, les envois de séquences, les InMails et la recherche cessent de fonctionner, et les séquences en cours se mettent en pause toutes seules (motif « compte déconnecté »). Les données ne sont pas perdues, mais il faut ensuite tout remettre en route à la main.

---

## 1. De quoi il s'agit

Konekt parle à LinkedIn, à WhatsApp et aux boîtes e-mail par l'intermédiaire d'un prestataire (Unipile). Ce prestataire a sorti une nouvelle version de son interface, la version 2. Konekt utilisait l'ancienne (version 1). Le code de la branche n'utilise plus que la version 2, sans repli vers l'ancienne.

Deux choses changent en profondeur. Premièrement, la clé d'accès devient unique pour toute l'application : plus de clé ni d'adresse de serveur par organisation. Deuxièmement, chaque compte relié (LinkedIn, WhatsApp, e-mail) change d'identifiant : l'ancien identifiant est remplacé par un identifiant qui commence par `acc_`. Cet identifiant est écrit dans dix-huit colonnes de la base que la conversion réécrit (inscriptions de séquences, file d'InMails, compteurs de plafonds, conversations, liaisons des membres...). Une page d'administration réservée à la plateforme convertit ces identifiants, avec une simulation avant et une sauvegarde pour annuler.

---

## 2. Ce qui est déjà fait dans le code

Vérifié dans les fichiers du dépôt le 12 octobre 2026. Rien de ceci n'a été essayé avec une vraie clé v2 (voir la partie 9).

- Un client unique (`supabase/functions/_shared/unipile/`) : tous les appels au prestataire passent par lui. Un test interdit l'ancienne adresse `/api/v1`, l'ancien `UNIPILE_DSN` et tout appel direct hors de ce client.
- Toutes les fonctions qui parlaient au prestataire utilisent ce client : recherche, profils, messages, InMails, invitations, séquences, e-mails, enrichissement, assistant, notation, agents de sourcing.
- Réception des notifications en temps réel (réponses, invitations acceptées, état des comptes, e-mails) au nouveau format. Chaque notification porte un jeton secret dans son adresse.
- Connexion d'un compte par un lien hébergé par le prestataire, sur un domaine à votre marque, avec une page de retour Konekt (`/settings/account/connections/retour`). Chaque tentative est enregistrée (table `connection_attempts`, durée de vie 30 minutes).
- Connexion directe (identifiants saisis dans Konekt, QR code, codes de vérification) : écrite et testée avec un faux prestataire, mais **désactivée** par défaut.
- Les nouveaux états de compte (dégradé, partiel, verrouillé) arrêtent les envois sans mettre les séquences en pause.
- La limite proactive de 90 % n'existe plus dans la v2. Les plafonds reposent sur le compteur de Konekt, plus une pause de la journée si le prestataire signale une limite atteinte.
- Un envoi dont le résultat est incertain (délai dépassé, erreur du serveur) n'est jamais compté comme envoyé et n'est jamais renvoyé.
- Outil de bascule des identifiants : fonction `unipile-migration`, page `/settings/admin/bascule`, fonctions SQL de conversion et d'annulation, sauvegarde ligne par ligne.
- Nouveautés utilisables après la bascule : recherche à partir d'une adresse de recherche LinkedIn collée, choix d'un projet Recruiter, choix du contrat (Recruiter ou Sales Navigator), liste des invitations envoyées avec retrait, journal des livraisons de notifications avec rejeu (administrateurs de la plateforme).
- Lecture d'agenda : le module existe mais aucune fonction ne l'utilise encore. Rien à faire.
- Anciennes clés : plus lues par aucune fonction (`UNIPILE_API_KEY`, `UNIPILE_DSN`, clés par organisation).

Ce qui n'est pas dans le code : une fenêtre où l'ancien et le nouvel identifiant seraient acceptés ensemble. Après la conversion, un ancien identifiant n'est plus reconnu nulle part. C'est pourquoi les envois automatiques doivent rester en pause pendant l'opération.

---

## 3. Ce qu'il faut avant la bascule

### 3.1 Une clé API v2

1. Ouvrez le tableau de bord du prestataire, version 2 (le plan de juillet l'appelle « Dashboard V2 »).
2. Allez dans votre application, section des clés d'API (« API keys »), et créez une clé.
3. Copiez-la dans un gestionnaire de mots de passe. Elle ne se réaffiche pas.

Non vérifié : les libellés exacts du tableau de bord du prestataire. Si un nom de menu diffère, cherchez « API keys ».

### 3.2 Les secrets à poser dans Supabase

Page : https://supabase.com/dashboard/project/crckfywoyjxkawathdff/settings/functions
Section des secrets des Edge Functions (« Edge Function Secrets »). Pour chaque ligne : « Add new secret », nom, valeur, enregistrer. Les noms s'écrivent exactement comme ci-dessous, en majuscules.

| Nom du secret | Valeur | Obligatoire | Ce qui se passe sans lui |
|---|---|---|---|
| `UNIPILE_V2_API_KEY` | la clé de la partie 3.1 | oui | Tout appel au prestataire est refusé avec le message « La connexion n'est pas configurée sur le serveur ». |
| `UNIPILE_V2_WEBHOOK_TOKEN` | une suite de lettres et de chiffres que vous inventez (40 caractères au hasard par votre gestionnaire de mots de passe, sans espace ni symbole) | oui, en pratique | Le code accepte à la place une valeur dérivée de l'ancien `UNIPILE_WEBHOOK_SECRET`. La page de vérification signale alors « dérivée de l'ancien secret » et recommande une clé dédiée. Sans aucun des deux, toutes les notifications sont refusées (503). |
| `UNIPILE_HOSTED_DOMAIN` | le nom de domaine à votre marque, sans `https://` (exemple : `connect.konekt.fr`, voir partie 4) | oui pour connecter ou reconnecter un compte | Sans lui, la connexion par lien hébergé est refusée (le lien afficherait le nom du prestataire). Les comptes déjà reliés continuent de fonctionner. |
| `CONNECTION_ALLOW_VENDOR_HOSTED_LINK` | à ne pas poser en production | non | Posé à `1`, il autorise le lien sur le domaine du prestataire. Prévu pour les tests locaux. |
| `KONEKT_PLATFORM_ADMIN_USER_IDS` | votre identifiant utilisateur Supabase (et ceux des autres administrateurs de la plateforme), séparés par des virgules, sans espace | oui | La page `/settings/admin/bascule` répond « Accès réservé » à tout le monde. Le journal des livraisons est fermé à tout le monde. L'enregistrement et la suppression des notifications restent ouverts à tout propriétaire ou administrateur d'organisation. |
| `CONNECTION_NATIVE_ENABLED` | ne pas le créer (ou toute valeur autre que `1`) | non | À `1`, les écrans de connexion directe s'activent. Laissez-le éteint au départ. |
| `APP_URL` | déjà posé (`https://konekt-app-navy.vercel.app`) | déjà là | Sert à construire l'adresse de retour après une connexion. S'il manque, le code utilise cette même adresse par défaut. |

Pour trouver votre identifiant utilisateur : Supabase, menu « Authentication », puis « Users », colonne identifiant (UID) de votre ligne. C'est une suite du type `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.

Vous pouvez poser ces secrets **avant** la fusion : l'ancien code déployé aujourd'hui ne s'en sert que pour enregistrer des notifications v2 sur demande. Non confirmé en production : qu'ils n'ont aucun autre effet.

### 3.3 Secrets à retirer à la fin (partie 6, étape 14)

- `UNIPILE_API_KEY` et `UNIPILE_DSN` : plus lus par aucune fonction. La page de vérification les signale « encore définis » tant qu'ils existent.
- `UNIPILE_WEBHOOK_SECRET` : repli de `UNIPILE_V2_WEBHOOK_TOKEN`. Inutile dès que le jeton dédié est posé et que les notifications ont été réenregistrées (étape 7).
- `SEQUENCE_WEBHOOK_SECRET` : plus lu par aucune fonction (recherche dans `supabase/functions` le 12 octobre).
- Les colonnes `unipile_api_key`, `unipile_dsn`, `unipile_connected` de la table `organization_integrations` restent en base, sans lecteur côté serveur. Leur suppression est une migration à faire plus tard.

---

## 4. Le domaine à votre marque

Le code ne peut rendre à votre marque que le **nom de domaine** de la page de connexion (`UNIPILE_HOSTED_DOMAIN`). Le contenu de la page (logo, titre, textes, pied de page) appartient au prestataire. **On ne peut pas le modifier depuis le code.** Tant que ce point n'est pas vérifié par vos yeux, ne présumez pas que la page est sans marque.

### 4.1 Ce qu'il faut demander au prestataire

Demandez par écrit, ou cherchez dans son tableau de bord :
1. Comment enregistrer un domaine à vous (par exemple `connect.konekt.fr`) pour les pages de connexion.
2. Quel enregistrement DNS créer (type, nom, valeur).
3. Si le logo, le nom et les textes de la page de connexion peuvent être retirés ou remplacés, et comment.
4. Si les pages d'erreur et les e-mails éventuels envoyés par le prestataire portent sa marque.

### 4.2 L'enregistrement DNS

1. Connectez-vous là où est géré le domaine `konekt.fr` (votre registrar ou hébergeur DNS).
2. Créez l'enregistrement exact donné par le prestataire (type, nom, valeur). Le type n'est pas connu à l'avance.
3. Dans le tableau de bord du prestataire, lancez la vérification du domaine et attendez qu'elle réussisse. La propagation DNS peut prendre de quelques minutes à quelques heures (délai général des DNS, non mesuré ici).
4. Posez ensuite le secret `UNIPILE_HOSTED_DOMAIN` avec ce nom de domaine.

### 4.3 Comment vérifier que la page ne montre aucune marque du prestataire

Faites ce test après la fusion et avant d'annoncer la bascule à l'équipe.
1. Dans Konekt : Paramètres, puis « Mon compte », puis « Connexions », carte « Mon compte LinkedIn ». Cliquez sur le bouton qui commence par « Continuer vers LinkedIn ».
2. Regardez la barre d'adresse : le nom de domaine doit être le vôtre. Konekt refuse tout lien dont le domaine diffère de `UNIPILE_HOSTED_DOMAIN`.
3. Regardez la page entière : logo, titre de l'onglet du navigateur, titre de la page, boutons, pied de page, mentions « propulsé par ».
4. Refaites le test sur un téléphone et dans une fenêtre de navigation privée.
5. Si vous voyez le nom ou le logo du prestataire, notez la capture d'écran et envoyez-la au prestataire. La connexion directe dans Konekt (`CONNECTION_NATIVE_ENABLED=1`) évite cette page, mais elle n'est pas validée avec un vrai compte (partie 9) et elle fait saisir des mots de passe LinkedIn dans Konekt, ce qui demande votre décision sur la confidentialité.

La page de vérification de la bascule signale un avertissement si le domaine configuré contient le nom du prestataire.

---

## 5. Décisions produit encore ouvertes

Le code a pris une valeur par défaut pour chacune. Aucune ne bloque la bascule, mais lisez-les avant la fusion. Cochez votre choix.

| # | Sujet | Ce que fait le code aujourd'hui | Votre décision |
|---|---|---|---|
| 1 | Retrait d'une invitation et étape d'attente | Retirer une invitation avance la date de l'étape « attendre l'acceptation » pour que la branche « non acceptée » se déclenche. Elle peut envoyer un InMail ou une relance peu après le retrait. Une attente sans délai maximum reste en attente. | [ ] Garder  [ ] Ne plus avancer l'attente (le statut passe seulement à « retirée ») |
| 2 | Recherche Recruiter limitée à un projet | Le sélecteur de projet envoie l'identifiant du projet. Rien ne prouve que le prestataire accepte cet identifiant comme filtre de la recherche. Il faut un appel réel pour trancher. | [ ] Tester avec la vraie clé avant l'ouverture  [ ] Masquer le sélecteur |
| 3 | Solde d'InMails selon la licence | Le solde affiché et le contrôle suivent la licence active du compte (Recruiter, Sales Navigator ou Classic). La signature d'un InMail Recruiter est le nom du profil du membre qui a relié le compte. Si un compte a deux contrats et que leur lecture échoue, la licence reste inconnue et le serveur décide. | [ ] Signature = nom du profil  [ ] Autre source (titre, organisation) |
| 4 | Rattacher un compte non relié (« C'est mon compte », « Lier ») | Un compte qui n'est relié à personne ne peut plus être revendiqué par un membre ni par un administrateur d'organisation, seulement par l'administrateur de la plateforme. Ces deux raccourcis ne servent donc plus qu'à rattacher un compte déjà lié à la même personne. On connecte à la place par « Continuer vers LinkedIn ». | [ ] Accepter  [ ] Rouvrir pour les administrateurs d'organisation |
| 5 | Reconnexion depuis l'extension Chrome | Ne fonctionne plus. L'extension renvoie vers Paramètres, Connexions. Le texte de la page des jetons d'extension dans Paramètres (« reconnecter votre compte LinkedIn en un clic ») est resté et devient faux. | [ ] Corriger le texte (à faire par un développeur)  [ ] Rétablir un chemin dédié plus tard |
| 6 | Adresse de support | Le bouton « Contacter le support » écrit à `l.garilhe@konekt.fr`, une adresse personnelle. | Adresse partagée à utiliser : ____________ |
| 7 | Agents de sourcing continu | Leur contexte contient l'identifiant du compte. Après la conversion, chaque agent LinkedIn s'arrête sur l'erreur « contexte changé » (code `CONTEXT_CHANGED`, texte « Recalibrez l’agent » ou « relancez le calibrage » selon l'écran) et doit être recalibré par son propriétaire avant la prochaine recherche. | [ ] Prévenir les propriétaires d'agents  [ ] Recalibrer vous-même |
| 8 | Propositions de l'assistant en attente | Les propositions d'envoi qui portent un ancien identifiant ne sont pas réécrites. À l'exécution, le compte est relu : elles échouent si le compte a changé. | [ ] Les laisser expirer  [ ] Les annuler avant la conversion |
| 9 | Conversations et messages | Les identifiants de conversation, de fil et de message ne sont pas convertis (aucune source pour les nouvelles valeurs). Si le prestataire les a changés, l'historique des liens candidat/conversation, les catégories de conversations et le cache d'analyse perdent leur lien. Le code retrouve une conversation par le candidat quand c'est possible. | [ ] Accepter le risque  [ ] Tester avec la vraie clé d'abord |
| 10 | Lectures de la messagerie par l'équipe | Lire les conversations et la liste des invitations envoyées reste possible pour tout membre de l'organisation sur tout compte LinkedIn de l'organisation, comme avant. Envoyer un message n'est possible que depuis son propre compte. | [ ] Garder  [ ] Restreindre les lectures au titulaire |
| 11 | Filtres non représentables | Une recherche faite à la main qui utilise un filtre que la v2 ne sait pas exprimer (par exemple un rayon Recruiter) s'exécute sans lui. Le serveur renvoie la liste des filtres écartés, mais aucun écran du site ne la lit aujourd'hui (recherche dans `src/`) : la personne ne le voit pas. Un agent de sourcing continu qui en contient un est arrêté avant toute recherche (message « LinkedIn ne peut pas appliquer ces filtres avec cette licence ») jusqu'à modification de ses filtres. | [ ] Garder  [ ] Faire afficher la liste des filtres écartés  [ ] Laisser les agents chercher plus large |
| 12 | Historiques Outlook | Les historiques de boîtes Outlook sont toujours présentés comme « partiels » dans le contexte des actions candidat. | [ ] Garder  [ ] Lever la limite |
| 13 | Ce qui compte comme une réponse | Une invitation reçue du candidat, ou son refus ou acceptation d'InMail, ne compte plus comme réponse dans l'analyse des messages. | [ ] Garder  [ ] Revenir à l'ancienne règle |
| 14 | Annuaire des entreprises | 85 entreprises de l'annuaire contiennent un nom LinkedIn (slug) à la place d'un identifiant. Le rafraîchissement mensuel en écrit encore. | [ ] Convertir  [ ] Cesser d'en écrire |
| 15 | État « partiel » d'un compte | Un compte partiel n'envoie plus, sans mise en pause des séquences, et la page de connexion propose « Reconnecter ». Le contrat de départ prévoyait « limité, sans bouton ». | [ ] Garder |
| 16 | Non pris en charge par la v2 | Proxy défini par adresse IP (refusé, erreur 400), téléchargement de la photo d'un interlocuteur de messagerie (seule l'adresse de la photo est rendue). | [ ] Accepter |
| 17 | Visites de profil et plafond de vues | Une étape de visite de profil consomme deux places du plafond quotidien de vues (défaut relevé par les tests et visible dans le code). Avec un plafond de 25 vues, environ 12 visites passent au lieu de 25. Aucune donnée n'est perdue. | [ ] Faire corriger avant la fusion  [ ] Accepter pour l'instant |

---

## 6. Le jour de la bascule : ordre des opérations

Choisissez un créneau où personne ne travaille dans Konekt (soir ou week-end). Prévenez l'équipe : pendant l'opération, la messagerie LinkedIn, les envois et la recherche ne fonctionnent pas. La durée dépend du nombre de comptes : la conversion traite un compte à la fois et s'arrête au bout de 30 secondes, il faut alors la relancer (c'est dit à l'écran).

Gardez ces ouvertures dans votre navigateur : GitHub (Pull Request et onglet Actions), Supabase (secrets, éditeur SQL, journaux des fonctions), le tableau de bord du prestataire, Konekt.

### Étape 1. Avant tout : contrôle en lecture seule de la base

1. Ouvrez l'éditeur SQL : https://supabase.com/dashboard/project/crckfywoyjxkawathdff/sql
2. Ouvrez le fichier `supabase/tests/provider_id_columns_check.sql` du dépôt, copiez tout son contenu, collez-le, lancez.
3. Le résultat est une liste triée avec les lignes à examiner en tête. Examinez chaque ligne marquée `A EXAMINER` et les triggers ou fonctions marqués `A LIRE`. Envoyez la liste à l'ingénieur si vous n'êtes pas sûr. Cette requête ne modifie rien et ne dépend d'aucune migration.

Rollback de cette étape : aucun besoin, rien n'a changé.

### Étape 2. Secrets et domaine

Posez les secrets de la partie 3.2 et terminez la partie 4 (le domaine doit être vérifié chez le prestataire et `UNIPILE_HOSTED_DOMAIN` posé).

Rollback : supprimez les secrets ajoutés. L'ancien code ne les utilise pas.

### Étape 3. Mettre les moteurs automatiques en pause

Ce sont les tâches planifiées de la base. Elles parlent au prestataire ou lisent les comptes. Les laisser tourner après la fusion mettrait les séquences en pause (compte déconnecté) et ferait échouer les envois.

1. Dans l'éditeur SQL, lancez d'abord la lecture :
   ```sql
   select jobid, jobname, active from cron.job
   where jobname in (
     'process-sequences-main', 'process-sequences-replies',
     'process-sequences-timeouts', 'process-sequences-wait-events',
     'process-inmail-queue', 'process-scheduled-actions',
     'process-agent-tasks', 'process-enrichment-queue',
     'process-sourcing-agents'
   ) order by jobname;
   ```
2. Notez le résultat (quelles lignes existent, lesquelles sont actives). Les tâches absentes de la liste n'existent pas dans votre base.
3. Pour les mettre en pause :
   ```sql
   select cron.alter_job(jobid, active := false) from cron.job
   where jobname in (
     'process-sequences-main', 'process-sequences-replies',
     'process-sequences-timeouts', 'process-sequences-wait-events',
     'process-inmail-queue', 'process-scheduled-actions',
     'process-agent-tasks', 'process-enrichment-queue',
     'process-sourcing-agents'
   );
   ```
4. Relancez la requête de lecture du point 1 : la colonne `active` doit afficher `f` (faux) partout.

Les noms de tâches viennent des migrations du dépôt. Non vérifiés : la base de production et la version de l'extension de planification qui y tourne. Si la commande `cron.alter_job` est refusée, demandez à l'ingénieur de suspendre les tâches d'une autre façon avant de continuer.

Rollback : même commande avec `active := true`.

### Étape 4. Fusionner la branche

1. Sur GitHub, ouvrez la Pull Request de la branche. Vérifiez que les contrôles automatiques sont verts. Si GitHub signale que la branche n'est plus à jour avec `main`, demandez à l'ingénieur de la mettre à jour et de relancer les contrôles.
2. Cliquez sur la fusion (« Merge »).
3. Ouvrez l'onglet Actions : https://github.com/Lgarilhe/remix-of-event-template/actions
   - « Deploy Supabase Edge Functions » doit finir en vert. Il redéploie toutes les fonctions (le dossier partagé a changé).
   - « Deploy Supabase Migrations » doit finir en vert. Il pose trois migrations (tentatives de connexion, ajout de la colonne de retour, outils de conversion).
   - Si « Deploy Supabase Migrations » échoue avec « Found local migration files to be inserted before the last migration on remote », relancez-le à la main avec l'option `repair_tracking` cochée (voir `CLAUDE.md`, section sur les migrations). Seul un développeur doit le faire.
4. Attendez le déploiement du site (environ 2 minutes, selon `CLAUDE.md`).

À partir d'ici et jusqu'à l'étape 9, la messagerie LinkedIn ne fonctionne pas : le code attend des identifiants `acc_` et la base contient encore les anciens. C'est normal. Enchaînez les étapes 5 à 9 sans attendre.

Rollback à ce stade : sur la Pull Request fusionnée, cliquez sur « Revert ». GitHub crée une Pull Request d'annulation. Fusionnez-la : les workflows redéploient les anciennes fonctions et l'ancien site. Les trois migrations restent en base, elles ajoutent seulement des tables et des fonctions. Ne réactivez les moteurs qu'après la fin du redéploiement. Gardez les anciens secrets et les anciennes notifications (étape 13) jusqu'à la fin de la surveillance : ils rendent ce retour possible.

### Étape 5. Enregistrer les notifications en temps réel

Votre identifiant doit être dans `KONEKT_PLATFORM_ADMIN_USER_IDS`.
1. Dans Konekt : Paramètres, « Mon organisation », « Général », carte « Comptes LinkedIn de l'organisation ».
2. Dans le bloc « Notifications en temps réel », cliquez sur « Activer les notifications en temps réel ». Il crée un seul point de réception chez le prestataire, avec 17 types d'événements, et supprime les doublons éventuels. L'opération est répétable.
3. Si le bloc n'apparaît pas (il n'est affiché que s'il y a au moins un compte LinkedIn listé), prévenez l'ingénieur : le même enregistrement se fait en appelant l'action `register` de la fonction `unipile-manage-webhooks`. Ce chemin n'a pas été essayé en production.

Le bouton Actualiser du bloc et la page de vérification (étape 6) confirment l'état.

Rollback : dans le même bloc, l'icône de corbeille supprime le point de réception (et donc toutes les notifications v2). Les anciennes notifications ne sont pas touchées à ce stade.

### Étape 6. Vérifier

1. Ouvrez https://konekt-app-navy.vercel.app/settings/admin/bascule (connecté avec votre compte administrateur de la plateforme).
2. Bloc « 1. Vérifier », bouton « Vérifier ». Chaque ligne est « OK », « À surveiller » ou « Bloquant ».
3. Lignes attendues : clé configurée, service joignable, domaine configuré, notifications enregistrées avec 17 événements, clé de réception dédiée, liste des administrateurs non vide, outils de bascule installés, comptes rapprochés.
4. Avertissements normaux à ce stade : « Anciennes clés du service : encore définis » (jusqu'à l'étape 14), « Connexion directe : désactivée » (c'est l'état voulu, affiché OK).
5. Corrigez tout « Bloquant » avant d'aller plus loin.

### Étape 7. Comptes absents du nouveau service

1. Dans la même page, bloc « Comptes sans correspondance » : la liste donne, pour chaque compte de la base introuvable dans le nouveau service, le type, un libellé masqué et la raison (« Absent du service », « Plusieurs correspondances », « Type de compte différent »).
2. Pour chacun, demandez à son propriétaire de se reconnecter : Paramètres, « Mon compte », « Connexions », carte du compte, bouton « Continuer vers LinkedIn » (ou WhatsApp, Google, Microsoft). Le test de la partie 4.3 doit être fait avant.
3. Un compte reconnecté reçoit un identifiant tout neuf. Ses séquences, ses InMails programmés et son historique de plafonds restent attachés à l'ancien identifiant et apparaissent ensuite dans la simulation sous « Anciens identifiants sans compte relié ». Ils ne seront pas convertis. Les séquences concernées sont à relancer.
4. Le plan de juillet (`AUDITS/UNIPILE_V2_MIGRATION_PLAN.md`) notait deux comptes LinkedIn absents du nouveau service et une boîte Outlook à rapprocher par adresse e-mail. Ces constats datent du 20 juillet 2026 et ne sont pas revérifiés : la page les recalcule.
5. Relancez « Vérifier » jusqu'à ce que la liste soit vide, ou que vous acceptiez de laisser les comptes restants tels quels (case à cocher à l'étape 9).

### Étape 8. Simuler

1. Bloc « 2. Simuler », bouton « Simuler la conversion des comptes ». Rien n'est écrit.
2. Lisez le tableau : par type de compte (LinkedIn, messagerie, WhatsApp) combien sont en base, déjà convertis, à convertir, non trouvés ; pour chaque compte à convertir, le nombre de lignes réécrites et les notes (agents à recalibrer, propositions de l'assistant, journaux non réécrits).
3. Lisez « Anciens identifiants sans compte relié » : ce sont des identifiants que la conversion ne peut pas apparier.
4. Un message « La liste des comptes du service est tronquée » interdit la conversion : prévenez l'ingénieur.

Rollback : aucun besoin, rien n'a été écrit.

### Étape 9. Convertir

1. Bloc « 3. Convertir », bouton « Convertir les comptes ».
2. Une fenêtre résume le nombre de comptes et de lignes. Si des comptes restent sans correspondance, cochez la case qui les laisse tels quels (ils devront être reconnectés).
3. Tapez le mot `BASCULER` et confirmez. Gardez la page ouverte.
4. La conversion traite chaque compte dans sa propre transaction : si un compte échoue, il reste inchangé. Si le temps imparti (30 secondes) s'écoule, un message dit combien de comptes restent. Relancez la simulation, puis la conversion.
5. À la fin, notez le « Numéro du lot » (bouton « Copier »). Il sert à l'annulation. Il réapparaît aussi dans « Conversions précédentes » après une simulation.
6. Si la réponse n'arrive pas (message « Résultat inconnu »), ne relancez pas : lancez la simulation et regardez « Conversions précédentes ».
7. La page refuse la conversion si la simulation n'est plus à jour (des comptes ont changé entre-temps) : relancez la simulation.

Rollback : dans « Conversions précédentes », bouton « Annuler la conversion » sur le lot, puis tapez `ANNULER`. Les identifiants du lot sont restaurés depuis la sauvegarde, sauf pour une ligne modifiée depuis, et une ligne créée depuis la conversion garde le nouvel identifiant. Les appels du code final échouent alors sur les anciens identifiants : l'annulation sert à revenir en arrière avec le code précédent (voir l'étape 4). Ce retour suppose que l'ancien compte chez le prestataire fonctionne encore, ce qui n'a pas pu être vérifié.

### Étape 10. Remettre les moteurs en marche

Seulement si l'étape 9 est terminée sans comptes en échec.
1. Éditeur SQL, même requête qu'à l'étape 3 avec `active := true`.
2. Relancez la lecture pour vérifier que `active` affiche `t` (vrai) pour les tâches qui étaient actives avant.

### Étape 11. Test de bout en bout

Faites ces tests vous-même, avec votre compte et un candidat de test (vous ou un collègue).
1. Paramètres, Connexions : votre compte LinkedIn s'affiche en état « OK ».
2. Messagerie : la liste des conversations se charge. Envoyez un message au candidat de test.
3. Répondez depuis le compte du candidat de test : la réponse apparaît dans Konekt et arrête la séquence du candidat.
4. Mission, Sourcing : lancez une recherche courte. Ouvrez un profil.
5. Si vous avez un compte Recruiter ou Sales Navigator : vérifiez le choix du contrat (carte de la page Connexions).
6. Si l'e-mail est relié : envoyez un e-mail de test depuis une fiche candidat.
7. Page `/settings/admin/bascule` : « Vérifier » doit être tout vert hors l'avertissement sur les anciennes clés.

Si un test échoue, ne passez pas à l'étape 12. Notez le message exact et l'heure, ouvrez les journaux de la fonction concernée (Supabase, « Edge Functions », la fonction, « Logs ») et envoyez-les à l'ingénieur.

### Étape 12. Surveiller 24 heures

Voir la partie 7. Ne retirez ni les anciens secrets ni les anciennes notifications avant la fin de cette surveillance.

### Étape 13. Supprimer les anciennes notifications

Le nouveau code ne sait plus lister ni supprimer les notifications de l'ancienne version. Elles envoient maintenant vers l'adresse de réception avec l'ancien secret, qui est refusé (401).
1. Ouvrez le tableau de bord du prestataire de l'**ancienne** version (celui de vos clés v1).
2. Section des notifications (« Webhooks »). Supprimez celles qui pointent vers `https://crckfywoyjxkawathdff.supabase.co/functions/v1/unipile-webhook` et vers `.../functions/v1/sequence-webhooks-handler`. L'adresse est déduite de la référence du projet Supabase. Les libellés de ce tableau de bord n'ont pas pu être vérifiés.
3. Ne touchez pas au point de réception de la nouvelle version (créé à l'étape 5).

Rollback : impossible sans recréer les notifications à la main. Faites-le après la surveillance de 24 heures.

### Étape 14. Retirer les anciens secrets

Page des secrets de la partie 3.2. Supprimez `UNIPILE_API_KEY` et `UNIPILE_DSN`. Supprimez aussi `UNIPILE_WEBHOOK_SECRET` et `SEQUENCE_WEBHOOK_SECRET`, à condition que `UNIPILE_V2_WEBHOOK_TOKEN` soit posé et que l'étape 5 ait été refaite depuis. Relancez « Vérifier » : la ligne « Anciennes clés du service » passe à « Retirés ».

À partir d'ici, le retour en arrière n'est plus possible : on avance seulement.

### Étape 15. Quand tout est stable

Faites noter les décisions de la partie 5 dans `LOGBOOK.md`. Supprimer les colonnes d'anciennes clés d'organisation et nettoyer le code mort de l'extension sont des tâches de développeur, à planifier.

---

## 7. À surveiller pendant les 24 premières heures

À chaque contrôle, notez l'heure et ce que vous voyez.

| Où | Quoi | Ce qui doit se passer | Si ce n'est pas le cas |
|---|---|---|---|
| `/settings/admin/bascule`, « Vérifier » | Notifications enregistrées, clé de réception, comptes | Tout OK. | Relancez l'enregistrement des notifications (étape 5). |
| Paramètres, Général, bloc « Notifications en temps réel » | Journal des livraisons (visible aux administrateurs de la plateforme) | Les dernières livraisons sont « délivrées ». | Une livraison en échec peut être rejouée par le bouton « Rejouer ». Une livraison déjà reçue ne se rejoue pas. |
| Supabase, Edge Functions, `unipile-webhook`, Logs | Messages `Invalid webhook authentication` ou `No delivery token configured` | Aucun. | Le jeton de l'adresse ne correspond pas au secret : refaites l'étape 5. |
| Supabase, Edge Functions, `unipile-webhook`, Logs | `Ignored: event without a v2 account id` | Rare. | Un événement de l'ancienne génération arrive encore : vérifiez l'étape 13. |
| Supabase, Edge Functions, `process-sequences`, Logs | `au format obsolète` | Aucun après la conversion. | Un compte n'a pas été converti : voir la page de bascule. |
| Éditeur SQL | `select pause_reason, count(*) from public.sequence_enrollments where status = 'paused' group by 1 order by 2 desc;` | Pas de hausse brutale du motif `account_disconnected`. | Les membres concernés se reconnectent ; leurs inscriptions reprennent à la reconnexion. |
| Éditeur SQL | `select event_type, count(*) from public.webhook_event_log where received_at > now() - interval '24 hours' group by 1 order by 2 desc;` | Des `message.new` et des `account.status.*` apparaissent. | Aucune ligne après plusieurs heures : les notifications n'arrivent pas, voir ci-dessus. |
| Sidebar et page Connexions | Comptes en état dégradé, partiel ou verrouillé | Rares. Un compte dégradé ou verrouillé n'envoie plus, sans mettre les séquences en pause. | Un compte partiel ou déconnecté : son propriétaire clique sur « Reconnecter ». |
| Séquences | Envois, réponses, acceptations d'invitations | Mêmes volumes qu'avant. | Comparez avec la semaine précédente avant de conclure. |
| Agents de sourcing | Erreur « contexte changé » (`CONTEXT_CHANGED`), texte « Recalibrez l’agent » ou « relancez le calibrage » | Attendu après la conversion. | Faites recalibrer l'agent (décision 7). |
| Plafonds LinkedIn | Page Équipe, « Plafonds du jour » | Les compteurs repartent de leur historique (colonne convertie). | Si les compteurs repartent de zéro, un compte n'a pas été converti. |

Ce qui change dans les plafonds : la v2 ne donne plus de pourcentage d'usage. L'ancien arrêt à 90 % n'existe plus. Konekt compte lui-même ses envois, et met le compte en pause pour la journée si le prestataire dit qu'une limite est atteinte.

---

## 8. Retour en arrière, résumé

| Où en êtes-vous | Que faire | Coût |
|---|---|---|
| Avant l'étape 4 (rien fusionné) | Supprimer les secrets ajoutés, réactiver les tâches planifiées si vous les aviez suspendues. | Aucun. |
| Après la fusion, avant la conversion (étapes 4 à 8) | Annuler la fusion (« Revert »), attendre le redéploiement, réactiver les tâches planifiées, supprimer le point de réception v2 si besoin. Les anciens secrets et les anciennes notifications existent encore. | Messagerie coupée pendant l'opération. |
| Après la conversion (étape 9 à 12) | « Annuler la conversion » avec le numéro du lot, puis annuler la fusion, puis réactiver les moteurs. | Les lignes créées depuis la conversion gardent le nouvel identifiant. Le retour suppose que l'ancien compte du prestataire répond encore (non vérifié). |
| Après l'étape 13 ou 14 | Aller de l'avant seulement. Corriger le problème, ne pas revenir. | Retour impossible sans recréer les notifications et les secrets à la main. |

---

## 9. Ce qui n'a pas pu être vérifié sans clé réelle

Rien de ce code n'a été essayé contre le vrai service v2 : aucune clé n'était disponible pour la rédaction de ce guide. Les tests utilisent un faux prestataire écrit à partir de la spécification publiée. Ce qui suit est donc supposé et doit être confirmé par un essai réel (liste détaillée dans `docs/unipile-v2-architecture.md`, partie 10) :

- Les formats d'identifiants acceptés pour désigner une personne (nom court du profil, identifiant du prestataire, identifiant Recruiter commençant par `AE`).
- Les corps des erreurs (mauvais mot de passe, code faux, limite atteinte, déjà en relation, déjà invité).
- Les contenus réels des notifications autres que `message.new`, et l'absence de signature de livraison (seul le jeton de l'adresse prouve l'origine).
- L'identité entre les anciens et les nouveaux identifiants de personnes, de conversations et de messages.
- Le contenu de la page de connexion hébergée (partie 4).
- La compatibilité des identifiants de projets Recruiter avec le filtre de recherche.
- Les écrans de connexion directe (QR, codes de vérification, validation dans l'application).
- Le nom exact des menus du tableau de bord du prestataire et de Supabase cités dans ce guide.

---

## 10. Glossaire

- **Clé API** : mot de passe d'application. Une seule pour tout Konekt avec la v2.
- **Secret** : valeur gardée côté serveur, que le navigateur ne voit jamais. Se pose dans Supabase.
- **Notification en temps réel (webhook)** : message que le prestataire envoie à Konekt quand quelque chose se passe (réponse d'un candidat, invitation acceptée, compte déconnecté).
- **Jeton** : suite secrète placée dans l'adresse de réception. Sans elle, une notification est refusée.
- **Point de réception** : l'adresse unique chez le prestataire qui envoie ses notifications à Konekt.
- **Lien hébergé** : page de connexion tenue par le prestataire, ouverte depuis Konekt, qui renvoie ensuite vers Konekt.
- **Domaine à votre marque** : nom de domaine à vous (par exemple `connect.konekt.fr`) sous lequel s'ouvre cette page.
- **Identifiant de compte** : code qui désigne un compte relié. Ancien format sans préfixe, nouveau format `acc_...`.
- **Conversion (ou bascule des identifiants)** : remplacement, dans toute la base, de l'ancien identifiant de chaque compte par le nouveau.
- **Simulation** : calcul de la conversion sans rien écrire.
- **Lot** : une conversion appliquée. Son numéro permet de l'annuler.
- **Moteur** : tâche automatique qui tourne seule (envoi des séquences, file d'InMails, vérification des réponses). Aussi appelée tâche planifiée ou cron.
- **Licence** : abonnement LinkedIn du compte (Classic, Recruiter, Sales Navigator). Recruiter et Sales Navigator s'excluent sur un même compte en v2.
- **InMail** : message LinkedIn payant à un inconnu, décompté d'un solde de crédits.
- **Compte dégradé, partiel, verrouillé** : nouveaux états v2. Le compte n'envoie plus tant qu'il n'est pas revenu à « OK ».

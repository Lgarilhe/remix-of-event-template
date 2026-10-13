# Bascule vers la nouvelle connexion LinkedIn et messagerie (API v2) : guide du propriétaire

Public : le propriétaire de Konekt, sans connaissance technique. Les étapes disent où cliquer et quoi coller.
Version du code décrite : branche `ccr-6c73a178-thbl61`, jusqu'au commit `b7ed89d` (deuxième série de correctifs) et la troisième série qui le suit sur la même branche (la plupart des changements de la bascule sont dans `7c1e042`, `1cbb8ec`, `1bcdac6`, `67c8953`, `9c1f537`). Document rédigé le 12 octobre 2026, puis complété le même jour avec le relevé du tableau de bord du prestataire (partie 3.0), les conclusions de la revue indépendante du port des tests, la lecture du code déployé de `jarvis-whatsapp` (partie 3.3), les limites de débit (partie 3.4), le menu de liaison de comptes du tableau de bord (partie 4.5) et l'écran de consentement Google et Microsoft (décisions 24 et 25 de la partie 5), puis avec la répétition de la bascule sur une copie locale de la base avec des données fictives (étapes 5 à 9, parties 7 et 9). Mis à jour le 13 octobre 2026 après les deuxième et troisième séries de correctifs : décisions 6, 10, 11, 15 et 19 de la partie 5, cinq migrations à l'étape 4, bouton d'annulation d'un ancien lot (étape 9), alertes d'état de compte (partie 7).

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
- Connexion d'un compte par un lien hébergé par le prestataire, soit sur un domaine à votre marque (option B de la partie 4), soit, pour le lancement, sur l'adresse du prestataire avec l'habillage réglé dans son tableau de bord (option A), avec une page de retour Konekt (`/settings/account/connections/retour`). Chaque tentative est enregistrée (table `connection_attempts`, durée de vie 30 minutes).
- Connexion directe (identifiants saisis dans Konekt, QR code, codes de vérification) : écrite et testée avec un faux prestataire, mais **désactivée** par défaut.
- Les nouveaux états de compte (dégradé, partiel, verrouillé) arrêtent les envois sans mettre les séquences en pause. Le membre est prévenu pour « partiel » et « verrouillé » (décision 15 de la partie 5).
- La limite proactive de 90 % n'existe plus dans la v2. Les plafonds reposent sur le compteur de Konekt, plus une pause de la journée si le prestataire signale une limite atteinte.
- Un envoi dont le résultat est incertain (délai dépassé, erreur du serveur) n'est jamais compté comme envoyé et n'est jamais renvoyé.
- Outil de bascule des identifiants : fonction `unipile-migration`, page `/settings/admin/bascule`, fonctions SQL de conversion et d'annulation, sauvegarde ligne par ligne.
- Nouveautés utilisables après la bascule : recherche à partir d'une adresse de recherche LinkedIn collée, choix d'un projet Recruiter, choix du contrat (Recruiter ou Sales Navigator), liste des invitations envoyées avec retrait, journal des livraisons de notifications avec rejeu (administrateurs de la plateforme).
- Lecture d'agenda : le module existe mais aucune fonction ne l'utilise encore. Rien à faire.
- Anciennes clés : plus lues par aucune fonction du dépôt (`UNIPILE_API_KEY`, `UNIPILE_DSN`, clés par organisation). Une fonction qui n'est pas dans le dépôt, `jarvis-whatsapp` (votre assistant WhatsApp personnel), les lit encore et appelle l'ancienne API : ses secrets restent donc en place, voir 3.3.
- Défaut corrigé depuis la première version de ce guide : une étape de visite de profil ne consomme plus qu'une place du plafond quotidien de vues (commit `6c1598f`, voir la décision 17 de la partie 5).

Ce qui n'est pas dans le code : une fenêtre où l'ancien et le nouvel identifiant seraient acceptés ensemble. Après la conversion, un ancien identifiant n'est plus reconnu nulle part. C'est pourquoi les envois automatiques doivent rester en pause pendant l'opération.

---

## 3. Ce qu'il faut avant la bascule

### 3.0 Ce que contient le tableau de bord du prestataire (relevé du 12 octobre 2026)

Relevé fait par le propriétaire, en lecture seule, dans le tableau de bord du prestataire. Le code n'a rien confirmé de ceci (aucune clé disponible pour les essais). Le tableau de bord contient trois applications.

| Application | Comptes | Points de réception des notifications | Clés | Page de connexion (habillage) |
|---|---|---|---|---|
| Dashboard / Development | 0 | 0 | 3 clés de service : « test » (02/06/2026), « Migration claude code » (21/07/2026), « Notion mcp » (26/07/2026) | Déjà réglé : nom Konekt, logo, couleur #000000, forme Pill, police Roboto |
| Dashboard / Production | 0 | aucun | aucune | Réglages par défaut |
| **Konekt app / Production** | **4** | **4** | 4 clés de service : « n8n », « Linkedin - Unipile », « Notion - mcp », « Jarvis ». Clés de niveau compte : « konekt-edge-prod » (deux, 24/09/2026) et trois clés Outlook (05/10/2026) | Réglages par défaut : nom et logo vides, couleur #000000, forme Rounded, police system-ui |

Dans « Konekt app / Production », qui est l'application réelle :
- Les 4 comptes : LinkedIn Laurent GARILHE (opérationnel), Outlook l.garilhe@konekt.fr (opérationnel), LinkedIn Guillaume Valladier (demande une authentification), un numéro WhatsApp (demande une authentification) qui n'a aucune ligne dans la base de Konekt.
- Les 4 points de réception sont actifs et sans nom : trois pointent vers l'hôte n8n du propriétaire, un vers le projet Supabase de Konekt. Ce dernier suit 23 événements, une liste plus ancienne que les 17 du code d'aujourd'hui.
- Les liens d'aide, de confidentialité et de conditions sont vides partout. Aucun domaine personnalisé n'est vérifié nulle part.

Autres pages relevées le même jour dans « Konekt app / Production » (lecture seule, à la main, sans passage par le code) :
- Page « Rate limits » (limites de débit) : des valeurs recommandées sont affichées pour LinkedIn. Détail et conséquences en 3.4.
- Page « OAuth configuration » : pour Google, la configuration par défaut utilise l'application Google du prestataire. Détail en décision 24 de la partie 5. La partie Microsoft n'a pas été regardée.
- Page « Scopes » : vide. Les scopes servent à isoler comptes et clés par périmètre. Konekt n'en utilise pas et il ne faut en créer aucun pour cette bascule (voir `docs/unipile-v2-architecture.md`, partie 4, point 7).
- Page « Accounts », menu de liaison d'un compte : trois entrées. Conseil en 4.5.

La base de production de Konekt liste 5 comptes LinkedIn et 1 boîte e-mail. Il manque donc environ 3 comptes LinkedIn de Konekt dans l'application v2 (la page de bascule les liste, étape 7).

**Les comptes ont été reliés de nouveau depuis juillet.** Les identifiants de compte vus dans le tableau de bord le 12 octobre 2026 (LinkedIn Laurent GARILHE, Outlook l.garilhe@konekt.fr, LinkedIn Guillaume Valladier, le numéro WhatsApp) ne sont pas ceux notés en juillet dans `AUDITS/UNIPILE_V2_MIGRATION_PLAN.md`. Ces comptes ont donc été reliés une nouvelle fois. Or la conversion retrouve un compte LinkedIn ou WhatsApp **uniquement** par l'ancien identifiant que le prestataire a gardé dans le compte v2 (`metadata.v1_account_id`), et une boîte e-mail par son adresse (`unipile-migration/plan.ts`, fonction `buildPlan`, vérifié). Un compte LinkedIn relié de nouveau n'a probablement plus cet ancien identifiant : il sera annoncé « Absent du service ». La boîte Outlook, elle, se retrouve par son adresse. Conséquence et marche à suivre aux étapes 7 et 8. Non vérifié : la présence ou l'absence de `metadata.v1_account_id` sur chacun de ces comptes (il faut un appel avec la clé, ou le tableau de bord de l'application, ou la page de bascule à l'étape 7).

Ce qu'il en découle, et où c'est traité :

| # | Conclusion | Où |
|---|---|---|
| a | Utilisez l'application « Konekt app / Production ». Vérifiez que la clé posée dans le secret Supabase en vient. Ne créez et ne supprimez aucune clé pour cela. | 3.1, étapes 2 et 6 |
| b | L'habillage de la page de connexion existe dans « Dashboard / Development » : à recopier vers « Konekt app / Production », liens à renseigner, résultat à regarder. | 4.1 |
| c | Deux façons de lancer l'adresse de la page de connexion : domaine à votre marque, ou, d'abord, adresse du prestataire avec l'habillage. | 4.2 |
| d | Le point de réception de Konekt (23 événements) se met à jour par l'enregistrement des notifications. Les trois points n8n ne sont jamais touchés. | étape 5 |
| e | La fonction `jarvis-whatsapp`, hors dépôt, utilise l'ancienne clé et l'ancienne API (code déployé lu le 12 octobre 2026) : les anciens secrets restent en place tant qu'elle vit, et l'étape 14 devient conditionnelle. | 3.3, étape 14 |
| f | Comptes à reconnecter après la conversion : les deux affichés, environ 3 LinkedIn absents de la v2, et probablement tout compte LinkedIn relié de nouveau depuis juillet (ligne k). | étape 7 |
| g | Le numéro WhatsApp qui demande une authentification est celui qu'utilise Jarvis. Il n'est pas un compte Konekt : aucune action de Konekt. | ci-dessous, 3.3 |
| h | Les limites de débit du prestataire (page « Rate limits ») peuvent bloquer des recherches et des lectures de profil dès 100 appels par jour et par compte. À régler avant le jour de la bascule. | 3.4, partie 7 |
| i | L'écran de consentement Google, avec la configuration par défaut, affiche le nom du prestataire à la personne qui relie une boîte Gmail. | décisions 24 et 25, partie 5 |
| j | Un compte relié depuis le tableau de bord du prestataire n'est pas rattaché par Konekt : à réserver au dépannage. | 4.5 |
| k | Les comptes ont été reliés de nouveau depuis juillet : un compte LinkedIn probablement sans ancien identifiant sera annoncé « Absent du service ». | 3.0 ci-dessus, étapes 7 et 8 |

Point g. Ce numéro n'a pas de ligne dans la table `member_whatsapp_accounts` (relevé du 12 octobre, base non interrogée par le code) : la conversion des identifiants ne le touche pas et aucune fonction de Konekt ne l'utilise. D'après la lecture du code déployé de `jarvis-whatsapp` faite le 12 octobre 2026 (voir 3.3), c'est le numéro de votre assistant WhatsApp personnel. Konekt n'a rien à faire pour ce compte et ne le reconnecte pas. L'authentification demandée dans le tableau de bord se traite dans le chantier séparé « porter Jarvis vers la nouvelle version » (3.3), et seulement sur votre décision. Non vérifié : si l'ancienne API sert encore ce numéro aujourd'hui, et ce que le prestataire fera de l'ancienne API après la bascule (architecture, partie 10, ligne 21).

Les workflows n8n du propriétaire appellent aussi l'API du prestataire, avec leur propre clé de service. Ils sont hors du périmètre de cette bascule : Konekt ne les voit pas et ne les modifie pas.

### 3.1 La clé API v2

Pour cette bascule, **ne créez aucune clé et n'en supprimez aucune.**

1. L'application à utiliser est « Konekt app / Production » : c'est la seule qui contient des comptes (partie 3.0). « Dashboard / Development » et « Dashboard / Production » ne servent pas.
2. Le secret `UNIPILE_V2_API_KEY` est probablement déjà posé dans Supabase : l'ancien code de Konekt le lisait déjà (`CLAUDE.md`, tableau des secrets). Non vérifié : sa présence et l'application dont il vient. La valeur d'une clé existante ne se réaffiche pas dans le tableau de bord du prestataire, inutile de la chercher.
3. Le contrôle se fait à l'étape 6, sur la page `/settings/admin/bascule`, bloc « 1. Vérifier ». La ligne « Clé du service de connexion » dit si la clé est posée. La ligne « Service de connexion joignable » dit si la clé fonctionne et combien de comptes elle voit. Résultat attendu : **4 comptes**. Avec 0 compte, la clé vient d'une application vide. Si le service « refuse la clé », elle est périmée, supprimée ou d'un autre niveau : Konekt a besoin d'une clé de service de l'application, car la liste des comptes, les notifications et les liens de connexion sont des appels d'application. Comportement d'une clé limitée à un compte : non vérifié.
4. Si le résultat n'est pas 4 comptes, n'allez pas plus loin que l'étape 6 et prévenez l'ingénieur. Ne créez et ne supprimez rien vous-même. Choisir la clé à poser se décide ensuite avec la vue du tableau de bord : comme une valeur existante ne se réaffiche pas, il faudra peut-être en créer une nouvelle dans « Konekt app / Production », mais pas avant cette décision.
5. Le code relit la clé à chaque appel (`supabase/functions/_shared/unipile/config.ts`), sans la garder en mémoire. Non vérifié : le délai avec lequel Supabase met à disposition un secret modifié. Relancez « Vérifier » après quelques minutes.

Non vérifié : les libellés exacts du tableau de bord du prestataire. Si un nom de menu diffère, cherchez « API keys ».

### 3.2 Les secrets à poser dans Supabase

Page : https://supabase.com/dashboard/project/crckfywoyjxkawathdff/settings/functions
Section des secrets des Edge Functions (« Edge Function Secrets »). Pour chaque ligne : « Add new secret », nom, valeur, enregistrer. Les noms s'écrivent exactement comme ci-dessous, en majuscules.

| Nom du secret | Valeur | Obligatoire | Ce qui se passe sans lui |
|---|---|---|---|
| `UNIPILE_V2_API_KEY` | la clé déjà posée, à contrôler à l'étape 6 (partie 3.1). Ne la remplacez pas avant ce contrôle. | oui | Tout appel au prestataire est refusé avec le message « La connexion n'est pas configurée sur le serveur ». |
| `UNIPILE_V2_WEBHOOK_TOKEN` | une suite de lettres et de chiffres que vous inventez (40 caractères au hasard par votre gestionnaire de mots de passe, sans espace ni symbole) | oui, en pratique | Le code accepte à la place une valeur dérivée de l'ancien `UNIPILE_WEBHOOK_SECRET`. La page de vérification signale alors « dérivée de l'ancien secret » et recommande une clé dédiée. Sans aucun des deux, toutes les notifications sont refusées (503). |
| `UNIPILE_HOSTED_DOMAIN` | le nom de domaine à votre marque, sans `https://` (exemple : `connect.konekt.fr`, voir partie 4, option B) | oui pour connecter ou reconnecter un compte, sauf si vous lancez avec l'option A de la partie 4 | Sans lui et sans `CONNECTION_ALLOW_VENDOR_HOSTED_LINK`, la connexion par lien hébergé est refusée (le lien afficherait le nom du prestataire). Les comptes déjà reliés continuent de fonctionner. |
| `CONNECTION_ALLOW_VENDOR_HOSTED_LINK` | `1` pour l'option A de la partie 4 (lancement avec l'adresse du prestataire et son habillage). Choix **temporaire** : à retirer dès que `UNIPILE_HOSTED_DOMAIN` est posé. | oui avec l'option A, sinon non | Posé à `1` et sans domaine configuré, il autorise le lien de connexion sur l'adresse du prestataire. Les commentaires du code (`connection.ts`, `connection-steps.ts`) le disent réservé aux tests locaux et à la pile e2e : le choix du lancement les rend inexacts, un développeur doit les corriger si vous le gardez. |
| `KONEKT_PLATFORM_ADMIN_USER_IDS` | votre identifiant utilisateur Supabase (et ceux des autres administrateurs de la plateforme), séparés par des virgules, sans espace | oui | La page `/settings/admin/bascule` répond « Accès réservé » à tout le monde. Le journal des livraisons est fermé à tout le monde. L'enregistrement et la suppression des notifications restent ouverts à tout propriétaire ou administrateur d'organisation. |
| `CONNECTION_NATIVE_ENABLED` | ne pas le créer (ou toute valeur autre que `1`) | non | À `1`, les écrans de connexion directe s'activent. Laissez-le éteint au départ. |
| `APP_URL` | déjà posé (`https://konekt-app-navy.vercel.app`) | déjà là | Sert à construire l'adresse de retour après une connexion. S'il manque, le code utilise cette même adresse par défaut. |

Pour trouver votre identifiant utilisateur : Supabase, menu « Authentication », puis « Users », colonne identifiant (UID) de votre ligne. C'est une suite du type `xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx`.

Vous pouvez poser ces secrets **avant** la fusion : l'ancien code déployé aujourd'hui ne s'en sert que pour enregistrer des notifications v2 sur demande. Non confirmé en production : qu'ils n'ont aucun autre effet.

### 3.3 Secrets à retirer à la fin (partie 6, étape 14)

**Les secrets `UNIPILE_API_KEY` et `UNIPILE_DSN` doivent rester dans Supabase tant que la fonction `jarvis-whatsapp` existe sous sa forme actuelle.** L'étape 14 en dépend.

Ce que l'on sait de cette fonction. Elle est déployée dans le projet Supabase de production et n'est pas dans le dépôt (aucun dossier de ce nom sous `supabase/functions`, vérifié le 12 octobre 2026). Son code déployé a été lu en lecture seule le même jour, hors de ce dépôt : le code n'est pas relisible depuis le dépôt, ce qui suit vient de cette lecture. C'est votre assistant WhatsApp personnel, ce n'est pas du code du produit Konekt (les migrations `20260713153549_jarvis_whatsapp_foundation.sql` et `20260713154226_jarvis_kb_search_rpc.sql` parlent d'un « Jarvis WhatsApp 24/7 » et de tables `jarvis_*`). Elle :
- lit les secrets `UNIPILE_API_KEY` et `UNIPILE_DSN` ;
- appelle des chemins de l'ancienne API (`/api/v1/...`) ;
- écrit dans une conversation WhatsApp fixe, désignée par son ancien identifiant de conversation ;
- peut lire votre boîte e-mail par l'ancien identifiant de compte ;
- reçoit ses notifications dans l'ancien format, par un jeton placé dans son adresse ;
- contient en clair, dans son code, un jeton d'accès. La valeur n'est écrite nulle part dans ce guide, ne la copiez pas dans un message ni dans un document.

Les secrets d'un projet Supabase sont communs à toutes les fonctions : retirer ces deux secrets casserait Jarvis sans aucune alerte dans Konekt.

Ce que cela change pour la bascule :
1. **Étape 14 conditionnelle.** Ne retirez `UNIPILE_API_KEY` et `UNIPILE_DSN` que le jour où Jarvis est porté vers la nouvelle version ou arrêté. Jusque-là, elles restent, et la page de vérification continue de les signaler « encore définis » : c'est attendu.
2. **Deux autres secrets à ne pas retirer sans contrôle.** L'étape 14 retire aussi `UNIPILE_WEBHOOK_SECRET` et `SEQUENCE_WEBHOOK_SECRET`. Non vérifié : lequel des secrets Supabase, s'il y en a un, protège l'adresse de réception de Jarvis (la lecture dit seulement « un jeton dans l'adresse »). Demandez à l'ingénieur de relire le code de Jarvis pour ces deux noms avant de les retirer.
3. **L'étape 13 ne doit pas toucher les notifications de Jarvis.** Elle supprime seulement celles de l'ancienne version qui pointent vers les fonctions `unipile-webhook` et `sequence-webhooks-handler`. Celle qui pointe vers `jarvis-whatsapp` reste.
4. **Ne l'ajoutez pas au dépôt avant d'avoir décidé de la porter.** Le workflow de déploiement redéploie toute fonction qui a un dossier dans le dépôt, et toutes les fonctions quand le dossier partagé `_shared/` change (c'est le cas de cette fusion). Une copie de Jarvis dans le dépôt écraserait la version en production au moment de la fusion. Tant qu'elle n'y est pas, la fusion ne la touche pas (vérifié dans `.github/workflows/deploy-edge-functions.yml` : seuls les dossiers présents sont déployés).
5. **Rien dans la conversion ne touche Jarvis.** Son numéro n'a pas de ligne dans la base de Konekt (partie 3.0, point g). Non vérifié : ce que le prestataire fait de l'ancienne API et de l'ancien compte après la bascule. Jarvis peut cesser de fonctionner de ce côté, indépendamment de Konekt.

Deux chantiers distincts, hors de cette bascule :
- **À faire avant tout, indépendamment du reste : le jeton en clair.** Demandez à l'ingénieur de le déplacer dans un secret Supabase (par exemple `JARVIS_ACCESS_TOKEN`, nom à choisir), de faire lire ce secret par la fonction, puis de **changer la valeur du jeton** : l'ancienne valeur est à considérer comme exposée, puisqu'elle figure dans le code de la fonction.
- **Porter Jarvis vers la nouvelle version (seulement sur votre décision).** Cela demande : reconnecter le numéro WhatsApp dans le nouveau service par QR code (nouvel identifiant de compte, nouvel identifiant de conversation), réécrire les appels de Jarvis pour la v2, recevoir les notifications dans le nouveau format (`message.new`, enveloppe décrite dans `docs/unipile-v2-architecture.md`, partie 6), et refaire l'accès à votre boîte e-mail avec le nouvel identifiant. Le tableau de bord du prestataire est le bon endroit pour relier ce numéro, justement parce que Konekt ne doit pas le rattacher (voir 4.5). Quand ce chantier est fait, ajoutez la fonction au dépôt si vous le souhaitez, puis seulement retirez les anciens secrets (étape 14). Non essayé.

Les workflows n8n du propriétaire utilisent leur propre clé de service (partie 3.0) et non ces secrets Supabase : ils sont hors de ce point.

- `UNIPILE_API_KEY` et `UNIPILE_DSN` : plus lus par aucune fonction du dépôt. La page de vérification les signale « encore définis » tant qu'ils existent.
- `UNIPILE_WEBHOOK_SECRET` : repli de `UNIPILE_V2_WEBHOOK_TOKEN`. Inutile dès que le jeton dédié est posé et que les notifications ont été réenregistrées (étape 5).
- `SEQUENCE_WEBHOOK_SECRET` : plus lu par aucune fonction (recherche dans `supabase/functions` le 12 octobre).
- Les colonnes `unipile_api_key`, `unipile_dsn`, `unipile_connected` de la table `organization_integrations` restent en base, sans lecteur côté serveur. Leur suppression est une migration à faire plus tard.

### 3.4 Les limites de débit du prestataire (à régler avant le jour de la bascule)

Pourquoi c'est important. Le prestataire applique des limites par compte et par route (une route = un type d'appel : lire un profil, envoyer une demande de relation, etc.), réglées par réseau (LinkedIn, e-mail...). Chaque route a ses propres compteurs pour chaque compte relié. Konekt lit beaucoup LinkedIn (recherches, lectures de profil pour la notation) et son moteur de séquences traite un refus pour limite comme un signal :

| Ce que le prestataire répond | Genre d'erreur dans Konekt | Ce que fait Konekt |
|---|---|---|
| Un refus qui parle d'un quota (limite quotidienne ou hebdomadaire, invitations, InMails, crédits) | `provider_limit` | Le **compte est mis en pause** (`quota_paused_until` = maintenant + 16 heures) : plus aucun envoi de séquence, d'InMail ou d'enrichissement depuis ce compte pendant ce temps. L'usage enregistré du compte passe à 100 %. |
| Un refus de débit générique (« trop de requêtes ») | `rate_limited` | Le compte **n'est pas** mis en pause. L'étape de séquence est reportée sans essai consommé : au prochain jour ouvré à 9 h (heure du membre), et à **lundi prochain à 9 h** pour une demande de relation. |
| Dans les deux cas, pour une recherche ou une lecture lancée à la main | `rate_limited` ou `provider_limit` | Le membre voit « Limite LinkedIn atteinte. Espacez vos requêtes et réessayez plus tard. » |

(Vérifié dans `supabase/functions/_shared/unipile/errors.ts`, fonction `classifyError` ; `process-sequences/index.ts`, fonctions `isRateLimitError` et `getRateLimitRetryDate`, et le traitement d'un résultat d'envoi refusé vers la ligne 3735 ; `_shared/linkedin-quotas.ts`, `recordUsageSignal` et `quotaPauseUntilTomorrow` ; `unipile-search/responses.ts`.) Le client de Konekt ne rejoue jamais un envoi refusé (demande non répétable) : le moteur le reporte. Non vérifié : le texte réel du refus du prestataire pour une limite de débit, donc dans quel genre il tombe. Il faut un appel réel pour le savoir.

Ce que la page « Rate limits » affichait le 12 octobre 2026 pour LinkedIn, toutes valeurs étiquetées « recommended » (libellés tronqués sur la capture) :
- toutes méthodes : 10 par minute et 100 par jour ;
- lire une société et lire un utilisateur : 1 par seconde chacune ;
- envoyer une demande de relation : 50 par jour ;
- une autre route d'envoi : 1 par 10 secondes.

Non vérifié : si ces valeurs sont déjà enregistrées et actives pour l'application, ou seulement proposées à l'écran. Non vérifié : si « toutes méthodes » s'applique à chaque route ou à l'ensemble du compte.

Comparaison avec ce que Konekt fait. Plafonds par défaut de Konekt par compte et par jour (`DEFAULT_USER_QUOTAS` et `WEEKLY_INVITE_LIMIT` de `_shared/linkedin-quotas.ts`) : 80 actions visibles (invitations, messages, InMails, messages intelligents et validations de compétences cumulés), 100 lectures de profil, 100 recherches, 40 InMails, et 100 demandes de relation par semaine. Ces plafonds sont réduits à 25, 50 puis 75 % pendant les trois premières semaines d'un compte récent, et le code lit aussi des plafonds propres à chaque membre (fonction `getUserQuotas`) dont les valeurs de production n'ont pas été relevées. Le registre de Konekt ne compte que sept types d'action : il ne voit pas, par exemple, la liste des conversations ni l'aide à la saisie des filtres. Un compte qui atteint ses plafonds de Konekt dans la journée dépasse donc largement 100 appels. Le transport de Konekt n'a pas de limiteur de débit global (architecture, partie 1) : il se contente de reprendre 2 fois au plus un appel répétable (une lecture, par exemple) refusé en 429.

Aucun chiffre recommandé n'est donné ici. Le bon réglage dépend de l'usage réel, et l'usage réel n'a pas pu être mesuré sans clé réelle. C'est à vous de choisir, avec ce que vous voyez à l'usage.

1. Ouvrez le tableau de bord du prestataire, application « Konekt app / Production », page « Rate limits » (libellé du 12 octobre ; s'il a changé, cherchez « Rate limits »). Choisissez le réseau LinkedIn.
2. Notez, pour chaque route, la valeur affichée et si elle est enregistrée ou seulement proposée. Recopiez le tout dans `LOGBOOK.md` avec la date, avant de changer quoi que ce soit.
3. Limite « toutes méthodes » par jour : relevez-la **au-dessus de l'usage réel** d'un compte actif sur une journée de travail (recherches, lectures de profil pour la notation, messagerie, séquences). 100 appels par jour et par compte s'épuisent en une journée de recherche et de notation. Choisissez la valeur avec ce que vous attendez de vos membres les plus actifs, puis revoyez-la après les 24 premières heures.
4. Limite « toutes méthodes » par minute et limites par seconde (lecture d'un utilisateur, d'une société) : laissez-les assez larges pour une recherche suivie de lectures de profil en rafale. Non vérifié : la cadence réelle des lectures de profil pendant une notation de masse.
5. Actions risquées (demande de relation, envoi de message) : gardez des limites strictes. Mais une limite du prestataire plus basse que le plafond de Konekt devient le plafond réel : l'étape est alors reportée (à lundi pour une demande de relation) ou le compte mis en pause, au lieu d'être arrêtée proprement par Konekt. Exemple relevé : le prestataire propose 50 demandes de relation par jour, alors que Konekt autorise jusqu'à 80 actions visibles par jour, invitations comprises (et 100 invitations par semaine). Pour chaque route risquée, choisissez : soit relever la limite du prestataire au moins au niveau de Konekt, soit faire baisser le plafond de Konekt du membre concerné (demandez à l'ingénieur, l'endroit exact dans l'écran n'est pas vérifié). Dans les deux cas, notez le choix dans `LOGBOOK.md`.
6. Enregistrez, puis relisez la page pour confirmer que les valeurs sont bien sauvegardées.
7. Après la bascule, surveillez les refus pendant les 24 premières heures (partie 7, ligne « Refus pour limites »).

Non vérifié : les libellés exacts de la page, la possibilité de modifier chaque valeur, et la prise en compte immédiate d'un changement.

---

## 4. La page de connexion : habillage et adresse

Quand un membre relie un compte, Konekt ouvre une page tenue par le prestataire. Ce que le code de Konekt lui envoie : l'adresse de retour, un état de tentative, les produits LinkedIn autorisés et, si elle est configurée, l'adresse de domaine (`UNIPILE_HOSTED_DOMAIN`). Il ne lui envoie ni nom, ni logo, ni couleur (vérifié dans `supabase/functions/_shared/unipile/accounts.ts`, fonction `buildHostedLinkBody`). Le nom, le logo, la couleur, la forme des boutons, la police et les liens d'aide viennent donc des réglages de l'application dans le tableau de bord du prestataire. La mise en page de la page reste celle du prestataire : **on ne peut pas la modifier depuis le code.** Tant que vous n'avez pas regardé la page de vos yeux (4.4), ne présumez pas qu'elle est sans marque.

### 4.1 L'habillage (à faire dans tous les cas)

État relevé le 12 octobre 2026 : l'habillage est déjà réglé dans « Dashboard / Development » (nom Konekt, logo, couleur #000000, forme Pill, police Roboto), mais cette application n'a aucun compte et Konekt ne s'en sert pas. « Konekt app / Production » est aux réglages par défaut (nom et logo vides, #000000, forme Rounded, police system-ui). Les liens d'aide, de confidentialité et de conditions sont vides partout.

1. Dans le tableau de bord du prestataire, ouvrez « Dashboard / Development » et les réglages de la page de connexion (le libellé exact du menu n'est pas vérifié). Notez les cinq valeurs : nom, logo (enregistrez le fichier), couleur, forme, police.
2. Ouvrez « Konekt app / Production » et ses réglages de la même page. Reportez les cinq valeurs : nom Konekt, le logo, #000000, forme Pill, police Roboto.
3. Renseignez les trois liens.
   - Confidentialité : `https://konekt-app-navy.vercel.app/privacy`. C'est une page publique de Konekt (route `/privacy`, vérifiée dans `src/App.tsx`).
   - Conditions : l'application n'a aucune page publique de conditions (les routes publiques de ce type sont `/privacy` et `/privacy-extension`). Donnez l'adresse du document que vous voulez montrer, ou laissez vide et notez-le.
   - Aide : même constat. L'application n'affiche plus aucune adresse d'assistance, donc rien dans Konekt ne dit laquelle mettre ici : c'est la décision de la partie 5, ligne 6. Sans décision, laissez vide et notez-le.
4. Enregistrez. Ne créez ni ne supprimez aucune clé pour cela.
5. Regardez la page (4.4) et notez ce qui reste visible : nom du prestataire, mentions, pied de page. C'est à vous de décider si cela vous convient pour le lancement.

### 4.2 Deux façons de lancer l'adresse de la page

Il faut choisir une des deux. La première permet de lancer sans attendre le DNS.

**Option A : adresse du prestataire avec l'habillage (lancement, temporaire).**
1. Faites l'habillage (4.1).
2. Posez le secret `CONNECTION_ALLOW_VENDOR_HOSTED_LINK` à `1`. Laissez `UNIPILE_HOSTED_DOMAIN` absent.
3. Ce que fait ce réglage, relevé dans le code (`connection-steps.ts`, fonction `hostedLinkAllowed`, appelée par `connection.ts`) : sans domaine configuré, Konekt refuse par défaut de créer un lien de connexion, car le lien s'ouvrirait sur l'adresse du prestataire. Avec la valeur `1`, il accepte. Konekt contrôle seulement que le lien rendu est une adresse `https` valide (`isExpectedHostedLink`, qui n'exige aucun nom de domaine quand aucun n'est configuré). Il ne change rien d'autre : ni la connexion directe, ni les notifications, ni les séquences.
4. Conséquence visible : la barre d'adresse de la page de connexion montre le nom de domaine du prestataire. Ce qui apparaît dans la page elle-même dépend de l'habillage (4.1) et de ce que le prestataire laisse voir (4.4).
5. Dans la page de vérification, la ligne « Domaine de connexion à votre marque » affichera « À surveiller » (« Non configuré ») : c'est attendu avec cette option.
6. C'est un choix temporaire. Le noter dans `LOGBOOK.md` avec la date, et planifier l'option B.

**Option B : domaine à votre marque (cible).**
1. Demandez au prestataire, ou cherchez dans son tableau de bord : comment enregistrer un domaine à vous (par exemple `connect.konekt.fr`) pour les pages de connexion, quel enregistrement DNS créer (type, nom, valeur), si le logo, le nom et les textes de la page peuvent être retirés ou remplacés, et si les pages d'erreur et les éventuels e-mails du prestataire portent sa marque.
2. Connectez-vous là où est géré le domaine `konekt.fr` (votre registrar ou hébergeur DNS) et créez l'enregistrement exact donné par le prestataire. Le type n'est pas connu à l'avance.
3. Dans le tableau de bord du prestataire, lancez la vérification du domaine et attendez qu'elle réussisse. La propagation DNS prend de quelques minutes à quelques heures (délai général des DNS, non mesuré ici). Aucun domaine n'est vérifié aujourd'hui, nulle part.
4. Posez le secret `UNIPILE_HOSTED_DOMAIN` avec ce nom de domaine, sans `https://`.
5. Retirez `CONNECTION_ALLOW_VENDOR_HOSTED_LINK` si vous l'aviez posé. Avec un domaine configuré, il n'a plus d'effet (`hostedLinkAllowed` est vrai dès qu'un domaine est présent), mais le laisser entretient la confusion. Konekt refuse alors tout lien dont le domaine diffère de `UNIPILE_HOSTED_DOMAIN`.

### 4.3 Passer de l'option A à l'option B

Faites les points 1 à 4 de l'option B, puis retirez `CONNECTION_ALLOW_VENDOR_HOSTED_LINK`, puis refaites le test de 4.4. Les comptes déjà reliés ne sont pas touchés.

### 4.4 Comment vérifier ce que montre la page

Faites ce test après la fusion et avant d'annoncer la bascule à l'équipe.
1. Dans Konekt : Paramètres, puis « Mon compte », puis « Connexions », carte « Mon compte LinkedIn ». Cliquez sur le bouton qui commence par « Continuer vers LinkedIn ».
2. Regardez la barre d'adresse. Option A : le domaine du prestataire, c'est attendu. Option B : le nom de domaine doit être le vôtre.
3. Regardez la page entière : logo, nom, couleur, titre de l'onglet du navigateur, titre de la page, boutons, liens d'aide, de confidentialité et de conditions, pied de page, mentions « propulsé par ». Comparez avec les réglages de 4.1.
4. Refaites le test sur un téléphone et dans une fenêtre de navigation privée.
5. Si vous voyez le nom ou le logo du prestataire là où l'habillage ne le couvre pas, notez une capture d'écran et envoyez-la au prestataire. La connexion directe dans Konekt (`CONNECTION_NATIVE_ENABLED=1`) évite cette page, mais elle n'est pas validée avec un vrai compte (partie 9) et elle fait saisir des mots de passe LinkedIn dans Konekt, ce qui demande votre décision sur la confidentialité.

La page de vérification de la bascule signale un avertissement si le domaine configuré contient le nom du prestataire.

### 4.5 Relier un compte depuis le tableau de bord du prestataire (secours seulement)

Le 12 octobre 2026, la page « Accounts » du tableau de bord propose, pour relier un compte, trois entrées : « Quick Authentication » (pour tester), « Advanced Authentication » (réglages personnalisés : proxys, produits, scopes, partage avec des utilisateurs ; elle peut produire un lien à envoyer à une personne) et « Programmatic Integration » (documentation).

**Pour un compte de Konekt, passez par Konekt : Paramètres, « Mon compte », « Connexions », « Continuer vers LinkedIn » (ou « Reconnecter »).** Raison, vérifiée dans le code : Konekt enregistre chaque connexion lancée chez lui (table `connection_attempts`) et c'est cette trace qui relie le compte au bon membre et à la bonne organisation. Un compte relié depuis le tableau de bord ne porte aucune tentative de Konekt. À sa réception, la notification est notée « No connection attempt for this event, nothing to link » (`unipile-webhook/index.ts`) : Konekt ne le rattache pas de lui-même. Le compte reste un compte non relié, que seul un administrateur de la plateforme peut rattacher ensuite (action `claim_linkedin_account`, refusée aux autres avant toute lecture chez le prestataire, `unipile-accounts/handler.ts`).

Gardez donc le lien du tableau de bord pour un secours, par exemple si la page de connexion de Konekt est en panne, et prévenez l'ingénieur pour qu'il rattache le compte. Cette entrée convient en revanche pour un numéro qui n'est pas un compte Konekt, comme celui de Jarvis (3.3). Non vérifié : le détail de chaque entrée du menu (elles n'ont pas été essayées).

---

## 5. Décisions produit encore ouvertes

Le code a pris une valeur par défaut pour chacune. Aucune ne bloque la bascule, mais lisez-les avant la fusion. Cochez votre choix. La liste compte 24 décisions ouvertes (1 à 16 et 18 à 25) et une décision réglée (17). La ligne 18 vient de la revue indépendante du port des tests e2e, les lignes 19 à 23 des revues du code de chaque lot, les lignes 24 et 25 du relevé du tableau de bord (page « OAuth configuration »).

| # | Sujet | Ce que fait le code aujourd'hui | Votre décision |
|---|---|---|---|
| 1 | Retrait d'une invitation et étape d'attente | Retirer une invitation avance la date de l'étape « attendre l'acceptation » pour que la branche « non acceptée » se déclenche. Elle peut envoyer un InMail ou une relance peu après le retrait. Une attente sans délai maximum reste en attente. | [ ] Garder  [ ] Ne plus avancer l'attente (le statut passe seulement à « retirée ») |
| 2 | Recherche Recruiter limitée à un projet | Le sélecteur de projet envoie l'identifiant du projet. Rien ne prouve que le prestataire accepte cet identifiant comme filtre de la recherche. Il faut un appel réel pour trancher. | [ ] Tester avec la vraie clé avant l'ouverture  [ ] Masquer le sélecteur |
| 3 | Solde d'InMails selon la licence | Le solde affiché et le contrôle suivent la licence active du compte (Recruiter, Sales Navigator ou Classic). La signature d'un InMail Recruiter est le nom du profil du membre qui a relié le compte. Si un compte a deux contrats et que leur lecture échoue, la licence reste inconnue et le serveur décide. | [ ] Signature = nom du profil  [ ] Autre source (titre, organisation) |
| 4 | Rattacher un compte non relié (« C'est mon compte », « Lier ») | Avant : un propriétaire ou administrateur d'organisation pouvait relier un compte relié à personne, et un membre le pouvait dans les 30 minutes suivant la création du compte. Maintenant : seuls les administrateurs de la plateforme (secret `KONEKT_PLATFORM_ADMIN_USER_IDS`) le peuvent ; le refus intervient avant toute lecture du compte chez le prestataire (vérifié dans `unipile-accounts/handler.ts`, action `claim_linkedin_account`). Raison : la clé du prestataire est commune à toutes les organisations, un compte non relié peut être la connexion en cours d'une autre organisation. Les raccourcis « C'est mon compte » et « Lier » ne servent plus qu'à rattacher un compte déjà lié à la même personne. On connecte à la place par « Continuer vers LinkedIn ». Vos comptes LinkedIn de la base que la v2 ne connaît pas (partie 3.0) passent par cette reconnexion. | [ ] Accepter  [ ] Rouvrir pour les administrateurs d'organisation |
| 5 | Reconnexion depuis l'extension Chrome | Ne fonctionne plus. L'extension renvoie vers Paramètres, Connexions. Le texte de la page des jetons d'extension dans Paramètres (« reconnecter votre compte LinkedIn en un clic ») est resté et devient faux. | [ ] Corriger le texte (à faire par un développeur)  [ ] Rétablir un chemin dédié plus tard |
| 6 | Adresse d'assistance | Konekt n'affiche plus d'adresse d'assistance dans les écrans de connexion. Le bouton « Contacter le support » et l'adresse personnelle qu'il utilisait ont été retirés (deuxième série de correctifs) : la carte d'un compte restreint par LinkedIn dit « Compte restreint », avec la phrase du bandeau et de la notification, sans bouton. Il reste une seule question : le lien d'aide de la page de connexion du prestataire est vide (partie 4.1). Si vous voulez un canal d'assistance, il reviendra avec une adresse dédiée. | [ ] Rien à mettre pour l'instant  Adresse partagée à utiliser : ____________ |
| 7 | Agents de sourcing continu | Leur contexte contient l'identifiant du compte. Après la conversion, chaque agent LinkedIn s'arrête sur l'erreur « contexte changé » (code `CONTEXT_CHANGED`, texte « Recalibrez l’agent » ou « relancez le calibrage » selon l'écran) et doit être recalibré par son propriétaire avant la prochaine recherche. | [ ] Prévenir les propriétaires d'agents  [ ] Recalibrer vous-même |
| 8 | Propositions de l'assistant en attente | Les propositions d'envoi qui portent un ancien identifiant ne sont pas réécrites. À l'exécution, le compte est relu : elles échouent si le compte a changé. | [ ] Les laisser expirer  [ ] Les annuler avant la conversion |
| 9 | Conversations et messages | Les identifiants de conversation, de fil et de message ne sont pas convertis (aucune source pour les nouvelles valeurs). Si le prestataire les a changés, l'historique des liens candidat/conversation, les catégories de conversations et le cache d'analyse perdent leur lien. Le code retrouve une conversation par le candidat quand c'est possible. | [ ] Accepter le risque  [ ] Tester avec la vraie clé d'abord |
| 10 | Usage des comptes de l'équipe | Règle appliquée, à confirmer par vous. Un collaborateur ne se sert, pour aucune action, que du compte qu'il a relié lui-même (LinkedIn, e-mail ou WhatsApp) : lire les conversations ou les invitations d'une collègue, chercher ou lire un profil avec son compte, lister ses projets Recruiter, tout cela est refusé, avec le message « Ce compte est relié par un autre membre de l'organisation. Vous ne pouvez utiliser que votre propre compte. » La règle ne liste pas d'actions : une action ajoutée plus tard est couverte d'office. Propriétaire, administrateur et membre ne changent pas : ils se servent des comptes de l'organisation, comme avant. Pour tous les rôles, envoyer un message, retirer une invitation, réagir à un message, supprimer un message ou une conversation et déconnecter un compte WhatsApp se font depuis son propre compte seulement. Un rôle absent ou inconnu est traité comme un collaborateur. Trois points restent ouverts : (a) l'action `list`, qui alimente les écrans de connexion, rend encore à un collaborateur les comptes LinkedIn de l'équipe (nom, photo, offre), sans leurs conversations ; l'écran ne lui montre que le sien ; (b) propriétaire, administrateur et membre peuvent encore accepter ou refuser les invitations reçues par une collègue et recommander une compétence en son nom ; (c) les mêmes trois rôles lisent le nom et l'état d'une boîte e-mail d'une collègue, jamais son courrier. | [ ] Garder la règle  [ ] Aussi restreindre la liste des comptes pour les collaborateurs  [ ] Fermer (b) et (c) aux autres rôles |
| 11 | Filtres non représentables | Une recherche faite à la main qui utilise un filtre que la v2 ne sait pas exprimer (par exemple un rayon Recruiter) s'exécute sans lui. Depuis la première série de correctifs, une ligne discrète au-dessus des résultats le dit : « Votre compte LinkedIn ne sait pas appliquer ces filtres : compétences, poste. La recherche a été faite sans eux. » (au singulier : « ce filtre ... sans lui »). Une seconde ligne, « Filtres appliqués de façon approchée : années d’expérience. », liste ceux que le compte applique avec une approximation. Les mots sont ceux de l'écran (jamais le nom technique du filtre ni un texte du service), un filtre inconnu s'écrit « autre critère ». La ligne se lit à la première page d'une nouvelle recherche : elle disparaît pendant la recherche suivante, reste pendant « Charger plus », et une recherche qui ne retire rien l'efface. Un agent de sourcing continu qui contient un filtre non représentable est arrêté avant toute recherche (message « LinkedIn ne peut pas appliquer ces filtres avec cette licence ») jusqu'à modification de ses filtres. Non vu dans un navigateur : la ligne des filtres approchés (un compte Classic ne peut pas la produire depuis l'écran), la largeur de téléphone, le thème sombre, un compte Sales Navigator. | [ ] Garder  [ ] Laisser les agents chercher plus large |
| 12 | Historiques Outlook | Les historiques de boîtes Outlook sont toujours présentés comme « partiels » dans le contexte des actions candidat. | [ ] Garder  [ ] Lever la limite |
| 13 | Ce qui compte comme une réponse | Une invitation reçue du candidat, ou son refus ou acceptation d'InMail, ne compte plus comme réponse dans l'analyse des messages. | [ ] Garder  [ ] Revenir à l'ancienne règle |
| 14 | Annuaire des entreprises | 85 entreprises de l'annuaire contiennent un nom LinkedIn (slug) à la place d'un identifiant. Le rafraîchissement mensuel en écrit encore. | [ ] Convertir  [ ] Cesser d'en écrire |
| 15 | États « partiel », « dégradé » et « verrouillé » d'un compte | Aucun des trois n'envoie, et aucun ne met les séquences en pause. Partiel (un produit du compte demande une nouvelle authentification) : le membre est prévenu à chaque passage par une notification « Connexion LinkedIn partielle », un bandeau sur le tableau de bord, une ligne « Connexion LinkedIn partielle » (« Reconnectez le compte ») dans « À traiter », comptée dans le chiffre, et un message à l'écran, et la carte de connexion propose « Reconnecter ». Le contrat de départ prévoyait « limité, sans bouton » ; le code fait autrement, car sans alerte le membre ne saurait pas que ses envois sont retenus. Dégradé (un produit tourne pendant qu'un autre est en erreur, le service réessaie seul) : état de la carte seulement, ni notification ni bandeau. Verrouillé (restreint par LinkedIn) : notification « Compte LinkedIn restreint », bandeau et ligne, sans « Reconnecter », puisque se reconnecter n'y change rien. Le sens exact de ces états chez le prestataire est à confirmer avec une vraie clé (partie 9). | [ ] Garder  [ ] Ne plus prévenir pour « partiel » (état de carte seulement) |
| 16 | Non pris en charge par la v2 | Proxy défini par adresse IP (refusé, erreur 400), téléchargement de la photo d'un interlocuteur de messagerie (seule l'adresse de la photo est rendue). | [ ] Accepter |
| 17 | Visites de profil et plafond de vues | **Réglé, rien à décider.** Une étape de visite consommait deux places du plafond quotidien de vues (25 vues = 12 visites). Corrigé au commit `6c1598f` : la lecture du profil qui rend le jeton de visite n'écrit plus de seconde ligne au registre. Vérifié le 12 octobre dans `process-sequences/index.ts` (cas `profile_visit`) et par le test d'API « au plus 15 étapes invisibles » de `e2e/api/seq-engine-1.spec.ts`, qui passe. | Aucune. |
| 18 | Réponse par e-mail sur une boîte reliée à aucune organisation | Une réponse reçue sur une boîte e-mail qui n'est reliée à aucune organisation de Konekt est maintenant acquittée sans rien lire ni clore (`unipile-webhook/index.ts`, fonction `handleNewMail`, test « email.new sur une boîte reliée à aucune organisation »). Avant (commit `61049f0`), la réponse pouvait clore des inscriptions retrouvées par le message d'origine ou par l'adresse de l'expéditeur, sans limite d'organisation quand la boîte n'était reliée à personne, et le test d'API `seq-inbound-2` attendait un repli sur le compte d'inscription. Raison du changement : ce rattachement pouvait clore des inscriptions d'une autre organisation. Dans la pratique, la boîte e-mail de Konekt (une seule en base) est reliée : seule une boîte du prestataire sans ligne en base est touchée. | [ ] Garder  [ ] Rétablir un repli par le compte d'inscription |
| 19 | Compte supprimé chez le prestataire | Un lien LinkedIn dont le compte n'existe plus chez le prestataire n'est pas rendu par la liste du serveur et n'est pas repointé sur un compte de même nom (un homonyme d'une autre organisation serait relié à tort). La carte de connexion le montre comme « À reconnecter », avec la phrase « Ce compte LinkedIn n'est plus disponible. Reconnectez-le : la nouvelle connexion remplacera celle-ci. » et le bouton « Reconnecter ». Les cartes e-mail et WhatsApp font de même, avec leur propre mot pour le compte. La nouvelle connexion remplace le lien (`unipile-accounts/handler.ts`, commentaire de l'action `list`). | [ ] Garder  [ ] Afficher un état « compte introuvable » à la place de « À reconnecter » |
| 20 | Rejeu des notifications | Le rejeu d'une livraison (administrateurs de la plateforme) n'a ni limite de fréquence ni trace durable : la seule trace est une ligne de journal du serveur (événement, personne, nombre de points de réception). Un événement déjà reçu ne se rejoue pas (refus `already_received`). | [ ] Garder  [ ] Ajouter une limite et une table de trace (demande une migration) |
| 21 | InMail d'un compte dégradé ou à reconnecter | La file d'InMails repousse un InMail dont le compte est dégradé, partiel ou verrouillé de 6 heures, et dont le compte est à reconnecter (ou dans un état inconnu) d'une heure. Aucun nombre maximal de tentatives n'est écrit (`process-inmail-queue/index.ts`, vers la ligne 951). L'InMail part dès que le compte est corrigé. | [ ] Garder  [ ] Ajouter un plafond de tentatives |
| 22 | Conversion partielle | Si une colonne ne peut pas être réécrite (sans clé primaire, type inattendu en production), la conversion continue et le résultat est annoncé partiel, avec les colonnes concernées (`unipile-migration/handler.ts`). Elle ne s'arrête pas. | [ ] Garder  [ ] Refuser la conversion tant qu'une colonne est ignorée |
| 23 | Enrichissement des contacts par le service de connexion | Reste en pause : la constante `ENRICHMENT_PAUSED` de `process-enrichment-queue/index.ts` vaut `true` (décision du propriétaire du 7 juillet 2026, après la suspension d'un compte, à ne lever que sur sa demande explicite d'après le commentaire du code). Les lignes en attente de la file reçoivent le nouvel identifiant de compte à la conversion. La limite proactive de 90 % n'existe plus : seule une limite signalée par le prestataire met le compte en pause. À trancher avant de lever la pause. | [ ] Garder la pause  [ ] Lever la pause après la bascule |
| 24 | Écran de consentement Google et Microsoft | Relevé du 12 octobre 2026, page « OAuth configuration » : pour Google, la configuration par défaut utilise l'application Google du prestataire. La personne qui relie une boîte Gmail voit donc **le nom du prestataire** sur l'écran de consentement de Google. C'est, par construction, le seul endroit où ce nom reste visible aux utilisateurs, à part l'adresse de la page de connexion avec l'option A de la partie 4. L'option « Custom » permet d'utiliser une application Google à Konekt (son propre nom sur l'écran). Les permissions Gmail demandées par défaut sont listées sur cette page (par exemple lecture, modification, envoi, étiquettes) ; des permissions Gmail dites restreintes peuvent exiger une validation par Google et une évaluation de sécurité payante : non vérifié, ni le coût ni le délai. La partie Microsoft de la même page **n'a pas été regardée** : ouvrez-la et notez la même chose (nom affiché, option « Custom »). Une application Microsoft propre est en général plus simple à obtenir que celle de Google (non vérifié). Konekt propose bien Google et Outlook à la connexion, par le lien hébergé comme par la connexion directe (`unipile-accounts/connection.ts`). | [ ] Accepter à l'ouverture  [ ] Créer plus tard les applications Google et Microsoft de Konekt (Microsoft d'abord) |
| 25 | Liste de permissions e-mail réduite (amélioration possible, non faite) | Le client commun sait demander une liste de permissions réduite pour la connexion directe Google ou Outlook (option `oauthScope` de `_shared/unipile/accounts.ts`, transmise sous `config.oauth_scope`, vérifié). Mais le parcours de connexion (`unipile-accounts/connection.ts`) ne la transmet pas, et le lien hébergé, qui est le parcours par défaut, n'a aucune option de ce genre dans le client (`buildHostedLinkBody`). Le service applique donc sa liste par défaut. Non vérifié : que le service accepte ce paramètre sur le lien hébergé, et quelle liste réduite suffirait aux fonctions e-mail de Konekt (envoi, lecture des réponses). | [ ] Garder la liste par défaut  [ ] Faire réduire la liste (travail de développeur, à essayer avec une vraie clé) |

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

Avant cette étape, les limites de débit du prestataire doivent avoir été relevées et réglées (partie 3.4). Si ce n'est pas fait, faites-le d'abord.

Posez les secrets de la partie 3.2, sauf `UNIPILE_V2_API_KEY` : ne la remplacez pas, elle est contrôlée à l'étape 6 (partie 3.1). Faites ensuite l'habillage de la page de connexion (4.1), puis choisissez l'option de la partie 4.2 :
- option A : posez `CONNECTION_ALLOW_VENDOR_HOSTED_LINK` à `1` et ne posez pas `UNIPILE_HOSTED_DOMAIN` ;
- option B : le domaine doit être vérifié chez le prestataire et `UNIPILE_HOSTED_DOMAIN` posé.

Rollback : supprimez les secrets que vous avez ajoutés. Ne supprimez pas `UNIPILE_V2_API_KEY` si elle existait avant : ne la touchez pas. L'ancien code n'utilise pas les autres.

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

Les noms de tâches viennent des migrations du dépôt, et la requête de lecture du point 1 a été jouée sur une copie locale de la base : les neuf noms y existent dans la table des tâches, tous actifs. Les commandes de pause et de reprise n'y ont pas été jouées. Non vérifiés : la base de production et la version de l'extension de planification qui y tourne. Si la commande `cron.alter_job` est refusée, demandez à l'ingénieur de suspendre les tâches d'une autre façon avant de continuer.

Rollback : même commande avec `active := true`.

### Étape 4. Fusionner la branche

1. Sur GitHub, ouvrez la Pull Request de la branche. Vérifiez que les contrôles automatiques sont verts. Si GitHub signale que la branche n'est plus à jour avec `main`, demandez à l'ingénieur de la mettre à jour et de relancer les contrôles.
2. Cliquez sur la fusion (« Merge »).
3. Ouvrez l'onglet Actions : https://github.com/Lgarilhe/remix-of-event-template/actions
   - « Deploy Supabase Edge Functions » doit finir en vert. Il redéploie toutes les fonctions (le dossier partagé a changé).
   - « Deploy Supabase Migrations » doit finir en vert. Il pose cinq migrations (comptées le 13 octobre 2026 dans `supabase/migrations`, cinq fichiers de cette branche absents de `main`) : tentatives de connexion (`20261011204248`), colonne de retour (`20261012005001`), outils de conversion (`20261012051307`), garde de l'ordre des annulations (`20261012173252`) et marque du retrait voulu d'un compte WhatsApp (`20261012222732`). Toutes sont plus récentes que la dernière migration de `main` : aucune ne s'intercale avant une migration déjà posée.
   - Ordre entre les deux workflows. Ils partent ensemble à la fusion et peuvent finir dans n'importe quel ordre. La cinquième migration ajoute la colonne `removed_by_member_at` à la table des comptes WhatsApp reliés. Si la fonction `unipile-accounts` est en ligne avant elle, « Déconnecter » sur WhatsApp marche quand même : le compte est supprimé chez le prestataire, la liaison passe en « supprimé » sans la marque, et le serveur écrit un avertissement (« removed_by_member_at missing ») dans les journaux de la fonction. Tant que la migration manque, la carte affiche ce compte « À reconnecter » au lieu de le masquer. Dès que la migration passe, elle recopie la date de mise à jour dans toutes les lignes déjà « supprimées » : ce compte se masque alors, sans autre geste. Si la migration passe en premier, rien de particulier. La liste des conversions précédentes de la page de bascule (étape 9) exige en revanche la quatrième migration : tant qu'elle n'est pas posée, la page affiche « La liste des conversions précédentes n’a pas pu être lue. »
   - Si « Deploy Supabase Migrations » échoue avec « Found local migration files to be inserted before the last migration on remote », relancez-le à la main avec l'option `repair_tracking` cochée (voir `CLAUDE.md`, section sur les migrations). Seul un développeur doit le faire.
4. Attendez le déploiement du site (environ 2 minutes, selon `CLAUDE.md`).

À partir d'ici et jusqu'à l'étape 9, la messagerie LinkedIn ne fonctionne pas : le code attend des identifiants `acc_` et la base contient encore les anciens. C'est normal. Enchaînez les étapes 5 à 9 sans attendre.

Rollback à ce stade : sur la Pull Request fusionnée, cliquez sur « Revert ». GitHub crée une Pull Request d'annulation. Fusionnez-la : les workflows redéploient les anciennes fonctions et l'ancien site. Les cinq migrations restent en base. Quatre ajoutent ou remplacent seulement des tables et des fonctions de la bascule. La cinquième modifie une table existante : elle ajoute la colonne `removed_by_member_at` aux comptes WhatsApp reliés (vide par défaut, aucun droit nouveau) et recopie une date dans les lignes déjà « supprimées ». L'ancien code ne s'en sert pas, il n'y a rien à défaire. Ne réactivez les moteurs qu'après la fin du redéploiement. Gardez les anciens secrets et les anciennes notifications (étape 13) jusqu'à la fin de la surveillance : ils rendent ce retour possible.

### Étape 5. Enregistrer les notifications en temps réel

Votre identifiant doit être dans `KONEKT_PLATFORM_ADMIN_USER_IDS`.
1. Dans Konekt : Paramètres, « Mon organisation », « Général », carte « Comptes LinkedIn de l'organisation ». La carte est repliée au départ : cliquez sur son titre pour la déplier. Le bloc « Notifications en temps réel » se trouve dessous.
2. Dans le bloc « Notifications en temps réel », cliquez sur « Activer les notifications en temps réel ». Il crée ou met à jour un seul point de réception chez le prestataire, avec 17 types d'événements, et supprime les doublons éventuels. L'opération est répétable. Confirmation : le message « Notifications en temps réel activées », puis la ligne « Les trois notifications sont actives » dans le bloc.
3. Si le bloc n'apparaît pas (il n'est affiché que s'il y a au moins un compte LinkedIn listé, même si tous sont « À reconnecter » parce qu'ils portent encore un ancien identifiant), prévenez l'ingénieur : le même enregistrement se fait en appelant l'action `register` de la fonction `unipile-manage-webhooks`. Ce chemin n'a pas été essayé en production.

Le bouton Actualiser du bloc et la page de vérification (étape 6) confirment l'état.

Ce qui existe déjà (relevé du 12 octobre 2026, partie 3.0). L'application « Konekt app / Production » a déjà un point de réception vers le projet Supabase de Konekt, actif, sans nom, avec 23 événements, une liste plus ancienne que les 17 du code. Il faut le mettre à jour par cette étape, et non en créer un autre ni le modifier à la main :
- L'enregistrement fait une mise à jour sur place (même identifiant chez le prestataire) : il remplace la liste des événements par les 17 du code, réécrit l'adresse avec le jeton courant, et le laisse actif (`unipile-manage-webhooks/handlers.ts`, fonction `handleRegister`).
- La page de vérification ne peut pas lire le jeton contenu dans l'adresse du point de réception (le code ne le relit jamais). Elle peut donc afficher « OK » alors que le jeton est périmé. Lancez l'enregistrement même si la page dit « OK ».
- Le code ne reconnaît comme point de réception de Konekt que celui dont l'adresse a le même hôte et le même chemin que `<adresse du projet Supabase>/functions/v1/unipile-webhook` (`isReceiverEndpoint`, `_shared/unipile/webhooks.ts`). Non vérifié : l'adresse exacte du point existant. Si elle est différente (autre fonction, autre projet), l'enregistrement en crée un second et laisse l'ancien en place. Regardez l'adresse dans le tableau de bord du prestataire avant de cliquer, sans la modifier, et prévenez l'ingénieur si elle diffère.
- Les trois points de réception vers l'hôte n8n sont à vous. Les outils de Konekt ne les touchent jamais : `register` ne met à jour et ne supprime que les points dont l'adresse est celle du récepteur de Konekt, `delete` refuse (403) tout autre point, `list` ne les rend pas, le journal des livraisons et le rejeu ne portent que sur le point de Konekt (vérifié dans `unipile-manage-webhooks/handlers.ts`). Ne supprimez rien à la main dans cette liste pendant la bascule.

Rollback : dans le même bloc, l'icône de corbeille supprime le point de réception de Konekt (et donc toutes les notifications v2 de Konekt), y compris le point qui existait avant l'étape. Les anciennes notifications ne sont pas touchées à ce stade, ni les trois points n8n.

### Étape 6. Vérifier

1. Ouvrez https://konekt-app-navy.vercel.app/settings/admin/bascule (connecté avec votre compte administrateur de la plateforme).
2. Bloc « 1. Vérifier », bouton « Vérifier ». Chaque ligne est « OK », « À surveiller » ou « Bloquant ».
3. Lignes attendues, dans l'ordre de la page : « Clé du service de connexion », « Service de connexion joignable » avec **4 comptes** côté service (partie 3.1 ; avec un autre nombre, arrêtez-vous là), « Domaine de connexion à votre marque » (option B) ou « À surveiller : non configuré » (option A), « Réception des notifications » (« Enregistré, actif, 17 événements suivis »), « Clé de réception des notifications », « Liste des administrateurs de la plateforme », « Connexion directe », « Anciennes clés du service », « Outils de bascule en base de données », « Comptes de la base et du service ». Le nombre de comptes côté service est celui de tous les comptes que la clé voit : 4 est la valeur attendue en production, la répétition locale n'a pas pu la reproduire (14 comptes de test).
4. Avertissements normaux à ce stade : « Anciennes clés du service : encore définis » (jusqu'à l'étape 14), « Connexion directe : désactivée » (c'est l'état voulu, affiché OK). L'état orange « encore définis » n'a pas été observé à la répétition locale, où cette ligne affichait « Retirés » et la connexion directe « Activée » (réglages locaux).
5. La ligne « Comptes de la base et du service » est « À surveiller » tant que des comptes n'ont pas de correspondance : c'est attendu jusqu'à l'étape 9. L'en-tête « Prêt pour la conversion » reste affiché dans ce cas : il ne dépend que des lignes « Bloquant » (exemple vu : « 9 contrôles réussis, 1 à surveiller, 0 bloquant »).
6. Corrigez tout « Bloquant » avant d'aller plus loin.

### Étape 7. Comptes absents du nouveau service

1. Dans la même page, bloc « Comptes sans correspondance » : la liste donne, pour chaque compte de la base introuvable dans le nouveau service, le type, un libellé masqué, la fin de son ancien identifiant et la raison (« Absent du service », « Plusieurs correspondances », « Type de compte différent »). Cette liste ne dit pas combien de lignes chaque compte garde : c'est le bloc « 2. Simuler » qui le dit (étape 8).
2. Attendu d'après le relevé du 12 octobre (partie 3.0) : au moins 3 comptes LinkedIn « Absent du service » (la base en liste 5, l'application v2 en a 2), et la boîte Outlook rapprochée par son adresse e-mail. **Les deux comptes LinkedIn de l'application v2 risquent aussi d'y figurer.** Le rapprochement d'un compte LinkedIn se fait uniquement par l'ancien identifiant que le prestataire a gardé dans le compte v2 (`metadata.v1_account_id`). Les identifiants vus le 12 octobre n'étant pas ceux notés en juillet, ces comptes ont été reliés de nouveau, et un compte relié de nouveau n'a probablement plus cet ancien identifiant : la page le rangera dans « Absent du service », même s'il est opérationnel dans le tableau de bord. Même cas pour Guillaume Valladier, absent de la v2 en juillet. Non vérifié : la présence de `metadata.v1_account_id` sur chacun, c'est la page qui le montre. C'est la page qui fait foi : si elle affiche autre chose, suivez la page.
3. Comptes à reconnecter après la conversion, chacun par son propriétaire : Paramètres, « Mon compte », « Connexions », carte du compte, bouton « Continuer vers LinkedIn » (ou « Reconnecter »). Le test de la partie 4.4 doit être fait avant. Lisez le point 4 avant de demander une reconnexion : elle arrête les envois du membre.
   - LinkedIn Guillaume Valladier : présent dans la v2 mais demande une authentification. Il se reconnecte avec « Reconnecter ». Une reconnexion garde le même compte (le lien est créé pour ce compte, événement `account.reconnect`) : non essayé. Si la page l'a rangé dans « Absent du service » (compte relié de nouveau, sans ancien identifiant), il se connecte à neuf comme les suivants.
   - Les 3 comptes LinkedIn de Konekt absents de la v2 : chacun se connecte par « Continuer vers LinkedIn » et reçoit un identifiant tout neuf. Tant qu'ils ne l'ont pas fait, leur ligne garde l'ancien identifiant et la page Connexions les affiche à reconnecter.
   - **Tout compte LinkedIn que la page annonce « Absent du service », y compris LinkedIn Laurent GARILHE s'il y figure** : même marche. Son titulaire se reconnecte lui-même depuis Paramètres, « Mon compte », « Connexions », « Continuer vers LinkedIn ». Cela crée le lien directement avec le nouvel identifiant `acc_`, sans passer par la conversion. Ensuite, relancez « Vérifier », puis regardez la ligne de ce compte et la liste « Anciens identifiants sans compte relié » (étape 8) : les séquences, InMails programmés et compteurs restés sur l'ancien identifiant y apparaissent (point 4 ci-dessous). Ne passez pas par le lien du tableau de bord du prestataire (4.5). Variante à voir avec l'ingénieur : pour un compte déjà opérationnel dans le nouveau service, convertir l'ancien identifiant vers le nouveau par la fonction SQL (`docs/unipile-v2-architecture.md`, partie 7), ce qui évite une seconde connexion : non essayé.
   - Outlook l.garilhe@konekt.fr : opérationnel et rapproché par son adresse e-mail, rien à faire si la page le confirme.
   - Le numéro WhatsApp qui demande une authentification est celui de Jarvis, pas un compte Konekt (aucune ligne en base) : aucune action de Konekt, voir le point g de la partie 3.0 et la partie 3.3.
4. Un compte reconnecté sous un nouvel identifiant arrête les envois de son titulaire, et ses données restent sur l'ancien identifiant. Constaté à la répétition locale, au moment où la nouvelle connexion remplace l'ancienne :
   - ses inscriptions en pause passent à la raison « En pause » (pause manuelle) : elles ne reprennent pas toutes seules à la reconnexion, contrairement à la raison « En pause (compte LinkedIn déconnecté) » ;
   - ses InMails programmés sont annulés, avec la raison « Compte LinkedIn dissocié » ;
   - il est retiré des rotations « Plusieurs expéditeurs » des séquences, et le nouvel identifiant n'y est pas ajouté. Ce retrait n'apparaît dans aucune liste de la page.
   Ses inscriptions, ses InMails (annulés compris), son historique de plafonds et ses conversations restent attachés à l'ancien identifiant. Avant la reconnexion, tant que sa liaison existe, la simulation les compte sous « Comptes sans correspondance » (étape 8). Après la reconnexion, ils apparaissent sous « Anciens identifiants sans compte relié », avec leur nombre de lignes, et ne seront pas convertis. Après la reconnexion de chaque membre : remettez-le dans les rotations « Plusieurs expéditeurs » des séquences concernées, puis relancez ses séquences (« Reprendre » sur ses inscriptions en pause). Pour conserver l'historique, l'ingénieur peut convertir l'ancien identifiant vers le nouveau avec la fonction SQL décrite dans `docs/unipile-v2-architecture.md`, partie 7. Demandez-le avant de relancer les séquences.
5. Relancez « Vérifier » jusqu'à ce que la liste soit vide, ou que vous acceptiez de laisser les comptes restants tels quels (case à cocher à l'étape 9).

### Étape 8. Simuler

1. Bloc « 2. Simuler », bouton « Simuler la conversion des comptes ». Rien n'est écrit.
2. Lisez le tableau : par type de compte (LinkedIn, messagerie, WhatsApp) combien sont en base, déjà convertis, à convertir, non trouvés ; pour chaque compte à convertir, le nombre de lignes réécrites et les notes (agents à recalibrer, propositions de l'assistant, journaux non réécrits).
3. Lisez « Comptes sans correspondance » : sous chaque compte qui a encore sa liaison, une ligne dit combien de lignes restent sur son ancien identifiant, par type de données (exemple : « 1 ligne restera sur l’ancien identifiant : inscriptions de séquence (1). »), ou « Aucune ligne liée à ce compte. ». La fenêtre de l'étape 9 répète le total avant la case qui laisse ces comptes tels quels.
4. Lisez « Anciens identifiants sans compte relié » : ce sont des identifiants que la conversion ne peut pas apparier. Chaque ligne dit où ils se trouvent (« Registre des plafonds », « Inscriptions de séquence », « File des InMails », « Conversations de mission », « File d’enrichissement des profils », « Catégories de conversations »), la fin de l'identifiant et le nombre de lignes.
5. Un message « La liste des comptes du service est tronquée » interdit la conversion : prévenez l'ingénieur.
6. Comptes reliés de nouveau depuis juillet (partie 3.0) : si la simulation annonce « non trouvés » pour des comptes LinkedIn que vous voyez opérationnels dans le tableau de bord, c'est le cas décrit à l'étape 7. La conversion ne les touche pas et ne les réécrit pas : leurs lignes gardent l'ancien identifiant tant que leur titulaire ne s'est pas reconnecté. Ne bloquez pas la conversion pour eux : cochez la case qui les laisse tels quels (étape 9), puis suivez la marche de l'étape 7.

Rollback : aucun besoin, rien n'a été écrit.

### Étape 9. Convertir

1. Bloc « 3. Convertir », bouton « Convertir les comptes ».
2. Une fenêtre résume le nombre de comptes et de lignes. Si des comptes restent sans correspondance, elle dit combien de lignes liées à ces comptes resteront sur l'ancien identifiant, puis propose la case qui les laisse tels quels (ils devront être reconnectés). Lisez cette ligne avant de cocher.
3. Tapez le mot `BASCULER` et confirmez. Gardez la page ouverte.
4. La conversion traite chaque compte dans sa propre transaction : si un compte échoue, il reste inchangé. Si le temps imparti (30 secondes) s'écoule, un message dit combien de comptes restent. Relancez la simulation, puis la conversion. Un échec partiel (« Conversion partielle ») se traite de même. Chaque passage crée son propre lot : il y a donc plusieurs lots à la fin. La liste « Conversions précédentes » les montre du plus récent au plus ancien, avec le nombre de comptes, de lignes réécrites et la date. Un lot annulé reste dans la liste avec le badge « Annulée ».
5. À la fin, notez le « Numéro du lot » (bouton « Copier »). Il sert à l'annulation. Il réapparaît aussi dans « Conversions précédentes » après une simulation.
6. Si la réponse n'arrive pas (message « Résultat inconnu »), ne relancez pas : lancez la simulation et regardez « Conversions précédentes ».
7. La page refuse la conversion si la simulation n'est plus à jour (des comptes ont changé entre-temps) : relancez la simulation.
8. Une seule personne convertit, depuis un seul onglet. Si deux demandes partent en même temps, la base les traite l'une après l'autre : la seconde trouve les comptes déjà convertis et répond « Rien à convertir : aucun lot créé. », sans numéro de lot (elle ne crée plus de lot vide). Si elle avait converti quelques comptes avant l'autre, elle rend un lot à elle avec ces comptes : dans ce cas, annulez les lots du plus récent au plus ancien et, au moindre doute, prévenez l'ingénieur avant d'annuler.
9. À la fin de la conversion, le bloc « 2. Simuler » se vide : « Convertir les comptes » redemande une simulation. Le bloc « 1. Vérifier » garde son ancien résultat, qui n'est plus à jour. Relancez « Simuler la conversion des comptes » pour voir « Conversions précédentes » et les comptes sans correspondance restants, et « Vérifier » pour une lecture à jour. Après une conversion complète, la simulation dit « Aucun compte à convertir » et « Tous les comptes qui ont une correspondance sont déjà convertis. » (si des comptes sans correspondance restent) ou « Tous les comptes sont déjà au nouveau format. »

Rollback : dans « Conversions précédentes », bouton « Annuler la conversion » sur le lot, puis tapez `ANNULER`. Les identifiants du lot sont restaurés depuis la sauvegarde, sauf pour une ligne modifiée depuis, et une ligne créée depuis la conversion garde le nouvel identifiant : le résultat dit combien de lignes sont dans ce cas et où elles se trouvent (exemple : « Elle se trouve dans : inscriptions de séquence (1). »). **Quand il y a plusieurs lots, annulez-les du plus récent au plus ancien, jamais l'inverse.** Deux lots peuvent avoir réécrit la liste d'expéditeurs d'une même séquence : annuler l'ancien d'abord la laisserait à moitié convertie. La page l'empêche : le bouton des lots plus anciens est désactivé et se lit « Annulez d’abord le lot plus récent », avec la raison dessous, « Les conversions s’annulent de la plus récente à la plus ancienne. », tant qu'un lot plus récent n'est pas annulé, et la base refuse aussi (« Une conversion plus récente n’est pas annulée. Annulez d’abord la plus récente, puis celle-ci. »). Un lot qui n'a réécrit aucune ligne n'a pas de bouton (« Aucune ligne réécrite : rien à annuler. »). Les appels du code final échouent alors sur les anciens identifiants : l'annulation sert à revenir en arrière avec le code précédent (voir l'étape 4). Ce retour suppose que l'ancien compte chez le prestataire fonctionne encore, ce qui n'a pas pu être vérifié.

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
7. Page `/settings/admin/bascule` : « Vérifier » doit être tout vert hors l'avertissement sur les anciennes clés et, avec l'option A de la partie 4, la ligne du domaine.
8. Annuaire des entreprises : la tâche planifiée `resolve-pedigree-directory` utilise le compte désigné par la clé `pedigree_resolver_account_id` de la table `internal_config`, qui doit être un compte avec le produit Recruiter. La conversion réécrit cette valeur seulement si elle est celle d'un compte converti. Dans l'éditeur SQL : `select value from public.internal_config where key = 'pedigree_resolver_account_id';`. La valeur doit commencer par `acc_`. Sinon, ou si le compte n'a pas Recruiter, la tâche s'arrête avec une erreur 503 sans rien écrire (comportement du code, `resolve-pedigree-directory/index.ts`) : pas de dégât, mais l'annuaire ne se rafraîchit plus tant que la valeur n'est pas corrigée.

Si un test échoue, ne passez pas à l'étape 12. Notez le message exact et l'heure, ouvrez les journaux de la fonction concernée (Supabase, « Edge Functions », la fonction, « Logs ») et envoyez-les à l'ingénieur.

### Étape 12. Surveiller 24 heures

Voir la partie 7. Ne retirez ni les anciens secrets ni les anciennes notifications avant la fin de cette surveillance.

### Étape 13. Supprimer les anciennes notifications

Le nouveau code ne sait plus lister ni supprimer les notifications de l'ancienne version. Elles envoient maintenant vers l'adresse de réception avec l'ancien secret, qui est refusé (401).
1. Ouvrez le tableau de bord du prestataire de l'**ancienne** version (celui de vos clés v1).
2. Section des notifications (« Webhooks »). Supprimez celles qui pointent vers `https://crckfywoyjxkawathdff.supabase.co/functions/v1/unipile-webhook` et vers `.../functions/v1/sequence-webhooks-handler`. L'adresse est déduite de la référence du projet Supabase. Les libellés de ce tableau de bord n'ont pas pu être vérifiés.
3. Ne touchez pas au point de réception de Konekt dans la nouvelle version (mis à jour à l'étape 5), ni aux trois points de réception n8n : ils sont à vous et ne font pas partie de la bascule.
4. Ne supprimez pas non plus, dans l'ancienne version, la notification qui pointe vers la fonction `jarvis-whatsapp`, ni l'ancienne clé ni l'ancien compte WhatsApp de Jarvis : tant que Jarvis n'est pas porté ou arrêté, il en dépend (partie 3.3).

Rollback : impossible sans recréer les notifications à la main. Faites-le après la surveillance de 24 heures.

### Étape 14. Retirer les anciens secrets

**Cette étape est conditionnelle. La fonction `jarvis-whatsapp` (votre assistant WhatsApp personnel) lit `UNIPILE_API_KEY` et `UNIPILE_DSN` et appelle l'ancienne API (partie 3.3). Tant qu'elle n'est pas portée vers la nouvelle version ou arrêtée, ne supprimez ni `UNIPILE_API_KEY` ni `UNIPILE_DSN`. Passez à l'étape 15 : c'est le comportement attendu, la ligne « Anciennes clés du service » de la page de vérification reste « encore définis ».** Porter Jarvis est un chantier à part, à ouvrir seulement sur votre décision (partie 3.3).

Une fois Jarvis porté ou arrêté, et seulement alors : page des secrets de la partie 3.2. Supprimez `UNIPILE_API_KEY` et `UNIPILE_DSN`. Supprimez aussi `UNIPILE_WEBHOOK_SECRET` et `SEQUENCE_WEBHOOK_SECRET`, à condition que `UNIPILE_V2_WEBHOOK_TOKEN` soit posé, que l'étape 5 ait été refaite depuis, et que l'ingénieur ait confirmé que Jarvis ne les lit pas (partie 3.3, point 2). Relancez « Vérifier » : la ligne « Anciennes clés du service » passe à « Retirés ».

À partir de la suppression des secrets, le retour en arrière n'est plus possible : on avance seulement.

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
| Notifications, tableau de bord, « À traiter » et page Connexions | Comptes en état dégradé, partiel, verrouillé ou à reconnecter | Rares. Aucun de ces comptes n'envoie, et aucun ne met les séquences en pause. Dégradé : la carte seule, le service réessaie de lui-même. Partiel : notification « Connexion LinkedIn partielle », bandeau et ligne dans « À traiter ». Verrouillé : notification « Compte LinkedIn restreint », bandeau et ligne. | Un compte partiel ou déconnecté : son propriétaire clique sur « Reconnecter ». Un compte verrouillé : se reconnecter n'y change rien, il faut patienter ou vérifier le compte sur LinkedIn ; les envois reprennent d'eux-mêmes une fois la restriction levée. |
| Séquences | Envois, réponses, acceptations d'invitations | Mêmes volumes qu'avant. | Comparez avec la semaine précédente avant de conclure. |
| Agents de sourcing | Erreur « contexte changé » (`CONTEXT_CHANGED`), texte « Recalibrez l’agent » ou « relancez le calibrage » | Attendu après la conversion. | Faites recalibrer l'agent (décision 7). |
| Plafonds LinkedIn | Page Équipe, « Plafonds du jour » | Les compteurs repartent de leur historique (colonne convertie). | Si les compteurs repartent de zéro, un compte n'a pas été converti. |
| Refus pour limites (partie 3.4), éditeur SQL | `select count(*) from public.search_failure_log where http_status = 429 and created_at > now() - interval '24 hours';` (recherches seulement, conservées 14 jours) | Aucun, ou très peu. | Plusieurs refus : relevez les limites du prestataire (partie 3.4) ou espacez les recherches. |
| Refus pour limites, éditeur SQL | `select linkedin_account_id, quota_paused_until from public.member_linkedin_accounts where quota_paused_until > now();` | Aucune ligne. | Un compte est en pause pour la journée (genre `provider_limit`) : voir la partie 3.4 pour la cause probable. |
| Refus pour limites, éditeur SQL | `select count(*) from public.sequence_step_executions where status = 'scheduled' and error_message like 'Rate limit (%';` | Zéro, ou peu. | Des étapes sont reportées pour limite de débit (genre `rate_limited`) : une demande de relation part reportée à lundi 9 h. |
| Supabase, Edge Functions, `process-sequences`, Logs | `Rate limit for` et `pausing account` | Aucun. | Même lecture que ci-dessus. |

Ces cinq requêtes SQL et ces deux messages de journal viennent du code (colonnes et textes lus dans les migrations et les fonctions). Les cinq requêtes de ce tableau et celle de l'étape 11 (annuaire des entreprises) ont été jouées sans erreur sur une copie locale de la base : les colonnes existent, et la requête sur les notifications reçues y rend bien des types d'événements comme `message.new` et `account.add`. Elles n'ont pas été jouées sur la base de production. Compter les refus de cette façon ne voit pas toutes les lectures refusées (par exemple une lecture de profil pendant une notation), seulement les recherches, les pauses de compte et les étapes de séquence reportées. Les autres refus ne se lisent que dans les journaux des fonctions.

Ce qui change dans les plafonds : la v2 ne donne plus de pourcentage d'usage. L'ancien arrêt à 90 % n'existe plus. Konekt compte lui-même ses envois, et met le compte en pause pour la journée si le prestataire dit qu'une limite est atteinte.

---

## 8. Retour en arrière, résumé

| Où en êtes-vous | Que faire | Coût |
|---|---|---|
| Avant l'étape 4 (rien fusionné) | Supprimer les secrets ajoutés par vous (jamais `UNIPILE_V2_API_KEY` si elle existait avant), réactiver les tâches planifiées si vous les aviez suspendues. | Aucun. |
| Après la fusion, avant la conversion (étapes 4 à 8) | Annuler la fusion (« Revert »), attendre le redéploiement, réactiver les tâches planifiées. Le point de réception de Konekt existait avant la bascule (partie 3.0) : ne le supprimez que si l'ingénieur le demande. Les anciens secrets et les anciennes notifications existent encore. | Messagerie coupée pendant l'opération. |
| Après la conversion (étape 9 à 12) | « Annuler la conversion » avec le numéro du lot (s'il y a plusieurs lots, du plus récent au plus ancien), puis annuler la fusion, puis réactiver les moteurs. | Les lignes créées depuis la conversion gardent le nouvel identifiant. Le retour suppose que l'ancien compte du prestataire répond encore (non vérifié). |
| Après l'étape 13 ou 14 | Aller de l'avant seulement. Corriger le problème, ne pas revenir. | Retour impossible sans recréer les notifications et les secrets à la main. Les secrets `UNIPILE_API_KEY` et `UNIPILE_DSN` ne se retirent qu'une fois `jarvis-whatsapp` porté ou arrêté (partie 3.3). |

---

## 9. Ce qui n'a pas pu être vérifié sans clé réelle

Rien de ce code n'a été essayé contre le vrai service v2 : aucune clé n'était disponible pour la rédaction de ce guide. Les tests utilisent un faux prestataire écrit à partir de la spécification publiée. Ce qui suit est donc supposé et doit être confirmé par un essai réel (liste détaillée dans `docs/unipile-v2-architecture.md`, partie 10) :

- Les formats d'identifiants acceptés pour désigner une personne (nom court du profil, identifiant du prestataire, identifiant Recruiter commençant par `AE`).
- Les corps des erreurs (mauvais mot de passe, code faux, limite atteinte, déjà en relation, déjà invité).
- Les contenus réels des notifications autres que `message.new`, et l'absence de signature de livraison (seul le jeton de l'adresse prouve l'origine).
- L'identité entre les anciens et les nouveaux identifiants de personnes, de conversations et de messages.
- Le contenu de la page de connexion hébergée avec l'habillage de « Konekt app / Production » : ce qui reste visible du prestataire (partie 4.4). Le code n'envoie aucun habillage.
- Les libellés exacts des réglages de la page de connexion et des clés dans le tableau de bord du prestataire.
- L'application d'origine de la clé posée dans le secret `UNIPILE_V2_API_KEY`, et le comportement d'une clé de niveau compte (partie 3.1). Contrôle à l'étape 6.
- L'adresse exacte du point de réception de Konekt qui existe déjà (23 événements), donc le fait que l'enregistrement le met à jour au lieu d'en créer un second (étape 5).
- Le contenu de la fonction `jarvis-whatsapp` : lu en lecture seule dans le projet de production le 12 octobre 2026 (elle lit `UNIPILE_API_KEY` et `UNIPILE_DSN`, appelle `/api/v1/...`, écrit dans une conversation fixe, peut lire votre boîte par l'ancien identifiant, reçoit l'ancien format de notification par un jeton d'adresse, et contient un jeton d'accès en clair). Cette lecture n'est pas rejouable depuis le dépôt. Restent non vérifiés : si l'ancienne API sert encore ce numéro aujourd'hui, ce que le prestataire fera de l'ancienne API après la bascule, et quel secret Supabase protège l'adresse de réception de Jarvis, s'il y en a un (partie 3.3, point 2).
- Les limites de débit : valeurs de la page « Rate limits » (enregistrées ou seulement affichées, portée de « toutes méthodes »), texte réel du refus du prestataire pour une limite (donc le genre d'erreur, pause du compte ou report de l'étape), usage réel d'un compte sur une journée (partie 3.4).
- La répétition de la bascule sur une copie locale de la base (données fictives, faux prestataire, 12 octobre 2026) a joué les étapes 5 à 9, l'annulation, l'ordre des lots, la conversion refusée ou en échec, l'accès refusé aux non-administrateurs et la reconnexion d'un compte absent du service. Elle n'a pas pu jouer : la pause et la reprise réelles des tâches planifiées (étapes 3 et 10), la fusion et le déploiement (étape 4), les tests de bout en bout avec un vrai envoi, une vraie réponse et une vraie recherche (étape 11), les anciennes notifications et les anciens secrets (étapes 13 et 14), le cas des 30 secondes écoulées avec des comptes restants, une clé refusée par le service, une liste de comptes du service tronquée, la page de connexion hébergée elle-même, et les parties 3.0, 3.4 et 4 de ce guide.
- Le menu de liaison de compte du tableau de bord (trois entrées) et la page « Scopes » : relevés à la main, aucune entrée essayée (partie 4.5).
- L'écran de consentement Google et la partie Microsoft de la page « OAuth configuration » : Google relevé à la main, Microsoft non regardé ; exigences de validation de Google pour des permissions Gmail restreintes, coût et délai non connus (décisions 24 et 25).
- La présence de `metadata.v1_account_id` sur les comptes reliés de nouveau depuis juillet, donc la liste exacte des comptes que la page annoncera « Absent du service » (étapes 7 et 8). Le fait que les identifiants ont changé depuis juillet vient de la comparaison à la main du tableau de bord avec `AUDITS/UNIPILE_V2_MIGRATION_PLAN.md` et n'a pas été recontrôlé par le code.
- Le rapprochement des comptes LinkedIn et Outlook réels par `metadata.v1_account_id` ou par adresse (étape 7).
- Le relevé de la partie 3.0 lui-même : fait à la main par le propriétaire le 12 octobre 2026, sans passage par le code.
- La compatibilité des identifiants de projets Recruiter avec le filtre de recherche.
- Les écrans de connexion directe (QR, codes de vérification, validation dans l'application).
- « Déconnecter » WhatsApp avant que la cinquième migration soit posée (étape 4) : le succès sans la marque et l'avertissement sont prouvés avec une fausse base de données et par la forme d'erreur lue sur la pile locale (où la colonne existe), pas par un vrai déploiement fait avant la migration.
- Les alertes d'état de compte (décision 15) : le sens exact de « partiel », « dégradé » et du drapeau « verrouillé » chez le prestataire, la relecture de l'état du compte au déverrouillage (délai de 8 secondes) et l'arrivée de l'alerte dans une page déjà ouverte n'ont été joués qu'avec le faux prestataire.
- Le nom exact des menus du tableau de bord du prestataire et de Supabase cités dans ce guide.

---

## 10. Glossaire

- **Clé API** : mot de passe d'application. Une seule pour tout Konekt avec la v2.
- **Secret** : valeur gardée côté serveur, que le navigateur ne voit jamais. Se pose dans Supabase.
- **Notification en temps réel (webhook)** : message que le prestataire envoie à Konekt quand quelque chose se passe (réponse d'un candidat, invitation acceptée, compte déconnecté).
- **Jeton** : suite secrète placée dans l'adresse de réception. Sans elle, une notification est refusée.
- **Point de réception** : l'adresse unique chez le prestataire qui envoie ses notifications à Konekt.
- **Lien hébergé** : page de connexion tenue par le prestataire, ouverte depuis Konekt, qui renvoie ensuite vers Konekt.
- **Domaine à votre marque** : nom de domaine à vous (par exemple `connect.konekt.fr`) sous lequel s'ouvre cette page. Option B de la partie 4.
- **Habillage** : nom, logo, couleur, forme des boutons, police et liens d'aide de la page de connexion. Se règle dans le tableau de bord du prestataire, par application.
- **Application (du prestataire)** : espace du tableau de bord qui contient ses propres comptes, clés et points de réception. Konekt utilise « Konekt app / Production ».
- **Clé de service / clé de niveau compte** : les noms que le tableau de bord donne aux clés d'une application entière et aux clés limitées à un compte. Konekt a besoin d'une clé de l'application entière (partie 3.1).
- **Identifiant de compte** : code qui désigne un compte relié. Ancien format sans préfixe, nouveau format `acc_...`.
- **Conversion (ou bascule des identifiants)** : remplacement, dans toute la base, de l'ancien identifiant de chaque compte par le nouveau.
- **Simulation** : calcul de la conversion sans rien écrire.
- **Lot** : une conversion appliquée. Son numéro permet de l'annuler. Plusieurs lots s'annulent du plus récent au plus ancien.
- **Moteur** : tâche automatique qui tourne seule (envoi des séquences, file d'InMails, vérification des réponses). Aussi appelée tâche planifiée ou cron.
- **Licence** : abonnement LinkedIn du compte (Classic, Recruiter, Sales Navigator). Recruiter et Sales Navigator s'excluent sur un même compte en v2.
- **InMail** : message LinkedIn payant à un inconnu, décompté d'un solde de crédits.
- **Compte dégradé, partiel, verrouillé** : nouveaux états v2. Le compte n'envoie plus tant qu'il n'est pas revenu à « OK ». Dégradé : un produit du compte tourne pendant qu'un autre est en erreur, le service réessaie seul. Partiel : un produit tourne pendant qu'un autre demande une nouvelle authentification, le membre doit reconnecter. Verrouillé : le compte est restreint par LinkedIn, se reconnecter n'y change rien.

# Audit du module séquences, 25 au 27 septembre 2026

Branche `claude/sequence-audit-ux-xzwvrw`, partie de `main` au commit `88afed4`. Ce document fait suite au lot « moteur de séquences » du 1er septembre (`docs/audit-2026-09-01-lot-sequences.md`), dont les correctifs étaient déjà en place.

## Objet

Le module séquences envoie des messages LinkedIn en votre nom, à des candidats. Un message envoyé deux fois, après une réponse, au mauvais candidat ou depuis le compte d'un collègue abîme la relation avec le candidat et peut faire restreindre le compte LinkedIn. L'audit visait donc deux choses : un moteur qui ne se trompe jamais d'envoi, et une interface qui dit toujours la vérité sur ce qui va partir.

## Méthode

Douze auditeurs ont lu le code en parallèle : sept sur le moteur et la base (cœur du moteur, conditions et attentes, canaux LinkedIn, e-mail, événements entrants, données et sécurité, état réel de la production en lecture seule), cinq sur l'interface (éditeur, inscription, pilotage, parcours du recruteur, fiabilité technique). Chaque constat devait citer le code. Un vérificateur a tenté de réfuter chaque constat, et un second avis indépendant a relu chaque constat critique ou grave.

Les 410 constats confirmés ont été regroupés en 246 défauts distincts, puis répartis en quinze lots de correction, un par groupe de fichiers, avec un contrat commun qui fixe la sémantique de la pause et celle des nouvelles actions serveur ; ses règles sont reprises dans `CLAUDE.md` (section « Séquences : règles du moteur et de l'interface »). Une vague a ensuite raccordé les lots entre eux. Une relecture contradictoire a trouvé 77 problèmes dans les correctifs eux-mêmes, dont 5 critiques. Une vague finale les a corrigés. Une relecture ciblée de cette vague a trouvé 2 derniers problèmes graves (l'assistant IA ne respectait pas la règle des collaborateurs, et la migration reclassait des pauses manuelles), corrigés par une dernière passe.

## Chiffres

- 246 défauts : 22 critiques, 48 graves, 117 moyens, 59 mineurs.
- 233 corrigés, 1 neutralisé par la fermeture du canal e-mail, 10 corrigés en partie, 2 reportés (détail dans le registre).
- Tests : 840 tests UX (298 avant l'audit), 40 tests agent, 119 tests Deno sur les règles pures du moteur, tous verts.
- Tests de bout en bout contre une stack locale : 32 tests d'API et 46 tests d'interface passent, voir la section dédiée.
- tsc : 24 erreurs, contre 25 avant l'audit. Build de production OK.
- Typage Deno des edge functions : 18 erreurs de moins qu'avant l'audit, aucune dans le code modifié (process-sequences en compte une de plus : trois erreurs anciennes de `_shared/credit-guard.ts`, désormais importé, contre deux erreurs de base corrigées).
- Migration `20260928140414_sequences_audit_lot_b6.sql` rejouée localement sous PostgreSQL 16, sur une base neuve (274 migrations) et sur une base de type production (`MIGRATION_CLEAN.sql` puis 98 migrations). Audit RLS : 10 contrôles généraux et 22 contrôles séquences passent sur les deux bases. Les anciennes pauses de la production ont été simulées et reclassées comme prévu (D6).

## Les 22 défauts critiques trouvés

- SEQ-001 : « Envoyer tout », « Traiter maintenant » et « Forcer un cycle » avancent sans borne toutes les relances futures de l'organisation
- SEQ-002 : Réactiver une séquence relance aussi les candidats mis en pause à la main, par l'Inbox ou par la dissociation d'un compte
- SEQ-003 : BUG-095 non corrigé : un message livré pendant une pause ou une réponse est marqué « annulé » puis renvoyé à la reprise
- SEQ-004 : « Reprendre » et « Ré-enrôler » réarment côté navigateur une exécution annulée choisie à l'aveugle : renvoi d'un message déjà reçu, envoi immédiat d'une relance future, reprise sans effet
- SEQ-005 : Double envoi sur envoi incertain : relance automatique après 5xx ou délai, second envoi immédiat dans une nouvelle conversation, e-mail renvoyé quand le statut n'a pas été écrit
- SEQ-006 : Réponse détectée : job_candidate_status passé « Répondu » dans les autres organisations (polling) et dans toutes les missions de l'organisation (pré-envoi)
- SEQ-007 : check_replies et l'envoi synchronisent les candidats de toutes les organisations dans le Notion interne de Konekt
- SEQ-008 : Calendly : arrêt des séquences sans filtre d'organisation, par sous-chaîne d'URL ou sans filtre de profil
- SEQ-009 : sequence_steps : un membre de n'importe quelle organisation peut insérer ou modifier une étape dans la séquence d'une autre
- SEQ-010 : Le compte d'envoi d'une inscription n'est jamais vérifié contre son organisation : envoi possible depuis le compte d'une autre organisation
- SEQ-011 : inmail_queue : une insertion directe par l'API contourne le contrôle de propriété du compte d'envoi
- SEQ-012 : Réponse ou acceptation d'un candidat ignorée quand son inscription est en pause : la reprise relance après la réponse
- SEQ-013 : BUG-023 non corrigé : assigned_sender_id est de type uuid, le compte de rotation n'est jamais enregistré (suite de conversation depuis un autre compte, rattachement webhook impossible)
- SEQ-014 : « Annuler l'étape » dans le Journal ne l'empêche pas de partir : le moteur la replanifie une heure plus tard
- SEQ-015 : « Si timeout : Terminer » et l'étape « Branchement » (Si faux) ne sont jamais enregistrés : le moteur continue et envoie la suite
- SEQ-016 : Une branche de « Vérifier connexion » laissée vide ou dont la cible a été supprimée envoie les candidats dans l'autre branche
- SEQ-017 : « Dupliquer une existante » (création) aplatit la séquence : branches et variantes partent toutes à la suite
- SEQ-018 : Supprimer une étape renumérote par position : une variante A/B devient une étape indépendante, cachée en Liste mais envoyée
- SEQ-019 : Conditions d'arrêt et expéditeurs multiples ignorés à la création et effacés à chaque modification
- SEQ-020 : Un message modifié dans le Journal est ignoré : l'aperçu validé à l'inscription part à la place
- SEQ-021 : Aperçu d'inscription : « Générer toutes les previews » et la touche Entrée écrasent les messages modifiés à la main, puis la version IA part
- SEQ-022 : InMail groupé : le texte corrigé à l'écran est ignoré au clic « Planifier », la version d'origine part

## Ce qui change pour le recruteur

Ce qui est affiché est ce qui est enregistré : conditions d'arrêt, expéditeurs, branches, variantes A/B, fin de séquence. L'éditeur ne propose plus que ce que le moteur exécute. Une branche vide ou qui vise une étape supprimée bloque l'enregistrement. Une étape déjà envoyée ne peut plus être supprimée.

L'aperçu d'inscription est ce qui part : un message modifié à la main n'est plus jamais écrasé par l'IA. Le compte d'envoi est affiché avant l'inscription, et l'inscription est bloquée si ce compte est déconnecté ou appartient à un collègue. Les candidats déjà contactés par l'organisation sont signalés, y compris pour un collaborateur.

Mettre en pause ne perd plus rien : les étapes gardent leur date et repartent à la reprise. Réactiver une séquence ne relance plus les candidats mis en pause un par un. « Envoyer les actions du jour » remplace « Envoyer tout » : limité à la mission et à la journée, avec confirmation. Chaque pause affiche sa cause et le moyen de la lever.

Aucune action ne se déclare réussie sans preuve : chaque écriture est relue, et les actions groupées donnent un bilan exact.

## Décisions produit

Six décisions finales, prises après la relecture contradictoire, priment sur le tableau qui suit.

- D1. Une séquence désactivée n'envoie jamais rien. Le moteur le vérifie lui-même, et aucune reprise automatique ne réactive ses inscriptions.
- D2. Les canaux e-mail et WhatsApp restent fermés. Le moteur saute ces étapes sans aucun appel. Le code de réparation (résolution de la boîte, adresse du candidat, liens signés) est en place pour une réouverture décidée et testée.
- D3. Un collaborateur n'agit que sur les inscriptions qu'il a créées, côté base, côté serveur et dans l'assistant IA. Il ne modifie que les séquences qu'il a créées. Depuis la fusion du lot C1 (28 septembre), il ne lit plus par la base les séquences des missions de son équipe ni leurs candidats : C1 retire toute policy qui passe par l'équipe de mission (R7), et le rôle Collaborateur est gelé jusqu'au lot C2 (R11). Les chemins serveur qui l'autorisent à inscrire dans une séquence d'une mission de son équipe restent en place, à revoir au lot C2. La désactivation d'une séquence et la pause groupée ne lui sont pas proposées. L'anti-doublon passe par une fonction serveur qui voit toute l'organisation, avec une comparaison exacte des identifiants LinkedIn.
- D4. Un rendez-vous Calendly dont l'organisation n'est pas identifiable de façon unique n'arrête rien.
- D5. Un candidat touché par un effacement RGPD ne peut plus être repris ni relancé.
- D6. Les pauses héritées de l'ancien code deviennent `manual`, sauf l'ancienne auto-pause identifiée par son marqueur, qui devient `auto_paused`. Aucune ne devient `sequence_inactive`. Rien ne redémarre seul au déploiement : la reprise passe par « Reprendre tous les candidats en pause » ou candidat par candidat.

| Défaut | Question | Décision retenue |
|---|---|---|
| SEQ-001 | Faut-il garder des boutons d'accélération manuelle ? | supprimer « Traiter maintenant » (panneau) et « Forcer un cycle » (diagnostic), les actions échues partant de toute façon au cycle suivant ; garder un seul « Envoyer les actions du jour », borné côté serveur à la journée et aux séquences de la mission, avec confirmation. |
| SEQ-004 | Faut-il proposer « Relancer » à un candidat qui a répondu ? | oui, mais seulement via un dialogue explicite qui nomme l'action et rappelle la date de réponse ; jamais pour un candidat en pause (il a « Reprendre »). |
| SEQ-005 | Politique de relance d'un envoi dont l'issue est inconnue. | aucune relance automatique d'une action visible après un 5xx ou un délai du POST d'envoi ; exécution en échec « Envoi incertain », relance manuelle après vérification. |
| SEQ-007 | Quelles organisations alimentent un Notion depuis les séquences ? | uniquement celles qui ont relié leur propre Notion ; le Notion interne de Konekt n'est plus jamais alimenté par les données d'une autre organisation. |
| SEQ-015 | Garder « Terminer » au délai dépassé et le Branchement (nouvelle colonne timeout_action, RPC, moteur) ou les retirer ? | les retirer de l'éditeur (l'interface ne promet plus ce que le moteur ne fait pas, aucun code moteur) ; pour arrêter au délai dépassé, l'utilisateur choisit « Aller à une étape » vers une étape marquée « Fin de séquence ». |
| SEQ-016 | Que signifie une branche vide ? | l'interdire à l'enregistrement (message ci-dessus), sans changement moteur ; l'utilisateur choisit explicitement une étape ou « Étape suivante » pour chaque branche. |
| SEQ-024 | Le moteur doit-il lire is_active ? (décision remplacée par D1 : oui) | non (un report horaire dans le moteur affamerait les créneaux et arrêterait en silence les copies créées inactives) ; toute mise en pause de séquence met en pause ses inscriptions, depuis l'interface comme depuis l'assistant. |
| SEQ-029 | Un premier message sauté à la main doit-il bloquer la relance ? | non, le saut manuel ne bloque pas l'étape suivante (le dialogue « Sauter » annonce que la séquence passe à l'étape suivante) ; seuls un échec ou une annulation bloquent. |
| SEQ-041 | Migrer les inscriptions vers le nouveau compte ou les mettre en pause ? | les mettre en pause comme une dissociation (aucun envoi depuis un compte que le membre a quitté), reprise manuelle ensuite. |
| SEQ-042 | Arrêter ou transférer les inscriptions d'un membre retiré ? | les arrêter (pause 'manual', annulation des étapes et InMails), sans transfert automatique. |
| SEQ-043 | Un owner ou admin peut-il inscrire depuis le compte d'un collègue ? | non, chacun envoie depuis son propre compte relié (règle de liaison stricte) ; seule la rotation multi-expéditeurs configurée sur la séquence utilise d'autres comptes. |
| SEQ-055 | Qui peut déclencher un effacement global ? | un client (owner ou admin) n'efface que dans son organisation ; l'effacement toutes organisations est réservé aux administrateurs plateforme. |
| SEQ-059 | Supprimer, archiver ou interdire la suppression d'une étape déjà envoyée ? | interdire la suppression d'une étape qui a un historique (le plus sûr, le moins de code) ; l'archivage d'étape reste une évolution possible. |
| SEQ-061 | Retirer l'attente de visite ou la transformer en pause jusqu'au délai ? | la retirer de l'éditeur tant qu'aucun événement de visite n'est branché. |
| SEQ-063 | Implémenter ces variables ou les retirer ? | retirer {{city}}, {{ai_snippet}} et {{signature}} du menu (aucun code moteur) ; {{calendly_link}} et les variables expéditeur restent et sont réparées côté moteur (SEQ-062). |
| SEQ-065 | Garder le repli InMail des smart_message ? | le garder, mais l'annoncer clairement (libellé, aide, ligne de vérification). |
| SEQ-067 | Garder le canal e-mail visible pendant sa réparation ? | masquer E-mail et WhatsApp dans l'éditeur tant que la résolution de la boîte (E3, B4) et le renseignement des adresses (SEQ-066) ne sont pas livrés, puis les réactiver. |
| SEQ-078 | Que faire après trois vérifications de réponse impossibles ? | ne pas envoyer (échec explicite, relance manuelle). |
| SEQ-089 | Garder ces deux interrupteurs ? | non, l'arrêt sur réponse et sur désinscription est toujours actif. |
| SEQ-092 | Que faire quand les crédits IA manquent ? | reporter l'étape et signaler « Crédits IA épuisés », sans envoyer le modèle brut. |
| SEQ-093 | Objet par défaut ou blocage ? | aucun objet inventé, objet obligatoire dans l'éditeur et report côté moteur. |
| SEQ-094 | Générer la note d'invitation par IA ou retirer l'option ? | retirer l'option pour l'invitation. |
| SEQ-097 | Mode par défaut sans configuration d'approche. | le déduire du type d'organisation (entreprise = interne, cabinet et freelance = cabinet). |
| SEQ-105 | Suivi quand des copies existent. | désactiver pixel, liens suivis et pied de désinscription pour les e-mails avec copie, plutôt qu'un second envoi. |
| SEQ-107 | Garder la condition « Si e-mail bouncé » ? | la retirer, puisqu'un rebond arrête déjà l'inscription. |
| SEQ-112 | Créer un statut « RDV pris » ou clore en « terminée » ? | clore en 'completed' avec la raison dans tracking_data (aucune migration). |
| SEQ-116 | Durée de conservation des données de séquence. | la même durée que les autres données candidat déjà purgées par rgpd-purge, à confirmer par le produit. |
| SEQ-119 | Périmètre du collaborateur sur les séquences. | moindre privilège (écriture sur ses propres inscriptions, lecture limitée à ses missions). |
| SEQ-121 | Nouvelles raisons de pause et leurs libellés. | 'send_failed' (échec d'envoi), 'auto_paused' (trop d'échecs), 'blocked_by_candidate' (candidat injoignable), plus 'sequence_inactive' ; chaque libellé propose l'action qui débloque. |
| SEQ-122 | Archiver au lieu de supprimer une séquence qui a des inscrits ? | garder la suppression avec cet avertissement explicite ; l'archivage reste une évolution possible. |
| SEQ-123 | Retirer un candidat de la mission arrête-t-il sa séquence ? | oui par défaut, avec une case explicite pour la laisser continuer. |
| SEQ-124 | Quand passer un candidat à « contacté » ? | garder l'écriture à l'inscription sans jamais rétrograder un statut plus avancé ; le passage au premier envoi réel (moteur) reste une évolution. |
| SEQ-154 | Comportement de l'enregistrement. | un seul bouton « Enregistrer », séquence créée active sauf si le plan n'autorise pas l'envoi (créée désactivée, avec message). |
| SEQ-155 | Que faire quand tous les expéditeurs ont atteint leur limite ? | reporter au lendemain plutôt que surcharger le premier compte. |
| SEQ-156 | Rotation réservée à LinkedIn ? | oui ; la boîte e-mail sera résolue séparément (SEQ-067). |
| SEQ-160 | Autoriser les boucles vers une étape antérieure ? | non, filtre dans l'éditeur, sans changement moteur. |
| SEQ-187 | Cadence d'envoi. | plafond par compte d'envoi, borné par le budget de temps du cycle, e-mail hors espacement LinkedIn. |
| SEQ-197 | Priorité des fuseaux. | fuseau réglé par le titulaire du compte d'envoi, puis fuseau de l'inscription. |
| SEQ-202 | Désinscription globale ou par organisation ? | globale (le candidat qui se désinscrit ne reçoit plus aucun e-mail de séquence), sans exposer la raison aux autres organisations. |
| SEQ-206 | Répondre dans le fil ou ouvrir une nouvelle conversation ? | ne rien changer avant le rétablissement du canal e-mail, puis répondre dans le fil par défaut. |
| SEQ-207 | Domaine de suivi dédié. | reporter après le rétablissement du canal e-mail. |
| SEQ-212 | Une réponse arrête-t-elle toutes les séquences du candidat dans l'organisation ? | oui (aucune relance après une réponse, quel que soit le compte). |
| SEQ-245 | Lexique commun. | « inscrire » et « inscription » (jamais « enrôler »), « candidat » partout, « mettre en pause » pour tout ce qui écrit le statut paused (réversible), « arrêter » réservé à un arrêt définitif, vouvoiement partout. |

## Mise en production

0. Les quatre migrations de ce chantier (`20260928140414` à `20260928140417`) ont été renumérotées le 28 septembre, à la fusion de `main` : le lot C1 (`20260927233806`) était déjà en production, et `db push` sans `--include-all` refuse une version plus ancienne que la dernière appliquée. Elles passent donc après C1 et ne défont rien de lui : la reconstruction des policies des séquences ne retire que les policies permissives (les RESTRICTIVE `mission_same_org_*` de C1 restent), aucune policy ne passe plus par l'équipe de mission, et la lecture des conversations et des actions de l'assistant reste celle de C1 (bloc D15 et lecture du journal retirés de ces migrations). Rejouées sur une base neuve (278 migrations) : les 15 audits SQL passent, ceux de C1 compris.
1. La migration `20260928140414` doit être appliquée avant les edge functions et le front. Le workflow `deploy-migrations.yml` la joue au push sur `main`, en même temps que les fonctions et Vercel : vérifier qu'il passe. Si elle manque, le moteur retombe sur la raison de pause `manual` (repli prévu), et la désactivation d'une séquence échoue avec un message, sans faux succès.
2. Secret facultatif `EMAIL_LINK_SIGNING_SECRET` pour signer les liens suivis des e-mails (repli sur la clé de service). Sans effet tant que le canal e-mail est fermé.
3. Après déploiement, régénérer `src/integrations/supabase/types.ts` avec `supabase gen types typescript --linked`. Les fonctions nouvelles y ont été ajoutées à la main.
4. Vérifier la ligne `organization_integrations` de l'organisation Konekt : la synchronisation Notion après envoi ne tourne plus que si `notion_connected` est vrai et que les identifiants correspondent à ceux de la plateforme.
5. Deux migrations issues des tests de bout en bout, à appliquer avec la première : `20260928140415` (garde du compte d'envoi à la modification, `assigned_sender_id` réservé au moteur, clés étrangères `created_by` des modèles et extraits alignées sur la production, `executed_at` des actions de l'assistant protégé) et `20260928140416` (inscription d'un candidat effacé non réactivable). Toutes deux rejouent sur une base vide. Puis `20260928140417` (décisions produit : gardes d'inscription et de reprise, étapes réservées au serveur, droits retirés).
6. État de la production au 25 septembre : 2 séquences, 17 inscriptions, aucune active (15 en pause, 2 répondues). Le déploiement ne relance donc aucun envoi.

## Tests de bout en bout (27 septembre)

L'application a été testée contre une copie locale de Supabase : la même base (image `supabase/postgres` 17, les 274 migrations rejouées avec le rôle de la CLI), l'authentification, l'API REST, les edge functions servies par Deno, et un faux LinkedIn qui enregistre chaque envoi au lieu de le faire. Montage et utilisation : `e2e/local-stack/README.md`. La production n'a jamais été touchée.

Résultats, deux passages de suite à chaque fois :

- audits SQL de la CI : 5 fichiers, 74 contrôles, tous passent ;
- tests d'API : 32 sur 32. Les 12 tests du moteur (`sequences-engine.spec.ts`), ignorés jusqu'ici faute de fonctions déployées, passent ;
- tests d'interface (Chromium, 1280 px) : 46 passent, 1 échoue, la carte « Extension Chrome » des Paramètres (code identique à `main`, hors séquences).

Les sept vérifications manuelles prévues avant la fusion sont maintenant des tests :

| Scénario | Fichier | Résultat |
|---|---|---|
| 1. Éditeur : vérification de connexion à deux branches, conditions d'arrêt, deux expéditeurs, réouverture | `e2e/flows/sequences-builder.spec.ts` | Tout est conservé, en base et à l'écran, y compris après un second enregistrement |
| 2. Aperçu modifié à l'inscription | `e2e/api/sequences-scenarios.spec.ts` | Le texte modifié, à l'inscription ou dans le Journal, est celui qui part et celui que le Journal affiche |
| 3. Pause d'un candidat, désactivation puis réactivation | `e2e/flows/sequences-enrollments.spec.ts` | Le candidat mis en pause à la main reste en pause ; les autres reprennent à leur date prévue |
| 4. Déconnexion et reconnexion du compte | `sequences-scenarios.spec.ts` | Reprise si la séquence est active ; rien ne part si elle a été désactivée entre-temps |
| 5. Réponse pendant une relance programmée | `sequences-scenarios.spec.ts` | Inscription « A répondu », relance annulée, rien ne part |
| 6. Collaborateur | `sequences-enrollments.spec.ts`, `sequences-scenarios.spec.ts` | Pas d'interrupteur ni d'action sur la séquence et les candidats d'un autre ; doublons de toute l'organisation signalés |
| 7. Retrait d'un membre | `sequences-enrollments.spec.ts`, `sequences-scenarios.spec.ts` | Envois arrêtés avant la suppression, inscriptions en pause, rien ne part ensuite |

Le filtre de sélection du moteur sur les pages 2 et suivantes a son test : un compte au plafond sur la première page n'empêche pas les envois des comptes suivants. Les quatre parcours laissés « à écrire » dans `e2e/flows/sequences.spec.ts` sont couverts : création depuis l'éditeur, duplication, saut d'étape, envoi des actions du jour par un membre non administrateur.

Deux défauts trouvés par ces tests, corrigés :

| Défaut | Correctif |
|---|---|
| La pastille « Partagée entre missions », ajoutée par l'audit, réduisait le nom de la séquence à une largeur nulle dans la liste | La pastille passe à la ligne (`SequencesList.tsx`) |
| Webhook LinkedIn : « déconnecté » puis « OK » reçus dans la même minute au format à plat (API v2 comprise) comptaient pour un seul événement, le compte restait noté déconnecté et ses inscriptions en pause. Même collision pour deux messages au format `new_message` | La clé de dédoublonnage inclut le statut et l'identifiant du message (`unipile-webhook`) |

Reste à voir sur une préversion, avec un vrai compte LinkedIn : l'envoi réel (le faux LinkedIn répond toujours par un succès) et le format exact des webhooks reçus.

## Seconde vague de tests (27 et 28 septembre)

Question posée : a-t-on fait tous les tests possibles ? Non. Un inventaire lu dans le code a recensé 741 comportements testables du module (moteur, types d'étapes, événements entrants, actions des membres, base, interface, assistant, actions programmées, file InMail, identités LinkedIn). 59 seulement avaient un test de bout en bout ; 197 n'avaient qu'un test qui lit le code sans l'exécuter, 386 aucun test.

Les 350 comportements critiques ou graves sans test de bout en bout ont été répartis en 20 lots. Chaque lot a écrit ses tests et les a joués contre la stack locale, avec un faux prestataire scriptable par compte (pannes, délais, réponses particulières). Chaque défaut signalé a été repris par deux relecteurs indépendants, l'un pour le reproduire, l'autre pour le confronter au contrat.

- 453 tests écrits (fichiers `e2e/api/seq-*.spec.ts`, `e2e/flows/seq-*.spec.ts`, `supabase/tests/seq_*_audit.sql`, tests Deno `supabase/functions/_shared/seq-*.test.ts`).
- 61 défauts signalés : 51 confirmés par les deux relecteurs (10 critiques, 33 graves, 7 moyens, 1 mineur), 6 incertains, 4 réfutés.
- 47 questions de décision produit (voir plus bas).

Les 51 défauts confirmés ont été corrigés en six lots de fichiers distincts, chacun relu par deux relecteurs puis repris une fois. Les relectures ont trouvé 6 problèmes dans les correctifs eux-mêmes, tous repris : une régression de la garde « aucun message précédent » après une relance, un contournement de la garde du compte d'envoi par `assigned_sender_id`, un identifiant alternatif perdu dans la recherche des InMails répondus, une dérogation encore possible par le slug du profil, la portée du contrat §8 oubliée par le dernier contrôle de la file InMail, et la garde en base manquante pour les candidats effacés.

Défauts critiques corrigés :

| Défaut | Correctif |
|---|---|
| Au rejeu d'une réponse dont le premier traitement avait échoué, les inscriptions du candidat sur les autres comptes n'étaient jamais arrêtées et leurs relances partaient | Le webhook refait l'arrêt des sœurs à partir des inscriptions déjà closes (`_shared/candidate-reply-closure.ts`) |
| Un InMail programmé partait après une réponse du candidat, sur le même compte ou sur une séquence d'un autre compte | La réponse annule les InMails en attente de l'organisation, et la file refait le contrôle juste avant l'envoi |
| L'outil d'envoi de l'assistant écrivait à un candidat effacé (RGPD), y compris pour un message programmé effacé entre l'approbation et l'échéance | Contrôle d'effacement (registre et marqueur de l'organisation) à l'approbation et à l'exécution |
| L'assistant pouvait envoyer depuis le compte d'un collègue, dans une conversation de ce collègue | Refus : seules les conversations des comptes de l'appelant |
| Une inscription programmée par l'assistant était créée pour un candidat effacé par l'organisation | Contrôle du marqueur de l'organisation, avec ou sans adresse de profil |
| Un client pouvait effacer `executed_at` d'une action de l'assistant et la faire rejouer par le cron | Migration `20260928140415` : seule la remise en attente d'un échec l'efface |

Parmi les défauts graves corrigés : garde du compte d'envoi contournable par une modification de l'inscription ; réponse reportée dans toutes les missions de l'organisation, ou jamais au pipeline selon le chemin de détection ; condition « Si pas de réponse » qui terminait l'inscription sans la clore ; rendez-vous rattaché par un morceau d'adresse de profil ; même personne inscrite deux fois dans une séquence sous deux identifiants ; lectures de l'assistant qui comptaient une autre organisation ou lisaient la boîte d'un collègue ; journal de l'assistant lisible par un collaborateur ; faux succès à l'annulation de l'action d'un collègue ; candidat effacé repassé « actif » par une écriture directe dans l'API (migration `20260928140416`).

Le second passage de la suite complète a fait apparaître un défaut intermittent de l'éditeur visuel, introduit par l'audit : quand deux étapes restaient sélectionnées un instant dans le schéma, la sélection au clavier basculait de l'une à l'autre sans fin et le panneau de réglages ne se stabilisait plus. Un premier correctif (ne suivre qu'une sélection d'une seule étape) n'a pas suffi : le troisième passage montrait encore le panneau d'une autre étape que celle cliquée. Deux causes, corrigées le 28 septembre. Le panneau attendait la fin de l'animation de sortie de l'étape précédente (`AnimatePresence` en mode « wait » dans `VisualSequenceEditor.tsx`), si bien qu'un clic rapide laissait affichés les réglages de la précédente. Et la sélection posée par l'éditeur relançait `onSelectionChange`, qui rebasculait l'éditeur : `WorkflowCanvas.tsx` n'écoute plus ce signal, Entrée ou Espace sur une étape focalisée ouvre ses réglages. Nouveau test `e2e/flows/seq-editor-canvas.spec.ts` : le test des clics rapides échoue sur l'ancien code, le test clavier échoue sans le nouveau gestionnaire. Vérifié ensuite : 145 tests d'éditeur et d'interface verts, deux fois chacun, avec deux navigateurs en parallèle.

Résultat après corrections, sur la stack locale, deux passages de la suite complète : 372 tests d'API sur 372 ; 116 tests d'interface verts, 6 mis de côté (décisions en attente), 1 échec hors séquences (carte « Extension Chrome », code identique à `main`) ; 10 fichiers d'audit SQL verts sur une base neuve où les 276 migrations rejouent ; tests UX 840, agent 40, Deno 150 ; tsc 24 ; build OK.

### Décisions produit (validées et appliquées le 28 septembre)

Les 35 recommandations ci-dessous, entre parenthèses, ont été retenues telles quelles et appliquées en six lots de fichiers, chacun relu par deux relecteurs puis repris si besoin, avec des tests dédiés (`e2e/api/seq-decisions-*.spec.ts`, `e2e/flows/seq-decisions-*.spec.ts`, `supabase/tests/seq_decisions_db_audit.sql`, tests Deno `seq-decisions-*.test.ts`) et la migration `20260928140417`.

Envois et quotas :
1. Un envoi incertain (erreur 5xx ou délai après l'appel) doit-il compter dans le taux d'échec qui désactive une séquence ? (Non : une panne passagère du prestataire ne doit pas arrêter une séquence.)
2. Même question pour une lecture de profil impossible à l'étape « Vérifier la connexion ». (Non.)
3. Une étape arrêtée après le verrou sans rien envoyer (déjà en relation, texte vide, IA indisponible) consomme-t-elle une place du plafond LinkedIn ? (Non.)
4. Tous les expéditeurs de la rotation au plafond : report au lendemain dans le fuseau et à l'heure de début du titulaire ? (Oui.)
5. Une boucle qui revient sur une étape déjà partie doit-elle clore l'inscription en « terminée » ? (Oui.)
6. Une pause posée par le moteur (abonnement requis, compte non rattaché) annule l'étape courante puis la reprise la réarme, contrairement à la règle « aucune pause n'annule d'exécution ». (Garder ce fonctionnement et l'écrire dans le contrat.)
7. Sur un refus 403 à la vérification de réponse, l'étape gardée doit-elle conserver sa date et son compteur d'essais ? (Oui.)

Réponses :
8. Une réponse reçue sur une inscription terminée (réponse à la dernière relance) doit-elle la passer « A répondu », compter une réponse et mettre à jour le pipeline ? (Oui.)
9. La scrutation de secours doit-elle examiner les inscriptions terminées récemment ? (Oui, sur 14 jours.)
10. En cas d'échec persistant de l'arrêt des sœurs, garder le 500 pour obtenir des rejeux, ou prévenir le recruteur ? (Les deux : 500 et notification.)
11. Format `new_message` sans indication d'expéditeur, vérification impossible : clore quand même ou échouer et rejouer ? (Échouer et rejouer.)

RGPD et droits :
12. Bloquer une nouvelle inscription d'un profil effacé (registre global ou organisation) ? (Oui.)
13. Registre d'effacement illisible : refuser l'inscription et l'envoi ? (Oui.)
14. Refuser la mise en file InMail d'un candidat effacé dès la mise en file ? (Oui ; l'envoi est déjà bloqué.)
15. Conversations et messages de l'assistant (`agent_conversations`, `agent_messages`) lisibles par toute l'organisation, y compris le résumé des inscriptions d'un collègue. (Limiter à ses lignes, propriétaire et administrateur voient tout.) Remplacée à la fusion du lot C1 (R3), plus strict : chaque conversation n'est lue que par son auteur, propriétaire et administrateur compris.
16. Un membre (rôle `member`) a-t-il les mêmes droits dans les lectures et les actions de l'assistant ? (Oui, comme dans l'interface.)
17. Refuser en base toute réactivation d'inscription hors du serveur, au-delà du cas RGPD ? (Oui.)
18. Refuser en base qu'un utilisateur connecté réarme une étape annulée ou insère lui-même des étapes ? (Oui.)
19. Retirer à `anon` et `authenticated` les droits TRUNCATE et d'écriture inutiles sur les tables du module ? (Oui.)
20. Refuser une inscription écrite côté serveur sans auteur depuis le compte d'un membre ? (Oui.)

Doublons et identités :
21. Garde en base contre la même personne inscrite deux fois dans une séquence sous deux identifiants ? (L'interface et l'assistant le refusent désormais ; une garde en base en plus.)
22. Un seul envoi par personne et par cycle, toutes identités confondues ? (Oui.)
23. Réinscrire la même personne dans la même séquence sous un autre identifiant après une inscription arrêtée ou terminée depuis plus de 90 jours ? (Autoriser avec avertissement.)
24. La file InMail doit-elle refuser côté serveur un candidat inscrit ou contacté depuis moins de 90 jours, et « arrêtée » compte-t-il ? (Oui aux deux.)

Rendez-vous :
25. Un rendez-vous pris avant le début d'une inscription doit-il l'arrêter ? (Non.)
26. La clôture par rendez-vous côté moteur écrit-elle la raison `meeting_booked` et prévient-elle le recruteur, comme le webhook ? (Oui.)
27. Un rendez-vous annule-t-il aussi les InMails en attente vers le candidat ? (Oui.)
28. L'étape arrêtée par une condition d'arrêt doit-elle être « annulée » plutôt que « sautée » ? (Annulée.)

Interface :
29. Le pipeline d'une mission n'a pas de colonne « Répondu » : l'ajouter ? (Oui.)
30. Reprise d'une inscription en pause dont toutes les étapes sont parties : la passer « terminée » ? (Oui.)
31. La fiche candidat masque-t-elle à un collaborateur les actions sur les inscriptions d'un autre membre, comme le suivi des inscrits ? (Oui.)
32. Bloquer l'activation d'une séquence tant que l'état de l'abonnement n'est pas chargé ? (Oui.)
33. Second clic « Approuver » sur une action déjà exécutée : refuser « déjà traitée » ? (Oui.)
34. Message programmé dont le compte d'envoi a changé avant l'échéance : échouer ou partir du nouveau compte ? (Échouer avec un message.)
35. La reprise groupée par séquence refuse-t-elle une séquence désactivée, comme la reprise par candidat ? (Oui.)

Les autres questions relevées par les lots sont tranchées par les correctifs (garde rendez-vous par slug exact, pipeline mis à jour par tous les chemins, clés étrangères des modèles alignées sur la production) ou de simple forme (code 403 ou 404 d'un refus, titre du menu sur l'offre gratuite).

### Fusion du lot C1 et passages finaux (28 septembre)

La branche a reçu `main` avec le lot C1 (réparations des fuites entre organisations) et le retrait du code Notion. Trois conséquences pour les séquences :

- Les quatre migrations du chantier sont renumérotées après celle de C1, déjà en production (voir « Mise en production », point 0).
- Dans l'ordre d'origine, le balayage R7 de C1 aurait supprimé toute la policy de lecture des inscriptions posée par B6, parce qu'elle citait l'équipe de mission : plus aucun utilisateur connecté n'aurait lu ses inscriptions. La clause d'équipe est retirée et B6 passe après C1.
- Un collaborateur ne lit plus par la base les séquences des missions de son équipe ni leurs candidats, et un partenaire d'une autre organisation ne voit ni ne duplique plus une séquence de la mission. Cinq tests d'interface sont réécrits : ils vérifient l'absence de ces séquences et, sur une séquence du collaborateur, qu'il n'agit toujours pas sur les candidats d'un collègue.

Résultats sur l'état fusionné, stack locale :

- Suite complète, premier passage : 439 tests d'API réussis et 1 ignoré ; 132 tests d'interface réussis, 4 ignorés, 5 échecs (les cinq tests ci-dessus), 3 non lancés à leur suite.
- Après leur réécriture : les trois fichiers concernés, 40 tests sur 40 ; puis second passage complet, 439 tests d'API réussis et 1 ignoré, 140 tests d'interface réussis, 4 ignorés (conditions d'environnement ou `fixme` antérieurs), aucun échec.
- 15 fichiers d'audit SQL verts sur une base neuve où les 278 migrations rejouent, les quatre audits de C1 compris.
- Tests UX 840, agent 40, C1 42, Deno 172 ; tsc 24 erreurs (25 sur `main`) ; build OK.
- CI de la pull request (CI et E2E) verte sur l'état fusionné.

### Ce que cette vague ne couvre pas

- 266 comportements de gravité moyenne et 71 mineurs, sans test de bout en bout.
- 18 zones signalées par la relecture de l'inventaire et non détaillées : cycle de vie du candidat et de la mission, désinscription et liste de suppression e-mail, plafond LinkedIn partagé entre producteurs, fuseaux horaires et heure d'été, statistiques, missions partagées avec un partenaire, formes de `job_id`, écrans hors module qui lisent les séquences, notifications, changement de rôle en cours de parcours, débit avec la latence réelle du prestataire, entre autres.
- Pannes de la base pendant un cycle (lecture ou écriture refusée) : non injectables dans la stack locale, couvertes seulement par les tests des règles pures.
- Envoi réel sur LinkedIn.

## Ce qui reste ouvert

- Réouvrir les canaux e-mail et WhatsApp, avec un test réel de bout en bout (envoi, suivi, désinscription, réponse dans le fil). SEQ-206 et SEQ-207 en dépendent.
- Brancher la synchronisation Notion sur les identifiants propres de chaque organisation (SEQ-007).
- Faire tourner dans la CI les tests qui exigent le moteur : le workflow e2e n'y sert pas les edge functions, et ces tests s'ignorent d'eux-mêmes sans la stack locale (`e2e/local-stack/README.md`). Les audits SQL des séquences, eux, tournent désormais dans la CI.
- Couvrir les comportements moyens et les 18 zones restantes.
- Accès du collaborateur aux séquences des missions de son équipe : retiré par le lot C1, à redéfinir au lot C2. Les chemins serveur qui l'autorisent encore à inscrire dans une séquence d'une mission de son équipe (assistant, `process-sequences`) sont à aligner sur la décision.
- Tester en préversion avec un vrai compte LinkedIn, sur quelques candidats internes, avant toute ouverture commerciale.
- Nettoyage des tests : les organisations de test restent en base, le déclencheur `prevent_last_owner_removal` bloque la suppression de leur propriétaire (déjà le cas avant l'audit).
- Libellé de l'onglet de mission « Outreach » : laissé tel quel, le renommer touche la navigation de toute l'application.

## Registre des 246 défauts

| ID | Gravité | Défaut | État |
|---|---|---|---|
| SEQ-001 | Critique | « Envoyer tout », « Traiter maintenant » et « Forcer un cycle » avancent sans borne toutes les relances futures de l'organisation | Corrigé |
| SEQ-002 | Critique | Réactiver une séquence relance aussi les candidats mis en pause à la main, par l'Inbox ou par la dissociation d'un compte | Corrigé |
| SEQ-003 | Critique | BUG-095 non corrigé : un message livré pendant une pause ou une réponse est marqué « annulé » puis renvoyé à la reprise | Corrigé |
| SEQ-004 | Critique | « Reprendre » et « Ré-enrôler » réarment côté navigateur une exécution annulée choisie à l'aveugle : renvoi d'un message déjà reçu, envoi immédiat d'une relance future, reprise sans effet | Corrigé |
| SEQ-005 | Critique | Double envoi sur envoi incertain : relance automatique après 5xx ou délai, second envoi immédiat dans une nouvelle conversation, e-mail renvoyé quand le statut n'a pas été écrit | Corrigé |
| SEQ-006 | Critique | Réponse détectée : job_candidate_status passé « Répondu » dans les autres organisations (polling) et dans toutes les missions de l'organisation (pré-envoi) | Corrigé |
| SEQ-007 | Critique | check_replies et l'envoi synchronisent les candidats de toutes les organisations dans le Notion interne de Konekt | Corrigé en partie : plus aucune donnée d’une organisation dans le Notion de Konekt ; la synchronisation vers le Notion propre d’une organisation reste à brancher |
| SEQ-008 | Critique | Calendly : arrêt des séquences sans filtre d'organisation, par sous-chaîne d'URL ou sans filtre de profil | Corrigé |
| SEQ-009 | Critique | sequence_steps : un membre de n'importe quelle organisation peut insérer ou modifier une étape dans la séquence d'une autre | Corrigé |
| SEQ-010 | Critique | Le compte d'envoi d'une inscription n'est jamais vérifié contre son organisation : envoi possible depuis le compte d'une autre organisation | Corrigé |
| SEQ-011 | Critique | inmail_queue : une insertion directe par l'API contourne le contrôle de propriété du compte d'envoi | Corrigé |
| SEQ-012 | Critique | Réponse ou acceptation d'un candidat ignorée quand son inscription est en pause : la reprise relance après la réponse | Corrigé |
| SEQ-013 | Critique | BUG-023 non corrigé : assigned_sender_id est de type uuid, le compte de rotation n'est jamais enregistré (suite de conversation depuis un autre compte, rattachement webhook impossible) | Corrigé |
| SEQ-014 | Critique | « Annuler l'étape » dans le Journal ne l'empêche pas de partir : le moteur la replanifie une heure plus tard | Corrigé |
| SEQ-015 | Critique | « Si timeout : Terminer » et l'étape « Branchement » (Si faux) ne sont jamais enregistrés : le moteur continue et envoie la suite | Corrigé |
| SEQ-016 | Critique | Une branche de « Vérifier connexion » laissée vide ou dont la cible a été supprimée envoie les candidats dans l'autre branche | Corrigé |
| SEQ-017 | Critique | « Dupliquer une existante » (création) aplatit la séquence : branches et variantes partent toutes à la suite | Corrigé |
| SEQ-018 | Critique | Supprimer une étape renumérote par position : une variante A/B devient une étape indépendante, cachée en Liste mais envoyée | Corrigé |
| SEQ-019 | Critique | Conditions d'arrêt et expéditeurs multiples ignorés à la création et effacés à chaque modification | Corrigé |
| SEQ-020 | Critique | Un message modifié dans le Journal est ignoré : l'aperçu validé à l'inscription part à la place | Corrigé |
| SEQ-021 | Critique | Aperçu d'inscription : « Générer toutes les previews » et la touche Entrée écrasent les messages modifiés à la main, puis la version IA part | Corrigé |
| SEQ-022 | Critique | InMail groupé : le texte corrigé à l'écran est ignoré au clic « Planifier », la version d'origine part | Corrigé |
| SEQ-023 | Grave | Étape échue pendant une pause ou une désactivation marquée « sautée » : perdue à la reprise, et la réactivation fait passer les attentes pour des événements survenus | Corrigé |
| SEQ-024 | Grave | L'assistant « met en pause » une séquence en basculant seulement is_active, que le moteur ignore : les relances partent quand même | Corrigé |
| SEQ-025 | Grave | Désactiver ou supprimer une séquence affiche un succès sans vérifier les écritures (échec de la mise en pause, refus RLS silencieux) | Corrigé |
| SEQ-026 | Grave | « Arrêter toutes les séquences actives » n'arrête que les 200 inscriptions chargées | Corrigé |
| SEQ-027 | Grave | Contrôles de délais et d'attentes appliqués aux inscriptions en pause ou répondues, clôtures sans garde de statut : 'replied' ou 'paused' écrasé par 'completed' | Corrigé |
| SEQ-028 | Grave | Compte déconnecté détecté à l'envoi : pause sans pause_reason, exécution en échec, jamais reprise à la reconnexion, et comptée dans l'auto-pause de la séquence | Corrigé |
| SEQ-029 | Grave | Garde « no_previous_message » : une étape précédente sautée (canal indisponible, condition) clôt toute l'inscription au message suivant | Corrigé |
| SEQ-030 | Grave | Garde de compatibilité de scheduleNextStep : l'inscription est close sur un connection_status périmé juste après l'invitation au lieu de sauter l'étape | Corrigé |
| SEQ-031 | Grave | Étape d'attente sans wait_for_event (mode Visuel, assistant) : « Attendre réponse » clôt l'inscription en « a répondu », « Attendre connexion » marque le candidat connecté | Corrigé |
| SEQ-032 | Grave | Test A/B en séquence linéaire : le repli step_order+1 échoue sur plusieurs lignes, l'inscription se termine sans rien envoyer | Corrigé |
| SEQ-033 | Grave | Chaîne next_step_id rompue par l'éditeur (suppression en Visuel, ajout en Liste) : les étapes suivantes ne s'exécutent jamais alors que le canevas les montre reliées | Corrigé |
| SEQ-034 | Grave | Aucune vérification de réponse avant le premier message qui suit une invitation avec note | Corrigé |
| SEQ-035 | Grave | Échec ou réponse vide de la génération IA : envoi d'un message vide, du seul prénom de signature ou d'un ancien modèle masqué | Corrigé |
| SEQ-036 | Grave | Invitation envoyée à un candidat déjà en relation ou déjà invité : échec définitif et séquence mise en pause | Corrigé |
| SEQ-037 | Grave | smart_message et InMail vers un candidat connecté bloqués faute de crédits InMail, et InMails partis via smart_message hors du plafond InMail | Corrigé |
| SEQ-038 | Grave | setLocalHour applique l'heure locale sur la date UTC : créneau dans le passé, jour sauté ou envoi le week-end | Corrigé |
| SEQ-039 | Grave | Les réponses par e-mail ne sont jamais rattachées à l'inscription : les relances partent après la réponse | Corrigé |
| SEQ-040 | Grave | Webhook LinkedIn : erreurs de base et vérification d'expéditeur en échec avalées, réponse perdue avec un 200 et aucun rejeu | Corrigé |
| SEQ-041 | Grave | Changement de compte LinkedIn d'un membre (claim, nouvelle connexion) : l'ancien compte continue d'envoyer | Corrigé |
| SEQ-042 | Grave | Retirer un membre de l'équipe laisse partir les envois depuis son compte LinkedIn | Corrigé |
| SEQ-043 | Grave | Le compte d'envoi est choisi en silence, souvent celui d'un collègue, et n'est jamais affiché ni vérifié avant l'inscription (interface et assistant) | Corrigé |
| SEQ-044 | Grave | Inscription par l'assistant sans première exécution : démarrage différé d'une heure, ou clôture sans envoi sur une séquence créée par l'assistant | Corrigé |
| SEQ-045 | Grave | Le parcours avec aperçu (quasi toutes les séquences) n'a aucun contrôle de compatibilité : invitation à un contact déjà en relation | Corrigé |
| SEQ-046 | Grave | Anti-doublon : le même candidat inscrit sous un autre identifiant (Recruiter ou classique) n'est pas détecté | Corrigé |
| SEQ-047 | Grave | Fermer ou annuler pendant une inscription groupée n'arrête rien, sans bilan ni progression | Corrigé |
| SEQ-048 | Grave | « Shortlister sans message » annonce un succès sans lire le résultat, et écrit sans organization_id (refusé par la RLS) | Corrigé |
| SEQ-049 | Grave | Pipeline de mission : « Arrêter la séquence » vise une inscription prise au hasard, éventuellement d'une autre mission | Corrigé |
| SEQ-050 | Grave | Depuis la fiche profil, la préparation d'inscription s'ouvre sous la fiche : invisible, mais ses raccourcis clavier restent actifs | Corrigé |
| SEQ-051 | Grave | InMail groupé : la configuration d'approche de la mission est ignorée, le nom d'un client à anonymiser peut apparaître | Corrigé |
| SEQ-052 | Grave | Condition « Si score au-dessus de » lit le meilleur score du candidat toutes organisations et tous postes confondus | Corrigé |
| SEQ-053 | Grave | Personnalisation IA : lecture du profil et de la mission stockés par une autre organisation | Corrigé |
| SEQ-054 | Grave | Effacement RGPD : les séquences en cours continuent et le candidat reste réinscriptible, alors que le succès est affiché | Corrigé |
| SEQ-055 | Grave | rgpd-erase-contact : tout utilisateur authentifié supprime les enrichissements de toutes les organisations | Corrigé |
| SEQ-056 | Grave | Aucune cohérence d'organisation imposée entre exécution, inscription, étape, séquence et projet | Corrigé |
| SEQ-057 | Grave | sequence_analytics : la RPC écrit des lignes sans organization_id, invisibles en prod et lisibles par tous en base neuve | Corrigé |
| SEQ-058 | Grave | sequence_templates : tout membre peut publier un modèle is_system affiché avec le badge Konekt dans toutes les organisations | Corrigé |
| SEQ-059 | Grave | Supprimer une étape déjà envoyée efface son historique et son suivi e-mail, et la réponse à cet e-mail n'est plus détectée | Corrigé |
| SEQ-060 | Grave | « Dupliquer » (liste) et les modèles perdent la fin de séquence, les options e-mail (dont la désinscription), les conditions d'arrêt et l'ordre des variantes | Corrigé |
| SEQ-061 | Grave | « Attendre visite retour » n'attend jamais : l'étape suivante part immédiatement | Corrigé |
| SEQ-062 | Grave | {{sender_name}}, {{mon_prenom}}, {{ma_signature}}, {{mon_poste}} et {{calendly_link}} toujours vides à l'envoi : requêtes sur des colonnes inexistantes | Corrigé |
| SEQ-063 | Grave | Le menu Variables propose {{city}}, {{ai_snippet}} et {{signature}} que le moteur efface, et l'aperçu montre de fausses valeurs ou des variables brutes | Corrigé |
| SEQ-064 | Grave | {{job_title}} (poste actuel du candidat) est remplacé par le titre de la mission | Corrigé |
| SEQ-065 | Grave | « Message LinkedIn IA » annoncé « 1er degré » part en InMail payant vers les non-connectés | Corrigé |
| SEQ-066 | Grave | email_used et phone_used ne sont jamais renseignés : toutes les étapes e-mail et WhatsApp sont sautées en silence | Corrigé |
| SEQ-067 | Grave | Canal e-mail : aucune boîte d'envoi n'est résolue, l'e-mail part avec l'identifiant du compte LinkedIn et reste bloqué par l'état de ce compte | Neutralisé : canal e-mail fermé (décision D2) |
| SEQ-068 | Grave | « Retour » jette sans prévenir les modifications d'une séquence, ou tout le travail parti d'un modèle ou d'une copie | Corrigé |
| SEQ-069 | Grave | À la réouverture, « Si timeout » affiche « Passer à l'étape suivante » alors que l'étape de repli reste active | Corrigé |
| SEQ-070 | Grave | Résultats A/B toujours à zéro, e-mails ouverts ou cliqués non comptés comme envoyés, envois e-mail absents des statistiques | Corrigé |
| SEQ-071 | Moyen | BUG-099 incomplet : plusieurs clôtures et arrêts n'annulent que les exécutions 'scheduled', les attentes et blocages de quota restent vivants | Corrigé |
| SEQ-072 | Moyen | « Sauter » est accepté sur une étape en cours d'envoi : le message écarté part quand même | Corrigé |
| SEQ-073 | Moyen | Auto-pause calculée sur le lot global : les échecs d'une organisation mettent en pause la séquence d'une autre | Corrigé |
| SEQ-074 | Moyen | Aucun budget de temps dans les boucles du moteur : exécution coupée en 'sending', verrou tenu jusqu'à 10 minutes | Corrigé en partie : échéance de 40 s par passage, sans découpage fin des appels |
| SEQ-075 | Moyen | Quatre crons partagent un verrou unique et tombent sur les mêmes minutes : des contrôles sont sautés en silence | Corrigé |
| SEQ-076 | Moyen | Le plafond LinkedIn est décompté avant les contrôles qui annulent l'envoi : une étape sautée ou relancée consomme une place | Corrigé |
| SEQ-077 | Moyen | Profil LinkedIn illisible interprété comme « non connecté » : mauvaise branche, étape sautée pour toujours, connection_status écrasé | Corrigé |
| SEQ-078 | Moyen | Vérification de réponse avant envoi : un échec technique vaut « pas de réponse » et la relance part | Corrigé |
| SEQ-079 | Moyen | BUG-096 incomplet : le passage à 'sent' après un envoi réussi n'est pas vérifié | Corrigé |
| SEQ-080 | Moyen | Janitor 'sending' : la ligne de suivi e-mail, créée avant l'envoi, sert de preuve d'envoi | Corrigé |
| SEQ-081 | Moyen | Garde anti-doublon de planification contournée par les variantes A/B | Corrigé |
| SEQ-082 | Moyen | Le janitor des inscriptions dormantes reprend en linéaire : il ignore la branche de délai dépassé et le résultat de « Vérifier connexion » | Corrigé |
| SEQ-083 | Moyen | Le délai d'une attente est mesuré depuis la création de l'exécution, pas depuis le début de l'attente | Corrigé |
| SEQ-084 | Moyen | « Si pas de réponse » et l'attente de réponse regardent une fenêtre glissante de 72 h, pas la date du dernier envoi | Corrigé |
| SEQ-085 | Moyen | check_wait_events phase 1 réarme toutes les attentes d'un candidat connecté, y compris les attentes de réponse | Corrigé |
| SEQ-086 | Moyen | check_wait_events phase 2 revérifie toujours les 20 mêmes exécutions | Corrigé |
| SEQ-087 | Moyen | Le polling de secours des réponses ne vérifie que 20 inscriptions arbitraires toutes les 4 heures | Corrigé |
| SEQ-088 | Moyen | Un 429 passager sur un smart_message ou un InMail reporte l'étape au 1er du mois suivant | Corrigé |
| SEQ-089 | Moyen | Conditions d'arrêt : désactiver « répond » est sans effet, désactiver « se désinscrit » laisse partir les étapes LinkedIn après un opt-out | Corrigé |
| SEQ-090 | Moyen | Relance d'une étape IA : le message généré est perdu, le modèle brut part ou l'IA est refacturée | Corrigé |
| SEQ-091 | Moyen | Garde-fous IA non revérifiés après correction : un message fautif (salaire, appel, mode RPO) peut partir | Corrigé |
| SEQ-092 | Moyen | Crédits IA des séquences : aucun refus préalable, jetons non réglés sur les chemins d'échec | Corrigé |
| SEQ-093 | Moyen | InMail sans objet : smart_message n'a pas de champ objet et un InMail sans objet n'est pas bloqué | Corrigé |
| SEQ-094 | Moyen | Invitation avec « Personnalisation IA » : le moteur ne génère jamais la note | Corrigé |
| SEQ-095 | Moyen | Type de message affiché par l'éditeur différent de celui rédigé par le moteur (smart_message rédigé en InMail, invitation « sans note », relances vues comme premiers messages) | Corrigé |
| SEQ-096 | Moyen | Note d'invitation coupée sur n'importe quel point (« Node. », URL cassée), historique non tronqué | Corrigé |
| SEQ-097 | Moyen | Identité de l'expéditeur fausse dans les prompts IA : « recruteur chez Konekt » codé en dur | Corrigé |
| SEQ-098 | Moyen | Ton choisi ignoré à l'envoi, tutoiement imposé, logique de relance divergente de l'aperçu | Corrigé |
| SEQ-099 | Moyen | Prénom non validé dans les modèles (« Bonjour 🚀, », « Bonjour , ») et faux rejets dans le chemin IA | Corrigé |
| SEQ-100 | Moyen | Identité de l'expéditeur incohérente : signature au nom de l'inscripteur, nom d'expéditeur e-mail au nom du créateur de la séquence, repli « Recruteur » interdit | Corrigé |
| SEQ-101 | Moyen | Nom du client remplacé par le titre de la mission quand il n'est que dans sourcing_projects.client_name | Corrigé |
| SEQ-102 | Moyen | Lectures de profil LinkedIn hors ledger (message, IA, invitation, conditions) | Corrigé en partie : lectures principales journalisées, sans plafond dédié |
| SEQ-103 | Moyen | File InMail : toute erreur d'envoi est définitive, y compris 429 et 503 | Corrigé |
| SEQ-104 | Moyen | Désinscription perdue si l'écriture en liste de suppression échoue : le jeton est consommé avant | Corrigé |
| SEQ-105 | Moyen | Les copies CC et BCC reçoivent le HTML instrumenté du candidat : faux ouverts, faux clics, désinscription du candidat par un tiers | Corrigé |
| SEQ-106 | Moyen | Ouvertures et clics automatiques (scanners, préchargement) non filtrés alors qu'ils pilotent arrêts et branches | Corrigé |
| SEQ-107 | Moyen | Condition « Si e-mail bouncé » jamais vraie : aucun écrivain effectif du statut d'exécution 'bounced' | Corrigé |
| SEQ-108 | Moyen | Relance IA rédigée comme un premier contact quand l'e-mail précédent a été ouvert | Corrigé |
| SEQ-109 | Moyen | Un envoi réussi après une nouvelle tentative reste affiché en erreur (« Interrompu pendant l'envoi ») | Corrigé |
| SEQ-110 | Moyen | Réponse à un InMail envoyé sur un identifiant Recruiter non rattachée à l'inscription | Corrigé |
| SEQ-111 | Moyen | Une réponse passe « répondu » les InMails envoyés au même candidat par d'autres comptes et d'autres organisations | Corrigé |
| SEQ-112 | Moyen | Calendly écrit le statut 'booked', refusé par la contrainte en base neuve et inconnu du reste du code : l'inscription reste active et le janitor relance | Corrigé |
| SEQ-113 | Moyen | Réponses automatiques Outlook « Automatic reply » prises pour une réponse du candidat | Corrigé |
| SEQ-114 | Moyen | process-scheduled-actions dépasse la limite de 60 s : actions bloquées sans statut final | Corrigé |
| SEQ-115 | Moyen | Réponse par e-mail, rebond et rendez-vous arrêtent la séquence sans aucune notification | Corrigé |
| SEQ-116 | Moyen | Purge RGPD automatique : les données de séquence ne sont jamais purgées | Corrigé |
| SEQ-117 | Moyen | Index du moteur absents en prod et janitors sans index même en base neuve | Corrigé |
| SEQ-118 | Moyen | Suivi d'un message direct dans inmail_queue : insert sans organization_id refusé en prod, erreur ignorée | Corrigé |
| SEQ-119 | Moyen | Rôle collaborator : lecture et écriture de toutes les séquences, inscriptions et messages de l'organisation | Corrigé |
| SEQ-120 | Moyen | Le script de réparation des faux « Répondu » réactiverait de vraies réponses et modifierait le pipeline d'autres organisations | Corrigé |
| SEQ-121 | Moyen | Pauses automatiques sans pause_reason : « En pause » sans cause, « Reprendre » inopérant, aucun moyen de débloquer | Corrigé |
| SEQ-122 | Moyen | Supprimer une séquence efface la protection « déjà contacté depuis moins de 90 jours », sans le dire | Corrigé |
| SEQ-123 | Moyen | Retirer un candidat de la mission laisse sa séquence tourner, sans le dire | Corrigé |
| SEQ-124 | Moyen | L'inscription passe le candidat à « contacté » avant tout envoi, écrase « shortlisté » ou « a répondu », et ignore l'erreur | Corrigé |
| SEQ-125 | Moyen | InMail groupé sans anti-doublon : ni contacts récents de l'organisation, ni InMails déjà en file | Corrigé |
| SEQ-126 | Moyen | « Annuler les envois en attente » annule toute la file de l'utilisateur, ou seulement les 100 dernières lignes, sans confirmation | Corrigé |
| SEQ-127 | Moyen | Anti-doublon ouvert en cas d'erreur : si la vérification échoue, les candidats déjà contactés peuvent être inscrits | Corrigé |
| SEQ-128 | Moyen | Anti-doublon : une inscription active ou en pause créée il y a plus de 90 jours n'est pas signalée | Corrigé |
| SEQ-129 | Moyen | Modale simple : si la première étape ne peut pas être planifiée, les inscriptions restent actives, un toast de succès s'affiche et renvoie vers un bouton inexistant | Corrigé |
| SEQ-130 | Moyen | Bilan d'inscription : coche verte « Inscription terminée » même quand aucun candidat n'a été inscrit | Corrigé |
| SEQ-131 | Moyen | Échec de génération IA dans l'aperçu : la carte affirme que le modèle partira tel quel, sans bouton pour réessayer ou corriger | Corrigé |
| SEQ-132 | Moyen | Le bouton Séquence du bandeau « candidats Go » s'affiche sans compte LinkedIn : inscription refusée avec un message technique | Corrigé |
| SEQ-133 | Moyen | InMail groupé : chaque destinataire, même déjà en relation, est compté comme un crédit InMail | Corrigé |
| SEQ-134 | Moyen | Le plan gratuit n'est vérifié que dans le menu Séquence du sourcing : messagerie et InMail groupé laissent inscrire et planifier | Corrigé |
| SEQ-135 | Moyen | Le moment du premier envoi n'est jamais annoncé avant l'inscription | Corrigé |
| SEQ-136 | Moyen | Les séquences à embranchements sont aplaties dans l'aperçu et dans le contexte donné à l'IA | Corrigé |
| SEQ-137 | Moyen | Depuis une carte ou la fiche, l'aperçu IA est rédigé sans compétences ni description de la mission | Corrigé |
| SEQ-138 | Moyen | La génération groupée et l'estimation de crédits incluent les candidats retirés ou exclus | Corrigé |
| SEQ-139 | Moyen | Aperçu d'inscription : trois nombres de candidats différents et candidats exclus affichés comme inclus | Corrigé |
| SEQ-140 | Moyen | Raccourcis clavier globaux de l'aperçu : Entrée et Espace détournés, Entrée lance une génération payante, Échap ne ferme pas | Corrigé en partie : raccourcis limités à la liste, génération sur Ctrl/Cmd+Entrée |
| SEQ-141 | Moyen | Depuis la messagerie, l'inscription se fait sans mission | Corrigé |
| SEQ-142 | Moyen | Depuis la messagerie, la distance du candidat est toujours inconnue : aucune alerte avant une invitation à quelqu'un de déjà en relation | Corrigé |
| SEQ-143 | Moyen | Toast « Profils inscrits à la séquence » en double après une inscription, et faux après « Shortlister sans message » | Corrigé |
| SEQ-144 | Moyen | UX12 : le menu Séquence ne montre que les 20 plus récentes, sans recherche, jamais rafraîchi, état vide sans issue, et laisse inscrire dans une séquence désactivée | Corrigé |
| SEQ-145 | Moyen | Depuis la messagerie, l'aperçu des messages promis avant l'inscription n'est jamais montré | Corrigé |
| SEQ-146 | Moyen | UX18 : la vérification dit « Prêt » quand l'enregistrement refuse, et l'inverse | Corrigé |
| SEQ-147 | Moyen | Valeurs par défaut affichées mais non enregistrées (seuil de score 70, délai d'attente 3 jours) et délais en heures invisibles dans la liste | Corrigé |
| SEQ-148 | Moyen | Une invitation sans note est refusée, y compris dans la séquence recommandée | Corrigé |
| SEQ-149 | Moyen | Création en deux temps : en cas d'échec des étapes, une séquence vide et active reste, et le nouvel essai en crée une seconde | Corrigé |
| SEQ-150 | Moyen | Modifier une séquence qui a des candidats en cours : aucune information sur l'effet des changements | Corrigé |
| SEQ-151 | Moyen | L'éditeur part de la liste chargée à l'ouverture de la page et peut effacer les étapes ajoutées entre-temps par un collègue | Corrigé |
| SEQ-152 | Moyen | « Partir de zéro » rouvre l'ancien brouillon, sans moyen de l'écarter | Corrigé |
| SEQ-153 | Moyen | Le brouillon n'est écrit qu'à la fermeture de l'éditeur : un rechargement ou une fermeture d'onglet perd tout | Corrigé |
| SEQ-154 | Moyen | « Enregistrer » et « Activer » font la même chose : toute nouvelle séquence est active, même sur le plan gratuit | Corrigé |
| SEQ-155 | Moyen | La « limite quotidienne » par expéditeur n'est pas un plafond d'envoi : attribution seulement, repli figé sur le premier compte quand tous sont pleins | Corrigé |
| SEQ-156 | Moyen | Rotation : le pool accepte des comptes e-mail et affiche une adresse, alors que la rotation sert aux étapes LinkedIn | Corrigé |
| SEQ-157 | Moyen | La structure réelle d'une séquence n'est lisible nulle part : branches à plat en Liste et en vérification | Corrigé |
| SEQ-158 | Moyen | Mode Liste : impossible d'ouvrir une étape au clavier | Corrigé |
| SEQ-159 | Moyen | Canevas Visuel : clavier sans effet, suppression invisible au toucher, boutons sans nom, panneau étroit sur mobile | Corrigé |
| SEQ-160 | Moyen | « Étape alternative » de délai vers une étape antérieure : renvoi d'un message déjà envoyé | Corrigé |
| SEQ-161 | Moyen | Statuts d'exécution mal libellés : un e-mail ouvert ou cliqué s'affiche « À venir », « Planifié » ou « Annulé », disparaît du tableau de bord et des « Envoyés » | Corrigé |
| SEQ-162 | Moyen | Raisons et erreurs techniques du moteur affichées en anglais brut (« Enrollment inactive », « Timeout 3d », « Retry 1/3 », JSON) | Corrigé |
| SEQ-163 | Moyen | Un candidat en rebond ou arrêté automatiquement s'affiche « Active » ou « En séquence » | Corrigé |
| SEQ-164 | Moyen | Un échec de chargement affiche « Créer ma première séquence » et des compteurs à zéro, et peut ouvrir l'éditeur vide | Corrigé |
| SEQ-165 | Moyen | Compteurs faux au-delà de 1 000 lignes ou calculés sur un échantillon tronqué | Corrigé |
| SEQ-166 | Moyen | Chiffres périmés après une action : la liste ne se rafraîchit pas | Corrigé |
| SEQ-167 | Moyen | Dans une mission, Journal, Statistiques et Diagnostic montrent ou touchent toute l'organisation | Corrigé |
| SEQ-168 | Moyen | Les statistiques de la mission ignorent les inscriptions faites avec un modèle global et ne se rafraîchissent pas | Corrigé |
| SEQ-169 | Moyen | Trois définitions du taux de réponse, et une alerte « taux bas » dès l'inscription | Corrigé |
| SEQ-170 | Moyen | Le Diagnostic parle technique aux clients et annonce une panne à tort (seuil de 5 minutes pour un cron de 5 minutes) | Corrigé |
| SEQ-171 | Moyen | Diagnostic : la jauge d'invitations compare une somme d'organisation à une limite fixe de 100 | Corrigé |
| SEQ-172 | Moyen | Les toasts promettent un départ « dans la minute » alors que l'envoi s'étale sur des heures | Corrigé |
| SEQ-173 | Moyen | Diagnostic : « Envoyées 24h », « Échecs 24h » et « Dernier message envoyé » calculés sur la date de création des exécutions | Corrigé |
| SEQ-174 | Moyen | Le Journal montre le modèle brut, pas le message qui partira | Corrigé |
| SEQ-175 | Moyen | Aides et exemples citant une syntaxe de variable non prise en charge ({{firstName}}, syntaxe de la modale d'édition) | Corrigé |
| SEQ-176 | Moyen | La fiche candidat affiche « Envoyé il y a… » sur des étapes échouées ou ignorées | Corrigé |
| SEQ-177 | Moyen | Bandeau « candidats Go » : jamais affiché avec les modèles globaux, et son bouton « Créer une séquence » ne fait rien | Corrigé |
| SEQ-178 | Moyen | L'onglet Contact n'explique pas comment inscrire des candidats | Corrigé |
| SEQ-179 | Moyen | Aucune alerte dans la liste quand les envois sont bloqués (compte déconnecté, abonnement, arrêt automatique) | Corrigé |
| SEQ-180 | Moyen | Les statistiques mélangent les périodes et affichent deux nombres de réponses différents | Corrigé |
| SEQ-181 | Moyen | Agenda et tableau de bord affichent comme prévus des envois d'inscriptions en pause qui ne partiront pas | Corrigé |
| SEQ-182 | Moyen | Fiche poste ATS : taux de réponse des séquences toujours à 0 % | Corrigé |
| SEQ-183 | Moyen | Messagerie : l'activité de séquence d'autres candidats s'affiche par correspondance partielle du nom | Corrigé |
| SEQ-184 | Moyen | Historiques du candidat : libellés techniques et échecs présentés comme des actions | Corrigé |
| SEQ-185 | Moyen | Messagerie : le bouton « Arrêter » dépend d'une liste tronquée et du statut de la mission | Corrigé |
| SEQ-186 | Moyen | Après une inscription depuis la recherche, statuts et badges restent périmés | Corrigé |
| SEQ-187 | Moyen | Débit plafonné à 3 actions visibles par cycle pour toute la plateforme, file servie par ancienneté | Corrigé |
| SEQ-188 | Mineur | Désinscription : comparaison sensible à la casse, et un e-mail supprimé fait avancer la séquence comme un envoi réussi | Corrigé |
| SEQ-189 | Mineur | Dernier contrôle avant envoi en échec ouvert : une lecture en erreur ou une inscription supprimée laisse partir le message | Corrigé |
| SEQ-190 | Mineur | Course entre check_timeouts et l'acceptation reçue par webhook : mises à jour de statut sans garde | Corrigé |
| SEQ-191 | Mineur | Réponses comptées deux fois quand le webhook et le moteur voient la même réponse | Corrigé |
| SEQ-192 | Mineur | Credentials plateforme absents classés « compte déconnecté », y compris pour les e-mails | Corrigé |
| SEQ-193 | Mineur | Refus de quota pour indisponibilité passagère : report de 24 h | Corrigé |
| SEQ-194 | Mineur | Heartbeat 'ok' écrit même quand le run a été sauté pour verrou tenu | Corrigé |
| SEQ-195 | Mineur | La colonne sequence_step_executions.channel n'est jamais renseignée pour LinkedIn et WhatsApp | Corrigé |
| SEQ-196 | Mineur | Janitor dormant limité aux 200 inscriptions les plus anciennes : une dormante récente peut attendre indéfiniment | Corrigé |
| SEQ-197 | Mineur | Le fuseau horaire réglé dans les Paramètres n'est jamais utilisé pour les heures d'envoi | Corrigé |
| SEQ-198 | Mineur | Cache des plages horaires et fuseaux des membres jamais vidé entre deux requêtes | Corrigé |
| SEQ-199 | Mineur | File InMail : credentials résolus par l'organisation active du créateur, repli DSN non normalisé | Corrigé |
| SEQ-200 | Mineur | sequence-send-email ne revérifie pas le statut de l'inscription juste avant l'envoi | Corrigé |
| SEQ-201 | Mineur | signature_id non contrôlé par organisation : lecture d'une signature d'une autre organisation par la clé service | Corrigé |
| SEQ-202 | Mineur | Désinscription et rebond appliqués à toutes les organisations, raison visible par les autres | Corrigé |
| SEQ-203 | Mineur | Liens HTML contenant &amp; ou des séquences %XX cassés par la réécriture de suivi | Corrigé |
| SEQ-204 | Mineur | Clé de signature des liens = clé service : sa rotation casse tous les liens déjà envoyés | Corrigé |
| SEQ-205 | Mineur | Suivi natif du fournisseur activé mais jamais rattaché : double pixel et double redirection | Corrigé |
| SEQ-206 | Mineur | Aucun fil de discussion entre les étapes : chaque relance e-mail ouvre une nouvelle conversation | Reporté : canal e-mail fermé |
| SEQ-207 | Mineur | Domaines techniques visibles dans les e-mails des recruteurs (liens et pixel sur supabase.co) | Reporté : canal e-mail fermé, chantier d’infrastructure |
| SEQ-208 | Mineur | Déconnexion signalée par statut (CREDENTIALS, ERROR) : aucune notification dans le fil d'activité | Corrigé |
| SEQ-209 | Mineur | Connexion acceptée ignorée par le webhook quand connection_status est NULL | Corrigé |
| SEQ-210 | Mineur | Événements v2 abonnés mais non traités (rebond, ouvertures, clics) | Corrigé |
| SEQ-211 | Mineur | Réponse par e-mail : étape de pipeline « Pré-qualif » au lieu de « Répondu » | Corrigé |
| SEQ-212 | Mineur | Une réponse reçue sur un compte n'arrête pas l'inscription du même candidat sur un autre compte de l'organisation | Corrigé |
| SEQ-213 | Mineur | Comparaisons de secrets non constantes dans calendly-webhook et process-scheduled-actions | Corrigé |
| SEQ-214 | Mineur | Aucune borne en base sur les transitions d'exécution écrites par le client | Corrigé |
| SEQ-215 | Mineur | Contraintes CHECK de statut absentes en prod, présentes en base neuve | Corrigé |
| SEQ-216 | Mineur | Policies héritées encore actives en base neuve et absentes en prod : la CI teste une autre RLS que la prod | Corrigé |
| SEQ-217 | Mineur | Le test RLS à deux organisations ne couvre aucune table du module séquences | Corrigé |
| SEQ-218 | Mineur | Les scripts SQL de test écrivent dans la première organisation venue, en prod, et consomment ses crédits IA | Corrigé |
| SEQ-219 | Mineur | types.ts ne connaît ni save_sequence_steps, ni increment_sequence_analytics, ni ends_sequence : appels en « as any » | Corrigé en partie : types ajoutés à la main, régénération complète après déploiement |
| SEQ-220 | Mineur | « Ré-enrôler » efface la date de réponse du candidat | Corrigé en partie : date de réponse gardée dans tracking_data |
| SEQ-221 | Mineur | « Marquer comme répondu » ne met à jour ni le pipeline ni les compteurs de réponses | Corrigé |
| SEQ-222 | Mineur | « Déjà inscrit » couvre aussi les inscriptions arrêtées ou terminées, sans moyen de relancer | Corrigé |
| SEQ-223 | Mineur | La modale d'inscription simple liste aussi les profils qui seront exclus | Corrigé |
| SEQ-224 | Mineur | Un délai modifié « pour cette inscription uniquement » s'applique à tous les candidats de la sélection | Corrigé |
| SEQ-225 | Mineur | Indicateurs IA faux : « ~2 crédits » affiché sur chaque étape, même sans IA, et compteur de générations qui dépasse le total | Corrigé |
| SEQ-226 | Mineur | InMail groupé : rythme d'envoi annoncé faux et « 0 messages générés ! » présenté comme un succès | Corrigé |
| SEQ-227 | Mineur | Messagerie : seules les séquences créées par l'utilisateur sont proposées, et la liste n'est chargée qu'une fois | Corrigé |
| SEQ-228 | Mineur | useMessagesInbox exporte encore une inscription directe sans première étape ni anti-doublon (code mort) | Corrigé |
| SEQ-229 | Mineur | Cartes candidats de la préparation : élément cliquable non focalisable et menu d'actions invisible sans survol | Corrigé |
| SEQ-230 | Mineur | Le test UX05 vérifie une modale que le parcours réel contourne | Corrigé |
| SEQ-231 | Mineur | Brouillon de séquence rangé sous une clé commune au navigateur, conservé après déconnexion | Corrigé |
| SEQ-232 | Mineur | Supprimer une séquence « Template » depuis une mission la supprime pour toutes les missions, sans le dire | Corrigé |
| SEQ-233 | Mineur | Ajouter une troisième variante donne 25 % partout : total 75 %, enregistrement bloqué | Corrigé |
| SEQ-234 | Mineur | Délais sans repère : ni point de départ, ni week-ends, ni fuseau horaire | Corrigé |
| SEQ-235 | Mineur | Erreur de chargement des modèles présentée comme « Aucun template disponible » | Corrigé |
| SEQ-236 | Mineur | Deux toasts de succès à chaque enregistrement | Corrigé |
| SEQ-237 | Mineur | Poignées de glisser sans effet en Liste et nœuds déplaçables en Visuel | Corrigé |
| SEQ-238 | Mineur | Types d'action affichés avec leur identifiant technique | Corrigé |
| SEQ-239 | Mineur | Sur mobile, actions de la liste et vérification de l'éditeur absentes, mode Visuel trop étroit | Corrigé |
| SEQ-240 | Mineur | Boutons icône sans nom accessible et menus visibles au survol seulement | Corrigé |
| SEQ-241 | Mineur | Trois hooks de statistiques sans aucun appelant | Corrigé |
| SEQ-242 | Mineur | Le sélecteur « Compte » de l'onglet Séquences n'a aucun effet sur les séquences | Corrigé |
| SEQ-243 | Mineur | Corriger depuis le Journal un e-mail planifié efface son objet | Corrigé |
| SEQ-244 | Mineur | Progression « X / Y » d'une inscription jamais complète | Corrigé |
| SEQ-245 | Mineur | Textes : anglicismes, jargon, tutoiement et vocabulaire instable dans tout le module | Corrigé en partie : vocabulaire harmonisé dans le module, libellé d’onglet « Outreach » inchangé |
| SEQ-246 | Mineur | Diagnostic : filtres in() passés dans l'URL et erreurs ignorées, d'où un 0 silencieux au-delà de quelques centaines d'inscriptions | Corrigé |

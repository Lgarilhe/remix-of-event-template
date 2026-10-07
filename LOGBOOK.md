# LOGBOOK.md — Journal de bord Konekt AI Platform

Un entry par décision, spec, insight, ou action majeure. Ajouté en fin de chaque conversation pro importante avec Claude Code. Du plus récent en haut.

**Format strict** : date ISO, type, titre, corps. Pas de padding, pas d'emoji dans les titres, pas de "j'ai fait" — seulement le fait.

---

## Template d'entry

```markdown
## AAAA-MM-JJ — <TYPE> — <Titre court>

**Contexte** : 1-2 phrases.
**Décision / Fait** : ce qui a été tranché ou livré.
**Raison** : pourquoi (si non évident).
**Impact** : fichiers touchés, modules, users concernés.
**Reste à faire** : bullets courts. `[ ]` ouvert, `[x]` fait.
**Refs** : commit SHA, ticket, URL Notion, page Airtable.
```

**Types autorisés** :
- `DECISION` — choix d'architecture, de lib, de process
- `SPEC` — nouvelle feature spécifiée (sortie de /spec)
- `SHIP` — déploiement (staging ou prod)
- `INSIGHT` — apprentissage, gotcha, surprise technique
- `BUG` — bug identifié (ouvert ou fermé)
- `REFACTOR` — restructuration significative
- `SECURITY` — finding sécurité (audit, fix, alerte)
- `ROLLBACK` — retour arrière
- `MEETING` — synthèse d'une discussion externe (client, équipe)

---

## 2026-10-07 — REFACTOR — Film explicatif de la mémoire

**Contexte** : la découverte expliquait la création d’une mémoire par quatre fondus d’interface, sans montrer son utilité dans l’échange suivant.
**Fait** : film de 18 secondes avec une consigne persistante : ouverture à 18 px, extraction par raccord du trait au contour, passage au corps natif à 14 px, geste « Modifier → Niveau → Pour moi → Garder », puis mémoire rangée et synthèse en trois points suivis des réserves. Exemple de préférence personnelle confirmée manuellement ; niveaux adaptés au cabinet, à l’entreprise et à l’indépendant. Le préfixe se retire avant la levée de la consigne pour éviter leur croisement ; le titre de confirmation suit le compactage pour conserver la séparation des lignes. Le lecteur, les surfaces et les contrôles reprennent les primitives et jetons Konekt.
**Lecture** : horloge unique pour les mots, cadrages, curseur, appuis et tracés. Pause complète, reprise au temps restant, relecture à zéro, arrêt sans boucle et pause à l’onglet masqué. Mouvement réduit : consigne, confirmation et bénéfice fixes, avec préférence suivie dans les deux sens. Pied fixe sur écran court, explication complète à 320 px, équivalent accessible permanent.
**Validation locale** : build final réussi, trois sources identiques aux sourcemaps ; lint et 117 contrôles UX passent ; TypeScript conserve exactement ses 11 erreurs héritées ; les 15 compteurs design restent identiques à main. Chromium avec API simulées : 36 contrôles de découverte, quatre de continuité de lecture et 15 ciblés sur l’extraction ; sept audits axe sans violation, aucune erreur navigateur ni écriture métier. Captures clair/sombre à 320/390/1440 px et revue d’images successives du film ; les six régressions métier antérieures sont référencées sans rejeu et exclues des décomptes.

| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Pause à plusieurs moments, reprise sans redémarrage, relecture et fin tenue | PASS |
| Claire | Consigne, choix du niveau, confirmation et bénéfice au prochain échange lisibles | PASS |
| Théo | Scène inerte, aucune écriture, mouvement réduit initial/live et retrait du préfixe avant extraction | PASS |
| Sophie | Film et explication complets à 320/390 px, niveaux adaptés et commandes de 44 px à 390×400 | PASS |

**État** : validé localement, non déployé. Revue temporelle par images successives ; aucune mesure de fluidité sur un téléphone physique ni essai avec un lecteur d’écran réel.
**Refs** : `src/components/agent/AgentMemoryMotionScene.tsx`, `src/components/agent/AgentMemoryIntro.tsx`, `src/components/agent/AgentMemoryDialog.tsx`, `docs/design/01-direction.md`.

## 2026-10-07 — BUG — Mémoire : composition alignée sur le design system

**Contexte** : le partage des primitives ne couvrait pas la composition de la découverte. Le canevas imbriquait les cartes métier dans une carte de scène, ajoutait un sélecteur de niveaux absent du produit et masquait une partie de l’explication à 320 px.
**Fait** : fenêtre au format natif `max-w-2xl`, titre unique, légende à 14 px, progression fine, commandes de lecture et pied `DialogFooter`. Exemple pleine largeur à plat : conversation, proposition, détail du véritable champ `Select` Niveau fermé, puis mémoire confirmée. Les quatre états partagent une hauteur intrinsèque ; transitions de 200 ms et 4 px, pression à 98 %, toutes pilotées par l’horloge existante. Surface extérieure, rotation, curseur et rail de grandes pastilles retirés. Actions métier et champ illustratifs restent inertes. Une explication permanente pour les lecteurs d’écran nomme les niveaux selon le contexte, la confirmation et la désactivation.
**Validation locale** : build final réussi, trois sources identiques aux sourcemaps, lint et 117 contrôles UX passent ; TypeScript conserve exactement ses 11 erreurs héritées ; les 15 compteurs design restent identiques à main. Revue de composition comparée aux vrais dialogues Nouvelle séquence et à OnboardingFrame, avec captures clair/sombre à 320/390/1440 px. Chromium avec API simulées : 27 nouveaux contrôles de découverte, sept audits axe sans violation, aucune erreur navigateur ni écriture métier. À 320 px avec entreprise et poste, scène et édition de 272 px ; explication et pied entièrement visibles sans défilement initial. Les six régressions métier de la version précédente sont référencées sans rejeu et exclues de ce décompte.

| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Pause complète, reprise, fin sans boucle, relecture à zéro et retour aux mémoires | PASS |
| Claire | Titre unique, validation et automatique optionnel expliqués, fermeture et focus restauré | PASS |
| Théo | Scène inerte sans écriture, équivalent accessible permanent, mouvement réduit initial et dans les deux sens | PASS |
| Sophie | Texte et actions visibles à 320/390 px, niveaux adaptés, pied fixe et navigation à 390×400 | PASS |

**État** : validé localement, non déployé. Équivalent lecteur d’écran vérifié dans l’interface et ses attributs ; aucun essai avec un lecteur d’écran réel dans cette passe.
**Refs** : `docs/design/01-direction.md`, `src/components/sequences/NewSequenceDialog.tsx`, `src/components/onboarding/OnboardingFrame.tsx`, `src/components/agent/AgentMemoryDialog.tsx`, `src/components/agent/AgentMemoryIntro.tsx`, `src/components/agent/AgentMemoryMotionScene.tsx`.

## 2026-10-07 — REFACTOR — Mémoire : vraies cartes dans la démonstration

**Fait** : propositions et mémoires confirmées partagent désormais leur présentation avec la scène de découverte : cadre, typographie, niveau, type, effets, date et actions natives. Le pointeur choisit le niveau, presse « Garder », puis la consigne rejoint les mémoires actives. Les actions illustrées sont des éléments décoratifs sans contrôle ni écriture. Horloge de neuf secondes, pause, reprise, relecture et mouvement réduit conservés.
**Adaptation mobile** : scène de 336 px, en-tête compact et marge intérieure réduite uniquement pour la découverte. À 320 px avec trois niveaux, la proposition garde deux lignes d’actions et 8 px avant le rail ; tous les niveaux et « Garder » restent visibles pendant le clic illustré. Les actions finales restent fixes et le contenu défile localement sur écran court.
**Validation locale** : build réussi et contenu des cinq sources vérifié dans les sourcemaps ; lint ciblé et 117 contrôles UX passent ; TypeScript conserve exactement ses 11 erreurs héritées ; les 15 compteurs de dette design restent identiques à main. Chromium avec API simulées : 23 contrôles ciblés de démonstration, six régressions des cartes réelles à 320/1440 px et sept audits axe sans violation. Aucun message d’erreur navigateur ni écriture métier depuis la démonstration ; six écritures simulées attendues dans les parcours réels de confirmation, rejet et désactivation. Les 35 contrôles de la version précédente ne sont pas ajoutés à ce décompte.

| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Vraies cartes, clic illustré, pause complète, reprise, fin sans boucle et relecture | PASS |
| Claire | Brouillon conservé, confirmation avec les bons paramètres, rejet et désactivation avec confirmation | PASS |
| Théo | Scène sans action métier, mouvement réduit initial et changement dans les deux sens | PASS |
| Sophie | Clair/sombre à 320/390/1440 px, trois niveaux à 320 px, actions fixes et défilement clavier à 390×400 | PASS |

**État** : validé localement, non déployé.
**Refs** : `src/components/agent/AgentMemoryPresentation.tsx`, `src/components/agent/AgentMemoryProposalCard.tsx`, `src/components/agent/AgentMemoryDialog.tsx`, `src/components/agent/AgentMemoryIntro.tsx`, `src/components/agent/AgentMemoryMotionScene.tsx`.

## 2026-10-07 — DECISION — Mémoire : scène continue et commandes de lecture

**Fait** : démonstration de neuf secondes : surlignage de la consigne, extraction d’une proposition, choix du niveau et rangement dans les mémoires confirmées. Le même ticket se déplace et les traits se dessinent ; parcours diagonal sur mobile, horizontal sur ordinateur. Pause, reprise au temps restant et relecture partagent une seule horloge ; l’onglet masqué met la scène en pause. Exemple fixe avec mouvement réduit, préférence suivie dans les deux sens pendant la découverte. Niveaux adaptés au cabinet, à l’entreprise et à l’indépendant, avec mission ou poste selon le contexte.
**Validation locale** : build final vérifié sur les trois sources livrées ; lint et 117 contrôles UX passent ; TypeScript conserve exactement ses 11 erreurs héritées ; dette design sans augmentation. Chromium avec API simulées : 35 nouveaux contrôles de déplacement, arrêt sans boucle, pause/reprise, relecture, fermeture et focus ; sept audits axe sans violation, aucune erreur navigateur ni écriture métier. Les 40 contrôles de la première version restent exclus de ce décompte. À 320 px avec trois niveaux, le ticket final conserve 6 px avant le rail ; exemple animé et fixe cohérents.

| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Parcours continu, pause complète, reprise au temps restant et relecture depuis le début | PASS |
| Claire | Compris/Passer et relecture depuis l’aide, Échap/croix avec focus restauré | PASS |
| Théo | Mouvement réduit initial, changements de préférence dans les deux sens et aucune écriture métier | PASS |
| Sophie | Clair/sombre de 320 à 1440 px, trois niveaux à 320 px, CTA fixes et défilement clavier à 390×400 | PASS |

**État** : validé localement, non déployé.
**Refs** : `src/components/agent/AgentMemoryIntro.tsx`, `src/components/agent/AgentMemoryMotionScene.tsx`, `src/components/agent/AgentMemoryDialog.tsx`.

## 2026-10-07 — DECISION — Première découverte animée de la mémoire

**Fait** : démonstration de 4,12 secondes à la première ouverture volontaire de la mémoire : conversation, proposition, niveau et confirmation. Explications permanentes, actions « Compris » et « Passer » fixes sur mobile, relecture depuis l’aide. Découverte enregistrée par utilisateur et espace dans le navigateur, avec repli de session si le stockage est bloqué. Mouvement réduit : exemple fixe ; changement de préférence ou onglet masqué arrêtent la démonstration. Aucune activation ni mémorisation métier depuis le tutoriel.
**Validation locale** : build final, lint et gardes contraste/fondations passent ; 117 contrôles UX ; TypeScript identique à ses 11 erreurs héritées ; dette design sans augmentation. Chromium avec API simulées : 40 contrôles fonctionnels, six audits axe stabilisés sans violation, aucune erreur navigateur ni écriture métier.

| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Démonstration finie sans boucle, replay, accès direct après rechargement et relecture depuis l’aide | PASS |
| Claire | Texte permanent, activation automatique distincte, fermeture sans flash et focus restauré | PASS |
| Théo | Isolation utilisateur/espace, changement pendant la démonstration, stockage bloqué et aucune écriture métier | PASS |
| Sophie | Deux actions visibles à 320/390 px et 390×400, défilement local, mouvement réduit initial et en cours | PASS |

**État** : validé localement, non déployé.
**Refs** : `src/components/agent/AgentMemoryIntro.tsx`, `src/hooks/useAgentMemoryIntroduction.ts`, `src/components/agent/AgentMemoryDialog.tsx`.

## 2026-10-07 — BUG — Mémoire : cohérence visuelle et actions accessibles sur mobile

**Fait** : surfaces et boutons alignés sur les primitives du site ; réglages allégés, actions « Garder » et « Proposer » mises en avant. Guide repliable des niveaux adapté aux comptes cabinet, entreprise et indépendant. Confirmation de désactivation défilante pour les mémoires longues ; saisie focalisée et visible à la création ou à l’édition.
**Validation locale** : build et lint ciblé réussis ; 117 contrôles UX passent ; TypeScript conserve ses 11 erreurs héritées ; dette design sans augmentation. Chromium avec API simulées : 38 contrôles de parcours, six groupes de régression automatique, état vide sans défilement initial à 320/390 px ; audits axe clair/sombre sans violation et aucune erreur de page.

| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Actions principales lisibles, création et confirmation ; activation automatique explicite | PASS |
| Claire | Réglages moins denses, niveaux et périmètre expliqués, annulation sans écriture | PASS |
| Théo | Erreur sans utilisation, contexte adapté au compte, conflits et callbacks tardifs préservés | PASS |
| Sophie | Cibles de 44 px, champ visible, archive longue accessible à 390×400, CTA initial à 320 px | PASS |

**État** : validé localement, non déployé. Guide fonctionnel retenu pour expliquer la cascade ; aucun ajout d’illustration décorative dans les cartes.
**Refs** : `src/components/agent/AgentMemoryDialog.tsx`, `src/components/agent/AgentMemoryScopeGuide.tsx`, `docs/design/01-direction.md`.

## 2026-10-07 — DECISION — Mémoire automatique personnelle après calibration

**Fait** : invitation après cinq propositions extraites confirmées sans modification ; activation explicite possible dans les réglages, « Plus tard » persistant et retour manuel. Seules les préférences explicites de langue, longueur et format des réponses peuvent devenir automatiques, personnellement dans chaque espace. Les règles de recrutement, de mission et d’organisation restent à confirmer.
**Validation locale** : build réussi ; TypeScript 11 erreurs héritées, aucune nouvelle ; lint et comparaison design avec main sans augmentation. Tests UX 117, C1 28 et agent 12 fichiers passent. Base reconstruite avec 294 migrations : automatique 50, manuel 38, RLS 32, replay et quatre courses de consentement/ordre passent. Chromium avec API simulées : aucune erreur navigateur, axe sans violation dans le dialogue mobile.

| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Seuil sans activation implicite, opt-in, Plus tard et retour manuel | PASS |
| Claire | Périmètre expliqué, annulation sans écriture, erreurs et rechargement | PASS |
| Théo | Consentement versionné, callbacks tardifs, isolation utilisateur et organisation | PASS |
| Sophie | Actions tactiles de 44 px, dialogue court défilant et saisie visible à 390×400 | PASS |

**État** : validé localement, non déployé ; aucun appel aux comptes réels ou au modèle de production.
**Refs** : `supabase/migrations/20261007130313_agent_memory_automation.sql`, `supabase/tests/agent_memory_automation_audit.sql`, `tests/agent/automatic-memory-extraction.test.mjs`.
## 2026-10-07 — REFACTOR — Séparer les contenus de l’aperçu d’actions

**Contexte** : l’aperçu de réponse et de coordination apparaissait comme un long panneau gris, avec des séparations trop faibles.
**Fait** : chaque message ou contenu à enregistrer dispose d’une carte opaque bordée, avec bandeau de métadonnées distinct du texte. Destinataire, canal, adresse et objet sont alignés et restent lisibles sur petit écran. Sources et suite en attente ont leurs cartes ; l’en-tête et la validation sont séparés par des bordures visibles. La fenêtre passe à 672 px maximum et garde des marges mobiles ; les boutons Modifier et de validation font 44 px. Les cartes texturées de proposition restent inchangées.
**Validation** : sept parcours fonctionnels et sept contrôles visuels Chromium sur les composants réels avec services simulés, clair/sombre de 320 à 1920 px et hauteur minimale de 500 px : lecture sans saisie initiale, édition, champs vides, annulation conservant les brouillons, validation unique, coordination distincte, focus et résultat partagé entre chat et fiche. Aucun débordement horizontal ; seule la zone centrale défile et la validation reste visible. Contraste minimal des textes contrôlés sur les surfaces opaques : 6,69:1 en sombre et 5,95:1 en clair. Build réussi, lint ciblé propre, cinq fichiers UX réussis et dette design sans hausse ; les 11 diagnostics TypeScript hérités sont identiques au contrôle précédent. Aucune écriture serveur ni invocation distante dans les essais.

| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Lire les effets séparément, modifier puis retrouver les résultats dans chat et fiche | PASS |
| Claire | Identifier destinataire, service et contenu ; valider depuis la barre fixe | PASS |
| Théo | Contenu vide, annulation, double clic et séparation des coordonnées candidat/équipe | PASS |
| Sophie | Lecture, édition et validation sur 390 px et 320 × 500 px, sans débordement ni ouverture initiale du clavier | PASS |

**Limites** : contrôles locaux sur une fixture avec services simulés ; pas de connexion fournisseur ni d’envoi réel. À 320 × 500 px, le corps de lecture reste défilable avec environ 166 px disponibles, l’en-tête et la validation restant visibles.
**Impact** : `DemoCandidateActions.tsx`, documentation des actions et journal.
**Refs** : PR #312.

## 2026-10-07 — REFACTOR — Faire ressortir les propositions de la messagerie

**Fait** : les cartes d’actions à préparer reprennent `texturedCard('teal')`, le dégradé et le grain fixes de l’accueil, avec texte clair et bouton principal blanc. Chat et onglet Actions de la fiche partagent le même rendu. Une action réalisée revient à une carte neutre et au bouton de consultation ; les dialogues et les échanges conservent leur fond habituel. Le groupe de boutons se replie sur petit écran et le filet au-dessus de la carte est retiré.
**Décision** : nouvel usage demandé explicitement par le propriétaire le 07/10/2026, consigné dans la direction design et le commentaire de la primitive ; la liste des usages autorisés du test de l’accueil inclut uniquement ce quatrième composant. Aucun nouveau gradient ni jeton global.
**Validation** : sept parcours Chromium réussis, clair/sombre de 320 à 1920 px et hauteur de 500 px : texture dans chat/fiche, boutons de 44 px sur mobile, aucun débordement horizontal, sources et focus, dialogue conservant les couleurs de son thème, validation puis carte neutre. Contraste conservateur mesuré sur les fonds capturés sans texte : 4,94:1 minimum pour les textes ; borne minimale du bouton principal survolé 13,01:1. Build réussi, lint ciblé propre, cinq fichiers UX réussis et dette design sans hausse ; les 11 diagnostics TypeScript hérités sont identiques au contrôle précédent. Aucune écriture serveur ni invocation distante dans les essais.

| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Repérer la proposition, préparer puis appliquer et retrouver un résultat visuellement distinct | PASS |
| Claire | Contraste de la texture et des textes, bouton principal blanc, résultat neutre et aperçu dans son thème | PASS |
| Théo | Sources accessibles, focus restauré, état par candidat et aucun changement serveur dans la démo | PASS |
| Sophie | Carte, boutons et fiche à 320/390 px, thèmes clair/sombre, hauteur de 500 px et sans débordement | PASS |

**Refs** : PR #312 ; `docs/design/01-direction.md` § 7. Composants réels avec services simulés, sans compte recruteur réel ni appareil iOS physique. Le contraste est calculé contre le pixel de fond le plus lumineux à l’intérieur de la carte, hors bordure.

## 2026-10-07 — SPEC — Réponse candidat et demande d’équipe liées

**Fait** : la proposition d’Alex prépare trois effets relus ensemble : une réponse Outlook au candidat, une demande Outlook à Guillaume, puis un commentaire dans la fiche. Guillaume ayant déjà sollicité le manager, la demande lui propose de partager les précisions attendues. Une suite distincte reste en attente : compléter la réponse à Alex après réception du retour.
**Décision** : chaque effet message porte un périmètre explicite candidat/équipe. Les messages aux collègues se lisent dans « Coordination avec l’équipe », partagé entre chat et fiche Interactions. Ils restent hors des événements du candidat utilisés pour ses coordonnées et ses bulles. La suite est une proposition conditionnelle, sans retour reçu supposé ni exécution automatique dans cette démo.
**Validation** : sept parcours Chromium réussis de 320 à 1920 px, clair/sombre et hauteur de 500 px : destinataires distincts, modification des deux emails, champ d’équipe vide bloquant la validation, annulation conservant les brouillons, double clic produisant un message unique par destinataire, adresse d’Alex conservée, coordination identique dans la fiche et suite en attente. Six régressions profil/interactions et quatre fichiers UX réussis. Build réussi, lint ciblé propre, dette design inchangée ; les 11 diagnostics TypeScript hérités restent identiques. Aucune écriture serveur ni invocation distante dans les simulations.

| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Répondre au candidat et demander au collègue le retour manager en une validation des trois effets | PASS |
| Claire | Identifier destinataires Candidat/Équipe, service Outlook et suite dépendant d’un retour avant d’appliquer | PASS |
| Théo | Double clic, annulation, contenus relus, email interne hors coordonnées du candidat et aucun effet différé exécuté | PASS |
| Sophie | Préparer, modifier les emails, annuler et valider sur 320/390 px, contenu défilant et cibles de 44 px | PASS |

**Refs** : PR #312 ; `docs/candidate-contextual-actions.md`. Composants réels avec services simulés ; aucun compte recruteur réel ni appareil iOS physique. Réception du retour, nouveau plan et envois réels restent à brancher.

## 2026-10-07 — REFACTOR — Lire les actions préparées avant de les modifier

**Fait** : l’aperçu affiche les contenus complets en lecture, avec destinataires, destinations et nombre d’effets. « Modifier » ouvre seulement le champ choisi ; le focus initial reste sur le titre. « Annuler » ferme sans retirer la suggestion ni perdre les brouillons. « Ignorer la suggestion » reste dans le détail des sources. Un contenu vide affiche une explication et bloque la validation. Les résultats appliqués se relisent sans champ de saisie.
**Raison** : les grands champs ouverts d’emblée coupaient les textes et focalisaient la saisie avant la lecture ; le bouton de rejet servait de recul ambigu. Le parcours sans retouche conserve deux clics, préparer puis valider.
**Validation** : sept parcours Chromium réussis, de 320 à 1920 px, clair/sombre et hauteur de 500 px : lecture sans saisie, édition à la demande, annulation conservant le brouillon, partage chat/fiche, validation unique, résultat non éditable, rejet réversible, focus et cibles mobiles de 44 px. Six régressions profil/interactions et quatre fichiers UX réussis. Build réussi, lint ciblé propre, compteurs design inchangés ; les 11 diagnostics TypeScript hérités sont identiques au contrôle précédent. Aucune écriture serveur ni invocation distante dans la démo.

| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Lire puis appliquer deux effets, retrouver les documents dans la fiche et les messages dans les interactions | PASS |
| Claire | Comprendre les effets et leurs destinations, lire les textes complets avant une édition facultative | PASS |
| Théo | Champ vide, annulation sans effet, brouillon partagé, double clic unique et isolation des candidats | PASS |
| Sophie | Lecture sans saisie initiale, modification et annulation à 320/390 px, focus restauré et validation visible | PASS |

**Refs** : PR #312 ; `docs/candidate-contextual-actions.md`. Composants réels avec services simulés ; aucun compte recruteur réel ni appareil iOS physique. Le moteur et les envois restent fictifs.

## 2026-10-07 — SPEC — Préparer et appliquer des actions concrètes depuis le chat

**Fait** : la démo propose des contenus préparés et des modifications concrètes : brief et questions d’entretien ; commentaire d’équipe avec mention et réponse Outlook ; questions de scorecard et email Gmail ciblé. Le parcours « Préparer », aperçu modifiable, puis « Enregistrer la préparation » ou « Envoyer et enregistrer » applique les deux effets en mémoire. Les documents et commentaires sont visibles dans l’onglet Actions de la fiche fictive, les emails simulés dans le même fil d’interactions. Le résultat s’ouvre en lecture seule. Les brouillons relus et résultats sont partagés entre chat et fiche ; fermer l’aperçu ne les applique pas, une validation double ne les duplique pas, quitter la démo les efface.
**Décision** : les propositions portent du travail exécutable, une tâche restant utile pour du travail réellement différé. La spécification décrit des effets typés, leur aperçu, leurs destinations, les droits et conflits, des résultats durables par effet et la reprise partielle. Les écritures internes et envois externes ne sont pas présentés comme une transaction atomique. Aucun moteur IA ni service d’envoi réel ajouté à cette démo.
**Validation** : sept parcours Chromium avec composants réels et services simulés, de 320 à 1920 px, clair/sombre et hauteur de 500 px. Aperçu avant effet, champ vide bloquant la validation, contenu retouché conservé entre les vues puis appliqué, résultat readonly, double clic sans doublon de document ou message, rejet réversible, isolation par candidat, focus clavier, logos et réponses fictives. Six régressions profil/interactions réussies avec pagination, compte personnel, cache isolé et erreurs partielles. Build réussi, lint ciblé propre, quatre fichiers UX réussis, dette design inchangée ; 11 diagnostics TypeScript hérités identiques au contrôle précédent. Aucun appel de génération, envoi ni écriture serveur dans les simulations.

| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Préparer puis appliquer deux effets, retrouver les contenus enregistrés dans la fiche et le message dans le chat | PASS |
| Claire | Aperçu éditable montrant destinations, destinataire, objet et service avant un bouton de validation explicite | PASS |
| Théo | Texte vide, fermeture sans effet, brouillon partagé, double validation unique, changement de candidat et remise à zéro | PASS |
| Sophie | Préparation, édition, validation et réponse à 320/390 px, hauteur de 500 px ; boutons de 44 px et focus restauré | PASS |

**Refs** : PR #312 ; `docs/candidate-contextual-actions.md`. Vérification sur Chromium avec services simulés, sans compte recruteur réel ni appareil iOS physique. Le critère de scorecard reste non évalué ; la mention d’équipe et les envois sont fictifs.

## 2026-10-07 — REFACTOR — Clarifier la prochaine action dans la démo de messagerie

**Fait** : une seule prochaine action suit les échanges récents, avec titre, motif court et bouton « Ajouter à mes tâches ». « Pourquoi ? » ouvre le responsable, l’échéance et des sources résumées avec logos ; les extraits complets se déplient à la demande. Le panneau latéral conserve le suivi et le profil. La fiche fictive et le chat partagent toujours l’état des tâches. Retour du focus à la fermeture du détail et après un rejet ; une modification de tâche ne déplace pas la lecture en cours.
**Raison** : le panneau précédent mélangeait le contexte et les propositions, avec trop de détails visibles et un bouton de création ambigu. La proposition est maintenant près de la réponse, dans le contenu qui défile, pour préserver l’espace de lecture sur mobile. Bandeau et boutons raccourcis sur petit écran ; les trois canaux restent sur une ligne à 320 px.
**Validation** : neuf parcours Chromium sur les composants réels avec services simulés, de 320 à 1920 px, clair/sombre et hauteur de 500 px : sources à la demande, boutons visibles dès l’ouverture, logos chargés, focus clavier, détail depuis la fiche, double clic sans doublon, tâches séparées par candidat, rejet réversible et sortie effaçant les essais. Aucun envoi ni écriture serveur. Six régressions profil/interactions avec pagination, compte personnel, erreurs partielles et cache isolé réussies. Build réussi, quatre fichiers de régression UX réussis, lint ciblé propre, dette design inchangée ; les 11 diagnostics TypeScript hérités sont identiques au contrôle précédent.

| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Ajouter une tâche, ouvrir son détail depuis la fiche, la terminer et retrouver le même état dans le chat sans déplacement de lecture | PASS |
| Claire | Prochaine action et motif courts visibles dès l’ouverture ; contexte détaillé et extraits sur demande | PASS |
| Théo | Double clic, changement de candidat, rejet réversible et remise à zéro ; aucune écriture ni génération distante | PASS |
| Sophie | Répondre, ouvrir et fermer le détail à 320/390 px, hauteur de 500 px ; boutons de 44 px et aucun débordement | PASS |

**Refs** : PR #312 ; `docs/candidate-contextual-actions.md`. Vérification sur Chromium avec données simulées, sans session recruteur réelle ni appareil iOS physique.

## 2026-10-07 — SPEC — Actions proposées selon les interactions et le contexte candidat

**Fait** : démo enrichie de trois propositions sourcées : préparation d’entretien avec contexte LinkedIn, coordination avec un autre recruteur et clarification d’un critère non évalué dans une scorecard. Sources datées, auteur et logos des services, responsable et échéance suggérés. Création, achèvement et rejet simulés en mémoire, état partagé entre le contexte du chat et l’onglet Actions de la fiche fictive, effacement à la sortie. Les exemples sont écrits pour l’aperçu ; aucun moteur IA réel ni tâche serveur ajouté.
**Spécification** : `docs/candidate-contextual-actions.md` reprend les procédures Notion actuelles de calage, débrief et relances. Prévoit un contexte partagé, les avis distincts de chaque évaluateur, le travail de l’équipe, les sources indisponibles, les règles de cadence, la provenance, l’attribution et une déduplication serveur. L’API V2 permet les publications LinkedIn ; l’app utilise encore la lecture V1. Prérequis du moteur réel : rattachements entretien/scorecard/rapport à alimenter, responsable de tâche distinct du créateur, mission interne, états durables et politique de partage des interactions.
**Validation** : build réussi, TypeScript à 11 diagnostics hérités sans ajout, lint ciblé propre, dette design inchangée, trois fichiers de régression profil/historique/contraste réussis. Douze scénarios Chromium avec composants réels et services simulés : six variantes des actions de 320 à 1920 px, clair/sombre, puis six régressions profil et interactions. Aucune écriture ni génération distante pendant les simulations.

| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Création simulée unique, tâche terminée depuis la fiche et état conservé dans le chat au changement de candidat | PASS |
| Claire | Motif, sources avec logos, distinction entre scorecard et décision humaine, contexte d’un collègue visible | PASS |
| Théo | Double clic sans duplication, tâches séparées par candidat, rejet réversible, sortie effaçant les essais, zéro écriture réelle | PASS |
| Sophie | Contexte et fiche sans débordement à 320/390 px, actions tactiles de 44 px, clair et sombre | PASS |

**Refs** : PR #312 ; consignes Notion `4ccaf5bf38da4fe1ae0a438a03feb05a` et compétences référencées dans la spécification. Aucun envoi réel, aucune migration ni fonction serveur modifiée.

## 2026-10-07 — DECISION — Réutiliser le profil candidat existant dans la messagerie

**Fait** : le profil de la messagerie et la fiche fictive réutilisent `ProfileDetailedTab`, déjà utilisé dans le pipeline, avec logos des sociétés/écoles, périodes, compétences et listes dépliables. Les logos sont conservés lors de la normalisation des données ; les dates utilisent le parseur existant. Suppression de la présentation et des formateurs de dates ajoutés pour cette vue. Cibles tactiles des boutons de dépliage portées à 44 px sur mobile ; logos fictifs locaux dans l'exemple principal.
**Validation** : build réussi ; 11 erreurs TypeScript héritées, aucun diagnostic sur les fichiers nouveaux ; régressions profil/historique/contraste réussies ; lint ciblé propre et dette design sans augmentation. Six scénarios Chromium sur composants réels avec services simulés, clair/sombre et mobile : logos chargés, dates, listes dépliables, fiche et chat identiques, cache par organisation et absence d'écriture en démo.

| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Profil existant, anciens postes/formations dépliables et même historique sur les deux vues | PASS |
| Claire | Logos des entreprises/écoles chargés et périodes lisibles | PASS |
| Théo | Normalisation conservant les logos, actualisation isolée et démo sans écriture | PASS |
| Sophie | Profil sans débordement à 390 px, onglets au clavier et composeur visible à 500 px | PASS |

**Refs** : PR #312, aperçu de `codex/inbox-candidate-history`.

## 2026-10-07 — SPEC — Profil candidat dans la messagerie et interactions partagées

**Fait** : onglets Suivi et Profil dans le contexte candidat, expériences et formations intégrales, compétences, langues et autres rubriques présentes dans le profil. Lecture des instantanés de l'organisation, puis du compte LinkedIn personnel si nécessaire ; actualisation explicite conservant le cache de l'organisation de départ. Les fiches sourcing, pipeline et mission reprennent les cartes et la chronologie des interactions : séquences, emails/WhatsApp envoyés, entretiens, appels et messages LinkedIn paginés. Les réponses LinkedIn utilisent uniquement le compte personnel. La démo contient trois parcours fictifs complets et une fiche Profil/Interactions reprenant exactement les événements du chat, réponses simulées comprises.
**Validation** : build réussi ; TypeScript à 11 erreurs héritées, aucune nouvelle ; nouveaux composants et hooks sans diagnostic ESLint ; dette design sans augmentation ; 119 fichiers UX et 28 C1 réussis, puis régressions ciblées relancées après les derniers ajustements. Chromium en StrictMode, clair/sombre, 390/1280/1920 px et hauteur mobile 500 px : six scénarios réussis, aucune erreur navigateur et aucune écriture en démo.

| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Profil complet dans le chat, fiche avec historique identique, anciens messages paginés et réponse unique depuis la fiche | PASS |
| Claire | Suivi/Profil explicites, formations et compétences, mêmes cartes et logos dans les deux parcours | PASS |
| Théo | Changement de candidat/organisation/compte, actualisation tardive isolée, panne partielle conservant les événements et absence d'envoi doublé | PASS |
| Sophie | Onglets accessibles au clavier et cibles de 44 px, fiche et contexte sans débordement mobile, composeur visible à 500 px | PASS |

**Limites** : composants réels avec services simulés pour les essais navigateur ; aucun envoi réel. Les réponses entrantes email/WhatsApp restent illustrées en démo, leur synchronisation réelle n'est pas ajoutée. Aucun schéma ni serveur modifié. Disponible sur l'aperçu de la PR.
**Refs** : PR #312, branche `codex/inbox-candidate-history`.

## 2026-10-07 — SPEC — Messagerie : exemples fictifs et logos des services

**Contexte** : visualiser les emails, les discussions WhatsApp et les autres événements sans attendre une activité réelle.
**Décision / Fait** : bouton « Voir la démo » dans la messagerie, accès direct `/inbox?demo=1`. Trois candidats fictifs avec invitations LinkedIn, emails Gmail et Outlook entrants et sortants, échanges WhatsApp, appel Aircall et entretien Calendly avec Google Meet. Réponses simulées en mémoire, brouillons distincts par candidat, sortie vers la messagerie réelle. Les cartes et le contexte réutilisent les composants de la messagerie ; les logos identifient les services connus, sans déduire un fournisseur de l'adresse du destinataire.
**Validation** : Chromium en StrictMode sur la page Inbox, clair/sombre, 320/390/1280/1600/1920 px : email développé, changement de candidat, réponse unique, brouillon conservé, panneau de contexte, sortie et réouverture sans compte LinkedIn. Aucun débordement, aucune erreur navigateur, aucune écriture serveur dans la démo, composeur visible à 500 px de hauteur. Build réussi ; TypeScript à 11 erreurs héritées ; lint des fichiers touchés sans nouveau diagnostic ; dette design inchangée. Suites UX et C1 vérifiées.

| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Parcours des trois candidats, Gmail/Outlook/WhatsApp et réponse simulée | PASS |
| Claire | Distinction de la démo, contenu des emails, entretien et sortie sans compte connecté | PASS |
| Théo | Lien avec chat réel sans marquage lu en démo, zéro écriture, brouillons séparés et essais effacés à la sortie | PASS |
| Sophie | Retour à la liste, changement de candidat, contexte et réponse à 320/390 px et hauteur 500 px | PASS |

**Limites** : navigateur avec services simulés pour vérifier l'absence d'écritures ; aucun message réel envoyé. Le mode démo illustre les réponses email/WhatsApp, dont la synchronisation réelle reste à connecter. Fournisseur d'email générique si l'origine de l'événement n'est pas enregistrée.
**Refs** : PR #312, branche `codex/inbox-candidate-history`.

## 2026-10-07 — SPEC — Messagerie : historique candidat et largeur utile

**Contexte** : la liste étroite et la conversation isolée masquaient le suivi effectué sur les autres canaux.
**Décision / Fait** : fil chronologique commun aux messages LinkedIn et aux envois réels de séquences (invitation, email, WhatsApp), cartes avec contenu, sujet, destinataire, statut et date d'entretien. Liste élargie ; mission, séquence et prochain entretien dans un panneau latéral sur grand écran, accessible depuis l'en-tête sur les autres tailles. Avant sélection, conversations récentes et accès aux échanges à répondre ou relancer.
**Validation** : build réussi, 118 fichiers UX et 28 fichiers C1 réussis ; TypeScript à 11 erreurs héritées, dette design sans augmentation, un diagnostic lint hérité sur les fichiers touchés. Régressions sur les alias, 501 envois, les homonymes, les fuseaux horaires, la déduplication et les clés de cache utilisateur/organisation. Chromium en StrictMode : thèmes clair/sombre, 320 à 1920 px, réponse unique, panneau mobile et composeur accessible à 500 px de hauteur.

| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Contenu des canaux, origine de séquence, 501 envois et texte LinkedIn non dupliqué | PASS |
| Claire | Date et statut d'entretien, email développé, ouverture depuis les conversations récentes | PASS |
| Théo | Organisation et candidat changés pendant une lecture, HTML inerte, panne partielle et réessai | PASS |
| Sophie | Lecture et réponse sur 320/390 px, contexte accessible, aucun débordement horizontal | PASS |

**Limites** : essais navigateur avec données simulées. Vérification SQL en lecture seule de la présence du périmètre organisation sur les sources existantes ; pas de test d'envoi avec un compte réel. Les réponses email et WhatsApp ne sont pas synchronisées dans cette page ; seuls leurs envois de séquence sont ajoutés. Aucun schéma ni serveur modifié.
**Reste à faire** : relier les conversations et réponses des autres canaux ; validation en compte connecté après fusion.
**Refs** : branche `codex/inbox-candidate-history`.

## 2026-10-07 — BUG — Messagerie : identités LinkedIn, échéances et catégories

**Fait** : rapprochement des trois identifiants LinkedIn, priorité aux séquences actives avec pagination ; états, compteurs et filtres relus toutes les 30 secondes ; catégories automatiques écrites dans l’organisation vérifiée du compte. Conflit avec main résolu en conservant son contraste.
**Validation** : build réussi ; TypeScript 11 erreurs héritées, lint et dette design sans augmentation. Régressions UX, C1 et agent vérifiées. Navigateur Chromium avec réponses simulées, sans accès aux comptes réels.

| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Alias Recruiter/Classic, active ancienne au-delà de 500 inscriptions | PASS |
| Claire | Réponse du candidat prioritaire, état et compteur cohérents | PASS |
| Théo | Seuil de relance franchi sans nouveau message ; écriture bornée à l’organisation | PASS |
| Sophie | Ligne À faire masquée au focus sur 390 px ; insertion conservant le brouillon | PASS |

**Reste à faire** : validation en environnement connecté après fusion ; la fonction serveur est déployée par le workflow de main.
**Refs** : PR #308.

## 2026-10-07 — BUG — Onboarding : reprises, classement et changement de client

**Fait** : recherche et scoring partagés par le cache du parcours pendant les retours arrière ; tri des dix profils avant l’affichage des six meilleurs ; brief invalidé quand le client change, y compris après rechargement. Conflits avec main résolus et contrastes des nouvelles scènes alignés.
**Validation** : build réussi ; TypeScript 11 erreurs héritées, lint et dette design sans augmentation. Régressions UX, C1 et agent vérifiées. Chromium en StrictMode, réponses simulées, largeurs de 320 à 1440 px et deux thèmes.

| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Premier candidat affiché et destinataire du message identiques | PASS |
| Claire | Espace, brief, mission et fin du parcours entreprise | PASS |
| Théo | Retour pendant le scoring : un seul appel ; client A puis B ; reprise sans mission dupliquée | PASS |
| Sophie | Parcours mobile 320/390 px, sans débordement ni erreur navigateur | PASS |

**Reste à faire** : validation en environnement connecté après fusion.
**Refs** : PR #255.

## 2026-10-06 — SHIP — Brief IA : consigne dite une fois, offres filtrables, échec d'adresse plus clair

**Contexte** : retour du propriétaire, « le design et l'UX sont à retravailler », puis « fais au mieux » après une revue de la fenêtre de création (choix, saisie, résultat, offres d'une société) en sombre, clair et téléphone.
**Décision / Fait** :
- La consigne « Collez la fiche de poste » n'était dite que par trois endroits à la fois (sous-titre, champ, panneau vide) : le champ la garde sans le glisser-déposer (déjà écrit sous le champ), le panneau vide annonce ce qui sera retenu (poste, lieu, expérience, contrat, compétences).
- Adresse web : phrase d'aide sur une ligne ; les adresses « companies-v1 » sont reconnues aussi côté écran (`parseJobUrl`), donc la société est préremplie quand la page n'est pas lue ; l'échec dit d'ouvrir une offre et de coller son adresse, ou le texte de la fiche.
- Offres d'une société : « Voir l'offre » sur chaque ligne (nouvel onglet, icône seule sur téléphone, cible de 44 px) ; au-delà de 8 offres, un champ filtre par intitulé ou lieu, sans accent ni casse, la sélection restant celle de toute la liste.
- Non retenu : un second « Voir le pipeline » dans la barre du Sourcing (le groupe des profils retenus porte déjà « Ouvrir le Pipeline »), et la lecture automatique au collage d'une adresse (une lecture de page société peut coûter une page du service de rendu, plafonnée à 60 par personne et par jour).
**Impact** : `CreateMissionV2.tsx`, `BriefAnalysisPanel.tsx`, `JobOffersPicker.tsx`, `tests/ux/import-offres.test.mjs`, `tests/ux/creation-mission-brief.test.mjs` (mutations « filtre retiré » et « companies-v1 retiré » détectées).
**Refs** : `docs/design/06-simplicite.md`.

---

## 2026-10-06 — SHIP — Brief IA : les deux tuiles du premier écran redeviennent des cartes

**Contexte** : depuis « tous les boutons sont des pilules » (#279), les deux tuiles « Coller une fiche de poste » et « Saisir à la main » (des `Button` à contenu empilé) s'affichaient en capsules, le texte touchant la courbe.
**Décision / Fait** : coin de carte (`rounded-xl`) posé sur ces deux tuiles, qui restent des `Button` de la primitive (focus, clavier et survol inchangés).
**Impact** : `src/components/missions/v2/CreateMissionV2.tsx` (`ChooseMode`), `tests/ux/creation-mission-brief.test.mjs`. Rendu vérifié sur le vrai composant, sombre, clair et téléphone.
**Refs** : `docs/design/01-direction.md`, § 6.

---

## 2026-10-06 — SHIP — Cadrage : « Aller au sourcing »

**Contexte** : après la création d'une mission, l'écran d'arrivée est le Cadrage (`?tab=brief` vers `cadrage?section=poste`). Les trois écrans ne se rejoignent que par les onglets de l'en-tête, en texte discret et dans l'ordre Pipeline, Sourcing, Cadrage : le propriétaire n'a trouvé aucun moyen de passer au Sourcing.
**Décision / Fait** : un bouton « Aller au sourcing » termine la ligne du bandeau d'état du Cadrage (`CadrageReadiness`, prop `onContinue`, `goToScreen('sourcing')` dans `CadrageScreen`). Plein (`primary`) quand le poste est prêt, teinté (`secondary`) sinon : jamais verrouillé, jamais masqué en lecture seule (conception 3.1, écrans sans verrou). Un seul bouton plein par écran reste vrai : aucun autre n'existe sur le Cadrage.
**Impact** : `src/components/missions/v3/cadrage/CadrageReadiness.tsx`, `CadrageScreen.tsx`, `tests/ux/lot12-cadrage.test.mjs` (nouveau test, mutation « bouton sous la condition de la dictée » détectée). Rendu vérifié sur le vrai composant (sombre et clair, 1100 et 390 px, 44 px de haut sur téléphone).
**Reste à faire** :
- [ ] Le Sourcing n'a pas de sortie vers le Pipeline autre que l'onglet : à décider avec le propriétaire.
**Refs** : `docs/refonte-mission/conception.md` 3.1.

---

## 2026-10-06 — INSIGHT — Brief IA : une page société de Welcome to the Jungle ne se lit pas en lecture directe

**Contexte** : essai en réel de `fetch-job-source` sur `…/fr/companies-v1/numspot/jobs`.
**Fait** : la page reçue par le serveur (68 086 caractères, 32 liens) ne contenait ni donnée `JobPosting`, ni `__NEXT_DATA__`, ni aucune occurrence de `/jobs` : la liste d'offres est construite par le navigateur après l'ouverture. Seule la lecture de secours (rendu JavaScript par Firecrawl, `FIRECRAWL_API_KEY`) peut la voir ; sans clé, le journal note `firecrawl: "not_configured"`. Une page d'offre, elle, porte son `JobPosting` et son texte dans le HTML. Les adresses `companies-v1` existent comme `companies`.
**Impact** : le journal `[fetch-job-source] resolve` porte désormais, quand rien n'est lu, le relevé de chaque niveau (`trace` : taille de la page, données `JobPosting`, liens, mentions de `/jobs`, `__NEXT_DATA__`, état de Firecrawl). La recherche des adresses d'offres dans les données intégrées de la page (`wttjLinksFromRawHtml`) est en place pour les sites qui les y écrivent.
**Refs** : PR #275, commits f4bbd55 et 2540814.

---

## 2026-10-05 — SHIP — Brief IA : lire une offre, ou toutes les offres d'une société, depuis une adresse web

**Contexte** : « Une adresse web » du Brief IA ne lisait que le texte de l'adresse (poste, société, lieu d'une adresse Welcome to the Jungle) et demandait de coller la fiche. La fonction qui lisait les pages (`scrape-job-url`) avait été retirée le 06/09 faute d'appelant.
**Décision / Fait** :
- Nouvelle fonction `fetch-job-source` (`resolve` : une offre ou la liste d'une société ; `read_job` : la fiche d'une offre de la liste). Trois niveaux, du plus propre au plus coûteux : l'interface publique du logiciel de recrutement (Greenhouse, Lever, Ashby, Recruitee), la lecture directe de la page (données `JobPosting`, liens d'offres, sinon texte), Firecrawl en dernier recours, seulement si `FIRECRAWL_API_KEY` est posée, avec un plafond de 60 pages par utilisateur et par jour. Le niveau utilisé est journalisé : c'est la mesure du taux de réussite par site.
- La fonction lit des adresses saisies par les utilisateurs : https, port 443 et nom de domaine public seulement, aucune adresse IP, résolution DNS refusée vers une adresse privée, redirections manuelles et revalidées, taille et durée bornées, jeton d'ATS validé avant de construire une adresse, LinkedIn jamais lu. Aucun appel de modèle, aucun crédit débité, limite de 30 lectures par minute.
- Écran : une offre remplit la zone « Fiche de poste » (texte réel, intitulé, société). Une société ouvre la liste de ses offres (gratuite) : au plus 10 cochées, coût annoncé depuis le catalogue (7 crédits par offre pour `brief_analysis`), une offre déjà importée (adresse source `job_details.source_url`) n'est pas cochable. Une seule offre cochée s'ouvre dans le Brief IA pour relecture ; deux ou plus sont lues et analysées trois à la fois, puis créées comme missions (nom : intitulé et lieu, client : la société, brief et filtres comme le Brief IA d'une fiche). Un échec n'arrête pas les autres ; des crédits épuisés arrêtent les suivantes et laissent créer celles qui sont prêtes. Un seul message annonce le lot (`silent` sur `createProject`).
- Page illisible : retour au comportement d'avant (poste, société et lieu de l'adresse) avec une phrase qui dit de coller la fiche.
- Premier essai en réel le 05/10 (journaux : lecture par `json_ld`) : le `JobPosting` de Welcome to the Jungle ne porte que le descriptif du poste, il manquait le résumé, les compétences et expertises, le profil recherché et le déroulement des entretiens. Pour ce site seulement, la description devient le texte de la page (contenu de `<main>`, en-tête compris, coupé avant « Offres similaires ») quand il est plus fourni d'un quart, sinon le rendu Firecrawl de la page entière, sinon le `JobPosting` reste. Ailleurs, un `JobPosting` suffit toujours. Le journal de lecture donne maintenant le nombre de caractères de la fiche (`chars`). Deuxième essai le même jour : la page entière faisait 8 700 caractères, offres suggérées d'autres sociétés comprises. Le texte est coupé au premier lien vers une autre offre (`/companies/<société>/jobs/<offre>` différente de celle lue), reculé jusqu'au titre du bloc s'il est à moins de 1 500 caractères, et jamais si ce qui reste fait moins de 600 caractères (fil d'Ariane en tête de page). Une adresse Welcome to the Jungle non reconnue (recherche, accueil) renvoie un message qui dit quelle adresse utiliser. Essai du 06/10 : la page emplois d'une société s'écrit aussi `/fr/companies-v1/<société>/jobs` (elle était classée « quelconque » et refusée) ; `companies-v1` est reconnu comme `companies`, pour la société, l'offre et la coupe des offres suggérées.
**Raison** : demande du propriétaire du 05/10/2026, « puissant » : l'adresse suffit, pour une offre comme pour toute une société. Les connecteurs de la base (`connector_registry`, 8 entrées, sans écran ni moteur) servent à brancher son propre compte d'ATS ; ici le recruteur lit la page publique d'un client, sans identifiant.
**Impact** : `supabase/functions/fetch-job-source/` (`guard.ts`, `readers.ts`, `resolve.ts`, `index.ts`), `supabase/config.toml`, `src/components/missions/v2/jobSource.ts`, `JobOffersPicker.tsx`, `CreateMissionV2.tsx`, `briefAnalysis.ts`, `src/hooks/useSourcingProjects.ts` (`silent`, `jd_source_url`), `src/types/jobDetails.ts` (`source_url`) ; tests `tests/ux/lecture-offres-serveur.test.mjs` (39) et `tests/ux/import-offres.test.mjs` (18), job Build de la CI ; `CLAUDE.md` (74 fonctions).
**Recette** : tests sur réseau simulé (chaque niveau, chaque repli, LinkedIn, plafond de Firecrawl, 130 offres tronquées à 100) et banc visuel sur le vrai composant : liste de six offres dont une déjà importée, trois choisies, analyse, création de trois missions avec leur adresse source, une offre seule ouverte dans le Brief IA, page illisible, crédits épuisés en cours de lot, clair, 1440 px et 390 px. Huit mutations des tests sont détectées : cinq pour ce lot (redirections suivies, http admis, LinkedIn lu, lot qui continue sans crédits, toast par mission) et trois pour le lot précédent. Aucun accès à Welcome to the Jungle ni aux interfaces des ATS depuis cette session (accès réseau refusé) : les formats Greenhouse, Lever, Ashby et Recruitee suivent leur documentation publique et n'ont pas été vérifiés en réel.
**Reste à faire** :
- [ ] Après déploiement : lire une page société et une offre Welcome to the Jungle, et relever dans les journaux le niveau utilisé (`ats_api`, `json_ld`, `direct_text`, `firecrawl`). Si le site refuse la lecture directe et que Firecrawl n'est pas configuré, la page reste illisible.
- [ ] Vérifier que `FIRECRAWL_API_KEY` est posée dans les secrets Supabase : sans elle, le troisième niveau est ignoré.
- [ ] Faire valider les conditions d'utilisation de Welcome to the Jungle avant d'ouvrir la fonction aux clients (lecture déclenchée par l'utilisateur, une page à la fois ; pas de lecture de sociétés en masse).
- [ ] Un merge sur `main` redéploie toutes les fonctions (`_shared/ai-config.ts` modifié par le lot précédent) : compter une trentaine de minutes.
**Refs** : `docs/design/06-simplicite.md`, lot précédent « Brief IA : design simplifié et analyse par Sonnet 5.5 ».

---

## 2026-10-05 — SHIP — Brief IA : design simplifié et analyse par Sonnet 5.5

**Contexte** : la fenêtre de création de mission (`CreateMissionV2`, écran « Brief IA ») était restée dans l'ancien langage (dégradés, emoji, tutoiement, deux croix de fermeture) et appelait `generate-search-filters` sans action ni modèle choisi, donc sur Sonnet 4.6. Une fiche de 6 185 caractères n'était lue que sur ses 800 premiers.
**Décision / Fait** :
- Design : règles de `docs/design/01-direction.md` et `06-simplicite.md`. Un seul bouton plein (noir), primitives `Button`/`Input`/`Textarea`/`Label`, pas de cadre autour de la liste détectée, vouvoiement, ni emoji, ni dégradé, ni tiret long. Les trois écrans (choix, brief, saisie manuelle) suivent la même mise en forme. Hauteur fixe sur grand écran, chaque colonne défile seule.
- Panneau de droite (`BriefAnalysisPanel.tsx`, aides pures dans `briefAnalysis.ts`) : en attente (illustration `brief`), analyse en cours (squelette), erreur avec « Réessayer », résultat en lignes. Les intitulés ciblés et les compétences sont des pastilles (le modèle renvoyait un groupe booléen `"A" OR "B"` affiché tel quel). Les informations absentes de la fiche sont nommées. Une fiche ou un client modifiés après l'analyse font apparaître un bandeau « Relancer l'analyse ».
- UX : Ctrl ou Cmd + Entrée lance l'action principale ; « Créer sans analyse » reste possible (crédits épuisés, panne) ; le nom proposé par l'IA suit la relance tant que l'utilisateur ne l'a pas saisi ; le texte de l'adresse web n'insère plus une consigne de collage dans la fiche ; la rémunération n'est retenue que si elle est plausible en annuel (10 000 € au moins, un taux journalier n'est pas un salaire).
- IA : action dédiée `brief_analysis`, Sonnet 5.5 par défaut (`autoDefault`, comme le scoring), dans les deux catalogues. Pas `filter_generation` : elle est partagée avec `nl-filter-edit`, `AutoFillFiltersButton` et d'autres appelants qui lisent `content[0].text`, que le bloc « thinking » des modèles 5.5 casse. `generate-search-filters` lit le bloc texte, règle l'effort (`low`), laisse 2000 tokens de marge, passe `max_tokens` de 2048 à 4096 (2048 laissait peu de marge à une réponse chargée, et un JSON coupé tombait dans le repli sur le titre sans rien dire) et lit la fiche jusqu'à 12 000 caractères. Elle renvoie enfin les champs du brief structuré que le prompt demandait mais que la réponse jetait : le Brief IA remplissait `job_details` avec des valeurs de repli. Drapeau `degraded` quand le JSON est illisible.
- Brouillon : l'effet de fermeture (UX06) ne s'exécutait jamais, les deux parents démontent la fenêtre au lieu de passer `isOpen` à `false`, et il effaçait ce qu'il venait d'écrire. Enregistrement au démontage et au fil de la saisie, sans écriture si rien n'a changé.
**Raison** : décision du propriétaire du 05/10/2026, qualité de l'analyse d'abord. Sans la lecture de la fiche entière et sans les champs du brief, un meilleur modèle n'améliorait pas ce que la mission enregistre.
**Impact** : `src/components/missions/v2/CreateMissionV2.tsx`, `BriefAnalysisPanel.tsx` et `briefAnalysis.ts` (nouveaux), `supabase/functions/generate-search-filters/index.ts`, `supabase/functions/_shared/ai-config.ts`, `src/types/aiCredits.ts` ; test `tests/ux/creation-mission-brief.test.mjs` (26 tests, job Build de la CI). Audit design : effets décoratifs 34 → 16, emoji 142 → 129, tirets longs 83 → 76, couleurs en dur 3 → 1, polices hors système 1 → 0, et cinq `any` de moins dans le fichier.
**Recette** : banc local (Vite et Playwright sur le vrai composant, création en base et appel IA simulés), sombre et clair, 1440 × 900, 1280 × 720 et 390 × 844 : choix, brief vide, brouillon restauré sous StrictMode, analyse en cours, résultat, fiche modifiée, erreur technique, crédits épuisés, réponse dégradée, saisie manuelle, fermeture puis réouverture. Action `brief_analysis` et fiche entière confirmées dans la requête, `job_details` complet, brouillon effacé après création, aucun débordement horizontal, aucune erreur console. Trois mutations du test (lecture de `content[0]`, tutoiement avec tiret long, Sonnet 5.5 sur `filter_generation`) sont détectées. Pas de recette `qa.md` sur l'application connectée, ni d'appel réel à Sonnet 5.5 depuis cette session.
**Reste à faire** :
- [ ] Après déploiement : analyser une vraie fiche de plus de 6 000 caractères. Dans les journaux de la fonction, vérifier l'absence de « Failed to parse AI response », de « truncated at max_tokens », et la durée (délai de l'appel porté à 55 s pour les modèles 5.5).
- [ ] `output_config.effort` est repris de `score-profile-job` (#268), non vérifié contre l'API depuis cette session.
- [ ] Recette `qa.md` des quatre personas sur l'application connectée.
- [ ] Hors périmètre, constaté : la fiche de la capture décrit quatre entretiens, que l'analyse pourrait extraire pour pré-remplir `mission_process_steps`. `nl-filter-edit` utilise `filter_generation`, donc Sonnet 4.6 (PERF-029).
**Refs** : #268 (scoring Sonnet 5.5), docs/design/06-simplicite.md.

---

---

---

## 2026-10-06 — SHIP — Bandeau du kit : 44 px au doigt pour l'action et la croix

**Contexte** : relevé par la recette de l'état vide de /missions (#294). Sur téléphone, le bandeau d'essai, présent en haut de chaque page pour une organisation dont l'essai se termine ou est terminé, offrait « Choisir un plan » sur 20 px de haut et une croix de 36 px, sous les 44 px de la règle des cibles au doigt.
**Décision / Fait** :
- `bannerActionClass` (`src/components/ui/banner.tsx`) : 44 px de haut sur téléphone (`max-md:min-h-11`), texte centré. Vaut pour toutes les actions de bandeau (« Choisir un plan », « Reconnecter », « Voir les offres », « Acheter des crédits »…).
- Croix : dessin de 36 px gardé, zone invisible de 44 px (`::after`). Une croix de 44 px prenait 8 px au texte, qui passait sur une ligne de plus (bandeau de 137 à 157 px) ; avec la zone, le bandeau garde sa hauteur.
- Rien ne change sur ordinateur (lien de 20 px, croix de 28 px).
**Raison** : cibles de 44 px au doigt (01-direction.md), sans changer la mise en page.
**Impact** : `src/components/ui/banner.tsx` seulement, donc tous les bandeaux du kit (essai, crédits bas, séquences). Test : `tests/ux/bandeau-cibles.test.mjs` (2 tests, nouveau, rendu statique).
**Recette `qa.md`** (banc local, compte à l'essai terminé, rien d'enregistré) :
| Persona | Scénario | Verdict |
|---|---|---|
| Sophie | Téléphone 390 px : lien 97 × 44, croix 44 × 44, bandeau de 137 px comme avant ; la croix touchée 3 px au-dessus de son dessin ferme le bandeau | PASS |
| Guillaume | « Choisir un plan » touché 4 px au-dessus du bas de sa zone : Abonnement et crédits s'ouvre | PASS |
| Claire | Ordinateur 1 440 px : bandeau de 45 px, lien de 20 px et croix de 28 px, comme avant | PASS |
| Théo | Écran de 320 px, texte du bandeau sur plusieurs lignes : aucun débordement, croix et lien dans l'écran | PASS |
**Refs** : #294.

## 2026-10-05 — SHIP — Design simplifié, fin du lot M : l'état vide de /missions

**Contexte** : dernier reste du lot M de `docs/design/06-simplicite.md`. Sans mission, /missions montrait l'ancien langage : titre en capitales, chiffres publicitaires (« 200M+ profils accessibles », « 45s », « 3x plus rapide »), deux grandes cartes animées (réseau de neurones, particules, bouton scintillant), une rangée de logos d'outils que Konekt ne relie pas (Slack, HubSpot, Salesforce), un lien « page carrières » sans action, et pas de titre de page.
**Décision / Fait** :
- `EmptyMissionState` devient l'état vide du kit : dessin « dossier » (01-direction.md, § Illustrations), « Lancez votre première mission » en casse de phrase, une phrase (« Une mission, c'est un poste à pourvoir. Collez la fiche de poste : l'assistant en tire le brief et les filtres de recherche. »).
- Deux entrées, les mêmes qu'avant : « Coller une fiche de poste » (seul bouton plein, mode brief de `CreateMissionV2`) et « Saisir le poste à la main » (bouton discret, mode manuel), 44 px au doigt.
- La page garde son titre « Missions » (`PageHeader`, sans second bouton) ; les missions confiées par une entreprise restent au-dessus.
- `src/components/magicui/shimmer-button.tsx` retiré : ce bouton n'avait plus d'autre lecteur.
**Raison** : règles 2, 7 et 8 du design simplifié, et des chiffres ou des logos que rien ne soutient. Mesures du banc (compte vide), ordinateur 1 440 px : 23 icônes puis 0, hauteur 1 113 puis 900 px ; téléphone : hauteur 1 655 puis 844 px. Cliquet design : effets décoratifs 34 puis 33, boutons faits main 301 puis 300, texte atténué 163 puis 151.
**Impact** : `src/components/missions/EmptyMissionState.tsx` (réécrit, 578 lignes puis 36), `src/components/outreach/projects/ProjectsListV2.tsx` (titre de page dans l'état vide), `src/components/magicui/shimmer-button.tsx` (supprimé). Aucune lecture ni écriture ne change. Test : `tests/ux/missions-vide-simplicite.test.mjs` (4 tests, nouveau, rendu statique de l'état vide).
**Recette `qa.md`** (banc local, rien d'enregistré) :
| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Titre « Missions » ; « Coller une fiche de poste » à la souris ouvre la création sur la fiche de poste (nom, client, fiche) ; « Saisir le poste à la main » au clavier l'ouvre sur la saisie (titre, client, description) ; rien de créé | PASS |
| Claire | Aucun nom de fournisseur, terme technique ni chiffre publicitaire ; un seul bouton plein, « Coller une fiche de poste » | PASS |
| Théo | Lecture des missions en échec : erreur avec « Réessayer », jamais l'état vide ; compte avec missions : la liste, jamais l'état vide | PASS |
| Sophie | Téléphone 390 px tactile : deux boutons, aucun sous 44 px, aucun débordement | PASS |
**Reste à faire** :
- [ ] Fenêtre de création de mission (`CreateMissionV2`) : libellés en capitales et tutoiement (« Choisis comment tu veux décrire la mission »), contraire au § 9 de 01-direction.md.
- [ ] Bandeau d'essai (`TrialBanner`, `src/components/ui/banner.tsx`) : « Choisir un plan » (20 px) et la croix (36 px) sous 44 px au doigt, sur toutes les pages.
**Refs** : docs/design/06-simplicite.md (lot M), #292.

## 2026-10-05 — SHIP — Design simplifié, lot Suite 3 : les Paramètres, première partie

**Contexte** : troisième écran du lot « Suite » de `docs/design/06-simplicite.md`, après le Pipeline global (#286) et la messagerie (#288). Les Paramètres empilaient des cartes bordées (dix sur Abonnement et crédits), affichaient des compteurs à zéro (« 0 / 40 » sur les plafonds LinkedIn, « 0 / 100 » sur la Base Konekt, « 0 / 200 » sur le forfait de contacts, « 0/200 » et « (0/10) » sur les consignes de rédaction), des pastilles de couleur (« Actif », « Populaire », « -20 % »), « Dissocier » en rouge au repos et deux longues listes dépliées (coût de 39 actions, sept protections du compte LinkedIn). Les PR #260 et #262 touchent la coquille, le Journal et les Règles de l'assistant : ce lot n'y entre pas.
**Décision / Fait** :
- Cartes à plat : `CardPlainProvider` (`src/components/ui/card.tsx`) retire cadre, fond, rayon et marges latérales des cartes qu'il entoure, et deux cartes voisines se séparent par un filet. `SettingsAnchor` le pose sur chaque rubrique : aucun fichier des PR ouvertes n'est modifié, et hors des Paramètres une carte garde son rendu.
- Connexions : plafonds du jour sans « 0 / N » ni barre vide (« jusqu’à 40 »), le chiffre et la barre revenant dès la première action ; palier de montée en charge en texte, absent une fois le compte mature ; « Dissocier » neutre au repos, rouge au survol ; « Comment Konekt protège votre compte LinkedIn » à la demande ; champs de 44 px au doigt.
- Rédaction : compteurs de caractères et de consignes à partir du premier caractère ou de la première consigne ; modèles suggérés en lignes discrètes, sans encadré pointillé ni tuiles ; modèles et signatures en liste à plat ; « Aucune signature » sans cadre.
- Équipe : « Membres » sous la rubrique « Équipe » ; le rôle en texte, jamais répété à côté de son sélecteur ; lignes au ras du titre ; plus de phrase « Aucune invitation envoyée » ; invitations en liste à plat, une invitation acceptée sans couleur (une invitation expirée reste orange).
- Général : la ligne « Comptes LinkedIn de l'organisation » au ras de son titre.
- Abonnement et crédits : état de l'abonnement en mots, orange seulement pour un paiement en attente ou une résiliation programmée ; limites du plan sans tuiles ; mention des packs en texte neutre ; coût par action replié ; historique absent tant qu'il est vide (montré en cas de panne) ; Base Konekt et forfait de contacts sans « 0 / N » quand rien n'est utilisé.
**Raison** : règles 2, 3, 7 et 8 du design simplifié. Mesures du banc (mêmes données et réponses simulées avant et après), ordinateur 1 440 px : cadres 5 puis 0 (Connexions, Rédaction), 2 puis 0 (Équipe), 3 puis 1 (Général), 10 puis 1 (Abonnement et crédits), 7 puis 4 (Règles de l'assistant) ; zéros affichés 5 puis 0 et textes colorés 1 puis 0 (Connexions) ; textes colorés 3 puis 0 (Abonnement et crédits) ; hauteur 2 029 puis 1 517 px (Connexions), 3 179 puis 1 804 px (Abonnement et crédits). Sur téléphone, Abonnement et crédits passe de 4 931 à 2 386 px. Le second bouton plein mesuré sur Abonnement et crédits est le « Réessayer » du solde, que le banc ne sait pas lire ; avec un solde simulé, la page n'en compte qu'un (recette).
**Impact** : `src/components/ui/card.tsx` (`CardPlainProvider`), `src/components/settings/` (`shell/SettingsAnchor`, `shell/GeneralSection`, `shell/TeamSection`, `AICreditsSettings`, `BillingSettings`, `BaseKonektCard`, `EnrichmentAnalytics`, `TeamManagement`, `PendingInvitations`, `InviteMemberForm`, `IntegrationsSettings`, `MyLinkedInAccount`, `LinkedInSafetySettings`, `AiContextSettings`, `MessageTemplatesSettings`, `EmailSignatures`). Aucune lecture ni écriture ne change. Tests : `tests/ux/parametres-simplicite.test.mjs` (11 tests, nouveau, rendu statique de la carte, de la rubrique et des invitations) ; `lot12a-parametres-compte` (signatures à plat, hauteur du champ de ton) et `lot12b-parametres-organisation` (mention des packs, ligne d'un membre, en-tête des outils reliés) mis à jour.
**Recette `qa.md`** (banc local, rien d'enregistré) :
| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Coût par action ouvert au clavier (39 lignes) puis refermé ; historique vide absent, solde lu, état « Actif » en texte ; sept protections à l'ouverture ; cinq plafonds « jusqu’à N » ; « Dissocier » : confirmation ouverte puis annulée ; membre déplié, « Propriétaire » en texte, « Admin » seulement dans son sélecteur ; spécialité : « 4/200 » à la saisie, rien une fois vidée ; consigne ajoutée : « À faire (1/10) » | PASS |
| Claire | Cinq rubriques : aucun nom de fournisseur ni terme technique, aucun « 0 / N », un bouton plein au plus par page | PASS |
| Théo | Compte vide (Équipe, Abonnement et crédits) : aucun zéro ; historique en panne : section montrée avec « Réessayer » ; plafond utilisé à 90 % : « 36 / 40 » en orange avec sa barre, palier « Compte mature » absent ; Base Konekt utilisée : « 12 / 100 recherches incluses ce mois » ; nom très long avec emoji et texte de droite à gauche : aucun débordement (ordinateur, téléphone) | PASS |
| Sophie | Téléphone 390 px tactile, replis ouverts : aucun contrôle sous 44 px sur les cinq rubriques | PASS |
**Reste à faire** :
- [ ] Coquille des Paramètres, Journal de l'assistant, politiques et connecteurs des Règles de l'assistant : après #260 et #262.
- [ ] Comptes disponibles (LinkedIn, e-mail) et comptes LinkedIn de l'organisation dépliés, encore en tuiles grises : à reprendre avec la coquille.
**Refs** : docs/design/06-simplicite.md (lot Suite), #286, #288.

## 2026-10-05 — SHIP — Design simplifié, lot Suite 2 : la messagerie

**Contexte** : deuxième écran du lot « Suite » de `docs/design/06-simplicite.md`, après le Pipeline global (#286). La messagerie avait déjà sa revue (lot 6a), mais gardait des pastilles colorées sur chaque ligne (étiquette, intention, non-lus, logo LinkedIn sur chaque visage), « À répondre » en couleur de marque, un bouton « Actualiser », des comptes « (0) » dans les filtres, cinq boutons de mise en forme dans le composeur et un cadre pointillé autour du panneau vide.
**Décision / Fait** :
- Colonne des conversations : titre de page à 28 px ; plus d'« Actualiser » (la liste se relit déjà toutes les 30 s, `useMessagesInbox`), ni dans l'en-tête ni dans l'état vide ; bascule « Toutes / À répondre / En attente » de la page mission (`SegmentedControl` quiet) ; filtres sans compte.
- Lignes : étiquette posée à la main ou intention lue par l'IA en texte discret, sans pastille ni couleur ; « À répondre » en orange (un candidat attend) ; les non-lus en gras, sans pastille chiffrée, le nombre restant lu par les lecteurs d'écran ; liste repliée : un point orange. Le logo LinkedIn ne se pose plus sur chaque visage : seul un autre canal se signale.
- Conversation : l'état de l'inscription s'écrit en mots à côté du nom (`EnrollmentStatusBadge`, nouvelle option `plain`, même libellé que la pastille) ; « Inscrire dans une séquence » en bouton discret ; le panneau « Sélectionnez une conversation » sans cadre.
- Composeur : la mise en forme tient dans son menu à toutes les tailles, raccourcis rappelés et toujours actifs ; le nombre de suggestions en texte neutre ; « Envoyer » reste le seul bouton plein. Suggestions rapides de 44 px au doigt.
**Raison** : règles 1, 2, 3, 7 et 8 du design simplifié. Mesures du banc, neuf conversations simulées (réponses LinkedIn et IA remplacées, quatre analyses et une étiquette posées le temps des mesures puis retirées), ordinateur 1 440 px : liste, 25 puis 24 contrôles, textes colorés 6 puis 3 (les seuls « À répondre »), cadres 1 puis 0 ; conversation ouverte, 49 puis 44 contrôles, textes colorés 7 puis 2. Sur téléphone, conversation ouverte : textes colorés 2 puis 0. Dix logos LinkedIn et trois pastilles de non-lus en moins sur la liste.
**Impact** : `src/components/outreach/inbox/` (`ChatListSidebar`, `ChatListItem`, `MessageView`, `MessageComposer`, `SmartReplies`), `MessagesInbox.tsx` (plus de comptes de statut passés à la liste), `SequenceBadges.tsx` (option `plain`, rendu par défaut inchangé). Aucune lecture ni écriture ne change. Tests : `tests/ux/messagerie-simplicite.test.mjs` (8 tests, nouveau, rendu statique des lignes), `tests/ux/lot6a-messagerie.test.mjs` mis à jour (D-04 : étiquettes en texte ; D-13 : mise en forme dans un menu).
**Recette `qa.md`** (banc local, base inchangée avant et après) :
| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Liste prête en 2,6 s (9 conversations) ; onglets À répondre 6, En attente 3 ; recherche « Sarah » : 1 ; menu Filtres (Statut, Étiquette, Boîte LinkedIn) sans compte ; conversation ouverte, suggestion insérée dans le composeur, menu « Mise en forme » à 5 outils, « Inscrire dans une séquence » ouvre son dialogue ; aucun envoi | PASS |
| Claire | Aucun terme technique ni nom de fournisseur, liste et conversation ; un seul bouton plein : « Envoyer » | PASS |
| Théo | Messagerie vide : l'état vide seul, sans « Actualiser » ni zéro ; lecture en échec : erreur avec « Réessayer » ; nom très long avec emoji et texte de droite à gauche : aucun débordement (liste, en-tête) | PASS |
| Sophie | Téléphone 390 px tactile : aucun contrôle sous 44 px (liste, conversation), menu « Mise en forme » à 44 px | PASS |
**Reste à faire** :
- [ ] Paramètres (Suite 3), après #260 et #262.
- [ ] Bulles envoyées en aplat sombre : à revoir avec le propriétaire, hors des huit règles.
- [ ] Le banc visuel (`scripts/design/capture.mjs`) ne simule pas de conversation : la messagerie y reste vide.
**Refs** : docs/design/06-simplicite.md (lot Suite), #286.

---

## 2026-10-05 — SHIP — Design simplifié, lot Suite 1 : le Pipeline global

**Contexte** : premier écran du lot « Suite » de `docs/design/06-simplicite.md` (Pipeline global, messagerie, Paramètres, mêmes règles, sans maquette). Le /pipeline gardait l'ancien langage : six tuiles de chiffres au-dessus de toutes les vues, quatre menus de filtres et « Avec rappel », colonnes et cartes encadrées, note en pastille colorée par niveau, statut de séquence en pastille, tableau à huit colonnes, chronologie et analyse en cartes.
**Décision / Fait** :
- En-tête : une phrase chiffrée (« 28 candidats dans 4 missions ») et « Rappels » en bouton discret. Plus d'« Actualiser » : la liste se relit au retour sur l'onglet (`refetchOnWindowFocus` de `useATSData`).
- Une rangée : la recherche, un seul menu « Filtres » (étape ; source s'il y en a plusieurs ; mission ; étiquettes ; « Avec rappel »), puis la bascule d'affichage de la page mission (`SegmentedControl`, nouvelle variante `quiet`, icônes seules sur téléphone). Sans candidat, ni filtres ni bascule.
- Colonnes au style du kanban de la page mission : fond de carte sans bordure, effectif écrit seulement s'il n'est pas nul, colonne vide muette sauf pendant un glisser (« Déposer ici »). Cartes : visage, nom, note en anneau (`ScoreRing`, nouveau, même rendu que la page mission), mission en texte, signal en texte (statut de séquence lu dans `sequenceLabels`), orange seulement pour un candidat bloqué.
- Tableau sans cadre, six colonnes au lieu de huit : la provenance passe sous la mission (« Séquence Approche Lead, en cours », « InMail »), la note en anneau, les liens au survol.
- Chronologie : lignes sans cadre ni pastille, une ligne de texte (étape, étape d'entretien, mission, séquence).
- Les chiffres passent dans l'onglet Analyse, sur fond doux, sections séparées par un filet. Aucun chiffre à zéro : « Jours dans l'étape » attend un candidat engagé, « Sans mouvement » un candidat bloqué, « Taux de réussite » une sortie. Goulots « Critique » en rouge, « À surveiller » en orange, écrits en texte.
- Au doigt, chaque contrôle a 44 px : en-têtes triables, noms et missions du tableau, liens de profil et d'e-mail, mission de la chronologie.
- Pagination du tableau et de la chronologie (#278, #282, arrivées sur `main` pendant le lot) : barre sans cadre sous un filet, Précédent et Suivant en boutons discrets de 44 px au doigt.
**Raison** : règles 1 à 8 du design simplifié. Mesures du banc contre `main` (pagination comprise), mêmes données, ordinateur 1 440 px :
| Vue | Contrôles | Cadres | Textes colorés | Zéros | Hauteur |
|---|---|---|---|---|---|
| Colonnes | 123 → 119 | 48 → 28 (les cartes) | 40 → 8 | 4 → 0 | 999 → 900 px |
| Tableau | 93 → 88 | 7 → 0 | 38 → 6 | 0 → 0 | 2 022 → 1 758 px |
| Chronologie | 63 → 59 | 32 → 0 | 0 → 0 | 0 → 0 | 3 084 → 2 591 px |
| Analyse | 20 → 13 | 16 → 0 | 5 → 5 | 3 → 0 | 1 553 → 1 318 px |
Sur téléphone (390 px), la page passe de 2 013 à 1 614 px en colonnes, de 2 370 à 1 968 px en tableau, de 4 566 à 3 861 px en chronologie, de 2 855 à 2 302 px en analyse.
**Impact** : `src/pages/ATS.tsx` ; `src/components/ats/` : `ATSFilters`, `ATSStats`, `ATSDroppableColumn`, `ATSKanban`, `ATSKanbanSkeleton`, `ATSCandidateCard`, `ATSTable`, `ATSTableSkeleton`, `ATSTimeline`, `ATSPagination`, `ATSPipelineAnalytics`, `ATSStatsSkeleton.tsx` supprimé ; kit : `src/components/ui/score-ring.tsx` (nouveau), `segmented-control.tsx` (variante `quiet` et `iconsOnlyOnPhone`, rendu par défaut inchangé). Aucune lecture ni aucun calcul de chiffre ne change. Tests : `tests/ux/pipeline-simplicite.test.mjs` (11 tests, nouveau), `tests/ux/lot7a-pipeline.test.mjs` mis à jour (anneau, menu « Filtres », six colonnes).
**Recette `qa.md`** (banc local) :
| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Colonnes prêtes en 2,5 s ; Tableau (six colonnes, `?view=table`, 25 lignes puis « 26 à 28 sur 28 »), Chronologie, Analyse, retour aux Colonnes au clavier ; menu « Filtres » (Étape, Mission, Rappel) : À trier, 28 puis 5 cartes, puis filtres effacés ; recherche « Inès » : 1 carte ; Rappels, fiche et « Déplacer vers… » (10 étapes) s'ouvrent ; aucune écriture en base | PASS |
| Claire | Aucun terme technique ni nom de fournisseur sur les quatre vues ; « Rappels » visible sans défiler | PASS |
| Théo | Compte vide : l'état vide seul, sans filtres, bascule ni zéro ; lecture en échec : erreur avec « Réessayer » ; nom très long avec emoji et texte de droite à gauche : aucun débordement (colonnes, tableau, chronologie) | PASS |
| Sophie | Téléphone 390 px tactile : aucun contrôle sous 44 px sur les quatre vues, zone élargie comprise, aucun débordement ; options du menu « Filtres » de 44 à 62 px, menu dans l'écran | PASS |
**Reste à faire** :
- [ ] Messagerie (Suite 2), puis Paramètres (Suite 3, après #260 et #262).
- [ ] `ScoreBadge`, coloré par niveau, reste hors du Pipeline (fiche de mission du /pipeline, scorecard, qualification, portail client, préparation d'envoi, assistant) : à passer à l'anneau au fil des lots.
**Refs** : docs/design/06-simplicite.md (lot Suite).

---

## 2026-10-05 — SHIP — Design simplifié, lot P : copie privée des photos des candidats

**Contexte** : les visages des candidats viennent du lien de photo LinkedIn enregistré sur leur ligne du pipeline (`linkedin_profile_data`). LinkedIn signe ces liens et les fait expirer : quelques semaines après la recherche, le visage redevient des initiales. Décision du propriétaire (« Copie privée ») : Konekt garde une petite copie, supprimée avec le candidat.
**Décision / Fait** :
- Bucket privé `candidate-photos` (200 ko, JPEG, PNG ou WebP) et table `candidate_photos`, une ligne par organisation et candidat. Lecture par les membres de l'organisation, écriture par la clé de service seulement.
- `capture-candidate-photos`, lancée toutes les deux minutes par pg_cron, copie 25 photos par passage. Le registre RGPD est lu avant tout téléchargement ; seules les photos LinkedIn sont prises, sans suivre de redirection, type lu sur les octets. Un lien refusé (403, 404, 410) n'est repris que s'il change ; un autre échec est retenté trois fois, à une heure d'écart. Le profil LinkedIn n'est lu que pour 100 candidats au plus par passage, et un candidat examiné n'est relu qu'après un changement de sa ligne : sans cela, chaque passage relisait tous les profils du pipeline. Un candidat sorti du pipeline de l'organisation perd sa copie au passage suivant.
- Effacement RGPD (`recordGdprErasure`, étape 10) : fichiers supprimés, lignes marquées `erased`, jamais reprises. `export-org-data` exporte la table.
- Écran : `PersonAvatar` reçoit `candidateId` et montre la copie, sinon le lien LinkedIn, sinon les initiales. Les adresses sont signées par lots de 100 et valent une heure ; celles des visages encore affichés sont redemandées cinq minutes avant la fin. Une réserve par personne connectée (`CandidatePhotosProvider`). Écrans branchés : page mission (liste, À trier, kanban, fiche), /pipeline (kanban, tableau, chronologie), accueil, liste des missions, Tâches, agenda, scorecard. Les sources en direct (recherche, messagerie, invitations) ne changent pas.
**Impact** : migration `20261005121536_photos_candidats_copie_privee.sql` ; `supabase/functions/capture-candidate-photos/`, `_shared/candidate-photo.ts`, `_shared/get-or-fetch-contact.ts`, `export-org-data` ; `src/lib/candidatePhotos.ts`, `src/components/CandidatePhotosProvider.tsx`, `person-avatar.tsx`, `types.ts` et les écrans cités. Tests : `tests/c1/photos-copie-privee.test.mjs` (14), audit `supabase/tests/candidate_photos_audit.sql` (17 contrôles, CI e2e, avec les appels anonymes refusés par l'API). La fusion touche `_shared/` : toutes les fonctions sont redéployées, `resolve-client-logo` comprise.
**Recette `qa.md`** (banc local) :
| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Lien LinkedIn simulé en 404 : le kanban montre la copie ; copie affichée 27 ms après le nom ; passage à la vue par étape sans nouvelle lecture | PASS |
| Claire | Aucun terme technique ni nom de fournisseur sur la page mission, /pipeline, l'accueil et Tâches ; aucune copie cassée | PASS |
| Théo | Autre organisation : 0 ligne, signature refusée, dossier vide ; envoi et suppression de fichier refusés ; écriture de la table refusée (42501) ; adresse publique 400 ; appel anonyme 401 ; tâche sans secret 403 | PASS |
| Sophie | Téléphone 390 px tactile : copie affichée, aucun débordement | PASS |
**Reste à faire** :
- [ ] Rattrapage, par LinkedIn, des candidats sans photo enregistrée ou au lien déjà expiré : plus tard, avec l'accord du propriétaire.
- [ ] Effacement RGPD des profils (`linkedin_profile_data`) et des CV : lot à part.
- [x] Première heure suivie après la fusion, en lecture seule : 114 copies `stored`, 670 `expired` (liens LinkedIn déjà échus), 433 candidats sans lien de photo, 1 photo trop lourde, aucune copie en échec ni en attente ; 32 passages, dont 6 où l'appel de pg_net a expiré à 5 s, sans effet sur les copies.
**Refs** : #271, docs/design/06-simplicite.md (lot P).

---

## 2026-10-05 — BUG — Logos des clients : la fonction n'avait pas d'entrée dans config.toml

**Contexte** : `resolve-client-logo` (#261) est arrivée sans entrée `[functions.resolve-client-logo]` dans `supabase/config.toml`. Le déploiement lit cette configuration : sans entrée, la fonction part avec `verify_jwt = true`, et la passerelle refuse les jetons ES256 des sessions. Les appels de `useClientLogoBackfill` échouaient donc sans bruit (l'erreur est avalée), et les logos des clients ne s'enregistraient probablement pas en production.
**Décision / Fait** : entrée `verify_jwt = false` ajoutée, comme pour toutes les fonctions (l'authentification se fait dans la fonction, `requireAuth`). Garde dans `tests/c1/c1-fonctions.test.mjs` : chaque dossier de `supabase/functions/` a son entrée, `verify_jwt = false` sauf `submit-application` (neutralisée au lot C1, exception documentée).
**Impact** : `supabase/config.toml`, `tests/c1/c1-fonctions.test.mjs`. Le déploiement automatique ne se déclenche que sur `supabase/functions/**` : après fusion, redéployer la fonction à la main (workflow « Deploy Supabase Edge Functions », cible `resolve-client-logo`).
**Reste à faire** :
- [x] Redéployer `resolve-client-logo` après fusion : fait le 05/10/2026 à 13:32 UTC par le déploiement de #270.
**Refs** : #261.

---

## 2026-10-05 — SHIP — Design simplifié, lot T : la page Tâches comme la maquette

**Contexte** : troisième écran du design simplifié (`docs/design/06-simplicite.md`), après l'accueil. La page Tâches suit la maquette « Konekt simplifié » : sept contrôles de filtre, une liste encadrée, des dates en rouge sur chaque ligne et une corbeille par ligne. Sur le banc, huit suggestions passaient avant les tâches : sur téléphone, la première tâche arrivait à 1 408 px du haut de la page.
**Décision / Fait** : un seul bouton plein (« Nouvelle tâche », plus d'« Actualiser ») ; Mes tâches / Équipe et En cours / Toutes, puis un seul menu « Filtres » (catégorie, mission, origine), comme la messagerie. Listes sans cadre ; « En retard » en rouge sous le réveil qui sonne, les dates des lignes sans couleur. Chaque ligne montre le visage du candidat (photo enregistrée, sinon initiales), sinon le logo du client de la mission enregistré depuis #261 (sinon ses initiales), avec un seul lien : la fiche du candidat, sinon la mission (adresse sans `project:`, l'ancien lien de mission était cassé). La mission s'écrit avec son client ; le nom du candidat n'est pas répété s'il est déjà dans le titre. La corbeille apparaît au survol, au clavier, et reste visible sur un écran tactile. Les suggestions passent sous la liste, avec le visage du candidat, trois au plus et les autres à la demande ; « Créer la tâche » devient un lien. Sous-titre sans zéro. La liste se relit au retour sur l'onglet (`refetchOnWindowFocus`), faute de bouton « Actualiser ».
**Raison** : règles 2, 3, 4, 5, 7 et 8 du design simplifié. Mesures du banc, mêmes données : 45 contrôles avant, 28 après (corbeilles comprises) ; première tâche à 802 px puis 215 px sur ordinateur, à 1 408 px puis 387 px sur téléphone ; page de 1 169 px puis 908 px sur ordinateur.
**Impact** : `src/pages/Tasks.tsx`, `src/components/tasks/TaskList.tsx` (nouveau : sections, lignes, suggestions, sans lecture), `TasksFiltersBar.tsx`, `useAllReminders.ts` ; les tâches de mission de l'accueil prennent aussi le logo du client (`Dashboard.tsx`, `DashboardTodayPanel.tsx`) ; test `tests/ux/taches-simplicite.test.mjs` (13 tests, job Build de la CI).
**Recette `qa.md`** :
| Persona | Scénario | Verdict |
|---|---|---|
| Guillaume | Lien de ligne vers la fiche, case cochée puis décochée sur place, filtre choisi puis effacé, vue Toutes, suggestions dépliées, confirmation de suppression ; page prête en 2,2 s | PASS |
| Claire | Aucun terme technique ni nom de fournisseur ; « Nouvelle tâche » en haut sans défiler ; suppression par fenêtre de confirmation en français | PASS |
| Théo | Compte vide : état vide, aucun zéro, aucune section vide ; lecture en échec : erreur avec « Réessayer » ; titre très long, emoji et texte de droite à gauche sans débordement | PASS |
| Sophie | Écran tactile 390 px : 38 contrôles, aucun sous 44 px, aucun débordement ; options du menu Filtres à 44 px ; fenêtre de suppression dans l'écran | PASS |
**Reste à faire** :
- [ ] Les suggestions créées ne portent ni mission ni client (l'insertion n'écrit pas `job_id`) : la ligne montre le candidat seul.
- [ ] Bandeau d'essai (hors page Tâches) : « Choisir un plan » (20 px) et « Fermer le bandeau » (36 px) restent sous 44 px sur téléphone.
- [x] Les gardes `lot0c-lectures` (0c-1, jouée par la CI) et `lot12-sourcing` (S-7), cassées sur `main` par le commit 2148cfab (/sourcing refait) : alignées sur la nouvelle page par la PR #264.
**Refs** : docs/design/06-simplicite.md (lot T), maquette « Konekt simplifié ».

## 2026-10-05 — INSIGHT — Spike S1 : le CDN d'images sert la sortie réseau de la base

**Contexte** : le propriétaire a donné son accord pour S1 (télécharger une vingtaine de vraies photos pour savoir si le CDN répond à un centre de données). Le proxy du poste de développement refuse le CDN et le domaine Supabase, donc l'essai est parti de la base de production par `pg_net`.
**Décision / Fait** : 25 adresses valides tirées au hasard (20 petites, 5 grandes), tirées et lancées en SQL sans que la session lise une adresse, sans cookie ni `Referer`, plage d'octets 0-4095. 25 réponses sur 25 en 206, 24 JPEG et 1 PNG. Petites : 1,4 à 41 ko (médiane 5,3 ko) ; grandes : 25 à 131 ko et un PNG de 846 ko. Chemin identique pour 64 des 71 candidats relus avec des adresses différentes. Lignes de réponse de l'essai supprimées ensuite.
**Raison** : la copie côté serveur du lot P dépend de cette réponse ; sans elle, le plan B (image du prestataire de messagerie) s'imposait.
**Impact** : `docs/design/07-photos-lot-p.md` (S1, risques, porte d'activation de P-4). Aucun code, aucune fonction déployée, aucune donnée conservée.
**Reste à faire** :
- [x] Confirmé depuis une fonction le soir même : `capture-candidate-photos` a copié 459 photos (13 h 46 à 22 h 08 UTC) ; 1 176 liens refusés en 403, ce sont les adresses périmées.
- [ ] Les côtés réels en pixels ne sont pas mesurés : la garde lira les octets de tête.
**Refs** : docs/design/07-photos-lot-p.md (P-0, S1).

---

## 2026-10-05 — SHIP — P-0b, garder les adresses de photo fraîches

**Contexte** : première étape du lot P, demandée par le propriétaire (« Oui lance »), livrée après la copie privée des photos d'une autre session (PR #271) qu'elle alimente. Les adresses de photo LinkedIn expirent après quelques semaines et une recherche qui retrouvait une personne connue n'écrivait pas son adresse fraîche.
**Décision / Fait** : migration `20261006132610_photos_lot_p0b_rafraichir_adresses.sql` (`refresh_candidate_pictures`, `candidate_picture_expiry`, `candidate_picture_is_stale`, `candidate_picture_should_replace`) ; `batchDiscover` rafraîchit les adresses des profils de la page ; la découverte garde la grande photo ; la fiche garde la photo en enregistrant le profil visité ; « Retenir » et l'inscription en séquence créent leur ligne avec le profil entier (`src/lib/serializeProfile.ts`). Fusion jsonb côté base, lignes de l'appelant, profil existant seulement, aucune écriture si l'adresse enregistrée est bonne. Une ligne remplacée avance `updated_at`, exprès : `claim_candidate_photos` s'en sert pour relancer une copie expirée.
**Raison** : 82 % des adresses stockées sont expirées ; la production le confirme (1 176 copies refusées en 403 le premier jour de la capture). Un profil réduit à une photo aurait rendu la ligne éligible à la notation de fond, d'où le profil entier.
**Impact** : migration, `src/lib/pictureUrl.ts`, `src/lib/serializeProfile.ts`, `useJobCandidateStatus.ts`, `useLinkedInSearchActions.ts`, `useLinkedInScoring.ts`, `ProfileDetailSheet.tsx`, `EnrollmentPreviewModal.tsx`, `AddToProjectButton.tsx`, `CardActions.tsx`, `types.ts`, audit SQL et `e2e.yml`, `ci.yml`, tests, `CLAUDE.md`, plan du lot P. Coût mesuré en local : 200 lignes en 224 ms, 200 appels d'ingestion en file, aucun recalcul d'embedding.
**QA** : relecture adverse en cinq angles (27 agents) : quatre constats retenus. Corrigés : poids des chunks de la messagerie et du Pipeline (sérialiseur sorti du hook de notation, +17 Ko gzip évités), test avec `esbuild` dans un job sans dépendances (fichier séparé, étape dans le job build), balise `@critical` absente de la spec API. Gardé tel quel et documenté : l'avance de `updated_at` (coût : « Dernière action », portail client, horloge de purge RGPD). Répétition de la migration et de l'audit en transaction sur le schéma de production, annulée proprement.
**Reste à faire** :
- [ ] Relever la part des lignes du Pipeline à adresse valide après quelques jours (3 % avant) et le nombre de copies « expirées » relancées.
- [ ] Décider si le coût sur `updated_at` justifie une colonne dédiée lue par `claim_candidate_photos` (modifie la copie privée).
**Refs** : docs/design/07-photos-lot-p.md (P-0b).

---

## 2026-10-05 — SPEC — Plan du lot P, copie privée des photos des candidats

**Contexte** : le propriétaire demande de préparer le lot P (copie privée des photos LinkedIn, supprimée avec le candidat) après la mise en ligne des visages. Quatre enquêtes en lecture seule (captures, RGPD, stockage, modèle de données) et des comptages sur la production, puis relecture du plan par deux relecteurs.
**Décision / Fait** : plan écrit dans `docs/design/07-photos-lot-p.md` : table `candidate_photos` par organisation et personne, bucket privé `candidate-photos`, liens signés d'une heure, déclencheur d'enfilage et worker de copie sans appel LinkedIn, effacement et purge branchés avant la première copie, sous-lots P-0 à P-7 (P-3 en deux parties). Aucun code livré. Deux relectures indépendantes ont corrigé le premier jet : trace d'effacement (ligne `erased`), course entre effacement et copie, verrou de réclamation, boîte d'envoi des suppressions de fichiers, droits par colonne, périmètre de la copie.
**Raison** : les mesures du 05/10/2026 montrent que 82 % des adresses de photo stockées sont déjà expirées (durée médiane 20 jours entre la création d'une ligne et l'expiration), que 35 des 1 011 personnes du Pipeline ont une adresse valide et que 585 n'en ont aucune ; 27 % des adresses du Pipeline sont déjà expirées à la dernière écriture de la ligne. La copie doit donc se faire au moment où l'adresse est fraîche, et une première étape (P-0b) ferme les pertes d'adresse du navigateur. `rgpd-purge` n'est planifiée nulle part et l'effacement RGPD laisse l'adresse de la photo dans le profil de la ligne.
**Impact** : `docs/design/07-photos-lot-p.md`, `docs/design/README.md`, `docs/design/06-simplicite.md`.
**Reste à faire** :
- [ ] Décisions D1 à D12 du plan (périmètre, durée, planification de `rgpd-purge`, lecture de profil LinkedIn, export des fichiers).
- [ ] Spike S1 avant le 22/10/2026 : tant qu'il reste des adresses valides, vérifier que le CDN répond à une fonction Supabase.
- [ ] Questions au juriste (section 10 du plan).
**Refs** : docs/design/07-photos-lot-p.md.

---

## 2026-10-05 — REFACTOR — Visages des candidats dans le /pipeline global

**Contexte** : après les photos de la page mission, le propriétaire demande les visages dans la partie Pipeline. Le /pipeline global (kanban, tableau, chronologie) n'affichait aucun visage : sa lecture de `mission_candidate_rows` ne portait pas la photo.
**Décision / Fait** : `MCR_DISPLAY_COLUMNS` extrait la photo côté base (`picture`, `picture_large`), `candidateOfMissionRow` la range dans `ATSCandidate.pictureUrl`, et la carte du kanban (28 px), le tableau et la chronologie (32 px) la passent à `PersonAvatar` ; sans photo ou avec un lien expiré, les initiales. Un candidat de séquence ou d'InMail sans ligne de mission n'a pas de photo.
**Raison** : même règle 4 du design simplifié. Mesure sur la base de production le 05/10/2026 (comptages seuls) : 2 375 lignes, 1 551 avec une photo enregistrée (65 %), profil de 9 ko en moyenne, donc la lecture avec la liste reste bon marché. Les candidats sans photo enregistrée gardent leurs initiales tant que le lot P n'a pas rattrapé les profils.
**Impact** : `useATSData.ts`, `ATSCandidateCard.tsx`, `ATSTable.tsx`, `ATSTimeline.tsx` ; test statique `tests/c1/lot0c4-pipeline.test.mjs` (regex des colonnes adaptée à la chaîne typée `string`, TS2589) ; scénario e2e « les visages » de `e2e/flows/stage-0c-lectures.spec.ts` (photo, initiales, lien expiré, carte attrapée par sa photo, tableau, chronologie).
**Reste à faire** :
- [ ] Lot P : copie privée des photos, rattrapage des profils sans photo, effacement RGPD, purge, export.
**Refs** : docs/design/06-simplicite.md (lot P).

---

## 2026-10-05 — REFACTOR — Refonte mission, photos des candidats sur la page mission

**Contexte** : retour du propriétaire après le lot M : des pastilles avec la photo des gens, plus lisibles que des initiales. `PersonAvatar` savait déjà afficher une photo ; la page mission ne lui passait que le nom (le Sourcing, la liste des missions et l'accueil passaient déjà la photo).
**Décision / Fait** : la liste de Pipeline, la section À trier, le kanban et l'en-tête de la fiche affichent la photo LinkedIn déjà enregistrée dans `linkedin_profile_data`, sinon les initiales (aussi pour un lien expiré ou une image qui ne charge pas). `MISSION_ROW_LIGHT_COLUMNS` extrait la photo côté base (`picture`, `picture_large`), jamais le profil entier ; `MissionCandidateRow.pictureUrl` en dérive. Kanban : carte en deux rangées (visage, nom et anneau, puis l'action sur toute la largeur), colonnes de 190 à 224 px, pastille sur le fond de la page pour ne pas se fondre dans la carte. Fiche : photo de la ligne, sinon du profil déjà chargé par la fiche (`candidatePictureUrl`) ; nom sur deux lignes, « N sur M » sous le nom sur téléphone. `PersonAvatar` : `draggable={false}`, comme les autres images du dépôt.
**Raison** : règle 4 de `docs/design/06-simplicite.md` (chaque ligne montre de qui elle parle) ; aucune nouvelle donnée stockée.
**Impact** : `v3/types.ts`, `v3/pipeline/{CandidateListRow,MissionBoard}.tsx`, `v3/panels/CandidatePanelHeader.tsx` ; tests `tests/ux/lot12-mission-beta.test.mjs`, `lot12-pipeline.test.mjs`, scénario e2e « Visages » de `e2e/flows/mission-v3.spec.ts` (photo, repli sur la grande photo, sans photo, lien expiré). Mesure sur la base locale : 2000 lignes de 25 ko de profil, lecture du kanban 17 ms avec ou sans la photo.
**Reste à faire** :
- [ ] Lot P : copie privée des photos (les adresses LinkedIn expirent ; sans copie, les initiales reviennent avec le temps), effacement RGPD, purge, export.
- [ ] Visage dans la carte « Maintenant » (le candidat qui attend) et vrais logos dans le menu des missions.
**Refs** : docs/design/06-simplicite.md (lot P).

---

## 2026-10-05 — REFACTOR — Refonte mission, en-tête de mission et liste des missions allégés

**Contexte** : fin du lot M du design simplifié (`docs/design/06-simplicite.md`) après le Pipeline, le Cadrage et le Sourcing (en ligne sur main depuis ef4d33b). Même méthode : un agent par écran, trois relectures indépendantes (règles de design, non-régression, accessibilité), correction, puis vérification complète.
**Décision / Fait** : en-tête avec le logo du client, statut sans cadre ni point de couleur (déplacé à droite), un seul « Réactiver » sur une mission archivée. Liste des missions avec logo du client, visages des candidats en entretien, aucun zéro écrit, colonnes d'effectifs à partir de 1280 px, menu de ligne au survol, au focus ou au toucher.
**Raison** : zéros partout, « à l'instant » répété sur chaque ligne, aucun logo, pastille de statut encadrée, « Réactiver » en double.
**Impact** : `src/components/missions/v3/shell/**`, `v3/panels/ContactPanel.tsx` (une prop, pour garder un « Réactiver » atteignable dans le panneau plein écran), `outreach/projects/ProjectsListV2.tsx` et ses deux voisins (`missionListFormat.ts`, `useInterviewingPeople.ts`), tests c1 et ux, `e2e/flows/mission-v3.spec.ts`, `stage-0c-lectures.spec.ts`. Aucun calcul de chiffre ne change. Un test du 04/10 (`mission-now`, scénario 10) dépendait de l'heure (7 j avant midi à Paris, 8 j après) : assertion rendue tolérante.
**Reste à faire** :
- [ ] État vide de /missions (`EmptyMissionState`, ancien langage : majuscules, cartes, chiffres marketing).
- [ ] « Réessayer » de `ErrorState` reste un bouton plein à côté de « Nouvelle mission » (composant partagé).
- [ ] Menu des autres missions : le logo n'a que des initiales (les lignes de la barre latérale n'ont pas l'adresse du logo).
- [ ] Photos réelles à la place des initiales (lot P).

---

## 2026-10-04 — REFACTOR — Refonte mission, Cadrage et Sourcing allégés

**Contexte** : suite de l'allègement du Pipeline (retour « trop chargé, on comprend mal »), mêmes règles (`docs/design/06-simplicite.md`, lot M). Travail mené par deux agents en parallèle (un par écran), relu par trois angles indépendants (règles de design, non-régression, accessibilité), puis corrigé.
**Décision / Fait** : Cadrage sans cartes, bandeau d'état en une ligne, contrôles secondaires visibles au survol, au focus ou au toucher, « Qui recrute » sur une ligne, Réglages sans cartes. Sourcing : puces d'état et bascule sans cadre, « Noter les N profils » seul bouton plein, tableau sans carte et colonnes par défaut réduites, vue Détaillé et zone Filtres allégées. Composants partagés avec l'ancienne page modifiés seulement derrière un drapeau (`variant`, `embedded`, `quiet`), rendu par défaut comparé à celui de HEAD par un rendu serveur des composants (aucun écart relevé, mesure des agents).
**Raison** : trois cadres et quarante contrôles au Cadrage, dix colonnes presque vides au Sourcing, jargon (« 18/46 colonnes », phrase technique sur le type d'organisation).
**Impact** : `src/components/missions/v3/cadrage/**`, `v3/sourcing/**`, `SourcingScreen.tsx`, `outreach/search/*`, `LinkedInResultCard`, `VoiceDictation`, `MissionConfigV2` et ses deux sections (`embedded`), `process/shared.tsx`, tests `lot12-cadrage` et `lot12-sourcing`, `e2e/flows/mission-v3.spec.ts`. Vérifié : tsc à la baseline de 11, c1 235, ux 1270, cliquet de dette design en baisse, lint sans nouveau problème.
**Reste à faire** :
- [ ] En-tête de mission et liste des missions (lot M).
- [ ] Mission archivée : « Réactiver » s'affiche deux fois, cibles de 44 px (`ArchivedNotice`, `MissionStateBanner`, hors périmètre des agents).
- [ ] Photos réelles à la place des initiales (lot P).

---

## 2026-10-04 — REFACTOR — Refonte mission, écran Pipeline allégé (retour « trop chargé »)

**Contexte** : après le lot 3, le propriétaire trouve la page mission chargée et difficile à comprendre. Captures du banc local avant et après, direction `docs/design/06-simplicite.md` (lot M, partie Pipeline).
**Décision / Fait** : la carte « Maintenant » garde une phrase, un bouton plein et deux liens ; proposition, règle, « Ensuite » et « Non suivi » passent sous « Pourquoi maintenant ? ». Puces d'étapes sur une rangée sans titres de groupe ni effectif nul. Bilan et Prise de contact sans cadre (icône seule sur téléphone). Liste : visage (initiales), étape avec l'ancienneté dessous, action seulement quand il y en a une, note en anneau, colonne « Depuis » retirée.
**Raison** : trois blocs de texte plus une ligne « Ensuite » au-dessus de la liste, deux titres de groupe, puces et boutons encadrés, « Aucune action depuis 0 j » à chaque ligne.
**Impact** : `src/components/missions/v3/pipeline/` (NowCard, ThenLine, StageBar, PipelineToolbar, CandidateList, CandidateListRow, MissionBoard, ToSortSection), `tests/c1/lot3-ecrans.test.mjs`, `tests/ux/lot12-pipeline.test.mjs`, `e2e/flows/mission-now.spec.ts` (ouvre « Pourquoi maintenant ? » avant de lire la proposition). `rowNextAction` et la règle des rangs inchangées. Vérifié : c1 235, ux 1244, e2e mission-now 16 sur 16 et mission-v3 vert, tsc à la baseline de 11.
**Reste à faire** :
- [ ] En-tête de mission, Cadrage, Sourcing et liste des missions suivent les mêmes règles (lot M).
- [ ] Photos réelles à la place des initiales (lot P).

---

## 2026-10-04 — SHIP — Design simplifié, lot A : l'accueil comme la maquette

**Contexte** : deuxième lot du design simplifié (`docs/design/06-simplicite.md`), après les fondations (PR #258). Le propriétaire a choisi l'accueil « comme la maquette ».
**Décision / Fait** : deux sections. « À faire » : une ligne par chose qui attend (compte LinkedIn à reconnecter, réponses à lire, candidats qui attendent une réponse, candidats qui n'avancent plus), avec visages et lien d'action, puis les tâches en retard sous le réveil et la journée. « Missions en cours » : cinq missions, visages des candidats en entretien, cumuls « au total ». Retirés : cartes des canaux, « Cette semaine », activité récente, « Personnaliser la page ». `PageHeader` : actions sur leur propre ligne sous 640 px. `AvatarStack` : chevauchement de 6 px. Cibles de 44 px sur téléphone.
**Impact** : `src/pages/Dashboard.tsx`, `src/components/dashboard/*`, `PageHeader.tsx`, `person-avatar.tsx`. Retirés : `DashboardConnections`, `DashboardWeekHighlight`, `DashboardActivityFeed`, `DashboardSortableItem`, `Sparkline`, `useDashboardLayout`.
**Recette `qa.md`** (banc local) : Guillaume PASS (liens vers messagerie, analyse, connexions, tâches, agenda et mission ; case cochée sur place ; page prête en 2 s). Claire PASS (aucun terme technique ni nom de fournisseur, « Nouvelle mission » en haut sans défiler). Théo PASS (compte vide : états vides, aucun zéro inventé ; `@critical` multi-tenant vert). Sophie PASS (iPhone 13 : aucun débordement, toutes les cibles de l'accueil à 44 px, cases des tâches comprises).
**Reste à faire** :
- [ ] Photos dans la pile « réponses à lire » : la notification ne porte pas le candidat (lot P).
- [ ] Bandeau d'essai, hors accueil : « Choisir un plan » (20 px) et « Fermer le bandeau » (36 px) sous 44 px sur téléphone.
**Refs** : PR #259.

---

## 2026-10-04 — SHIP — Refonte mission, lots 0c-3 et 0c-4 : écrans de mission, /pipeline, fiches, annulation

**Contexte** : les écrans lisent la vue `mission_candidate_rows` et `get_mission_stage_counts` (lots 0c-1 et 0c-2). Livrés avant le lot 0b-5 (repli « ordre B » du plan 0c).
**Décision / Fait** : un effectif porte le nom de l'étape, un cumul est écrit « au total ». Liste des missions sans « Brief incomplet », kanban avec Retenu et sans profils jamais ouverts, tableau de mission, /pipeline rangé par l'étape générale (même mots que la mission), « Dans cette étape depuis N j » sur `stage_entered_at`, annulation par `undo_candidate_stages`, grille IA qui reçoit le poste et les étapes d'entretien, tableau de bord (« Cette semaine » sur les jalons, activité récente sur l'étape générale). `get_project_stats` et `useProjectStats` n'ont plus de lecteur dans `src/`.
**Impact** : `src/lib/stageDisplay.ts`, `src/lib/candidateStage.ts`, `src/hooks/useATSData.ts`, `MissionPipeline.tsx`, `ProjectsListV2.tsx`, `ATS.tsx`, `ScorecardTab.tsx`, `generate-scorecard`, specs `e2e/flows/stage-0b4-gestes.spec.ts`, `seq-decisions-ui.spec.ts`, `seq-reply-paths.spec.ts` mises aux nouveaux titres, `e2e/api/stage-0c-lectures.spec.ts` (A2 et C ajoutés).
**Reste à faire** :
- [ ] Recette `qa.md` : Guillaume (tableau « écran, libellé, nombre » : liste, kanban, tableau, /pipeline, tableau de bord ; annulation d'un geste), Théo (isolement de la vue, de la fonction et de l'annulation, refus anonyme), Sophie (kanban et liste sur téléphone).
- [ ] Flow e2e `stage-0c-lectures.spec.ts` à rejouer sur la pile locale (`down.sh --reset`).
- [ ] Fenêtre du lot 0b-5 : repart au 04/10/2026, au plus tôt le 09/10/2026 ; journal `jcs_direct_write_log` à lire avant de poser le mode `refuse`.
- [ ] Lot 0c-6 : retrait de `get_project_stats` et `get_multiple_project_stats`, deux semaines au plus tôt après 0c-4.
**Refs** : `docs/refonte-mission/conception.md` section 13.

---

## 2026-07-07 — SHIP — Scoring à deux niveaux : éval. rapide (liste) vs éval. complète (fiche = visite de profil)

**Contexte** : idée de Laurent — le scoring de masse ne dispose que des données de liste (pas de « À propos », pas de descriptions d'expériences) depuis que le robot d'enrichissement est éteint (décision 07/07) ; il affichait pourtant un score faussement précis. Le seul chemin légitime vers les données complètes est la visite de profil que l'user déclenche lui-même.
**Décision / Fait** :
1. **score-profile-job** : body accepte `scoringMode:'deep'` → bypass du cache match_scores + résultat marqué `scoringDepth:'deep'|'quick'` (persisté dans scoring_result et job_candidate_status.scoring_details). Les scores historiques sans le champ = quick.
2. **Fiche candidat (ProfileDetailSheet)** : à l'ouverture (job sélectionné, score pas encore 'deep'), après un délai anti-rafale de 1,5 s → récupère le profil complet (ordre : données déjà en main → linkedin_profile_data persisté SI il passe `looksLikeFullProfileData` (résumé ou description d'expérience — les blobs minces du scoring de masse sont écartés) → sinon get_profile = 1 visite réelle, gated ledger côté serveur) puis `scoreProfile(full, {deep:true})`. Une tentative max par profil ; échecs silencieux ; pas d'auto-dismiss en deep (l'user regarde le profil). La visite persiste le blob complet (écrasement volontaire du blob mince) → les ouvertures suivantes ne re-visitent pas.
3. **UI honnête** : badge « Éval. rapide » / « Éval. complète » + spinner « Analyse complète en cours… » dans le bloc Scoring de la fiche ; coche CheckCircle2 sur le badge score des cartes + tooltips différenciés.
**Garde-fou** : le scoring profond n'est déclenché QUE par l'ouverture manuelle d'une fiche — aucun chemin batch (sinon on recrée le robot d'enrichissement par la porte de devant).
**Impact** : score-profile-job (edge, redéployé via workflow), useLinkedInScoring (scoreProfile options.deep + mapping scoringDepth), JobScoreDisplay (type), ProfileDetailSheet (effet deep + helpers mergeUnipileFullProfile/looksLikeFullProfileData factorisation), SearchResultsPanel + LinkedInSearch (câblage onDeepScoreProfile), CardStatusBadges (badge).
**Reste à faire** :
- [ ] Valider en prod avec Laurent : ouvrir une fiche d'un profil scoré → badge passe de « rapide » à « complète », score potentiellement ajusté.
**Refs** : branche claude/sourcing-filters-visibility-r0zsr8 → main.

---

## 2026-07-07 — SHIP — Bannière reconnexion + InMails cron réparés (enrichissement : en attente de confirmation)

**Contexte** : suite du verdict conflits de session (INSIGHT 2026-07-06). Chantiers du backlog livrés sur feu vert Laurent.
**Décision / Fait** :
1. **Bannière « compte à reconnecter »** : RPC `get_linkedin_reconnect_alerts` (SECURITY DEFINER — agrège search_failure_log qui reste service-role-only ; ≥ 2 `multiple_sessions` en 12 h, scoping org via member_linkedin_accounts → organization_members) + hook `useReconnectAlerts` + composant `LinkedInReconnectBanner` inséré dans LinkedInSearch sous AppliedFiltersBar. Fenêtre « problème actif » = dernier échec < 1 h ; dismiss croix persisté en localStorage par (account, last_failure_at) — un conflit plus récent ré-affiche. CTA → /settings?tab=connectors.
2. **process-inmail-queue mode cron** : Bearer = PROCESS_SEQUENCES_SECRET ou service key → traite les items dus de TOUS les users (quotas heures ouvrées + credentials LinkedIn résolus par user propriétaire, cachés par run) ; mode JWT user inchangé (scopé caller). Avant : `validateUser()` → 400 à CHAQUE cycle de 3 min (58 occurrences sur 3 h observées en prod), les InMails planifiés ne partaient jamais d'eux-mêmes. Ajout de la sérialisation par compte (cooldown 5 min après toute action `manual_*` du ledger), identique à process-enrichment-queue.
3. **Enrichissement — décision : reste ÉTEINT.** Kill-switch vérifié en prod (86 réponses `paused:true` sur 3 h), garde-fous prêts (sérialisation par compte, heures ouvrées, caps ledger, 3 items/run espacés de 12 s). Le garde-fou de sécurité de session a exigé une confirmation nominative (compte post-suspension — un feu vert générique ne suffit pas) → question explicite posée à Laurent avec explication du rôle du worker → réponse : « Non, laisse-le éteint ». Flag `true` conservé, ne réactiver que sur demande explicite. Les ~17 items pending de profile_enrichment_queue restent sans effet ; les scores continuent de se baser sur les données de recherche seules.
**Impact** : migration 20260706234500_linkedin_reconnect_alerts.sql, supabase/functions/process-inmail-queue, src/components/outreach/LinkedInSearch.tsx, src/hooks/useReconnectAlerts.ts, src/components/outreach/search/LinkedInReconnectBanner.tsx, types.ts (RPC).
**Reste à faire** :
- [ ] Vérifier le 07/07 matin : cron inmail répond 200, les 4 InMails Numspot en file depuis le 30/06 partent aux heures ouvrées (annulables avant depuis l'app si devenus obsolètes).
**Refs** : branche claude/sourcing-filters-visibility-r0zsr8 → main.

---

## 2026-07-06 — INSIGHT — Verdict conflits de session : compte Recruiter mono-session, reconnexion en méthode cookie requise

**Contexte** : après extinction du worker enrichissement (innocenté pour la journée — le ledger ne montre QUE des actions manuelles sur le compte), les échecs persistaient même onglets LinkedIn fermés. La boîte noire `search_failure_log` a capturé l'erreur exacte à 16:53 UTC.
**Décision / Fait** : 401 `errors/multiple_sessions` avec le message provider complet : « LinkedIn limits the use of multiple sessions on certain Recruiter accounts. […] causing a popup to appear in the user's browser, prompting them to choose a session […] **To avoid this error, use the cookie connection method.** » → le compte Recruiter de Laurent est soumis à la politique mono-session LinkedIn ; connecté au provider en **credentials** → session dédiée côté provider → conflit structurel avec toute session navigateur (+ popup LinkedIn côté user pouvant déconnecter le compte). **Remède : reconnecter le compte en méthode cookie (li_at)** — le provider réutilise alors la session du navigateur, plus de deuxième session. Toast conflit mis à jour avec ce remède (CTA → Réglages → Connecteurs).
**Note annexe** : `process-inmail-queue` répond 400 à CHAQUE cron (toutes les 3 min) : la branche `action=process` appelle `validateUser()` (scopée user, `.eq("created_by", user.id)`) alors que le cron s'authentifie avec le secret → throw → 400. Les InMails planifiés ne partent donc JAMAIS via le cron (seulement quand un user déclenche depuis l'app). Bug séparé, à corriger (mode cron multi-users).
**Impact** : search_failure_log (nouvelle table diagnostic, purge 14 j), useLinkedInSearchActions (toast remède).
**Reste à faire** :
- [x] Laurent reconnecte le compte en méthode cookie → CONFIRMÉ le 06/07 22:43 UTC : reconnexion avec cookies frais (li_at + li_a — il était DÉJÀ en méthode cookie, mais import du 02/06 devenu obsolète après rotation de session navigateur) → 5 recherches OK d'affilée, 45 profils trouvés, zéro ligne search_failure_log. Règle opérationnelle : ré-importer les cookies après chaque re-login navigateur ; piste produit : bannière « compte à reconnecter » quand la boîte noire voit ≥2 multiple_sessions
- [x] Fix process-inmail-queue mode cron → livré le 07/07 (cf. SHIP 2026-07-07)
- [x] Décision réactivation enrichissement → tranchée le 07/07 : reste ÉTEINT (choix explicite de Laurent après explication du rôle du worker ; cf. SHIP 2026-07-07)

---

## 2026-07-06 — BUG — Vrais conflits de session : le worker enrichissement jamais mis en pause en prod (suspicion forte)

**Contexte** : après le fix de classification, Laurent relance → le VRAI toast conflit de session s'affiche (multiple_sessions authentique). Quelque chose utilise son compte LinkedIn en parallèle des recherches manuelles.
**Décision / Fait** : le kill-switch `ENRICHMENT_PAUSED=true` (commit 24f5e4b du 2026-06-02, motivé par EXACTEMENT ce symptôme) **n'a jamais été déployé** — cause identifiée : le workflow deploy-edge-functions avait un bug silencieux entre le 2026-05-20 (création) et le 2026-06-11 (fix d1e1dd4 « cassait sur les pushes multi-commits » : diff sur clone shallow → `|| true` → RIEN ne se déployait). Le commit #205 est tombé pile dans cette fenêtre. Pendant un mois, la version ACTIVE du worker a consommé la session Recruiter (profile_views de fond toutes les 2 min, exécutions 0,6-11,2 s dans les logs) → collisions avec les recherches manuelles. Fait : (1) sérialisation par compte implémentée — avant chaque item, check `linkedin_action_log` source manual_* < 5 min → report +5 min sans consommer de tentative ; (2) flag pause conservé ; (3) **déployé en prod via le workflow auto (run 28798669886, « Deployed: 1, Failed: 0 », 2026-07-06 14:23 UTC)** — le robot est coupé.
**Impact** : supabase/functions/process-enrichment-queue/index.ts (déployé). Leçons : (a) tracer chaque déploiement d'edge function ; (b) le MCP Supabase down n'empêche pas de déployer — workflow_dispatch/push de deploy-edge-functions.yml fait le job.
**Reste à faire** :
- [ ] Quand le MCP Supabase revient : confirmer dans les logs (durées → ms) + ledger linkedin_action_log autour des échecs (confirmer l'acteur, regarder aussi process-inmail-queue qui répond 400 en boucle)
- [ ] Décision produit : réactiver l'enrichissement (ENRICHMENT_PAUSED=false) maintenant que la sérialisation protège l'usage interactif — à valider avec Laurent (compte sensible post-avertissement)

---

## 2026-07-06 — BUG — Faux « Conflit de session LinkedIn » : « unable to process » mal classé

**Contexte** : sur certaines combinaisons de filtres (générés IA notamment), le toast « Conflit de session LinkedIn » s'affiche alors que le dashboard provider montre les comptes Running, rien d'anormal. Corrélation nette avec les filtres, pas avec le compte.
**Décision / Fait** : `useLinkedInSearchActions` classait TOUT message contenant « unable to process » comme multiple_sessions (ligne 989). Or « Unable to process… » est le message générique du provider quand LinkedIn REJETTE la recherche (payload trop lourd, combinaison de filtres invalide) — aucun rapport avec un conflit de session. Fix : (1) classification conflit de session restreinte à errorType/message multiple_sessions ; (2) nouveau branch « unable to process » → toast actionnable « LinkedIn n'a pas pu traiter cette recherche — retire un critère ou raccourcis les mots-clés » ; (3) texte du vrai toast conflit adapté sur /sourcing (l'onglet « Base de données » n'y existe pas). Le prochain échec réel montrera le bon diagnostic ; les logs edge (« Search error: » + « Request body was: ») permettront d'identifier le filtre exact rejeté.
**Impact** : useLinkedInSearchActions uniquement (pas de redéploiement edge).
**Reste à faire** :
- [ ] Quand le cas se reproduit : lire les logs unipile-search pour identifier la combinaison de filtres rejetée et la corriger à la source (mapping buildSearchParams)

---

## 2026-07-06 — BUG — Recherche : « Unexpected token < » + faux avertissement « Brief peu détaillé »

**Contexte** : premier test réel du flux prompt par Laurent — deux messages anormaux au lancement de la recherche.
**Décision / Fait** : (1) « unexpected HTML » : logs prod → un POST unipile-search 500 après ~7 s ; cause = `data = await response.json()` non protégé (ligne 1042) quand la passerelle LinkedIn renvoie une page HTML (502/504 maintenance) → SyntaxError brute propagée jusqu'au toast. Fix : parse défensif (text → JSON.parse try/catch), réponse invalide traitée comme transitoire (retry avec les délais existants 0/6/15 s), message propre « Le service LinkedIn a renvoyé une réponse invalide » ; + filet côté front (useLinkedInSearchActions) qui humanise tout message contenant unexpected token/doctype/html. Fonction déployée v29. Les ~14 autres `response.json()` de la fonction restent non gardés (actions non-search) — le filet front les couvre. (2) « Brief peu détaillé — complétez le brief » sur une recherche sans brief : le job synthétique n'avait que le titre. Fix : le prompt est maintenant persisté en `description` du sourcing_project → devient la description du job synthétique (l'avertissement ne se déclenche plus + le scoring reçoit tout le contexte du prompt) ; et les messages de garde de handleSearch sont adaptés quand kind='search' (« décris ta cible via le Prompt IA » au lieu de « complétez le brief »).
**Impact** : supabase/functions/unipile-search/index.ts (v29 prod), useLinkedInSearchActions, PromptSearchHero.
**Refs** : logs edge-function 2026-07-06 13:26 UTC (POST 500, 6977 ms)

---

## 2026-07-06 — SHIP — Recherche par prompt sur /sourcing : hero IA « Décris qui tu cherches »

**Contexte** : retour fondateur immédiat après le ship /sourcing — le champ « Que cherches-tu ? » laissait croire à une recherche par prompt (« ça marche mal », « l'UX pourrait être beaucoup mieux fait ») alors qu'il ne faisait que renommer.
**Décision / Fait** : vrai flux prompt → filtres. Nouveau `PromptSearchHero` (src/components/sourcing/) affiché tant qu'aucun filtre n'existe : textarea langage naturel + 3 exemples cliquables + « Générer la recherche ». Appelle `generate-search-filters` via invokeWithCredits (action `filter_generation`, prompt entier dans job.description comme le Brief IA de CreateProjectModal), persiste `filters_snapshot = { ...data.filters, suggestions, brief_text, generated_at }` (spread top-level — PAS la réponse entière, cf. bug du tool agent regenerate_search_filters) + `name`/`job_details.title` = `analysis.suggested_title` → le scoring se débloque tout seul. L'hydratation existante (deps [id, filters_snapshot], snapshotKey=generated_at) applique les filtres au panneau sans plumbing. Boutons « Prompt IA » (ré-ouvrir, prompt pré-rempli, warning remplacement) et « Configurer manuellement » (skip). Bonus : (1) fix hydratation Branch B — `skills_keywords`/`industry_keywords` n'étaient PAS copiés dans le state au rechargement (chips perdues aussi côté missions) ; (2) SearchWelcomeMessage variante standalone (l'étape « Sélectionnez un poste dans le panneau de gauche » n'existe pas ici).
**Impact** : PromptSearchHero (nouveau), SourcingSearch, useLinkedInSearch (2 mappings), SearchResultsPanel (variante welcome).
**QA** : tsc + build OK ; navigateur 22/22 (hero à la création, exemple cliquable, payload generate-search-filters, PATCH snapshot+titre, hydratation FILTRES=4 + chips, champ intitulé auto-rempli, ré-ouverture prompt pré-rempli, skip manuel, liste renommée, transformation mission intacte).
**Reste à faire** :
- [ ] Auto-lancer la recherche post-génération (bloqué par la résolution asynchrone de la localisation — pendingLocationRef ; à faire proprement ou pas du tout)
- [ ] FilterReviewModal (validation avant application) — volontairement pas branché : il perd company/school/spotlight/open_to_work
**Refs** : contrat complet generate-search-filters documenté dans l'entry (input job structuré, output filters/analysis/suggestions/power_filters)

---

## 2026-07-06 — SHIP — Recherche autonome (/sourcing) : sourcer sans créer de mission

**Contexte** : le sourcing n'existait que dans une mission ; Laurent veut chercher librement et ne créer la mission que quand la recherche devient sérieuse.
**Décision / Fait** : une recherche autonome EST un sourcing_project léger `kind='search'` (colonne + CHECK + index, migration 20260706130611, appliquée en prod) — toute la machinerie mission (filters_snapshot, job_candidate_status keyé project:{id}, stats triggers, quotas LinkedIn et crédits IA côté serveur) fonctionne sans duplication. Pages : /sourcing (liste des recherches — cards avec stats, suppression AlertDialog, nom auto « Recherche du 6 juillet, 14h32 ») et /sourcing/:id (champ « Que cherches-tu ? » → job_details.title + name, LinkedInSearch monté tel quel, bouton « Transformer en mission » = UPDATE kind+name → workspace mission avec candidats/filtres/statuts déjà en place, zéro migration de données). Entrée sidebar « Recherche » + palette ⌘K. Garde-fous : scoring bloqué tant que la cible n'est pas définie (`scoringDisabledReason`), pré-check « brief incomplet » neutralisé pour les recherches (`skipBriefCheck`), SourcingReadinessPanel (qui parle du brief) remplacé par le welcome générique, useQuotaGate ne compte plus les recherches dans max_jobs, listes missions filtrées kind='mission' (`useSourcingProjects(kind)`).
**Raison** : audit préalable (2 sub-agents) — le seul vrai verrou était le selectedJob (recherche+scoring) ; réutiliser l'objet mission évite un 2e système de persistance et rend la conversion instantanée. Audit quotas : tous les mécanismes (member_quotas, ledger linkedin_action_log, rate limit, crédits IA) sont keyés compte/user/org, jamais mission → aucun contournement possible depuis la page autonome.
**Impact** : useSourcingProjects, useLinkedInScoring, LinkedInSearch, SearchResultsPanel, useQuotaGate, App.tsx, AppSidebar, NavigationPalette, pages/SourcingSearches + pages/SourcingSearch, types.ts, migration SQL.
**QA** : tsc + vite build OK ; harnais navigateur 12/12 (liste vide, création → workspace, welcome générique sans panneau brief, PATCH title+name au blur, liste renommée, dialog transformation préremplie, PATCH kind=mission → /missions/:id).
**Reste à faire** :
- [x] Pré-remplissage IA des filtres depuis le champ cible (réutiliser generate-search-filters) — fait le jour même, voir entry suivante
- [ ] Tuto vidéo de l'écran Recherche
- [ ] Option : masquer les panneaux séquences/enrollment dans une recherche (fonctionnels mais orientés mission)
**Refs** : supabase/migrations/20260706130611_sourcing_projects_kind.sql

---

## 2026-07-02 — SHIP — Tutos vidéo in-app : popup d'aide + studio de tournage Playwright

**Contexte** : Laurent veut des popups d'aide avec vidéos tuto courtes où l'on voit la souris naviguer.
**Décision / Fait** : (1) composant générique `TutorialVideoDialog` (bouton « ? » → Dialog avec vidéo autoplay muted loop + points clés) — chaque écran peut monter son tuto ; premier montage : header Pipeline (« Le pipeline en 30 secondes », public/tutos/pipeline-tour.webm, 2,1 Mo / 27 s). (2) Studio de tournage : harnais Playwright (app réelle + Supabase intercepté, mocks STATEFUL pour que le drag persiste à l'écran) + recordVideo, curseur factice injecté (suivi mousemove, ripple au clic) + barre de sous-titres injectée pilotée depuis le script. Scénario : funnel → clic tuile → drag Sarah vers Entretien technique (toast) → fiche candidat → outro. Sortie webm VP8 (le ffmpeg Playwright n'a pas libx264 — pas de mp4 ; lisible partout sauf très vieux Safari).
**Raison** : onboarding visuel sans dépendance à un outil externe (Loom etc.) — reproductible à chaque évolution d'écran en relançant le script.
**Impact** : src/components/help/TutorialVideoDialog.tsx, MissionPipeline (montage), public/tutos/.
**Reste à faire** :
- [ ] Tuto sourcing (pills, toggle À l'écoute) avec le même studio
- [ ] Pièges de tournage documentés : cibler les cartes par classe (le toast sonner peut porter le même texte), attendre la disparition des toasts, scrollIntoViewIfNeeded avant clic (sinon clic sidebar)
**Refs** : MissionPipeline.tsx, TutorialVideoDialog.tsx

---

## 2026-07-02 — SHIP — Vue Pipeline mission : données réparées (project_id, RPCs) + refonte DA v2

**Contexte** : Pipeline débloqué le même jour → l'user découvre une vue quasi vide et restée en DA brutaliste.
**Décision / Fait** : (1) job_candidate_status.project_id NULL sur 1352/1398 lignes (le sourcing ne le remplissait jamais) alors que useProjectCandidates filtre dessus → trigger BEFORE auto-résolution depuis job_id + backfill + index partiel ; (2) les 3 RPCs de 20260309170900 (get_project_stats…) n'existaient PAS en prod — jamais rejouées après le repair tracking-only de la désynchro migrations → re-créées avec fix (untreated='discovered', pas 'untreated') et gardes org (SECURITY DEFINER non borné = fuite cross-tenant) ; (3) refonte MissionPipeline en DA v2 (pills segmentées, colonnes/cartes arrondies, casse normale, suppression du double cadre) + colonne « Contacté » dans le kanban dynamique (les messaged/replied étaient noyés dans « Sourcé ») + table : hauteur viewport (350px fixes), statuts replied/scored/discovered affichés, token mort hover:text-linkedin.
**QA** : dry-run transactionnel prod (rollback) : backfill 46→1398, pipeline f0bf=434 candidats, trigger OK ; harnais Playwright avant/après PASS ; tsc+build OK.
**Itération 2 (même jour, « pas ouf, fais mieux »)** : refonte command-center issue d'un panel de 3 directions design + juge — command bar avec funnel actionnable (compteurs font-display + taux de passage entre étapes, tuiles cliquables qui scrollent vers la colonne), système de staleness (badge global « X sans mouvement +7j », compteur par colonne, âge orange sur carte), avatars initiales (hash nom→palette brand), thème sémantique des colonnes (Contacté=info, Embauché=success — plus de couleurs positionnelles), cartes denses avec LinkedIn au hover, board pleine hauteur (100dvh), toasts nominatifs (« X embauché ! »), perf 400 cartes (React.memo + content-visibility). dnd-kit inchangé.
**Itération 3 (retour fondateur : cartes non ouvrables = « nul »)** : clic sur une carte kanban → CandidateDetailModal (le modal riche de l'ATS : profil, évaluation, CV, séquences, messages, notes, rappels) avec nouvelle prop `stageOptions` pour utiliser les étapes de LA mission dans le sélecteur (au lieu des ATS_STAGES hardcodés) ; garde anti-clic-fantôme post-drag (dragHappenedRef) ; colonnes fluides flex-1 min/max-w (fini la moitié d'écran vide) ; `.thin-scrollbar` (index.css) sur colonnes + board ; CTA « Contacter les candidats » (→ tab outreach) dans la colonne Contacté vide.
**Itération 4 (question fondateur : « pourquoi pas les mêmes étapes ? »)** : sans étapes de process configurées, le board tombe sur les colonnes génériques sans l'expliquer → bannière « Board générique — définissez vos étapes d'entretien » avec CTA → tab process, affichée seulement si steps.length===0 et des candidats existent. Vérifié au navigateur (bannière, absence avec steps, navigation CTA).
**Reste à faire** :
- [ ] Persister viewMode kanban/table (localStorage) si demandé
- [ ] Insights : vérifier ce qu'il affiche maintenant que project-candidates remonte des données
- [ ] Fiche candidat : « Postes liés » affiche le job_id brut (project:{uuid}) quand pas de titre — mapper vers le nom de mission (useCandidateFullProfile)
**Refs** : migration 20260702164207, MissionPipeline.tsx, ProjectCandidatesTableEnhanced.tsx

---

## 2026-07-02 — SHIP — Filtres sourcing (À l'écoute/Shortlist), visibilité contactés, déblocage Pipeline

**Contexte** : UX sourcing dégradée — impossible de filtrer les profils à l'écoute, de retrouver ses shortlistés/contactés ; phase Pipeline grisée malgré l'activité réelle.
**Décision / Fait** : (1) pills Shortlist + toggle « À l'écoute » (spotlight OPEN_TO_WORK serveur — l'API search ne renvoie JAMAIS le flag par profil, vérifié 0/1213 en base) ; (2) useJobCandidateStatus lit les 2 formes de job_id (`project:{uuid}` et nu — l'inscription séquence normalise, le sourcing préfixait → contactés invisibles) ; (3) pills DB embarquent le pool même en vue Résultats ; (4) trigger SQL sync stats_* mission + backfill (colonnes jamais mises à jour → readiness verrouillait Pipeline à vie) ; (5) add-to-shortlist écrit enfin job_candidate_status (upsert par candidate_id, match URL par slug ; avant : UPDATE par URL stricte = 0 match, et rien du tout si Notion absent) ; pill Shortlist matche aussi la shortlist Notion par nom.
**Impact** : useLinkedInSearch, useFilteredResults, useJobCandidateStatus, useLinkedInSearchActions, LinkedInSearch, SearchResultsPanel, edge add-to-shortlist, migration 20260702121429.
**QA** : préflight tsc+build OK ; persona Guillaume (sourcing) couvert par harnais Playwright (app réelle, Supabase intercepté, 16+22 checks PASS) ; migration validée par dry-run transactionnel sur schéma prod (rollback).
**Reste à faire** :
- [ ] `supabase functions deploy add-to-shortlist` après merge
- [ ] Vérifier le workflow deploy-migrations sur le push main (backfill → Pipeline débloqué)
- [ ] Générer le spec e2e sourcing live (test.fixme du socle QA)
**Refs** : 9f71dff, 08aa113, 0de9097, 7a1298e (branche claude/sourcing-filters-visibility-r0zsr8)

---

## 2026-04-27 — SECURITY — QA 4 personas sur feature enrichment, fix sécurité multi-tenant

**Contexte** : Sprint 1+2+3 enrichment (cascade lookup + bulk + permissions + RGPD + analytics) déployés en prod sans avoir lancé `/qa` 4 personas — manquement à la skill `qa.md` "Obligatoire avant tout deploy en prod". Laurent m'a recadré → audit rétroactif lancé.

**Décision / Fait** :
- QA Théo a révélé 1 trou de sécurité CRITIQUE : `get-enrichment-status` faisait un fallback BC direct si la row n'existait pas en DB → un user pouvait brute-force des `request_id` BC valides et récupérer les emails/phones d'enrichments d'autres orgs. Fix : suppression du fallback, refus strict 404 si row absente.
- Théo bug #2 : pas de rate limit sur `get-enrichment-status` (polled 5s). Fix : ajout `check_rate_limit` 60 req/min/user.
- Théo bug #3 : double-clic sur `EnrichContactButton.handleConfirm` possible. Fix : `submitting` state + early return guard.
- Guillaume bug : `INSUFFICIENT_CREDITS` ou `QUOTA_EXCEEDED` ne stoppait pas le bulk → 70 erreurs 402 inutiles. Fix : `aborted` flag + skip workers restants + toast d'erreur explicite.
- Guillaume UX : pas de progress UI pendant le bulk. Fix : `toast.loading` updated tous les 5 profils.
- Claire bug : "cascade de fournisseurs" + "Background" anglais visibles dans modale. Fix : "plusieurs sources de données vérifiées" + "Arrière-plan".
- Sophie : modale `max-w-md` ok sur iPhone 13 portrait, pas de fix nécessaire.

**Raison** : sécurité multi-tenant non négociable, le reste UX.

**Impact** :
- `supabase/functions/get-enrichment-status/index.ts` : refus strict no-row + rate limit
- `src/components/outreach/result-card/EnrichContactButton.tsx` : submitting guard + textes FR
- `src/components/outreach/result-card/BulkEnrichButton.tsx` : aborted flag + progress toast

**Reste à faire** :
- [ ] Lancer /qa systématiquement avant chaque commit prod (pas après)
- [ ] Écrire tests unitaires pour `_shared/get-or-fetch-contact.ts`, `parseBoolean`, `cleanLocationPart`
- [ ] UI admin Settings>Équipe pour modifier `can_enrich_contacts` + `enrichment_quota_monthly` per-user (actuellement faut SQL editor)
- [ ] Webhook BC au lieu de polling (perf)

**Refs** : commit à venir (post-fixes)

---

## 2026-04-21 — SHIP — Migration Lovable → Vercel + Supabase achevée

**Contexte** : bascule du backend Konekt de Lovable Cloud vers un projet Supabase self-managed (`konekt-production`, ref `crckfywoyjxkawathdff`, West EU Ireland), frontend repositionné sur Vercel (https://konekt-app-navy.vercel.app). L'onboarding était cassé en prod sur "permission denied for table organizations", 0 secrets Supabase configurés, deploy des edge functions bloqué.

**Décision / Fait** :
- Schéma Supabase importé (88 tables, 194 policies RLS, 3 plans seed) — fichier `MIGRATION_CLEAN.sql` gardé à la racine comme référence.
- Bug RLS résolu : root cause = GRANTs manquants à la role `authenticated` (schema importé sans les privileges standard Supabase). Fix appliqué via `fix-organizations-rls.sql` : GRANT SELECT/INSERT/UPDATE/DELETE sur toutes les tables public + default privileges pour les futures.
- Deploy des edge functions débloqué : suppression du bloc `[functions.copilot]` orphelin dans `supabase/config.toml` (dossier inexistant) + correction du `project_id`. **77/77 fonctions déployées** sans erreur.
- Inventaire complet des secrets requis (26 secrets au total dont 6 critical, 8 important, 12 optional) — détail dans CLAUDE.md section "Supabase secrets".
- Vercel SPA rewrites déjà commit précédent (`vercel.json`).

**Raison** : sortir de la dépendance Lovable avant le weekend 2026-04-25 pour avoir un stack full-contrôlé (git → Vercel + Supabase CLI).

**Impact** :
- `CLAUDE.md` : nouvelle section stack + infra + runbook hotfix + liste secrets + auth URL config.
- `supabase/config.toml` : `project_id` → `crckfywoyjxkawathdff`, bloc copilot retiré, note auth URL config.
- `supabase/migrations/20260309170000_invalidate_match_scores_on_job_update.sql` : no-op (la table `public.jobs` n'existe pas dans le nouveau schéma).
- `fix-organizations-rls.sql` : nouveau, à rejouer si un reset/restore casse les grants.
- Frontend : ~zéro changement, branche main auto-deploy Vercel.

**Reste à faire** :
- [ ] Setter les 6 secrets CRITICAL dans le Dashboard Supabase : `ANTHROPIC_API_KEY`, `LOVABLE_API_KEY`, `OPENAI_API_KEY`, `UNIPILE_API_KEY`, `UNIPILE_DSN`, `NOTION_API_KEY` (+ 3 `NOTION_*_DB_ID`), `STRIPE_SECRET_KEY`.
- [x] Configurer Site URL + Redirect URLs dans le Dashboard Auth.
- [ ] Setter les secrets IMPORTANT (Apollo, PDL, webhooks) pour débloquer enrichissement et webhooks.
- [x] Tester onboarding end-to-end — débugging complet des 3 bugs RLS/triggers (voir 2026-04-21-bis).
- [ ] Rejouer un premier scoring LinkedIn pour valider la chaîne Unipile + score-profile-job.

**Refs** : commits à venir sur main — voir `git log` après push.

---

## 2026-04-21 — REFACTOR — Sortie totale de Lovable (emails → Resend)

**Contexte** : Après la migration AI Gateway Lovable → Anthropic direct, il restait 3 fonctions email qui dépendaient encore de Lovable (SDK `@lovable.dev/email-js` + webhooks `@lovable.dev/webhooks-js`). Objectif : couper totalement Lovable.

**Décision / Fait** :
- `process-email-queue` : remplace `sendLovableEmail` par fetch direct à l'API Resend (`https://api.resend.com/emails`). Gère 429 (Retry-After), 401/403 (auth → DLQ immédiat), 422 (validation → DLQ), autres erreurs (log + VT retry). Ajoute `Idempotency-Key` + `List-Unsubscribe` RFC 8058 + `X-Entity-Ref-ID`. Log enrichi avec `{provider: 'resend', resend_email_id}` dans metadata.
- `preview-transactional-email` : remplace l'auth `LOVABLE_API_KEY` par comparaison `token === SUPABASE_SERVICE_ROLE_KEY`. La fonction rend juste les templates React Email, n'envoie pas.
- `handle-email-suppression` : réécrit pour le format Resend webhook (événements `email.bounced`, `email.complained`, `email.delivery_delayed`). Verification de signature Svix (HMAC-SHA256 sur `${svix-id}.${svix-timestamp}.${body}` avec `whsec_<base64>`, rejet si timestamp > ±5 min). Mapping vers `suppressed_emails.reason` ('bounce' / 'complaint'). Unsubscribes restent gérés par `handle-email-unsubscribe` (endpoint One-Click déjà existant).
- Nouvelle migration `20260421200000_suppressed_emails_unique.sql` : ajout UNIQUE sur `suppressed_emails.email` (nécessaire pour l'upsert `onConflict: 'email'`).
- 3 fonctions redéployées, 0 erreur.

**Raison** : simplification de la stack, élimination de la dépendance Lovable, control total de la delivery (domaines vérifiés côté Resend, logs consultables).

**Impact** :
- `supabase/functions/process-email-queue/index.ts` : réécriture complète, fetch direct Resend.
- `supabase/functions/preview-transactional-email/index.ts` : auth guard changé.
- `supabase/functions/handle-email-suppression/index.ts` : réécriture complète pour webhook Resend/Svix.
- `supabase/migrations/20260421200000_suppressed_emails_unique.sql` : nouveau.
- `CLAUDE.md` : `RESEND_API_KEY` + `RESEND_WEBHOOK_SECRET` ajoutés, `LOVABLE_API_KEY` retiré partout.

**Reste à faire** :
- [ ] Setter `RESEND_API_KEY` dans les secrets Supabase.
- [ ] Vérifier le(s) domaine(s) d'envoi dans le dashboard Resend (sinon emails depuis `@konekt.fr` refusés).
- [ ] Configurer le webhook Resend Dashboard → Webhooks : endpoint = `https://crckfywoyjxkawathdff.supabase.co/functions/v1/handle-email-suppression`, cocher events `email.bounced` + `email.complained`, récupérer le `whsec_xxx` → setter comme `RESEND_WEBHOOK_SECRET`.
- [ ] Tester un envoi bout en bout : créer une invitation d'équipe → vérifier réception + log `email_send_log` avec `status=sent` + `metadata.provider='resend'`.

**Refs** : commit à venir. Fichiers clés : `process-email-queue/index.ts`, `handle-email-suppression/index.ts`.

---

## 2026-04-21 — REFACTOR — Sortie de Lovable AI Gateway, passage à Anthropic direct

**Contexte** : 16 fonctions edge appelaient le Lovable AI Gateway (`https://ai.gateway.lovable.dev/v1/chat/completions`) avec `LOVABLE_API_KEY` pour utiliser principalement Google Gemini 2.5 Flash / 3 Flash Preview. Laurent veut couper la dépendance à Lovable post-migration Supabase.

**Décision / Fait** :
- Nouveau helper `supabase/functions/_shared/call-claude.ts` : drop-in replacement qui prend le même payload (messages, tools, tool_choice, response_format, temperature, max_tokens) et le convertit en appel Anthropic Messages API directe. Gère retries 429/529, timeout, JSON mode (via consigne system), tool use (conversion OpenAI ↔ Anthropic).
- Migration des 16 fonctions : ai-chat-completion, analyze-linkedin-profile, analyze-response, audit-employer-brand, auto-categorize-chats, detect-profile-fraud, enrich-company (8 blocs tools), fetch-notion-jobs, generate-call-report, generate-recruiter-bio, generate-scorecard, live-coach, nurturing-analyzer, process-debrief, screen-candidate.
- Modèle par défaut : `claude-haiku-4-5-20251001` (aussi rapide que Gemini Flash, meilleur pour reasoning/extraction).
- `LOVABLE_API_KEY` toujours utilisé par 3 fonctions email (`process-email-queue`, `preview-transactional-email`, `handle-email-suppression`) — service Lovable Email, à migrer séparément (Resend/Postmark/SES selon choix).
- Les 15 fonctions AI redéployées, 0 erreur. `enrich-company` = le plus gros morceau (~1900 lignes, 8 blocs tools convertis).

**Raison** : 1 seul vendor AI (Anthropic) simplifie la gestion des clés et aligne avec CLAUDE.md qui préconise déjà Claude Sonnet/Haiku. Élimine un middleman.

**Impact** :
- `supabase/functions/_shared/call-claude.ts` (nouveau, ~200 lignes).
- 15 fonctions edge modifiées.
- `CLAUDE.md` : section secrets mise à jour, `LOVABLE_API_KEY` déplacé de CRITICAL vers "DEPRECATED — à migrer" (pour les emails uniquement).

**Reste à faire** :
- [ ] Setter `ANTHROPIC_API_KEY` dans les secrets Supabase pour que tout marche.
- [ ] Décider du provider email de remplacement (Resend par défaut) et migrer les 3 fonctions restantes.
- [ ] Valider un scoring LinkedIn + un audit employer-brand pour vérifier que la chaîne Claude fonctionne en prod.

**Refs** : commit à venir. Fichier clé : `supabase/functions/_shared/call-claude.ts`.

---

## 2026-04-21 — BUG — Onboarding org creation : 3 bugs en cascade (RESOLVED)

**Contexte** : après la migration Supabase, la création d'organisation pendant l'onboarding échouait avec "new row violates row-level security policy for table organizations". Symptôme côté UI : impossible de passer l'étape "Parlez-nous de vous" (scene org).

**Décision / Fait** : 3 bugs distincts découverts en cascade pendant le debug, tous patchés dans `fix-organizations-rls.sql` :

1. **GRANTs manquants** (fix initial) — la role `authenticated` n'avait aucun privilège sur les tables `public.*`. Fix : GRANT SELECT/INSERT/UPDATE/DELETE à authenticated + default privileges.

2. **Catch-22 enforce_role_hierarchy** — le trigger `handle_new_organization` (AFTER INSERT) tentait d'ajouter le créateur comme 'owner' dans `organization_members`, mais le trigger BEFORE `enforce_role_hierarchy` bloquait : "Only owners can assign the owner role". Or personne n'est owner d'une org qui vient d'être créée. Fix : ajout d'une clause bootstrap dans `enforce_role_hierarchy` — laisser passer si c'est le tout premier membre de l'org ET que le user = created_by de l'org.

3. **UNIQUE constraint manquante sur ai_credit_balances** — la fonction `sync_credit_balance_from_subscription` fait `ON CONFLICT (organization_id) DO UPDATE` mais la contrainte UNIQUE n'existait pas → cascade de triggers cassée à la création d'org. Fix : `ADD CONSTRAINT ... UNIQUE (organization_id)`.

4. **Race condition sur members_select / RETURNING** — `INSERT ... RETURNING *` via supabase-js évaluait `is_org_member(auth.uid(), id)` pour le RETURNING, mais à un moment où le trigger AFTER n'avait pas encore inséré le user dans `organization_members` (ou visibility glitch PostgREST). Résultat : erreur RLS bien que l'INSERT ait réussi. Fix : étendre `members_select` pour accepter aussi `created_by = auth.uid()` — sémantiquement normal (le créateur doit pouvoir voir sa propre org).

**Raison** : le schéma importé depuis Lovable avait des triggers et policies qui supposaient implicitement des grants/conventions Supabase que l'import n'a pas transférés.

**Impact** :
- `fix-organizations-rls.sql` : 4 sections + vérification post-fix DO block, idempotent (rejouable).
- DB prod : policies/constraints/trigger fn mis à jour.
- `LOGBOOK.md` + `CLAUDE.md` : doc.

**Bug #5 — UNIQUE constraints perdues à l'import Lovable** : 8 autres tables avaient le même problème (contraintes UNIQUE disparues), bloquant les upserts client (`SceneProfile` onboarding, `ConnectorSettings`, `useJobCandidateStatus`, `useMemberLinkedInAccounts`, etc.). Fix : loop DO block dans `fix-organizations-rls.sql` qui ajoute idempotemment les UNIQUE sur `profiles`, `connector_instances`, `chat_categories`, `job_candidate_status`, `member_email_accounts`, `member_linkedin_accounts`, `member_quotas`, `message_analysis_cache` (+ celles déjà patchées).

**Reste à faire** :
- [x] Valider l'onboarding complet jusqu'au dashboard (testé OK 2026-04-21 soir).
- [x] Transformé en migration datée : `supabase/migrations/20260421180000_grants_bootstrap_owner_uniques.sql`, marquée `applied` en remote via `supabase migration repair`.

**Refs** : commits `00acc732` + `bb9b1ec1` (bug #5 UNIQUE constraints) + commit de consolidation. Migration : `20260421180000_grants_bootstrap_owner_uniques.sql`.

---

## 2026-04-20 — DECISION — Package Claude Code consolidé livré

**Contexte** : 25 fichiers (CLAUDE.md + 15 skills + settings + 4 guides + LOGBOOK + PROMPTS + routines) prêts à être déposés dans le repo Konekt AI Platform.
**Décision** : structure finale adoptée, plus de versions parallèles.
**Raison** : éviter la dérive documentaire et les règles contradictoires entre fichiers.
**Impact** : `CLAUDE.md`, `.claude/settings.json`, `skills/*.md` remplacent toute version antérieure.
**Reste à faire** :
- [ ] Déposer le package dans le repo
- [ ] Tester /go sur une feature réelle
- [ ] Ajuster PROMPTS.md après 2 semaines d'usage
**Refs** : conversation du 2026-04-20.

---

## Règles d'usage

1. **Une ligne suffit si c'est tout ce qui est vrai.** Pas d'étirement artificiel.
2. **Pas de PII client dans LOGBOOK.md.** Noms de candidats, emails, téléphones interdits. Remplacer par des IDs.
3. **Les `BUG` ouverts restent en haut** jusqu'à fermeture (flag `[RESOLVED]` dans le titre + date de résolution).
4. **Chaque `SHIP` référence le commit SHA et la cible** (staging ou prod).
5. **Relecture hebdo** : lundi matin, parcourir les 7 derniers jours. Ce qui est `[ ]` depuis 7+ jours → soit fait, soit fermé, soit escaladé.

---

## Anti-patterns à éviter

- ❌ `J'ai implémenté la feature X` → le verbe à la 1ère personne n'ajoute rien.
- ✅ `SPEC — Feature X : scope, contrats, limites`.

- ❌ Entry de 10 paragraphes avec code inline → mettre le code dans le repo, lier le commit.
- ✅ Entry de 5 bullets + `Refs: <SHA>`.

- ❌ `INSIGHT — Claude Code est cool` → vide.
- ✅ `INSIGHT — Playwright échoue sur Safari mobile à cause de <raison précise>, workaround : <X>`.

---

*Ce fichier est lu par Claude Code en début de chaque conversation via la skill /status. Garder concis pour ne pas polluer le contexte.*

# Chantier design

Konekt a ses fonctionnalités. Ce chantier reprend l'interface écran par écran pour qu'elle soit cohérente d'un bout à l'autre : mêmes couleurs, mêmes composants, mêmes mots, et des états (chargement, vide, erreur) qui disent la vérité. Le parti pris est le design calme des outils de travail quotidien (Linear, Qonto), détaillé dans `01-direction.md`.

## Les documents

| Fichier | Contenu |
|---|---|
| `01-direction.md` | Les règles : couleurs, typographie, rayons, hauteurs, composants, mouvement, états, texte, accessibilité. Référence de toute modification de l'interface. |
| `02-constats.md` | Le registre des 429 constats des revues du 25 septembre 2026, avec le statut de chaque constat prioritaire. |
| `03-lots.md` | Le plan : qui fait quoi, ce que chaque lot doit remplir, le contenu des lots 1 à 11. |
| `04-contre-revue.md` | Le protocole de relecture par une seconde IA, avec la demande prête à copier. |
| `05-banc-visuel.md` | L'environnement local qui capture chaque écran en sombre, en clair, sur ordinateur et sur téléphone. |
| `audit/` | Les sept revues (zones A à F, design system G), avec preuves et captures citées. |

## Les sources

- La demande du propriétaire du produit (septembre 2026) : une interface uniforme, pas chargée, sans effet décoratif, au niveau des meilleurs outils de 2026. Les tendances retenues et écartées sont listées au § 1 de `01-direction.md`.
- La maquette « Konekt Design System » du 21 septembre 2026 et la maquette « Mission Konekt » du 25 septembre 2026.
- L'inventaire du 9 septembre (branche `claude/app-details-exhaustifs-s6nf9t`), qui sert de point de comparaison aux revues.

## Comment un lot se déroule

1. Relire les constats du lot dans les annexes et `03-lots.md`.
2. Capturer l'état de départ (`node scripts/design/capture.mjs captures/avant <filtre>`).
3. Modifier, en passant par les primitives de `src/components/ui/` et les composants de `src/components/layout/`.
4. Vérifier : `npm run audit:design`, `npx tsc --noEmit -p tsconfig.app.json`, `npx vite build`, `npm run test:ux`, ESLint.
5. Capturer l'état d'arrivée et comparer les deux séries.
6. Mettre à jour les statuts dans `02-constats.md`, commiter, puis lancer la contre-revue (`04-contre-revue.md`).

## Deux IA sur le même chantier

Claude écrit le code et tient les documents. Une seconde IA (ChatGPT) relit chaque lot à partir du diff, des captures et de `01-direction.md`, et rend un tableau de constats numérotés. Claude traite les constats bloquants avant le lot suivant et note les autres dans le registre. Le relecteur ne voit pas le raisonnement de l'auteur : il juge le résultat.

## Coordination avec l'autre session

La session « Audit complet du dépôt » refond l'expérience mission, la barre latérale et les Paramètres sur du code pas encore fusionné dans `main`. Le chantier design ne modifie pas ces écrans : il leur remet ses constats (dernière section de `02-constats.md`) et leur fournit le socle commun (jetons, primitives, composants de mise en page). Chaque lot qui touche un fichier partagé le signale dans son message de commit.

## Où en est le chantier

| Lot | Contenu | État |
|---|---|---|
| 1 | Socle commun | fait (`b90f07a1`) |
| 2 | Coquille | fait (`b90f07a1`) |
| 3 | Socle, suite | fait |
| 4 | Tableau de bord | fait |
| 5 | Tâches et agenda | fait |
| 6 | Messagerie et séquences | socle fait ; écrans en cours |
| 7 | Pipeline global, scorecard, coaching, assistant IA | socle et assistant faits ; pipeline, scorecard et coaching en cours |
| 8 | Pages publiques et portails | fait |
| 9 | Onboarding, invitation, qualification, marketplace | fait |
| 10 | Passe texte | à faire |
| 11 | Nettoyage, après la fusion de la refonte mission | à faire |

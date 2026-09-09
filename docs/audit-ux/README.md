# Chantier UX — méthode

Ce dossier est la mémoire du chantier. Il existe pour une raison : un audit n'est pas fiable parce qu'on l'a fait sérieusement, il est fiable quand on peut **montrer** ce qui a été regardé et ce qui ne l'a pas été.

## Les fichiers

| Fichier | Rôle | Qui l'écrit |
|---|---|---|
| `00-cartographie.md` | Toutes les routes de l'application, avec ce qu'elles écrivent et leurs pièges | **généré** |
| `01-matrice-couverture.md` | L'état d'avancement, route par route, sur quatre axes | **généré** |
| `coverage.json` | L'état réel de chaque case de la matrice | à la main |
| `02-constats.md` | Le registre des constats, leur preuve, leur statut de vérification | à la main |
| `03-scenarios.md` | Les parcours bout en bout à repasser après correction | à la main |

Regénérer après chaque lot :

```bash
node scripts/audit-ux/inventory.mjs
```

## Pourquoi c'est généré

Une liste de fonctionnalités écrite à la main vieillit dès le commit suivant, et personne ne sait qu'elle a vieilli. Ici les lignes viennent du code : une route ajoutée apparaît toute seule en « à faire », et une route supprimée disparaît. La couverture ne peut donc pas oublier un écran en silence.

Ce que le générateur relève n'est pas une preuve de défaut, c'est une piste. Il compte les écritures de données, les fenêtres bloquantes, les champs sans libellé et quelques motifs connus. Chaque piste demande une relecture avant d'entrer au registre. Exemple vécu : le générateur a signalé un `window.confirm` interdit, c'était un commentaire dans le fichier qui sert justement à le remplacer.

## Les quatre axes de couverture

Un écran peut être lu sans être testé, et testé sans que ses pannes le soient. D'où quatre axes séparés dans la matrice : **code lu**, **écran testé** dans l'application connectée, **cas d'erreur** (réseau coupé, droit refusé, ligne absente, quota atteint), **mobile et clavier**.

Une route n'est complète que si les quatre sont faits. Aujourd'hui aucune ne l'est, parce qu'aucun écran connecté n'a encore été testé.

## Les variantes qui changent vraiment l'expérience

Pour les routes à fort volume d'écriture, l'axe « écran testé » se décline :

- **Profils** : indépendant, cabinet, entreprise. Propriétaire, membre, collaborateur, invité externe.
- **Données** : aucune, normales, gros volume, champs incomplets.
- **États** : chargement, succès, erreur, session expirée, quota atteint.
- **Interruptions** : retour arrière, actualisation, fermeture pendant une saisie, double clic.

## La règle qui a manqué jusqu'ici

Un message de confirmation ne doit jamais annoncer plus que ce que l'opération a réellement établi. La moitié des constats P1 du registre sont des variations de cette seule règle.

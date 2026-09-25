# 04 · Contre-revue par une seconde IA

Chaque lot du chantier est codé par une IA et relu par une autre (Claude code, ChatGPT relit, ou l'inverse). Deux modèles différents ne ratent pas les mêmes choses. La relecture se fait contre `01-direction.md`, pas contre les goûts du relecteur.

## Ce qu'on donne au relecteur

1. Le lien de la PR du lot, ou son diff.
2. `docs/design/01-direction.md` (la règle) et la section du lot dans `03-lots.md` (le périmètre et le critère de fin).
3. Les captures avant et après du banc visuel (`05-banc-visuel.md`), dans les deux thèmes et sur téléphone.
4. Si utile, les constats du registre que le lot prétend corriger (`02-constats.md` et ses annexes).

## Ce qu'on attend en retour

Un tableau, un constat par ligne :

| Colonne | Contenu |
|---|---|
| ID | `CR-<lot>-<n>` |
| Sévérité | bloquant, à corriger, suggestion |
| Écran | la route ou le composant |
| Constat | ce qui est faux ou incohérent, en une ou deux phrases |
| Preuve | `fichier:ligne` ou nom de la capture |
| Correctif | ce qu'il faudrait faire |

Puis, à part et jamais mêlées au tableau : les propositions de changement de la direction elle-même (« la règle X produit tel effet, je propose Y »).

## Règles de la relecture

- Un constat cite une preuve. Sans preuve, c'est une question, pas un constat.
- Distinguer ce que le lot a cassé de ce qui était déjà là. Seul le premier bloque le lot.
- Vérifier les deux thèmes et le téléphone, pas seulement l'écran d'ordinateur sombre.
- Contrôler les règles de `CLAUDE.md` qui touchent l'interface : aucun nom de fournisseur visible, `AlertDialog` pour une action destructive, textes en français et au vouvoiement.
- Signaler toute hausse d'un compteur de `npm run audit:design`.

## Après la relecture

L'IA qui a codé traite chaque ligne « bloquant » et « à corriger » : correctif poussé, ou réponse argumentée. La décision est notée dans `03-lots.md`, à la ligne du lot. Une proposition de changement de la direction se tranche avec le propriétaire du produit avant d'être appliquée.

## Demande prête à copier

```text
Tu relis un lot du chantier design de Konekt, un SaaS de recrutement B2B en React, Tailwind et shadcn.
Ton rôle : contre-revue exigeante, pas validation.

Pièces jointes :
- le diff de la PR du lot (ou son lien) ;
- docs/design/01-direction.md : la direction design, qui fait foi ;
- la section du lot dans docs/design/03-lots.md : périmètre et critère de fin ;
- les captures avant/après (sombre, clair, ordinateur, téléphone).

Travail demandé :
1. Vérifie que le lot respecte la direction : couleurs par jetons, un seul accent rationné,
   échelle typographique, hauteurs de contrôle, rayons, mouvement, états d'écran, textes.
2. Cherche ce que le lot a pu casser : contraste, focus clavier, mise en page sur téléphone,
   thème clair, écrans qui partagent les composants modifiés.
3. Vérifie le critère de fin du lot.

Réponds en français, avec :
- un tableau (ID CR-<lot>-<n>, sévérité bloquant / à corriger / suggestion, écran, constat,
  preuve fichier:ligne ou capture, correctif) ;
- puis, séparément, tes propositions de changement de la direction, s'il y en a.
Chaque constat cite une preuve. Distingue ce que le lot a introduit de ce qui existait avant.
```

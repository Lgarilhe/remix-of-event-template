

# Limiter l'affichage a 10 candidats par colonne avec "Voir plus"

## Objectif
Ameliorer les performances et la lisibilite du pipeline en limitant l'affichage initial a 10 candidats par colonne, avec un bouton pour charger plus de candidats si necessaire.

## Modifications prevues

### 1. Composant DroppableColumn
**Fichier:** `src/components/candidates/DroppableColumn.tsx`

- Ajouter un etat local `displayLimit` initialise a 10
- Afficher uniquement les `displayLimit` premiers candidats
- Ajouter un bouton "Voir plus (X restants)" en bas de la colonne quand il y a plus de candidats que la limite
- Le clic sur le bouton augmente `displayLimit` de 10 (ou affiche tous les restants)
- Afficher le compteur total dans le header (inchange) pour que l'utilisateur sache combien de candidats il y a au total

### 2. Interface utilisateur du bouton

Le bouton "Voir plus" sera:
- Positionne en bas de la liste des cartes
- Style discret mais visible (texte + icone chevron vers le bas)
- Affiche le nombre de candidats restants non affiches

### 3. Experience utilisateur

```text
+---------------------------+
|  Pressenti          [15]  |  <-- Total toujours visible
+---------------------------+
|  [ Carte candidat 1 ]     |
|  [ Carte candidat 2 ]     |
|  ...                      |
|  [ Carte candidat 10 ]    |
|                           |
|  [Voir 5 de plus...]     |  <-- Bouton si > 10 candidats
+---------------------------+
```

---

## Details techniques

### Logique d'affichage
- `visibleEntries = entries.slice(0, displayLimit)`
- `remainingCount = entries.length - displayLimit`
- Bouton visible seulement si `remainingCount > 0`

### Gestion du drag and drop
- Les candidats non affiches restent dans la liste complete (pas de perte de donnees)
- Lors d'un drag vers une colonne, le candidat peut etre depose meme s'il y a deja 10+ candidats affiches
- Si un candidat est deplace vers une colonne ou il n'est pas visible, il apparaitra en premier (tri par defaut de Notion)


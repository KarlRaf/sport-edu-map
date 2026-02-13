# Sport Edu Map

Application web (FR) pour trouver les établissements sport-études les plus proches d'une adresse en France.

## Fonctionnalités

- recherche d'adresse avec autocomplétion (OpenStreetMap Nominatim),
- calcul des 10 établissements les plus proches,
- carte interactive (Leaflet + OpenStreetMap) avec marqueurs et popups,
- filtres par type d'établissement et par sport,
- interface mobile-friendly et 100% en français,
- liens vers site web et fiche Onisep quand disponibles.

## Source des données

- Dataset: [fr-en-sport-etudes](https://data.education.gouv.fr/explore/assets/fr-en-sport-etudes/view/)
- API utilisée:
  `https://dataeducation.opendatasoft.com/api/explore/v2.1/catalog/datasets/fr-en-sport-etudes/records`

## Attributions

- Fond de carte: OpenStreetMap
- Géocodage / autocomplétion: Nominatim (OpenStreetMap)

## Lancer en local

```bash
node server.js
```

Puis ouvrir [http://127.0.0.1:8000](http://127.0.0.1:8000).

## Licence

Ce projet est open source sous licence MIT. Voir le fichier `LICENSE`.

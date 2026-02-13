# Simple nearest institutions app

This is a very small static app that:

1. takes an address input with OpenStreetMap (Nominatim) autocomplete,
2. geocodes the selected address with OpenStreetMap (Nominatim),
3. fetches the `fr-en-sport-etudes` dataset with pagination,
4. shows the 10 closest institutions.

## Run locally

From this folder:

```bash
cp .env.example .env
node server.js
```

Then open [http://127.0.0.1:8000](http://127.0.0.1:8000).

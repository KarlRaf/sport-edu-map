# Simple nearest institutions app

This is a very small static app that:

1. takes an address input with OpenStreetMap (Nominatim) autocomplete,
2. geocodes the selected address with OpenStreetMap (Nominatim),
3. fetches the `fr-en-sport-etudes` dataset with pagination,
4. shows the 10 closest institutions.

## Data source

- Sport-etudes dataset: [fr-en-sport-etudes](https://data.education.gouv.fr/explore/assets/fr-en-sport-etudes/view/)
- API endpoint used in the app:
  `https://dataeducation.opendatasoft.com/api/explore/v2.1/catalog/datasets/fr-en-sport-etudes/records`

## Run locally

From this folder:

```bash
cp .env.example .env
node server.js
```

Then open [http://127.0.0.1:8000](http://127.0.0.1:8000).

## License

This project is open source under the MIT License. See the `LICENSE` file.

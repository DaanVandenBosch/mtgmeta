# MTGMETA

## Start Server

```sh
python -m http.server --bind 127.0.0.1
```

## Preprocess New Card Dumps

Download the "Oracle Cards" and "Default Cards" bulk data files from
[Scryfall](https://scryfall.com/docs/api/bulk-data).

```sh
python preprocess_cards.py oracle-cards.json default-cards.json
```

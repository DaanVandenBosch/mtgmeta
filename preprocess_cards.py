import json
from pathlib import Path
import sys

def prop(dst, src, prop):
    if prop in src:
        dst[prop] = src[prop]


def propr(dst, src, src_prop, dst_prop):
    if dst_prop in src:
        dst[src_prop] = src[dst_prop]


def img(dst, src):
    if "image_uris" in src:
        dst["img"] = src["image_uris"]["normal"].removeprefix(
            "https://cards.scryfall.io/normal/"
        )


def face_props(f, face):
    prop(f, face, "name")
    propr(f, face, "type", "type_line")
    propr(f, face, "cost", "mana_cost")
    propr(f, face, "oracle", "oracle_text")
    img(f, face)

    if "flavor_name" in face and face["flavor_name"]:
        prop(f, face, "flavor_name")


processed_cards = []
digital_cards = dict()
id_to_card = dict()

# First argument should be the Scryfall "Oracle Cards" bulk dump.
with open(sys.argv[1], encoding="utf8") as f:
    for card in json.load(f):
        if card["set_type"] in ["memorabilia", "token"]:
            continue

        if card["layout"] in [
            "scheme",
            "token",
            "planar",
            "emblem",
            "vanguard",
            "double_faced_token",
        ]:
            continue

        c = dict()
        prop(c, card, "cmc")
        c["rarities"] = {card["rarity"]}
        c["sfuri"] = (
            card["scryfall_uri"]
            .removeprefix("https://scryfall.com/")
            .removesuffix("?utm_source=api")
        )
        img(c, card)

        if "card_faces" in card:
            faces = []

            for face in card["card_faces"]:
                f = dict()
                face_props(f, face)
                faces.append(f)

            c["faces"] = faces
        else:
            face_props(c, card)

        if card["digital"]:
            digital_cards[card["oracle_id"]] = c
        else:
            processed_cards.append(c)

        id_to_card[card["oracle_id"]] = c

# Second argument should be the Scryfall "Default Cards" bulk dump.
with open(sys.argv[2], encoding="utf8") as f:
    for card in json.load(f):
        if "oracle_id" not in card:
            continue

        if card["digital"]:
            continue
        
        if card["oracle_id"] in digital_cards:
            processed_cards.append(digital_cards.pop(card["oracle_id"]))
        
        if card["oracle_id"] in id_to_card:
            id_to_card[card["oracle_id"]]["rarities"].add(card["rarity"])

for card in processed_cards:
    card["rarities"] = list(card["rarities"])

processed_cards.sort(
    key=lambda c: c.get("name") or f"{c["faces"][0]["name"]} // {c["faces"][1]["name"]}",
)

output_file = Path("cards.json")
output_file.touch()

with open(output_file, mode="w", encoding="utf8") as f:
    json.dump(processed_cards, f, ensure_ascii=False)

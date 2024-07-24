// Cards to exclude from the final data.
const EXCLUDED_SET_TYPES = ['memorabilia', 'token'];
const EXCLUDED_LAYOUTS = ['scheme', 'token', 'planar', 'emblem', 'vanguard', 'double_faced_token'];
// We also exclude purely digital cards.

const sf_bulk_info = await(await fetch('https://api.scryfall.com/bulk-data')).json();

const processed_cards = [];
// We put digital cards in this map during the pass over the oracle cards. Then if, during the pass
// over the default cards, we find a version of any of these cards that's not digital, we add the
// digital version of it to the processed cards array. We use the digital version, because it's what
// ScryFall considers the most legible version (compare ).
const id_to_digital_card = new Map;
const id_to_card = new Map;
const card_to_idx = new Map;

// Process Scryfall "Oracle" cards.

const oracle_cards = await get_card_data(sf_bulk_info, 'oracle_cards');

for (const src_card of oracle_cards) {
    if (EXCLUDED_SET_TYPES.includes(src_card.set_type)) {
        continue;
    }

    if (EXCLUDED_LAYOUTS.includes(src_card.layout)) {
        continue;
    }

    try {
        const sfuri = src_card.scryfall_uri
            .replace('https://scryfall.com/', '')
            .replace(/\?utm_source=api$/, '');

        const formats = Object.entries(src_card.legalities)
            .filter(([_, v]) => v !== 'not_legal' && v !== 'banned')
            .map(([k]) => k);

        const dst_card = {
            cmc: src_card.cmc,
            rarities: new Set([src_card.rarity]),
            sfuri,
            formats,
            identity: src_card.color_identity.join(''),
        };

        if ('colors' in src_card) {
            dst_card.colors = src_card.colors.join('');
        }

        process_card_img_uri(dst_card, src_card);

        if ('card_faces' in src_card) {
            dst_card.faces = src_card.card_faces.map(src_face => {
                const dst_face = {};
                process_card_img_uri(dst_face, src_face);
                process_card_face(dst_face, src_face);

                if ('colors' in src_face) {
                    dst_face.colors = src_face.colors.join('');
                }

                return dst_face;
            });
        } else {
            process_card_face(dst_card, src_card);
        }

        if (src_card.digital) {
            id_to_digital_card.set(src_card.oracle_id, dst_card);
        } else {
            const idx = processed_cards.length;
            processed_cards.push(dst_card);
            id_to_card.set(src_card.oracle_id, dst_card);
            card_to_idx.set(dst_card, idx);
        }
    } catch (e) {
        console.error(src_card.name, e);
        throw e;
    }
}

// Process Scryfall "Default" cards.

const default_cards = await get_card_data(sf_bulk_info, 'default_cards');

for (const src_card of default_cards) {
    const id = src_card.oracle_id;

    if (id === undefined) {
        // Ignore reversible cards, we already added them during the pass over the oracle cards.
        continue;
    }

    if (src_card.digital) {
        // Don't care about digital cards.
        continue;
    }

    let dst_card = id_to_digital_card.get(id);

    if (dst_card) {
        // The card is not just digital, add it to the list.
        id_to_digital_card.delete(id);

        const idx = processed_cards.length;
        processed_cards.push(dst_card);
        id_to_card.set(src_card.oracle_id, dst_card);
        card_to_idx.set(dst_card, idx);
    } else {
        dst_card = id_to_card.get(id);
    }

    if (dst_card) {
        dst_card.rarities.add(src_card.rarity);
    }
}

// Generate sort indices.

const sort_indices = new ArrayBuffer(2 * 2 * processed_cards.length);

function name_compare(a, b) {
    return full_card_name(a).localeCompare(full_card_name(b), 'en', { ignorePunctuation: true });
}

add_sort_index(
    sort_indices,
    0,
    processed_cards,
    card_to_idx,
    (a, b) => {
        const order = a.cmc - b.cmc;
        return order === 0 ? name_compare(a, b) : order;
    },
);
add_sort_index(
    sort_indices,
    1,
    processed_cards,
    card_to_idx,
    name_compare,
);

// Finally write our output files.

Deno.writeTextFileSync(
    'src/cards.json',
    JSON.stringify(
        processed_cards,
        (_key, value) => (value instanceof Set ? [...value] : value),
    ),
);
Deno.writeFileSync(
    'src/cards.idx',
    new Uint8Array(sort_indices),
);

// Helper functions.

async function get_card_data(sf_bulk_info, type) {
    for (const data of sf_bulk_info.data) {
        if (data.type === type) {
            if (!data.download_uri.endsWith('.json')) {
                throw Error(`Bulk data URI didn't end with .json: ${data.download_uri}`);
            }

            const last_slash = data.download_uri.lastIndexOf('/');

            if (last_slash === -1) {
                throw Error(`Bulk data URI doesn't have any slashes: ${data.download_uri}`);
            }

            const filename = data.download_uri.slice(last_slash + 1);

            if (!filename.match(/^[a-z]+[a-z0-9-]+\.json$/)) {
                throw Error(`Computed filename looks wrong: ${filename}`);
            }

            try {
                const json = Deno.readTextFileSync(filename);
                console.log(`Found a file named ${filename}, loading it.`);
                return JSON.parse(json);
            } catch (e) {
                if (e.code === 'ENOENT') {
                    console.log(`No file named ${filename}, downloading bulk data.`);
                    const bulk_data = await (await fetch(data.download_uri)).json();
                    Deno.writeTextFileSync(filename, JSON.stringify(bulk_data));
                    return bulk_data;
                } else {
                    throw e;
                }
            }
        }
    }

    throw Error(`Couldn't find bulk data URI for type ${type}.`);
}

function process_card_img_uri(dst, src) {
    if ('image_uris' in src) {
        dst.img = src.image_uris.normal.replace('https://cards.scryfall.io/normal/', '');
    }
}

function process_card_face(dst, src) {
    dst.name = src.name;
    dst.type = src.type_line;
    dst.cost = src.mana_cost;
    dst.oracle = src.oracle_text;

    if (src.flavor_name) {
        dst.flavor_name = src.flavor_name;
    }
}

function full_card_name(card) {
    return card.name ?? (card.faces[0].name + ' // ' + card.faces[1].name);
}

function add_sort_index(buf, index_no, cards, card_to_idx, sort_fn) {
    const view = new DataView(buf, index_no * 2 * cards.length, 2 * cards.length)
    cards = [...cards].sort(sort_fn);

    for (let i = 0, len = cards.length; i < len; i++) {
        view.setUint16(2 * i, card_to_idx.get(cards[i]), true);
    }
}

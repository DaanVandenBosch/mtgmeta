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
        const sfurl = src_card.scryfall_uri
            .replace('https://scryfall.com/', '')
            .replace(/\?utm_source=api$/, '');

        const formats = Object.entries(src_card.legalities)
            .filter(([_, v]) => v !== 'not_legal' && v !== 'banned')
            .map(([k]) => k);

        const dst_card = {
            // Card properties.
            cmc: src_card.cmc,
            formats,
            identity: src_card.color_identity.join(''),
            rarities: new Set([src_card.rarity]),
            sfurl,

            // Card XOR face properties.
            cost: [],
            name: [],
            oracle: [],
            type: [],

            // Card AND face properties.
            colors: ['colors' in src_card ? src_card.colors.join('') : null],
            img: [process_card_img_uri(src_card)],
        };

        for (const src_face of src_card.card_faces ?? [src_card]) {
            dst_card.cost.push(src_face.mana_cost);
            dst_card.name.push(src_face.name);
            dst_card.oracle.push(src_face.oracle_text);
            dst_card.type.push(src_face.type_line);
        }

        if (src_card.card_faces) {
            for (const src_face of src_card.card_faces) {
                dst_card.colors.push('colors' in src_face ? src_face.colors.join('') : null);
                dst_card.img.push(process_card_img_uri(src_face));
            }
        }

        if (src_card.digital) {
            id_to_digital_card.set(src_card.oracle_id, dst_card);
        } else {
            processed_cards.push(dst_card);
            id_to_card.set(src_card.oracle_id, dst_card);
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

        processed_cards.push(dst_card);
        id_to_card.set(src_card.oracle_id, dst_card);
    } else {
        dst_card = id_to_card.get(id);
    }

    if (dst_card) {
        dst_card.rarities.add(src_card.rarity);
    }
}

// Generate sort indices.

const sort_indices = new ArrayBuffer(4 * processed_cards.length);

processed_cards.sort((a, b) =>
    full_card_name(a).localeCompare(full_card_name(b), 'en', { ignorePunctuation: true })
);

const sort_indices_len = generate_sort_indices(sort_indices, processed_cards);

// Finally write our output files.

for (const prop of [
    'colors',
    'cost',
    'cmc',
    'face_colors',
    'face_img',
    'formats',
    'identity',
    'img',
    'name',
    'oracle',
    'rarities',
    'sfurl',
    'type',
]) {
    Deno.writeTextFileSync(
        `src/card_${prop}.json`,
        JSON.stringify(
            processed_cards.map(c => c[prop]),
            (_key, value) => (value instanceof Set ? [...value] : value),
        ),
    );
}

Deno.writeFileSync(
    'src/cards.idx',
    new Uint8Array(sort_indices, 0, sort_indices_len),
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

function process_card_img_uri(src) {
    return src.image_uris?.normal?.replace('https://cards.scryfall.io/normal/', '') ?? null;
}

function full_card_name(card) {
    return card.name.length === 1 ? card.name[0] : (card.name[0] + ' // ' + card.name[1]);
}

function generate_sort_indices(buf, cards) {
    const view = new DataView(buf);
    const card_to_idx = new Map;

    for (let i = 0, len = cards.length; i < len; i++) {
        const card = cards[i];
        card_to_idx.set(card, i);
    }

    // Pairs of grouping functions and group sorting functions.
    const indices = [
        [card => card.cmc, (a, b) => a - b],
    ];

    // File starts with index count and table of absolute offsets to indices.
    view.setUint32(0, indices.length, true);
    const index_table_offset = 4;
    let pos = index_table_offset + 4 * indices.length;

    for (let i = 0, len = indices.length; i < len; i++) {
        // File starts with absolute offsets to indices.
        view.setUint32(index_table_offset + 4 * i, pos, true);

        const [group_fn, sort_fn] = indices[i];
        const unsorted_groups = [...Map.groupBy(cards, group_fn)];
        const groups = unsorted_groups.sort(([a], [b]) => sort_fn(a, b));

        // Index starts with amount of groups.
        view.setUint16(pos, groups.length, true);
        pos += 2;

        // The relative end index of each group. This is not an offset.
        let group_end = 0;

        for (const [_, cards] of groups) {
            group_end += cards.length;
            view.setUint16(pos, group_end, true);
            pos += 2;
        }

        // Indices into the master card list per group.
        for (const [_, cards] of groups) {
            for (const card of cards) {
                view.setUint16(pos, card_to_idx.get(card), true);
                pos += 2;
            }
        }
    }

    return pos;
}

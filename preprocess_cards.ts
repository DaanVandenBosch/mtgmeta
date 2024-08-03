import { mkdir } from "node:fs/promises";

// Cards to exclude from the final data.
const EXCLUDED_SET_TYPES = ['memorabilia', 'token'];
const EXCLUDED_SETS = ['cmb1', 'cmb2'];
const EXCLUDED_LAYOUTS = ['scheme', 'token', 'planar', 'emblem', 'vanguard', 'double_faced_token'];
// We also exclude purely digital cards.

type Processed_Card = {
    // Card properties.
    cmc: string,
    formats: string[],
    identity: string,
    sfurl: string,

    // Per-version properties.
    versions: {
        digital: boolean,
        layout: string,
        rarity: string,
        released_at: Date,
        set: string,
        set_type: string,
    }[],

    // Card or face properties. I.e. either one or two values per card.
    colors: string[],
    cost: string[],
    img: string[],
    name: string[],
    oracle: string[],
    type: string[],
}

console.log('Getting Scryfall bulk data information.');
const sf_bulk_info = await (await fetch('https://api.scryfall.com/bulk-data')).json();

let cards: Processed_Card[] = [];
const id_to_card = new Map<string, Processed_Card>;

console.log('Processing Scryfall "Oracle" cards.');
// We do an initial pass over the oracle cards to get the most legible version of each card.

const oracle_cards = await get_card_data(sf_bulk_info, 'oracle_cards');

for (const src_card of oracle_cards) {
    try {
        for (const prop of ['colors', 'image_uris']) {
            if (prop in src_card && src_card.card_faces?.some((f: any) => prop in f)) {
                throw Error(`${prop} in both card and faces.`);
            }
        }

        const sfurl = src_card.scryfall_uri
            .replace('https://scryfall.com/', '')
            .replace(/\?utm_source=api$/, '');

        const formats = Object.entries(src_card.legalities)
            .filter(([_, v]) => v !== 'not_legal' && v !== 'banned')
            .map(([k]) => k);

        const dst_card: Processed_Card = {
            // Card properties.
            cmc: src_card.cmc,
            formats,
            identity: src_card.color_identity.join(''),
            sfurl,

            // Per-version properties.
            versions: [],

            // Card or face properties. I.e. either one or two values per card.
            colors: [],
            cost: [],
            img: [],
            name: [],
            oracle: [],
            type: [],
        };

        // Properties that will be on the face if there are faces, and on the card if there are no
        // faces.
        for (const src_face of src_card.card_faces ?? [src_card]) {
            dst_card.cost.push(src_face.mana_cost);
            dst_card.name.push(src_face.name);
            dst_card.oracle.push(src_face.oracle_text);
            dst_card.type.push(src_face.type_line);
        }

        // Properties that could be on the card even though there are faces.
        for (const src of [src_card, ...(src_card.card_faces ?? [])]) {
            if ('colors' in src) {
                dst_card.colors.push(src.colors.join(''));
            }

            if ('image_uris' in src) {
                dst_card.img.push(
                    src.image_uris.normal.replace('https://cards.scryfall.io/normal/', ''),
                );
            }
        }

        cards.push(dst_card);
        id_to_card.set(src_card.oracle_id, dst_card);
    } catch (e) {
        console.error(src_card.name, e);
        throw e;
    }
}

console.log('Processing Scryfall "Default" cards.');
// Do a pass over the default cards, to get the information of all card versions.

const default_cards = await get_card_data(sf_bulk_info, 'default_cards');

for (const src_card of default_cards) {
    const id = src_card.oracle_id;

    if (id === undefined) {
        // Ignore reversible cards, we already added them during the pass over the oracle cards.
        continue;
    }

    const dst_card = id_to_card.get(id);

    if (dst_card === undefined) {
        throw Error(`No card for ${id}.`);
    }

    dst_card.versions.push({
        digital: src_card.digital,
        layout: src_card.layout,
        rarity: src_card.rarity,
        released_at: new Date(src_card.released_at + 'T00:00:00Z'),
        set: src_card.set,
        set_type: src_card.set_type,
    });
}

// Filter out cards we don't want.
cards = cards.filter(dst_card =>
    !dst_card.versions.every(version =>
        version.digital
        || EXCLUDED_SET_TYPES.includes(version.set_type)
        || EXCLUDED_SETS.includes(version.set)
        || EXCLUDED_LAYOUTS.includes(version.layout)
    )
);

// Sort versions by release date.
for (const dst_card of cards) {
    dst_card.versions.sort((a, b) => a.released_at.getTime() - b.released_at.getTime());
}

console.log('Generating sort indices.');

const sort_indices = new ArrayBuffer(4 * cards.length);

// Default sort is alphabetically by name.
cards.sort((a, b) =>
    full_card_name(a).localeCompare(full_card_name(b), 'en', { ignorePunctuation: true })
);

const sort_indices_len = generate_sort_indices(sort_indices, cards);

console.log('Writing output files.');

function json_replacer(this: any, key: string): any {
    const value = this[key];

    if (value instanceof Set) {
        return [...value];
    } else if (value instanceof Date) {
        return value.toISOString().split('T')[0];
    } else {
        return value;
    }
}

for (const prop of [
    'colors',
    'cost',
    'cmc',
    'formats',
    'identity',
    'img',
    'name',
    'oracle',
    'sfurl',
    'type',
] as (keyof Processed_Card)[]) {
    await Bun.write(
        `src/card_${prop}.json`,
        JSON.stringify(
            cards.map(c => c[prop]),
            json_replacer,
        ),
    );
}

for (const prop of [
    'rarity',
    'released_at',
    'set',
] as (keyof Processed_Card['versions'][0])[]) {
    await Bun.write(
        `src/card_${prop}.json`,
        JSON.stringify(
            cards.map(c => c.versions.map(v => v[prop])),
            json_replacer,
        ),
    );
}

await Bun.write(
    'src/cards.idx',
    new Uint8Array(sort_indices, 0, sort_indices_len),
);

const total_versions = cards.reduce((acc, card) => acc + card.versions.length, 0);

console.log(
    `Created property files for ${cards.length} cards with ${total_versions} versions total.`
);

// Helper functions.

async function get_card_data(sf_bulk_info: any, type: string): Promise<any> {
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

            const dir = 'preprocessing';
            const file = Bun.file(`${dir}/${filename}`);

            if (await file.exists()) {
                console.log(`Found a file named ${filename}, loading it.`);
                return JSON.parse(await file.text());
            } else {
                console.log(`No file named ${filename}, downloading bulk data.`);
                const bulk_data = await (await fetch(data.download_uri)).json();
                await mkdir(dir, { recursive: true });
                await Bun.write(file, JSON.stringify(bulk_data));
                return bulk_data;
            }
        }
    }

    throw Error(`Couldn't find bulk data URI for type ${type}.`);
}

function full_card_name(card: any): string {
    return card.name.length === 1 ? card.name[0] : (card.name[0] + ' // ' + card.name[1]);
}

function generate_sort_indices(buf: ArrayBuffer, cards: any[]): number {
    const view = new DataView(buf);
    const card_to_idx = new Map;

    for (let i = 0, len = cards.length; i < len; i++) {
        const card = cards[i];
        card_to_idx.set(card, i);
    }

    // Pairs of grouping functions and group sorting functions.
    const indices: [(card: any) => any, (a: any, b: any) => number][] = [
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

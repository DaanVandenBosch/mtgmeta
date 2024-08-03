import { mkdir } from "node:fs/promises";

// Cards to exclude from the final data.
const EXCLUDED_SET_TYPES = ['memorabilia', 'token'];
const EXCLUDED_SETS = ['cmb1', 'cmb2'];
const EXCLUDED_LAYOUTS = ['scheme', 'token', 'planar', 'emblem', 'vanguard', 'double_faced_token'];
// We also exclude purely digital cards.

const TEXT_ENC = new TextEncoder();

async function preprocess_cards() {
    console.log('Getting Scryfall bulk data information.');
    const sf_bulk_info = await (await fetch('https://api.scryfall.com/bulk-data')).json();

    let cards: Card[] = [];
    const id_to_card = new Map<string, Card>;

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

            const dst_card: Card = {
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
    cards = cards.filter(dst_card => {
        if (dst_card.versions.length === 0) {
            throw Error(`Card "${full_card_name(dst_card)}" has no versions.`);
        }

        return !dst_card.versions.every(version =>
            version.digital
            || EXCLUDED_SET_TYPES.includes(version.set_type)
            || EXCLUDED_SETS.includes(version.set)
            || EXCLUDED_LAYOUTS.includes(version.layout)
        );
    });

    // Sort versions by release date.
    for (const dst_card of cards) {
        dst_card.versions.sort((a, b) => a.released_at.getTime() - b.released_at.getTime());
    }

    console.log('Generating sort indices.');

    // Default sort is alphabetically by name.
    cards.sort((a, b) =>
        full_card_name(a).localeCompare(full_card_name(b), 'en', { ignorePunctuation: true })
    );

    const sort_indices = generate_sort_indices(cards);

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
    ] as (keyof Card)[]) {
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
    ] as (keyof Card['versions'][0])[]) {
        await Bun.write(
            `src/card_${prop}.json`,
            JSON.stringify(
                cards.map(c => c.versions.map(v => v[prop])),
                json_replacer,
            ),
        );
    }

    for (const { prop, index } of sort_indices) {
        await Bun.write(`src/card_${prop}.sort`, index);
    }

    const total_versions = cards.reduce((acc, card) => acc + card.versions.length, 0);

    console.log(
        `Created property files for ${cards.length} cards with ${total_versions} versions total.`
    );
}

type Card = {
    /** Card properties. */
    cmc: number,
    formats: string[],
    identity: string,
    sfurl: string,

    /** Per-version properties. */
    versions: Card_Version[],

    /** Card or face properties. I.e. either one or two values per card. */
    colors: string[],
    cost: string[],
    img: string[],
    name: string[],
    oracle: string[],
    type: string[],
}

type Card_Version = {
    digital: boolean,
    layout: string,
    rarity: string,
    released_at: Date,
    set: string,
    set_type: string,
};

class Buf_Writer {
    #view: DataView;
    #le = true;
    #pos = 0;

    constructor(len: number) {
        this.#view = new DataView(new ArrayBuffer(len));
    }

    get pos(): number {
        return this.#pos;
    }

    private get buf(): ArrayBuffer {
        return this.#view.buffer;
    }

    write_u8(n: number) {
        this.#view.setUint8(this.#pos, n);
        this.#pos++;
    }

    write_u16(n: number) {
        this.#view.setUint16(this.#pos, n, this.#le);
        this.#pos += 2;
    }

    write_u32(n: number) {
        this.#view.setUint32(this.#pos, n, this.#le);
        this.#pos += 4;
    }

    write_u32_zeroes(n: number) {
        for (let i = 0; i < n; i++) {
            this.#view.setUint32(this.#pos, 0, this.#le);
        }

        this.#pos += 4 * n;
    }

    write_utf8(s: string, n: number) {
        TEXT_ENC.encodeInto(s, new Uint8Array(this.buf, this.#pos, n));
        this.#pos += n;
    }

    set_u32(offset: number, n: number) {
        this.check(offset, 4);
        this.#view.setUint32(offset, n, this.#le);
    }

    array_buffer(): ArrayBuffer {
        return this.buf.slice(0, this.#pos);
    }

    private check(offset: number, size: number) {
        if (offset + size > this.#pos) {
            throw Error(`Offset ${offset} with size ${size} is out of bounds.`);
        }
    }
}

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

function full_card_name(card: Card): string {
    return card.name.length === 1 ? card.name[0] : card.name.join(' // ');
}

function generate_sort_indices(cards: Card[]): { prop: string, index: ArrayBuffer }[] {
    return [
        generate_index(cards, 'cmc', 1, card => card.cmc),
        generate_index(cards, 'released_at', 2, version => version.released_at.getTime()),
    ];
}

function generate_index(
    cards: Card[],
    prop: string,
    type: number,
    get_value: (card_or_version: any) => any,
) {
    let entries: {
        card_idx: number,
        version_idx?: number,
        value: any,
    }[];

    if (type === 1) {
        entries = cards.flatMap((card, card_idx) => {
            return {
                card_idx,
                value: get_value(card),
            };
        });
    } else if (type === 2) {
        entries = cards.flatMap((card, card_idx) => {
            return card.versions.map((version, version_idx) => {
                return {
                    card_idx,
                    version_idx,
                    value: get_value(version),
                };
            });
        });
    } else {
        throw Error(`Invalid type: ${type}`);
    }

    const unsorted_groups = [...Map.groupBy(entries, e => e.value)];
    const groups = unsorted_groups.sort(([a], [b]) => a - b);

    const buf = new Buf_Writer(5 * entries.length);
    write_header(buf, type, prop)
    write_group_table(buf, groups);

    // Indices into the master card list per group.
    for (const [_, entries] of groups) {
        for (const { card_idx, version_idx } of entries) {
            buf.write_u16(card_idx);

            if (type === 2) {
                buf.write_u16(version_idx!);
            }
        }
    }

    return {
        prop,
        index: buf.array_buffer(),
    };
}

/** Writes a 24-byte header. */
function write_header(buf: Buf_Writer, type: number, order: string) {
    // File starts with identifier.
    buf.write_utf8("MTGI", 4);
    // Index format version.
    buf.write_u16(2);
    // Index type.
    buf.write_u8(type);
    // Reserved byte.
    buf.write_u8(0);
    buf.write_utf8(order, 16);
}

function write_group_table(buf: Buf_Writer, groups: Array<[any, Array<any>]>) {
    // Group count.
    buf.write_u32(groups.length);

    // The relative end index of each group. This is not an offset.
    let group_end = 0;

    for (const [_, entries] of groups) {
        group_end += entries.length;
        buf.write_u32(group_end);
    }
}

preprocess_cards();

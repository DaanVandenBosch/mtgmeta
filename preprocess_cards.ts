import { readdir, mkdir, unlink } from "node:fs/promises";

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

    const oracle_cards: Sf_Card[] = await get_card_data(sf_bulk_info, 'oracle_cards');

    for (const src_card of oracle_cards) {
        try {
            validate(src_card);

            const sfurl = src_card.scryfall_uri
                .replace('https://scryfall.com/', '')
                .replace(/\?utm_source=api$/, '');

            const formats = Object.entries(src_card.legalities)
                .filter(([_, v]) => v !== 'not_legal' && v !== 'banned')
                .map(([k]) => k);

            const dst_card: Card = {
                // Card properties.
                cmc: src_card.cmc ?? src_card.card_faces![0].cmc!,
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

            // Properties that will be on the face if there are faces, and on the card if there are
            // no faces.
            for (const src_face of src_card.card_faces ?? [src_card]) {
                dst_card.cost.push(src_face.mana_cost!);
                dst_card.name.push(src_face.name);
                dst_card.oracle.push(src_face.oracle_text!);
                dst_card.type.push(src_face.type_line ?? null);
            }

            // Properties that could be on the card even though there are faces.
            for (const src of [src_card, ...(src_card.card_faces ?? [])]) {
                if (src.colors !== undefined) {
                    dst_card.colors.push(src.colors.join(''));
                }

                if (src.image_uris !== undefined) {
                    dst_card.img.push(
                        src.image_uris.normal.replace('https://cards.scryfall.io/normal/', ''),
                    );
                }
            }

            cards.push(dst_card);

            if (src_card.oracle_id !== undefined) {
                id_to_card.set(src_card.oracle_id, dst_card);
            }
        } catch (e) {
            console.error(src_card);
            throw e;
        }
    }

    console.log('Processing Scryfall "Default" cards.');
    // Do a pass over the default cards, to get the information of all card versions.

    const default_cards = await get_card_data(sf_bulk_info, 'default_cards');

    for (const src_card of default_cards) {
        try {
            validate(src_card);

            const id = src_card.oracle_id;

            if (id === undefined) {
                // Ignore reversible cards, we already added them during the pass over the oracle
                // cards.
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
        } catch (e) {
            console.error(src_card);
            throw e;
        }
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

    console.log('Sorting.');

    // Sort versions by release date.
    for (const dst_card of cards) {
        if (dst_card.versions.length > 1024) {
            throw Error(
                `Card "${full_card_name(dst_card)}" has ${dst_card.versions.length} versions, the query evaluator's maximum is 1024 (see Array_Set).`
            );
        }

        dst_card.versions.sort((a, b) => a.released_at.getTime() - b.released_at.getTime());
    }

    // Sort cards alphabetically by name.
    cards.sort((a, b) =>
        full_card_name(a).localeCompare(full_card_name(b), 'en', { ignorePunctuation: true })
    );

    console.log('Generating indices.');

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

type Sf_Card = {
    id: string,
    oracle_id?: string,
    name: string,
    released_at: string,
    scryfall_uri: string,
    layout: string,
    image_uris?: {
        normal: string,
    },
    mana_cost?: string,
    /** Reversible cards have their CMC on the faces. */
    cmc?: number,
    /** Reversible cards have their type line on the faces. */
    type_line?: string,
    oracle_text?: string,
    colors?: string[],
    color_identity: string[],
    card_faces?: {
        name: string,
        mana_cost: string,
        cmc?: number,
        type_line?: string,
        oracle_text: string,
        colors?: string[],
        image_uris?: {
            normal: string,
        },
    }[],
    legalities: { [key: string]: 'legal' | 'not_legal' | 'restricted' | 'banned' },
    set: string,
    set_type: string,
    digital: boolean,
    rarity: 'common' | 'uncommon' | 'rare' | 'special' | 'mythic' | 'bonus',
};

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
    type: (string | null)[],
}

type Card_Version = {
    digital: boolean,
    layout: string,
    rarity: string,
    released_at: Date,
    set: string,
    set_type: string,
};

function is_uuid_string(str: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(str);
}

function assert(condition: boolean, message?: () => string): asserts condition {
    if (!condition) {
        throw Error(message ? message() : 'Assertion failed.');
    }
}

function assert_is_array<T extends object>(o: T, prop: keyof T) {
    assert(Array.isArray(o[prop]), () => `Property ${String(prop)} is not an array.`);
}

function assert_array_of_type<T extends object>(o: T, prop: keyof T, type: 'string' | 'number' | 'boolean') {
    assert_is_array(o, prop);

    for (const v of o[prop] as any[]) {
        assert(
            typeof v === type,
            () => `Not all values of property ${String(prop)} are of type ${type}.`,
        );
    }
}

function assert_type<T extends object>(o: T, prop: keyof T, type: 'string' | 'number' | 'boolean') {
    assert(typeof o[prop] === type, () => `Property ${String(prop)} is not of type ${type}.`);
}

function assert_type_if_exists<T extends object>(o: T, prop: keyof T, type: 'string' | 'number' | 'boolean') {
    if (prop in o) {
        assert_type(o, prop, type);
    }
}

function assert_value_in<T extends object, K extends keyof T>(o: T, prop: K, values: T[K][]) {
    assert(values.includes(o[prop]), () => `Property ${String(prop)} is not one of ${values}.`);
}

function validate(card: Sf_Card) {
    try {
        assert(is_uuid_string(card.id));

        if ('oracle_id' in card) {
            assert(is_uuid_string(card.oracle_id!));
        }

        assert_type(card, 'name', 'string');
        assert(/^\d{4}-\d{2}-\d{2}$/.test(card.released_at));
        assert_type(card, 'layout', 'string');
        assert_type(card, 'scryfall_uri', 'string');
        assert(!('image_uris' in card) || typeof card.image_uris!.normal === 'string');
        assert_type_if_exists(card, 'mana_cost', 'string');
        assert_type_if_exists(card, 'cmc', 'number');
        assert_type_if_exists(card, 'type_line', 'string');
        assert('oracle_text' in card !== 'card_faces' in card);

        if ('colors' in card) {
            assert_array_of_type(card, 'colors', 'string');
        }

        assert_is_array(card, 'color_identity');
        assert_array_of_type(card, 'color_identity', 'string');
        assert_type(card, 'set', 'string');
        assert_type(card, 'set_type', 'string');
        assert_type(card, 'digital', 'boolean');

        for (const k of Object.keys(card.legalities)) {
            assert_value_in(card.legalities, k, ['legal', 'not_legal', 'restricted', 'banned']);
        }

        for (const prop of ['colors', 'cmc']) {
            if (prop in card) {
                if (card.card_faces?.some(f => prop in f)) {
                    throw Error(`${prop} in both card and faces.`);
                }
            } else {
                if (!('card_faces' in card) || card.card_faces!.length === 0) {
                    throw Error(`${prop} not in card and card has no faces.`);
                }

                if (!card.card_faces!.every(f => prop in f)) {
                    throw Error(`${prop} not in card and not in all faces.`);
                }
            }
        }

        if ('image_uris' in card && card.card_faces?.some(f => 'image_uris' in f)) {
            throw Error(`image_uris in both card and faces.`);
        }

        if (!('type_line' in card) && !card.card_faces?.every(f => 'type_line' in f)) {
            throw Error(`type_line not in card and not in faces.`);
        }

        if ('card_faces' in card) {
            assert(Array.isArray(card.card_faces));
            assert(card.card_faces.length >= 2);

            let face_cmc = null;

            for (const face of card.card_faces) {
                assert_type(face, 'name', 'string');
                assert_type(face, 'mana_cost', 'string');

                if ('cmc' in face) {
                    assert_type(face, 'cmc', 'number');

                    if (face_cmc === null) {
                        face_cmc = face.cmc;
                    } else {
                        assert(face_cmc === face.cmc);
                    }
                }

                assert_type_if_exists(face, 'type_line', 'string');
                assert_type(face, 'oracle_text', 'string');

                if ('colors' in face) {
                    assert_array_of_type(face, 'colors', 'string');
                }

                assert(!('image_uris' in face) || typeof face.image_uris!.normal === 'string');
            }
        }
    } catch (e) {
        throw Error(`Validation of card "${card.name}" (${card.id}) failed.`, { cause: e });
    }
}

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

async function get_card_data(sf_bulk_info: any, type: string): Promise<Sf_Card[]> {
    for (const data of sf_bulk_info.data) {
        if (data.type === type) {
            if (!data.download_uri.endsWith('.json')) {
                throw Error(`Bulk data URI didn't end with .json: ${data.download_uri}`);
            }

            const last_slash = data.download_uri.lastIndexOf('/');

            if (last_slash === -1) {
                throw Error(`Bulk data URI doesn't have any slashes: ${data.download_uri}`);
            }

            const filename: string = data.download_uri.slice(last_slash + 1);
            const filename_parts = filename.match(/^([a-z]+[a-z0-9-]+-)\d+\.json$/);

            if (filename_parts === null) {
                throw Error(`Computed filename looks wrong: ${filename}`);
            }

            const dir = 'preprocessing';
            const file = Bun.file(`${dir}/${filename}`);
            let cards: Sf_Card[];

            if (await file.exists()) {
                console.log(`Found a file named ${filename}, loading it.`);
                cards = JSON.parse(await file.text());
            } else {
                console.log(`No file named ${filename}, downloading bulk data.`);
                cards = await (await fetch(data.download_uri)).json();
                await mkdir(dir, { recursive: true });
                await Bun.write(file, JSON.stringify(cards));
            }

            for (const f of await readdir(dir)) {
                if (f.startsWith(filename_parts[1]) && f.endsWith('.json') && f !== filename) {
                    await unlink(`${dir}/${f}`);
                }
            }

            return cards;
        }
    }

    throw Error(`Couldn't find bulk data URI for type ${type}.`);
}

function full_card_name(card: Card): string {
    return card.name.join(' // ');
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

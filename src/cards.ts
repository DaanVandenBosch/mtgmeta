import { assert, assert_eq, Console_Logger } from './core';
import { INEXACT_REGEX, parse_mana_cost, PER_VERSION_PROPS, type Prop } from './query';

const TEXT_DECODER = new TextDecoder;

export type Sort_Order = 'cmc' | 'name' | 'released_at';
export const SORT_ORDERS: Sort_Order[] = ['cmc', 'name', 'released_at'];

export enum Sort_Type {
    BY_CARD = 1,
    BY_VERSION = 2,
}

export interface Sorter {
    readonly order: Sort_Order;
    readonly type: Sort_Type;

    sort(cards: ReadonlyMap<number, number>, asc: boolean): number[];
}

/** Sorts by card order, which is name by default. */
class Default_Sorter implements Sorter {
    private readonly data: Cards;
    readonly order: Sort_Order;
    readonly type: Sort_Type = Sort_Type.BY_CARD;

    constructor(data: Cards, order: Sort_Order) {
        this.data = data;
        this.order = order;
    }

    sort(cards: ReadonlyMap<number, number>, asc: boolean): number[] {
        const len = this.data.length ?? 0;
        const result = [];

        for (let i = 0; i < len; i++) {
            const card_idx = asc ? i : (len - 1 - i);

            if (cards.has(card_idx)) {
                result.push(card_idx);
            }
        }

        return result;
    }
}

class Index_Sorter implements Sorter {
    static readonly GROUP_HEADER_OFFSET = 32;
    static readonly GROUP_TABLE_OFFSET = Index_Sorter.GROUP_HEADER_OFFSET + 4;

    private readonly data: Cards;
    private view: DataView
    readonly order: Sort_Order;
    readonly type: Sort_Type;
    readonly creation_time: Date;

    constructor(data: Cards, buf: ArrayBuffer) {
        this.data = data;
        this.view = new DataView(buf);

        const identifier = TEXT_DECODER.decode(buf.slice(0, 4));
        const version = this.u16(4);
        const type = this.u8(6);
        const creation_time = new Date(Number(this.u64(8)));

        let order_len = new Uint8Array(buf, 16, 16).indexOf(0);

        if (order_len === -1) {
            order_len = 16;
        }

        const order = TEXT_DECODER.decode(buf.slice(16, 16 + order_len)) as Sort_Order;

        assert_eq(identifier, 'MTGI');
        assert_eq(version, 3);
        assert(type === 1 || type === 2);

        this.order = order;
        this.type = type;
        this.creation_time = creation_time;
    }

    sort(cards: ReadonlyMap<number, number>, asc: boolean): number[] {
        const GROUP_TABLE_OFFSET = Index_Sorter.GROUP_TABLE_OFFSET;
        const type = this.type;
        const len = this.data.length ?? 0;
        const group_count = this.u32(Index_Sorter.GROUP_HEADER_OFFSET);
        const groups_offset = GROUP_TABLE_OFFSET + 4 * group_count;

        let invalid_idx_count = 0;
        const result = [];

        // Each index groups cards by some criterium. The sort direction determines the direction in
        // which we traverse the groups, but not the direction in which we traverse the cards within
        // each group. This ensures cards are always sorted by the given sort order and then by
        // name.
        for (let i = 0; i < group_count; i++) {
            const group_idx = asc ? i : (group_count - 1 - i);
            const group_start =
                group_idx === 0 ? 0 : this.u32(GROUP_TABLE_OFFSET + 4 * (group_idx - 1));
            const group_end = this.u32(GROUP_TABLE_OFFSET + 4 * group_idx);

            for (let j = group_start; j < group_end; j++) {
                const offset = groups_offset + 2 * type * j;
                const card_idx = this.u16(offset);

                if (card_idx >= len) {
                    invalid_idx_count++;
                    continue;
                }

                if (type === Sort_Type.BY_VERSION) {
                    const version_idx = this.u16(offset + 2);

                    if (cards.get(card_idx) === version_idx) {
                        result.push(card_idx);
                    }
                } else {
                    if (cards.has(card_idx)) {
                        result.push(card_idx);
                    }
                }
            }
        }

        if (invalid_idx_count > 0) {
            Console_Logger.error(
                `Sort index for order ${this.order} contains ${invalid_idx_count} card indexes.`
            );
        }

        return result;
    }

    private u8(offset: number): number {
        return this.view.getUint8(offset);
    }

    private u16(offset: number): number {
        return this.view.getUint16(offset, true);
    }

    private u32(offset: number): number {
        return this.view.getUint32(offset, true);
    }

    private u64(offset: number): bigint {
        return this.view.getBigUint64(offset, true);
    }
}

class Out_Of_Date_Error extends Error {
    constructor() {
        super('Some properties are out of date.');
    }
}

export class Cards {
    private _length: number | null = null;
    private props: Map<Prop, any> = new Map;
    private prop_promises: Map<Prop, Promise<void>> = new Map;
    private sorters: Map<Sort_Order, Promise<Sorter>> = new Map;
    private creation_time: Date | null = null;
    private aborter = new AbortController;
    private fetch_with_cache_reload = false;
    private last_clear: number = performance.now();

    get length(): number | null {
        return this._length;
    }

    get load_promise(): Promise<void> {
        return Promise.allSettled(
            [...this.prop_promises.values(), ...this.sorters.values()]
        ) as unknown as Promise<void>;
    }

    data_is_out_of_date() {
        const now = performance.now();

        // We only try refetching with cache reload once every minute.
        if (now - this.last_clear >= 60_000) {
            // Abort all in-flight requests.
            this.aborter.abort();
            this.aborter = new AbortController;

            // Clear all data.
            this._length = null;
            this.props.clear();
            this.prop_promises.clear();
            this.sorters.clear();
            this.creation_time = null;

            // Fetch with Cache-Control set to reload from now on.
            this.fetch_with_cache_reload = true;
            this.last_clear = now;

            // Throw an error to trigger a retry.
            throw new Out_Of_Date_Error;
        } else if (confirm("Some data is out of date, do you want to refresh the page?")) {
            window.location.reload();
        }
    }

    async load(prop: Prop) {
        switch (prop) {
            case 'name_search':
            case 'name_inexact':
                prop = 'name';
                break;

            case 'oracle':
            case 'oracle_search':
            case 'full_oracle_search':
                prop = 'full_oracle';
                break;

            case 'reprint':
                for (const pp_prop of PER_VERSION_PROPS) {
                    const promise = this.prop_promises.get(pp_prop);

                    if (promise !== undefined) {
                        return promise;
                    }
                }

                // Just load *a* per-version property, so we know the version count.
                prop = 'set';
                break;

            case 'type_search':
                prop = 'type';
                break;
        }

        let promise = this.prop_promises.get(prop);

        if (promise === undefined) {
            const init: RequestInit = {
                signal: this.aborter.signal,
                cache: this.fetch_with_cache_reload ? 'reload' : undefined,
            };

            promise = fetch(`data/card_${prop}.json`, init).then(async response => {
                const { creation_time, data } = await response.json();

                if (this.creation_time === null) {
                    this.creation_time = new Date(creation_time);
                } else if (this.creation_time.getTime() !== creation_time) {
                    this.data_is_out_of_date();
                }

                switch (prop) {
                    case 'colors':
                    case 'cost': {
                        for (const faces of data) {
                            for (let i = 0, len = faces.length; i < len; i++) {
                                const value_str = faces[i];

                                // Ignore non-existent values. Also ignore empty mana costs of
                                // the backside of transform cards.
                                if (value_str === null
                                    || (i >= 1 && prop === 'cost' && value_str === '')
                                ) {
                                    faces[i] = null;
                                } else {
                                    faces[i] = parse_mana_cost(value_str).cost;
                                }
                            }
                        }

                        break;
                    }

                    case 'identity': {
                        for (let i = 0, len = data.length; i < len; i++) {
                            data[i] = parse_mana_cost(data[i]).cost;
                        }

                        break;
                    }

                    case 'name': {
                        const search_data = [];
                        const inexact_data = [];

                        for (const values of data) {
                            search_data.push(
                                values
                                    .join(' // ')
                                    .toLocaleLowerCase('en')
                            );
                            inexact_data.push(
                                values
                                    .join('')
                                    .replace(INEXACT_REGEX, '')
                                    .toLocaleLowerCase('en')
                            );
                        }

                        this.props.set('name_search', search_data);
                        this.props.set('name_inexact', inexact_data);
                        break;
                    }

                    case 'full_oracle': {
                        const oracle_data = [];
                        const oracle_search_data = [];
                        const full_oracle_search_data = [];

                        for (const full_oracle_texts of data) {
                            const oracle_texts = [];
                            const oracle_search_texts = [];
                            const full_oracle_search_values = [];

                            for (const full_oracle_text of full_oracle_texts) {
                                const oracle_text = remove_parenthesized_text(full_oracle_text);
                                oracle_texts.push(oracle_text);
                                oracle_search_texts.push(
                                    oracle_text.toLocaleLowerCase('en')
                                );
                                full_oracle_search_values.push(
                                    full_oracle_text.toLocaleLowerCase('en')
                                );
                            }

                            oracle_data.push(oracle_texts);
                            oracle_search_data.push(oracle_search_texts);
                            full_oracle_search_data.push(full_oracle_search_values);
                        }

                        this.props.set('oracle', oracle_data);
                        this.props.set('oracle_search', oracle_search_data);
                        this.props.set('full_oracle_search', full_oracle_search_data);
                        break;
                    }

                    case 'type': {
                        const search_data = data.map((values: string[]) =>
                            values.map(v => v.toLocaleLowerCase('en'))
                        );
                        this.props.set((prop + '_search') as Prop, search_data);
                        break;
                    }

                    case 'released_at': {
                        for (const values of data) {
                            for (let i = 0, len = values.length; i < len; i++) {
                                values[i] = new Date(values[i] + 'T00:00:00Z');
                            }
                        }

                        break;
                    }
                }

                this.props.set(prop, data);
                this._length = data.length;
            });

            this.prop_promises.set(prop, promise);
        }

        return promise;
    }

    /** Returns the value or values of a card property. */
    get<T>(idx: number, prop: Prop): T | null {
        return this.props.get(prop)?.at(idx) ?? null;
    }

    /** Returns the value or values of a property for a specific version. */
    get_for_version<T>(idx: number, version_idx: number, prop: Prop): T | null {
        // Reprint is a logical property, every version except the first is a reprint.
        if (prop === 'reprint') {
            return (version_idx !== 0) as T;
        }

        const value = this.props.get(prop)?.at(idx);

        if (value == null) {
            return null;
        }

        if (PER_VERSION_PROPS.includes(prop)) {
            return value[version_idx] ?? null;
        } else {
            return value;
        }
    }

    version_count(idx: number): number | null {
        for (const pp_prop of PER_VERSION_PROPS) {
            const values = this.get<any[]>(idx, pp_prop);

            if (values !== null) {
                return values.length;
            }
        }

        return null;
    }

    name(idx: number): string | null {
        const names = this.get<string[]>(idx, 'name');

        if (names === null || names.length == 0) {
            return null;
        }

        return names.join(' // ');
    }

    scryfall_url(idx: number): string | null {
        const sfurl = this.get<string>(idx, 'sfurl');

        if (sfurl === null) {
            return null;
        }

        return `https://scryfall.com/${sfurl}`;
    }

    image_url(idx: number): string | null {
        const imgs = this.get<string[]>(idx, 'img');

        if (imgs === null || imgs.length === 0) {
            return null;
        }

        return `https://cards.scryfall.io/normal/${imgs[0]}`;
    }

    async get_sorter(order: Sort_Order): Promise<Sorter> {
        let promise = this.sorters.get(order);

        if (promise === undefined) {
            if (order === 'name') {
                promise = Promise.resolve(new Default_Sorter(this, order));
            } else {
                const init: RequestInit = {
                    signal: this.aborter.signal,
                    cache: this.fetch_with_cache_reload ? 'reload' : undefined,
                };

                promise = fetch(`data/card_${order}.sort`, init).then(async response => {
                    const sorter = new Index_Sorter(this, await response.arrayBuffer());
                    assert_eq(sorter.order, order);

                    if (this.creation_time === null) {
                        this.creation_time = sorter.creation_time;
                    } else if (this.creation_time.getTime() !== sorter.creation_time.getTime()) {
                        this.data_is_out_of_date();
                    }

                    return sorter;
                });
            }

            this.sorters.set(order, promise);
        }

        return promise;
    }
}

export function remove_parenthesized_text(s: string): string {
    const len = s.length;
    let start_idx = 0;
    let paren_count = 0;
    let result = '';

    for (let i = 0; i < len; i++) {
        switch (s[i]) {
            case '(': {
                if (paren_count <= 0) {
                    // Reset paren count to zero in case there were more right parens than left
                    // parens. This makes us ignore excess right parens.
                    paren_count = 0;
                    let end_idx = i;

                    if (end_idx > 0 && s[end_idx - 1] === ' ') {
                        end_idx--;
                    }

                    result += s.slice(start_idx, end_idx);
                }

                paren_count++;
                break;
            }

            case ')': {
                paren_count--;

                if (paren_count <= 0) {
                    start_idx = i + 1;
                }

                break;
            }
        }
    }

    if (paren_count === 0) {
        result += s.slice(start_idx, s.length);
    }

    return result;
}

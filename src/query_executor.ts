import type { Cards, Sort_Order } from "./cards";
import { assert, Nop_Logger, TEXT_ENCODER, unreachable, type Logger } from "./core";
import {
    MANA_BLACK,
    MANA_BLUE,
    MANA_COLORLESS,
    MANA_GENERIC,
    MANA_GENERIC_X,
    MANA_GREEN,
    MANA_PHYREXIAN,
    MANA_RED,
    MANA_SNOW,
    MANA_WHITE,
    type Condition,
    type Mana_Cost,
    type Prop,
    type Query,
} from "./query";
import { find_cards_matching_query, PROPS_REQUIRED_FOR_DISPLAY } from "./query_eval";
import type { Subset_Store } from "./subset";
const freeze = Object.freeze;

/** The ASCII string "MTGQ", reversed. */
const IDENTIFIER_MTGQ = 0x5147544D;

const PROP_TO_INT: Readonly<{ [p in Prop]: number }> = freeze({
    colors: 1,
    formats: 2,
    identity: 3,
    img: 4,
    cost: 5,
    cmc: 6,
    landscape: 7,
    name: 8,
    name_search: 9,
    name_inexact: 10,
    oracle: 11,
    oracle_search: 12,
    full_oracle: 13,
    full_oracle_search: 14,
    rarity: 15,
    released_at: 16,
    reprint: 17,
    set: 18,
    sfurl: 19,
    type: 20,
    type_search: 21,
});

const CONDITION_TYPE_TO_INT: Readonly<{ [type in Condition['type']]: number }> = freeze({
    true: 1,
    false: 2,
    not: 3,
    or: 4,
    and: 5,
    eq: 6,
    ne: 7,
    lt: 8,
    gt: 9,
    le: 10,
    ge: 11,
    substring: 12,
    even: 13,
    odd: 14,
    range: 15,
    subset: 16,
});

const tmp_buf = new ArrayBuffer(4 << 10, { maxByteLength: 1 << 20 });
const tmp_view = new DataView(tmp_buf);

export class Query_Executor {
    private readonly logger: Logger;
    private readonly cards: Cards;
    private readonly subset_store: Subset_Store;
    private readonly executions_underway: Map<bigint, Promise<readonly number[]>> = new Map;

    constructor(logger: Logger, cards: Cards, subset_store: Subset_Store) {
        this.logger = logger;
        this.cards = cards;
        this.subset_store = subset_store;
    }

    /** Preloads properties and sorter needed for a given query and sort order. */
    async preload_data(query: Query, sort_order: Sort_Order): Promise<void> {
        await this.execute_retrying('preloading properties', () => {
            const loads = [
                ...query.props.map(prop => this.cards.load(prop)),
                this.cards.get_sorter(sort_order),
            ];
            return Promise.all(loads);
        });
    }

    async execute(
        query: Query,
        sort_order: Sort_Order,
        sort_asc: boolean,
    ): Promise<readonly number[]> {
        const logger = this.logger;
        const hash: bigint = await query_hash(query);
        const existing_promise: Promise<readonly number[]> | undefined =
            this.executions_underway.get(hash);

        if (existing_promise) {
            return await existing_promise;
        }

        logger.group('Executing card query.');

        logger.time(this.execute.name);
        logger.log('query:', query);

        const promise: Promise<readonly number[]> = this.execute_retrying(
            'executing query',
            () => this.execute_query_attempt(query, sort_order, sort_asc),
        );
        this.executions_underway.set(hash, promise);

        const result = await promise;
        this.executions_underway.delete(hash);

        logger.time_end(this.execute.name);
        logger.group_end();

        return result;
    }

    private async execute_retrying<T>(
        description: string,
        operation: () => Promise<T>,
    ): Promise<T> {
        const MAX_LOAD_ATTEMPTS = 2;

        let exception: any;

        for (let attempt = 1; attempt <= MAX_LOAD_ATTEMPTS; attempt++) {
            try {
                return await operation();
            } catch (e) {
                if (attempt < MAX_LOAD_ATTEMPTS) {
                    this.logger.error(`Error while ${description}, retrying.`, e);
                    exception = e;
                    continue;
                } else {
                    throw e;
                }
            }
        }

        throw exception;
    }

    private async execute_query_attempt(
        query: Query,
        sort_order: Sort_Order,
        sort_asc: boolean,
    ): Promise<readonly number[]> {
        const logger = this.logger;
        logger.time(this.execute_query_attempt.name);
        logger.time('load');

        // Fire off data loads.
        const required_for_query_promises = query.props.map(prop => this.cards.load(prop));
        const required_for_display_promises =
            PROPS_REQUIRED_FOR_DISPLAY.map(prop => this.cards.load(prop));

        const sorter_promise = this.cards.get_sorter(sort_order);

        // Await data loads necessary for query.
        for (const promise of required_for_query_promises) {
            await promise;
        }

        // Await at least one display property if we have no required properties to wait for, just
        // to get the amount of cards.
        if (this.cards.length === null) {
            await Promise.race(required_for_display_promises);
        }

        logger.time_end('load');
        logger.time('find_cards_matching_query');

        const card_indexes =
            find_cards_matching_query(this.cards, this.subset_store, query, () => Nop_Logger);

        logger.time_end('find_cards_matching_query');
        logger.time('load_sorter');

        const sorter = await sorter_promise;

        logger.time_end('load_sorter');
        logger.time('sort');

        const sorted_card_indexes = sorter.sort(card_indexes, sort_asc);

        logger.time_end('sort');
        logger.time('load_display');

        // Await data loads necessary for display.
        for (const promise of required_for_display_promises) {
            await promise;
        }

        logger.time_end('load_display');
        logger.time_end(this.execute_query_attempt.name);

        return sorted_card_indexes;
    }
}

export async function query_hash(query: Query): Promise<bigint> {
    const writer = new Buffer_Writer(tmp_buf, tmp_view);
    query_to_buf(query, writer);
    const bytes = await globalThis.crypto.subtle.digest("SHA-256", writer.copy());
    const hash = new DataView(bytes);
    return (hash.getBigUint64(0) << 192n)
        | (hash.getBigUint64(1) << 128n)
        | (hash.getBigUint64(2) << 64n)
        | hash.getBigUint64(3);
}

function query_to_buf(query: Query, writer: Buffer_Writer): void {
    assert(query.props.length <= 255);

    writer.write_u32(IDENTIFIER_MTGQ);
    writer.write_u16(1); // Version.
    writer.write_u16(0); // Padding.

    condition_to_buf(query.condition, writer);
}

function condition_to_buf(condition: Condition, writer: Buffer_Writer): void {
    writer.write_u8(CONDITION_TYPE_TO_INT[condition.type]);

    switch (condition.type) {
        case 'false':
        case 'true':
            break;
        case 'not':
            condition_to_buf(condition.condition, writer);
            break;
        case 'or':
            conditions_to_buf(condition.conditions, writer);
            break;
        case 'and':
            conditions_to_buf(condition.conditions, writer);
            break;
        case 'eq':
        case 'ne':
        case 'lt':
        case 'gt':
        case 'le':
        case 'ge':
        case 'substring':
            writer.write_u8(PROP_TO_INT[condition.prop]);
            prefixed_value_to_buf(condition.value, writer);
            break;
        case 'even':
        case 'odd':
            writer.write_u8(PROP_TO_INT[condition.prop]);
            break;
        case 'range':
            writer.write_u8(PROP_TO_INT[condition.prop]);
            writer.write_u8((condition.start_inc ? 1 : 0) | (condition.end_inc ? 2 : 0));
            values_to_buf(condition.start, condition.end, writer);
            break;
        case 'subset':
            string_to_buf(condition.id, writer);
            break;
        default:
            unreachable(condition['type']);
    }
}

function conditions_to_buf(conditions: readonly Condition[], writer: Buffer_Writer): void {
    assert(conditions.length <= 65535);

    writer.write_u16(conditions.length);

    for (const condition of conditions) {
        condition_to_buf(condition, writer);
    }
}

function string_to_buf(str: string, writer: Buffer_Writer): void {
    writer.write_u16(str.length);
    writer.write_utf8(str);
}

function prefixed_value_to_buf(
    value: boolean | number | string | Date | Mana_Cost,
    writer: Buffer_Writer,
): void {
    if (typeof value === 'boolean') {
        writer.write_u8(1);
        writer.write_u8(value ? 1 : 0);
    } else if (typeof value === 'number') {
        assert(value >= (0x80000000 | 0) && value <= 0x7FFFFFFF);
        writer.write_u8(2);
        writer.write_i32(value);
    } else if (typeof value === 'string') {
        writer.write_u8(3);
        string_to_buf(value, writer);
    } else if (value instanceof Date) {
        writer.write_u8(4);
        writer.write_f64(value.getTime());
    } else {
        writer.write_u8(5);
        mana_cost_to_buf(value, writer);
    }
}

function values_to_buf(
    value1: number | Date,
    value2: number | Date,
    writer: Buffer_Writer,
): void {
    if (typeof value1 === 'number') {
        assert(typeof value2 === 'number');
        assert(value1 >= (0x80000000 | 0) && value1 <= 0x7FFFFFFF);
        assert(value2 >= (0x80000000 | 0) && value2 <= 0x7FFFFFFF);
        writer.write_u8(2);
        writer.write_i32(value1);
        writer.write_i32(value2);
    } else {
        assert(value2 instanceof Date);
        writer.write_u8(4);
        writer.write_f64(value1.getTime());
        writer.write_f64(value2.getTime());
    }
}

function mana_cost_to_buf(cost: Mana_Cost, writer: Buffer_Writer): void {
    const types = Object.keys(cost);
    writer.write_u8(types.length);

    for (const type of types) {
        let int = 0;

        for (const c of type) {
            switch (c) {
                case '/':
                    continue;
                case MANA_WHITE:
                    int |= 0x0001;
                    break;
                case MANA_BLUE:
                    int |= 0x0002;
                    break;
                case MANA_BLACK:
                    int |= 0x0004;
                    break;
                case MANA_RED:
                    int |= 0x0008;
                    break;
                case MANA_GREEN:
                    int |= 0x0010;
                    break;
                case MANA_COLORLESS:
                    int |= 0x0020;
                    break;
                case MANA_GENERIC:
                    int |= 0x0040;
                    break;
                case MANA_GENERIC_X:
                    int |= 0x0080;
                    break;
                case MANA_SNOW:
                    int |= 0x0100;
                    break;
                case MANA_PHYREXIAN:
                    int |= 0x0200;
                    break;
                default:
                    unreachable(c);
            }
        }

        writer.write_u16(int);
        const amount = cost[type];
        assert(amount >= 0 && amount <= 0xFFFFFFFF);
        writer.write_u32(amount);
    }
}

class Buffer_Writer {
    private readonly buf: ArrayBuffer;
    private readonly view: DataView;
    private pos = 0;

    constructor(buf: ArrayBuffer, view: DataView) {
        this.buf = buf;
        this.view = view;
    }

    copy(): ArrayBuffer {
        return this.buf.slice(0, this.pos);
    }

    write_u8(value: number): void {
        this.ensure_space(1);
        this.view.setUint8(this.pos, value);
        this.pos++;
    }

    write_u16(value: number): void {
        this.ensure_space(2);
        this.view.setUint16(this.pos, value, true);
        this.pos += 2;
    }

    write_u32(value: number): void {
        this.ensure_space(4);
        this.view.setUint32(this.pos, value, true);
        this.pos += 4;
    }

    write_f64(value: number): void {
        this.ensure_space(8);
        this.view.setFloat64(this.pos, value, true);
        this.pos += 8;
    }

    write_i32(value: number): void {
        this.ensure_space(4);
        this.view.setInt32(this.pos, value, true);
        this.pos += 4;
    }

    write_utf8(value: string): void {
        const buf = TEXT_ENCODER.encode(value);
        this.ensure_space(buf.byteLength);
        new Uint8Array(this.buf, this.pos, buf.byteLength).set(buf);
        this.pos += buf.byteLength;
    }

    private ensure_space(space: number): void {
        if (this.buf.byteLength - this.pos < space) {
            this.increase_cap();
        }
    }

    private increase_cap() {
        this.buf.resize(2 * this.buf.byteLength);
    }
}

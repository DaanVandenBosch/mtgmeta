import { Buffer } from "./buffer";
import { assert, unreachable } from "./core";
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

const tmp_buf = new ArrayBuffer(10 << 20);
const tmp_view = new DataView(tmp_buf);

export async function query_hash(query: Query): Promise<bigint> {
    const buffer = Buffer.of_array_buffer(tmp_buf, tmp_view);
    query_to_buf(query, buffer);
    // Take a copy of the buffer, because multiple query_hash invocations might happen concurrently.
    const serialized_query = buffer.copy();
    const bytes = await globalThis.crypto.subtle.digest("SHA-256", serialized_query);
    const hash = new DataView(bytes);
    return (hash.getBigUint64(0) << 192n)
        | (hash.getBigUint64(1) << 128n)
        | (hash.getBigUint64(2) << 64n)
        | hash.getBigUint64(3);
}

function query_to_buf(query: Query, writer: Buffer): void {
    assert(query.props.length <= 255);

    writer.write_u32(IDENTIFIER_MTGQ);
    writer.write_u16(1); // Version.
    writer.write_u16(0); // Padding.

    condition_to_buf(query.condition, writer);
}

function condition_to_buf(condition: Condition, writer: Buffer): void {
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

function conditions_to_buf(conditions: readonly Condition[], writer: Buffer): void {
    assert(conditions.length <= 65535);

    writer.write_u16(conditions.length);

    for (const condition of conditions) {
        condition_to_buf(condition, writer);
    }
}

function string_to_buf(str: string, writer: Buffer): void {
    writer.write_u16(str.length);
    writer.write_utf8(str);
}

function prefixed_value_to_buf(
    value: boolean | number | string | Date | Mana_Cost,
    writer: Buffer,
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
    writer: Buffer,
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

function mana_cost_to_buf(cost: Mana_Cost, writer: Buffer): void {
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

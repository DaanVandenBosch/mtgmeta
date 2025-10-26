import { unreachable, type Logger, Nop_Logger, assert } from './core';
import { type Uint_Set, Bitset, Bitset_32, Array_Set } from './uint_set';
import {
    type Query,
    type Prop,
    type Condition,
    type Comparison_Condition,
    type Substring_Condition,
    type Predicate_Condition,
    type Range_Condition,
    type Mana_Cost,
    PER_VERSION_PROPS,
    MANA_GENERIC,
    RARITY_COMMON,
    RARITY_UNCOMMON,
    RARITY_RARE,
    RARITY_MYTHIC,
    RARITY_SPECIAL,
    RARITY_BONUS,
} from './query';
import { Cards, type Sort_Order } from './cards';
const freeze = Object.freeze;

export const PROPS_REQUIRED_FOR_DISPLAY: readonly Prop[] = freeze(['sfurl', 'img', 'landscape']);

const RARITY_RANK = freeze({
    [RARITY_COMMON]: 0,
    [RARITY_UNCOMMON]: 1,
    [RARITY_RARE]: 2,
    [RARITY_SPECIAL]: 3,
    [RARITY_MYTHIC]: 4,
    [RARITY_BONUS]: 5,
});

export async function find_cards_matching_query_old(
    cards: Cards,
    query: Query,
    sort_order: Sort_Order,
    sort_asc: boolean,
    logger: Logger,
    card_logger: (idx: number) => Logger,
): Promise<number[]> {
    logger.time('find_cards_matching_query');
    logger.log('query', query);
    logger.time('find_cards_matching_query_load');

    // Fire off data loads.
    const required_for_query_promises = query.props.map(prop => cards.load(prop));
    const required_for_display_promises = PROPS_REQUIRED_FOR_DISPLAY.map(prop => cards.load(prop));
    const sorter_promise = cards.get_sorter(sort_order);

    // Await data loads necessary for query.
    for (const promise of required_for_query_promises) {
        await promise;
    }

    // Await at least one display property if we have no required properties to wait for, just to
    // get the amount of cards.
    if (cards.length === null) {
        await Promise.race(required_for_display_promises);
    }

    logger.time_end('find_cards_matching_query_load');
    logger.time('find_cards_matching_query_evaluate');

    const matching_cards = await find_cards_matching_query(cards, query, card_logger);

    logger.time_end('find_cards_matching_query_evaluate');
    logger.time('find_cards_matching_query_load_sorter');

    const sorter = await sorter_promise;

    logger.time_end('find_cards_matching_query_load_sorter');
    logger.time('find_cards_matching_query_sort');

    const result = sorter.sort(matching_cards, sort_asc);

    logger.time_end('find_cards_matching_query_sort');
    logger.time('find_cards_matching_query_load_display');

    // Await data loads necessary for display.
    for (const promise of required_for_display_promises) {
        await promise;
    }

    logger.time_end('find_cards_matching_query_load_display');
    logger.time_end('find_cards_matching_query');

    return result;
}

export async function find_cards_matching_query(
    cards: Cards,
    query: Query,
    card_logger: (idx: number) => Logger,
): Promise<Map<number, number>> {
    assert(cards.length !== null);

    const evaluator = new Query_Evaluator(cards, query, true, true);
    const matching_cards = new Map<number, number>();

    for (let card_idx = 0; card_idx < cards.length; card_idx++) {
        try {
            const result = evaluator.evaluate(card_idx, card_logger(card_idx));
            const version_idx = result.first_or_null();

            if (version_idx !== null) {
                matching_cards.set(card_idx, version_idx);
            }
        } catch (e) {
            throw Error(
                `Couldn't evaluate query with "${cards.name(card_idx)}".`,
                { cause: e },
            );
        }
    }

    return matching_cards;
}

export class Query_Evaluator {
    private readonly cards: Cards;
    private readonly query: Query;
    private readonly bitset: boolean;
    private readonly small_set_optimization: boolean;
    private card_idx: number = 0;
    private logger: Logger = Nop_Logger;

    constructor(cards: Cards, query: Query, bitset: boolean, small_set_optimization: boolean) {
        this.cards = cards;
        this.query = query;
        this.bitset = bitset;
        this.small_set_optimization = small_set_optimization;
    }

    evaluate(card_idx: number, logger: Logger): Uint_Set {
        this.card_idx = card_idx;
        this.logger = logger;

        const version_count = this.cards.version_count(card_idx) ?? 1;

        if (logger.should_log) {
            const name = this.cards.name(card_idx);
            logger.log('evaluating query with', name, card_idx, 'versions', version_count);
        }

        let version_idxs;
        let set_type;

        if (this.small_set_optimization && version_count <= 32) {
            version_idxs = Bitset_32.with_cap(version_count);
            version_idxs.fill();
            set_type = 0;
        } else if (this.bitset) {
            Bitset.reset_mem();
            version_idxs = Bitset.with_cap(version_count);
            version_idxs.fill();
            set_type = 1;
        } else {
            Array_Set.reset_mem();
            version_idxs = new Array_Set();
            version_idxs.fill_to(version_count);
            set_type = 2;
        }

        this.evaluate_condition(this.query.condition, version_idxs, set_type);

        return version_idxs;
    }

    private evaluate_condition(condition: Condition, version_idxs: Uint_Set, set_type: number) {
        this.logger.group(condition.type, condition);

        switch (condition.type) {
            case 'true': {
                break;
            }
            case 'false': {
                version_idxs.clear();
                break;
            }
            case 'or': {
                const idxs = version_idxs.copy();
                const sub_idxs = version_idxs.copy();
                version_idxs.clear();

                for (const cond of condition.conditions) {
                    idxs.copy_into(sub_idxs);
                    this.evaluate_condition(cond, sub_idxs, set_type);
                    version_idxs.union(sub_idxs);

                    if (version_idxs.size === idxs.size) {
                        break;
                    }
                }

                break;
            }
            case 'and': {
                for (const cond of condition.conditions) {
                    this.evaluate_condition(cond, version_idxs, set_type);

                    if (version_idxs.size === 0) {
                        break;
                    }
                }

                break;
            }
            case 'not': {
                const sub_idxs = version_idxs.copy();
                this.evaluate_condition(condition.condition, sub_idxs, set_type);
                version_idxs.diff(sub_idxs);
                break;
            }
            default: {
                switch (set_type) {
                    case 0:
                        this.evaluate_property_condition_bitset_32(
                            condition,
                            version_idxs as Bitset_32,
                        );
                        break;
                    case 1:
                        this.evaluate_property_condition_bitset(
                            condition,
                            version_idxs as Bitset,
                        );
                        break;
                    case 2:
                        this.evaluate_property_condition_array_set(
                            condition,
                            version_idxs as Array_Set,
                        );
                        break;
                    default:
                        unreachable();
                }

                break;
            }
        }

        if (this.logger.should_log) {
            this.logger.log('result', version_idxs.to_array());
        }

        this.logger.group_end();
    }

    private evaluate_property_condition_bitset_32(
        condition: Comparison_Condition | Substring_Condition | Predicate_Condition | Range_Condition,
        version_idxs: Bitset_32,
    ) {
        if (PER_VERSION_PROPS.includes(condition.prop)) {
            let values = version_idxs.values;
            const cap = version_idxs.cap;
            let size = version_idxs.size;

            for (let version_idx = 0; version_idx < cap; version_idx++) {
                const bit_mask = 1 << version_idx;

                if ((values & bit_mask) === 0) {
                    continue;
                }

                if (!this.evaluate_property_condition_with_version(condition, version_idx)) {
                    values &= ~bit_mask;
                    size -= 1;
                }
            }

            version_idxs.values = values;
            version_idxs.size = size;
        } else if (!this.evaluate_property_condition_with_version(condition, 0)) {
            version_idxs.clear();
        }
    }

    private evaluate_property_condition_bitset(
        condition: Comparison_Condition | Substring_Condition | Predicate_Condition | Range_Condition,
        version_idxs: Bitset,
    ) {
        if (PER_VERSION_PROPS.includes(condition.prop)) {
            const m_off = version_idxs.m_off;
            const len = version_idxs.m_end - m_off;
            let bits_left = version_idxs.cap;
            let size = version_idxs.size;

            for (let i = 0; i < len; i++, bits_left -= 32) {
                let slot = Bitset.mem[m_off + i];

                if (slot === 0) {
                    continue;
                }

                const bits_end = Math.min(bits_left, 32);

                for (let j = 0; j < bits_end; j++) {
                    if ((slot & (1 << j)) === 0) {
                        continue;
                    }

                    const version_idx = i * 32 + j;

                    if (!this.evaluate_property_condition_with_version(condition, version_idx)) {
                        slot &= ~(1 << j);
                        size -= 1;
                    }
                }

                Bitset.mem[m_off + i] = slot;
            }

            version_idxs.size = size;
        } else if (!this.evaluate_property_condition_with_version(condition, 0)) {
            version_idxs.clear();
        }
    }

    private evaluate_property_condition_array_set(
        condition: Comparison_Condition | Substring_Condition | Predicate_Condition | Range_Condition,
        version_idxs: Array_Set,
    ) {
        if (PER_VERSION_PROPS.includes(condition.prop)) {
            for (let i = version_idxs.size; i > 0;) {
                i--;
                const version_idx = version_idxs.at(i);

                if (!this.evaluate_property_condition_with_version(condition, version_idx)) {
                    version_idxs.delete_at(i);
                }
            }
        } else if (!this.evaluate_property_condition_with_version(condition, 0)) {
            version_idxs.clear();
        }
    }

    private evaluate_property_condition_with_version(
        condition: Comparison_Condition | Substring_Condition | Predicate_Condition | Range_Condition,
        version_idx: number,
    ): boolean {
        let values: any = this.cards.get_for_version(this.card_idx, version_idx, condition.prop);

        if (!Array.isArray(values)) {
            values = [values];
        }

        this.logger.log('values', values);

        const is_color_or_id = condition.prop === 'colors' || condition.prop === 'identity';

        if (is_color_or_id && typeof (condition as Comparison_Condition).value === 'number') {
            const cond_value = (condition as Comparison_Condition).value as number;

            for (const value of values) {
                // Ignore non-existent values.
                if (value === null) {
                    continue;
                }

                const count = Object.keys(value).length;
                let result;

                switch (condition.type) {
                    case 'eq':
                        result = count === cond_value;
                        break;
                    case 'ne':
                        result = count !== cond_value;
                        break;
                    case 'gt':
                        result = count > cond_value;
                        break;
                    case 'lt':
                        result = count < cond_value;
                        break;
                    case 'ge':
                        result = count >= cond_value;
                        break;
                    case 'le':
                        result = count <= cond_value;
                        break;
                    default:
                        unreachable(
                            `Invalid condition type "${condition.type}" for property "${condition.prop}".`
                        );
                }

                if (result) {
                    return true;
                }
            }

            return false;
        } else if (is_color_or_id || condition.prop === 'cost') {
            const cond_value = (condition as Comparison_Condition).value as Mana_Cost;

            for (const value of values) {
                // Ignore non-existent values.
                if (value === null) {
                    continue;
                }

                let result;

                switch (condition.type) {
                    case 'eq':
                        result = mana_cost_eq(value, cond_value, this.logger);
                        break;
                    case 'ne':
                        result = !mana_cost_eq(value, cond_value, this.logger);
                        break;
                    case 'gt':
                        result = mana_cost_is_super_set(value, cond_value, true, this.logger);
                        break;
                    case 'lt':
                        result = mana_cost_is_super_set(cond_value, value, true, this.logger);
                        break;
                    case 'ge':
                        result = mana_cost_is_super_set(value, cond_value, false, this.logger);
                        break;
                    case 'le':
                        result = mana_cost_is_super_set(cond_value, value, false, this.logger);
                        break;
                    default:
                        unreachable(
                            `Invalid condition type "${condition.type}" for property "${condition.prop}".`
                        );
                }

                if (result) {
                    return true;
                }
            }

            return false;
        } else {
            let eq: (a: any, b: any) => boolean = (a, b) => a === b;
            let compare: (a: any, b: any) => number = (a, b) => a - b;

            if (condition.prop === 'rarity') {
                compare = (a, b) => (RARITY_RANK as any)[a] - (RARITY_RANK as any)[b];
            } else if (condition.prop === 'released_at') {
                eq = (a, b) => a - b === 0
            }

            for (const value of values) {
                // Ignore non-existent values.
                if (value === null) {
                    continue;
                }

                let result;

                switch (condition.type) {
                    case 'eq':
                        result = eq(value, condition.value);
                        break;
                    case 'ne':
                        result = !eq(value, condition.value);
                        break;
                    case 'gt':
                        result = compare(value, condition.value) > 0;
                        break;
                    case 'lt':
                        result = compare(value, condition.value) < 0;
                        break;
                    case 'ge':
                        result = compare(value, condition.value) >= 0;
                        break;
                    case 'le':
                        result = compare(value, condition.value) <= 0;
                        break;
                    case 'even':
                        result = value % 2 === 0;
                        break;
                    case 'odd':
                        result = value % 2 !== 0;
                        break;
                    case 'substring':
                        result = value.includes(condition.value);
                        break;
                    case 'range': {
                        const start_compare = compare(value, condition.start);

                        if (start_compare < 0) {
                            result = false;
                            break;
                        }

                        const end_compare = compare(value, condition.end);

                        if (end_compare > 0) {
                            result = false;
                            break;
                        }

                        result = (start_compare > 0 || condition.start_inc)
                            && (end_compare < 0 || condition.end_inc);

                        break;
                    }
                    default:
                        unreachable(`Invalid condition type "${(condition as Condition).type}".`);
                }

                if (condition.type === 'ne') {
                    if (!result) {
                        return false;
                    }
                } else {
                    if (result) {
                        return true;
                    }
                }
            }

            return condition.type === 'ne';
        }
    }
}

function mana_cost_eq(a: Mana_Cost, b: Mana_Cost, logger: Logger): boolean {
    if (Object.keys(a).length !== Object.keys(b).length) {
        return false;
    }

    for (const [symbol, b_count] of Object.entries(b)) {
        const a_count = a[symbol];

        if (a_count !== b_count) {
            if (a_count === undefined) {
                logger.log('No symbol', symbol, 'in a:', a, 'b:', b);
            } else {
                logger.log('Symbol', symbol, 'value', a_count, '!==', b_count, 'a:', a, 'b:', b);
            }

            return false;
        }
    }

    return true;
}

/** Returns true if a is a super set of b. */
function mana_cost_is_super_set(
    a: Mana_Cost,
    b: Mana_Cost,
    strict: boolean,
    logger: Logger,
): boolean {
    let a_symbols = Object.keys(a).length;
    const b_symbols = Object.keys(b).length;

    if (a_symbols < b_symbols) {
        logger.log('a has fewer symbols than b.', a, b);
        return false;
    }

    let a_total = 0;
    let b_total = 0;

    for (const [symbol, b_count] of Object.entries(b)) {
        const a_count = a[symbol] ?? 0;

        if (a_count < b_count) {
            logger.log('Symbol', symbol, 'value', a_count, '<', b_count, 'a:', a, 'b:', b);
            return false;
        }

        a_total += a_count;
        b_total += b_count;
    }

    if (!strict) {
        return true;
    }

    if (a_total > b_total) {
        return true;
    }

    // If b is exactly zero cost, pretend a has a generic zero cost too. This makes queries like
    // mana<{R} return 0 cost cards.
    if (b[MANA_GENERIC] === 0 && b_symbols === 1 && !(MANA_GENERIC in a)) {
        a_symbols += 1;
    }

    if (a_symbols > b_symbols) {
        return true;
    } else {
        logger.log("a doesn't have more symbols than b.", a, b);
        return false;
    }
}

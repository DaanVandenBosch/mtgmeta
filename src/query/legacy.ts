import { unreachable, type Logger, Nop_Logger, assert } from '../core';
import { type Uint_Set, Bitset, Bitset_32, Array_Set } from '../uint_set';
import {
    type Query,
    type Condition,
    type Comparison_Condition,
    type Substring_Condition,
    type Predicate_Condition,
    type Range_Condition,
    type Mana_Cost,
    PER_VERSION_PROPS,
    MANA_GENERIC,
    type Rarity,
    type Property_Condition,
    RARITY_RANK,
    QUERY_NONE,
} from './query';
import { Cards } from '../cards';
import type { Subset_Store } from '../subset';
import type { Query_Engine_Interface } from './engine';

enum Uint_Set_Type {
    BIT32,
    BIT,
    ARRAY,
}

export class Legacy_Query_Engine implements Query_Engine_Interface {
    private readonly cards: Cards;
    private readonly subset_store: Subset_Store;
    private readonly bitset: boolean;
    private readonly small_set_optimization: boolean;
    private query: Query = QUERY_NONE;
    private card_idx: number = 0;
    private logger: Logger = Nop_Logger;

    constructor(
        cards: Cards,
        subset_store: Subset_Store,
        bitset: boolean,
        small_set_optimization: boolean,
    ) {
        this.cards = cards;
        this.subset_store = subset_store;
        this.bitset = bitset;
        this.small_set_optimization = small_set_optimization;
    }

    execute(
        _logger: Logger,
        card_logger: (card_idx: number) => Logger,
        query: Query,
    ): ReadonlyMap<number, number> {
        const cards_len = this.cards.length;
        assert(cards_len !== null);

        this.query = query;

        const matching_cards: Map<number, number> = new Map;

        for (let card_idx = 0; card_idx < cards_len; card_idx++) {
            this.card_idx = card_idx;
            this.logger = card_logger(card_idx);

            try {
                const result = this.evaluate();
                const version_idx = result.first_or_null();

                if (version_idx !== null) {
                    matching_cards.set(card_idx, version_idx);
                }
            } catch (e) {
                throw Error(
                    `Couldn't evaluate query with "${this.cards.name(card_idx) ?? card_idx}".`,
                    { cause: e },
                );
            }
        }

        return matching_cards;
    }

    private evaluate(): Uint_Set {
        const version_count = this.cards.version_count(this.card_idx) ?? 1;

        if (this.logger.should_log) {
            const name = this.cards.name(this.card_idx);
            this.logger.log('evaluating query with', name, this.card_idx, 'versions', version_count);
        }

        let version_idxs;
        let set_type: Uint_Set_Type;

        if (this.small_set_optimization && version_count <= 32) {
            version_idxs = Bitset_32.with_cap(version_count);
            set_type = Uint_Set_Type.BIT32;
        } else if (this.bitset) {
            version_idxs = Bitset.with_cap(version_count);
            set_type = Uint_Set_Type.BIT;
        } else {
            version_idxs = Array_Set.with_cap(version_count);
            set_type = Uint_Set_Type.ARRAY;
        }

        version_idxs.fill();

        this.evaluate_condition(this.query.condition, version_idxs, set_type);

        return version_idxs;
    }

    private evaluate_condition(
        condition: Condition,
        version_idxs: Uint_Set,
        set_type: Uint_Set_Type,
    ) {
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
                const orig_version_idxs = version_idxs.copy();
                // TODO: Don't make a copy, create a new Uint_Set for sub_idxs.
                const sub_idxs = version_idxs.copy();
                version_idxs.clear();

                for (const cond of condition.conditions) {
                    orig_version_idxs.copy_into(sub_idxs);
                    this.evaluate_condition(cond, sub_idxs, set_type);
                    version_idxs.union(sub_idxs);

                    if (version_idxs.size === orig_version_idxs.size) {
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
            case 'subset': {
                const subset = this.subset_store.get(condition.id);

                if (subset === null) {
                    this.logger.error(
                        `Subset condition references nonexistent ID ${condition.id}.`,
                    );
                    version_idxs.clear();
                } else {
                    this.evaluate_condition(subset.query.condition, version_idxs, set_type);
                }

                break;
            }
            default: {
                switch (set_type) {
                    case Uint_Set_Type.BIT32:
                        this.evaluate_property_condition_bitset_32(
                            condition,
                            version_idxs as Bitset_32,
                        );
                        break;
                    case Uint_Set_Type.BIT:
                        this.evaluate_property_condition_bitset(
                            condition,
                            version_idxs as Bitset,
                        );
                        break;
                    case Uint_Set_Type.ARRAY:
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
        condition: Property_Condition,
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
        condition: Property_Condition,
        version_idxs: Bitset,
    ) {
        if (PER_VERSION_PROPS.includes(condition.prop)) {
            const version_idxs_data = version_idxs.data;
            const len = version_idxs_data.length;
            let bits_left = version_idxs.cap;
            let size = version_idxs.size;

            for (let i = 0; i < len; i++, bits_left -= 32) {
                let slot = version_idxs_data[i];

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

                version_idxs_data[i] = slot;
            }

            version_idxs.size = size;
        } else if (!this.evaluate_property_condition_with_version(condition, 0)) {
            version_idxs.clear();
        }
    }

    private evaluate_property_condition_array_set(
        condition: Property_Condition,
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
        condition: Property_Condition,
        version_idx: number,
    ): boolean {
        let values: any = this.cards.get_for_version(this.card_idx, version_idx, condition.prop);
        this.logger.log('values', values);

        const compare = get_compare(condition, this.logger);

        if (Array.isArray(values)) {
            // We return true as soon as a value is found for which the compare function returns
            // true, except when the condition is of type "ne".
            const sentinel = condition.type !== 'ne';

            for (const value of values) {
                // Ignore non-existent values.
                if (value === null) {
                    continue;
                }

                const result = compare(value, condition);

                if (result === sentinel) {
                    return sentinel;
                }
            }

            return !sentinel;
        } else {
            return compare(values, condition);
        }
    }
}

function get_compare(
    condition: Property_Condition,
    logger: Logger,
): (value: any, cond: Property_Condition) => boolean {
    // Use a helper to function to avoid having to cast in every return statement.
    return get_compare_helper(condition, logger);
}

function get_compare_helper(
    condition: Property_Condition,
    logger: Logger,
): (value: any, cond: any) => boolean {
    // The given condition is the same condition that will be passed to the returned function. We
    // could return a function with a closure over the given condition that only takes a value as
    // argument, but this makes query evaluation as whole about 5% slower.
    switch (condition.type) {
        case 'even':
            return (value: number, _cond: Predicate_Condition) => value % 2 === 0;
        case 'odd':
            return (value: number, _cond: Predicate_Condition) => value % 2 !== 0;
        case 'substring':
            return (value: string, cond: Substring_Condition) => value.includes(cond.value);
        case 'range': {
            return (value: any, cond: Range_Condition) => {
                // Can't use === because it doesn't work as expected with Date objects.
                return (cond.start_inc ? value >= cond.start : value > cond.start)
                    && (cond.end_inc ? value <= cond.end : value < cond.end);
            }
        }
    }

    switch (condition.prop) {
        case 'colors':
        case 'cost':
        case 'identity': {
            if (condition.prop !== 'cost' && typeof condition.value === 'number') {
                switch (condition.type) {
                    case 'eq':
                        return (value: Mana_Cost, cond: Comparison_Condition) => {
                            return Object.keys(value).length === (cond.value as number);
                        }
                    case 'ne':
                        return (value: Mana_Cost, cond: Comparison_Condition) => {
                            return Object.keys(value).length !== (cond.value as number);
                        }
                    case 'gt':
                        return (value: Mana_Cost, cond: Comparison_Condition) => {
                            return Object.keys(value).length > (cond.value as number);
                        }
                    case 'lt':
                        return (value: Mana_Cost, cond: Comparison_Condition) => {
                            return Object.keys(value).length < (cond.value as number);
                        }
                    case 'ge':
                        return (value: Mana_Cost, cond: Comparison_Condition) => {
                            return Object.keys(value).length >= (cond.value as number);
                        }
                    case 'le':
                        return (value: Mana_Cost, cond: Comparison_Condition) => {
                            return Object.keys(value).length <= (cond.value as number);
                        }
                }
            } else {
                switch (condition.type) {
                    case 'eq':
                        return (value: Mana_Cost, cond: Comparison_Condition) => {
                            return mana_cost_eq(value, cond.value as Mana_Cost, logger);
                        }
                    case 'ne':
                        return (value: Mana_Cost, cond: Comparison_Condition) => {
                            return !mana_cost_eq(value, cond.value as Mana_Cost, logger);
                        }
                    case 'gt':
                        return (value: Mana_Cost, cond: Comparison_Condition) => {
                            return mana_cost_is_super_set(value, cond.value as Mana_Cost, true, logger);
                        }
                    case 'lt':
                        return (value: Mana_Cost, cond: Comparison_Condition) => {
                            return mana_cost_is_super_set(cond.value as Mana_Cost, value, true, logger);
                        }
                    case 'ge':
                        return (value: Mana_Cost, cond: Comparison_Condition) => {
                            return mana_cost_is_super_set(value, cond.value as Mana_Cost, false, logger);
                        }
                    case 'le':
                        return (value: Mana_Cost, cond: Comparison_Condition) => {
                            return mana_cost_is_super_set(cond.value as Mana_Cost, value, false, logger);
                        }
                }
            }
        }
        case 'rarity': {
            switch (condition.type) {
                case 'eq':
                    return (value: number, cond: Comparison_Condition) => {
                        return value === RARITY_RANK[cond.value as Rarity];
                    }
                case 'ne':
                    return (value: number, cond: Comparison_Condition) => {
                        return value !== RARITY_RANK[cond.value as Rarity];
                    }
                case 'gt':
                    return (value: number, cond: Comparison_Condition) => {
                        return value > RARITY_RANK[cond.value as Rarity];
                    }
                case 'lt':
                    return (value: number, cond: Comparison_Condition) => {
                        return value < RARITY_RANK[cond.value as Rarity];
                    }
                case 'ge':
                    return (value: number, cond: Comparison_Condition) => {
                        return value >= RARITY_RANK[cond.value as Rarity];
                    }
                case 'le':
                    return (value: number, cond: Comparison_Condition) => {
                        return value <= RARITY_RANK[cond.value as Rarity];
                    }
            }
        }
        case 'released_at': {
            switch (condition.type) {
                case 'eq':
                    return (value: number, cond: Comparison_Condition) => {
                        return value === (cond.value as Date).getTime();
                    }
                case 'ne':
                    return (value: number, cond: Comparison_Condition) => {
                        return value !== (cond.value as Date).getTime();
                    }
                case 'gt':
                    return (value: number, cond: Comparison_Condition) => {
                        return value > (cond.value as Date).getTime();
                    }
                case 'lt':
                    return (value: number, cond: Comparison_Condition) => {
                        return value < (cond.value as Date).getTime();
                    }
                case 'ge':
                    return (value: number, cond: Comparison_Condition) => {
                        return value >= (cond.value as Date).getTime();
                    }
                case 'le':
                    return (value: number, cond: Comparison_Condition) => {
                        return value <= (cond.value as Date).getTime();
                    }
            }
        }
        default: {
            switch (condition.type) {
                case 'eq':
                    return (value: any, cond: Comparison_Condition) => {
                        return value === cond.value;
                    }
                case 'ne':
                    return (value: any, cond: Comparison_Condition) => {
                        return value !== cond.value;
                    }
                case 'gt':
                    return (value: any, cond: Comparison_Condition) => {
                        return value > cond.value;
                    }
                case 'lt':
                    return (value: any, cond: Comparison_Condition) => {
                        return value < cond.value;
                    }
                case 'ge':
                    return (value: any, cond: Comparison_Condition) => {
                        return value >= cond.value;
                    }
                case 'le':
                    return (value: any, cond: Comparison_Condition) => {
                        return value <= cond.value;
                    }
            }
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

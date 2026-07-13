import { EMPTY_MAP, type Logger } from "../core";

const freeze = Object.freeze;

export type Query = {
    readonly props: readonly Prop[],
    readonly condition: Condition,
};

export type Prop =
    'colors' |
    'formats' |
    'identity' |
    'img' |
    'cost' |
    'cmc' |
    'landscape' |
    'name' |
    'name_search' |
    'name_inexact' |
    'oracle' |
    'oracle_search' |
    'full_oracle' |
    'full_oracle_search' |
    'rarity' |
    'released_at' |
    'reprint' |
    'set' |
    'sfurl' |
    'type' |
    'type_search';

export type Rarity =
    'common' |
    'uncommon' |
    'rare' |
    'mythic' |
    'special' |
    'bonus';

export type Condition =
    Negation_Condition |
    Disjunction_Condition |
    Conjunction_Condition |
    True_Condition |
    False_Condition |
    Property_Condition |
    Subset_Condition;

export type Negation_Condition = {
    readonly type: 'not',
    readonly condition: Condition,
}

export type Disjunction_Condition = {
    readonly type: 'or',
    readonly conditions: readonly Condition[],
}

export type Conjunction_Condition = {
    readonly type: 'and',
    readonly conditions: readonly Condition[],
}

export type True_Condition = {
    readonly type: 'true',
}

export type False_Condition = {
    readonly type: 'false',
}

export type Property_Condition =
    Comparison_Condition |
    Substring_Condition |
    Predicate_Condition |
    Range_Condition;

export type Comparison_Condition = {
    readonly type: 'eq' | 'ne' | 'lt' | 'gt' | 'le' | 'ge',
    readonly prop: Prop,
    readonly value: number | boolean | string | Date | Mana_Cost,
}

export type Substring_Condition = {
    readonly type: 'substring',
    readonly prop: Prop,
    readonly value: string,
}

export type Predicate_Condition = {
    readonly type: 'even' | 'odd',
    readonly prop: Prop,
}

export type Range_Condition = {
    readonly type: 'range',
    readonly prop: Prop,
    readonly start: number | Date,
    readonly start_inc: boolean,
    readonly end: number | Date,
    readonly end_inc: boolean,
}

export type Subset_Condition = {
    readonly type: 'subset',
    readonly id: string,
}

export type Mana_Cost = Mana_Cost_None | Mana_Cost_Some;
export type Mana_Cost_None = { readonly none: true };
export type Mana_Cost_Some = {
    readonly none: false,
    readonly symbols: ReadonlyMap<string, number>,
};

export type Subset = {
    readonly id: string,
    readonly name: string,
    readonly query: Query,
}

export const PROPS: readonly Prop[] = freeze([
    'colors',
    'formats',
    'identity',
    'img',
    'cost',
    'cmc',
    'landscape',
    'name',
    'name_search',
    'name_inexact',
    'oracle',
    'oracle_search',
    'full_oracle',
    'full_oracle_search',
    'rarity',
    'released_at',
    'reprint',
    'set',
    'sfurl',
    'type',
    'type_search',
]);
export const MULTI_VALUE_PROPS: readonly Prop[] = freeze([
    'formats',
]);
export const PER_FACE_PROPS: readonly Prop[] = freeze([
    'colors',
    'cost',
    'full_oracle',
    'full_oracle_search',
    'img',
    'name',
    'oracle',
    'oracle_search',
    'type',
    'type_search',
]);
export const PER_VERSION_PROPS: readonly Prop[] = freeze([
    'rarity',
    'released_at',
    'reprint',
    'set',
]);
export const PROPS_REQUIRED_FOR_DISPLAY: readonly Prop[] = freeze(['sfurl', 'img', 'landscape']);

export const MANA_WHITE = 'W';
export const MANA_BLUE = 'U';
export const MANA_BLACK = 'B';
export const MANA_RED = 'R';
export const MANA_GREEN = 'G';
export const MANA_COLORLESS = 'C';
export const MANA_GENERIC = 'N'; // Specifc generic cost.
export const MANA_GENERIC_X = 'X'; // Generic cost of "X".
export const MANA_SNOW = 'S';
export const MANA_PHYREXIAN = 'P';
export const MANA_WUBRG = freeze([MANA_WHITE, MANA_BLUE, MANA_BLACK, MANA_RED, MANA_GREEN]);

export const MANA_COST_NONE: Mana_Cost = freeze({ none: true });
export const MANA_COST_ZERO: Mana_Cost = freeze({ none: false, symbols: EMPTY_MAP });

export const RARITY_COMMON: Rarity = 'common';
export const RARITY_UNCOMMON: Rarity = 'uncommon';
export const RARITY_RARE: Rarity = 'rare';
export const RARITY_MYTHIC: Rarity = 'mythic';
export const RARITY_SPECIAL: Rarity = 'special';
export const RARITY_BONUS: Rarity = 'bonus';

export const RARITY_RANK = freeze({
    [RARITY_COMMON]: 0,
    [RARITY_UNCOMMON]: 1,
    [RARITY_RARE]: 2,
    [RARITY_SPECIAL]: 3,
    [RARITY_MYTHIC]: 4,
    [RARITY_BONUS]: 5,
});

export const INEXACT_REGEX = /[.,:;/\\'" \t]+/g;

export const TRUE_CONDITION: True_Condition = freeze({ type: 'true' });
export const FALSE_CONDITION: False_Condition = freeze({ type: 'false' });

export const QUERY_ALL: Query = freeze({
    props: freeze([]),
    condition: TRUE_CONDITION,
});

export const QUERY_NONE: Query = freeze({
    props: freeze([]),
    condition: FALSE_CONDITION,
});

export function is_property_condition(cond: Condition): cond is Property_Condition {
    return (cond as Property_Condition).prop !== undefined;
}

export function mana_cost_symbol_count(cost: Mana_Cost): number {
    return cost.none ? 0 : cost.symbols.size;
}

export function mana_cost_eq(a: Mana_Cost, b: Mana_Cost, logger: Logger): boolean {
    if (a.none || b.none) {
        return a.none === b.none;
    }

    if (a.symbols.size !== b.symbols.size) {
        return false;
    }

    for (const [symbol, b_count] of b.symbols) {
        const a_count = a.symbols.get(symbol);

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
export function mana_cost_is_super_set(
    a: Mana_Cost,
    b: Mana_Cost,
    strict: boolean,
    logger: Logger,
): boolean {
    if (a.none) {
        return !strict && b.none;
    }

    if (b.none) {
        return !strict || !a.none;
    }

    let a_symbols = a.symbols.size;
    const b_symbols = b.symbols.size;

    if (a_symbols < b_symbols) {
        logger.log('a has fewer symbols than b.', a, b);
        return false;
    }

    let a_total = 0;
    let b_total = 0;

    for (const [symbol, b_count] of b.symbols) {
        const a_count = a.symbols.get(symbol) ?? 0;

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

    if (a_symbols > b_symbols) {
        return true;
    } else {
        logger.log("a doesn't have more symbols than b.", a, b);
        return false;
    }
}

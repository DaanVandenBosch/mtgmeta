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

export type Mana_Cost = { readonly [mana_type: string]: number };

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
export const PER_VERSION_PROPS: readonly Prop[] = freeze([
    'rarity',
    'released_at',
    'reprint',
    'set',
]);

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

export const RARITY_COMMON: Rarity = 'common';
export const RARITY_UNCOMMON: Rarity = 'uncommon';
export const RARITY_RARE: Rarity = 'rare';
export const RARITY_MYTHIC: Rarity = 'mythic';
export const RARITY_SPECIAL: Rarity = 'special';
export const RARITY_BONUS: Rarity = 'bonus';

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

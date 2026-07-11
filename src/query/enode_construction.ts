import type { Cards } from "../cards";
import { assert, EMPTY_SET, unreachable, type Logger } from "../core";
import { MULTI_VALUE_PROPS, PER_FACE_PROPS, PER_VERSION_PROPS, type Comparison_Condition, type Condition, type Conjunction_Condition, type Disjunction_Condition, type Mana_Cost, type Predicate_Condition, type Prop, type Query, type Range_Condition, type Substring_Condition } from "../query";
import { Comparison_Operator, Enode_Type, Prop_Value_Type, type Enode, type Enode_Comparison, type Enode_Even, type Enode_Mana_Cost, type Enode_Mana_Cost_Number, type Enode_Range, type Enode_Substring, type Enode_Substring_Per_face } from "./enode";
const freeze = Object.freeze;

type Partial_Enode_Result =
    { readonly all: true } |
    { readonly all: false, readonly cards: ReadonlySet<number> };

export type Enode_Result =
    Partial_Enode_Result & { readonly node: Enode | null };

const NONE_RESULT: Enode_Result = freeze({ all: false, cards: EMPTY_SET, node: null });
const ALL_RESULT: Enode_Result = freeze({ all: true, node: null });

export class Enode_Constructor {
    private readonly cards: Cards;
    private readonly substring_indices: Map<Prop, Substring_Index> = new Map;
    private data_creation_time: Date | null = null;

    constructor(cards: Cards) {
        this.cards = cards;
    }

    // TODO: Improve index rebuild speed.
    // TODO: Only rebuild indices that are required.
    rebuild_indices(logger: Logger) {
        if (this.data_creation_time === this.cards.creation_time) {
            logger.log('indices up-to-date');
            return;
        }

        logger.time('rebuilding indices');

        const name_inexact_data = this.cards.get_all<string>('name_inexact') ?? unreachable();
        this.substring_indices.set('name_inexact', new Substring_Index(name_inexact_data, 3));

        const name_search_data = this.cards.get_all<string>('name_search') ?? unreachable();
        this.substring_indices.set('name_search', new Substring_Index(name_search_data, 3));

        const oracle_search_data = this.cards.get_all<string>('oracle_search') ?? unreachable();
        this.substring_indices.set('oracle_search', new Substring_Index(oracle_search_data, 3));

        const full_oracle_search_data =
            this.cards.get_all<string>('full_oracle_search') ?? unreachable();
        this.substring_indices.set(
            'full_oracle_search',
            new Substring_Index(full_oracle_search_data, 3),
        );

        const type_search_data =
            this.cards.get_all<ReadonlyArray<string>>('type_search') ?? unreachable();
        this.substring_indices.set('type_search', new Substring_Index(type_search_data, 3));

        this.data_creation_time = this.cards.creation_time;
        logger.time_end('rebuilding indices');
    }

    construct_execution_tree(query: Query, logger: Logger): Enode_Result {
        return this.process_condition(query.condition, false, logger);
    }

    private process_condition(condition: Condition, negate: boolean, logger: Logger): Enode_Result {
        logger.group(condition.type, condition);
        let result: Enode_Result;

        switch (condition.type) {
            case 'true':
                result = ALL_RESULT;
                break;
            case 'false':
                result = NONE_RESULT;
                break;
            case 'or':
                result = this.process_condition_disjunction(condition, negate, logger);
                break;
            case 'and':
                result = this.process_condition_conjunction(condition, negate, logger);
                break;
            case 'not':
                // Just negate the nested condition.
                result = this.process_condition(condition.condition, !negate, logger);
                break;
            case 'substring':
                result = this.process_condition_substring(condition, negate);
                break;
            case 'even':
            case 'odd':
                result = this.process_condition_predicate(condition, negate);
                break;
            case 'range':
                result = this.process_condition_range(condition, negate);
                break;
            case 'subset':
                // TODO: Process even, odd, range and subset.
                unreachable(`TODO: ${condition.type}`);
            default:
                result = this.process_condition_comparison(condition, negate);
                break;
        }

        logger.log('result:', result);
        logger.group_end();
        return result;
    }

    private process_condition_disjunction(
        condition: Disjunction_Condition,
        negate: boolean,
        logger: Logger,
    ): Enode_Result {
        if (negate) {
            return this.process_condition_conjunction_internal(condition.conditions, true, logger);
        } else {
            return this.process_condition_disjunction_internal(condition.conditions, false, logger);
        }
    }

    private process_condition_disjunction_internal(
        child_conditions: ReadonlyArray<Condition>,
        negate_children: boolean,
        logger: Logger,
    ): Enode_Result {
        const cards_len = this.cards.length ?? unreachable();
        let result: Partial_Enode_Result = NONE_RESULT;
        const children: Enode[] = [];

        for (const cond of child_conditions) {
            const child_result = this.process_condition(cond, negate_children, logger);

            if (child_result.all) {
                if (child_result.node) {
                    result = child_result;
                } else {
                    return ALL_RESULT;
                }
            } else if (!result.all) {
                const cards = result.cards.union(child_result.cards);

                if (cards.size === cards_len
                    && children.length === 0
                    && child_result.node === null
                ) {
                    return ALL_RESULT;
                } else {
                    result = {
                        all: false,
                        cards,
                    };
                }
            }

            if (child_result.node) {
                // Combine nested disjunction nodes.
                if (child_result.node.type === Enode_Type.Disjunction) {
                    children.push(...child_result.node.children);
                } else {
                    children.push(child_result.node);
                }
            }
        }

        let node: Enode | null;

        if (children.length === 0) {
            node = null;
        } else if (children.length === 1) {
            node = children[0];
        } else {
            node = { type: Enode_Type.Disjunction, children };
        }

        return { ...result, node };
    }

    private process_condition_conjunction(
        condition: Conjunction_Condition,
        negate: boolean,
        logger: Logger,
    ): Enode_Result {
        if (negate) {
            return this.process_condition_disjunction_internal(condition.conditions, true, logger);
        } else {
            return this.process_condition_conjunction_internal(condition.conditions, false, logger);
        }
    }

    private process_condition_conjunction_internal(
        child_conditions: ReadonlyArray<Condition>,
        negate_children: boolean,
        logger: Logger,
    ): Enode_Result {
        let result: Partial_Enode_Result = ALL_RESULT;
        const children: Enode[] = [];

        for (const cond of child_conditions) {
            const child_result = this.process_condition(cond, negate_children, logger);

            if (result.all) {
                result = child_result;
            } else if (!child_result.all) {
                const cards = result.cards.intersection(child_result.cards);

                if (cards.size === 0) {
                    return NONE_RESULT;
                } else {
                    result = {
                        all: false,
                        cards,
                    };
                }
            }

            if (child_result.node) {
                // Combine nested conjunction nodes.
                if (child_result.node.type === Enode_Type.Conjunction) {
                    children.push(...child_result.node.children);
                } else {
                    children.push(child_result.node);
                }
            }
        }

        let node: Enode | null;

        if (children.length === 0) {
            node = null;
        } else if (children.length === 1) {
            node = children[0];
        } else {
            node = { type: Enode_Type.Conjunction, children };
        }

        return { ...result, node };
    }

    private process_condition_comparison(
        condition: Comparison_Condition,
        negate: boolean,
    ): Enode_Result {
        switch (condition.prop) {
            case 'colors':
            case 'cost':
            case 'identity': {
                // TODO: Indices for colors, cost and identity.
                return { all: true, node: this.create_enode_mana_cost(condition, negate) };
            }
            case 'rarity': {
                // TODO: rarity.
                unreachable(`TODO: ${condition.prop}`);
            }
            case 'reprint': {
                assert(condition.type === 'eq' || condition.type === 'ne');
                // TODO: Index for reprint?
                const condition_value = (condition.type === 'eq') === condition.value;
                const negated = condition_value === negate;
                return { all: true, node: { type: Enode_Type.Reprint, negated } };
            }
            default: {
                // Comparison condition.
                // TODO: Indices for comparisons.
                return { all: true, node: this.create_enode_comparison(condition, negate) };
            }
        }
    }

    private process_condition_substring(
        condition: Substring_Condition,
        negate: boolean,
    ): Enode_Result {
        // TODO: Optimize negated substring condition.
        if (negate) {
            return { all: true, node: this.create_enode_substring(condition, negate) };
        }

        // All string properties contain the empty string.
        if (condition.value.length === 0) {
            return ALL_RESULT;
        }

        const index = this.substring_indices.get(condition.prop)
            ?? unreachable(`No index for property ${condition.prop}.`);
        const candidates = index.get_candidates(condition.value);

        // Condition string is shorter than the index' n-gram size, need to execute over all cards.
        if (candidates === null) {
            return { all: true, node: this.create_enode_substring(condition, negate) };
        }

        // No card has this combination of n-grams.
        if (candidates.size === 0) {
            return NONE_RESULT;
        }

        // Condition string is exactly the n-gram size, the candidate set is the exact result set.
        if (condition.value.length === index.ngram_size) {
            return { all: false, cards: candidates, node: null };
        }

        // Typical case, need to execute over a subset of cards.
        return {
            all: false,
            cards: candidates,
            node: this.create_enode_substring(condition, negate),
        };
    }

    private process_condition_predicate(
        condition: Predicate_Condition,
        negate: boolean,
    ): Enode_Result {
        assert(condition.prop === 'cmc');
        // TODO: Index for cmc.
        const values = this.cards.get_all<number>(condition.prop) ?? unreachable();
        const node: Enode_Even = {
            type: Enode_Type.Even,
            values,
            negated: negate === (condition.type === 'even'),
        };
        return { all: true, node };
    }

    private process_condition_range(
        condition: Range_Condition,
        negated: boolean,
    ): Enode_Result {
        assert(
            condition.prop !== 'colors'
            && condition.prop !== 'cost'
            && condition.prop !== 'identity',
        );
        // TODO: Use indices.
        const node: Enode_Range = {
            type: Enode_Type.Range,
            values: this.cards.get_all<any>(condition.prop) ?? unreachable(),
            value_type: prop_to_value_type(condition.prop),
            start: condition.start instanceof Date ? condition.start.getTime() : condition.start,
            start_inc: condition.start_inc,
            end: condition.end instanceof Date ? condition.end.getTime() : condition.end,
            end_inc: condition.end_inc,
            negated,
        };
        return { all: true, node };
    }

    private create_enode_comparison(
        condition: Comparison_Condition,
        negate: boolean,
    ): Enode_Comparison {
        const values = this.cards.get_all<any>(condition.prop) ?? unreachable();
        const condition_value =
            condition.value instanceof Date ? condition.value.getTime() : condition.value;
        const [operator, negated] = condition_type_to_comparison_operator(condition.type);
        return {
            type: Enode_Type.Comparison,
            values,
            value_type: prop_to_value_type(condition.prop),
            condition_value,
            operator,
            negated: negate !== negated,
        };
    }

    private create_enode_mana_cost(
        condition: Comparison_Condition,
        negate: boolean,
    ): Enode_Mana_Cost | Enode_Mana_Cost_Number {
        const values =
            this.cards.get_all<Mana_Cost | ReadonlyArray<Mana_Cost | null>>(condition.prop)
            ?? unreachable();
        const per_face = PER_FACE_PROPS.includes(condition.prop);
        const [operator, negated] = condition_type_to_comparison_operator(condition.type);

        let node: Enode_Mana_Cost | Enode_Mana_Cost_Number;

        if (typeof condition.value === 'number') {
            assert(condition.prop === 'colors' || condition.prop === 'identity');

            node = {
                type: Enode_Type.Mana_Cost_Number,
                values,
                per_face,
                condition_value: condition.value as number,
                operator,
                negated: negate !== negated,
            };
        } else {
            assert(
                condition.prop === 'colors'
                || condition.prop === 'cost'
                || condition.prop === 'identity'
            );

            node = {
                type: Enode_Type.Mana_Cost,
                values: values,
                per_face,
                condition_value: condition.value as Mana_Cost,
                operator,
                negated: negate !== negated,
            };
        }

        return node;
    }

    private create_enode_substring(
        condition: Substring_Condition,
        negated: boolean,
    ): Enode_Substring | Enode_Substring_Per_face {
        assert(!PER_VERSION_PROPS.includes(condition.prop));

        const per_face = PER_FACE_PROPS.includes(condition.prop);
        const values = this.cards.get_all<unknown>(condition.prop) ?? unreachable();

        let node: Enode_Substring | Enode_Substring_Per_face;

        if (per_face) {
            node = {
                type: Enode_Type.Substring_Per_face,
                values: values as ReadonlyArray<ReadonlyArray<string>>,
                condition_value: condition.value,
                negated,
            };
        } else {
            node = {
                type: Enode_Type.Substring,
                values: values as ReadonlyArray<string>,
                condition_value: condition.value,
                negated,
            };
        }

        return node;
    }
}

class Substring_Index {
    readonly ngrams: ReadonlyMap<string, ReadonlySet<number>>;
    readonly ngram_size: number;

    constructor(
        values: ReadonlyArray<string> | ReadonlyArray<ReadonlyArray<string>>,
        ngram_size: number,
    ) {
        const ngrams = new Map<string, Set<number>>;
        const two_dims = Array.isArray(values[0]);

        for (let card_idx = 0, len = values.length; card_idx < len; card_idx++) {
            const v = values[card_idx];

            if (two_dims) {
                for (const value of v as ReadonlyArray<string>) {
                    Substring_Index.add_to_ngrams(ngram_size, ngrams, card_idx, value);
                }
            } else {
                Substring_Index.add_to_ngrams(ngram_size, ngrams, card_idx, v as string);
            }
        }

        this.ngrams = ngrams;
        this.ngram_size = ngram_size;
    }

    private static add_to_ngrams(
        ngram_size: number,
        ngrams: Map<string, Set<number>>,
        card_idx: number,
        value: string,
    ): void {
        for (let i = 0, end = value.length - ngram_size; i <= end; i++) {
            const ngram = value.slice(i, i + ngram_size);
            let set = ngrams.get(ngram);

            if (set === undefined) {
                set = new Set;
                ngrams.set(ngram, set);
            }

            set.add(card_idx);
        }
    }

    get_candidates(value: string): ReadonlySet<number> | null {
        const ngrams = this.ngrams;
        const ngram_size = this.ngram_size;
        let candidates: ReadonlySet<number> | null = null;

        for (let i = 0, end = value.length - ngram_size; i <= end; i++) {
            const set = ngrams.get(value.slice(i, i + ngram_size));

            if (set === undefined) {
                return EMPTY_SET;
            }

            if (candidates) {
                candidates = candidates.intersection(set);
            } else {
                candidates = set;
            }
        }

        return candidates;
    }
}

function condition_type_to_comparison_operator(
    type: Comparison_Condition['type']
): [Comparison_Operator, boolean] {
    switch (type) {
        case 'eq':
            return [Comparison_Operator.EQ, false];
        case 'ne':
            return [Comparison_Operator.EQ, true];
        case 'lt':
            return [Comparison_Operator.LT, false];
        case 'gt':
            return [Comparison_Operator.LE, true];
        case 'le':
            return [Comparison_Operator.LE, false];
        case 'ge':
            return [Comparison_Operator.LT, true];
        default:
            unreachable();
    }
}

function prop_to_value_type(prop: Prop): Prop_Value_Type {
    if (PER_VERSION_PROPS.includes(prop)) {
        return Prop_Value_Type.Per_Version;
    } else if (PER_FACE_PROPS.includes(prop)) {
        return Prop_Value_Type.Per_Face;
    } else if (MULTI_VALUE_PROPS.includes(prop)) {
        return Prop_Value_Type.Multi;
    } else {
        return Prop_Value_Type.Single;
    }
}

import type { Cards } from "../cards";
import { assert, EMPTY_SET, unreachable, type Logger } from "../core";
import { PER_FACE_PROPS, PER_VERSION_PROPS, type Comparison_Condition, type Condition, type Conjunction_Condition, type Disjunction_Condition, type Mana_Cost, type Prop, type Query, type Substring_Condition } from "../query";
import { Comparison_Operator, Enode_Type, type Enode, type Enode_Comparison, type Enode_Mana_Cost, type Enode_Mana_Cost_Number, type Enode_Substring, type Enode_Substring_Per_face } from "./enode";
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
            case 'range':
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
        const cards_len = this.cards.length ?? unreachable();
        let result: Partial_Enode_Result = NONE_RESULT;
        const children: Enode[] = [];

        for (const cond of condition.conditions) {
            const child_result = this.process_condition(cond, negate, logger);

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
        } else if (negate) {
            node = { type: Enode_Type.Conjunction, children };
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
        let result: Partial_Enode_Result = ALL_RESULT;
        const children: Enode[] = [];

        for (const cond of condition.conditions) {
            const child_result = this.process_condition(cond, negate, logger);

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
        } else if (negate) {
            node = { type: Enode_Type.Disjunction, children };
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
            case 'rarity':
            case 'released_at': {
                // TODO: rarity and released_at.
                unreachable(`TODO: ${condition.prop}`);
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

    private create_enode_comparison(
        condition: Comparison_Condition,
        negate: boolean,
    ): Enode_Comparison {
        assert(
            !PER_VERSION_PROPS.includes(condition.prop),
            () => `TODO: Per-version properties not yet supported (${condition.prop}).`,
        );

        const card_values =
            this.cards.get_all<Comparison_Condition['value']>(condition.prop)
            ?? unreachable();
        const [operator, negated] = condition_type_to_comparison_operator(condition.type);

        return {
            type: Enode_Type.Comparison,
            card_values,
            values_are_arrays:
                PER_FACE_PROPS.includes(condition.prop) || condition.prop === 'formats',
            condition_value: condition.value,
            operator,
            negated: negate !== negated,
        };
    }

    private create_enode_mana_cost(
        condition: Comparison_Condition,
        negate: boolean,
    ): Enode_Mana_Cost | Enode_Mana_Cost_Number {
        const card_values =
            this.cards.get_all<Mana_Cost | ReadonlyArray<Mana_Cost | null>>(condition.prop)
            ?? unreachable();
        const per_face = PER_FACE_PROPS.includes(condition.prop);
        const [operator, negated] = condition_type_to_comparison_operator(condition.type);

        let node: Enode_Mana_Cost | Enode_Mana_Cost_Number;

        if (typeof condition.value === 'number') {
            assert(condition.prop === 'colors' || condition.prop === 'identity');

            node = {
                type: Enode_Type.Mana_Cost_Number,
                card_values,
                per_face,
                condition_value: condition.value as number,
                operator,
                negated: negate !== negated,
            }
        } else {
            assert(
                condition.prop === 'colors'
                || condition.prop === 'cost'
                || condition.prop === 'identity'
            );

            node = {
                type: Enode_Type.Mana_Cost,
                card_values,
                per_face,
                condition_value: condition.value as Mana_Cost,
                operator,
                negated: negate !== negated,
            }
        }

        return node;
    }

    private create_enode_substring(
        condition: Substring_Condition,
        negated: boolean,
    ): Enode_Substring | Enode_Substring_Per_face {
        assert(!PER_VERSION_PROPS.includes(condition.prop));

        const per_face = PER_FACE_PROPS.includes(condition.prop);
        const card_values = this.cards.get_all<unknown>(condition.prop) ?? unreachable();

        let node: Enode_Substring | Enode_Substring_Per_face;

        if (per_face) {
            node = {
                type: Enode_Type.Substring_Per_face,
                card_values: card_values as ReadonlyArray<ReadonlyArray<string>>,
                condition_value: condition.value,
                negated,
            };
        } else {
            node = {
                type: Enode_Type.Substring,
                card_values: card_values as ReadonlyArray<string>,
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

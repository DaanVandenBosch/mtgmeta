import type { Cards } from "../cards";
import { assert, EMPTY_SET, unreachable, type Logger } from "../core";
import { MULTI_VALUE_PROPS, PER_FACE_PROPS, PER_VERSION_PROPS, type Comparison_Condition, type Condition, type Conjunction_Condition, type Disjunction_Condition, type Mana_Cost, type Predicate_Condition, type Prop, type Query, type Range_Condition, type Subset_Condition, type Substring_Condition } from "../query";
import type { Subset_Store } from "../subset";
import { Comparison_Operator, Enode_Type, Prop_Value_Type, type Enode, type Enode_Comparison, type Enode_Even, type Enode_Mana_Cost, type Enode_Mana_Cost_Number, type Enode_Range, type Enode_Substring, type Enode_Substring_Per_face } from "./enode";
import type { Indices } from "./indices";
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
    private readonly indices: Indices;
    private readonly subset_store: Subset_Store;

    constructor(cards: Cards, indices: Indices, subset_store: Subset_Store) {
        this.cards = cards;
        this.indices = indices;
        this.subset_store = subset_store;
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
                result = this.process_condition_subset(condition, negate, logger);
                break;
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

        const { candidates, exact } = this.indices.get_candidates(condition.prop, condition.value);

        // Condition string is shorter than the index' n-gram size, need to execute over all cards.
        if (candidates === null) {
            return { all: true, node: this.create_enode_substring(condition, negate) };
        }

        // No card has this combination of n-grams.
        if (candidates.size === 0) {
            return NONE_RESULT;
        }

        // Condition string is exactly the n-gram size, the candidate set is the exact result set.
        if (exact) {
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

    private process_condition_subset(
        condition: Subset_Condition,
        negate: boolean,
        logger: Logger,
    ): Enode_Result {
        const subset = this.subset_store.get(condition.id);

        if (subset === null) {
            logger.error(`Subset condition references nonexistent ID ${condition.id}.`);
            return negate ? ALL_RESULT : NONE_RESULT;
        }

        return this.process_condition(subset.query.condition, negate, logger);
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

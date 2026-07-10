import type { Cards } from './cards';
import { assert, EMPTY_SET, unreachable, type Logger } from './core';
import { MANA_GENERIC, PER_FACE_PROPS, PER_VERSION_PROPS, type Comparison_Condition, type Condition, type Conjunction_Condition, type Mana_Cost, type Prop, type Query, type Substring_Condition } from './query';
import { Bitset, Bitset_32, type Uint_Set } from './uint_set';
const freeze = Object.freeze;

type Partial_Eval_Result =
    { readonly all: true } |
    { readonly all: false, readonly cards: ReadonlySet<number> };

type Eval_Result = Partial_Eval_Result & { readonly node: Enode | null };

const NONE_EVAL_RESULT: Eval_Result = freeze({ all: false, cards: EMPTY_SET, node: null });
const ALL_EVAL_RESULT: Eval_Result = freeze({ all: true, node: null });

export class Query_Engine {
    private readonly cards: Cards;
    private readonly substring_indices: Map<Prop, Substring_Index> = new Map;
    private data_creation_time: Date | null = null;

    constructor(cards: Cards) {
        this.cards = cards;
    }

    execute(
        logger: Logger,
        exec_logger: (card_idx: number) => Logger,
        query: Query,
    ): ReadonlyMap<number, number> {
        logger.log('query:', query);
        logger.time('full execution');

        this.index_rebuild(logger);

        logger.group('evaluation');
        logger.time('evaluation');

        const eval_result = this.evaluate_condition(query.condition, logger);
        logger.log('evaluation result:', eval_result);

        logger.time_end('evaluation');
        logger.group_end();

        logger.group('execution');
        logger.time('execution');

        const exec_node = eval_result.node;

        let result: Map<number, number>;

        if (exec_node === null) {
            // No further work to do, return the evaluation results directly.
            if (eval_result.all) {
                result = this.all_cards();
            } else {
                result = new Map<number, number>;

                for (const card_idx of eval_result.cards) {
                    // TODO: Set actual version.
                    result.set(card_idx, 0);
                }
            }
        } else {
            // Execute the query execution tree on the subset of cards returned by the evaluation
            // phase.
            result = new Map<number, number>;

            if (eval_result.all) {
                const len = this.cards.length ?? unreachable();

                for (let card_idx = 0; card_idx < len; card_idx++) {
                    this.execute_for_card(exec_logger, exec_node, card_idx, result);
                }
            } else {
                for (const card_idx of eval_result.cards) {
                    this.execute_for_card(exec_logger, exec_node, card_idx, result);
                }
            }
        }

        logger.time_end('execution');
        logger.group_end();
        logger.time_end('full execution');
        return result;
    }

    // TODO: Improve index rebuild speed.
    // TODO: Only rebuild indices that are required.
    private index_rebuild(logger: Logger) {
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

    private evaluate_condition(condition: Condition, logger: Logger): Eval_Result {
        logger.group(condition.type, condition);
        let result: Eval_Result;

        switch (condition.type) {
            case 'true':
                result = ALL_EVAL_RESULT;
                break;
            case 'false':
                result = NONE_EVAL_RESULT;
                break;
            case 'or':
                // TODO: Evalutate disjunction.
                unreachable();
            case 'and':
                result = this.evaluate_condition_conjunction(condition, logger);
                break;
            case 'not':
                // TODO: Evalutate negation.
                unreachable();
            case 'substring':
                result = this.evaluate_condition_substring(condition);
                break;
            case 'even':
            case 'odd':
            case 'range':
            case 'subset':
                // TODO: Evalutate even, odd, range and subset.
                unreachable();
            default:
                result = this.evaluate_condition_comparison(condition);
                break;
        }

        logger.log('result:', result);
        logger.group_end();
        return result;
    }

    private evaluate_condition_conjunction(
        condition: Conjunction_Condition,
        logger: Logger,
    ): Eval_Result {
        let result: Partial_Eval_Result = ALL_EVAL_RESULT;
        const children: Enode[] = [];

        for (const cond of condition.conditions) {
            const child_result = this.evaluate_condition(cond, logger);

            if (result.all) {
                result = child_result;
            } else if (!child_result.all) {
                const cards = result.cards.intersection(child_result.cards);

                if (cards.size === 0) {
                    return NONE_EVAL_RESULT;
                } else {
                    result = {
                        all: false,
                        cards,
                    };
                }
            }

            if (child_result.node) {
                // Combine conjunction nodes.
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

    private evaluate_condition_comparison(condition: Comparison_Condition): Eval_Result {
        switch (condition.prop) {
            case 'colors':
            case 'cost':
            case 'identity': {
                // TODO: Indices for colors, cost and identity.
                return { all: true, node: this.create_enode_mana_cost(condition) };
            }
            case 'rarity':
            case 'released_at': {
                // TODO: rarity and released_at.
                unreachable();
            }
            default: {
                // Comparison condition.
                // TODO: Indices for comparisons.
                return { all: true, node: this.create_enode_comparison(condition) };
            }
        }
    }

    private evaluate_condition_substring(condition: Substring_Condition): Eval_Result {
        // All string properties contain the empty string.
        if (condition.value.length === 0) {
            return ALL_EVAL_RESULT;
        }

        const index = this.substring_indices.get(condition.prop)
            ?? unreachable(`No index for property ${condition.prop}.`);
        const candidates = index.get_candidates(condition.value);

        // Condition string is shorter than the index' n-gram size, need to execute over all cards.
        if (candidates === null) {
            return { all: true, node: this.create_enode_substring(condition) };
        }

        // No card has this combination of n-grams.
        if (candidates.size === 0) {
            return NONE_EVAL_RESULT;
        }

        // Condition string is exactly the n-gram size, the candidate set is the exact result set.
        if (condition.value.length === index.ngram_size) {
            return { all: false, cards: candidates, node: null };
        }

        // Typical case, need to execute over a subset of cards.
        return {
            all: false,
            cards: candidates,
            node: this.create_enode_substring(condition),
        };
    }

    private create_enode_comparison(condition: Comparison_Condition): Enode_Comparison {
        assert(!PER_VERSION_PROPS.includes(condition.prop));

        const card_values =
            this.cards.get_all<Comparison_Condition['value']>(condition.prop)
            ?? unreachable();
        const operator = condition_type_to_comparison_operator(condition.type);

        return {
            type: Enode_Type.Comparison,
            condition,
            card_values,
            values_are_arrays:
                PER_FACE_PROPS.includes(condition.prop) || condition.prop === 'formats',
            operator,
        };
    }

    private create_enode_mana_cost(
        condition: Comparison_Condition,
    ): Enode_Mana_Cost | Enode_Mana_Cost_Number {
        const card_values =
            this.cards.get_all<Mana_Cost | ReadonlyArray<Mana_Cost | null>>(condition.prop)
            ?? unreachable();
        const per_face = PER_FACE_PROPS.includes(condition.prop);
        const operator = condition_type_to_comparison_operator(condition.type);

        let node: Enode_Mana_Cost | Enode_Mana_Cost_Number;

        if (typeof condition.value === 'number') {
            assert(condition.prop === 'colors' || condition.prop === 'identity');

            node = {
                type: Enode_Type.Mana_Cost_Number,
                condition: condition as Comparison_Condition & { value: number },
                card_values,
                per_face,
                operator,
            }
        } else {
            assert(
                condition.prop === 'colors'
                || condition.prop === 'cost'
                || condition.prop === 'identity'
            );

            node = {
                type: Enode_Type.Mana_Cost,
                condition: condition as Comparison_Condition & { value: Mana_Cost },
                card_values,
                per_face,
                operator,
            }
        }

        return node;
    }

    private create_enode_substring(
        condition: Substring_Condition,
    ): Enode_Substring | Enode_Substring_Per_face {
        assert(!PER_VERSION_PROPS.includes(condition.prop));

        const per_face = PER_FACE_PROPS.includes(condition.prop);
        const card_values = this.cards.get_all<unknown>(condition.prop) ?? unreachable();

        let node: Enode_Substring | Enode_Substring_Per_face;

        if (per_face) {
            node = {
                type: Enode_Type.Substring_Per_face,
                condition,
                card_values: card_values as ReadonlyArray<ReadonlyArray<string>>,
            };
        } else {
            node = {
                type: Enode_Type.Substring,
                condition,
                card_values: card_values as ReadonlyArray<string>,
            };
        }

        return node;
    }

    private execute_for_card(
        get_logger: (card_idx: number) => Logger,
        node: Enode,
        card_idx: number,
        execution_result: Map<number, number>,
    ) {
        const logger = get_logger(card_idx);

        // TODO: Optimize version count.
        const version_count = this.cards.version_count(card_idx) ?? 1;

        if (logger.should_log) {
            const name = this.cards.name(card_idx);
            logger.group('executing node tree for:', name, card_idx, 'versions:', version_count);
        }

        // TODO: Check if instantiating set once outside of the loop is faster.
        const versions =
            version_count <= 32
                ? Bitset_32.with_cap(version_count)
                : Bitset.with_cap(version_count);
        versions.fill();

        this.execute_node(logger, node, card_idx, versions);

        const version_idx = versions.first_or_null();

        if (version_idx !== null) {
            execution_result.set(card_idx, version_idx);
        }

        logger.group_end();
    }

    private execute_node(logger: Logger, node: Enode, card_idx: number, versions: Uint_Set): void {
        if (logger.should_log) {
            logger.group(Enode_Type[node.type], node);
        }

        switch (node.type) {
            case Enode_Type.Conjunction:
                this.execute_node_conjunction(logger, node, card_idx, versions);
                break;
            case Enode_Type.Comparison:
                this.execute_node_comparison(node, card_idx, versions);
                break;
            case Enode_Type.Mana_Cost:
                this.execute_node_mana_cost(logger, node, card_idx, versions);
                break;
            case Enode_Type.Mana_Cost_Number:
                this.execute_node_mana_cost_number(node, card_idx, versions);
                break;
            case Enode_Type.Substring:
                this.execute_node_substring(node, card_idx, versions);
                break;
            case Enode_Type.Substring_Per_face:
                this.execute_node_substring_per_face(node, card_idx, versions);
                break;
            default:
                unreachable();
        }

        if (logger.should_log) {
            logger.log('result:', versions.to_array());
            logger.group_end();
        }
    }

    private execute_node_conjunction(
        logger: Logger,
        node: Enode_Conjunction,
        card_idx: number,
        versions: Uint_Set,
    ): void {
        for (const child of node.children) {
            this.execute_node(logger, child, card_idx, versions);

            if (versions.size === 0) {
                return;
            }
        }
    }

    private execute_node_comparison(
        node: Enode_Comparison,
        card_idx: number,
        versions: Uint_Set,
    ): void {
        const value_or_values = node.card_values[card_idx] as any;
        const condition_value = node.condition.value;

        if (node.values_are_arrays) {
            const values = value_or_values as ReadonlyArray<any>;
            // We return true as soon as a value is found for which the comparison function returns
            // true, except when the condition is of type "ne".
            const sentinel = node.operator !== Comparison_Operator.NE;

            for (const value of values) {
                // Ignore non-existent values.
                if (value === null) {
                    continue;
                }

                let result: boolean;

                switch (node.operator) {
                    case Comparison_Operator.EQ:
                        result = value === condition_value;
                        break;
                    case Comparison_Operator.NE:
                        result = value !== condition_value;
                        break;
                    case Comparison_Operator.LT:
                        result = value < condition_value;
                        break;
                    case Comparison_Operator.GT:
                        result = value > condition_value;
                        break;
                    case Comparison_Operator.LE:
                        result = value <= condition_value;
                        break;
                    case Comparison_Operator.GE:
                        result = value >= condition_value;
                        break;
                    default:
                        unreachable();
                }

                if (result === sentinel) {
                    if (!sentinel) {
                        versions.clear();
                    }

                    return;
                }
            }

            if (sentinel) {
                versions.clear();
            }
        } else {
            const value = value_or_values;
            let result: boolean;

            switch (node.operator) {
                case Comparison_Operator.EQ:
                    result = value === condition_value;
                    break;
                case Comparison_Operator.NE:
                    result = value !== condition_value;
                    break;
                case Comparison_Operator.LT:
                    result = value < condition_value;
                    break;
                case Comparison_Operator.GT:
                    result = value > condition_value;
                    break;
                case Comparison_Operator.LE:
                    result = value <= condition_value;
                    break;
                case Comparison_Operator.GE:
                    result = value >= condition_value;
                    break;
                default:
                    unreachable();
            }

            if (!result) {
                versions.clear();
            }
        }
    }

    private execute_node_mana_cost(
        logger: Logger,
        node: Enode_Mana_Cost,
        card_idx: number,
        versions: Uint_Set,
    ): void {
        const condition_value = node.condition.value;
        const value_or_values = node.card_values[card_idx];

        if (node.per_face) {
            const values = value_or_values as ReadonlyArray<Mana_Cost | null>;
            // We return true as soon as a value is found for which the comparison function returns
            // true, except when the condition is of type "ne".
            const sentinel = node.operator !== Comparison_Operator.NE;

            for (const value of values) {
                // Ignore non-existent values.
                if (value === null) {
                    continue;
                }

                let result: boolean;

                switch (node.operator) {
                    case Comparison_Operator.EQ:
                        result = mana_cost_eq(value, condition_value, logger);
                        break;
                    case Comparison_Operator.NE:
                        result = !mana_cost_eq(value, condition_value, logger);
                        break;
                    case Comparison_Operator.LT:
                        result = mana_cost_is_super_set(condition_value, value, true, logger);
                        break;
                    case Comparison_Operator.GT:
                        result = mana_cost_is_super_set(value, condition_value, true, logger);
                        break;
                    case Comparison_Operator.LE:
                        result = mana_cost_is_super_set(condition_value, value, false, logger);
                        break;
                    case Comparison_Operator.GE:
                        result = mana_cost_is_super_set(value, condition_value, false, logger);
                        break;
                    default:
                        unreachable();
                }

                if (result === sentinel) {
                    if (!sentinel) {
                        versions.clear();
                    }

                    return;
                }
            }

            if (sentinel) {
                versions.clear();
            }
        } else {
            const value = value_or_values as Mana_Cost;
            let result: boolean;

            switch (node.operator) {
                case Comparison_Operator.EQ:
                    result = mana_cost_eq(value, condition_value, logger);
                    break;
                case Comparison_Operator.NE:
                    result = !mana_cost_eq(value, condition_value, logger);
                    break;
                case Comparison_Operator.LT:
                    result = mana_cost_is_super_set(condition_value, value, true, logger);
                    break;
                case Comparison_Operator.GT:
                    result = mana_cost_is_super_set(value, condition_value, true, logger);
                    break;
                case Comparison_Operator.LE:
                    result = mana_cost_is_super_set(condition_value, value, false, logger);
                    break;
                case Comparison_Operator.GE:
                    result = mana_cost_is_super_set(value, condition_value, false, logger);
                    break;
                default:
                    unreachable();
            }

            if (!result) {
                versions.clear();
            }
        }
    }

    private execute_node_mana_cost_number(
        node: Enode_Mana_Cost_Number,
        card_idx: number,
        versions: Uint_Set,
    ): void {
        const condition_value: number = node.condition.value;
        const value_or_values = node.card_values[card_idx];

        if (node.per_face) {
            const values = value_or_values as ReadonlyArray<Mana_Cost | null>;
            // We return true as soon as a value is found for which the comparison function returns
            // true, except when the condition is of type "ne".
            const sentinel = node.operator !== Comparison_Operator.NE;

            for (const value of values) {
                // Ignore non-existent values.
                if (value === null) {
                    continue;
                }

                const len: number = Object.keys(value).length;
                let result: boolean;

                switch (node.operator) {
                    case Comparison_Operator.EQ:
                        result = len === condition_value;
                        break;
                    case Comparison_Operator.NE:
                        result = len !== condition_value;
                        break;
                    case Comparison_Operator.LT:
                        result = len < condition_value;
                        break;
                    case Comparison_Operator.GT:
                        result = len > condition_value;
                        break;
                    case Comparison_Operator.LE:
                        result = len <= condition_value;
                        break;
                    case Comparison_Operator.GE:
                        result = len >= condition_value;
                        break;
                    default:
                        unreachable();
                }

                if (result === sentinel) {
                    if (!sentinel) {
                        versions.clear();
                    }

                    return;
                }
            }

            if (sentinel) {
                versions.clear();
            }
        } else {
            const len: number = Object.keys(value_or_values).length;
            let result: boolean;

            switch (node.operator) {
                case Comparison_Operator.EQ:
                    result = len === condition_value;
                    break;
                case Comparison_Operator.NE:
                    result = len !== condition_value;
                    break;
                case Comparison_Operator.LT:
                    result = len < condition_value;
                    break;
                case Comparison_Operator.GT:
                    result = len > condition_value;
                    break;
                case Comparison_Operator.LE:
                    result = len <= condition_value;
                    break;
                case Comparison_Operator.GE:
                    result = len >= condition_value;
                    break;
                default:
                    unreachable();
            }

            if (!result) {
                versions.clear();
            }
        }
    }

    private execute_node_substring(
        node: Enode_Substring,
        card_idx: number,
        versions: Uint_Set,
    ): void {
        if (!node.card_values[card_idx].includes(node.condition.value)) {
            versions.clear();
        }
    }

    private execute_node_substring_per_face(
        node: Enode_Substring_Per_face,
        card_idx: number,
        versions: Uint_Set,
    ): void {
        const condition_value = node.condition.value;

        for (const value of node.card_values[card_idx]) {
            if (value.includes(condition_value)) {
                return;
            }
        }

        versions.clear();
    }

    // TODO: Cache this until data changes.
    private all_cards(): Map<number, number> {
        assert(this.cards.length !== null);

        const set = new Map<number, number>;

        for (let i = 0, len = this.cards.length; i < len; i++) {
            // TODO: Set actual version.
            set.set(i, 0);
        }

        return set;
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

enum Comparison_Operator {
    EQ = 1,
    NE = 2,
    LT = 3,
    GT = 4,
    LE = 5,
    GE = 6,
}

enum Enode_Type {
    Conjunction = 1,
    Comparison = 2,
    Mana_Cost = 3,
    Mana_Cost_Number = 4,
    Substring = 5,
    Substring_Per_face = 6,
}

/** Execution node. */
type Enode =
    Enode_Conjunction |
    Enode_Comparison |
    Enode_Mana_Cost |
    Enode_Mana_Cost_Number |
    Enode_Substring |
    Enode_Substring_Per_face;

type Enode_Conjunction = {
    readonly type: Enode_Type.Conjunction,
    readonly children: ReadonlyArray<Enode>,
}

type Enode_Comparison = {
    readonly type: Enode_Type.Comparison,
    readonly condition: Comparison_Condition,
    readonly card_values: ReadonlyArray<unknown>,
    readonly values_are_arrays: boolean,
    readonly operator: Comparison_Operator,
}

type Enode_Mana_Cost = {
    readonly type: Enode_Type.Mana_Cost,
    readonly condition: Comparison_Condition & { value: Mana_Cost },
    readonly card_values: ReadonlyArray<Mana_Cost | ReadonlyArray<Mana_Cost | null>>,
    readonly per_face: boolean,
    readonly operator: Comparison_Operator,
}

type Enode_Mana_Cost_Number = {
    readonly type: Enode_Type.Mana_Cost_Number,
    readonly condition: Comparison_Condition & { value: number },
    readonly card_values: ReadonlyArray<Mana_Cost | ReadonlyArray<Mana_Cost | null>>,
    readonly per_face: boolean,
    readonly operator: Comparison_Operator,
}

type Enode_Substring = {
    readonly type: Enode_Type.Substring,
    readonly condition: Substring_Condition,
    readonly card_values: ReadonlyArray<string>,
}

type Enode_Substring_Per_face = {
    readonly type: Enode_Type.Substring_Per_face,
    readonly condition: Substring_Condition,
    readonly card_values: ReadonlyArray<ReadonlyArray<string>>,
}

function condition_type_to_comparison_operator(
    type: Comparison_Condition['type']
): Comparison_Operator {
    switch (type) {
        case 'eq':
            return Comparison_Operator.EQ;
        case 'ne':
            return Comparison_Operator.NE;
        case 'lt':
            return Comparison_Operator.LT;
        case 'gt':
            return Comparison_Operator.GT;
        case 'le':
            return Comparison_Operator.LE;
        case 'ge':
            return Comparison_Operator.GE;
        default:
            unreachable();
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

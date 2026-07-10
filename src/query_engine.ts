import type { Cards } from './cards';
import { assert, EMPTY_SET, unreachable, type Logger } from './core';
import { MANA_GENERIC, PER_FACE_PROPS, PER_VERSION_PROPS, type Comparison_Condition, type Condition, type Conjunction_Condition, type Mana_Cost, type Prop, type Query, type Substring_Condition } from './query';
import { Bitset, Bitset_32, type Uint_Set } from './uint_set';
const freeze = Object.freeze;

type Partial_Eval_Result =
    { readonly all: true } |
    { readonly all: false, readonly cards: ReadonlySet<number> };

type Eval_Result = Partial_Eval_Result & { readonly node: Exec_Node | null };

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
                result = this.evaluate_conjunction_condition(condition, logger);
                break;
            case 'not':
                // TODO: Evalutate negation.
                unreachable();
            case 'substring':
                result = this.evaluate_substring_condition(condition);
                break;
            case 'even':
            case 'odd':
            case 'range':
            case 'subset':
                // TODO: Evalutate even, odd, range and subset.
                unreachable();
            default:
                result = this.evaluate_comparison_condition(condition);
                break;
        }

        logger.log('result:', result);
        logger.group_end();
        return result;
    }

    private evaluate_conjunction_condition(
        condition: Conjunction_Condition,
        logger: Logger,
    ): Eval_Result {
        let result: Partial_Eval_Result = ALL_EVAL_RESULT;
        const child_nodes: Exec_Node[] = [];

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
                child_nodes.push(child_result.node);
            }
        }

        let node: Exec_Node | null;

        if (child_nodes.length === 0) {
            node = null;
        } else if (child_nodes.length === 1) {
            node = child_nodes[0];
        } else {
            node = new Conjunction_Exec_Node(child_nodes);
        }

        return { ...result, node };
    }

    private evaluate_comparison_condition(condition: Comparison_Condition): Eval_Result {
        switch (condition.prop) {
            case 'colors':
            case 'cost':
            case 'identity': {
                // TODO: Indices for colors, cost and identity.
                if (typeof condition.value === 'number') {
                    return {
                        all: true,
                        node: new Mana_Cost_Number_Exec_Node(
                            this.cards,
                            condition as Comparison_Condition & { value: number },
                        ),
                    };
                } else {
                    return {
                        all: true,
                        node: new Mana_Cost_Exec_Node(
                            this.cards,
                            condition as Comparison_Condition & { value: Mana_Cost },
                        ),
                    };
                }
            }
            case 'rarity':
            case 'released_at': {
                // TODO: rarity and released_at.
                unreachable();
            }
            default: {
                // TODO: Indices for comparisons.
                return {
                    all: true,
                    node: new Comparison_Exec_Node(this.cards, condition as Comparison_Condition),
                }
            }
        }
    }

    private evaluate_substring_condition(condition: Substring_Condition): Eval_Result {
        // All string properties contain the empty string.
        if (condition.value.length === 0) {
            return ALL_EVAL_RESULT;
        }

        const per_face = PER_FACE_PROPS.includes(condition.prop);
        const index = this.substring_indices.get(condition.prop)
            ?? unreachable(`No index for property ${condition.prop}.`);
        const candidates = index.get_candidates(condition.value);

        // Condition string is shorter than the index' n-gram size, need to execute over all cards.
        if (candidates === null) {
            return {
                all: true,
                node:
                    per_face
                        ? new Per_Face_Substring_Exec_Node(this.cards, condition)
                        : new Substring_Exec_Node(this.cards, condition),
            };
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
            node:
                per_face
                    ? new Per_Face_Substring_Exec_Node(this.cards, condition)
                    : new Substring_Exec_Node(this.cards, condition),
        };
    }

    private execute_for_card(
        exec_logger: (card_idx: number) => Logger,
        exec_node: Exec_Node,
        card_idx: number,
        execution_result: Map<number, number>,
    ) {
        const logger = exec_logger(card_idx);

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

        exec_node.execute(logger, card_idx, versions);

        const version_idx = versions.first_or_null();

        if (version_idx !== null) {
            execution_result.set(card_idx, version_idx);
        }

        logger.group_end();
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

abstract class Exec_Node {
    execute(logger: Logger, card_idx: number, versions: Uint_Set): void {
        if (logger.should_log) {
            logger.group('conjunction');
            this.execute_internal(logger, card_idx, versions);
            logger.log('result:', versions.to_array());
            logger.group_end();
        } else {
            this.execute_internal(logger, card_idx, versions);
        }
    }

    protected abstract execute_internal(logger: Logger, card_idx: number, versions: Uint_Set): void;
}

class Conjunction_Exec_Node extends Exec_Node {
    private readonly children: readonly Exec_Node[];

    constructor(children: readonly Exec_Node[]) {
        super();
        this.children = children;
    }

    protected override execute_internal(
        logger: Logger,
        card_idx: number,
        versions: Uint_Set,
    ): void {
        for (const child of this.children) {
            child.execute(logger, card_idx, versions);

            if (versions.size === 0) {
                return;
            }
        }
    }
}

class Substring_Exec_Node extends Exec_Node {
    private readonly condition: Substring_Condition;
    private readonly card_values: ReadonlyArray<string>;

    constructor(cards: Cards, condition: Substring_Condition) {
        assert(
            !PER_FACE_PROPS.includes(condition.prop)
            && !PER_VERSION_PROPS.includes(condition.prop)
        );
        super();
        this.condition = condition;
        this.card_values = cards.get_all<string>(condition.prop) ?? unreachable();
    }

    protected override execute_internal(
        _logger: Logger,
        card_idx: number,
        versions: Uint_Set,
    ): void {
        if (!this.card_values[card_idx].includes(this.condition.value)) {
            versions.clear();
        }
    }
}

class Per_Face_Substring_Exec_Node extends Exec_Node {
    private readonly condition: Substring_Condition;
    private readonly card_values: ReadonlyArray<ReadonlyArray<string>>;

    constructor(cards: Cards, condition: Substring_Condition) {
        assert(
            PER_FACE_PROPS.includes(condition.prop)
            && !PER_VERSION_PROPS.includes(condition.prop)
        );
        super();
        this.condition = condition;
        this.card_values = cards.get_all<ReadonlyArray<string>>(condition.prop) ?? unreachable();
    }

    protected override execute_internal(
        _logger: Logger,
        card_idx: number,
        versions: Uint_Set,
    ): void {
        const condition_value = this.condition.value;

        for (const value of this.card_values[card_idx]) {
            if (value.includes(condition_value)) {
                return;
            }
        }

        versions.clear();
    }
}

class Comparison_Exec_Node extends Exec_Node {
    private readonly condition: Comparison_Condition;
    private readonly card_values: ReadonlyArray<Comparison_Condition['value']>;
    private readonly operator: Comparison_Operator;

    constructor(cards: Cards, condition: Comparison_Condition) {
        assert(
            !PER_FACE_PROPS.includes(condition.prop)
            && !PER_VERSION_PROPS.includes(condition.prop)
        );
        super();
        this.condition = condition;
        this.card_values =
            cards.get_all<Comparison_Condition['value']>(condition.prop) ?? unreachable();

        switch (condition.type) {
            case 'eq':
                this.operator = Comparison_Operator.EQ;
                break;
            case 'ne':
                this.operator = Comparison_Operator.NE;
                break;
            case 'lt':
                this.operator = Comparison_Operator.LT;
                break;
            case 'gt':
                this.operator = Comparison_Operator.GT;
                break;
            case 'le':
                this.operator = Comparison_Operator.LE;
                break;
            case 'ge':
                this.operator = Comparison_Operator.GE;
                break;
            default:
                unreachable();
        }
    }

    protected override execute_internal(
        _logger: Logger,
        card_idx: number,
        versions: Uint_Set,
    ): void {
        const value = this.card_values[card_idx];
        const condition_value = this.condition.value;
        let result: boolean;

        switch (this.operator) {
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

class Mana_Cost_Exec_Node extends Exec_Node {
    private readonly condition: Comparison_Condition & { value: Mana_Cost };
    private readonly card_values: ReadonlyArray<Mana_Cost | ReadonlyArray<Mana_Cost | null>>;
    private readonly per_face: boolean;
    private readonly operator: Comparison_Operator;

    constructor(
        cards: Cards,
        condition: Comparison_Condition & { value: Mana_Cost },
    ) {
        assert(Array<Prop>('colors', 'cost', 'identity').includes(condition.prop));
        super();
        this.condition = condition;
        this.card_values =
            cards.get_all<Mana_Cost | ReadonlyArray<Mana_Cost | null>>(condition.prop)
            ?? unreachable();
        this.per_face = PER_FACE_PROPS.includes(condition.prop);

        switch (condition.type) {
            case 'eq':
                this.operator = Comparison_Operator.EQ;
                break;
            case 'ne':
                this.operator = Comparison_Operator.NE;
                break;
            case 'lt':
                this.operator = Comparison_Operator.LT;
                break;
            case 'gt':
                this.operator = Comparison_Operator.GT;
                break;
            case 'le':
                this.operator = Comparison_Operator.LE;
                break;
            case 'ge':
                this.operator = Comparison_Operator.GE;
                break;
            default:
                unreachable();
        }
    }

    protected override execute_internal(
        logger: Logger,
        card_idx: number,
        versions: Uint_Set,
    ): void {
        const condition_value = this.condition.value;
        const value_or_values = this.card_values[card_idx];

        if (this.per_face) {
            const values = value_or_values as ReadonlyArray<Mana_Cost | null>;
            // We return true as soon as a value is found for which the comparison function returns
            // true, except when the condition is of type "ne".
            const sentinel = this.operator !== Comparison_Operator.NE;

            for (const value of values) {
                // Ignore non-existent values.
                if (value === null) {
                    continue;
                }

                let result: boolean;

                switch (this.operator) {
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

            switch (this.operator) {
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
}

class Mana_Cost_Number_Exec_Node extends Exec_Node {
    private readonly condition: Comparison_Condition & { value: number };
    private readonly card_values: ReadonlyArray<Mana_Cost | ReadonlyArray<Mana_Cost | null>>;
    private readonly per_face: boolean;
    private readonly operator: Comparison_Operator;

    constructor(
        cards: Cards,
        condition: Comparison_Condition & { value: number },
    ) {
        assert(Array<Prop>('colors', 'identity').includes(condition.prop));
        super();
        this.condition = condition;
        this.card_values =
            cards.get_all<Mana_Cost | ReadonlyArray<Mana_Cost | null>>(condition.prop)
            ?? unreachable();
        this.per_face = condition.prop !== 'identity';

        switch (condition.type) {
            case 'eq':
                this.operator = Comparison_Operator.EQ;
                break;
            case 'ne':
                this.operator = Comparison_Operator.NE;
                break;
            case 'lt':
                this.operator = Comparison_Operator.LT;
                break;
            case 'gt':
                this.operator = Comparison_Operator.GT;
                break;
            case 'le':
                this.operator = Comparison_Operator.LE;
                break;
            case 'ge':
                this.operator = Comparison_Operator.GE;
                break;
            default:
                unreachable();
        }
    }

    protected override execute_internal(
        _logger: Logger,
        card_idx: number,
        versions: Uint_Set,
    ): void {
        const condition_value: number = this.condition.value;
        const value_or_values = this.card_values[card_idx];

        if (this.per_face) {
            const values = value_or_values as ReadonlyArray<Mana_Cost | null>;
            // We return true as soon as a value is found for which the comparison function returns
            // true, except when the condition is of type "ne".
            const sentinel = this.operator !== Comparison_Operator.NE;

            for (const value of values) {
                // Ignore non-existent values.
                if (value === null) {
                    continue;
                }

                const len: number = Object.keys(value).length;
                let result: boolean;

                switch (this.operator) {
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

            switch (this.operator) {
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

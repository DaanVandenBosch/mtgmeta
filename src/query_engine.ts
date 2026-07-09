import type { Cards } from './cards';
import { assert, EMPTY_SET, unreachable } from './core';
import type { Condition, Conjunction_Condition, Prop, Query, Substring_Condition } from './query';
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
    // TODO: Ensure these get rebuilt when data changes.
    private readonly substring_indices: Map<Prop, Substring_Index> = new Map;

    constructor(cards: Cards) {
        console.time('Query_Engine constructor');
        this.cards = cards;
        const names_inexact = cards.get_all<string>('name_inexact');
        assert(names_inexact !== null);
        this.substring_indices.set('name_inexact', new Substring_Index(names_inexact, 3));
        console.timeEnd('Query_Engine constructor');
        console.log(this);
    }

    execute(query: Query): ReadonlyMap<number, number> {
        console.log(query);
        console.time('Query_Engine.execute');

        const eval_result = this.evaluate_condition(query.condition);
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
                    this.execute_for_card(exec_node, card_idx, result);
                }
            } else {
                for (const card_idx of eval_result.cards) {
                    this.execute_for_card(exec_node, card_idx, result);
                }
            }
        }

        console.timeEnd('Query_Engine.execute');
        return result;
    }

    private execute_for_card(
        exec_node: Exec_Node,
        card_idx: number,
        execution_result: Map<number, number>,
    ) {
        // TODO: Optimize version count.
        const version_count = this.cards.version_count(card_idx) ?? 1;

        // TODO: Check if instantiating set once outside of the loop is faster.
        const versions =
            version_count <= 32
                ? Bitset_32.with_cap(version_count)
                : Bitset.with_cap(version_count);

        exec_node.execute(card_idx, versions);

        const version_idx = versions.first_or_null();

        if (version_idx !== null) {
            execution_result.set(card_idx, version_idx);
        }
    }

    private evaluate_condition(condition: Condition): Eval_Result {
        switch (condition.type) {
            case 'true': {
                return ALL_EVAL_RESULT;
            }
            case 'false': {
                return NONE_EVAL_RESULT;
            }
            case 'and': {
                return this.evaluate_conjunction_condition(condition);
            }
            case 'substring': {
                return this.evaluate_substring_condition(condition);
            }
            default: {
                unreachable();
            }
        }
    }

    private evaluate_conjunction_condition(
        condition: Conjunction_Condition,
    ): Eval_Result {
        let result: Partial_Eval_Result = ALL_EVAL_RESULT;
        const child_nodes: Exec_Node[] = [];

        for (const cond of condition.conditions) {
            const child_result = this.evaluate_condition(cond);

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

    private evaluate_substring_condition(
        condition: Substring_Condition,
    ): Eval_Result {
        if (condition.value.length === 0) {
            return ALL_EVAL_RESULT;
        }

        const index = this.substring_indices.get(condition.prop)!;

        if (condition.value.length < index.ngram_size) {
            return { all: true, node: new Substring_Exec_Node(this.cards, condition) };
        }

        const candidates = index.get_candidates(condition.value);

        if (candidates.size === 0) {
            return NONE_EVAL_RESULT;
        }

        if (condition.value.length === index.ngram_size) {
            return { all: false, cards: candidates, node: null };
        }

        return {
            all: false,
            cards: candidates,
            node: new Substring_Exec_Node(this.cards, condition),
        };
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

    constructor(values: readonly string[], ngram_size: number) {
        const ngrams = new Map<string, Set<number>>;

        for (let i = 0, len = values.length; i < len; i++) {
            const value = values[i];

            for (let j = 0, end = value.length - ngram_size; j <= end; j++) {
                const ngram = value.slice(j, j + ngram_size);
                let set = ngrams.get(ngram);

                if (set === undefined) {
                    set = new Set;
                    ngrams.set(ngram, set);
                }

                set.add(i);
            }
        }

        this.ngrams = ngrams;
        this.ngram_size = ngram_size;
    }

    get_candidates(value: string): ReadonlySet<number> {
        const ngrams = this.ngrams;
        const ngram_size = this.ngram_size;
        let candidates: ReadonlySet<number> = EMPTY_SET;

        for (let i = 0, end = value.length - ngram_size; i <= end; i++) {
            const set = ngrams.get(value.slice(i, i + ngram_size));

            if (set) {
                candidates = candidates.intersection(set);
            } else {
                return EMPTY_SET;
            }
        }

        return candidates;
    }
}

interface Exec_Node {
    execute(card_idx: number, versions: Uint_Set): void;
}

class Conjunction_Exec_Node implements Exec_Node {
    private readonly children: readonly Exec_Node[];

    constructor(children: readonly Exec_Node[]) {
        this.children = children;
    }

    execute(card_idx: number, versions: Uint_Set) {
        for (const child of this.children) {
            child.execute(card_idx, versions);

            if (versions.size === 0) {
                return;
            }
        }
    }
}

class Substring_Exec_Node implements Exec_Node {
    private readonly condition: Substring_Condition;
    private readonly card_values: readonly string[];

    constructor(cards: Cards, condition: Substring_Condition) {
        this.condition = condition;
        this.card_values = cards.get_all<string>(condition.prop) ?? unreachable();
    }

    execute(card_idx: number, versions: Uint_Set) {
        if (!this.card_values[card_idx].includes(this.condition.value)) {
            versions.clear();
        }
    }
}

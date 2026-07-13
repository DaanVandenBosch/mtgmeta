import type { Cards } from "../cards";
import { EMPTY_SET, unreachable, type Logger } from "../core";
import { type Mana_Cost, type Prop } from "./query";
const freeze = Object.freeze;

export type Result = { candidates: ReadonlySet<number> | null, exact: boolean };

const EMPTY_RESULT: Result = freeze({ candidates: EMPTY_SET, exact: true });
const ALL_INEXACT_RESULT: Result = freeze({ candidates: null, exact: false });

export class Indices {
    private readonly cards: Cards;
    private readonly substring_indices: Map<Prop, Substring_Index> = new Map;
    private data_creation_time: Date | null = null;

    constructor(cards: Cards) {
        this.cards = cards;
    }

    // TODO: Improve index rebuild speed.
    rebuild(logger: Logger, props: ReadonlySet<Prop>) {
        if (this.data_creation_time !== this.cards.creation_time) {
            this.substring_indices.clear();
        }

        logger.group('rebuilding indices');
        logger.time('rebuilding indices');

        let updated = false;

        if (this.rebuild_substring_index(logger, props, 'name_inexact')) updated = true;
        if (this.rebuild_substring_index(logger, props, 'name_search')) updated = true;
        if (this.rebuild_substring_index(logger, props, 'oracle_search')) updated = true;
        if (this.rebuild_substring_index(logger, props, 'full_oracle_search')) updated = true;
        if (this.rebuild_substring_index(logger, props, 'type_search')) updated = true;

        if (!updated) {
            logger.log('All required indices up-to-date.');
        }

        this.data_creation_time = this.cards.creation_time;
        logger.time_end('rebuilding indices');
        logger.group_end();
    }

    private rebuild_substring_index(logger: Logger, props: ReadonlySet<Prop>, prop: Prop): boolean {
        if (this.substring_indices.has(prop) || !props.has(prop)) {
            return false;
        }

        if (logger.should_log) {
            logger.log(`Rebuilding ${prop} index.`);
        }

        const data = this.cards.get_all<string>(prop);

        if (data === null) {
            if (logger.should_log) {
                logger.warn(`Can't rebuild ${prop} index because there is no data.`);
            }

            return false;
        }

        this.substring_indices.set(prop, new Substring_Index(data, 3));
        return true;
    }

    get_candidates(prop: Prop, value: any, logger: Logger): Result {
        const index = this.substring_indices.get(prop);

        if (index === undefined) {
            if (logger.should_log) {
                logger.warn(`No index for property ${prop}.`);
            }

            return ALL_INEXACT_RESULT;
        }

        return index.get_candidates(value);
    }
}

type Node = {
    cost: Mana_Cost,
    narrower: Set<Node>,
    wider: Set<Node>,
    cards: Set<number>,
};

function mana_cost_to_key(m: Mana_Cost): string {
    const entries = Object.entries(m);
    entries.sort(([a], [b]) => a.localeCompare(b, 'en'));
    let path = Array<string>();

    for (const [symbol, amount] of entries) {
        path.push(`${symbol}:${amount}`);
    }

    return path.join(',');
}

class Mana_Cost_Index {
    private readonly key_to_node: ReadonlyMap<string, Node> = new Map;

    constructor(mana_costs: ReadonlyArray<Mana_Cost>) {
        const key_to_node = new Map<string, Node>;
        const len = mana_costs.length;

        for (let card_idx = 0; card_idx < len; card_idx++) {
            const mana_cost = mana_costs[card_idx];
            const key = mana_cost_to_key(mana_cost);
            let node = key_to_node.get(key);

            if (node === undefined) {
                node = {
                    cost: mana_cost,
                    narrower: new Set,
                    wider: new Set,
                    cards: new Set,
                };
                key_to_node.set(key, node);
            }

            node.cards.add(card_idx);
        }

        function recurse(mana_cost: Mana_Cost, ancestor: Node) {
            // TODO: Generate all direct sub mana costs. See if node exists. If so, link it. If not,
            //       recurse and pass our ancestor as ancestor. Recurse on existing nodes if their
            //       narrower set is empty.
            unreachable();
        }

        for (const node of key_to_node.values()) {
            recurse(node.cost, node);
        }
    }

    get_subsets(value: Mana_Cost, inclusive: boolean): ReadonlySet<number> {
        const key = mana_cost_to_key(value);
        const node = this.key_to_node.get(key);

        if (node) {
            // TODO
            unreachable();
        } else {
            // TODO: Look up all strict subsets of value.
            // TODO: Ensure we don't compute all possible subsets of something like
            //       {10000}{R}{R}{R}{R}{R}{R}{R}{R}{R}{R}. We should probably bound the given value
            //       before we even compute the path at the start of the method.
            unreachable();
        }
    }
}

class Substring_Index {
    private readonly ngrams: ReadonlyMap<string, ReadonlySet<number> | null>;
    private readonly ngram_size: number;

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

        const ngrams_null: Map<string, Set<number> | null> = ngrams;

        for (const [ngram, cards] of ngrams) {
            if (cards.size > 10_000) {
                ngrams_null.set(ngram, null);
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

    get_candidates(value: string): Result {
        const ngrams = this.ngrams;
        const ngram_size = this.ngram_size;
        let candidates: ReadonlySet<number> | null = null;

        for (let i = 0, end = value.length - ngram_size; i <= end; i++) {
            const ngram = value.slice(i, i + ngram_size);
            const set = ngrams.get(ngram);

            if (set === undefined) {
                return EMPTY_RESULT;
            } else if (set === null) {
                continue;
            }

            if (candidates) {
                candidates = candidates.intersection(set);
            } else {
                candidates = set;
            }
        }

        // Candidates will be null if value is shorter than n-gram size. 
        return { candidates, exact: value.length === ngram_size };
    }
}

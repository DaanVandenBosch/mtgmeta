import type { Cards } from "../cards";
import { EMPTY_SET, type Logger } from "../core";
import type { Prop } from "./query";
const freeze = Object.freeze;

export type Result = { candidates: ReadonlySet<number> | null, exact: boolean };

const EMPTY_RESULT: Result = freeze({ candidates: EMPTY_SET, exact: true });
const ALL_INEXACT_RESULT: Result = freeze({ candidates: null, exact: false });

export class Indices {
    private readonly cards: Cards;
    private readonly indices: Map<Prop, Index> = new Map;
    private data_creation_time: Date | null = null;

    constructor(cards: Cards) {
        this.cards = cards;
    }

    // TODO: Improve index rebuild speed.
    rebuild(logger: Logger, props: ReadonlySet<Prop>) {
        if (this.data_creation_time !== this.cards.creation_time) {
            this.indices.clear();
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
        if (this.indices.has(prop) || !props.has(prop)) {
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

        this.indices.set(prop, new Substring_Index(data, 3));
        return true;
    }

    get_candidates(prop: Prop, value: any, logger: Logger): Result {
        const index = this.indices.get(prop);

        if (index === undefined) {
            if (logger.should_log) {
                logger.warn(`No index for property ${prop}.`);
            }

            return ALL_INEXACT_RESULT;
        }

        return index.get_candidates(value);
    }
}

interface Index {
    get_candidates(value: any): Result;
}

class Substring_Index implements Index {
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

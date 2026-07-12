import type { Cards } from "../cards";
import { EMPTY_SET, unreachable, type Logger } from "../core";
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
        if (this.data_creation_time === this.cards.creation_time) {
            logger.log('indices up-to-date');
            return;
        }

        logger.time('rebuilding indices');

        if (props.has('name_inexact')) {
            const name_inexact_data = this.cards.get_all<string>('name_inexact') ?? unreachable();
            this.indices.set('name_inexact', new Substring_Index(name_inexact_data, 3));
        }

        if (props.has('name_search')) {
            const name_search_data = this.cards.get_all<string>('name_search') ?? unreachable();
            this.indices.set('name_search', new Substring_Index(name_search_data, 3));
        }

        if (props.has('oracle_search')) {
            const oracle_search_data = this.cards.get_all<string>('oracle_search') ?? unreachable();
            this.indices.set('oracle_search', new Substring_Index(oracle_search_data, 3));
        }

        if (props.has('full_oracle_search')) {
            const full_oracle_search_data =
                this.cards.get_all<string>('full_oracle_search') ?? unreachable();
            this.indices.set(
                'full_oracle_search',
                new Substring_Index(full_oracle_search_data, 3),
            );
        }

        if (props.has('type_search')) {
            const type_search_data =
                this.cards.get_all<ReadonlyArray<string>>('type_search') ?? unreachable();
            this.indices.set('type_search', new Substring_Index(type_search_data, 3));
        }

        this.data_creation_time = this.cards.creation_time;
        logger.time_end('rebuilding indices');
    }

    get_candidates(prop: Prop, value: any): Result {
        const index = this.indices.get(prop);

        if (index === undefined) {
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

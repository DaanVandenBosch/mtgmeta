import type { Cards, Sort_Order } from "./cards";
import { Nop_Logger, type Logger } from "./core";
import { type Query } from "./query";
import { find_cards_matching_query, PROPS_REQUIRED_FOR_DISPLAY } from "./query_eval";
import { query_hash } from "./query_hash";
import type { Subset_Store } from "./subset";

export class Query_Executor {
    private readonly logger: Logger;
    private readonly cards: Cards;
    private readonly subset_store: Subset_Store;
    private readonly executions_underway: Map<bigint, Promise<readonly number[]>> = new Map;

    constructor(logger: Logger, cards: Cards, subset_store: Subset_Store) {
        this.logger = logger;
        this.cards = cards;
        this.subset_store = subset_store;
    }

    /** Preloads properties and sorter needed for a given query and sort order. */
    async preload_data(query: Query, sort_order: Sort_Order): Promise<void> {
        await this.execute_retrying('preloading properties', () => {
            const loads = [
                ...query.props.map(prop => this.cards.load(prop)),
                this.cards.get_sorter(sort_order),
            ];
            return Promise.all(loads);
        });
    }

    async execute(
        query: Query,
        sort_order: Sort_Order,
        sort_asc: boolean,
    ): Promise<readonly number[]> {
        const logger = this.logger;
        const hash: bigint = await query_hash(query);
        const existing_promise: Promise<readonly number[]> | undefined =
            this.executions_underway.get(hash);

        if (existing_promise) {
            return await existing_promise;
        }

        logger.group('Executing card query.');

        logger.time(this.execute.name);
        logger.log('query:', query);

        const promise: Promise<readonly number[]> = this.execute_retrying(
            'executing query',
            () => this.execute_query_attempt(query, sort_order, sort_asc),
        );
        this.executions_underway.set(hash, promise);

        const result = await promise;
        this.executions_underway.delete(hash);

        logger.time_end(this.execute.name);
        logger.group_end();

        return result;
    }

    private async execute_retrying<T>(
        description: string,
        operation: () => Promise<T>,
    ): Promise<T> {
        const MAX_LOAD_ATTEMPTS = 2;

        let exception: any;

        for (let attempt = 1; attempt <= MAX_LOAD_ATTEMPTS; attempt++) {
            try {
                return await operation();
            } catch (e) {
                if (attempt < MAX_LOAD_ATTEMPTS) {
                    this.logger.error(`Error while ${description}, retrying.`, e);
                    exception = e;
                    continue;
                } else {
                    throw e;
                }
            }
        }

        throw exception;
    }

    private async execute_query_attempt(
        query: Query,
        sort_order: Sort_Order,
        sort_asc: boolean,
    ): Promise<readonly number[]> {
        const logger = this.logger;
        logger.time(this.execute_query_attempt.name);
        logger.time('load');

        // Fire off data loads.
        const required_for_query_promises = query.props.map(prop => this.cards.load(prop));
        const required_for_display_promises =
            PROPS_REQUIRED_FOR_DISPLAY.map(prop => this.cards.load(prop));

        const sorter_promise = this.cards.get_sorter(sort_order);

        // Await data loads necessary for query.
        for (const promise of required_for_query_promises) {
            await promise;
        }

        // Await at least one display property if we have no required properties to wait for, just
        // to get the amount of cards.
        if (this.cards.length === null) {
            await Promise.race(required_for_display_promises);
        }

        logger.time_end('load');
        logger.time('find_cards_matching_query');

        const card_indexes =
            find_cards_matching_query(this.cards, this.subset_store, query, () => Nop_Logger);

        logger.time_end('find_cards_matching_query');
        logger.time('load_sorter');

        const sorter = await sorter_promise;

        logger.time_end('load_sorter');
        logger.time('sort');

        const sorted_card_indexes = sorter.sort(card_indexes, sort_asc);

        logger.time_end('sort');
        logger.time('load_display');

        // Await data loads necessary for display.
        for (const promise of required_for_display_promises) {
            await promise;
        }

        logger.time_end('load_display');
        logger.time_end(this.execute_query_attempt.name);

        return sorted_card_indexes;
    }
}

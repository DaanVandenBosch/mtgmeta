import { assert, Nop_Logger } from "./core";
import { SORT_ORDERS, type Sort_Order } from "./cards";
import { combine_queries_with_conjunction, parse_query, type Query } from "./query";
import { find_cards_matching_query, PROPS_REQUIRED_FOR_DISPLAY } from "./query_eval";
import { POOL_ALL, POOLS } from "./pool";
import type { Context } from "./context";

export const DEFAULT_QUERY_STRING = '';
const DEFAULT_QUERY: Query = parse_query(DEFAULT_QUERY_STRING);
export const DEFAULT_POOL: string = POOL_ALL;
export const DEFAULT_SORT_ORDER: Sort_Order = 'name';
export const DEFAULT_SORT_ASC = true;
export const DEFAULT_START_POS = 0;

type Loading_State = 'initial' | 'first_load' | 'loading' | 'success';

export type Card_List_State = {
    query_string?: string,
    pool?: string,
    pos?: number,
    sort_order?: Sort_Order,
    sort_asc?: boolean,
    loading_state?: Loading_State,
    all_card_indexes?: readonly number[],
};

export class Card_List {
    static readonly MAX_LOAD_ATTEMPTS = 2;

    private ctx: Context;
    readonly id: number;
    private _query_string: string = DEFAULT_QUERY_STRING;
    private _base_query: Query = DEFAULT_QUERY;
    private _pool: string = DEFAULT_POOL;
    private _pool_query: Query = POOLS[DEFAULT_POOL];
    private _query: Query = DEFAULT_QUERY;
    private _pos: number = DEFAULT_START_POS;
    readonly max_page_size: number = 120;
    private _sort_order: Sort_Order = DEFAULT_SORT_ORDER;
    private _sort_asc: boolean = DEFAULT_SORT_ASC;
    private _loading_state: Loading_State = 'initial';
    private _all_card_indexes: readonly number[] = [];

    constructor(ctx: Context, id: number) {
        this.ctx = ctx;
        this.id = id;
    }

    get query_string(): string {
        return this._query_string;
    }

    get query(): Query {
        return this._query;
    }

    get pool(): string {
        return this._pool;
    }

    get page_size(): number {
        return Math.min(this.max_page_size, this.size - this.pos);
    }

    get pos(): number {
        return this._pos;
    }

    get prev_page(): number {
        return Math.max(0, this.pos - this.max_page_size);
    }

    get next_page(): number {
        return Math.min(this.last_page, this.pos + this.max_page_size);
    }

    get first_page(): number {
        return 0;
    }

    get last_page(): number {
        const psize = this.max_page_size;
        const offset = this.pos % psize;
        return Math.floor((Math.max(0, this.size - 1) - offset) / psize) * psize + offset;
    }

    get sort_order(): Sort_Order {
        return this._sort_order;
    }

    get sort_asc(): boolean {
        return this._sort_asc;
    }

    get loading_state(): Loading_State {
        return this._loading_state;
    }

    get card_indexes(): readonly number[] {
        return this._all_card_indexes.slice(this.pos, this.pos + this.max_page_size);
    }

    get all_card_indexes(): readonly number[] {
        return this._all_card_indexes;
    }

    get size(): number {
        return this._all_card_indexes.length;
    }

    async set(state: Card_List_State, execute_query?: boolean) {
        let changed = false;
        let execute_necessary = false;

        let query_changed = false;

        if (state.query_string !== undefined && state.query_string !== this._query_string) {
            this._query_string = state.query_string;
            this._base_query = parse_query(this._query_string);
            query_changed = true;
        }

        if (state.pool !== undefined && state.pool !== this._pool) {
            const pool_query = POOLS[state.pool];
            assert(pool_query !== undefined, () => `Invalid pool "${state.pool}".`);
            this._pool = state.pool;
            this._pool_query = pool_query;
            query_changed = true;
        }

        if (query_changed) {
            this._query = combine_queries_with_conjunction(this._base_query, this._pool_query);
            changed = true;
            execute_necessary = true;
        }

        if (state.pos !== undefined && state.pos !== this._pos) {
            this._pos = state.pos;
            changed = true;
        }

        if (state.sort_order !== undefined && state.sort_order !== this._sort_order) {
            assert(
                SORT_ORDERS.includes(state.sort_order),
                () => `Invalid sort order "${state.sort_order}".`,
            );
            this._sort_order = state.sort_order;
            changed = true;
            execute_necessary = true;
        }

        if (state.sort_asc !== undefined && state.sort_asc !== this._sort_asc) {
            this._sort_asc = state.sort_asc;
            changed = true;
            execute_necessary = true;
        }

        if (state.loading_state !== undefined && state.loading_state !== this._loading_state) {
            this._loading_state = state.loading_state;
            changed = true;
        }

        if (state.all_card_indexes !== undefined) {
            this._all_card_indexes = state.all_card_indexes;
            changed = true;
        }

        if (changed) {
            this.ctx.deps.changed(this);
        }

        if (execute_query === true || (execute_query === undefined && execute_necessary)) {
            await this.execute_query();
        }
    }

    /** Preloads properties needed for a given query string. */
    async preload(query_string: string) {
        if (query_string !== this.query_string) {
            for (let attempt = 1; attempt <= Card_List.MAX_LOAD_ATTEMPTS; attempt++) {
                try {
                    const loads = [
                        ...parse_query(query_string).props,
                        // Ensure all display props are reloaded when data is out of date:
                        ...PROPS_REQUIRED_FOR_DISPLAY,
                    ].map(prop => this.ctx.cards.load(prop));

                    await Promise.all(loads);
                } catch (e) {
                    if (attempt < Card_List.MAX_LOAD_ATTEMPTS) {
                        this.ctx.logger.error('Error while preloading properties, retrying.', e);
                        continue;
                    } else {
                        throw e;
                    }
                }
            }
        }
    }

    async execute_query() {
        const logger = this.ctx.logger;
        logger.group('Executing card query.');

        // TODO: Cancel load underway.

        this.set({ loading_state: this.loading_state === 'initial' ? 'first_load' : 'loading' });

        logger.time(this.execute_query.name);
        logger.log('query string', this.query_string);
        logger.log('query', this.query);

        for (let attempt = 1; attempt <= Card_List.MAX_LOAD_ATTEMPTS; attempt++) {
            try {
                await this.execute_query_attempt();
                break;
            } catch (e) {
                if (attempt < Card_List.MAX_LOAD_ATTEMPTS) {
                    logger.error('Error while finding matching cards, retrying.', e);
                    continue;
                } else {
                    throw e;
                }
            }
        }

        this.set({ loading_state: 'success' });

        logger.time_end(this.execute_query.name);
        logger.group_end();
    }

    async execute_query_attempt() {
        const logger = this.ctx.logger;
        logger.time(this.execute_query_attempt.name);
        logger.time('load');

        // Fire off data loads.
        const required_for_query_promises = this.query.props.map(prop => this.ctx.cards.load(prop));
        const required_for_display_promises =
            PROPS_REQUIRED_FOR_DISPLAY.map(prop => this.ctx.cards.load(prop));

        const sorter_promise = this.ctx.cards.get_sorter(this.sort_order);

        // Await data loads necessary for query.
        for (const promise of required_for_query_promises) {
            await promise;
        }

        // Await at least one display property if we have no required properties to wait for, just
        // to get the amount of cards.
        if (this.ctx.cards.length === null) {
            await Promise.race(required_for_display_promises);
        }

        logger.time_end('load');
        logger.time('query_evaluate');

        const card_indexes =
            await find_cards_matching_query(this.ctx.cards, this.query, () => Nop_Logger);

        logger.time_end('query_evaluate');
        logger.time('load_sorter');

        const sorter = await sorter_promise;

        logger.time_end('load_sorter');
        logger.time('sort');

        const sorted_card_indexes = sorter.sort(card_indexes, this.sort_asc);

        logger.time_end('sort');
        logger.time('load_display');

        // Await data loads necessary for display.
        for (const promise of required_for_display_promises) {
            await promise;
        }

        this.set({ all_card_indexes: sorted_card_indexes });

        logger.time_end('load_display');
        logger.time_end(this.execute_query_attempt.name);
    }
}

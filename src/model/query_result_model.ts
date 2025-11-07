import { assert, EMPTY_MAP } from "../core";
import { SORT_ORDERS, type Sort_Order } from "../cards";
import { type Query } from "../query";
import { parse_query } from "../query_parsing";
import { combine_queries_with_conjunction } from "../query_combination";
import { PROPS_REQUIRED_FOR_DISPLAY } from "../query_eval";
import { POOL_ALL, POOLS } from "../pool";
import type { Context } from "../context";
import { DEPENDENCY_SYMBOL, type Dependency, type Dependent } from "../deps";
import type { Subset_Model } from "./subset_model";

export const DEFAULT_QUERY_STRING = '';
const DEFAULT_QUERY: Query = parse_query(EMPTY_MAP, DEFAULT_QUERY_STRING);
export const DEFAULT_POOL: string = POOL_ALL;
export const DEFAULT_SORT_ORDER: Sort_Order = 'name';
export const DEFAULT_SORT_ASC = true;
export const DEFAULT_START_POS = 0;

type Loading_State = 'initial' | 'first_load' | 'loading' | 'success';

export type Query_Result_State = {
    query_string?: string,
    pool?: string,
    subset?: Subset_Model | null,
    pos?: number,
    sort_order?: Sort_Order,
    sort_asc?: boolean,
    loading_state?: Loading_State,
    all_card_indexes?: readonly number[],
};

export class Query_Result_Model implements Dependent, Dependency {
    [DEPENDENCY_SYMBOL]: true = true;
    private ctx: Context;
    private _query_string: string = DEFAULT_QUERY_STRING;
    private _base_query: Query = DEFAULT_QUERY;
    private _pool: string = DEFAULT_POOL;
    private _pool_query: Query = POOLS[DEFAULT_POOL];
    private _subset: Subset_Model | null;
    private _query: Query | null = null;
    private _pos: number = DEFAULT_START_POS;
    readonly max_page_size: number = 120;
    private _sort_order: Sort_Order = DEFAULT_SORT_ORDER;
    private _sort_asc: boolean = DEFAULT_SORT_ASC;
    private _loading_state: Loading_State = 'initial';
    private _all_card_indexes: readonly number[] = [];

    constructor(ctx: Context, subset?: Subset_Model) {
        this.ctx = ctx;
        this._subset = subset ?? null;

        if (subset) {
            ctx.deps.add(this, subset);
        }
    }

    dispose() {
        this.ctx.deps.remove_all(this);
    }

    get query_string(): string {
        return this._query_string;
    }

    get subset(): Subset_Model | null {
        return this._subset;
    }

    get query(): Query {
        if (this._query === null) {
            const queries = [this._base_query, this._pool_query];

            if (this._subset) {
                queries.push({
                    props: [],
                    condition: {
                        type: 'subset',
                        id: this._subset.id,
                    },
                });
            }

            this._query = combine_queries_with_conjunction(
                this.ctx.subset_store.id_to_subset,
                ...queries,
            );
        }

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

    async set(state: Query_Result_State, execute_query?: boolean) {
        let changed = false;
        let execute_necessary = false;

        let query_changed = false;

        if (state.query_string !== undefined && state.query_string !== this._query_string) {
            this._query_string = state.query_string;
            this._base_query =
                parse_query(this.ctx.subset_store.name_to_subset, this._query_string);
            query_changed = true;
        }

        if (state.pool !== undefined && state.pool !== this._pool) {
            const pool_query = POOLS[state.pool];
            assert(pool_query !== undefined, () => `Invalid pool "${state.pool}".`);
            this._pool = state.pool;
            this._pool_query = pool_query;
            query_changed = true;
        }

        if (state.subset !== undefined && state.subset !== this._subset) {
            if (this._subset !== null) {
                this.ctx.deps.remove(this, this._subset);
            }

            this._subset = state.subset;

            if (state.subset !== null) {
                this.ctx.deps.add(this, state.subset);
            }

            query_changed = true;
        }

        if (query_changed) {
            this._query = null;
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

    invalidated(_dependency: Dependency): void {
        this._query = null;
        this.execute_query();
    }

    /** Preloads display properties and properties needed for a given query string. */
    async preload_data(query_string: string): Promise<void> {
        if (query_string !== this.query_string) {
            const query = parse_query(this.ctx.subset_store.id_to_subset, query_string);
            const loads = [
                this.ctx.query_executor.preload_data(query, this.sort_order),
                // Ensure all display props are reloaded when data is out of date:
                ...PROPS_REQUIRED_FOR_DISPLAY.map(prop => this.ctx.cards.load(prop)),
            ];
            await Promise.all(loads);
        }
    }

    private async execute_query(): Promise<void> {
        this.set({ loading_state: this.loading_state === 'initial' ? 'first_load' : 'loading' });

        this.ctx.logger.log('executing query for string:', this.query_string);

        const all_card_indexes =
            await this.ctx.query_executor.execute(this.query, this.sort_order, this.sort_asc);

        this.set({
            loading_state: 'success',
            all_card_indexes,
        });
    }
}

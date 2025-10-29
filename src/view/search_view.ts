import {
    DEFAULT_POOL,
    DEFAULT_QUERY_STRING,
    DEFAULT_SORT_ASC,
    DEFAULT_SORT_ORDER,
    DEFAULT_START_POS,
    type Query_Result_State,
} from "../model/query_result_model";
import { Query_Result_View } from "./query_result_view";
import { SORT_ORDERS, type Sort_Order } from "../cards";
import type { Context } from "../context";
import { get_el, key_combo, assert, get_params, string_to_int, unreachable } from "../core";
import { LEAF_DEPENDENT_SYMBOL, type Dependency, type Leaf_Dependent } from "../deps";
import { POOLS } from "../pool";
import type { Search_Model } from "../model/search_model";
import type { View } from "./view";

export class Search_View implements View, Leaf_Dependent {
    [LEAF_DEPENDENT_SYMBOL]: true = true;
    private ctx: Context;
    private search: Search_Model;
    private prev_query_string: string = '';
    private inputs_el: HTMLElement;
    private query_el: HTMLInputElement;
    private extra_el: HTMLButtonElement;
    private pool_el: HTMLSelectElement;
    private sort_order_el: HTMLSelectElement;
    private sort_dir_asc_el: HTMLInputElement;
    private sort_dir_desc_el: HTMLInputElement;
    private navigation_el: HTMLElement;
    private summary_el: HTMLElement;
    private first_el: HTMLButtonElement;
    private prev_el: HTMLButtonElement;
    private next_el: HTMLButtonElement;
    private last_el: HTMLButtonElement;
    private result_view: Query_Result_View;

    constructor(
        ctx: Context,
        search: Search_Model,
        inputs_el: HTMLElement,
        navigation_el: HTMLElement,
        result_el: HTMLDivElement,
    ) {
        this.ctx = ctx;
        this.search = search;
        ctx.deps.add(this, search.result);

        this.inputs_el = inputs_el;
        this.query_el = get_el(inputs_el, ':scope .query');
        const show_extra_right_el: HTMLElement =
            get_el(inputs_el, ':scope .filter_show_extra_right');
        this.extra_el = get_el(inputs_el, ':scope .filter_extra');
        this.pool_el = get_el(inputs_el, ':scope .pool');
        this.sort_order_el = get_el(inputs_el, ':scope .sort_order');
        this.sort_dir_asc_el = get_el(inputs_el, ':scope .sort_dir input[value=asc]');
        this.sort_dir_desc_el = get_el(inputs_el, ':scope .sort_dir input[value=desc]');
        this.navigation_el = navigation_el;
        this.summary_el = get_el(navigation_el, ':scope .result_summary');
        this.first_el = get_el(navigation_el, ':scope .result_first');
        this.prev_el = get_el(navigation_el, ':scope .result_prev');
        this.next_el = get_el(navigation_el, ':scope .result_next');
        this.last_el = get_el(navigation_el, ':scope .result_last');

        // The initial HTML onkeydown handler might have already set a query string.
        const initial_query_string = this.query_el.dataset['query_string'];

        if (initial_query_string !== undefined) {
            search.set({ query_string: initial_query_string });

            // Remove the temporary data and handler.
            delete this.query_el.dataset['query_string'];
            this.query_el.removeAttribute('onkeydown');
        }

        inputs_el.onkeydown = e => this.keydown(e);
        this.query_el.onkeydown = e => this.query_keydown(e);
        this.query_el.onkeyup = () => this.query_keyup();
        show_extra_right_el.onclick = () => this.show_extra_right_click();
        this.pool_el.onchange = () => this.pool_change();
        this.sort_order_el.onchange = () => this.sort_order_change();
        this.sort_dir_asc_el.onchange = () => this.sort_dir_change();
        this.sort_dir_desc_el.onchange = () => this.sort_dir_change();
        this.first_el.onclick = () => search.set({ pos: search.result.first_page });
        this.prev_el.onclick = () => search.set({ pos: search.result.prev_page });
        this.next_el.onclick = () => search.set({ pos: search.result.next_page });
        this.last_el.onclick = () => search.set({ pos: search.result.last_page });

        this.set_from_params();
        globalThis.onpopstate = () => this.set_from_params();

        this.update();

        this.result_view = new Query_Result_View(
            ctx,
            search.result,
            () => this.query_el.focus(),
            result_el,
        );
    }

    get hidden(): boolean {
        return this.inputs_el.hidden;
    }

    set hidden(hidden: boolean) {
        this.inputs_el.hidden = hidden;
        this.navigation_el.hidden = hidden;
        this.result_view.hidden = hidden;
    }

    invalidated(_dependency: Dependency): void { }

    update(): void {
        const result = this.search.result;

        // We don't want to overwrite the user's input if the query string didn't change.
        if (result.query_string !== this.prev_query_string) {
            this.query_el.value = result.query_string;
            this.prev_query_string = result.query_string;
        }

        this.pool_el.value = result.pool;
        this.sort_order_el.value = result.sort_order;
        (result.sort_asc ? this.sort_dir_asc_el : this.sort_dir_desc_el).checked = true;

        let summary: string;

        switch (result.loading_state) {
            // Avoid showing "Loading..." right under the query field when the user opens the app,
            // as it makes you think you can't filter cards yet.
            case 'initial':
            case 'first_load':
                summary = '';
                break;
            case 'loading':
                summary = 'Loading...';
                break;
            case 'success':
                summary =
                    result.size === 0
                        ? 'No matches.'
                        : `Showing ${result.pos + 1}-${result.pos + result.page_size} of ${result.size} matches.`;
                break;
            default:
                unreachable();
        }

        this.summary_el.innerText = summary;

        const at_first_page = result.pos === result.first_page;
        const at_last_page = result.pos >= result.last_page;
        this.first_el.disabled = at_first_page;
        this.prev_el.disabled = at_first_page;
        this.next_el.disabled = at_last_page;
        this.last_el.disabled = at_last_page;

        this.set_params();
    }

    private keydown(e: KeyboardEvent): void {
        const el = document.activeElement;

        if (el && el.tagName === 'INPUT' && (el as HTMLInputElement).type === 'text') {
            return;
        }

        switch (key_combo(e)) {
            case 'f':
            case '/':
                e.preventDefault();
                e.stopPropagation();
                this.query_el.focus();
                break;
        }
    }

    private query_keydown(e: KeyboardEvent): void {
        switch (key_combo(e)) {
            case 'Enter': {
                e.stopPropagation();
                this.search.set({
                    query_string: this.query_el.value,
                    pos: 0,
                });
                break;
            }
            case 'ArrowDown': {
                e.preventDefault();
                e.stopPropagation();
                this.result_view.focus();
                break;
            }
            case 'ArrowUp': {
                // Because we break the regular down arrow behavior, we also break the up arrow
                // for consistency.
                e.preventDefault();
                e.stopPropagation();
                break;
            }
        }
    }

    private async query_keyup(): Promise<void> {
        // Try to preload properties while the user is typing.
        await this.search.preload(this.query_el.value);
    }

    private show_extra_right_click(): void {
        this.extra_el.classList.toggle('filter_extra_shown');
    }

    private pool_change(): void {
        const pool = this.pool_el.value;
        this.search.set({
            pool,
            pos: 0,
        });
    }

    private sort_order_change(): void {
        this.search.set({
            sort_order: this.sort_order_el.value as Sort_Order,
            pos: 0,
        });
    }

    private sort_dir_change(): void {
        const sort_asc = this.sort_dir_asc_el.checked;
        assert(this.sort_dir_desc_el.checked !== sort_asc);
        this.search.set({
            sort_asc,
            pos: 0,
        });
    }

    async set_from_params(): Promise<void> {
        const logger = this.ctx.logger;
        const result = this.search.result;
        const params = get_params();

        let new_state: Query_Result_State = {
            sort_order: DEFAULT_SORT_ORDER,
            sort_asc: DEFAULT_SORT_ASC,
            pos: DEFAULT_START_POS,
        };

        new_state.query_string = params.get('q') ?? DEFAULT_QUERY_STRING;

        const pool = params.get('p');

        if (pool !== null) {
            if (pool in POOLS) {
                new_state.pool = pool;
            } else {
                logger.error(`Invalid pool in URL: ${pool}`);
            }
        }

        const sort_order = params.get('o') as Sort_Order | null;

        if (sort_order !== null) {
            if (SORT_ORDERS.includes(sort_order)) {
                new_state.sort_order = sort_order;
            } else {
                logger.error(`Invalid sort order in URL: ${sort_order}`);
            }
        }

        const sort_dir = params.get('d');

        if (sort_dir !== null) {
            if (sort_dir === 'a' || sort_dir === 'd') {
                new_state.sort_asc = sort_dir === 'a';
            } else {
                logger.error(`Invalid sort direction in URL: ${sort_dir}`);
            }
        }

        const pos = params.get('s');

        if (pos !== null) {
            const pos_int = string_to_int(pos);

            if (pos_int !== null && pos_int >= 1) {
                new_state.pos = pos_int - 1;
            } else {
                logger.error(`Invalid start position in URL: ${pos}`);
            }
        }

        await result.set(new_state, result.loading_state === 'initial' ? true : undefined);
    }

    private set_params(): void {
        const result = this.search.result;
        const params = get_params();

        if (result.query_string === DEFAULT_QUERY_STRING) {
            params.delete('q');
        } else {
            params.set('q', result.query_string);
        }

        if (result.pool === DEFAULT_POOL) {
            params.delete('p');
        } else {
            params.set('p', result.pool);
        }

        if (result.pos === DEFAULT_START_POS) {
            params.delete('s');
        } else {
            params.set('s', String(result.pos + 1));
        }

        if (result.sort_order === DEFAULT_SORT_ORDER) {
            params.delete('o');
        } else {
            params.set('o', result.sort_order);
        }

        if (result.sort_asc === DEFAULT_SORT_ASC) {
            params.delete('d');
        } else {
            params.set('d', result.sort_asc ? 'a' : 'd');
        }

        const new_search = params.size ? `?${params}` : '';

        if (globalThis.location.search !== new_search) {
            globalThis.history.pushState(null, '', `/${new_search}`);
        }
    }
}

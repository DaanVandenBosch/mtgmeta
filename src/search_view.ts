import { Card_List_View } from "./card_list_view";
import type { Sort_Order } from "./cards";
import { get_el, unreachable, key_combo, assert } from "./core";
import type { Search_State, Context } from "./data";
import type { Dependent } from "./deps";

export class Search_View implements Dependent {
    private state: Search_State;
    private prev_query_string: string = '';
    private query_el: HTMLInputElement;
    private extra_el: HTMLButtonElement;
    private pool_el: HTMLSelectElement;
    private sort_order_el: HTMLSelectElement;
    private sort_dir_asc_el: HTMLInputElement;
    private sort_dir_desc_el: HTMLInputElement;
    private result_summary_el: HTMLElement;
    private result_prev_el: HTMLButtonElement;
    private result_next_el: HTMLButtonElement;
    private result_first_el: HTMLButtonElement;
    private result_last_el: HTMLButtonElement;
    private list_view: Card_List_View;

    constructor(ctx: Context, state: Search_State, el: HTMLElement) {
        this.state = state;
        ctx.deps.add(this, state.list);

        this.query_el = get_el(el, ':scope > header .query');
        const show_extra_el: HTMLElement = get_el(el, ':scope > header .filter_show_extra');
        this.extra_el = get_el(el, ':scope > header .filter_extra');
        this.pool_el = get_el(el, ':scope > header .pool');
        this.sort_order_el = get_el(el, ':scope > header .sort_order');
        this.sort_dir_asc_el = get_el(el, ':scope > header .sort_dir input[value=asc]');
        this.sort_dir_desc_el = get_el(el, ':scope > header .sort_dir input[value=desc]');
        this.result_summary_el = get_el(el, ':scope > header .result_summary');
        this.result_prev_el = get_el(el, ':scope > header .result_prev');
        this.result_next_el = get_el(el, ':scope > header .result_next');
        this.result_first_el = get_el(el, ':scope > header .result_first');
        this.result_last_el = get_el(el, ':scope > header .result_last');

        // The initial HTML onkeydown handler might have already set a query string.
        const initial_query_string = this.query_el.dataset['query_string'];

        if (initial_query_string !== undefined) {
            state.set({ query_string: initial_query_string });

            // Remove the temporary data and handler.
            delete this.query_el.dataset['query_string'];
            this.query_el.removeAttribute('onkeydown');
        }

        el.onkeydown = e => this.keydown(e);
        this.query_el.onkeydown = e => this.query_keydown(e);
        this.query_el.onkeyup = () => this.query_keyup();
        show_extra_el.onclick = () => this.show_extra_click();
        this.pool_el.onchange = () => this.pool_change();
        this.sort_order_el.onchange = () => this.sort_order_change();
        this.sort_dir_asc_el.onchange = () => this.sort_dir_change();
        this.sort_dir_desc_el.onchange = () => this.sort_dir_change();
        this.result_prev_el.onclick = () => state.set({ pos: state.list.prev_page });
        this.result_next_el.onclick = () => state.set({ pos: state.list.next_page });
        this.result_first_el.onclick = () => state.set({ pos: state.list.first_page });
        this.result_last_el.onclick = () => state.set({ pos: state.list.last_page });

        this.update();

        this.list_view = new Card_List_View(
            ctx,
            state.list,
            () => this.query_el.focus(),
            get_el<HTMLDivElement>(el, ':scope > .result')
        );
    }

    update() {
        const list = this.state.list;

        // We don't want to overwrite the user's input if the query string didn't change.
        if (list.query_string !== this.prev_query_string) {
            this.query_el.value = list.query_string;
            this.prev_query_string = list.query_string;
        }

        this.pool_el.value = list.pool;
        this.sort_order_el.value = list.sort_order;
        (list.sort_asc ? this.sort_dir_asc_el : this.sort_dir_desc_el).checked = true;

        let summary: string;

        switch (list.loading_state) {
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
                    list.size === 0
                        ? 'No matches.'
                        : `Showing ${list.pos + 1}-${list.pos + list.page_size} of ${list.size} matches.`;
                break;
            default:
                unreachable();
        }

        this.result_summary_el.innerText = summary;

        const at_first_page = list.pos === list.first_page;
        const at_last_page = list.pos >= list.last_page;
        this.result_prev_el.disabled = at_first_page;
        this.result_next_el.disabled = at_last_page;
        this.result_first_el.disabled = at_first_page;
        this.result_last_el.disabled = at_last_page;
    }

    private keydown(e: KeyboardEvent) {
        const el = document.activeElement;

        if (el === null || !['BUTTON', 'INPUT', 'SELECT'].includes(el.tagName)) {
            switch (key_combo(e)) {
                case 'f':
                case '/':
                    e.preventDefault();
                    e.stopPropagation();
                    this.query_el.focus();
                    break;
            }
        }
    }

    private query_keydown(e: KeyboardEvent) {
        switch (key_combo(e)) {
            case 'Enter': {
                e.stopPropagation();
                this.state.set({
                    query_string: this.query_el.value,
                    pos: 0,
                });
                break;
            }
            case 'ArrowDown': {
                e.preventDefault();
                e.stopPropagation();
                this.list_view.focus();
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

    private async query_keyup() {
        // Try to preload properties while the user is typing.
        this.state.preload(this.query_el.value);
    }

    private show_extra_click() {
        this.extra_el.classList.toggle('filter_extra_shown');
    }

    private pool_change() {
        const pool = this.pool_el.value;
        this.state.set({
            pool,
            pos: 0,
        });
    }

    private sort_order_change() {
        this.state.set({
            sort_order: this.sort_order_el.value as Sort_Order,
            pos: 0,
        });
    }

    private sort_dir_change() {
        const sort_asc = this.sort_dir_asc_el.checked;
        assert(this.sort_dir_desc_el.checked !== sort_asc);
        this.state.set({
            sort_asc,
            pos: 0,
        });
    }
}

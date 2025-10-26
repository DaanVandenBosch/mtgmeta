import { run_benchmarks } from "./benchmarks";
import {
    assert,
    Console_Logger,
    create_el,
    get_el,
    Nop_Logger,
    string_to_int,
    unreachable,
    type Logger,
} from "./core";
import { Cards, SORT_ORDERS, type Sort_Order } from "./data";
import { parse_query, type Query } from "./query";
import { find_cards_matching_query, PROPS_REQUIRED_FOR_DISPLAY } from "./query_eval";
import { run_test_suite } from "./tests";

const POOL_ALL = 'all';
const POOL_PREMODERN_PAUPER = 'pmp';
const POOL_PREMODERN_PAUPER_COMMANDER = 'pmpc';
const POOL_PREMODERN_PEASANT = 'pmpst';
const POOL_PREMODERN_PEASANT_COMMANDER = 'pmpstc';
const POOL_MODERN_PAUPER = 'mp';
const POOL_MODERN_PAUPER_COMMANDER = 'mpc';

const POOLS: { [K: string]: Query } = {};

const DEFAULT_QUERY_STRING = '';
const DEFAULT_POOL = POOL_ALL;
const DEFAULT_SORT_ORDER: Sort_Order = 'name';
const DEFAULT_SORT_ASC = true;
const DEFAULT_START_POS = 0;

class Context {
    readonly logger: Logger;
    readonly cards = new Cards;
    readonly view: {
        active: 'search' | 'card_list',
        search: Search_State | null,
        card_list: Card_List | null,
    } = {
            active: 'search',
            search: null,
            card_list: null,
        };
    readonly deps = new Deps;

    constructor(logger: Logger) {
        this.logger = logger;
    }
};

type Loading_State = 'initial' | 'first_load' | 'loading' | 'success';

type Card_List_State = {
    query_string?: string,
    pos?: number,
    sort_order?: Sort_Order,
    sort_asc?: boolean,
    loading_state?: Loading_State,
    all_card_indexes?: readonly number[],
};

class Card_List {
    protected ctx: Context;
    readonly id: number;
    private _query_string: string = DEFAULT_QUERY_STRING;
    private _query: Query = parse_query(this._query_string);
    private _pos: number = 0;
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

    get size(): number {
        return this._all_card_indexes.length;
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

    async set(state: Card_List_State, execute_query?: boolean) {
        let changed = false;
        let execute_necessary = false;

        if (state.query_string !== undefined && state.query_string != this.query_string) {
            this._query_string = state.query_string;
            this._query = parse_query(state.query_string);
            changed = true;
            execute_necessary = true;
        }

        if (state.pos !== undefined && state.pos !== this._pos) {
            this._pos = state.pos;
            changed = true;
        }

        if (state.sort_order !== undefined && state.sort_order !== this._sort_order) {
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

    async execute_query() {
        const logger = this.ctx.logger;
        logger.group('Executing card query.');

        // TODO: Cancel load underway.

        this.set({ loading_state: this.loading_state === 'initial' ? 'first_load' : 'loading' });

        logger.time(this.execute_query.name);
        logger.log('query string', this.query_string);
        logger.log('query', this.query);

        const MAX_ATTEMPTS = 2;

        for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
            try {
                await this.execute_query_attempt();
                break;
            } catch (e) {
                if (attempt < MAX_ATTEMPTS) {
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

class Search_State {
    private ctx: Context;
    readonly list: Card_List;

    constructor(ctx: Context, list: Card_List) {
        this.ctx = ctx;
        this.list = list;
    }

    set(state: Card_List_State) {
        this.list.set(state);
        // No need to await data load.

        const params = get_params();
        set_params_from_card_list(this.list, params);
    }

    /** Preloads properties needed for a given query string. */
    async preload(query_string: string) {
        if (query_string !== this.list.query_string) {
            const MAX_ATTEMPTS = 2;

            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                try {
                    const loads = [
                        ...parse_query(query_string).props,
                        // Ensure all display props are reloaded when data is out of date:
                        ...PROPS_REQUIRED_FOR_DISPLAY,
                    ].map(prop => this.ctx.cards.load(prop));

                    await Promise.all(loads);
                } catch (e) {
                    if (attempt < MAX_ATTEMPTS) {
                        this.ctx.logger.error('Error while preloading properties, retrying.', e);
                        continue;
                    } else {
                        throw e;
                    }
                }
            }
        }
    }
};

const SEARCH_CARD_LIST_ID = 1;

async function init() {
    Console_Logger.time('init');
    const ctx = new Context(Console_Logger);

    ctx.view.search = new Search_State(
        ctx,
        new Card_List(ctx, SEARCH_CARD_LIST_ID),
    );

    const params = get_params();
    const set_state_promise = set_card_list_from_params(ctx, ctx.view.search.list, params);

    // Initialize view right after setting state from parameters, but before awaiting the initial
    // data load.
    new Main_View(ctx, document.body);

    globalThis.onpopstate = () => {
        set_card_list_from_params(ctx, ctx.view.search!.list, get_params());
    };

    await set_state_promise;

    Console_Logger.time_end('init');

    // Run tests and benchmarks if requested.
    const tests_param_str = params.get('tests');
    const tests_param =
        tests_param_str === null
            ? null
            : tests_param_str.toLocaleLowerCase('en') === 'true';
    const benchmarks_param_str = params.get('benchmarks');
    const benchmarks_param =
        benchmarks_param_str === null
            ? null
            : benchmarks_param_str.toLocaleLowerCase('en') === 'true';

    // Run tests when hostname is localhost or an IPv4 address or explicit parameter is passed.
    const is_dev_host =
        globalThis.location.hostname === 'localhost'
        || /^\d+\.\d+\.\d+\.\d+(:\d+)?$/g.test(globalThis.location.hostname);

    if (tests_param === true || (is_dev_host && tests_param === null)) {
        await run_test_suite(ctx.cards);
    }

    if (benchmarks_param === true) {
        await run_benchmarks(ctx.cards);
    }
}

function get_params(): URLSearchParams {
    return new URLSearchParams(globalThis.location.search);
}

async function set_card_list_from_params(
    ctx: Context,
    list: Card_List,
    params: URLSearchParams,
) {
    let new_state: Card_List_State = {
        sort_order: DEFAULT_SORT_ORDER,
        sort_asc: DEFAULT_SORT_ASC,
        pos: DEFAULT_START_POS,
    };

    new_state.query_string = params.get('q') ?? DEFAULT_QUERY_STRING;

    // TODO: pool
    // const pool = params.get('p');

    // if (pool !== null) {
    //     if (pool in POOLS) {
    //         window.list.pool = pool;
    //     } else {
    //         ctx.logger.error(`Invalid pool in URL: ${pool}`);
    //     }
    // }

    const sort_order = params.get('o') as Sort_Order | null;

    if (sort_order !== null) {
        if (SORT_ORDERS.includes(sort_order)) {
            new_state.sort_order = sort_order;
        } else {
            ctx.logger.error(`Invalid sort order in URL: ${sort_order}`);
        }
    }

    const sort_dir = params.get('d');

    if (sort_dir !== null) {
        if (sort_dir === 'a' || sort_dir === 'd') {
            new_state.sort_asc = sort_dir === 'a';
        } else {
            ctx.logger.error(`Invalid sort direction in URL: ${sort_dir}`);
        }
    }

    const pos = params.get('s');

    if (pos !== null) {
        const pos_int = string_to_int(pos);

        if (pos_int !== null && pos_int >= 1) {
            new_state.pos = pos_int - 1;
        } else {
            ctx.logger.error(`Invalid start position in URL: ${pos}`);
        }
    }

    await list.set(new_state, list.loading_state === 'initial' ? true : undefined);
}

function set_params_from_card_list(
    list: Card_List,
    params: URLSearchParams,
) {
    if (list.query_string === DEFAULT_QUERY_STRING) {
        params.delete('q');
    } else {
        params.set('q', list.query_string);
    }

    // TODO: pool.

    if (list.pos === DEFAULT_START_POS) {
        params.delete('s');
    } else {
        params.set('s', String(list.pos + 1));
    }

    if (list.sort_order === DEFAULT_SORT_ORDER) {
        params.delete('o');
    } else {
        params.set('o', list.sort_order);
    }

    if (list.sort_asc === DEFAULT_SORT_ASC) {
        params.delete('d');
    } else {
        params.set('d', list.sort_asc ? 'a' : 'd');
    }

    const new_search = params.size ? `?${params}` : '';

    if (globalThis.location.search !== new_search) {
        globalThis.history.pushState(null, '', `/${new_search}`);
    }
}

interface Dependent {
    update(): void;
}

class Deps {
    private dependent_to_dependencies = new Map<Dependent, Set<any>>;
    private dependency_to_dependents = new Map<any, Set<Dependent>>;
    private out_of_date_dependents = new Set<Dependent>;
    private update_scheduled = false;

    add(dependent: Dependent, ...dependencies: any[]) {
        let dependencies_set = this.dependent_to_dependencies.get(dependent);

        if (dependencies_set === undefined) {
            dependencies_set = new Set;
            this.dependent_to_dependencies.set(dependent, dependencies_set);
        }

        for (const dependency of dependencies) {
            dependencies_set.add(dependency);

            let dependents = this.dependency_to_dependents.get(dependency);

            if (dependents === undefined) {
                dependents = new Set;
                this.dependency_to_dependents.set(dependency, dependents);
            }

            dependents.add(dependent);
        }
    }

    remove_all(dependent: Dependent) {
        const dependencies = this.dependent_to_dependencies.get(dependent);

        if (dependencies !== undefined) {
            for (const dependency of dependencies) {
                const changed = this.dependency_to_dependents.get(dependency)!.delete(dependent);
                assert(changed);
            }

            this.dependent_to_dependencies.delete(dependent);
        }
    }

    changed(...dependencies: any[]) {
        for (const dependency of dependencies) {
            const dependents = this.dependency_to_dependents.get(dependency);

            if (dependents) {
                for (const dependent of dependents) {
                    this.out_of_date_dependents.add(dependent);
                }
            }
        }

        if (!this.update_scheduled) {
            requestAnimationFrame(() => {
                this.update_scheduled = false;

                try {
                    for (const dependent of this.out_of_date_dependents) {
                        try {
                            dependent.update();
                        } catch (e) {
                            Console_Logger.error(e);
                        }
                    }
                } finally {
                    this.out_of_date_dependents.clear();
                }
            });
            this.update_scheduled = true;
        }
    }
}

class Main_View {
    private ctx: Context;
    private search_view: Search_View | null = null;
    readonly el: HTMLElement;

    constructor(ctx: Context, el: HTMLElement) {
        this.ctx = ctx;
        this.el = el;
        this.update();
    }

    update() {
        switch (this.ctx.view.active) {
            case 'search':
                if (this.ctx.view.search) {
                    if (this.search_view === null) {
                        this.search_view = new Search_View(this.ctx, this.ctx.view.search, this.el);
                    }
                }

                break;
            case 'card_list':
                break;
            default:
                unreachable();
        }
    }
}

class Search_View implements Dependent {
    private state: Search_State;
    private prev_query_string: string = '';
    private query_el: HTMLInputElement;
    private pool_el: HTMLSelectElement;
    private sort_order_el: HTMLSelectElement;
    private sort_dir_asc_el: HTMLInputElement;
    private sort_dir_desc_el: HTMLInputElement;
    private result_summary_el: HTMLElement;
    private result_prev_el: HTMLButtonElement;
    private result_next_el: HTMLButtonElement;
    private result_first_el: HTMLButtonElement;
    private result_last_el: HTMLButtonElement;

    constructor(ctx: Context, state: Search_State, el: HTMLElement) {
        this.state = state;
        ctx.deps.add(this, state.list);

        this.query_el = get_el(el, ':scope > header .query');
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

        this.query_el.onkeydown = e => this.query_keydown(e);
        this.query_el.onkeyup = () => this.query_keyup();
        this.sort_order_el.onchange = () => this.sort_order_change();
        this.sort_dir_asc_el.onchange = () => this.sort_dir_change();
        this.sort_dir_desc_el.onchange = () => this.sort_dir_change();
        this.result_prev_el.onclick = () => state.set({ pos: state.list.prev_page });
        this.result_next_el.onclick = () => state.set({ pos: state.list.next_page });
        this.result_first_el.onclick = () => state.set({ pos: state.list.first_page });
        this.result_last_el.onclick = () => state.set({ pos: state.list.last_page });

        this.update();

        new Card_List_View(
            ctx,
            state.list,
            get_el<HTMLDivElement>(el, ':scope > .result'),
        );
    }

    update() {
        const list = this.state.list;

        // We don't want to overwrite the user's input if the query string didn't change.
        if (list.query_string !== this.prev_query_string) {
            this.query_el.value = list.query_string;
            this.prev_query_string = list.query_string;
        }

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

    private query_keydown(e: KeyboardEvent) {
        switch (key_combo(e)) {
            case 'Enter': {
                this.state.set({
                    query_string: this.query_el.value,
                    pos: 0,
                });
                break;
            }
            case 'ArrowDown': {
                e.preventDefault();
                e.stopPropagation();
                // TODO
                // this.move_card_focus('down');
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

    private sort_order_change() {
        const sort_order = this.sort_order_el.value as Sort_Order;
        assert(
            SORT_ORDERS.includes(sort_order),
            () => `Invalid sort order "${sort_order}" in select field.`,
        );
        this.state.set({
            sort_order,
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

class Card_List_View implements Dependent {
    private ctx: Context;
    private list: Card_List;
    private loading_el: HTMLElement;
    private cards_el: HTMLElement;
    readonly el: HTMLElement;

    constructor(ctx: Context, list: Card_List, el?: HTMLDivElement) {
        this.ctx = ctx;
        this.list = list;
        ctx.deps.add(this, list);

        this.el = el ?? create_el('div');
        this.el.className = 'result';
        this.loading_el = el?.querySelector(':scope > .cards_loading') ?? create_el('div');
        this.loading_el.className = 'cards_loading';
        this.loading_el.innerText = 'Loading...';
        this.cards_el = el?.querySelector(':scope > .cards') ?? create_el('div');
        this.cards_el.className = 'cards';
        this.update();
        this.el.append(this.loading_el, this.cards_el);
    }

    update() {
        const loading =
            this.list.loading_state === 'initial' || this.list.loading_state === 'first_load';

        this.loading_el.hidden = !loading;
        this.cards_el.hidden = loading;

        if (!loading) {
            const cards = this.ctx.cards;
            const frag = document.createDocumentFragment();

            for (const card_index of this.list.card_indexes) {
                const div = create_el('div');
                div.className = 'card_wrapper';

                if (cards.get<boolean>(card_index, 'landscape') === true) {
                    div.classList.add('landscape');
                }

                const a: HTMLAnchorElement = create_el('a');
                a.className = 'card';
                a.href = cards.scryfall_url(card_index) ?? '';
                a.target = '_blank';
                a.rel = 'noreferrer';
                div.append(a);

                const img: HTMLImageElement = create_el('img');
                img.loading = 'lazy';
                img.src = cards.image_url(card_index) ?? '';
                a.append(img);

                frag.append(div);
            }

            this.cards_el.replaceChildren(frag);
            this.el.scrollTo(0, 0);
        }
    }

    dispose() {
        this.ctx.deps.remove_all(this);
        this.el.remove();
    }
}

function key_combo(e: KeyboardEvent): string {
    const bind = [];

    if (e.ctrlKey) {
        bind.push('Ctrl');
    }

    if (e.altKey) {
        bind.push('Alt');
    }

    if (e.shiftKey) {
        bind.push('Shift');
    }

    if (e.metaKey) {
        bind.push('Meta');
    }

    if (e.key !== '') {
        bind.push(e.key);
    }

    return bind.join(' ');
}

if (document.body) {
    init();
} else {
    globalThis.addEventListener('DOMContentLoaded', init);
}

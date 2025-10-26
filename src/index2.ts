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
        card_list: Card_List_Window | null,
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

abstract class Card_List {
    protected ctx: Context;
    readonly id: number;
    private _loading_state: Loading_State = 'initial';
    private _card_indexes: ReadonlyMap<number, number> = new Map;

    constructor(ctx: Context, id: number) {
        this.ctx = ctx;
        this.id = id;
    }

    get size(): number {
        return this._card_indexes.size;
    }

    get loading_state(): Loading_State {
        return this._loading_state;
    }

    set loading_state(state: Loading_State) {
        if (this._loading_state !== state) {
            this._loading_state = state;
            this.ctx.deps.changed(this);
        }
    }

    /** Maps card indexes to version indexes. */
    get card_indexes(): ReadonlyMap<number, number> {
        return this._card_indexes;
    }

    set card_indexes(indexes: ReadonlyMap<number, number>) {
        if (this._card_indexes !== indexes) {
            this._card_indexes = indexes;
            this.ctx.deps.changed(this);
        }
    }
}

class Query_Card_List extends Card_List {
    readonly type = 'query';
    private _query_string: string = DEFAULT_QUERY_STRING;
    private _query: Query = parse_query(this._query_string);

    get query_string(): string {
        return this._query_string;
    }

    set query_string(query_string: string) {
        if (this._query_string !== query_string) {
            this._query_string = query_string;
            this._query = parse_query(query_string);
            this.ctx.deps.changed(this);
        }
    }

    get query(): Query {
        return this._query;
    }
}

class Set_Card_List extends Card_List {
    readonly type = 'set';
    readonly cards: ReadonlyMap<number, number> = new Map;
};

type Card_List_Window_State = {
    query_string?: string,
    pos?: number,
    sort_order?: Sort_Order,
    sort_asc?: boolean,
};

class Card_List_Window<List extends Card_List = Card_List> {
    private ctx: Context;
    readonly list: List;
    private _pos: number = 0;
    readonly max: number = 120;
    private _sort_order: Sort_Order = DEFAULT_SORT_ORDER;
    private _sort_asc: boolean = DEFAULT_SORT_ASC;
    /** Contains all cards of list, sorted. */
    private _all_card_indexes: readonly number[] = [];

    constructor(ctx: Context, list: List) {
        this.ctx = ctx;
        this.list = list;
    }

    async set(state: Card_List_Window_State) {
        let changed = false;

        if (state.query_string !== undefined) {
            assert(this.list instanceof Query_Card_List);

            if (state.query_string != this.list.query_string) {
                this.list.query_string = state.query_string;
                changed = true;
            }
        }

        if (state.pos !== undefined && state.pos !== this._pos) {
            this._pos = state.pos;
            changed = true;
        }

        if (state.sort_order !== undefined && state.sort_order !== this._sort_order) {
            this._sort_order = state.sort_order;
            changed = true;
        }

        if (state.sort_asc !== undefined && state.sort_asc !== this._sort_asc) {
            this._sort_asc = state.sort_asc;
            changed = true;
        }

        if (changed || this.list.loading_state === 'initial') {
            this.ctx.deps.changed(this);
            await load_card_list_window(this.ctx, this);
        }
    }

    get size(): number {
        return Math.min(this.max, this.list.size - this.pos);
    }

    get pos(): number {
        return this._pos;
    }

    get prev_page(): number {
        return Math.max(0, this.pos - this.max);
    }

    get next_page(): number {
        return Math.min(this.last_page, this.pos + this.max);
    }

    get first_page(): number {
        return 0;
    }

    get last_page(): number {
        const length = this.list.size;
        const offset = this.pos % this.max;
        return Math.floor((Math.max(0, length - 1) - offset) / this.max) * this.max + offset;
    }

    get sort_order(): Sort_Order {
        return this._sort_order;
    }

    get sort_asc(): boolean {
        return this._sort_asc;
    }

    /** Contains all cards of list, sorted. */
    set all_card_indexes(indexes: readonly number[]) {
        if (this._all_card_indexes !== indexes) {
            this._all_card_indexes = indexes;
            this.ctx.deps.changed(this);
        }
    }

    get card_indexes(): readonly number[] {
        return this._all_card_indexes.slice(this.pos, this.pos + this.max);
    }
}

class Search_State {
    private ctx: Context;
    readonly window: Card_List_Window<Query_Card_List>;

    constructor(ctx: Context, window: Card_List_Window<Query_Card_List>) {
        this.ctx = ctx;
        this.window = window;
    }

    set(state: Card_List_Window_State) {
        this.window.set(state);
        // No need to await data load.

        const params = get_params();
        set_params_from_card_list_window(this.window, params);
    }

    /** Preloads properties needed for a given query string. */
    async preload(query_string: string) {
        if (query_string !== this.window.list.query_string) {
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
        new Card_List_Window(ctx, new Query_Card_List(ctx, SEARCH_CARD_LIST_ID)),
    );

    const params = get_params();
    const set_state_promise = set_card_list_window_from_params(ctx, ctx.view.search.window, params);

    // Initialize view right after setting state from parameters, but before awaiting the initial
    // data load.
    new Main_View(ctx, document.body);

    globalThis.onpopstate = () => {
        set_card_list_window_from_params(ctx, ctx.view.search!.window, get_params());
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

async function set_card_list_window_from_params(
    ctx: Context,
    window: Card_List_Window,
    params: URLSearchParams,
) {
    let new_state: Card_List_Window_State = {
        sort_order: DEFAULT_SORT_ORDER,
        sort_asc: DEFAULT_SORT_ASC,
        pos: DEFAULT_START_POS,
    };

    if (window.list instanceof Query_Card_List) {
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
    } else {
        unreachable();
    }

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

    await window.set(new_state);
}

function set_params_from_card_list_window(
    window: Card_List_Window,
    params: URLSearchParams,
) {
    if (window.list instanceof Query_Card_List) {
        if (window.list.query_string === DEFAULT_QUERY_STRING) {
            params.delete('q');
        } else {
            params.set('q', window.list.query_string);
        }
    }

    // TODO: pool.

    if (window.pos === DEFAULT_START_POS) {
        params.delete('s');
    } else {
        params.set('s', String(window.pos + 1));
    }

    if (window.sort_order === DEFAULT_SORT_ORDER) {
        params.delete('o');
    } else {
        params.set('o', window.sort_order);
    }

    if (window.sort_asc === DEFAULT_SORT_ASC) {
        params.delete('d');
    } else {
        params.set('d', window.sort_asc ? 'a' : 'd');
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

async function load_card_list_window(ctx: Context, window: Card_List_Window) {
    ctx.logger.group('Loading cards.');

    // TODO: Cancel load underway.

    window.list.loading_state = window.list.loading_state === 'initial' ? 'first_load' : 'loading';

    ctx.logger.time(load_card_list_window.name);

    if (window.list instanceof Query_Card_List) {
        await load_query_card_list(ctx, window.list, window);
    } else if (window.list instanceof Set_Card_List) {
        // TODO
        unreachable();
    } else {
        unreachable();
    }

    window.list.loading_state = 'success';

    ctx.logger.time_end(load_card_list_window.name);
    ctx.logger.group_end();
}

async function load_query_card_list(ctx: Context, list: Query_Card_List, window: Card_List_Window) {
    ctx.logger.log('query string', list.query_string);
    ctx.logger.log('query', list.query);

    const MAX_ATTEMPTS = 2;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            await load_query_card_list_attempt(ctx, list, window);
            break;
        } catch (e) {
            if (attempt < MAX_ATTEMPTS) {
                ctx.logger.error('Error while finding matching cards, retrying.', e);
                continue;
            } else {
                throw e;
            }
        }
    }
}

async function load_query_card_list_attempt(
    ctx: Context,
    list: Query_Card_List,
    window: Card_List_Window,
) {
    const logger = ctx.logger;
    logger.time(load_query_card_list_attempt.name);
    logger.time('load');

    // Fire off data loads.
    const required_for_query_promises = list.query.props.map(prop => ctx.cards.load(prop));
    const required_for_display_promises =
        PROPS_REQUIRED_FOR_DISPLAY.map(prop => ctx.cards.load(prop));

    const sorter_promise = ctx.cards.get_sorter(window.sort_order);

    // Await data loads necessary for query.
    for (const promise of required_for_query_promises) {
        await promise;
    }

    // Await at least one display property if we have no required properties to wait for, just to
    // get the amount of cards.
    if (ctx.cards.length === null) {
        await Promise.race(required_for_display_promises);
    }

    logger.time_end('load');
    logger.time('query_evaluate');

    list.card_indexes =
        await find_cards_matching_query(ctx.cards, list.query, () => Nop_Logger);

    logger.time_end('query_evaluate');
    logger.time('load_sorter');

    const sorter = await sorter_promise;

    logger.time_end('load_sorter');
    logger.time('sort');

    const window_card_indexes = sorter.sort(list.card_indexes, window.sort_asc);

    logger.time_end('sort');
    logger.time('load_display');

    // Await data loads necessary for display.
    for (const promise of required_for_display_promises) {
        await promise;
    }

    window.all_card_indexes = window_card_indexes;

    logger.time_end('load_display');
    logger.time_end(load_query_card_list_attempt.name);
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
        ctx.deps.add(this, state.window, state.window.list);

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
        this.result_prev_el.onclick = () => state.set({ pos: state.window.prev_page });
        this.result_next_el.onclick = () => state.set({ pos: state.window.next_page });
        this.result_first_el.onclick = () => state.set({ pos: state.window.first_page });
        this.result_last_el.onclick = () => state.set({ pos: state.window.last_page });

        this.update();

        new Card_List_View(
            ctx,
            state.window,
            get_el<HTMLDivElement>(el, ':scope > .result'),
        );
    }

    update() {
        const window = this.state.window;

        // We don't want to overwrite the user's input if the query string didn't change.
        if (window.list.query_string !== this.prev_query_string) {
            this.query_el.value = window.list.query_string;
            this.prev_query_string = window.list.query_string;
        }

        this.sort_order_el.value = window.sort_order;
        (window.sort_asc ? this.sort_dir_asc_el : this.sort_dir_desc_el).checked = true;

        let summary: string;

        switch (window.list.loading_state) {
            // Avoid showing "Loading..." when the user opens the app, as it makes you think you
            // can't filter cards yet.
            case 'initial':
            case 'first_load':
                summary = '';
                break;
            case 'loading':
                summary = 'Loading...';
                break;
            case 'success':
                summary =
                    window.list.size === 0
                        ? 'No matches.'
                        : `Showing ${window.pos + 1}-${window.pos + window.size} of ${window.list.size} matches.`;
                break;
            default:
                unreachable();
        }

        this.result_summary_el.innerText = summary;

        const at_first_page = window.pos === window.first_page;
        const at_last_page = window.pos >= window.last_page;
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
    private window: Card_List_Window;
    private loading_el: HTMLElement;
    private cards_el: HTMLElement;
    readonly el: HTMLElement;

    constructor(ctx: Context, window: Card_List_Window, el?: HTMLDivElement) {
        this.ctx = ctx;
        this.window = window;
        ctx.deps.add(this, window);

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
        const list = this.window.list;
        const loading = list.loading_state === 'initial' || list.loading_state === 'first_load';

        this.loading_el.hidden = !loading;
        this.cards_el.hidden = loading;

        if (!loading) {
            const cards = this.ctx.cards;
            const frag = document.createDocumentFragment();

            for (const card_index of this.window.card_indexes) {
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

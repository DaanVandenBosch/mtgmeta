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
const DEFAULT_START_POS = 1;

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
        this.set_query_string(query_string);
    }

    set_query_string(query_string: string): boolean {
        if (this._query_string !== query_string) {
            this._query_string = query_string;
            this._query = parse_query(query_string);
            this.ctx.deps.changed(this);
            return true;
        } else {
            return false;
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

class Card_List_Window<List extends Card_List = Card_List> {
    private ctx: Context;
    readonly list: List;
    private _pos: number = 0;
    readonly size: number = 120;
    private _sort_order: Sort_Order = DEFAULT_SORT_ORDER;
    private _sort_asc: boolean = DEFAULT_SORT_ASC;
    private _all_card_indexes: readonly number[] = [];

    constructor(ctx: Context, list: List) {
        this.ctx = ctx;
        this.list = list;
    }

    get pos(): number {
        return this._pos;
    }

    set pos(pos: number) {
        this.set_pos(pos);
    }

    set_pos(pos: number): boolean {
        if (this._pos !== pos) {
            this._pos = pos;
            this.ctx.deps.changed(this);
            return true;
        } else {
            return false;
        }
    }

    get sort_order(): Sort_Order {
        return this._sort_order;
    }

    set sort_order(sort_order: Sort_Order) {
        this.set_sort_order(sort_order);
    }

    set_sort_order(sort_order: Sort_Order): boolean {
        if (this._sort_order !== sort_order) {
            this._sort_order = sort_order;
            this.ctx.deps.changed(this);
            return true;
        } else {
            return false;
        }
    }

    get sort_asc(): boolean {
        return this._sort_asc;
    }

    set sort_asc(sort_asc: boolean) {
        this.set_sort_asc(sort_asc);
    }

    set_sort_asc(sort_asc: boolean): boolean {
        if (this._sort_asc !== sort_asc) {
            this._sort_asc = sort_asc;
            this.ctx.deps.changed(this);
            return true;
        } else {
            return false;
        }
    }

    /** Contains all cards of list, sorted. */
    set all_card_indexes(indexes: readonly number[]) {
        if (this._all_card_indexes !== indexes) {
            this._all_card_indexes = indexes;
            this.ctx.deps.changed(this);
        }
    }

    get card_indexes(): readonly number[] {
        return this._all_card_indexes.slice(this.pos, this.pos + this.size);
    }
}

class Search_State {
    private ctx: Context;
    readonly window: Card_List_Window<Query_Card_List>;

    constructor(ctx: Context, window: Card_List_Window<Query_Card_List>) {
        this.ctx = ctx;
        this.window = window;
    }

    search(query_string: string) {
        this.window.list.query_string = query_string;
        load_card_list_window(this.ctx, this.window);
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
    const set_state_promise = set_state_from_params(ctx, ctx.view.search.window, params);

    // Initialize view right after setting state from parameters, but before awaiting the initial
    // data load.
    new Main_View(ctx);
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
        window.location.hostname === 'localhost'
        || /^\d+\.\d+\.\d+\.\d+(:\d+)?$/g.test(window.location.hostname);

    if (tests_param === true || (is_dev_host && tests_param === null)) {
        await run_test_suite(ctx.cards);
    }

    if (benchmarks_param === true) {
        await run_benchmarks(ctx.cards);
    }
}

function get_params(): URLSearchParams {
    return new URLSearchParams(window.location.search);
}

async function set_state_from_params(
    ctx: Context,
    window: Card_List_Window,
    params: URLSearchParams,
) {
    let changed = false;

    if (window.list instanceof Query_Card_List) {
        if (window.list.set_query_string(params.get('q') ?? DEFAULT_QUERY_STRING)) {
            changed = true;
        }

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

    let sort_order = DEFAULT_SORT_ORDER;
    const sort_order_param = params.get('o') as Sort_Order | null;

    if (sort_order_param !== null) {
        if (SORT_ORDERS.includes(sort_order_param)) {
            sort_order = sort_order_param;
        } else {
            ctx.logger.error(`Invalid sort order in URL: ${sort_order_param}`);
        }
    }

    if (window.set_sort_order(sort_order)) {
        changed = true;
    }

    let sort_asc = DEFAULT_SORT_ASC;
    const sort_asc_param = params.get('d');

    if (sort_asc_param !== null) {
        if (sort_asc_param === 'a' || sort_asc_param === 'd') {
            sort_asc = sort_asc_param === 'a';
        } else {
            ctx.logger.error(`Invalid sort direction in URL: ${sort_asc_param}`);
        }
    }

    if (window.set_sort_asc(sort_asc)) {
        changed = true;
    }

    let pos = DEFAULT_START_POS;
    const pos_param = params.get('s');

    if (pos_param !== null) {
        const pos_int = string_to_int(pos_param);

        if (pos_int !== null && pos_int >= 1) {
            pos = pos_int;
        } else {
            ctx.logger.error(`Invalid start position in URL: ${pos_param}`);
        }
    }

    if (window.set_pos(pos)) {
        changed = true;
    }

    if (changed || window.list.loading_state === 'initial') {
        await load_card_list_window(ctx, window);
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
    readonly el: HTMLElement = document.body;

    constructor(ctx: Context) {
        this.ctx = ctx;
        this.update();
    }

    update() {
        switch (this.ctx.view.active) {
            case 'search':
                if (this.ctx.view.search) {
                    if (this.search_view === null) {
                        this.search_view = new Search_View(this.ctx, this.ctx.view.search);
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
    private query_el: HTMLInputElement = get_el('.query');
    private pool_el: HTMLSelectElement = get_el('.pool');
    private sort_order_el: HTMLSelectElement = get_el('.sort_order');
    private sort_dir_asc_el: HTMLInputElement = get_el('.sort_dir input[value=asc]');
    private sort_dir_desc_el: HTMLInputElement = get_el('.sort_dir input[value=desc]');

    constructor(ctx: Context, state: Search_State) {
        this.state = state;
        ctx.deps.add(this, state.window, state.window.list);

        this.query_el.onkeydown = e => this.query_keydown(e);
        this.query_el.onkeyup = () => this.query_keyup();

        this.update();

        const card_list_view = new Card_List_View(ctx, state.window);
        document.body.append(card_list_view.el);
    }

    update() {
        const window = this.state.window;
        this.query_el.value = window.list.query_string;
        this.sort_order_el.value = window.sort_order;
        (window.sort_asc ? this.sort_dir_asc_el : this.sort_dir_desc_el).checked = true;
    }

    private query_keydown(e: KeyboardEvent) {
        switch (key_combo(e)) {
            case 'Enter':
                this.state.search(this.query_el.value);
                break;
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
}

class Card_List_View implements Dependent {
    private ctx: Context;
    private window: Card_List_Window;
    private cards_el: HTMLElement = create_el('div');
    readonly el: HTMLElement = create_el('div');

    constructor(ctx: Context, window: Card_List_Window) {
        this.ctx = ctx;
        this.window = window;
        ctx.deps.add(this, window);

        this.cards_el.className = 'cards';
        this.el.className = 'result';
        this.update();
        this.el.append(this.cards_el);
    }

    update() {
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
    window.addEventListener('DOMContentLoaded', init);
}

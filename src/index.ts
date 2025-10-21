import {
    assert,
    assert_eq,
    unreachable,
    deep_eq,
    string_to_int,
    type Logger,
    Nop_Logger,
    Console_Logger,
    Mem_Logger,
    pop_count_32,
} from './core.ts';
import { Bitset, Bitset_32, Array_Set } from './uint_set.ts';
import {
    type Query,
    PROPS,
    parse_query,
    combine_queries_with_conjunction,
    simplify_query,
} from './query.ts';
import {
    Data,
    type Sort_Order,
    SORT_ORDERS,
    remove_parenthesized_text,
} from './data.ts';
import {
    PROPS_REQUIRED_FOR_DISPLAY,
    find_cards_matching_query,
    Query_Evaluator,
} from './query_eval.ts';
import { type Result_Nav, Result_Set_View } from './result_set_view.ts';

const MAX_CARDS = 120;

const POOL_ALL = 'all';
const POOL_PREMODERN_PAUPER = 'pmp';
const POOL_PREMODERN_PAUPER_COMMANDER = 'pmpc';
const POOL_PREMODERN_PEASANT = 'pmpst';
const POOL_PREMODERN_PEASANT_COMMANDER = 'pmpstc';
const POOL_MODERN_PAUPER = 'mp';
const POOL_MODERN_PAUPER_COMMANDER = 'mpc';

const POOLS: { [K: string]: Query } = {};

/** Static data that gets loaded once and then never changes. */
let data: Data = undefined as any as Data;

/** User input. */
const DEFAULT_QUERY_STRING = '';
const DEFAULT_POOL = POOL_ALL;
const DEFAULT_SORT_ORDER = 'name';
const DEFAULT_SORT_ASC = true;
const DEFAULT_START_POS = 1;

type Inputs = {
    query_string: string,
    pool: string,
    sort_order: Sort_Order,
    sort_asc: boolean,
    start_pos: number,
}

type Partial_Inputs = { [K in keyof Inputs]?: Inputs[K] };

const inputs: Inputs = {
    query_string: DEFAULT_QUERY_STRING,
    pool: DEFAULT_POOL,
    sort_order: DEFAULT_SORT_ORDER,
    sort_asc: DEFAULT_SORT_ASC,
    start_pos: DEFAULT_START_POS,
};

/** Output. */
const result: number[] = [];
let result_nav: Result_Nav = { start_idx: 0, max_cards: MAX_CARDS };

/** All DOM elements that the user interacts with. */
const ui: {
    query_el: HTMLInputElement,
    show_extra_el: HTMLButtonElement,
    extra_el: HTMLButtonElement,
    pool_el: HTMLSelectElement,
    sort_order_el: HTMLSelectElement,
    sort_dir_asc_el: HTMLInputElement,
    sort_dir_desc_el: HTMLInputElement,
    result_summary_el: HTMLElement,
    result_prev_el: HTMLButtonElement,
    result_next_el: HTMLButtonElement,
    result_first_el: HTMLButtonElement,
    result_last_el: HTMLButtonElement,
    result_set_view: Result_Set_View,
} = {} as any;

async function init() {
    Console_Logger.time('init');

    POOLS[POOL_ALL] =
        parse_query('');
    POOLS[POOL_PREMODERN_PAUPER] =
        parse_query('date<2003-07-29 rarity:common');
    POOLS[POOL_PREMODERN_PAUPER_COMMANDER] =
        parse_query('date<2003-07-29 rarity:uncommon type:creature');
    POOLS[POOL_PREMODERN_PEASANT] =
        parse_query('date<2003-07-29 rarity<=uncommon -"Library of Alexandria" -"Strip Mine" -"Wasteland" -"Maze of Ith" -"Sol Ring"');
    POOLS[POOL_PREMODERN_PEASANT_COMMANDER] =
        parse_query('date<2003-07-29 rarity:rare type:creature');
    POOLS[POOL_MODERN_PAUPER] =
        parse_query('date>=2003-07-29 date<2014-07-18 rarity:common -"Rhystic Study"');
    POOLS[POOL_MODERN_PAUPER_COMMANDER] =
        parse_query('date>=2003-07-29 date<2014-07-18 rarity:uncommon type:creature');

    data = new Data;

    ui.query_el = get_el('.query');
    ui.show_extra_el = get_el('.filter_show_extra');
    ui.extra_el = get_el('.filter_extra');
    ui.pool_el = get_el('.pool');
    ui.sort_order_el = get_el('.sort_order');
    ui.sort_dir_asc_el = get_el('.sort_dir input[value=asc]');
    ui.sort_dir_desc_el = get_el('.sort_dir input[value=desc]');
    ui.result_summary_el = get_el('.result_summary');
    ui.result_prev_el = get_el('.result_prev');
    ui.result_next_el = get_el('.result_next');
    ui.result_first_el = get_el('.result_first');
    ui.result_last_el = get_el('.result_last');
    ui.result_set_view = new Result_Set_View(data, result, result_nav);
    document.body.append(ui.result_set_view.el);
    Object.freeze(ui);

    window.onpopstate = () => set_inputs_from_params(get_params(), false);

    document.onkeydown = e => {
        const el = document.activeElement;

        if (el === null || !['BUTTON', 'INPUT', 'SELECT'].includes(el.tagName)) {
            switch (key_combo(e)) {
                case 'f':
                case '/':
                    e.preventDefault();
                    ui.query_el.focus();
                    break;
                case 'ArrowDown': {
                    e.preventDefault();
                    move_card_focus('down');
                    break;
                }
                case 'ArrowUp': {
                    e.preventDefault();
                    move_card_focus('up');
                    break;
                }
                case 'ArrowLeft': {
                    e.preventDefault();
                    move_card_focus('left');
                    break;
                }
                case 'ArrowRight': {
                    e.preventDefault();
                    move_card_focus('right');
                    break;
                }
            }
        }
    };

    ui.query_el.onkeydown = e => {
        switch (key_combo(e)) {
            case 'Enter':
                set_inputs({ query_string: ui.query_el.value });
                break;
            case 'ArrowDown': {
                e.preventDefault();
                e.stopPropagation();
                move_card_focus('down');
                break;
            }
            case 'ArrowUp': {
                // Because we break the regular down arrow behavior, we also break the up arrow for
                // consistency.
                e.preventDefault();
                e.stopPropagation();
                break;
            }
        }
    };

    ui.query_el.onkeyup = async () => {
        const query_string = ui.query_el.value;

        if (query_string !== inputs.query_string) {
            const MAX_ATTEMPTS = 2;

            for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
                try {
                    const loads = [
                        ...parse_query(query_string).props,
                        // Ensure all display props are reloaded when data is out of date:
                        ...PROPS_REQUIRED_FOR_DISPLAY,
                    ].map(prop => data.load(prop));

                    await Promise.all(loads);
                } catch (e) {
                    if (attempt < MAX_ATTEMPTS) {
                        Console_Logger.error('Error while preloading properties, retrying.', e);
                        continue;
                    } else {
                        throw e;
                    }
                }
            }
        }
    };

    ui.show_extra_el.onclick = () => {
        const SHOWN_CLASS = 'filter_extra_shown';
        const classes = ui.extra_el.classList;

        if (classes.contains(SHOWN_CLASS)) {
            classes.remove(SHOWN_CLASS);
        } else {
            classes.add(SHOWN_CLASS);
        }
    };

    ui.pool_el.onchange = () => set_inputs({ pool: ui.pool_el.value });
    ui.sort_order_el.onchange = () => {
        if (!SORT_ORDERS.includes(ui.sort_order_el.value as Sort_Order)) {
            unreachable(`Invalid sort order "${ui.sort_order_el.value}" in select field.`);
        }

        set_inputs({ sort_order: ui.sort_order_el.value as Sort_Order });
    }
    ui.sort_dir_asc_el.onchange = () => set_inputs({ sort_asc: ui.sort_dir_asc_el.checked });
    ui.sort_dir_desc_el.onchange = () => set_inputs({ sort_asc: !ui.sort_dir_desc_el.checked });
    ui.result_prev_el.onclick = () => set_inputs({ start_pos: inputs.start_pos - MAX_CARDS });
    ui.result_next_el.onclick = () => set_inputs({ start_pos: inputs.start_pos + MAX_CARDS });
    ui.result_first_el.onclick = () => set_inputs({ start_pos: 1 });
    ui.result_last_el.onclick = () => {
        const start_pos = Math.floor(result.length / MAX_CARDS) * MAX_CARDS + 1;
        set_inputs({ start_pos });
    }

    const params = get_params();
    await set_inputs_from_params(params, true);

    Console_Logger.time_end('init');

    // Run tests and benchmarks if requested.
    const tests_param_str = params.get('tests');
    const tests_param = tests_param_str === null
        ? null
        : tests_param_str.toLocaleLowerCase('en') === 'true';
    const benchmarks_param_str = params.get('benchmarks');
    const benchmarks_param = benchmarks_param_str === null
        ? null
        : benchmarks_param_str.toLocaleLowerCase('en') === 'true';

    // Run tests when hostname is localhost or an IPv4 address or explicit parameter is passed.
    const is_dev_host = window.location.hostname === 'localhost'
        || /^\d+\.\d+\.\d+\.\d+(:\d+)?$/g.test(window.location.hostname);

    if (tests_param === true || (is_dev_host && tests_param === null)) {
        await run_test_suite();
    }

    if (benchmarks_param === true) {
        await run_benchmarks();
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

function move_card_focus(dir: 'up' | 'down' | 'left' | 'right') {
    const children = ui.result_set_view.cards_el.children;
    const len = children.length;
    const card_el = document.activeElement as HTMLElement | null;
    const old_idx = Array.prototype.indexOf.call(children, card_el?.parentElement);
    let new_card_el: HTMLElement;

    if (card_el === null || old_idx === -1) {
        switch (dir) {
            case 'up': {
                new_card_el = children[children.length - 1].children[0] as HTMLElement;
                break;
            }
            case 'down': {
                new_card_el = children[0].children[0] as HTMLElement;
                break;
            }
            case 'left':
            case 'right': {
                return;
            }
            default:
                unreachable(`Unknown direction "${dir}".`);
        }
    } else {
        outer: switch (dir) {
            case 'up': {
                for (let i = old_idx - 1; i >= 0; i--) {
                    const prev_card_el = children[i].children[0] as HTMLElement;

                    if (prev_card_el.offsetTop + prev_card_el.offsetHeight < card_el.offsetTop
                        && prev_card_el.offsetLeft < card_el.offsetLeft + card_el.offsetWidth
                    ) {
                        new_card_el = prev_card_el;
                        break outer;
                    }
                }

                ui.query_el.focus();
                return;
            }
            case 'down': {
                for (let i = old_idx + 1; i < len; i++) {
                    const next_card_el = children[i].children[0] as HTMLElement;

                    if (next_card_el.offsetTop > card_el.offsetTop + card_el.offsetHeight
                        && next_card_el.offsetLeft + next_card_el.offsetWidth > card_el.offsetLeft
                    ) {
                        new_card_el = next_card_el;
                        break outer;
                    }
                }

                // Go to the end of the last row if we're at the next to last row even if that would
                // mean we would move to the left. This way you'll see all the cards by pressing
                // down continuously.
                if (old_idx + 1 < len) {
                    new_card_el = children[len - 1].children[0] as HTMLElement;
                    break outer;

                }

                return;
            }
            case 'left': {
                if (old_idx > 0) {
                    new_card_el = children[old_idx - 1].children[0] as HTMLElement;
                    break outer;
                }

                return;
            }
            case 'right': {
                if (old_idx + 1 < len) {
                    new_card_el = children[old_idx + 1].children[0] as HTMLElement;
                    break outer;
                }

                return;
            }
            default:
                unreachable(`Unknown direction "${dir}".`);
        }
    }

    new_card_el.scrollIntoView({ block: 'nearest' });
    new_card_el.focus();
}

async function set_inputs(new_inputs: Partial_Inputs) {
    const params = get_params();
    await set_inputs_internal(new_inputs, params, true, false);
}

async function set_inputs_from_params(params: URLSearchParams, force_filter: boolean) {
    const new_inputs: Inputs = {
        query_string: params.get('q') ?? DEFAULT_QUERY_STRING,
        pool: DEFAULT_POOL,
        sort_order: DEFAULT_SORT_ORDER,
        sort_asc: DEFAULT_SORT_ASC,
        start_pos: DEFAULT_START_POS,
    };

    const pool = params.get('p');

    if (pool !== null) {
        if (pool in POOLS) {
            new_inputs.pool = pool;
        } else {
            Console_Logger.error(`Invalid pool in URL: ${pool}`);
        }
    }

    const sort_order = params.get('o') as Sort_Order;

    if (sort_order !== null) {
        if (SORT_ORDERS.includes(sort_order)) {
            new_inputs.sort_order = sort_order;
        } else {
            Console_Logger.error(`Invalid sort order in URL: ${sort_order}`);
        }
    }

    const sort_dir = params.get('d');

    if (sort_dir !== null) {
        if (sort_dir === 'a' || sort_dir === 'd') {
            new_inputs.sort_asc = sort_dir === 'a';
        } else {
            Console_Logger.error(`Invalid sort direction in URL: ${sort_dir}`);
        }
    }

    const start_pos_string = params.get('s');

    if (start_pos_string !== null) {
        const start_pos = string_to_int(start_pos_string);

        if (start_pos !== null && start_pos >= 1) {
            new_inputs.start_pos = start_pos;
        } else {
            Console_Logger.error(`Invalid start position in URL: ${start_pos_string}`);
        }
    }

    await set_inputs_internal(new_inputs, null, false, force_filter);
}

async function set_inputs_internal(
    new_inputs: Partial_Inputs,
    params: URLSearchParams | null,
    update_url: boolean,
    force_filter: boolean,
) {
    let any_changed = false;
    let start_pos: number | null = null;

    for (const new_input_key in new_inputs) {
        const k = new_input_key as keyof Inputs;
        const v = new_inputs[k];

        if (inputs[k] === v) {
            continue;
        }

        let default_value;
        let param;
        let param_value: string;

        switch (k) {
            case 'query_string': {
                param = 'q';
                default_value = DEFAULT_QUERY_STRING;
                param_value = String(v);
                ui.query_el.value = param_value;
                break;
            }
            case 'pool': {
                param = 'p';
                default_value = DEFAULT_POOL;
                param_value = String(v);
                ui.pool_el.value = param_value;
                break;
            }
            case 'sort_order': {
                param = 'o';
                default_value = DEFAULT_SORT_ORDER;
                param_value = String(v);
                ui.sort_order_el.value = param_value;
                break;
            }
            case 'sort_asc': {
                param = 'd';
                default_value = DEFAULT_SORT_ASC;
                param_value = v ? 'a' : 'd';
                (v ? ui.sort_dir_asc_el : ui.sort_dir_desc_el).checked = true;
                break;
            }
            case 'start_pos': {
                param = 's';
                default_value = DEFAULT_START_POS;
                param_value = String(v);
                break;
            }
            default:
                unreachable(`Invalid input property ${k}.`);
        }

        (inputs[k] as any) = v;

        if (update_url) {
            assert(params !== null);

            if (v === default_value) {
                params.delete(param);
            } else {
                params.set(param, param_value);
            }
        }

        any_changed = true;

        // If a start pos is given, set the start position. Otherwise, if any other input is
        // changed, reset the start position.
        if (k === 'start_pos') {
            start_pos = v as number;
        } else if (start_pos === null) {
            start_pos = DEFAULT_START_POS;
        }
    }

    if (any_changed) {
        if (start_pos !== null) {
            inputs.start_pos = start_pos;

            if (update_url) {
                assert(params !== null);

                if (start_pos === DEFAULT_START_POS) {
                    params.delete('s');
                } else {
                    params.set('s', String(start_pos));
                }
            }
        }

        if (update_url) {
            assert(params !== null);

            const new_search = params.size ? `?${params}` : '';

            if (window.location.search !== new_search) {
                window.history.pushState(null, '', `/${new_search}`);
            }
        }
    }

    if (any_changed || force_filter) {
        await filter(Console_Logger);
    }
}

function get_params(): URLSearchParams {
    return new URLSearchParams(window.location.search);
}

async function filter(logger: Logger) {
    logger.group('Filtering cards.');
    logger.time('filter');

    // Try to avoid showing "Loading..." when the user opens the app, as it makes you think you
    // can't filter cards yet.
    if (data.length === null
        && inputs.query_string !== ''
        && ui.result_summary_el.innerHTML === ''
    ) {
        ui.result_summary_el.innerHTML = 'Loading...';
    }

    logger.time('filter_parse_query');

    const user_query: Query = parse_query(inputs.query_string);

    logger.time_end('filter_parse_query');
    logger.time('filter_combine_query');

    const combined_query: Query = combine_queries_with_conjunction(user_query, POOLS[inputs.pool]);

    logger.time_end('filter_combine_query');
    logger.time('filter_simplify_query');

    const query: Query = simplify_query(combined_query);

    logger.time_end('filter_simplify_query');
    logger.log('query string', inputs.query_string);
    logger.log('user query', user_query);
    logger.log('combined query', combined_query);

    const MAX_ATTEMPTS = 2;

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
        try {
            const res = await find_cards_matching_query(
                data,
                query,
                inputs.sort_order,
                inputs.sort_asc,
                logger,
                () => Nop_Logger,
            );
            result.splice(0, result.length, ...res);
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

    logger.time('filter_render');

    let start_pos = inputs.start_pos;
    let start_idx = start_pos - 1;

    if (start_idx >= result.length && result.length > 0) {
        start_idx = Math.floor((result.length - 1) / MAX_CARDS) * MAX_CARDS;
        start_pos = start_idx + 1;
        inputs.start_pos = start_pos;
    }

    result_nav.start_idx = start_idx;
    const view_result = result.slice(start_idx, start_idx + MAX_CARDS);
    const end_pos = start_idx + view_result.length;

    // TODO: Don't overwrite "Loading..." if another query has been fired off that requires a load.
    ui.result_summary_el.innerHTML = result.length === 0
        ? 'No matches.'
        : `Showing ${start_pos}-${end_pos} of ${result.length} matches.`;

    const at_first_page = data.length === null || start_pos === 1;
    const at_last_page = start_pos >= result.length - MAX_CARDS + 1
    ui.result_prev_el.disabled = at_first_page;
    ui.result_next_el.disabled = at_last_page;
    ui.result_first_el.disabled = at_first_page;
    ui.result_last_el.disabled = at_last_page;

    ui.result_set_view.update();

    logger.time_end('filter_render');
    logger.time_end('filter');
    logger.group_end();
}

function get_el<E extends Element>(query: string): E {
    const element = document.querySelector(query);

    if (element === null) {
        throw Error(`No element found for query "${query}".`);
    }

    return element as E;
}

function to_string(object: any) {
    return JSON.stringify(object, (_k, v) => {
        if (v instanceof Set) {
            return [...v];
        } else {
            return v;
        }
    });
}

async function run_test_suite() {
    Console_Logger.time('run_test_suite');
    Console_Logger.time('run_test_suite_setup');

    const tests: { name: string, execute: (logger: Logger) => void | Promise<void> }[] = [];

    function test(name: string, execute: (logger: Logger) => void | Promise<void>) {
        tests.push({ name, execute });
    }

    function test_query(name: string, query_string: string, expected_matches: string[]) {
        const MAX_MATCHES = 20;
        const expected = new Set(expected_matches);
        assert(expected.size <= MAX_MATCHES);

        test(`${name} [${query_string}]`, async logger => {
            const query = simplify_query(parse_query(query_string));
            const result = await find_cards_matching_query(
                data,
                query,
                'name',
                true,
                Nop_Logger,
                () => Nop_Logger,
            );

            const actual = new Set(result.map(idx => data.name(idx)));

            if (expected.size !== result.length || !deep_eq(actual, expected)) {
                const missing_set = expected.difference(actual);
                const unexpected_set = actual.difference(expected);
                const log_set = new Set();

                for (const c of missing_set) {
                    log_set.add(c);

                    // Ensure we log at most 10 cards.
                    if (log_set.size >= 10) {
                        break;
                    }
                }

                for (const c of unexpected_set) {
                    log_set.add(c);

                    // Ensure we log at most 10 cards.
                    if (log_set.size >= 10) {
                        break;
                    }
                }

                await find_cards_matching_query(
                    data,
                    query,
                    'name',
                    true,
                    logger,
                    idx => (log_set.has(data.name(idx)) ? logger : Nop_Logger),
                );

                const max_warn = unexpected_set.size > 5 ? ' (showing max. 5)' : '';

                throw Error(
                    `Expected to get ${expected.size} matches, got ${result.length}. Also expected: ${to_string(missing_set)}, didn't expect: ${to_string([...unexpected_set].slice(0, 5))}${max_warn}.`
                );
            }
        });
    }

    test('pop_count_32', () => {
        assert_eq(pop_count_32(0), 0);
        assert_eq(pop_count_32(1), 1);
        assert_eq(pop_count_32(0xFFFFFFFF), 32);
        assert_eq(pop_count_32(0x80000000), 1);
        assert_eq(pop_count_32(0b10101010), 4);
        assert_eq(pop_count_32(0b111000), 3);
    });

    test('Bitset is instantiated correctly.', () => {
        Bitset.reset_mem();

        for (let i = 0; i < 32; i++) {
            Bitset.mem[i] = 0xFFFFFFFF;
        }

        const s = Bitset.with_cap(1000);
        assert_eq(s.m_off, 0);
        assert_eq(s.m_end, 32);
        assert_eq(s.cap, 1000);
        assert_eq(s.size, 0);

        for (let i = s.m_off; i < s.m_end; i++) {
            assert_eq(Bitset.mem[i], 0);
        }
    });

    test('Bitset fill.', () => {
        Bitset.reset_mem();
        const s = Bitset.with_cap(40);
        s.fill();

        assert_eq(s.size, 40);

        for (let i = 0; i < 40; i++) {
            assert(s.has(i));
        }

        // Only 8 bits of the last u32 should be set.
        assert_eq(Bitset.mem[s.m_end - 1], 0xFF);
    });

    test('Bitset delete.', () => {
        Bitset.reset_mem();
        const s = Bitset.with_cap(40);
        s.fill();

        s.delete(20);
        s.delete(39);

        assert_eq(s.size, 38);

        for (let i = 0; i < 20; i++) {
            assert(s.has(i));
        }

        assert(!s.has(20));

        for (let i = 21; i < 38; i++) {
            assert(s.has(i));
        }

        assert(!s.has(39));
    });

    test('Bitset invert.', () => {
        Bitset.reset_mem();
        const s = Bitset.with_cap(36);

        for (let i = 0; i < 36; i++) {
            if (i % 3 === 0) {
                s.insert(i);
            }
        }

        s.invert();

        assert_eq(s.size, 24);

        for (let i = 0; i < 36; i++) {
            if (i % 3 === 0) {
                assert(!s.has(i));
            } else {
                assert(s.has(i));
            }
        }

        // Only 3 bits of the last u32 should be set.
        assert_eq(Bitset.mem[s.m_end - 1], 0b1101);
    });

    test('Bitset union_in.', () => {
        Bitset.reset_mem();
        const a = Bitset.with_cap(35);
        const b = Bitset.with_cap(35);

        a.insert(0);
        a.insert(3);

        b.insert(1);
        b.insert(4);
        b.insert(7);
        b.insert(33);

        a.union(b);

        assert_eq(a.size, 6);

        assert(a.has(0));
        assert(a.has(1));
        assert(!a.has(2));
        assert(a.has(3));
        assert(a.has(4));
        assert(!a.has(5));
        assert(!a.has(6));
        assert(a.has(7));

        for (let i = 8; i < 33; i++) {
            assert(!a.has(i));
        }

        assert(a.has(33));
        assert(!a.has(34));
    });

    test('Bitset diff_in.', () => {
        Bitset.reset_mem();
        const a = Bitset.with_cap(40);
        const b = Bitset.with_cap(40);

        for (let i = 0; i < 40; i++) {
            if (i % 2 === 0) {
                a.insert(i);
            }

            if (i % 3 === 0) {
                b.insert(i);
            }
        }

        a.diff(b);

        for (let i = 0; i < 40; i++) {
            if (i % 2 === 0 && i % 3 !== 0) {
                assert(a.has(i));
            } else {
                assert(!a.has(i));
            }
        }
    });

    test('Bitset_32 is instantiated correctly.', () => {
        const s = Bitset_32.with_cap(20);
        assert_eq(s.values, 0);
        assert_eq(s.cap, 20);
        assert_eq(s.size, 0);
    });

    test('Bitset_32 fill.', () => {
        const s = Bitset_32.with_cap(20);
        s.fill();

        assert_eq(s.size, 20);

        for (let i = 0; i < 20; i++) {
            assert(s.has(i));
        }

        // Only 20 bits should be set.
        assert_eq(s.values, 0xFFFFF);
    });

    test('Bitset_32 delete.', () => {
        const s = Bitset_32.with_cap(20);
        s.fill();

        s.delete(10);
        s.delete(15);

        assert_eq(s.size, 18);

        for (let i = 0; i < 20; i++) {
            if (i === 10 || i === 15) {
                assert(!s.has(i));
            } else {
                assert(s.has(i));
            }
        }
    });

    test('Bitset_32 invert.', () => {
        const s = Bitset_32.with_cap(30);

        for (let i = 0; i < 30; i++) {
            if (i % 3 === 0) {
                s.insert(i);
            }
        }

        s.invert();

        assert_eq(s.size, 20);

        for (let i = 0; i < 30; i++) {
            if (i % 3 === 0) {
                assert(!s.has(i));
            } else {
                assert(s.has(i));
            }
        }

        assert_eq(s.values, 0b110110110110110110110110110110);
    });

    test('Bitset_32 union_in.', () => {
        const a = Bitset_32.with_cap(25);
        const b = Bitset_32.with_cap(25);

        a.insert(0);
        a.insert(1);
        a.insert(3);
        a.insert(7);

        b.insert(1);
        b.insert(4);
        b.insert(7);
        b.insert(21);

        a.union(b);

        assert_eq(a.size, 6);

        for (let i = 0; i < 25; i++) {
            if ([0, 1, 3, 4, 7, 21].includes(i)) {
                assert(a.has(i));
            } else {
                assert(!a.has(i));
            }
        }
    });

    test('Bitset_32 diff_in.', () => {
        const a = Bitset_32.with_cap(32);
        const b = Bitset_32.with_cap(32);

        for (let i = 0; i < 32; i++) {
            if (i % 2 === 0) {
                a.insert(i);
            }

            if (i % 3 === 0) {
                b.insert(i);
            }
        }

        a.diff(b);

        for (let i = 0; i < 32; i++) {
            if (i % 2 === 0 && i % 3 !== 0) {
                assert(a.has(i));
            } else {
                assert(!a.has(i));
            }
        }
    });

    test('Array_Set is instantiated correctly.', () => {
        Array_Set.reset_mem();

        const s = new Array_Set;
        assert_eq(s.offset, 0);
        assert_eq(s.size, 0);
    });

    test('Array_Set delete.', () => {
        Array_Set.reset_mem();
        const s = new Array_Set;

        for (let i = 0; i < 40; i++) {
            s.insert_unchecked(i);
        }

        s.delete(20);
        s.delete(39);

        assert_eq(s.size, 38);

        for (let i = 0; i < 20; i++) {
            assert(s.has(i));
        }

        assert(!s.has(20));

        for (let i = 21; i < 38; i++) {
            assert(s.has(i));
        }

        assert(!s.has(39));
    });

    test('Array_Set union_in.', () => {
        Array_Set.reset_mem();
        const a = new Array_Set;
        const b = new Array_Set;

        a.insert_unchecked(1);
        a.insert_unchecked(3);
        a.insert_unchecked(8);
        a.insert_unchecked(9);
        a.insert_unchecked(10);

        b.insert_unchecked(0);
        b.insert_unchecked(4);
        b.insert_unchecked(7);
        b.insert_unchecked(25);

        a.union(b);

        assert_eq(a.size, 9);

        for (let i = 0; i <= 25; i++) {
            if ([0, 1, 3, 4, 7, 8, 9, 10, 25].includes(i)) {
                assert(a.has(i));
            } else {
                assert(!a.has(i));
            }
        }
    });

    test('Array_Set diff_in.', () => {
        Array_Set.reset_mem();
        const a = new Array_Set;
        const b = new Array_Set;

        for (let i = 0; i < 40; i++) {
            if (i % 2 === 0) {
                a.insert(i);
            }

            if (i % 3 === 0) {
                b.insert(i);
            }
        }

        a.diff(b);

        for (let i = 0; i < 40; i++) {
            if (i % 2 === 0 && i % 3 !== 0) {
                assert(a.has(i));
            } else {
                assert(!a.has(i));
            }
        }
    });

    test('remove_parenthesized_text doesn\'t change text without parens.', () => {
        const fo = 'This is text.';
        const o = remove_parenthesized_text(fo);

        assert_eq(o, 'This is text.')
    });

    test('remove_parenthesized_text removes spaces around.', () => {
        const fo = 'This is (reminder) text.';
        const o = remove_parenthesized_text(fo);

        assert_eq(o, 'This is text.')
    });

    test('remove_parenthesized_text removes spaces around, but not punctuation.', () => {
        const fo = 'This is (reminder), text.';
        const o = remove_parenthesized_text(fo);

        assert_eq(o, 'This is, text.')
    });

    test('remove_parenthesized_text removes all reminder text.', () => {
        const fo = 'This is (reminder) text, this (here), too.';
        const o = remove_parenthesized_text(fo);

        assert_eq(o, 'This is text, this, too.')
    });

    test('remove_parenthesized_text ignores extraneous right parens.', () => {
        const fo = 'This is (reminder)) text, this (here), too.';
        const o = remove_parenthesized_text(fo);

        assert_eq(o, 'This is text, this, too.')
    });

    test('remove_parenthesized_text doesn\'t ignore extraneous left parens.', () => {
        const fo = 'This is ((reminder) text, this (here), too.';
        const o = remove_parenthesized_text(fo);

        assert_eq(o, 'This is')
    });

    test_query(
        'name, ignore punctuation',
        't.a/\\,m\'":i;yoc',
        ['Tamiyo, Collector of Tales', 'Tamiyo, Compleated Sage'],
    );

    test_query(
        'name, match split cards',
        "'FIRE //'",
        ['Fire // Ice'],
    );

    test_query(
        'name, match split cards inexact',
        "fire//ice",
        ['Fire // Ice', 'Ghostfire Slice', 'Sword of Fire and Ice'],
    );

    test_query(
        'name, match split cards with backslash',
        "fire\\ice",
        ['Fire // Ice', 'Ghostfire Slice', 'Sword of Fire and Ice'],
    );

    test_query(
        "name, match double-faced cards",
        '"pathway // bould"',
        ['Branchloft Pathway // Boulderloft Pathway'],
    );

    test_query(
        'cmc=',
        'cmc=0 t:sorcery vision',
        ['Ancestral Vision'],
    );

    // Same as =
    test_query(
        'cmc:',
        'cmc:16',
        ['Draco'],
    );

    test_query(
        'cmc>',
        'cmc>20',
        ['Gleemax'],
    );

    test_query(
        'cmc<=',
        'cmc<=0 cinder',
        ['Cinder Barrens', 'Cinder Glade', 'Cinder Marsh'],
    );

    test_query(
        'mana=',
        'm=rgwu',
        ['Aragorn, the Uniter', 'Avatar Aang // Aang, Master of Elements', 'Elusen, the Giving', 'Ink-Treader Nephilim', 'Kynaios and Tiro of Meletis', 'Omnath, Locus of Creation'],
    );

    test_query(
        'mana!=',
        'mana!=2wr agrus',
        ['Agrus Kos, Eternal Soldier', 'Agrus Kos, Wojek Veteran'],
    );

    test_query(
        'mana>',
        'm>rgw cmc<=4 t:elf',
        ['Fleetfoot Dancer', 'Obuun, Mul Daya Ancestor', 'Rocco, Cabaretti Caterer', 'Shalai and Hallar'],
    );

    test_query(
        'mana<',
        'm<rgw class',
        ['Barbarian Class', 'Bard Class', 'Cleric Class', 'Fighter Class', 'Paladin Class'],
    );

    test_query(
        'mana>=',
        'mana>=rgw charm',
        ['Cabaretti Charm', 'Naya Charm', "Rith's Charm"],
    );

    // Same as >=
    test_query(
        'mana:',
        'mana:rgw charm',
        ['Cabaretti Charm', 'Naya Charm', "Rith's Charm"],
    );

    test_query(
        'mana<=',
        'mana<=rgw charm v',
        ['Fever Charm', 'Ivory Charm', 'Vitality Charm'],
    );

    test_query(
        'mana {C}',
        'm>{c}cc',
        ['Echoes of Eternity', 'Rise of the Eldrazi'],
    );

    test_query(
        'mana generic',
        'm>={7}{4}2 m<15',
        ['Emrakul, the Promised End'],
    );

    test_query(
        'mana generic X',
        'm>XXX',
        ['Crackle with Power', 'Doppelgang'],
    );

    test_query(
        'mana hybrid',
        'm={R/U}{R/U}{R/U}',
        ['Crag Puca'],
    );

    test_query(
        'mana monocolored hybrid',
        'm>={2/r}{2/w}{2/b}',
        ['Defibrillating Current', 'Reaper King', 'Reigning Victor'],
    );

    test_query(
        'mana colorless hybrid',
        'm>={C/B}',
        ['Ulalek, Fused Atrocity'],
    );

    test_query(
        'mana phyrexian',
        'm={u/p}',
        ['Gitaxian Probe', 'Mental Misstep'],
    );

    test_query(
        'mana phyrexian hybrid',
        'm:{w/G/P}',
        ['Ajani, Sleeper Agent'],
    );

    test_query(
        'mana<0',
        'm<0 ever',
        ['Blazemire Verge', 'Bleachbone Verge', 'Everglades', 'Evermind', 'Gloomlake Verge', 'Needleverge Pathway // Pillarverge Pathway', 'Riverpyre Verge', 'Thornspire Verge'],
    );

    // This is a weird one, zero-cost and no-cost are less than any nonzero cost.
    test_query(
        'mana<{R}',
        'm<{R} t:instant ve',
        ['Evermind', 'Intervention Pact'],
    );

    test_query(
        'rarity=',
        'rarity=c m>=ggg',
        ['Kindercatch', 'Nyxborn Colossus'],
    );

    // Same as =
    test_query(
        'rarity:',
        'r:c m>=ggg',
        ['Kindercatch', 'Nyxborn Colossus'],
    );

    test_query(
        'rarity<',
        'RARity<UNcommon m>=ggg',
        ['Kindercatch', 'Nyxborn Colossus'],
    );

    test_query(
        'rarity!=',
        'r!=Special m:gggg GIANT',
        ['Craw Giant'],
    );

    test_query(
        'oracle:',
        'o:rampage t:giant',
        ['Craw Giant', 'Frost Giant'],
    );

    // Same as :
    test_query(
        'oracle=',
        'oracle="it deals 6 damage to each creature"',
        ['Bloodfire Colossus', 'Tornado Elemental', 'Lord of Shatterskull Pass', 'Cathedral Membrane', 'Lavabrink Floodgates'],
    );

    // Reminder text shouldn't match.
    test_query(
        'oracle reminder text',
        'oracle:"to mill a card,"',
        [],
    );

    test_query(
        'fulloracle:',
        'fulloracle:"to mill a card," t:instant',
        ['Dig Up the Body', 'Wasteful Harvest'],
    );

    test_query(
        'format:',
        'f:premodern termina',
        ['Terminal Moraine', 'Terminate', 'Aphetto Exterminator'],
    );

    // Same as :
    test_query(
        'format=',
        'format=premodern suppress',
        ['Brutal Suppression', 'Suppress'],
    );

    test_query(
        'color=',
        'color=gr gut',
        ['Guttural Response', 'Raggadragga, Goreguts Boss'],
    );

    // Same as >=
    test_query(
        'color:',
        'c:gr scrapper',
        ['Scuzzback Scrapper'],
    );

    test_query(
        'color: with number',
        'color:4 year<2010',
        ['Dune-Brood Nephilim', 'Glint-Eye Nephilim', 'Ink-Treader Nephilim', 'Witch-Maw Nephilim', 'Yore-Tiller Nephilim'],
    );

    test_query(
        'color< with number',
        'c<2 abundant',
        ['Abundant Growth', 'Abundant Harvest', 'Abundant Maw'],
    );

    test_query(
        'identity=',
        'identity=gr glade',
        ['Cinder Glade'],
    );

    // Same as <=
    test_query(
        'identity:',
        'id:gr scrapper',
        ['Elvish Scrapper', 'Gruul Scrapper', 'Khenra Scrapper', 'Narstad Scrapper', 'Scrapper Champion', 'Scuzzback Scrapper', 'Slagdrill Scrapper', 'Tuktuk Scrapper'],
    );

    test_query(
        'identity: with number',
        'id:4 year<2010',
        ['Dune-Brood Nephilim', 'Glint-Eye Nephilim', 'Ink-Treader Nephilim', 'Witch-Maw Nephilim', 'Yore-Tiller Nephilim'],
    );

    test_query(
        'identity> with number',
        'id>4 year<2000',
        ['Jack-in-the-Mox', 'Naked Singularity', 'Reality Twist', 'Sliver Queen'],
    );

    test_query(
        'quotes "',
        '"boros guild"',
        ['Boros Guildgate', 'Boros Guildmage'],
    );

    test_query(
        "quotes '",
        "o:'one item'",
        ['Goblin Game', "Ladies' Knight"],
    );

    test_query(
        'ignore single quote',
        "o:tamiyo's cmc>4",
        ['Tamiyo, Compleated Sage'],
    );

    test_query(
        'set',
        's:war ajani',
        ["Ajani's Pridemate", 'Ajani, the Greathearted'],
    );

    test_query(
        'edition',
        'e:RAV drake',
        ['Drake Familiar', 'Snapping Drake', 'Tattered Drake'],
    );

    test_query(
        'negation',
        '-t:land forest',
        ['Deep Forest Hermit', 'Forest Bear', 'Jaheira, Friend of the Forest'],
    );

    // SF seems to interpret this as "name does not contain the empty string".
    test_query(
        'empty negation',
        '-',
        [],
    );

    // SF seems to interpret this as "name does not contain the empty string".
    test_query(
        'effectively empty negation',
        '-.',
        [],
    );

    // Negation means "true if no version of this card matches the nested condition".
    test_query(
        'negate condition on version-specific property',
        '-f:premodern carpet',
        ["Al-abara's Carpet"],
    );

    test_query(
        'year=',
        'year=2011 alloy',
        ['Alloy Myr'],
    );

    // Same as =
    test_query(
        'year:',
        'year:1999 about',
        ['About Face'],
    );

    test_query(
        'year<=',
        'year<=2011 alloy',
        ['Alloy Golem', 'Alloy Myr'],
    );

    test_query(
        'year, conflicting',
        'year>=2020 year<=2011 alloy',
        [],
    );

    test_query(
        'date:',
        'date:1993-08-05 rec',
        ['Ancestral Recall', 'Resurrection'],
    );

    test_query(
        'date>= and date<=',
        'date>=2003-04 date<=2003-08 grave',
        ['Call to the Grave', 'Gravedigger', 'Grave Pact', 'Reaping the Graves'],
    );

    test_query(
        'reprint',
        'not:reprint set:m12 t:wizard',
        ['Alabaster Mage', 'Azure Mage', "Jace's Archivist", 'Lord of the Unreal', 'Merfolk Mesmerist', 'Onyx Mage'],
    );

    test_query(
        'disjunction',
        'animate t:instant or abundance t:enchantment',
        ['Abundance', 'Animate Land', 'Leyline of Abundance', 'Overabundance', 'Trace of Abundance'],
    );

    test_query(
        'disjunction',
        '( mind OR power ) drain',
        ['Drain Power', 'Mind Drain'],
    );

    test_query(
        'parens',
        'mana for (t:creature or t:artifact)',
        ['Manaforce Mace', 'Manaforge Cinder', 'Manaform Hellkite'],
    );

    test_query(
        'nested parens',
        'mana for ((t:creature t:dragon) or t:artifact)',
        ['Manaforce Mace', 'Manaform Hellkite'],
    );

    test_query(
        'empty parens',
        'draining or ()',
        ['Draining Whelk'],
    );

    test_query(
        'no space before opening paren',
        'mox(ruby)',
        [],
    );

    test_query(
        'too many opening parens',
        '((mox) sapphire',
        [],
    );

    test_query(
        'too many closing parens',
        '(mox) sapphire)',
        [],
    );

    // Load all data in advance, so timings are more meaningful.
    const loads = PROPS.map(p => data.load(p));

    for (const load of loads) {
        await load;
    }

    Console_Logger.time_end('run_test_suite_setup');
    Console_Logger.time('run_test_suite_execute');

    let executed = 0;
    let succeeded = 0;

    for (const test of tests) {
        const logger = new Mem_Logger;
        let e = null;

        try {
            const result = test.execute(logger);

            if (result instanceof Promise) {
                await result;
            }

            succeeded++;
        } catch (ex) {
            e = ex;
        }

        executed++;

        if (e) {
            logger.log_to(Console_Logger);
            Console_Logger.error('FAILURE', test.name, e);
        } else {
            Console_Logger.info('SUCCESS', test.name);
        }
    }

    const failed = executed - succeeded;

    Console_Logger.time_end('run_test_suite_execute');
    Console_Logger.time_end('run_test_suite');

    if (executed === succeeded) {
        Console_Logger.info(`Ran ${executed} tests, all succeeded.`);
    } else {
        Console_Logger.info(`Ran ${executed} tests, ${failed} failed.`);
        alert(`${failed} Tests failed!`);
    }
}

function time_to_string(time: number): string {
    const m = Math.floor(time / 60_000);
    const s = Math.floor(time / 1_000) - m * 60;
    const ms = time - s * 1000 - m * 60_000;
    const m_str = m.toString().padStart(2, '0');
    const s_str = s.toString().padStart(2, '0');
    const ms_str = ms.toString().padStart(3, '0');
    return `${m_str}:${s_str}.${ms_str}`;
}

async function run_benchmarks() {
    const benchmarks: { name: string, set_up: () => any, execute: (input: any) => number }[] = [];

    function benchmark<T>(name: string, set_up: () => T, execute: (input: T) => number) {
        benchmarks.push({ name, set_up, execute });
    }

    function query_evaluator_benchmark(
        name: string,
        bitset: boolean,
        small_set_optimization: boolean,
    ) {
        benchmark(
            name,
            () => new Query_Evaluator(
                data,
                simplify_query(
                    combine_queries_with_conjunction(
                        parse_query('year>=2000'),
                        POOLS[POOL_PREMODERN_PAUPER_COMMANDER],
                    )
                ),
                bitset,
                small_set_optimization,
            ),
            evaluator => {
                const len = data.length!;
                let result = 0;

                for (let card_idx = 0; card_idx < len; card_idx++) {
                    const version_idx = evaluator.evaluate(card_idx, Nop_Logger).first_or_null();
                    result = (result + (version_idx ?? 0)) & 0xFFFFFFFF;
                }

                return result;
            },
        );
    }

    query_evaluator_benchmark('Array_Set', false, false);
    query_evaluator_benchmark('Bitset', true, false);
    query_evaluator_benchmark('Array_Set small set optimization', false, true);
    query_evaluator_benchmark('Bitset small set optimization', true, true);

    Console_Logger.info('Running benchmarks.');

    // Load all data in advance.
    const loads = PROPS.map(p => data.load(p));

    for (const load of loads) {
        await load;
    }

    const WARM_UP_ITERATIONS = 100;
    const ITERATIONS = 1000;

    for (const benchmark of benchmarks) {
        Console_Logger.group(`Running benchmark "${benchmark.name}".`);

        const input = benchmark.set_up();

        // We use this total result value to avoid the JIT from completely optimizing code away.
        let total_result = 0;

        for (let i = 0; i < WARM_UP_ITERATIONS; i++) {
            const result = benchmark.execute(input);
            total_result = (total_result + result) & 0xFFFFFFFF;
        }

        const start = performance.now();
        let min_time = Number.MAX_SAFE_INTEGER;
        let max_time = -1;

        for (let i = 0; i < ITERATIONS; i++) {
            const iter_start = performance.now();

            const result = benchmark.execute(input);

            const iter_time = performance.now() - iter_start;
            total_result = (total_result + result) & 0xFFFFFFFF;

            if (iter_time < min_time) {
                min_time = iter_time;
            }

            if (iter_time > max_time) {
                max_time = iter_time;
            }
        }

        const time = performance.now() - start;
        const time_str = time_to_string(time);
        const avg_time = time / ITERATIONS;

        Console_Logger.log(
            `${ITERATIONS} Iterations took ${time_str}, min. ${min_time}ms, max. ${max_time}ms, avg. ${avg_time}ms.`,
        );
        Console_Logger.log(`Result (ignore this): ${total_result}`);
        Console_Logger.group_end();
    }

    Console_Logger.info('Finished running benchmarks.');
}

if (document.body) {
    init();
} else {
    window.addEventListener('DOMContentLoaded', init);
}

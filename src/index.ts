import {
    assert,
    unreachable,
    string_to_int,
    type Logger,
    Nop_Logger,
    Console_Logger,
    get_el,
} from './core';
import {
    type Query,
    parse_query,
    combine_queries_with_conjunction,
    simplify_query,
} from './query';
import { Cards, type Sort_Order, SORT_ORDERS } from './data';
import { PROPS_REQUIRED_FOR_DISPLAY, find_cards_matching_query_old } from './query_eval';
import { type Result_Nav, Result_Set_View } from './result_set_view';
import { run_test_suite } from './tests';
import { run_benchmarks } from './benchmarks';

const MAX_CARDS = 120;

const POOL_ALL = 'all';
const POOL_PREMODERN_PAUPER = 'pmp';
const POOL_PREMODERN_PAUPER_COMMANDER = 'pmpc';
const POOL_PREMODERN_PEASANT = 'pmpst';
const POOL_PREMODERN_PEASANT_COMMANDER = 'pmpstc';
const POOL_MODERN_PAUPER = 'mp';
const POOL_MODERN_PAUPER_COMMANDER = 'mpc';

const POOLS: { [K: string]: Query } = {};

let cards: Cards = undefined as any as Cards;

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

    cards = new Cards;

    ui.query_el = get_el(document, '.query');
    ui.show_extra_el = get_el(document, '.filter_show_extra');
    ui.extra_el = get_el(document, '.filter_extra');
    ui.pool_el = get_el(document, '.pool');
    ui.sort_order_el = get_el(document, '.sort_order');
    ui.sort_dir_asc_el = get_el(document, '.sort_dir input[value=asc]');
    ui.sort_dir_desc_el = get_el(document, '.sort_dir input[value=desc]');
    ui.result_summary_el = get_el(document, '.result_summary');
    ui.result_prev_el = get_el(document, '.result_prev');
    ui.result_next_el = get_el(document, '.result_next');
    ui.result_first_el = get_el(document, '.result_first');
    ui.result_last_el = get_el(document, '.result_last');
    ui.result_set_view = new Result_Set_View(cards, result, result_nav, get_el(document, '.result'));
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
                    ].map(prop => cards.load(prop));

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
        await run_test_suite(cards);
    }

    if (benchmarks_param === true) {
        await run_benchmarks(cards);
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
    if (cards.length === null
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
            const res = await find_cards_matching_query_old(
                cards,
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

    const at_first_page = cards.length === null || start_pos === 1;
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

if (document.body) {
    init();
} else {
    window.addEventListener('DOMContentLoaded', init);
}

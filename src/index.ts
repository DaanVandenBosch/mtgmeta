const MAX_CARDS = 120;

type Prop =
    'colors' |
    'formats' |
    'identity' |
    'img' |
    'cost' |
    'cmc' |
    'name' |
    'name_search' |
    'name_inexact' |
    'oracle' |
    'oracle_search' |
    'rarity' |
    'released_at' |
    'reprint' |
    'set' |
    'sfurl' |
    'type' |
    'type_search';

const PROPS: Prop[] = [
    'colors',
    'formats',
    'identity',
    'img',
    'cost',
    'cmc',
    'name',
    'name_search',
    'name_inexact',
    'oracle',
    'oracle_search',
    'rarity',
    'released_at',
    'reprint',
    'set',
    'sfurl',
    'type',
    'type_search',
];
const PER_VERSION_PROPS: Prop[] = ['rarity', 'released_at', 'reprint', 'set'];

const MANA_WHITE = 'W';
const MANA_BLUE = 'U';
const MANA_BLACK = 'B';
const MANA_RED = 'R';
const MANA_GREEN = 'G';
const MANA_COLORLESS = 'C';
const MANA_GENERIC = 'N'; // Specifc generic cost.
const MANA_GENERIC_X = 'X'; // Generic cost of "X".
const MANA_SNOW = 'S';
const MANA_PHYREXIAN = 'P';
const MANA_WUBRG = Object.freeze([MANA_WHITE, MANA_BLUE, MANA_BLACK, MANA_RED, MANA_GREEN]);

const RARITY_COMMON = 'common';
const RARITY_UNCOMMON = 'uncommon';
const RARITY_RARE = 'rare';
const RARITY_MYTHIC = 'mythic';
const RARITY_SPECIAL = 'special';
const RARITY_BONUS = 'bonus';

const RARITY_RANK = Object.freeze({
    [RARITY_COMMON]: 0,
    [RARITY_UNCOMMON]: 1,
    [RARITY_RARE]: 2,
    [RARITY_SPECIAL]: 3,
    [RARITY_MYTHIC]: 4,
    [RARITY_BONUS]: 5,
});

const POOL_ALL = 'all';
const POOL_PREMODERN_PAUPER = 'pmp';
const POOL_PREMODERN_PAUPER_COMMANDER = 'pmpc';
const POOL_PREMODERN_PEASANT = 'pmpst';
const POOL_PREMODERN_PEASANT_COMMANDER = 'pmpstc';

const POOLS: { [key: string]: Query } = {};

type Sort_Order = 'cmc' | 'name' | 'released_at';
const SORT_ORDERS: Sort_Order[] = ['cmc', 'name', 'released_at'];

const INEXACT_REGEX = /[.,:;/\\'" \t]+/g;

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
let result: { cards: number[], length: number } | null = null;

/** All DOM elements that the user interacts with. */
const ui = {
    query_el: undefined as any as HTMLInputElement,
    show_extra_el: undefined as any as HTMLButtonElement,
    extra_el: undefined as any as HTMLButtonElement,
    pool_el: undefined as any as HTMLSelectElement,
    sort_order_el: undefined as any as HTMLSelectElement,
    sort_dir_asc_el: undefined as any as HTMLInputElement,
    sort_dir_desc_el: undefined as any as HTMLInputElement,
    result_summary_el: undefined as any as HTMLElement,
    result_prev_el: undefined as any as HTMLButtonElement,
    result_next_el: undefined as any as HTMLButtonElement,
    result_first_el: undefined as any as HTMLButtonElement,
    result_last_el: undefined as any as HTMLButtonElement,
    result_cards_el: undefined as any as HTMLElement,
};

const TEXT_DECODER = new TextDecoder();

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
    ui.result_cards_el = get_el('.cards');
    Object.freeze(ui);

    window.onpopstate = () => set_inputs_from_params(get_params(), false);

    document.onkeydown = e => {
        if (e.key === 'f'
            && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey
            && document.activeElement !== ui.query_el
        ) {
            e.preventDefault();
            ui.query_el.focus();
        }
    };

    ui.query_el.onkeydown = e => {
        if (e.key === 'Enter') {
            set_inputs({ query_string: ui.query_el.value });
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
        const start_pos = result === null
            ? 1
            : (Math.floor(result.length / MAX_CARDS) * MAX_CARDS + 1);
        set_inputs({ start_pos: start_pos });
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

function assert(condition: boolean, message?: () => string): asserts condition {
    if (!condition) {
        throw Error(message ? message() : 'Assertion failed.');
    }
}

function assert_eq<T>(actual: T, expected: T) {
    assert(
        deep_eq(actual, expected),
        () => `Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}.`,
    );
}

function unreachable(message?: string): never {
    throw Error(message ?? `Should never reach this code.`);
}

class Out_Of_Date_Error extends Error {
    constructor() {
        super('Some properties are out of date.');
    }
}

interface Logger {
    should_log: boolean;

    log(...args: any[]): void;
    info(...args: any[]): void;
    error(...args: any[]): void;
    group(...args: any[]): void;
    group_end(): void;
    time(...args: any[]): void;
    time_end(...args: any[]): void;
}

const Nop_Logger: Logger = {
    should_log: false,

    log() { },
    info() { },
    error() { },
    group() { },
    group_end() { },
    time() { },
    time_end() { },
};

const Console_Logger: Logger = {
    should_log: true,

    log(...args: any[]) { console.log(...args); },
    info(...args: any[]) { console.info(...args); },
    error(...args: any[]) { console.error(...args); },
    group(...args: any[]) { console.group(...args); },
    group_end() { console.groupEnd(); },
    time(...args: any[]) { console.time(...args); },
    time_end(...args: any[]) { console.timeEnd(...args); },
};

class Mem_Logger implements Logger {
    private messages: { level: keyof Logger, args: any[] }[] = [];

    should_log = true;

    log(...args: any[]) { this.message('log', ...args); }
    info(...args: any[]) { this.message('info', ...args); }
    error(...args: any[]) { this.message('error', ...args); }
    group(...args: any[]) { this.message('group', ...args); }
    group_end() { this.message('group_end'); }
    time(...args: any[]) { this.message('time', ...args); }
    time_end(...args: any[]) { this.message('time_end', ...args); }

    private message(level: keyof Logger, ...args: any[]) {
        this.messages.push({ level, args });
    }

    log_to(logger: Logger) {
        for (const message of this.messages) {
            (logger[message.level] as (...args: any[]) => void)(...message.args);
        }
    }
}

function string_to_int(s: string): number | null {
    if (!/^-?\d+$/.test(s)) {
        return null;
    }

    return parseInt(s, 10);
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

    const MAX_TRIES = 2;

    for (let i = 1; i <= MAX_TRIES; i++) {
        try {
            result = await find_cards_matching_query(
                query,
                inputs.sort_order,
                inputs.sort_asc,
                logger,
                () => Nop_Logger,
            );
            break;
        } catch (e) {
            if (i < MAX_TRIES) {
                logger.error('Error while finding matching cards, retrying.', e);
                continue;
            } else {
                throw e;
            }
        }
    }

    assert(result !== null);

    logger.time('filter_render');

    const frag = document.createDocumentFragment();
    let start_pos = inputs.start_pos;
    let start_idx = start_pos - 1;

    if (start_idx >= result.length && result.length > 0) {
        start_idx = Math.floor((result.length - 1) / MAX_CARDS) * MAX_CARDS;
        start_pos = start_idx + 1;
        inputs.start_pos = start_pos;
    }

    const view_result = result.cards.slice(start_idx, start_idx + MAX_CARDS);
    const end_pos = start_idx + view_result.length;

    for (const card_idx of view_result) {
        const a: HTMLAnchorElement = el('a');
        a.className = 'card';
        a.href = data.scryfall_url(card_idx) ?? '';
        a.target = '_blank';

        const img: HTMLImageElement = el('img');
        img.loading = 'lazy';
        img.src = data.image_url(card_idx) ?? '';
        a.append(img);

        frag.append(a);
    }

    // TODO: Don't overwrite "Loading..." if another query has been fired off that requires a load.
    ui.result_summary_el.innerHTML = result.length === 0
        ? 'No matches.'
        : `Showing ${start_pos}-${end_pos} of ${result.length} matches.`;

    ui.result_cards_el.innerHTML = '';
    ui.result_cards_el.scroll(0, 0);
    ui.result_cards_el.append(frag);

    const at_first_page = data.length === null || start_pos === 1;
    const at_last_page = start_pos >= result.length - MAX_CARDS + 1
    ui.result_prev_el.disabled = at_first_page;
    ui.result_next_el.disabled = at_last_page;
    ui.result_first_el.disabled = at_first_page;
    ui.result_last_el.disabled = at_last_page;

    logger.time_end('filter_render');
    logger.time_end('filter');
    logger.group_end();
}

/** Counts the number of bits set in a 32-bit integer. */
function pop_count_32(n: number): number {
    n = n - ((n >>> 1) & 0x55555555);
    n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
    return ((n + (n >>> 4) & 0xF0F0F0F) * 0x1010101) >>> 24;
}

const memory = new ArrayBuffer(256 * 1024);

/** Set optimized for unsigned integers. */
interface Uint_Set {
    size: number;

    uninitialized_copy(): Uint_Set;
    copy(): Uint_Set;
    copy_into(other: this): void;
    has(value: number): boolean;
    first_or_null(): number | null;
    insert(value: number): void;
    delete(value: number): void;
    clear(): void;
    union(other: this): void;
    diff(other: this): void;
    to_array(): number[];
}

class Bitset implements Uint_Set {
    static readonly mem = new Uint32Array(memory);
    static mem_offset = 0;

    static reset_mem() {
        this.mem_offset = 0;
    }

    static with_cap(cap: number): Bitset {
        const len = (cap + 31) >>> 5;
        const new_set = new Bitset(cap, len);
        new_set.clear();
        return new_set;
    }

    /** Offset into memory. */
    m_off: number;
    /** Memory end. */
    m_end: number;
    cap: number;
    size: number;

    constructor(cap: number, len: number) {
        if (Bitset.mem_offset + len > Bitset.mem.byteLength) {
            throw Error(`Out of bitset memory.`);
        }

        this.m_off = Bitset.mem_offset;
        Bitset.mem_offset += len;
        this.m_end = Bitset.mem_offset;
        this.cap = cap;
        this.size = 0;
    }

    uninitialized_copy(): Bitset {
        return new Bitset(this.cap, this.m_end - this.m_off);
    }

    copy(): Bitset {
        const new_set = this.uninitialized_copy();
        this.copy_into(new_set);
        return new_set;
    }

    copy_into(other: Bitset) {
        if (this.cap !== other.cap) {
            throw Error(`Capacities ${this.cap} and ${other.cap} don't match.`);
        }

        Bitset.mem.copyWithin(other.m_off, this.m_off, this.m_end);
        other.size = this.size;
    }

    has(value: number): boolean {
        const slot_offset = value >>> 5;
        const slot = Bitset.mem[this.m_off + slot_offset];
        const bit_mask = 1 << (value & 0b11111);
        return (slot & bit_mask) !== 0;
    }

    first_or_null(): number | null {
        if (this.size === 0) {
            return null;
        }

        const m_end = this.m_end;

        for (let i = this.m_off; i < m_end; i++) {
            const slot = Bitset.mem[i];

            for (let j = 0; j < 32; j++) {
                const bit_mask = 1 << j;

                if ((slot & bit_mask) !== 0) {
                    return i * 32 + j;
                }
            }
        }

        return null;
    }

    insert(value: number) {
        if (value < 0 || value >= this.cap) {
            throw Error(`Value ${value} out of bounds for capacity ${this.cap}.`);
        }

        const slot_offset = value >>> 5;
        const slot = Bitset.mem[this.m_off + slot_offset];
        const bit_mask = 1 << (value & 0b11111);
        const new_slot = slot | bit_mask;
        Bitset.mem[this.m_off + slot_offset] = new_slot;

        if (new_slot !== slot) {
            this.size += 1;
        }
    }

    fill() {
        const m_end = this.m_end;
        const cap = this.cap;
        Bitset.mem.fill(0xFFFFFFFF, this.m_off, m_end - 1);
        Bitset.mem[m_end - 1] = (1 << (cap & 0b11111)) - 1;
        this.size = cap;
    }

    delete(value: number) {
        if (value < 0 || value >= this.cap) {
            throw Error(`Value ${value} out of bounds for capacity ${this.cap}.`);
        }

        const slot_offset = value >>> 5;
        const slot = Bitset.mem[this.m_off + slot_offset];
        const bit_mask = 1 << (value & 0b11111);
        const new_slot = slot & ~bit_mask;
        Bitset.mem[this.m_off + slot_offset] = new_slot;

        if (new_slot !== slot) {
            this.size -= 1;
        }
    }

    clear() {
        Bitset.mem.fill(0, this.m_off, this.m_end);
        this.size = 0;
    }

    invert() {
        const m_end = this.m_end;
        const cap = this.cap;

        for (let i = this.m_off; i < m_end - 1; i++) {
            Bitset.mem[i] = ~Bitset.mem[i];
        }

        Bitset.mem[m_end - 1] = ~Bitset.mem[m_end - 1] & ((1 << (cap & 0b11111)) - 1);
        this.size = cap - this.size;
    }

    union(other: Bitset) {
        if (this.cap !== other.cap) {
            throw Error(`Capacities ${this.cap} and ${other.cap} don't match.`);
        }

        const m_off = this.m_off;
        const m_end = this.m_end;
        const other_m_off = other.m_off;
        const end = m_end - m_off;
        let size = 0;

        for (let i = 0; i < end; i++) {
            let slot = Bitset.mem[m_off + i];
            slot |= Bitset.mem[other_m_off + i];
            size += pop_count_32(slot);
            Bitset.mem[m_off + i] = slot;
        }

        this.size = size;
    }

    diff(other: Bitset) {
        if (this.cap !== other.cap) {
            throw Error(`Capacities ${this.cap} and ${other.cap} don't match.`);
        }

        const m_off = this.m_off;
        const m_end = this.m_end;
        const other_m_off = other.m_off;
        const end = m_end - m_off;
        let size = 0;

        for (let i = 0; i < end; i++) {
            let slot = Bitset.mem[m_off + i];
            slot &= ~Bitset.mem[other_m_off + i];
            size += pop_count_32(slot);
            Bitset.mem[m_off + i] = slot;
        }

        this.size = size;
    }

    to_array(): number[] {
        const m_end = this.m_end;
        const array = [];

        for (let i = this.m_off; i < m_end; i++) {
            const slot = Bitset.mem[i];

            for (let j = 0; j < 32; j++) {
                const bit_mask = 1 << j;

                if ((slot & bit_mask) !== 0) {
                    array.push(i * 32 + j);
                }
            }
        }

        return array;
    }
}

class Bitset_32 implements Uint_Set {
    static readonly MAX_CAP = 32;

    static with_cap(cap: number): Bitset_32 {
        if (cap > Bitset_32.MAX_CAP) {
            throw Error(`Size ${cap} greater than maximum capacity of ${Bitset_32.MAX_CAP}.`);
        }

        return new Bitset_32(0, cap, 0);
    }

    values: number;
    cap: number;
    size: number;

    constructor(values: number, cap: number, size: number) {
        this.values = values;
        this.cap = cap;
        this.size = size;
    }

    uninitialized_copy(): Bitset_32 {
        return new Bitset_32(0, this.cap, 0);
    }

    copy(): Bitset_32 {
        return new Bitset_32(this.values, this.cap, this.size);
    }

    copy_into(other: Bitset_32) {
        if (this.cap !== other.cap) {
            throw Error(`Capacities ${this.cap} and ${other.cap} don't match.`);
        }

        other.values = this.values;
        other.size = this.size;
    }

    has(value: number): boolean {
        return (this.values & (1 << value)) !== 0;
    }

    first_or_null(): number | null {
        if (this.size === 0) {
            return null;
        }

        const cap = this.cap;
        const values = this.values;

        for (let value = 0; value < cap; value++) {
            if ((values & (1 << value)) !== 0) {
                return value;
            }
        }

        return null;
    }

    insert(value: number) {
        if (value < 0 || value >= this.cap) {
            throw Error(`Value ${value} out of bounds for capacity ${this.cap}.`);
        }

        const values = this.values;
        const new_values = values | (1 << value);
        this.values = new_values;

        if (new_values !== values) {
            this.size += 1;
        }
    }

    fill() {
        const cap = this.cap;
        this.values = (1 << cap) - 1;
        this.size = cap;
    }

    delete(value: number) {
        if (value < 0 || value >= this.cap) {
            throw Error(`Value ${value} out of bounds for capacity ${this.cap}.`);
        }

        const values = this.values;
        const new_values = values & ~(1 << value);
        this.values = new_values;

        if (new_values !== values) {
            this.size -= 1;
        }
    }

    clear() {
        this.values = 0;
        this.size = 0;
    }

    invert() {
        const cap = this.cap;
        this.values = ~this.values & ((1 << cap) - 1);
        this.size = cap - this.size;
    }

    union(other: Bitset_32) {
        if (this.cap !== other.cap) {
            throw Error(`Capacities ${this.cap} and ${other.cap} don't match.`);
        }

        let values = this.values | other.values;
        this.values = values;
        this.size = pop_count_32(values);
    }

    diff(other: Bitset_32) {
        if (this.cap !== other.cap) {
            throw Error(`Capacities ${this.cap} and ${other.cap} don't match.`);
        }

        let values = this.values & ~other.values;
        this.values = values;
        this.size = pop_count_32(values);
    }

    to_array(): number[] {
        const values = this.values;
        const cap = this.cap;
        const array = [];

        for (let i = 0; i < cap; i++) {
            const bit_mask = 1 << i;

            if ((values & bit_mask) !== 0) {
                array.push(i);
            }
        }

        return array;
    }
}

class Array_Set implements Uint_Set {
    static readonly CAP = 1024;
    static readonly mem = new Uint16Array(memory);
    static mem_offset = 0;

    static reset_mem() {
        this.mem_offset = 0;
    }

    offset: number;
    size: number;

    constructor() {
        const mem_offset = Array_Set.mem_offset;

        if (mem_offset >= Array_Set.mem.byteLength) {
            throw Error(`Max sets reached.`);
        }

        this.offset = mem_offset;
        Array_Set.mem_offset = mem_offset + Array_Set.CAP;
        this.size = 0;
    }

    copy(): Array_Set {
        const new_set = new Array_Set();
        this.copy_into(new_set);
        return new_set;
    }

    uninitialized_copy(): Array_Set {
        return new Array_Set();
    }

    copy_into(other: Array_Set) {
        const offset = this.offset;
        const size = this.size;
        Array_Set.mem.copyWithin(other.offset, offset, offset + size);
        other.size = size;
    }

    has(value: number): boolean {
        const offset = this.offset;
        const end = offset + this.size;

        for (let i = offset; i < end; i++) {
            const v = Array_Set.mem[i];

            if (v === value) {
                return true;
            } else if (v > value) {
                return false;
            }
        }

        return false;
    }

    at(idx: number): number {
        return Array_Set.mem[this.offset + idx];
    }

    first_or_null(): number | null {
        if (this.size === 0) {
            return null;
        }

        return Array_Set.mem[this.offset];
    }

    insert(value: number) {
        const offset = this.offset;
        const size = this.size;
        const end = offset + size;

        if (size >= Array_Set.CAP) {
            throw Error(`Capacity reached.`);
        }

        for (let i = offset; i < end; i++) {
            const v = Array_Set.mem[i];

            if (v === value) {
                return;
            } else if (v > value) {
                Array_Set.mem.copyWithin(i + 1, i, end);
                Array_Set.mem[i] = value;
                this.size = size + 1;
                return;
            }
        }

        Array_Set.mem[end] = value;
        this.size = size + 1;
    }

    insert_unchecked(value: number) {
        const size = this.size;

        if (size >= Array_Set.CAP) {
            throw Error(`Capacity reached.`);
        }

        Array_Set.mem[this.offset + size] = value;
        this.size = size + 1;
    }

    fill_to(cap: number) {
        if (cap >= Array_Set.CAP) {
            throw Error(`Capacity reached.`);
        }

        const offset = this.offset;

        for (let value = 0; value < cap; value++) {
            Array_Set.mem[offset + value] = value;
        }

        this.size = cap;
    }

    delete(value: number) {
        const offset = this.offset;
        const size = this.size;
        const end = offset + size;

        for (let i = offset; i < end; i++) {
            const v = Array_Set.mem[i];

            if (v === value) {
                Array_Set.mem.copyWithin(i, i + 1, end);
                this.size = size - 1;
                return;
            } else if (v > value) {
                // Value not in the set.
                return;
            }
        }
    }

    delete_at(idx: number) {
        const offset = this.offset;
        const value_offset = offset + idx;
        const size = this.size;
        Array_Set.mem.copyWithin(value_offset, value_offset + 1, offset + size);
        this.size = size - 1;
    }

    clear() {
        this.size = 0;
    }

    union(other: Array_Set) {
        const offset = this.offset;
        const other_offset = other.offset;
        let size = this.size;
        const other_end = other_offset + other.size;
        let i = offset;

        outer: for (let j = other_offset; j < other_end; j++) {
            const other_value = Array_Set.mem[j];

            for (; ;) {
                if (i >= offset + size) {
                    Array_Set.mem.copyWithin(i, j, other_end);
                    size += other_end - j;
                    break outer;
                }

                const value = Array_Set.mem[i];

                if (other_value === value) {
                    i++;
                    break;
                } else if (other_value < value) {
                    Array_Set.mem.copyWithin(i + 1, i, offset + size);
                    Array_Set.mem[i] = other_value;
                    size += 1;
                    i++;
                    break;
                } else {
                    i++;
                }
            }
        }

        this.size = size;
    }

    diff(other: Array_Set) {
        const offset = this.offset;
        const other_offset = other.offset;
        let size = this.size;
        let i = offset + size - 1;

        outer: for (let j = other_offset + other.size - 1; j >= other_offset; j--) {
            const other_value = Array_Set.mem[j];

            for (; ;) {
                if (i < offset) {
                    break outer;
                }

                const value = Array_Set.mem[i];

                if (other_value === value) {
                    Array_Set.mem.copyWithin(i, i + 1, offset + size);
                    size -= 1;
                    break;
                } else if (other_value > value) {
                    break;
                } else {
                    i--;
                }
            }
        }

        this.size = size;
    }

    to_array(): number[] {
        const offset = this.offset;
        const end = offset + this.size;
        const array = [];

        for (let i = offset; i < end; i++) {
            array.push(Array_Set.mem[i]);
        }

        return array;
    }
}

enum Sort_Type {
    BY_CARD = 1,
    BY_VERSION = 2,
}

function is_by_version_order(order: Sort_Order): boolean {
    switch (order) {
        case 'cmc':
        case 'name':
            return false;

        case 'released_at':
            return true;
    }
}

interface Sorter {
    readonly order: Sort_Order;
    readonly type: Sort_Type;

    sort(cards: Map<number, number>, asc: boolean): number[];
}

/** Sorts by card order, which is name by default. */
class Default_Sorter implements Sorter {
    readonly order: Sort_Order;
    readonly type: Sort_Type = Sort_Type.BY_CARD;

    constructor(order: Sort_Order) {
        this.order = order;
    }

    sort(cards: Map<number, number>, asc: boolean): number[] {
        const len = data.length ?? 0;
        const result = [];

        for (let i = 0; i < len; i++) {
            const card_idx = asc ? i : (len - 1 - i);

            if (cards.has(card_idx)) {
                result.push(card_idx);
            }
        }

        return result;
    }
}

class Index_Sorter implements Sorter {
    static readonly GROUP_HEADER_OFFSET = 32;
    static readonly GROUP_TABLE_OFFSET = Index_Sorter.GROUP_HEADER_OFFSET + 4;

    private view: DataView
    readonly order: Sort_Order;
    readonly type: Sort_Type;
    readonly creation_time: Date;

    constructor(buf: ArrayBuffer) {
        this.view = new DataView(buf);

        const identifier = TEXT_DECODER.decode(buf.slice(0, 4));
        const version = this.u16(4);
        const type = this.u8(6);
        const creation_time = new Date(Number(this.u64(8)));

        let order_len = new Uint8Array(buf, 16, 16).indexOf(0);

        if (order_len === -1) {
            order_len = 16;
        }

        const order = TEXT_DECODER.decode(buf.slice(16, 16 + order_len)) as Sort_Order;

        assert_eq(identifier, 'MTGI');
        assert_eq(version, 3);
        assert(type === 1 || type === 2);

        this.order = order;
        this.type = type;
        this.creation_time = creation_time;
    }

    sort(cards: Map<number, number>, asc: boolean): number[] {
        const GROUP_TABLE_OFFSET = Index_Sorter.GROUP_TABLE_OFFSET;
        const type = this.type;
        const len = data.length ?? 0;
        const group_count = this.u32(Index_Sorter.GROUP_HEADER_OFFSET);
        const groups_offset = GROUP_TABLE_OFFSET + 4 * group_count;

        let invalid_idx_count = 0;
        const result = [];

        // Each index groups cards by some criterium. The sort direction determines the direction in
        // which we traverse the groups, but not the direction in which we traverse the cards within
        // each group. This ensures cards are always sorted by the given sort order and then by
        // name.
        for (let i = 0; i < group_count; i++) {
            const group_idx = asc ? i : (group_count - 1 - i);
            const group_start =
                group_idx === 0 ? 0 : this.u32(GROUP_TABLE_OFFSET + 4 * (group_idx - 1));
            const group_end = this.u32(GROUP_TABLE_OFFSET + 4 * group_idx);

            for (let j = group_start; j < group_end; j++) {
                const offset = groups_offset + 2 * type * j;
                const card_idx = this.u16(offset);

                if (card_idx >= len) {
                    invalid_idx_count++;
                    continue;
                }

                let version_idx = 0;

                if (type === Sort_Type.BY_VERSION) {
                    version_idx = this.u16(offset + 2);
                }

                if (cards.get(card_idx) === version_idx) {
                    result.push(card_idx);
                }
            }
        }

        if (invalid_idx_count > 0) {
            Console_Logger.error(
                `Sort index for order ${this.order} contains ${invalid_idx_count} card indexes.`
            );
        }

        return result;
    }

    private u8(offset: number): number {
        return this.view.getUint8(offset);
    }

    private u16(offset: number): number {
        return this.view.getUint16(offset, true);
    }

    private u32(offset: number): number {
        return this.view.getUint32(offset, true);
    }

    private u64(offset: number): bigint {
        return this.view.getBigUint64(offset, true);
    }
}

class Data {
    length: number | null = null;
    props: Map<Prop, any> = new Map;
    prop_promises: Map<Prop, Promise<void>> = new Map;
    sorters: Map<Sort_Order, Promise<Sorter>> = new Map;
    creation_time: Date | null = null;
    aborter = new AbortController;
    fetch_reload = false;

    data_is_out_of_date() {
        // We only try a second fetch with cache reload once.
        if (!this.fetch_reload) {
            // Abort all in-flight requests.
            this.aborter.abort();
            this.aborter = new AbortController;

            // Clear all data.
            this.length = null;
            this.props.clear();
            this.prop_promises.clear();
            this.sorters.clear();

            // Fetch with Cache-Control set to reload from now on.
            this.fetch_reload = true;

            // Throw an error to trigger a retry.
            throw new Out_Of_Date_Error;
        }
    }

    async load(prop: Prop) {
        switch (prop) {
            case 'name_search':
            case 'name_inexact':
                prop = 'name';
                break;

            case 'oracle_search':
                prop = 'oracle';
                break;

            case 'reprint':
                for (const pp_prop of PER_VERSION_PROPS) {
                    const promise = this.prop_promises.get(pp_prop);

                    if (promise !== undefined) {
                        return promise;
                    }
                }

                // Just load *a* per-version property, so we know the version count.
                prop = 'set';
                break;

            case 'type_search':
                prop = 'type';
                break;
        }

        let promise = this.prop_promises.get(prop);

        if (promise === undefined) {
            const init: FetchRequestInit = {
                signal: this.aborter.signal,
                cache: this.fetch_reload ? 'reload' : undefined,
            };

            promise = fetch(`data/card_${prop}.json`, init).then(async response => {
                const { creation_time, data } = await response.json();

                if (this.creation_time === null) {
                    this.creation_time = new Date(creation_time);
                } else if (this.creation_time.getTime() !== creation_time) {
                    this.data_is_out_of_date();
                }

                switch (prop) {
                    case 'colors':
                    case 'cost': {
                        for (const faces of data) {
                            for (let i = 0, len = faces.length; i < len; i++) {
                                const value_str = faces[i];

                                // Ignore non-existent values. Also ignore empty mana costs of
                                // the backside of transform cards.
                                if (value_str === null
                                    || (i >= 1 && prop === 'cost' && value_str === '')
                                ) {
                                    faces[i] = null;
                                } else {
                                    faces[i] = parse_mana_cost(value_str).cost;
                                }
                            }
                        }

                        break;
                    }

                    case 'identity': {
                        for (let i = 0, len = data.length; i < len; i++) {
                            data[i] = parse_mana_cost(data[i]).cost;
                        }

                        break;
                    }

                    case 'name': {
                        const search_data = [];
                        const inexact_data = [];

                        for (const values of data) {
                            search_data.push(
                                values
                                    .join(' // ')
                                    .toLocaleLowerCase('en')
                            );
                            inexact_data.push(
                                values
                                    .join('')
                                    .replace(INEXACT_REGEX, '')
                                    .toLocaleLowerCase('en')
                            );
                        }

                        this.props.set('name_search', search_data);
                        this.props.set('name_inexact', inexact_data);
                        break;
                    }

                    case 'oracle':
                    case 'type': {
                        const search_data = data.map((values: string[]) =>
                            values.map(v => v.toLocaleLowerCase('en')));
                        this.props.set((prop + '_search') as Prop, search_data);
                        break;
                    }

                    case 'released_at': {
                        for (const values of data) {
                            for (let i = 0, len = values.length; i < len; i++) {
                                values[i] = new Date(values[i] + 'T00:00:00Z');
                            }
                        }

                        break;
                    }
                }

                this.props.set(prop, data);
                this.length = data.length;
            });

            this.prop_promises.set(prop, promise);
        }

        return promise;
    }

    /** Returns the value or values of a card property. */
    get<T>(idx: number, prop: Prop): T | null {
        return this.props.get(prop)?.at(idx) ?? null;
    }

    /** Returns the value or values of a property for a specific version. */
    get_for_version<T>(idx: number, version_idx: number, prop: Prop): T | null {
        // Reprint is a logical property, every version except the first is a reprint.
        if (prop === 'reprint') {
            return (version_idx !== 0) as T;
        }

        const value = this.props.get(prop)?.at(idx);

        if (value == null) {
            return null;
        }

        if (PER_VERSION_PROPS.includes(prop)) {
            return value[version_idx] ?? null;
        } else {
            return value;
        }
    }

    version_count(idx: number): number | null {
        for (const pp_prop of PER_VERSION_PROPS) {
            const values = this.get<any[]>(idx, pp_prop);

            if (values !== null) {
                return values.length;
            }
        }

        return null;
    }

    name(idx: number): string | null {
        const names = this.get<string[]>(idx, 'name');

        if (names === null || names.length == 0) {
            return null;
        }

        return names.join(' // ');
    }

    scryfall_url(idx: number): string | null {
        const sfurl = this.get<string>(idx, 'sfurl');

        if (sfurl === null) {
            return null;
        }

        return `https://scryfall.com/${sfurl}`;
    }

    image_url(idx: number): string | null {
        const imgs = this.get<string[]>(idx, 'img');

        if (imgs === null || imgs.length === 0) {
            return null;
        }

        return `https://cards.scryfall.io/normal/${imgs[0]}`;
    }

    async get_sorter(order: Sort_Order): Promise<Sorter> {
        let promise = this.sorters.get(order);

        if (promise === undefined) {
            if (order === 'name') {
                promise = Promise.resolve(new Default_Sorter(order));
            } else {
                const init: FetchRequestInit = {
                    signal: this.aborter.signal,
                    cache: this.fetch_reload ? 'reload' : undefined,
                };

                promise = fetch(`data/card_${order}.sort`, init).then(async response => {
                    const sorter = new Index_Sorter(await response.arrayBuffer());
                    assert_eq(sorter.order, order);

                    if (this.creation_time === null) {
                        this.creation_time = sorter.creation_time;
                    } else if (this.creation_time.getTime() !== sorter.creation_time.getTime()) {
                        this.data_is_out_of_date();
                    }

                    return sorter;
                });
            }

            this.sorters.set(order, promise);
        }

        return promise;
    }
}

type Query = {
    readonly props: Prop[],
    readonly condition: Condition,
};

type Condition =
    Negation_Condition |
    Disjunction_Condition |
    Conjunction_Condition |
    True_Condition |
    False_Condition |
    Comparison_Condition |
    Substring_Condition |
    Predicate_Condition |
    Range_Condition;

type Negation_Condition = {
    readonly type: 'not',
    readonly condition: Condition,
}

type Disjunction_Condition = {
    readonly type: 'or',
    readonly conditions: Condition[],
}

type Conjunction_Condition = {
    readonly type: 'and',
    readonly conditions: Condition[],
}

type True_Condition = {
    readonly type: 'true',
}

type False_Condition = {
    readonly type: 'false',
}

type Comparison_Condition = {
    readonly type: 'eq' | 'ne' | 'lt' | 'gt' | 'le' | 'ge',
    readonly prop: Prop,
    readonly value: number | boolean | string | Date | Mana_Cost,
}

type Substring_Condition = {
    readonly type: 'substring',
    readonly prop: Prop,
    readonly value: string,
}

type Predicate_Condition = {
    readonly type: 'even' | 'odd',
    readonly prop: Prop,
}

type Range_Condition = {
    readonly type: 'range',
    readonly prop: Prop,
    readonly start: Date,
    readonly start_inc: boolean,
    readonly end: Date,
    readonly end_inc: boolean,
}

function parse_query(query_string: string): Query {
    return new Query_Parser().parse(query_string);
}

type Operator = ':' | '=' | '!=' | '<' | '>' | '<=' | '>=';

class Query_Parser {
    private query_string!: string;
    private pos!: number;
    private props!: Set<Prop>;

    parse(query_string: string): Query {
        this.query_string = query_string;
        this.pos = 0;
        this.props = new Set();

        let condition: Condition | false | null = this.parse_disjunction();

        if (condition === false || this.chars_left()) {
            condition = { type: 'false' };
        } else if (condition === null) {
            condition = { type: 'true' };
        }

        return {
            props: [...this.props],
            condition,
        };
    }

    private chars_left(): boolean {
        return this.pos < this.query_string.length;
    }

    private char(): string {
        return this.query_string[this.pos];
    }

    private is_boundary(): boolean {
        if (!this.chars_left()) {
            return true;
        }

        switch (this.char()) {
            case ' ':
            case '\t':
            case ')':
                return true;

            default:
                return false;
        }
    }

    private parse_disjunction(): Condition | false | null {
        const conditions: Condition[] = [];

        while (this.chars_left()) {
            if (this.char() === ')') {
                break;
            }

            if (this.is_boundary()) {
                this.pos++;
                continue;
            }

            const condition = this.parse_conjunction();

            if (condition === false) {
                return false;
            }

            if (condition === null) {
                continue;
            }

            conditions.push(condition);
        }

        if (conditions.length === 0) {
            return null;
        }

        if (conditions.length === 1) {
            return conditions[0];
        }

        return {
            type: 'or',
            conditions,
        };
    }

    private parse_conjunction(): Condition | false | null {
        const conditions: Condition[] = [];

        while (this.chars_left()) {
            if (this.char() === ')') {
                break;
            }

            if (this.is_boundary()) {
                this.pos++;
                continue;
            }

            if (
                this.query_string.slice(this.pos, this.pos + 2).toLocaleLowerCase('en') === 'or'
            ) {
                this.pos += 2;

                if (this.is_boundary()) {
                    break;
                } else {
                    this.pos -= 2;
                }
            }

            const condition = this.parse_condition();

            if (condition === false) {
                return false;
            }

            if (condition === null) {
                continue;
            }

            conditions.push(condition);
        }

        if (conditions.length === 0) {
            return null;
        }

        if (conditions.length === 1) {
            return conditions[0];
        }

        return {
            type: 'and',
            conditions,
        };
    }

    private parse_condition(): Condition | false | null {
        if (this.char() === '(') {
            this.pos++;
            const result = this.parse_disjunction();

            if (result === false) {
                return false;
            }

            if (this.char() !== ')') {
                return false;
            }

            this.pos++;
            return result;
        }

        if (this.char() === '-') {
            return this.parse_negation();
        }

        const start_pos = this.pos;
        const keyword_and_operator = this.parse_keyword_and_operator();

        if (keyword_and_operator === null) {
            return this.parse_name_cond();
        }

        const { keyword, operator } = keyword_and_operator;
        let result = null;

        switch (keyword) {
            case 'color':
            case 'c':
                result = this.parse_color_or_id_cond(operator, 'ge', 'colors');
                break;

            case 'date':
                result = this.parse_date_cond(operator);
                break;

            case 'format':
            case 'f':
                result = this.parse_format_cond(operator);
                break;

            case 'identity':
            case 'id':
                result = this.parse_color_or_id_cond(operator, 'le', 'identity');
                break;

            case 'is':
            case 'not':
                result = this.parse_boolean_prop_cond(keyword, operator);
                break;

            case 'mana':
            case 'm':
                result = this.parse_mana_cost_cond(operator);
                break;

            case 'manavalue':
            case 'mv':
            case 'cmc':
                result = this.parse_mana_value_cond(operator);
                break;

            case 'oracle':
            case 'o':
            case 'fulloracle':
            case 'fo':
                result = this.parse_oracle_cond(operator);
                break;

            case 'rarity':
            case 'r':
                result = this.parse_rarity_cond(operator);
                break;

            case 'set':
            case 's':
            case 'edition':
            case 'e':
                result = this.parse_set_cond(operator);
                break;

            case 'type':
            case 't':
                result = this.parse_type_cond(operator);
                break;

            case 'year':
                result = this.parse_year_cond(operator);
                break;
        }

        if (result === null) {
            this.pos = start_pos;
            return this.parse_name_cond();
        }

        return result;
    }

    private parse_negation(): Condition | false | null {
        this.pos++;

        const condition = this.parse_condition();

        if (condition === false) {
            return false;
        }

        if (condition === null) {
            return null;
        }

        return {
            type: 'not',
            condition,
        };
    }

    private parse_keyword_and_operator(): { keyword: string, operator: Operator } | null {
        const start_pos = this.pos;

        outer: while (!this.is_boundary()) {
            for (const operator of Array<Operator>(':', '=', '!=', '<=', '>=', '<', '>')) {
                if (this.query_string.startsWith(operator, this.pos)) {
                    this.pos += operator.length;

                    if (this.is_boundary()) {
                        break outer;
                    }

                    const keyword = this.query_string.slice(start_pos, this.pos - operator.length);

                    return {
                        keyword: keyword.toLocaleLowerCase('en'),
                        operator,
                    };
                }
            }

            this.pos++;
        }

        this.pos = start_pos;
        return null;
    }

    private parse_color_or_id_cond(
        operator: Operator,
        colon_type: 'le' | 'ge',
        prop: Prop,
    ): Comparison_Condition | null {
        let value_string = this.parse_word();
        const number_value = string_to_int(value_string);

        if (number_value !== null) {
            return this.add_prop({
                type: this.operator_to_type(operator, 'eq'),
                prop,
                value: number_value,
            });
        }

        value_string = value_string.toLocaleLowerCase('en');
        let value: Mana_Cost | null = null;

        switch (value_string) {
            case 'colorless':
            case 'c':
                value = {};
                break;
            case 'white':
                value = { [MANA_WHITE]: 1 };
                break;
            case 'blue':
                value = { [MANA_BLUE]: 1 };
                break;
            case 'black':
                value = { [MANA_BLACK]: 1 };
                break;
            case 'red':
                value = { [MANA_RED]: 1 };
                break;
            case 'green':
                value = { [MANA_GREEN]: 1 };
                break;
            case 'azorius':
                value = { [MANA_WHITE]: 1, [MANA_BLUE]: 1 };
                break;
            case 'orzhov':
            case 'silverquill':
                value = { [MANA_WHITE]: 1, [MANA_BLACK]: 1 };
                break;
            case 'dimir':
                value = { [MANA_BLUE]: 1, [MANA_BLACK]: 1 };
                break;
            case 'izzet':
            case 'prismari':
                value = { [MANA_BLUE]: 1, [MANA_RED]: 1 };
                break;
            case 'rakdos':
                value = { [MANA_BLACK]: 1, [MANA_RED]: 1 };
                break;
            case 'golgari':
            case 'witherbloom':
                value = { [MANA_BLACK]: 1, [MANA_GREEN]: 1 };
                break;
            case 'gruul':
                value = { [MANA_RED]: 1, [MANA_GREEN]: 1 };
                break;
            case 'boros':
            case 'lorehold':
                value = { [MANA_RED]: 1, [MANA_WHITE]: 1 };
                break;
            case 'selesnya':
                value = { [MANA_GREEN]: 1, [MANA_WHITE]: 1 };
                break;
            case 'simic':
            case 'quandrix':
                value = { [MANA_GREEN]: 1, [MANA_BLUE]: 1 };
                break;
            case 'bant':
                value = { [MANA_GREEN]: 1, [MANA_WHITE]: 1, [MANA_BLUE]: 1 };
                break;
            case 'esper':
                value = { [MANA_WHITE]: 1, [MANA_BLUE]: 1, [MANA_BLACK]: 1 };
                break;
            case 'grixis':
                value = { [MANA_BLUE]: 1, [MANA_BLACK]: 1, [MANA_RED]: 1 };
                break;
            case 'jund':
                value = { [MANA_BLACK]: 1, [MANA_RED]: 1, [MANA_GREEN]: 1 };
                break;
            case 'naya':
                value = { [MANA_RED]: 1, [MANA_GREEN]: 1, [MANA_WHITE]: 1 };
                break;
            case 'abzan':
                value = { [MANA_WHITE]: 1, [MANA_BLACK]: 1, [MANA_GREEN]: 1 };
                break;
            case 'jeskai':
                value = { [MANA_BLUE]: 1, [MANA_RED]: 1, [MANA_WHITE]: 1 };
                break;
            case 'sultai':
                value = { [MANA_BLACK]: 1, [MANA_GREEN]: 1, [MANA_BLUE]: 1 };
                break;
            case 'mardu':
                value = { [MANA_RED]: 1, [MANA_WHITE]: 1, [MANA_BLACK]: 1 };
                break;
            case 'temur':
                value = { [MANA_GREEN]: 1, [MANA_BLUE]: 1, [MANA_RED]: 1 };
                break;
            case 'artifice':
                value = { [MANA_WHITE]: 1, [MANA_BLUE]: 1, [MANA_BLACK]: 1, [MANA_RED]: 1 };
                break;
            case 'chaos':
                value = { [MANA_BLUE]: 1, [MANA_BLACK]: 1, [MANA_RED]: 1, [MANA_GREEN]: 1 };
                break;
            case 'aggression':
                value = { [MANA_BLACK]: 1, [MANA_RED]: 1, [MANA_GREEN]: 1, [MANA_WHITE]: 1 };
                break;
            case 'altruism':
                value = { [MANA_RED]: 1, [MANA_GREEN]: 1, [MANA_WHITE]: 1, [MANA_BLUE]: 1 };
                break;
            case 'growth':
                value = { [MANA_GREEN]: 1, [MANA_WHITE]: 1, [MANA_BLUE]: 1, [MANA_BLACK]: 1 };
                break;

            default: {
                value = {};

                for (const c of value_string) {
                    switch (c) {
                        case 'w':
                            value[MANA_WHITE] = 1;
                            break;
                        case 'u':
                            value[MANA_BLUE] = 1;
                            break;
                        case 'b':
                            value[MANA_BLACK] = 1;
                            break;
                        case 'r':
                            value[MANA_RED] = 1;
                            break;
                        case 'g':
                            value[MANA_GREEN] = 1;
                            break;
                        default:
                            return null;
                    }
                }

                if (Object.keys(value).length === 0) {
                    return null;
                }
            }
        }

        assert(value !== null);

        return this.add_prop({
            type: this.operator_to_type(operator, colon_type),
            prop,
            value,
        });
    }

    private parse_date_cond(operator: Operator): Comparison_Condition | null {
        const start_pos = 0;
        const match = this.parse_regex(/(\d{4})-(\d{2})-(\d{2})/y);

        if (match === null) {
            return null;
        }

        const [date_str, year_str, month_str, day_str] = match;

        const date = new Date(date_str + 'T00:00:00Z');
        const year = string_to_int(year_str) as number;
        const month = string_to_int(month_str) as number;
        const day = string_to_int(day_str) as number;

        if (date.getFullYear() !== year
            || date.getMonth() !== month - 1
            || date.getDate() !== day
        ) {
            this.pos = start_pos;
            return null;
        }

        return this.add_prop({
            type: this.operator_to_type(operator, 'eq'),
            prop: 'released_at',
            value: date,
        });
    }

    private parse_format_cond(operator: Operator): Comparison_Condition | null {
        if (operator !== ':' && operator !== '=') {
            return null;
        }

        let value = this.parse_word().toLocaleLowerCase('en');

        switch (value) {
            case 'edh':
                value = 'commander';
                break;
            case 'os':
                value = 'oldschool';
                break;
            case 'pd':
                value = 'penny';
                break;
            case 'pedh':
                value = 'paupercommander';
                break;
            case 'pm':
                value = 'premodern';
                break;
            case 's':
                value = 'standard';
                break;
        }

        return this.add_prop({
            type: 'eq',
            prop: 'formats',
            value,
        });
    }

    private parse_boolean_prop_cond(
        keyword: 'is' | 'not',
        operator: Operator,
    ): Comparison_Condition | null {
        if (operator !== ':' && operator !== '=') {
            return null;
        }

        const start_pos = this.pos;
        const prop = this.parse_word();
        const value = keyword === 'is';

        switch (prop) {
            case 'reprint':
                return {
                    type: 'eq',
                    prop,
                    value,
                };

            default:
                this.pos = start_pos;
                return null;
        }
    }

    private parse_mana_cost_cond(operator: Operator): Comparison_Condition | null {
        const { cost, len } = parse_mana_cost(this.query_string, this.pos);

        if (Object.keys(cost).length === 0) {
            return null;
        }

        this.pos += len;

        return this.add_prop({
            type: this.operator_to_type(operator, 'ge'),
            prop: 'cost',
            value: cost,
        });
    }

    private parse_mana_value_cond(operator: Operator): Comparison_Condition | Predicate_Condition | null {
        const value_string = this.parse_word().toLocaleLowerCase('en');

        if (operator === ':' || operator === '=') {
            if (value_string === 'even') {
                return this.add_prop({
                    type: 'even',
                    prop: 'cmc',
                });
            }

            if (value_string === 'odd') {
                return this.add_prop({
                    type: 'odd',
                    prop: 'cmc',
                });
            }
        }

        const value = string_to_int(value_string);

        if (value === null) {
            return null;
        }

        return this.add_prop({
            type: this.operator_to_type(operator, 'eq'),
            prop: 'cmc',
            value,
        });
    }

    private parse_name_cond(): Condition {
        const { value, quoted } = this.parse_string();
        const value_lc = value.toLocaleLowerCase('en');

        if (quoted) {
            return this.add_prop({
                type: 'substring',
                prop: 'name_search',
                value: value_lc,
            });
        } else {
            // We're just mimicking SF behavior here...
            const conditions = [];

            for (const part of value_lc.split(/[/\\]/g)) {
                const part_stripped = part.replace(INEXACT_REGEX, '');

                if (part_stripped.length > 0) {
                    conditions.push(this.add_prop({
                        type: 'substring',
                        prop: 'name_inexact',
                        value: part_stripped,
                    }));
                }
            }

            if (conditions.length === 0) {
                return { type: 'true' };
            }

            if (conditions.length === 1) {
                return conditions[0];
            }

            return {
                type: 'and',
                conditions,
            };
        }
    }

    private parse_oracle_cond(operator: Operator): Substring_Condition | null {
        if (operator !== ':' && operator !== '=') {
            return null;
        }

        const { value } = this.parse_string();

        if (value.length === 0) {
            return null;
        }

        return this.add_prop({
            type: 'substring',
            prop: 'oracle_search',
            value: value.toLocaleLowerCase('en'),
        });
    }

    private parse_set_cond(operator: Operator): Comparison_Condition | null {
        const start_pos = this.pos;
        let value = this.parse_word().toLocaleLowerCase('en');

        if (!this.is_boundary()) {
            this.pos = start_pos;
            return null;
        }

        return this.add_prop({
            type: this.operator_to_type(operator, 'eq'),
            prop: 'set',
            value,
        });
    }

    private parse_rarity_cond(operator: Operator): Comparison_Condition | null {
        const start_pos = this.pos;
        let match = this.parse_regex(/common|uncommon|rare|mythic|special|bonus|[curmsb]/iy);

        if (match === null || !this.is_boundary()) {
            this.pos = start_pos;
            return null;
        }

        let value = match[0].toLocaleLowerCase('en');

        switch (value) {
            case 'c':
                value = RARITY_COMMON;
                break;
            case 'u':
                value = RARITY_UNCOMMON;
                break;
            case 'r':
                value = RARITY_RARE;
                break;
            case 'm':
                value = RARITY_MYTHIC;
                break;
            case 's':
                value = RARITY_SPECIAL;
                break;
            case 'b':
                value = RARITY_BONUS;
                break;
        }

        return this.add_prop({
            type: this.operator_to_type(operator, 'eq'),
            prop: 'rarity',
            value,
        });
    }

    private parse_type_cond(operator: Operator): Substring_Condition | null {
        if (operator !== ':' && operator !== '=') {
            return null;
        }

        const { value } = this.parse_string();

        if (value.length === 0) {
            return null;
        }

        return this.add_prop({
            type: 'substring',
            prop: 'type_search',
            value: value.toLocaleLowerCase('en'),
        });
    }

    private parse_year_cond(
        operator: Operator,
    ): Comparison_Condition | Range_Condition | null {
        const start_pos = 0;
        const year = string_to_int(this.parse_word());

        if (year === null) {
            this.pos = start_pos;
            return null;
        }

        this.props.add('released_at');

        const type = this.operator_to_type(operator, 'eq');
        const date = new Date(0);
        date.setFullYear(year);

        if (type === 'eq' || type === 'ne') {
            const end_date = new Date(0);
            end_date.setFullYear(year);
            end_date.setMonth(11);
            end_date.setDate(31);

            return {
                type: 'range',
                prop: 'released_at',
                start: date,
                start_inc: true,
                end: end_date,
                end_inc: true,
            };
        }

        if (type === 'gt' || type === 'le') {
            date.setMonth(11);
            date.setDate(31);
        }

        return {
            type,
            prop: 'released_at',
            value: date,
        };
    }

    private parse_string(): { value: string, quoted: boolean } {
        switch (this.char()) {
            case '"':
            case "'": {
                const end = this.query_string.indexOf(this.char(), this.pos + 1);

                if (end !== -1) {
                    const start_pos = this.pos + 1;
                    this.pos = end + 1;
                    return { value: this.query_string.slice(start_pos, this.pos - 1), quoted: true };
                }

                break;
            }
        }

        return { value: this.parse_word(), quoted: false };
    }

    private parse_word(): string {
        const start_pos = this.pos;

        while (!this.is_boundary()) {
            this.pos++;
        }

        return this.query_string.slice(start_pos, this.pos);
    }

    private parse_regex(regex: RegExp): RegExpExecArray | null {
        assert(regex.sticky, () => `Regex "${regex.source}" should be sticky.`);

        regex.lastIndex = this.pos;
        const m = regex.exec(this.query_string);

        if (m === null) {
            return null;
        }

        this.pos += m[0].length;
        return m;
    }

    private operator_to_type<T extends Condition['type']>(
        operator: Operator,
        colon_type: T,
    ): T | 'eq' | 'ne' | 'lt' | 'gt' | 'le' | 'ge' {
        switch (operator) {
            case ':':
                return colon_type;
            case '=':
                return 'eq';
            case '!=':
                return 'ne';
            case '<':
                return 'lt';
            case '>':
                return 'gt';
            case '<=':
                return 'le';
            case '>=':
                return 'ge';
            default:
                unreachable(`Unknown operator "${operator}".`);
        }
    }

    private add_prop<T extends Condition & { prop: Prop }>(cond: T): T {
        this.props.add(cond.prop);
        return cond;
    }
}

function combine_queries_with_conjunction(...queries: Query[]): Query {
    assert(queries.length >= 1);

    if (queries.length === 1) {
        return queries[0];
    }

    const props = new Set<Prop>();
    const conditions = Array<Condition>();

    for (const query of queries) {
        for (const prop of query.props) {
            props.add(prop);
        }

        conditions.push(query.condition);
    }

    return {
        props: [...props],
        condition: {
            type: 'and',
            conditions,
        }
    };
}

/** Reduces amount of condition nesting. */
function simplify_query(query: Query): Query {
    return new Query_Simplifier().simplify(query);
}

class Query_Simplifier {
    private props!: Set<Prop>;

    simplify(query: Query): Query {
        this.props = new Set(query.props);

        const condition = this.simplify_condition(query.condition);

        return {
            props: [...this.props],
            condition,
        }
    }

    private simplify_condition(condition: Condition): Condition {
        switch (condition.type) {
            case 'not': {
                const nested_cond = this.simplify_condition(condition.condition);

                switch (nested_cond.type) {
                    case 'not':
                        return nested_cond.condition;

                    case 'true':
                        return { type: 'false' };

                    case 'false':
                        return { type: 'true' };

                    case 'eq':
                        return {
                            type: 'ne',
                            prop: nested_cond.prop,
                            value: nested_cond.value,
                        };

                    case 'ne':
                        return {
                            type: 'eq',
                            prop: nested_cond.prop,
                            value: nested_cond.value,
                        };

                    case 'lt':
                        return {
                            type: 'ge',
                            prop: nested_cond.prop,
                            value: nested_cond.value,
                        };

                    case 'le':
                        return {
                            type: 'gt',
                            prop: nested_cond.prop,
                            value: nested_cond.value,
                        };

                    case 'gt':
                        return {
                            type: 'le',
                            prop: nested_cond.prop,
                            value: nested_cond.value,
                        };

                    case 'ge':
                        return {
                            type: 'lt',
                            prop: nested_cond.prop,
                            value: nested_cond.value,
                        };

                    case 'even':
                        return {
                            type: 'odd',
                            prop: nested_cond.prop,
                        };

                    case 'odd':
                        return {
                            type: 'even',
                            prop: nested_cond.prop,
                        };

                    case 'or':
                    case 'and':
                    case 'substring':
                    case 'range':
                        return condition;
                }
            }

            case 'or': {
                const conditions: Condition[] = [];

                for (const input_nested_cond of condition.conditions) {
                    const nested_cond = this.simplify_condition(input_nested_cond);

                    switch (nested_cond.type) {
                        case 'true':
                            // Entire disjunction is true.
                            return { type: 'true' };
                        case 'false':
                            // Has no effect on disjunction.
                            continue;
                        case 'or':
                            conditions.push(...nested_cond.conditions);
                            break;
                        default:
                            conditions.push(nested_cond);
                            break;
                    }
                }

                if (conditions.length === 0) {
                    // All were false.
                    return { type: 'false' };
                }

                if (conditions.length === 1) {
                    return conditions[0];
                }

                return {
                    type: 'or',
                    conditions,
                };
            }

            case 'and': {
                const conditions: Condition[] = [];

                for (const input_nested_cond of condition.conditions) {
                    const nested_cond = this.simplify_condition(input_nested_cond);

                    switch (nested_cond.type) {
                        case 'true':
                            // Has no effect on conjunction.
                            continue;
                        case 'false':
                            // Entire conjunction is false.
                            return { type: 'false' };
                        case 'and':
                            conditions.push(...nested_cond.conditions);
                            break;
                        default:
                            conditions.push(nested_cond);
                            break;
                    }
                }

                if (conditions.length === 0) {
                    // All were true.
                    return { type: 'true' };
                }

                if (conditions.length === 1) {
                    return conditions[0];
                }

                return {
                    type: 'and',
                    conditions,
                };
            }

            case 'true':
            case 'false':
                return condition;

            case 'eq':
            case 'ne':
            case 'lt':
            case 'le':
            case 'gt':
            case 'ge':
            case 'substring':
            case 'even':
            case 'odd':
            case 'range': {
                this.props.add(condition.prop);
                return condition;
            }
        }
    }
}

type Mana_Cost = { [K: string]: number };

function parse_mana_cost(input: string, start = 0): { cost: Mana_Cost, len: number } {
    let pos = start;
    const cost: Mana_Cost = {};

    for (; ;) {
        const result = parse_mana_symbol(input, pos);

        if (result === null) {
            break;
        }

        const { symbol, generic, len } = result;
        cost[symbol] = (cost[symbol] ?? 0) + (generic ?? 1);
        pos += len;
    }

    return { cost, len: pos - start };
}

function parse_mana_symbol(
    input: string,
    start: number,
): { symbol: string, generic: number | null, len: number } | null {
    let pos = start;
    const initial_regex = /([WUBRGCXS]|\d+)/iy;
    initial_regex.lastIndex = pos;
    const initial_match = initial_regex.exec(input);

    if (initial_match !== null) {
        const symbol_or_generic = initial_match[0].toLocaleUpperCase('en');
        const generic = string_to_int(symbol_or_generic);
        const symbol = generic === null ? symbol_or_generic : MANA_GENERIC;
        return { symbol, generic, len: initial_match[0].length };
    }

    if (input[pos] !== '{') {
        return null;
    }

    pos++;
    const regex = /([WUBRGCXSP]|\d+)/iy;
    const symbols = new Map<string, number | null>();

    loop: for (; ;) {
        regex.lastIndex = pos;
        const match = regex.exec(input);

        if (match === null) {
            return null;
        }

        pos += match[0].length;
        const symbol_or_generic = match[0].toLocaleUpperCase('en');
        const generic = string_to_int(symbol_or_generic);
        const symbol = generic === null ? symbol_or_generic : MANA_GENERIC;

        if (symbols.has(symbol)) {
            return null;
        }

        symbols.set(symbol, generic);

        switch (input[pos]) {
            case '}':
                pos++;
                break loop;

            case '/':
                if (symbols.size >= 3) {
                    return null;
                }

                pos++;
                continue loop;

            default:
                return null;
        }
    }

    // Validate and normalize the order of symbols.
    //
    // Colors: {W}, {U}, {B}, {R}, {G}
    // Colorless: {C}
    // Generic: {2}
    // Generic X: {X}
    // Snow: {S}
    // Hybrid: {W/U}, {W/B}, {U/B}, {U/R}, {B/R}, {B/G}, {R/G}, {R/W}, {G/W}, {G/U}
    // Monocolored hybrid: {2/W}
    // Colorless hybrid: {C/W}, {C/U}, {C/B}, {C/R}, {C/G}
    // Phyrexian: {W/P}, {U/P}, {B/P}, {R/P}, {G/P}
    // Phyrexian hybrid:
    //  {W/U/P}, {W/B/P}, {U/B/P}, {U/R/P}, {B/R/P}, {B/G/P}, {R/G/P}, {R/W/P}, {G/W/P}, {G/U/P}

    let str = '';
    let generic = symbols.get(MANA_GENERIC) ?? null;

    if (generic !== null) {
        if (generic === 2 && symbols.size === 2) {
            // Monocolored hybrid.
            str += generic;

            for (const s of symbols.keys()) {
                if (s === MANA_GENERIC) {
                    continue;
                }

                if (!MANA_WUBRG.includes(s)) {
                    return null;
                }

                str += '/' + s;
                break;
            }

            generic = null;
        } else {
            // Generic cost.
            if (symbols.size !== 1) {
                return null;
            }

            str += MANA_GENERIC;
        }
    } else if (symbols.has(MANA_GENERIC_X)) {
        if (symbols.size !== 1) {
            return null;
        }

        str += MANA_GENERIC_X;
    } else if (symbols.has(MANA_SNOW)) {
        if (symbols.size !== 1) {
            return null;
        }

        str += MANA_SNOW;
    } else {
        // Phyrexian, hybrid or regular cost.
        const has_phyrexian = symbols.has(MANA_PHYREXIAN);

        if (symbols.size > (has_phyrexian ? 3 : 2)) {
            return null;
        }

        if (symbols.has(MANA_COLORLESS)) {
            // Colorless or colorless hybrid.
            if (has_phyrexian) {
                return null;
            }

            str += MANA_COLORLESS;

            for (const s of symbols.keys()) {
                if (s === MANA_COLORLESS) {
                    continue;
                }

                str += '/' + s;
                break;
            }
        } else {
            // Regular or hybrid, possibly in combination with phyrexian.
            const has_white = symbols.has(MANA_WHITE);
            const has_blue = symbols.has(MANA_BLUE);
            const has_black = symbols.has(MANA_BLACK);
            const has_red = symbols.has(MANA_RED);
            const has_green = symbols.has(MANA_GREEN);

            if (has_white) {
                if (has_blue) {
                    str += MANA_WHITE + '/' + MANA_BLUE;
                } else if (has_black) {
                    str += MANA_WHITE + '/' + MANA_BLACK;
                } else if (has_red) {
                    str += MANA_RED + '/' + MANA_WHITE;
                } else if (has_green) {
                    str += MANA_GREEN + '/' + MANA_WHITE;
                } else {
                    str += MANA_WHITE;
                }
            } else if (has_blue) {
                if (has_black) {
                    str += MANA_BLUE + '/' + MANA_BLACK;
                } else if (has_red) {
                    str += MANA_BLUE + '/' + MANA_RED;
                } else if (has_green) {
                    str += MANA_GREEN + '/' + MANA_BLUE;
                } else {
                    str += MANA_BLUE;
                }
            } else if (has_black) {
                if (has_red) {
                    str += MANA_BLACK + '/' + MANA_RED;
                } else if (has_green) {
                    str += MANA_BLACK + '/' + MANA_GREEN;
                } else {
                    str += MANA_BLACK;
                }
            } else if (has_red) {
                if (has_green) {
                    str += MANA_RED + '/' + MANA_GREEN;
                } else {
                    str += MANA_RED;
                }
            } else {
                assert(has_green);
                str += MANA_GREEN;
            }

            if (has_phyrexian) {
                str += '/' + MANA_PHYREXIAN;
            }
        }
    }

    return { symbol: str, generic, len: pos - start };
}

function mana_cost_eq(a: Mana_Cost, b: Mana_Cost, logger: Logger): boolean {
    if (Object.keys(a).length !== Object.keys(b).length) {
        return false;
    }

    for (const [symbol, b_count] of Object.entries(b)) {
        const a_count = a[symbol];

        if (a_count !== b_count) {
            if (a_count === undefined) {
                logger.log('No symbol', symbol, 'in a:', a, 'b:', b);
            } else {
                logger.log('Symbol', symbol, 'value', a_count, '!==', b_count, 'a:', a, 'b:', b);
            }

            return false;
        }
    }

    return true;
}

function mana_cost_is_super_set(
    a: Mana_Cost,
    b: Mana_Cost,
    strict: boolean,
    logger: Logger,
): boolean {
    let a_symbols = Object.keys(a).length;
    const b_symbols = Object.keys(b).length;

    if (a_symbols < b_symbols) {
        logger.log('a has fewer symbols than b.', a, b);
        return false;
    }

    let a_total = 0;
    let b_total = 0;

    for (const [symbol, b_count] of Object.entries(b)) {
        const a_count = a[symbol] ?? 0;

        if (a_count < b_count) {
            logger.log('Symbol', symbol, 'value', a_count, '<', b_count, 'a:', a, 'b:', b);
            return false;
        }

        a_total += a_count;
        b_total += b_count;
    }

    if (!strict) {
        return true;
    }

    if (a_total > b_total) {
        return true;
    }

    // If b is exactly zero cost, pretend a has a generic zero cost too. This makes queries like
    // mana<{R} return 0 cost cards.
    if (b[MANA_GENERIC] === 0 && b_symbols === 1 && !(MANA_GENERIC in a)) {
        a_symbols += 1;
    }

    if (a_symbols > b_symbols) {
        return true;
    } else {
        logger.log("a doesn't have more symbols than b.", a, b);
        return false;
    }
}

async function find_cards_matching_query(
    query: Query,
    sort_order: Sort_Order,
    sort_asc: boolean,
    logger: Logger,
    card_logger: (idx: number) => Logger,
): Promise<{ cards: number[], length: number }> {
    logger.time('find_cards_matching_query');
    logger.log('query', query);
    logger.time('find_cards_matching_query_load');

    // Fire off data loads.
    const required_for_query_promises = [];
    const required_for_display_promises = [];

    for (const prop of query.props) {
        required_for_query_promises.push(data.load(prop));
    }

    const sorter_promise = data.get_sorter(sort_order);

    for (const prop of Array<Prop>('sfurl', 'img')) {
        required_for_display_promises.push(data.load(prop));
    }

    // Await data loads necessary for query.
    for (const promise of required_for_query_promises) {
        await promise;
    }

    // Await the smallest display property if we have no necessary properties to wait for, just to
    // get the amount of cards.
    if (data.length === null) {
        await required_for_display_promises[0];
    }

    logger.time_end('find_cards_matching_query_load');
    logger.time('find_cards_matching_query_evaluate');

    const len = data.length ?? 0;
    const add_version_idx = is_by_version_order(sort_order);
    const evaluator = new Query_Evaluator(query, true, true);

    const matching_cards = new Map<number, number>();

    for (let card_idx = 0; card_idx < len; card_idx++) {
        try {
            const result = evaluator.evaluate(card_idx, card_logger(card_idx));
            const version_idx = result.first_or_null();

            if (version_idx !== null) {
                matching_cards.set(card_idx, add_version_idx ? version_idx : 0);
            }
        } catch (e) {
            throw Error(
                `Couldn't evaluate query with "${data.name(card_idx)}".`,
                { cause: e },
            );
        }
    }

    logger.time_end('find_cards_matching_query_evaluate');
    logger.time('find_cards_matching_query_load_sorter');

    const sorter = await sorter_promise;

    logger.time_end('find_cards_matching_query_load_sorter');
    logger.time('find_cards_matching_query_sort');

    const result = sorter.sort(matching_cards, sort_asc);

    logger.time_end('find_cards_matching_query_sort');
    logger.time('find_cards_matching_query_load_display');

    // Await data loads necessary for display.
    for (const promise of required_for_display_promises) {
        await promise;
    }

    logger.time_end('find_cards_matching_query_load_display');
    logger.time_end('find_cards_matching_query');

    return {
        cards: result,
        length: result.length,
    };
}

class Query_Evaluator {
    private readonly query: Query;
    private readonly bitset: boolean;
    private readonly small_set_optimization: boolean;
    private card_idx: number = 0;
    private logger: Logger = Nop_Logger;

    constructor(query: Query, bitset: boolean, small_set_optimization: boolean) {
        this.query = query;
        this.bitset = bitset;
        this.small_set_optimization = small_set_optimization;
    }

    evaluate(card_idx: number, logger: Logger): Uint_Set {
        this.card_idx = card_idx;
        this.logger = logger;

        const version_count = data.version_count(card_idx) ?? 1;

        if (logger.should_log) {
            const name = data.name(card_idx);
            logger.log('evaluating query with', name, card_idx, 'versions', version_count);
        }

        let version_idxs;
        let set_type;

        if (this.small_set_optimization && version_count <= 32) {
            version_idxs = Bitset_32.with_cap(version_count);
            version_idxs.fill();
            set_type = 0;
        } else if (this.bitset) {
            Bitset.reset_mem();
            version_idxs = Bitset.with_cap(version_count);
            version_idxs.fill();
            set_type = 1;
        } else {
            Array_Set.reset_mem();
            version_idxs = new Array_Set();
            version_idxs.fill_to(version_count);
            set_type = 2;
        }

        this.evaluate_condition(this.query.condition, version_idxs, set_type);

        return version_idxs;
    }

    private evaluate_condition(condition: Condition, version_idxs: Uint_Set, set_type: number) {
        this.logger.group(condition.type, condition);

        switch (condition.type) {
            case 'true': {
                break;
            }
            case 'false': {
                version_idxs.clear();
                break;
            }
            case 'or': {
                const idxs = version_idxs.copy();
                const sub_idxs = version_idxs.copy();
                version_idxs.clear();

                for (const cond of condition.conditions) {
                    idxs.copy_into(sub_idxs);
                    this.evaluate_condition(cond, sub_idxs, set_type);
                    version_idxs.union(sub_idxs);

                    if (version_idxs.size === idxs.size) {
                        break;
                    }
                }

                break;
            }
            case 'and': {
                for (const cond of condition.conditions) {
                    this.evaluate_condition(cond, version_idxs, set_type);

                    if (version_idxs.size === 0) {
                        break;
                    }
                }

                break;
            }
            case 'not': {
                const sub_idxs = version_idxs.copy();
                this.evaluate_condition(condition.condition, sub_idxs, set_type);
                version_idxs.diff(sub_idxs);
                break;
            }
            default: {
                switch (set_type) {
                    case 0:
                        this.evaluate_property_condition_bitset_32(
                            condition,
                            version_idxs as Bitset_32,
                        );
                        break;
                    case 1:
                        this.evaluate_property_condition_bitset(
                            condition,
                            version_idxs as Bitset,
                        );
                        break;
                    case 2:
                        this.evaluate_property_condition_array_set(
                            condition,
                            version_idxs as Array_Set,
                        );
                        break;
                    default:
                        unreachable();
                }

                break;
            }
        }

        if (this.logger.should_log) {
            this.logger.log('result', version_idxs.to_array());
        }

        this.logger.group_end();
    }

    private evaluate_property_condition_bitset_32(
        condition: Comparison_Condition | Substring_Condition | Predicate_Condition | Range_Condition,
        version_idxs: Bitset_32,
    ) {
        if (PER_VERSION_PROPS.includes(condition.prop)) {
            let values = version_idxs.values;
            const cap = version_idxs.cap;
            let size = version_idxs.size;

            for (let version_idx = 0; version_idx < cap; version_idx++) {
                const bit_mask = 1 << version_idx;

                if ((values & bit_mask) === 0) {
                    continue;
                }

                if (!this.evaluate_property_condition_with_version(condition, version_idx)) {
                    values &= ~bit_mask;
                    size -= 1;
                }
            }

            version_idxs.values = values;
            version_idxs.size = size;
        } else if (!this.evaluate_property_condition_with_version(condition, 0)) {
            version_idxs.clear();
        }
    }

    private evaluate_property_condition_bitset(
        condition: Comparison_Condition | Substring_Condition | Predicate_Condition | Range_Condition,
        version_idxs: Bitset,
    ) {
        if (PER_VERSION_PROPS.includes(condition.prop)) {
            const m_off = version_idxs.m_off;
            const len = version_idxs.m_end - m_off;
            let bits_left = version_idxs.cap;
            let size = version_idxs.size;

            for (let i = 0; i < len; i++, bits_left -= 32) {
                let slot = Bitset.mem[m_off + i];

                if (slot === 0) {
                    continue;
                }

                let bits_end = slot === 0 ? 0 : Math.min(bits_left, 32);

                for (let j = 0; j < bits_end; j++) {
                    if ((slot & (1 << j)) === 0) {
                        continue;
                    }

                    const version_idx = i * 32 + j;

                    if (!this.evaluate_property_condition_with_version(condition, version_idx)) {
                        slot &= ~(1 << j);
                        size -= 1;
                    }
                }

                Bitset.mem[m_off + i] = slot;
            }

            version_idxs.size = size;
        } else if (!this.evaluate_property_condition_with_version(condition, 0)) {
            version_idxs.clear();
        }
    }

    private evaluate_property_condition_array_set(
        condition: Comparison_Condition | Substring_Condition | Predicate_Condition | Range_Condition,
        version_idxs: Array_Set,
    ) {
        if (PER_VERSION_PROPS.includes(condition.prop)) {
            for (let i = version_idxs.size; i > 0;) {
                i--;
                const version_idx = version_idxs.at(i);

                if (!this.evaluate_property_condition_with_version(condition, version_idx)) {
                    version_idxs.delete_at(i);
                }
            }
        } else if (!this.evaluate_property_condition_with_version(condition, 0)) {
            version_idxs.clear();
        }
    }

    private evaluate_property_condition_with_version(
        condition: Comparison_Condition | Substring_Condition | Predicate_Condition | Range_Condition,
        version_idx: number,
    ): boolean {
        let values: any = data.get_for_version(this.card_idx, version_idx, condition.prop);

        if (!Array.isArray(values)) {
            values = [values];
        }

        this.logger.log('values', values);

        const is_color_or_id = condition.prop === 'colors' || condition.prop === 'identity';

        if (is_color_or_id && typeof (condition as Comparison_Condition).value === 'number') {
            const cond_value = (condition as Comparison_Condition).value as number;

            for (const value of values) {
                // Ignore non-existent values.
                if (value === null) {
                    continue;
                }

                const count = Object.keys(value).length;
                let result;

                switch (condition.type) {
                    case 'eq':
                        result = count === cond_value;
                        break;
                    case 'ne':
                        result = count !== cond_value;
                        break;
                    case 'gt':
                        result = count > cond_value;
                        break;
                    case 'lt':
                        result = count < cond_value;
                        break;
                    case 'ge':
                        result = count >= cond_value;
                        break;
                    case 'le':
                        result = count <= cond_value;
                        break;
                    default:
                        unreachable(
                            `Invalid condition type "${condition.type}" for property "${condition.prop}".`
                        );
                }

                if (result) {
                    return true;
                }
            }
        } else if (is_color_or_id || condition.prop === 'cost') {
            const cond_value = (condition as Comparison_Condition).value as Mana_Cost;

            for (const value of values) {
                // Ignore non-existent values.
                if (value === null) {
                    continue;
                }

                let result;

                switch (condition.type) {
                    case 'eq':
                        result = mana_cost_eq(value, cond_value, this.logger);
                        break;
                    case 'ne':
                        result = !mana_cost_eq(value, cond_value, this.logger);
                        break;
                    case 'gt':
                        result = mana_cost_is_super_set(value, cond_value, true, this.logger);
                        break;
                    case 'lt':
                        result = mana_cost_is_super_set(cond_value, value, true, this.logger);
                        break;
                    case 'ge':
                        result = mana_cost_is_super_set(value, cond_value, false, this.logger);
                        break;
                    case 'le':
                        result = mana_cost_is_super_set(cond_value, value, false, this.logger);
                        break;
                    default:
                        unreachable(
                            `Invalid condition type "${condition.type}" for property "${condition.prop}".`
                        );
                }

                if (result) {
                    return true;
                }
            }
        } else {
            let eq: (a: any, b: any) => boolean = (a, b) => a === b;
            let compare: (a: any, b: any) => number = (a, b) => a - b;

            if (condition.prop === 'rarity') {
                compare = (a, b) => (RARITY_RANK as any)[a] - (RARITY_RANK as any)[b];
            } else if (condition.prop === 'released_at') {
                eq = (a, b) => a - b === 0
            }

            for (const value of values) {
                // Ignore non-existent values.
                if (value === null) {
                    continue;
                }

                let result;

                switch (condition.type) {
                    case 'eq':
                        result = eq(value, condition.value);
                        break;
                    case 'ne':
                        result = !eq(value, condition.value);
                        break;
                    case 'gt':
                        result = compare(value, condition.value) > 0;
                        break;
                    case 'lt':
                        result = compare(value, condition.value) < 0;
                        break;
                    case 'ge':
                        result = compare(value, condition.value) >= 0;
                        break;
                    case 'le':
                        result = compare(value, condition.value) <= 0;
                        break;
                    case 'even':
                        result = value % 2 === 0;
                        break;
                    case 'odd':
                        result = value % 2 !== 0;
                        break;
                    case 'substring':
                        result = value.includes(condition.value);
                        break;
                    case 'range': {
                        const start_compare = compare(value, condition.start);

                        if (start_compare < 0) {
                            result = false;
                            break;
                        }

                        const end_compare = compare(value, condition.end);

                        if (end_compare > 0) {
                            result = false;
                            break;
                        }

                        result = (start_compare > 0 || condition.start_inc)
                            && (end_compare < 0 || condition.end_inc);

                        break;
                    }
                    default:
                        unreachable(`Invalid condition type "${(condition as Condition).type}".`);
                }

                if (result) {
                    return true;
                }
            }
        }

        return false;
    }
}

function get_el<E extends Element>(query: string): E {
    const element = document.querySelector(query);

    if (element === null) {
        throw Error(`No element found for query "${query}".`);
    }

    return element as E;
}

function el<E extends HTMLElement>(tagName: string): E {
    return document.createElement(tagName) as E;
}

function deep_eq<T>(a: T, b: T): boolean {
    if (a instanceof Set) {
        return b instanceof Set && a.size === b.size && a.isSubsetOf(b);
    } else if (Array.isArray(a) || (typeof a === 'object' && a !== null)) {
        throw Error(`Type of ${a} is unsupported.`);
    } else {
        return a === b;
    }
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
                query,
                'name',
                true,
                Nop_Logger,
                () => Nop_Logger,
            );

            const actual = new Set(result.cards.map(idx => data.name(idx)));

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
        ['Aragorn, the Uniter', 'Elusen, the Giving', 'Ink-Treader Nephilim', 'Kynaios and Tiro of Meletis', 'Omnath, Locus of Creation'],
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
        'm>={2/b}',
        ['Beseech the Queen', 'Reaper King'],
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
        ['Everglades', 'Evermind', 'Needleverge Pathway // Pillarverge Pathway'],
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
        ['Feral Thallid', 'Kindercatch', 'Nyxborn Colossus'],
    );

    // Same as =
    test_query(
        'rarity:',
        'r:c m>=ggg',
        ['Feral Thallid', 'Kindercatch', 'Nyxborn Colossus'],
    );

    test_query(
        'rarity<',
        'RARity<UNcommon m>=ggg',
        ['Feral Thallid', 'Kindercatch', 'Nyxborn Colossus'],
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
        'oracle=bloodfire',
        ['Bloodfire Colossus', 'Bloodfire Dwarf', 'Bloodfire Enforcers', 'Bloodfire Infusion', 'Bloodfire Kavu'],
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
        ['Elvish Scrapper', 'Scuzzback Scrapper', 'Khenra Scrapper', 'Gruul Scrapper', 'Scrapper Champion', 'Tuktuk Scrapper', 'Narstad Scrapper'],
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

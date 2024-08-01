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
    'rarities' |
    'sets' |
    'sfurl' |
    'type' |
    'type_search';

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

const POOLS: { [key: string]: Query } = {};

const SORT_ORDER_TO_INDEX = Object.freeze({
    cmc: 0,
    name: null,
});

type Sort_Order = keyof typeof SORT_ORDER_TO_INDEX;

const INEXACT_REGEX = /[.,:;/\\'" \t]+/g;

/** Static data that gets loaded once and then never changes. */
const data = {
    cards: {
        length: null as number | null,
        props: new Map<Prop, any>(),
        load_promises: new Map<Prop, Promise<void>>(),

        async load(prop: Prop) {
            switch (prop) {
                case 'name_search':
                case 'name_inexact':
                    prop = 'name';
                    break;

                case 'oracle_search':
                    prop = 'oracle';
                    break;

                case 'type_search':
                    prop = 'type';
                    break;
            }

            let promise = this.load_promises.get(prop);

            if (promise === undefined) {
                promise = fetch(`card_${prop}.json`).then(async response => {
                    const data = await response.json();

                    switch (prop) {
                        case 'colors':
                        case 'cost': {
                            for (const faces of data) {
                                for (let i = 0, len = faces.length; i < len; i++) {
                                    const value_str = faces[i];

                                    // Ignore non-existent values. Also ignore empty mana costs of the
                                    // backside of transform cards.
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
                    }

                    this.props.set(prop, data);
                    this.length = data.length;
                });

                this.load_promises.set(prop, promise);
            }

            return promise;
        },

        get(idx: number, prop: Prop): any[] {
            return this.props.get(prop)?.at(idx) ?? null;
        },

        name(idx: number): string | null {
            const names = this.get(idx, 'name');

            if (names === null || names.length == 0) {
                return null;
            }

            return names.join(' // ');
        },

        scryfall_url(idx: number): string | null {
            const sfurl = this.get(idx, 'sfurl');

            if (sfurl === null) {
                return null;
            }

            return `https://scryfall.com/${sfurl}`;
        },

        image_url(idx: number): string | null {
            const img = this.get(idx, 'img')?.at(0);

            if (img == null) {
                return null;
            }

            return `https://cards.scryfall.io/normal/${img}`;
        },
    },
    sort_indices: null as ArrayBuffer | null,
    sort_indices_load_promise: null as Promise<void> | null,

    async load_sort_indices() {
        let promise = this.sort_indices_load_promise;

        if (promise === null) {
            promise = fetch('cards.idx').then(async response => {
                this.sort_indices = await response.arrayBuffer();
            });

            this.sort_indices_load_promise = promise;
        }

        return promise;
    }
};

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

async function init() {
    Console_Logger.time('init');

    POOLS[POOL_ALL] =
        parse_query('');
    POOLS[POOL_PREMODERN_PAUPER] =
        parse_query('format:premodern rarity:common');
    POOLS[POOL_PREMODERN_PAUPER_COMMANDER] =
        parse_query('format:premodern rarity:uncommon type:creature');

    ui.query_el = get_el('.query');
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

    ui.pool_el.onchange = () => set_inputs({ pool: ui.pool_el.value });
    ui.sort_order_el.onchange = () => {
        if (!(ui.sort_order_el.value in SORT_ORDER_TO_INDEX)) {
            throw Error(`Invalid sort order "${ui.sort_order_el.value}" in select field.`);
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

    // Run tests when hostname is localhost or an IPv4 address or explicit parameter is passed.
    if (window.location.hostname === 'localhost'
        || /^\d+\.\d+\.\d+\.\d+(:\d+)?$/g.test(window.location.hostname)
        || params.get('tests')?.toLocaleLowerCase('en') === 'true'
    ) {
        run_test_suite();
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

    const sort_order = params.get('o');

    if (sort_order !== null) {
        if (sort_order in SORT_ORDER_TO_INDEX) {
            new_inputs.sort_order = sort_order as Sort_Order;
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
        const start_pos = parseInt(start_pos_string, 10);

        if (start_pos >= 1) {
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
                throw Error(`Invalid input property ${k}.`);
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

function assert_eq<T>(value: T, expected: T) {
    assert(
        deep_eq(value, expected),
        () => `Value ${to_string(value)} did not match expected ${to_string(expected)}.`
    );
}

interface Logger {
    log(...args: any[]): void;
    info(...args: any[]): void;
    error(...args: any[]): void;
    group(...args: any[]): void;
    group_end(): void;
    time(...args: any[]): void;
    time_end(...args: any[]): void;
}

const Nop_Logger: Logger = {
    log() { },
    info() { },
    error() { },
    group() { },
    group_end() { },
    time() { },
    time_end() { },
};

const Console_Logger: Logger = {
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

async function filter(logger: Logger) {
    logger.info('Filtering cards.');
    logger.time('filter');

    // Try to avoid showing "Loading..." when the user opens the app, as it makes you think you
    // can't filter cards yet.
    if (data.cards.length === null
        && inputs.query_string !== ''
        && ui.result_summary_el.innerHTML === ''
    ) {
        ui.result_summary_el.innerHTML = 'Loading...';
    }

    logger.time('filter_parse_query');

    const user_query: Query = parse_query(inputs.query_string);

    logger.time_end('filter_parse_query');

    const query: Query = combine_queries_with_conjunction(user_query, POOLS[inputs.pool]);
    logger.log('query string', inputs.query_string, 'user query', user_query, 'final query', query);

    result = await find_cards_matching_query(
        query,
        inputs.sort_order,
        inputs.sort_asc,
        logger,
        () => Nop_Logger,
    );

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
        a.href = data.cards.scryfall_url(card_idx) ?? '';
        a.target = '_blank';

        const img: HTMLImageElement = el('img');
        img.loading = 'lazy';
        img.src = data.cards.image_url(card_idx) ?? '';
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

    const at_first_page = data.cards.length === null || start_pos === 1;
    const at_last_page = start_pos >= result.length - MAX_CARDS + 1
    ui.result_prev_el.disabled = at_first_page;
    ui.result_next_el.disabled = at_last_page;
    ui.result_first_el.disabled = at_first_page;
    ui.result_last_el.disabled = at_last_page;

    logger.time_end('filter');
}

function combine_queries_with_conjunction(...args: Query[]): Query {
    assert(args.length >= 1);

    const props = new Set<Prop>();
    const conditions: Condition[] = [];

    for (const query of args) {
        switch (query.condition.type) {
            case 'true':
                // Has no effect on conjunction.
                continue;
            case 'and':
                conditions.push(...query.condition.conditions);
                break;
            default:
                conditions.push(query.condition);
                break;
        }

        for (const prop of query.props) {
            props.add(prop);
        }
    }

    if (conditions.length === 0) {
        // All were true.
        assert_eq(args[0].condition.type, 'true');
        return args[0];
    }

    if (conditions.length === 1) {
        return {
            props: [...props],
            condition: conditions[0],
        };
    }

    return {
        props: [...props],
        condition: {
            type: 'and',
            conditions,
        }
    };
}

type Query = {
    props: Prop[],
    condition: Condition,
};

type Condition =
    Negation_Condition |
    Disjunction_Condition |
    Conjunction_Condition |
    True_Condition |
    Comparison_Condition |
    Substring_Condition |
    Predicate_Condition;

type Negation_Condition = {
    type: 'not',
    condition: Condition,
}

type Disjunction_Condition = {
    type: 'or',
    conditions: Condition[],
}

type Conjunction_Condition = {
    type: 'and',
    conditions: Condition[],
}

type True_Condition = {
    type: 'true',
}

type Comparison_Condition = {
    type: 'eq' | 'ne' | 'lt' | 'gt' | 'le' | 'ge',
    prop: Prop,
    value: number | string | Mana_Cost,
}

type Substring_Condition = {
    type: 'substring',
    prop: Prop,
    value: string,
}

type Predicate_Condition = {
    type: 'even' | 'odd',
    prop: Prop,
}

function parse_query(query_string: string): Query {
    return new Query_Parser().parse(query_string);
}

type Operator = ':' | '=' | '!=' | '<' | '>' | '<=' | '>=';

class Query_Parser {
    private query_string = '';
    private pos = 0;
    private props = new Set<Prop>();

    parse(query_string: string): Query {
        this.query_string = query_string;
        this.pos = 0;
        this.props = new Set();

        let condition: Condition | false | null = this.parse_disjunction();

        if (condition === false || this.chars_left()) {
            condition = { type: 'not', condition: { type: 'true' } };
        } else if (condition === null) {
            condition = { type: 'true' };
        }

        return {
            props: [...this.props],
            condition,
        };
    }

    chars_left(): boolean {
        return this.pos < this.query_string.length;
    }

    char(): string {
        return this.query_string[this.pos];
    }

    is_boundary(): boolean {
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

    parse_disjunction(): Condition | false | null {
        const conditions = [];

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

            if (condition.type === 'or') {
                conditions.push(...condition.conditions);
            } else {
                conditions.push(condition);
            }
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

    parse_conjunction(): Condition | false | null {
        const conditions = [];

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

            if (condition.type === 'and') {
                conditions.push(...condition.conditions);
            } else {
                conditions.push(condition);
            }
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

    parse_condition(): Condition | false | null {
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

            case 'identity':
            case 'id':
                result = this.parse_color_or_id_cond(operator, 'le', 'identity');
                break;

            case 'format':
            case 'f':
                result = this.parse_format_cond(operator);
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
        }

        if (result === null) {
            this.pos = start_pos;
            return this.parse_name_cond();
        }

        return result;
    }

    parse_negation(): Condition | false {
        this.pos++;

        const condition = this.parse_condition();

        if (condition === false) {
            return false;
        }

        if (condition?.type === 'not') {
            return condition.condition;
        }

        return {
            type: 'not',
            condition: condition ?? { type: 'true' },
        };
    }

    parse_keyword_and_operator(): { keyword: string, operator: Operator } | null {
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

    parse_color_or_id_cond(
        operator: Operator,
        colon_type: 'le' | 'ge',
        prop: Prop,
    ): Comparison_Condition | null {
        const value_string = this.parse_word().toLocaleLowerCase('en');
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

    parse_format_cond(operator: Operator): Comparison_Condition | null {
        if (operator !== ':' && operator !== '=') {
            return null;
        }

        const value = this.parse_word().toLocaleLowerCase('en');

        return this.add_prop({
            type: 'eq',
            prop: 'formats',
            value,
        });
    }

    parse_mana_cost_cond(operator: Operator): Comparison_Condition | null {
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

    parse_mana_value_cond(operator: Operator): Comparison_Condition | Predicate_Condition | null {
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

        const value = parseInt(value_string, 10);

        if (isNaN(value)) {
            return null;
        }

        return this.add_prop({
            type: this.operator_to_type(operator, 'eq'),
            prop: 'cmc',
            value,
        });
    }

    parse_name_cond(): Condition | null {
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
    }

    parse_oracle_cond(operator: Operator): Substring_Condition | null {
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

    parse_set_cond(operator: Operator): Comparison_Condition | null {
        const start_pos = this.pos;
        let value = this.parse_word().toLocaleLowerCase('en');

        if (!this.is_boundary()) {
            this.pos = start_pos;
            return null;
        }

        return this.add_prop({
            type: this.operator_to_type(operator, 'eq'),
            prop: 'sets',
            value,
        });
    }

    private parse_rarity_cond(operator: Operator): Comparison_Condition | null {
        const start_pos = this.pos;
        let value = this.parse_regex(/common|uncommon|rare|mythic|special|bonus|[curmsb]/iy);

        if (value === null || !this.is_boundary()) {
            this.pos = start_pos;
            return null;
        }

        value = value.toLocaleLowerCase('en');

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
            prop: 'rarities',
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

    private parse_regex(regex: RegExp): string | null {
        assert(regex.sticky, () => `Regex "${regex.source}" should be sticky.`);

        regex.lastIndex = this.pos;
        const m = regex.exec(this.query_string);

        if (m === null) {
            return null;
        }

        this.pos += m[0].length;
        return m[0];
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
                throw Error(`Unknown operator "${operator}".`);
        }
    }

    private add_prop<T extends Condition & { prop: Prop }>(cond: T): T {
        this.props.add(cond.prop);
        return cond;
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
        let generic: number | null = parseInt(symbol_or_generic, 10);

        if (isNaN(generic)) {
            generic = null;
        }

        const symbol = generic === null ? symbol_or_generic : MANA_GENERIC;

        return { symbol, generic, len: initial_match[0].length };
    }

    if (input[pos] !== '{') {
        return null;
    }

    pos++;
    const regex = /([WUBRGCXSP]|\d+)/iy;
    const symbols = new Map();

    loop: for (; ;) {
        regex.lastIndex = pos;
        const match = regex.exec(input);

        if (match === null) {
            return null;
        }

        pos += match[0].length;
        const symbol_or_generic = match[0].toLocaleUpperCase('en');
        let generic: number | null = parseInt(symbol_or_generic, 10);

        if (isNaN(generic)) {
            generic = null;
        }

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
                logger.log(`No symbol ${symbol} in a.`, a, b);
            } else {
                logger.log(`Symbol ${symbol} value ${a_count} !== ${b_count}.`, a, b);
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
        logger.log(`a has fewer symbols than b.`, a, b);
        return false;
    }

    let a_total = 0;
    let b_total = 0;

    for (const [symbol, b_count] of Object.entries(b)) {
        const a_count = a[symbol] ?? 0;

        if (a_count < b_count) {
            logger.log(`Symbol ${symbol} value ${a_count} < ${b_count}.`, a, b);
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
        logger.log(`a doesn't have more symbols than b.`, a, b);
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

    const sort_index = SORT_ORDER_TO_INDEX[sort_order];

    // Fire off data loads.
    const required_for_query_promises = [];
    const required_for_display_promises = [];

    for (const prop of query.props) {
        required_for_query_promises.push(data.cards.load(prop));
    }

    if (sort_index !== null) {
        required_for_query_promises.push(data.load_sort_indices());
    }

    for (const prop of Array<Prop>('sfurl', 'img')) {
        required_for_display_promises.push(data.cards.load(prop));
    }

    // Await data loads necessary for query.
    for (const promise of required_for_query_promises) {
        await promise;
    }

    // Await the smallest display property if we have no necessary properties to wait for, just to
    // get the amount of cards.
    if (required_for_query_promises.length === 0) {
        await required_for_display_promises[0];
    }

    logger.time_end('find_cards_matching_query_load');
    logger.time('find_cards_matching_query_execute');

    const len = data.cards.length ?? 0;
    let index_view = null;

    if (sort_index !== null && data.sort_indices !== null) {
        const indices_view = new DataView(data.sort_indices);
        const index_count = indices_view.getUint32(0, true);

        if (sort_index >= index_count) {
            logger.error(
                `Sort index ${sort_index} for order ${sort_order} is invalid, there are ${index_count} indices.`
            );
        } else {
            const index_offset = indices_view.getUint32(4 + 4 * sort_index, true);
            const next_index_offset = (sort_index === index_count - 1)
                ? indices_view.byteLength
                : indices_view.getUint32(4 + 4 * (sort_index + 1), true);
            index_view = new DataView(
                data.sort_indices,
                index_offset,
                next_index_offset - index_offset,
            );
        }
    }

    const result = [];

    if (index_view === null) {
        for (let i = 0; i < len; i++) {
            const card_idx = sort_asc ? i : (len - 1 - i);

            if (matches_query(card_idx, query, card_logger(card_idx))) {
                result.push(card_idx);
            }
        }
    } else {
        // Each index groups cards by some criterium. The sort direction determines the direction in
        // which we traverse the groups, but not the direction in which we traverse the cards in
        // each group. This ensures cards are always sorted by the given sort order and then by
        // name.
        const groups_table_len = index_view.getUint16(0, true);
        const groups_table_offset = 2;
        const groups_offset = groups_table_offset + 2 * groups_table_len;
        let invalid_idx_count = 0;

        for (let i = 0; i < groups_table_len; i++) {
            const group_idx = sort_asc ? i : (groups_table_len - 1 - i);
            const group_start = group_idx === 0
                ? 0
                : index_view.getUint16(groups_table_offset + 2 * (group_idx - 1), true);
            const group_end = index_view.getUint16(groups_table_offset + 2 * group_idx, true);

            for (let j = group_start; j < group_end; j++) {
                const idx = groups_offset + 2 * j;
                const card_idx = index_view.getUint16(idx, true);

                if (card_idx >= len) {
                    invalid_idx_count++;
                    continue;
                }

                if (matches_query(card_idx, query, card_logger(card_idx))) {
                    result.push(card_idx);
                }
            }
        }

        if (invalid_idx_count > 0) {
            logger.error(
                `Sort index ${sort_index} for order ${sort_order} contains ${invalid_idx_count} card indexes.`
            );
        }
    }

    logger.time_end('find_cards_matching_query_execute');
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

function matches_query(card_idx: number, query: Query, logger: Logger): boolean {
    const name = data.cards.name(card_idx);
    logger.log(`evaluating query with "${name}"`, card_idx);

    try {
        return matches_condition(card_idx, query.condition, logger);
    } catch (e) {
        throw Error(`Couldn't evaluate query with "${name}".`, { cause: e });
    }
}

/** Returns true if any face of the card matches the condition. */
function matches_condition(card_idx: number, condition: Condition, logger: Logger): boolean {
    logger.group(condition.type, condition);

    let result;

    switch (condition.type) {
        case 'true': {
            result = true;
            break;
        }
        case 'or': {
            result = false;

            for (const cond of condition.conditions) {
                if (matches_condition(card_idx, cond, logger)) {
                    result = true;
                    break;
                }
            }

            break;
        }
        case 'and': {
            result = true;

            for (const cond of condition.conditions) {
                if (!matches_condition(card_idx, cond, logger)) {
                    result = false;
                    break;
                }
            }

            break;
        }
        case 'not': {
            result = !matches_condition(card_idx, condition.condition, logger);
            break;
        }
        default: {
            result = matches_comparison_condition(card_idx, condition, logger);
            break;
        }
    }

    logger.log('result', result);
    logger.group_end();

    return result;
}

function matches_comparison_condition(
    card_idx: number,
    condition: Comparison_Condition | Substring_Condition | Predicate_Condition,
    logger: Logger,
) {
    let values = data.cards.get(card_idx, condition.prop);

    if (!Array.isArray(values)) {
        values = [values];
    }

    logger.log('values', values);

    if (condition.prop === 'colors'
        || condition.prop === 'identity'
        || condition.prop === 'cost'
    ) {
        for (const value of values) {
            // Ignore non-existent values.
            if (value === null) {
                continue;
            }

            const cond_value = (condition as Comparison_Condition).value as Mana_Cost;
            let result;

            switch (condition.type) {
                case 'eq':
                    result = mana_cost_eq(value, cond_value, logger);
                    break;
                case 'ne':
                    result = !mana_cost_eq(value, cond_value, logger);
                    break;
                case 'gt':
                    result = mana_cost_is_super_set(value, cond_value, true, logger);
                    break;
                case 'lt':
                    result = mana_cost_is_super_set(cond_value, value, true, logger);
                    break;
                case 'ge':
                    result = mana_cost_is_super_set(value, cond_value, false, logger);
                    break;
                case 'le':
                    result = mana_cost_is_super_set(cond_value, value, false, logger);
                    break;
                default:
                    throw Error(
                        `Invalid condition type "${condition.type}" for property "${condition.prop}".`
                    );
            }

            if (result) {
                return true;
            }
        }
    } else {
        let compare: ((a: any, b: any) => number) | null = null;

        switch (condition.prop) {
            case 'rarities':
                compare = (a, b) => (RARITY_RANK as any)[a] - (RARITY_RANK as any)[b];
                break;
            default:
                compare = (a, b) => a - b;
                break;
        }

        for (const value of values) {
            // Ignore non-existent values.
            if (value === null) {
                continue;
            }

            let result;

            switch (condition.type) {
                case 'eq':
                    result = value === condition.value;
                    break;
                case 'ne':
                    result = value !== condition.value;
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
                default:
                    throw Error(`Invalid condition type "${(condition as Condition).type}".`);
            }

            if (result) {
                return true;
            }
        }
    }

    return false;
}

function get_el<T extends Element>(query: string): T {
    const element = document.querySelector(query);

    if (element === null) {
        throw Error(`No element found for query "${query}".`);
    }

    return element as T;
}

function el<T extends HTMLElement>(tagName: string): T {
    return document.createElement(tagName) as T;
}

function deep_eq<T>(a: T, b: T): boolean {
    if (a instanceof Set) {
        return b instanceof Set && a.size === b.size && a.isSubsetOf(b);
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

    const tests: { name: string, execute: (logger: Logger) => Promise<void> }[] = [];

    function test(name: string, execute: (logger: Logger) => Promise<void>) {
        tests.push({ name, execute });
    }

    function test_query(name: string, query_string: string, expected_matches: string[]) {
        const MAX_MATCHES = 20;
        const expected = new Set(expected_matches);
        assert(expected.size <= MAX_MATCHES);

        test(`${name} [${query_string}]`, async logger => {
            const query = parse_query(query_string);
            const result = await find_cards_matching_query(
                query,
                'name',
                true,
                Nop_Logger,
                () => Nop_Logger,
            );

            const actual = new Set(result.cards.map(idx => data.cards.name(idx)));

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
                    idx => (log_set.has(data.cards.name(idx)) ? logger : Nop_Logger),
                );

                throw Error(`Expected to get ${expected.size} matches, got ${result.length}. Missing: ${to_string(missing_set)}, unexpected (showing max. 5): ${to_string([...unexpected_set].slice(0, 5))}.`);
            }
        });
    }

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

    // SF seems to interpret this as "name does not contain the empty string".
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

    if (executed === succeeded) {
        Console_Logger.info(`Ran ${executed} tests, all succeeded.`);
    } else {
        Console_Logger.info(`Ran ${executed} tests, ${failed} failed.`);
        alert(`${failed} Tests failed!`);
    }

    Console_Logger.time_end('run_test_suite');
}

if (document.body) {
    init();
} else {
    window.addEventListener('DOMContentLoaded', init);
}

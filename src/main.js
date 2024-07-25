const MAX_CARDS = 100;

const TYPE_TRUE = 'true';
const TYPE_OR = 'or';
const TYPE_AND = 'and';
const TYPE_NOT = 'not';
const TYPE_EQ = 'eq';
const TYPE_NE = 'ne';
const TYPE_GT = 'gt';
const TYPE_LT = 'lt';
const TYPE_GE = 'ge';
const TYPE_LE = 'le';
const TYPE_EVEN = 'even';
const TYPE_ODD = 'odd';
const TYPE_SUBSTRING = 'substring';

const PROP_COLOR = 'colors'
const PROP_FORMAT = 'format';
const PROP_IDENTITY = 'identity';
const PROP_MANA_COST = 'cost';
const PROP_MANA_VALUE = 'cmc';
const PROP_NAME = 'name';
const PROP_ORACLE_TEXT = 'oracle';
const PROP_RARITY = 'rarity';
const PROP_TYPE = 'type';
const PROPS = Object.freeze([
    PROP_MANA_COST, PROP_MANA_VALUE, PROP_NAME, PROP_ORACLE_TEXT, PROP_RARITY, PROP_TYPE
]);

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

const POOLS = {
    [POOL_ALL]: null,
    [POOL_PREMODERN_PAUPER]: null,
    [POOL_PREMODERN_PAUPER_COMMANDER]: null,
};

const SORT_ORDER_TO_INDEX = Object.freeze({
    [PROP_MANA_VALUE]: 0,
    [PROP_NAME]: null,
});

/** Static data that gets loaded once and then never changes. */
const static = {
    cards: [],
    sort_indices: null,
};

/** User input. */
const INPUT_QUERY_STRING = 'query_string';
const INPUT_POOL = 'pool';
const INPUT_SORT_ORDER = 'sort_order';
const INPUT_SORT_ASC = 'sort_asc';
const INPUT_START_POS = 'start_index';

const DEFAULT_QUERY_STRING = '';
const DEFAULT_POOL = POOL_ALL;
const DEFAULT_SORT_ORDER = PROP_NAME;
const DEFAULT_SORT_ASC = true;
const DEFAULT_START_POS = 1;

const inputs = {
    [INPUT_QUERY_STRING]: DEFAULT_QUERY_STRING,
    [INPUT_POOL]: DEFAULT_POOL,
    [INPUT_SORT_ORDER]: DEFAULT_SORT_ORDER,
    [INPUT_SORT_ASC]: DEFAULT_SORT_ASC,
    [INPUT_START_POS]: DEFAULT_START_POS,
};

/** All DOM elements that the user interacts with. */
const ui = {
    query_el: null,
    pool_el: null,
    sort_order_el: null,
    sort_dir_asc_el: null,
    sort_dir_desc_el: null,
    result_summary_el: null,
    result_prev_el: null,
    result_next_el: null,
    result_cards_el: null,
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
    ui.result_cards_el = get_el('.cards');

    const params = get_params();
    set_inputs_from_params(params);

    window.onpopstate = () => set_inputs_from_params(get_params());

    document.onkeydown = e => {
        if (e.key === 'f' && document.activeElement !== ui.query_el) {
            e.preventDefault();
            ui.query_el.focus();
        }
    };

    ui.query_el.onkeydown = e => {
        if (e.key === 'Enter') {
            set_inputs({ [INPUT_QUERY_STRING]: e.currentTarget.value });
        }
    };

    ui.pool_el.onchange = e => set_inputs({ [INPUT_POOL]: e.currentTarget.value });
    ui.sort_order_el.onchange = e => set_inputs({ [INPUT_SORT_ORDER]: e.currentTarget.value });
    ui.sort_dir_asc_el.onchange = e => set_inputs({ [INPUT_SORT_ASC]: e.currentTarget.checked });
    ui.sort_dir_desc_el.onchange = e => set_inputs({ [INPUT_SORT_ASC]: !e.currentTarget.checked });
    ui.result_prev_el.onclick = () =>
        set_inputs({ [INPUT_START_POS]: inputs[INPUT_START_POS] - MAX_CARDS });
    ui.result_next_el.onclick = () =>
        set_inputs({ [INPUT_START_POS]: inputs[INPUT_START_POS] + MAX_CARDS });

    await load_cards(Console_Logger);

    Console_Logger.time_end('init');

    if (params.get('tests')?.toLocaleLowerCase('en') === 'true') {
        run_test_suite();
    }
}

function set_inputs(new_inputs) {
    const params = get_params();
    set_inputs_internal(new_inputs, params, true);
}

function set_inputs_from_params(params) {
    const new_inputs = {};

    new_inputs[INPUT_QUERY_STRING] = params.get('q') ?? DEFAULT_QUERY_STRING;

    const pool = params.get('p');

    if (pool in POOLS) {
        new_inputs[INPUT_POOL] = pool;
    } else {
        if (pool !== null) {
            Console_Logger.error(`Invalid pool in URL: ${pool}`);
        }

        new_inputs[INPUT_POOL] = DEFAULT_POOL;
    }

    const sort_order = params.get('o');

    if (sort_order in SORT_ORDER_TO_INDEX) {
        new_inputs[INPUT_SORT_ORDER] = sort_order;
    } else {
        if (sort_order !== null) {
            Console_Logger.error(`Invalid sort order in URL: ${sort_order}`);
        }

        new_inputs[INPUT_SORT_ORDER] = DEFAULT_SORT_ORDER;
    }

    const sort_dir = params.get('d');

    if (sort_dir === 'a' || sort_dir === 'd') {
        new_inputs[INPUT_SORT_ASC] = sort_dir === 'a';
    } else {
        if (sort_dir !== null) {
            Console_Logger.error(`Invalid sort direction in URL: ${sort_dir}`);
        }

        new_inputs[INPUT_SORT_ASC] = DEFAULT_SORT_ASC;
    }

    const start_pos_string = params.get('s');
    const start_pos = parseInt(start_pos_string, 10);

    if (start_pos >= 1) {
        new_inputs[INPUT_START_POS] = start_pos;
    } else {
        if (start_pos_string !== null) {
            Console_Logger.error(`Invalid start position in URL: ${start_pos_string}`);
        }

        new_inputs[INPUT_START_POS] = DEFAULT_START_POS;
    }

    set_inputs_internal(new_inputs, null, false);
}

function set_inputs_internal(new_inputs, params, update_url) {
    let any_changed = false;
    let start_pos = null;

    for (const [k, v] of Object.entries(new_inputs)) {
        if (inputs[k] === v) {
            continue;
        }

        let default_value;
        let param;
        let param_value;

        switch (k) {
            case INPUT_QUERY_STRING: {
                param = 'q';
                default_value = DEFAULT_QUERY_STRING;
                param_value = v;
                ui.query_el.value = v;
                break;
            }
            case INPUT_POOL: {
                param = 'p';
                default_value = DEFAULT_POOL;
                param_value = v;
                ui.pool_el.value = v;
                break;
            }
            case INPUT_SORT_ORDER: {
                param = 'o';
                default_value = DEFAULT_SORT_ORDER;
                param_value = v;
                ui.sort_order_el.value = v;
                break;
            }
            case INPUT_SORT_ASC: {
                param = 'd';
                default_value = DEFAULT_SORT_ASC;
                param_value = v ? 'a' : 'd';
                (v ? ui.sort_dir_asc_el : ui.sort_dir_desc_el).checked = true;
                break;
            }
            case INPUT_START_POS: {
                param = 's';
                default_value = DEFAULT_START_POS;
                param_value = v;
                break;
            }
            default:
                throw Error(`Invalid input property ${k}.`);
        }

        inputs[k] = v;

        if (update_url) {
            if (v === default_value) {
                params.delete(param);
            } else {
                params.set(param, param_value);
            }
        }

        any_changed = true;

        // If a start pos is given, set the start position. Otherwise, if any other input is
        // changed, reset the start position.
        if (k === INPUT_START_POS) {
            start_pos = v;
        } else if (start_pos === null) {
            start_pos = DEFAULT_START_POS;
        }
    }

    if (any_changed) {
        if (start_pos !== null) {
            inputs[INPUT_START_POS] = start_pos;

            if (update_url) {
                if (start_pos === DEFAULT_START_POS) {
                    params.delete('s');
                } else {
                    params.set('s', start_pos);
                }
            }
        }

        if (update_url) {
            const new_search = params.size ? `?${params}` : '';

            if (window.location.search !== new_search) {
                window.history.pushState(null, null, `/${new_search}`);
            }
        }

        filter(Console_Logger);
    }
}

function get_params() {
    return new URLSearchParams(window.location.search);
}

function assert(condition, message) {
    if (!condition) {
        throw Error(message ? message() : 'Assertion failed.');
    }
}

function assert_eq(value, expected) {
    assert(
        deep_eq(value, expected),
        () => `Value ${to_string(value)} did not match expected ${to_string(expected)}.`
    );
}

const Nop_Logger = {
    log() { },
    info() { },
    error() { },
    group() { },
    group_end() { },
    time() { },
    time_end() { },
};

const Console_Logger = {
    log(...args) { console.log(...args); },
    info(...args) { console.info(...args); },
    error(...args) { console.error(...args); },
    group(...args) { console.group(...args); },
    group_end(...args) { console.groupEnd(...args); },
    time(...args) { console.time(...args); },
    time_end(...args) { console.timeEnd(...args); },
};

class Mem_Logger {
    messages = [];

    log(...args) { this.message('log', ...args); }
    info(...args) { this.message('info', ...args); }
    error(...args) { this.message('error', ...args); }
    group(...args) { this.message('group', ...args); }
    group_end(...args) { this.message('group_end', ...args); }
    time(...args) { this.message('time', ...args); }
    time_end(...args) { this.message('time_end', ...args); }

    message(level, ...args) {
        this.messages.push({ level, args });
    }

    log_to(logger) {
        for (const message of this.messages) {
            logger[message.level](...message.args);
        }
    }
}

async function load_cards(logger) {
    logger.time('load_cards');

    logger.time('load_cards_fetch');
    const cards_response = fetch('cards.json');
    const indices_response = fetch('cards.idx');

    static.cards = await (await cards_response).json();

    for (const card of static.cards) {
        if (card.name === undefined) {
            card.name = (card.faces[0].name + ' // ' + card.faces[1].name);
        }
    }

    static.sort_indices = await (await indices_response).arrayBuffer();
    logger.time_end('load_cards_fetch');

    filter(logger);
    logger.time_end('load_cards');
}

function filter(logger) {
    logger.info('Filtering cards.');
    logger.time('filter');

    logger.time('filter_parse_query');
    const user_query = parse_query(inputs[INPUT_QUERY_STRING]);
    logger.time_end('filter_parse_query');

    const query = create_conjunction_cond(user_query, POOLS[inputs.pool]);
    logger.log('query string', inputs[INPUT_QUERY_STRING], 'user query', user_query, 'final query', query);

    const result = find_cards_matching_query(
        query,
        inputs[INPUT_SORT_ORDER],
        inputs[INPUT_SORT_ASC],
        logger,
        () => Nop_Logger,
    );

    const frag = document.createDocumentFragment();
    let start_pos = inputs[INPUT_START_POS];
    let start_idx = start_pos - 1;

    if (start_idx >= result.length && result.length > 0) {
        start_idx = Math.floor((result.length - 1) / MAX_CARDS) * MAX_CARDS;
        start_pos = start_idx + 1;
        inputs[INPUT_START_POS] = start_pos;
    }

    const view_result = result.slice(start_idx, start_idx + MAX_CARDS);
    const end_pos = start_idx + view_result.length;

    for (const card of view_result) {
        const a = el('a');
        a.className = 'card';
        a.href = card_scryfall_url(card);
        a.target = '_blank';

        const img = el('img');
        img.loading = 'lazy';
        img.src = card_image_url(card);
        a.append(img);

        frag.append(a);
    }

    let summary_text;

    if (static.cards.length === 0) {
        // Try to avoid showing "Loading..." when the user opens the app, as it makes you think you
        // can't filter cards yet.
        if (inputs[INPUT_QUERY_STRING] === '' && ui.result_summary_el.innerHTML === '') {
            summary_text = '';
        } else {
            summary_text = 'Loading...';
        }
    } else if (result.length === 0) {
        summary_text = 'No matches.'
    } else {
        summary_text = `Showing ${start_pos}-${end_pos} of ${result.length} matches.`;
    }

    ui.result_summary_el.innerHTML = summary_text;

    ui.result_cards_el.innerHTML = '';
    ui.result_cards_el.scroll(0, 0);
    ui.result_cards_el.append(frag);

    ui.result_prev_el.disabled = static.cards.length === 0 || start_pos === 1;
    ui.result_next_el.disabled = start_pos >= result.length - MAX_CARDS + 1;

    logger.time_end('filter');
}

function create_conjunction_cond(...args) {
    assert(args.length >= 1);

    const conditions = [];

    for (const arg of args) {
        switch (arg.type) {
            case TYPE_TRUE:
                // Has no effect on conjunction.
                break;
            case TYPE_AND:
                conditions.push(...arg.conditions);
                break;
            default:
                conditions.push(arg);
                break;
        }
    }

    if (conditions.length === 0) {
        // All were true.
        assert_eq(args[0].type, TYPE_TRUE);
        return args[0];
    }

    if (conditions.length === 1) {
        return args[0];
    }

    return {
        type: TYPE_AND,
        conditions,
    };
}

function parse_query(query_string) {
    return new Query_Parser().parse(query_string);
}

class Query_Parser {
    parse(query_string) {
        this.query_string = query_string;
        this.pos = 0;
        return this.parse_conjunction();
    }

    chars_left() {
        return this.pos < this.query_string.length;
    }

    char() {
        return this.query_string[this.pos];
    }

    is_boundary() {
        if (!this.chars_left()) {
            return true;
        }

        switch (this.char()) {
            case ' ':
            case '\t':
                return true;

            default:
                return false;
        }
    }

    parse_conjunction() {
        const conditions = [];

        while (this.chars_left()) {
            if (this.is_boundary()) {
                this.pos++;
                continue;
            }

            conditions.push(this.parse_condition());
        }

        if (conditions.length === 0) {
            return {
                type: TYPE_TRUE,
            };
        }

        if (conditions.length === 1) {
            return conditions[0];
        }

        return {
            type: TYPE_AND,
            conditions,
        };
    }

    parse_condition() {
        const start_pos = this.pos;

        let result = null;

        if (this.char() === '-') {
            result = this.parse_negation();
        } else {
            const [keyword, operator] = this.parse_keyword_and_operator();

            switch (keyword) {
                case 'color':
                case 'c':
                    result = this.parse_color_or_id_cond(operator, TYPE_GE, PROP_COLOR);
                    break;

                case 'identity':
                case 'id':
                    result = this.parse_color_or_id_cond(operator, TYPE_LE, PROP_IDENTITY);
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
                    result = this.parse_oracle_cond(operator);
                    break;

                case 'rarity':
                case 'r':
                    result = this.parse_rarity_cond(operator);
                    break;

                case 'type':
                case 't':
                    result = this.parse_type_cond(operator);
                    break;
            }
        }

        if (result === null) {
            this.pos = start_pos;
            return this.parse_name_cond();
        }

        return result;
    }

    parse_negation() {
        this.pos++;

        if (this.is_boundary()) {
            this.pos--;
            return null;
        }

        return {
            type: TYPE_NOT,
            condition: this.parse_condition(),
        };
    }

    parse_keyword_and_operator() {
        const start_pos = this.pos;

        outer: while (!this.is_boundary()) {
            for (const operator of [':', '=', '!=', '>=', '<=', '>', '<']) {
                if (this.query_string.startsWith(operator, this.pos)) {
                    this.pos += operator.length;

                    if (this.is_boundary()) {
                        break outer;
                    }

                    const keyword = this.query_string.slice(start_pos, this.pos - operator.length);

                    return [
                        keyword.toLocaleLowerCase('en'),
                        operator,
                    ];
                }
            }

            this.pos++;
        }

        this.pos = start_pos;
        return [null, null];
    }

    parse_color_or_id_cond(operator, colon_type, prop) {
        const value_string = this.parse_word().toLocaleLowerCase('en');
        let value = null;

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

        return {
            type: this.operator_to_type(operator, colon_type),
            prop,
            value,
        };
    }

    parse_format_cond(operator) {
        if (operator !== ':' && operator !== '=') {
            return null;
        }

        const value = this.parse_string().toLocaleLowerCase('en');

        return {
            type: TYPE_EQ,
            prop: PROP_FORMAT,
            value,
        }
    }

    parse_mana_cost_cond(operator) {
        const [symbols, len] = parse_mana_cost(this.query_string, this.pos);

        if (Object.keys(symbols).length === 0) {
            return null;
        }

        this.pos += len;

        return {
            type: this.operator_to_type(operator, TYPE_GE),
            prop: PROP_MANA_COST,
            value: symbols,
        };
    }

    parse_mana_value_cond(operator) {
        const value_string = this.parse_word().toLocaleLowerCase('en');

        if (operator === ':' || operator === '=') {
            if (value_string === 'even') {
                return {
                    type: TYPE_EVEN,
                    prop: PROP_MANA_VALUE,
                };
            }

            if (value_string === 'odd') {
                return {
                    type: TYPE_ODD,
                    prop: PROP_MANA_VALUE,
                };
            }
        }

        const value = parseInt(value_string, 10);

        if (isNaN(value)) {
            return null;
        }

        return {
            type: this.operator_to_type(operator, TYPE_EQ),
            prop: PROP_MANA_VALUE,
            value,
        };
    }

    parse_name_cond() {
        const value = this.parse_string().toLocaleLowerCase('en');

        return {
            type: TYPE_SUBSTRING,
            prop: PROP_NAME,
            value,
        };
    }

    parse_oracle_cond(operator) {
        if (operator !== ':' && operator !== '=') {
            return null;
        }

        const value = this.parse_string().toLocaleLowerCase('en');

        return {
            type: TYPE_SUBSTRING,
            prop: PROP_ORACLE_TEXT,
            value,
        }
    }

    parse_rarity_cond(operator) {
        const start_pos = this.pos;
        let value = this.parse_regex(/common|uncommon|rare|mythic|special|bonus|[curmsb]/iy)
            .toLocaleLowerCase('en');

        if (!this.is_boundary()) {
            this.pos = start_pos;
            return null;
        }

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

        return {
            type: this.operator_to_type(operator, TYPE_EQ),
            prop: PROP_RARITY,
            value,
        };
    }

    parse_type_cond(operator) {
        if (operator !== ':' && operator !== '=') {
            return null;
        }

        const value = this.parse_string();

        if (value.length === 0) {
            return null;
        }

        return {
            type: TYPE_SUBSTRING,
            prop: PROP_TYPE,
            value: value.toLocaleLowerCase('en'),
        };
    }

    parse_string() {
        // TODO: Support quotes.
        return this.parse_word();
    }

    parse_word() {
        const start_pos = this.pos;

        while (!this.is_boundary()) {
            this.pos++;
        }

        return this.query_string.slice(start_pos, this.pos);
    }

    parse_regex(regex) {
        assert(regex.sticky, () => `Regex "${regex.source}" should be sticky.`);

        regex.lastIndex = this.pos;
        const m = regex.exec(this.query_string);

        if (m === null) {
            return null;
        }

        this.pos += m[0].length;
        return m[0];
    }

    operator_to_type(operator, colon_type) {
        switch (operator) {
            case ':':
                return colon_type;
            case '=':
                return TYPE_EQ;
            case '!=':
                return TYPE_NE;
            case '>':
                return TYPE_GT;
            case '<':
                return TYPE_LT;
            case '>=':
                return TYPE_GE;
            case '<=':
                return TYPE_LE;
            default:
                throw Error(`Unknown operator "${operator}".`);
        }
    }
}

function parse_mana_cost(input, start = 0) {
    let pos = start;
    const symbols = {};

    for (; ;) {
        const result = parse_mana_symbol(input, pos);

        if (result === null) {
            break;
        }

        const [{ symbol, generic }, len] = result;
        symbols[symbol] = (symbols[symbol] ?? 0) + (generic ?? 1);
        pos += len;
    }

    return [symbols, pos - start];
}

function parse_mana_symbol(input, start) {
    let pos = start;
    const initial_regex = /([WUBRGCXS]|\d+)/iy;
    initial_regex.lastIndex = pos;
    const initial_match = initial_regex.exec(input);

    if (initial_match !== null) {
        const symbol_or_generic = initial_match[0].toLocaleUpperCase('en');
        let generic = parseInt(symbol_or_generic, 10);

        if (isNaN(generic)) {
            generic = null;
        }

        const symbol = generic === null ? symbol_or_generic : MANA_GENERIC;

        return [{ symbol, generic }, initial_match[0].length];
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
        let generic = parseInt(symbol_or_generic, 10);

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
            this.pos = start_pos;
            return null;
        }

        str += MANA_GENERIC_X;
    } else if (symbols.has(MANA_SNOW)) {
        if (symbols.size !== 1) {
            this.pos = start_pos;
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

    return [{ symbol: str, generic }, pos - start];
}

function mana_cost_eq(a, b, logger) {
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

function mana_cost_is_super_set(a, b, strict, logger) {
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

function find_cards_matching_query(query, sort_order, sort_asc, logger, card_logger) {
    logger.time('find_cards_matching_query');
    logger.log('query', query);

    const sort_index = SORT_ORDER_TO_INDEX[sort_order];
    const len = static.cards.length;
    let index_view = null;

    if (static.sort_indices !== null && sort_index !== null) {
        const indices_view = new DataView(static.sort_indices);
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
                static.sort_indices,
                index_offset,
                next_index_offset - index_offset,
            );
        }
    }

    const result = [];

    if (index_view === null) {
        for (let i = 0; i < len; i++) {
            const card_idx = sort_asc ? i : (len - 1 - i);
            const card = static.cards[card_idx];

            if (matches_query(card, query, card_logger(card))) {
                result.push(card);
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

                if (card_idx >= static.cards.length) {
                    invalid_idx_count++;
                    continue;
                }

                const card = static.cards[card_idx];

                if (matches_query(card, query, card_logger(card))) {
                    result.push(card);
                }
            }
        }

        if (invalid_idx_count > 0) {
            logger.error(
                `Sort index ${sort_index} for order ${sort_order} contains ${invalid_idx_count} card indexes.`
            );
        }
    }

    logger.time_end('find_cards_matching_query');
    return result;
}

function matches_query(card, query, logger) {
    logger.log(`evaluating query with "${card.name}"`, card);

    try {
        return matches_condition(card, query, logger);
    } catch (e) {
        throw Error(`Couldn't evaluate query with "${card.name}".`, { cause: e });
    }
}

/** Returns true if any face of the card matches the condition. */
function matches_condition(card, condition, logger) {
    logger.group(condition.type, condition);

    let result;

    switch (condition.type) {
        case TYPE_TRUE: {
            result = true;
            break;
        }
        case TYPE_OR: {
            result = condition.conditions.length === 0;

            for (const cond of condition.conditions) {
                if (matches_condition(card, cond, logger)) {
                    result = true;
                    break;
                }
            }

            break;
        }
        case TYPE_AND: {
            result = condition.conditions.length > 0;

            for (const cond of condition.conditions) {
                if (!matches_condition(card, cond, logger)) {
                    result = false;
                    break;
                }
            }

            break;
        }
        case TYPE_NOT: {
            result = !matches_condition(card, condition.condition, logger);
            break;
        }
        default: {
            result = matches_comparison_condition(card, condition, logger);
            break;
        }
    }

    logger.log('result', result);
    logger.group_end();

    return result;
}

function matches_comparison_condition(card, condition, logger) {
    const values = card_prop_values(card, condition.prop);

    logger.log('values', values);

    if (condition.prop === PROP_COLOR
        || condition.prop === PROP_IDENTITY
        || condition.prop === PROP_MANA_COST
    ) {
        for (const value_str of values) {
            // TODO: Do this at load time.
            const [value] = parse_mana_cost(value_str);

            let result;

            switch (condition.type) {
                case TYPE_EQ:
                    result = mana_cost_eq(value, condition.value, logger);
                    break;
                case TYPE_NE:
                    result = !mana_cost_eq(value, condition.value, logger);
                    break;
                case TYPE_GT:
                    result = mana_cost_is_super_set(value, condition.value, true, logger);
                    break;
                case TYPE_LT:
                    result = mana_cost_is_super_set(condition.value, value, true, logger);
                    break;
                case TYPE_GE:
                    result = mana_cost_is_super_set(value, condition.value, false, logger);
                    break;
                case TYPE_LE:
                    result = mana_cost_is_super_set(condition.value, value, false, logger);
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
        let compare = null;

        switch (condition.prop) {
            case PROP_RARITY:
                compare = (a, b) => RARITY_RANK[a] - RARITY_RANK[b];
                break;
            default:
                compare = (a, b) => a - b;
                break;
        }

        for (const value of values) {
            let result;

            switch (condition.type) {
                case TYPE_EQ:
                    result = value === condition.value;
                    break;
                case TYPE_NE:
                    result = value !== condition.value;
                    break;
                case TYPE_GT:
                    result = compare(value, condition.value) > 0;
                    break;
                case TYPE_LT:
                    result = compare(value, condition.value) < 0;
                    break;
                case TYPE_GE:
                    result = compare(value, condition.value) >= 0;
                    break;
                case TYPE_LE:
                    result = compare(value, condition.value) <= 0;
                    break;
                case TYPE_EVEN:
                    result = value % 2 === 0;
                    break;
                case TYPE_ODD:
                    result = value % 2 !== 0;
                    break;
                case TYPE_SUBSTRING:
                    result = value.toLocaleLowerCase('en').includes(condition.value);
                    break;
                default:
                    throw Error(`Invalid condition type "${condition.type}".`);
            }

            if (result) {
                return true;
            }
        }
    }

    return false;
}

function card_scryfall_url(card) {
    return `https://scryfall.com/${card.sfuri}`
}

function card_image_url(card) {
    let img = null;

    if (card.img) {
        img = card.img;
    } else if (card.faces) {
        for (const face of card.faces) {
            if (face.img) {
                img = face.img;
                break;
            }
        }
    }

    if (img == null) {
        return null;
    }

    return `https://cards.scryfall.io/normal/${img}`;
}

/** Gets the value(s) of the given logical property of all faces of the given card. */
function card_prop_values(card, prop) {
    switch (prop) {
        case PROP_FORMAT:
            return card.formats;
        case PROP_IDENTITY:
            return [card.identity];
        case PROP_RARITY:
            return card.rarities;
    }

    const props = [];

    switch (prop) {
        case PROP_COLOR:
            props.push('colors');
            break;
        case PROP_NAME:
            props.push(prop);
            props.push('flavor_name');
            break;
        default:
            props.push(prop);
            break;
    }

    const values = [];

    if (card.faces) {
        for (let i = 0, len = card.faces.length; i < len; i++) {
            const face = card.faces[i];

            for (const prop of props) {
                const value = face[prop];

                // Ignore non-existent values. Also ignore empty mana costs of the backside of
                // transform cards.
                if (value === undefined
                    || (i >= 1 && prop === PROP_MANA_COST && value.length === 0)
                ) {
                    continue;
                }

                values.push(value);
            }
        }
    }

    if (values.length) {
        return values;
    }

    for (const prop of props) {
        const value = card[prop];

        if (value === undefined) {
            if (prop === 'flavor_name') {
                continue;
            }

            throw Error(`No property "${prop}" in the given card's faces or the card itself.`);
        }

        values.push(value);
    }

    return values;
}

function get_el(query) {
    const element = document.querySelector(query);

    if (element === null) {
        throw Error(`No element found for query "${query}".`);
    }

    return element;
}

function el(tagName) {
    return document.createElement(tagName);
}

function deep_eq(a, b) {
    if (a instanceof Set) {
        return b instanceof Set && a.size == b.size && a.isSubsetOf(b);
    } else {
        return a === b;
    }
}

function to_string(object) {
    return JSON.stringify(object, (_k, v) => {
        if (v instanceof Set) {
            return [...v];
        } else {
            return v;
        }
    });
}

function run_test_suite() {
    Console_Logger.time('run_test_suite');
    let executed = 0;
    let succeeded = 0;

    function test(name, f) {
        const logger = new Mem_Logger;
        let e = null;

        try {
            f(logger);
            succeeded++;
        } catch (ex) {
            e = ex;
        }

        executed++;

        if (e) {
            logger.log_to(Console_Logger);
            Console_Logger.error('FAILURE', name, e);
        } else {
            Console_Logger.info('SUCCESS', name);
        }
    }

    function test_query(name, query_string, expected_matches) {
        const MAX_MATCHES = 20;
        const expected = new Set(expected_matches);
        assert(expected.size <= MAX_MATCHES);

        test(`${name} (${query_string})`, logger => {
            const query = parse_query(query_string);
            const result = find_cards_matching_query(
                query,
                PROP_NAME,
                true,
                Nop_Logger,
                () => Nop_Logger,
            );

            const actual = new Set(result.map(c => c.name));

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

                find_cards_matching_query(
                    query,
                    PROP_NAME,
                    true,
                    logger,
                    c => (log_set.has(c.name) ? logger : Nop_Logger),
                );

                throw Error(`Expected to get ${expected.size} matches, got ${result.length}. Missing: ${to_string(missing_set)}, unexpected (showing max. 5): ${to_string([...unexpected_set].slice(0, 5))}.`);
            }
        });
    }

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

    if (executed === succeeded) {
        Console_Logger.info(`Ran ${executed} tests, all succeeded.`);
    } else {
        Console_Logger.info(`Ran ${executed} tests, ${executed - succeeded} failed.`);
        alert('Tests failed!');
    }

    Console_Logger.time_end('run_test_suite');
}

if (document.body) {
    init();
} else {
    window.addEventListener('DOMContentLoaded', init);
}

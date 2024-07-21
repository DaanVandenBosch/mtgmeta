if (document.body) {
    init();
} else {
    window.addEventListener('DOMContentLoaded', init);
}

const MAX_CARDS = 500;

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

const PROP_NAME = 'name';
const PROP_TYPE = 'type';
const PROP_CMC = 'cmc';
const PROP_MANA_COST = 'cost';
const PROPS = [PROP_NAME, PROP_TYPE, PROP_CMC, PROP_MANA_COST];

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
const MANA_WUBRG = [MANA_WHITE, MANA_BLUE, MANA_BLACK, MANA_RED, MANA_GREEN];

let cards = [];

async function init() {
    get_el('.filter').onkeydown = e => {
        if (e.key === 'Enter') {
            filter();
        }
    };

    await load_cards();

    if (window.location.hash.includes('tests')) {
        run_test_suite();
    }
}

function assert(condition, message) {
    if (!condition) {
        throw new Error(message ? message() : 'Assertion failed.');
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
};

const Console_Logger = {
    log(...args) { console.log(...args); },
    info(...args) { console.info(...args); },
    error(...args) { console.error(...args); },
    group(...args) { console.group(...args); },
    group_end(...args) { console.groupEnd(...args); },
};

class Mem_Logger {
    messages = [];

    log(...args) { this.message('log', ...args); }
    info(...args) { this.message('info', ...args); }
    error(...args) { this.message('error', ...args); }
    group(...args) { this.message('group', ...args); }
    group_end(...args) { this.message('group_end', ...args); }

    message(level, ...args) {
        this.messages.push({ level, args });
    }

    log_to(logger) {
        for (const message of this.messages) {
            logger[message.level](...message.args);
        }
    }
}

async function load_cards() {
    const response = await fetch('cards.json');
    cards = await response.json();

    for (const card of cards) {
        if (card.name === undefined) {
            card.name = (card.faces[0].name + ' // ' + card.faces[1].name);
        }
    }

    sort(PROP_NAME, true);
    filter();
}

function sort(prop, asc) {
    let sort_fn;

    switch (prop) {
        case PROP_NAME:
            sort_fn = (a, b) =>
                a.name.localeCompare(b.name, 'en', { ignorePunctuation: true });
            break;
        case PROP_CMC:
            sort_fn = (a, b) => a.cmc - b.cmc;
            break;
    }

    cards = cards.sort(asc ? sort_fn : (a, b) => -sort_fn(a, b));
}

function filter() {
    const query_string = get_el('.filter').value;
    const result = matching_cards(query_string, Nop_Logger, () => false);

    const frag = document.createDocumentFragment();

    for (const card of result.slice(0, MAX_CARDS)) {
        const a = el('a');
        a.href = card_scryfall_url(card);
        a.target = '_blank';

        const img = el('img');
        img.src = card_image_url(card);
        a.append(img);

        frag.append(a);
    }

    const summary_el = get_el('.result-summary');
    summary_el.innerHTML =
        `Showing ${Math.min(result.length, MAX_CARDS)} of ${result.length} matching cards.`;

    const cards_el = get_el('.cards');
    cards_el.innerHTML = '';
    cards_el.append(frag);
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
                case 'type':
                case 't':
                    result = this.parse_type_cond(operator);
                    break;

                case 'manavalue':
                case 'mv':
                case 'cmc':
                    result = this.parse_mana_value_cond(operator);
                    break;

                case 'mana':
                case 'm':
                    result = this.parse_mana_cost_cond(operator);
                    break;
            }
        }

        if (result) {
            return result;
        } else {
            this.pos = start_pos;
            return this.parse_name_cond();
        }
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

    parse_mana_value_cond(operator) {
        const value_string = this.parse_word().toLocaleLowerCase('en');

        if (operator === ':' || operator === '=') {
            if (value_string === 'even') {
                return {
                    type: TYPE_EVEN,
                    prop: PROP_CMC,
                };
            }

            if (value_string === 'odd') {
                return {
                    type: TYPE_ODD,
                    prop: PROP_CMC,
                };
            }
        }

        const value = parseInt(value_string, 10);

        if (isNaN(value)) {
            return null;
        }

        return {
            type: this.operator_to_type(operator, TYPE_EQ),
            prop: PROP_CMC,
            value,
        };
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

    parse_name_cond() {
        const value = this.parse_string().toLocaleLowerCase('en');

        return {
            type: TYPE_SUBSTRING,
            prop: PROP_NAME,
            value,
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
                throw new Error(`Unknown operator "${operator}".`);
        }
    }

    parse_regex(regex) {
        if (!regex.sticky) {
            throw new Error(`Regex "${regex.source}" should be sticky.`);
        }

        regex.lastIndex = this.pos;
        const m = regex.exec(this.query_string);

        if (m === null) {
            return null;
        }

        this.pos += m[0].length;
        return m[0];
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
        let generic = parseInt(symbol_or_generic);

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
        let generic = parseInt(symbol_or_generic);

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
    // Hybrid: {W/U}, {W/B}, {U/B}, {U/R}, {B/R}, {B/G}, {R/W}, {R/G}, {G/W}, {G/U}
    // Monocolored hybrid: {2/W}
    // Colorless hybrid: {C/W}, {C/U}, {C/B}, {C/R}, {C/G}
    // Phyrexian: {W/P}, {U/P}, {B/P}, {R/P}, {G/P}
    // Phyrexian hybrid:
    //  {W/U/P}, {W/B/P}, {U/B/P}, {U/R/P}, {B/R/P}, {B/G/P}, {R/W/P}, {R/G/P}, {G/W/P}, {G/U/P}

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

function mana_cost_gt(a, b, or_equal, logger) {
    a = { ...a };
    b = { ...b };
    let a_symbols = Object.keys(a).length;
    let b_symbols = Object.keys(b).length;

    // If only one has a generic cost, ensure the other has a generic cost too. This makes queries
    // like mana<{R} return 0 cost cards.
    const a_has_generic = MANA_GENERIC in a;
    const b_has_generic = MANA_GENERIC in b;

    if (a_has_generic !== b_has_generic) {
        // Set generic to -1 if cost is null, to ensure null cost is less than zero cost. Otherwise
        // set to 0 to ensure any non-null cost is greater than null cost.
        if (!a_has_generic) {
            a[MANA_GENERIC] = a_symbols === 0 ? -1 : 0;
            a_symbols += 1;
        } else {
            b[MANA_GENERIC] = b_symbols === 0 ? -1 : 0;
            b_symbols += 1;
        }
    }

    if (a_symbols < b_symbols) {
        logger.log(`a has fewer symbols than b.`, a, b);
        return false;
    }

    let a_total = 0;
    let b_total = 0;

    for (const [symbol, b_count] of Object.entries(b)) {
        let a_count = a[symbol];

        if (a_count === undefined || a_count < b_count) {
            if (a_count === undefined) {
                logger.log(`No symbol ${symbol} in a.`, a, b);
            } else {
                logger.log(`Symbol ${symbol} value ${a_count} < ${b_count}.`, a, b);
            }

            return false;
        }

        a_total += a_count;
        b_total += b_count;
    }

    if (or_equal) {
        return true;
    }

    const result = a_total > b_total || a_symbols > b_symbols;

    if (!result) {
        logger.log(`a doesn't have more symbols than b.`, a, b);
    }

    return result;
}

function matching_cards(query_string, logger, log_card) {
    const query = new Query_Parser().parse(query_string);
    logger.log('query', query);
    return cards.filter(card => matches_query(card, query, log_card(card) ? logger : Nop_Logger));
}

function matches_query(card, query, logger) {
    logger.info(`evaluating query with "${card.name}"`, card);

    return matches_condition(card, query, logger);
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

    if (condition.prop === PROP_MANA_COST) {
        for (const value_str of values) {
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
                    result = mana_cost_gt(value, condition.value, false, logger);
                    break;
                case TYPE_LT:
                    result = mana_cost_gt(condition.value, value, false, logger);
                    break;
                case TYPE_GE:
                    result = mana_cost_gt(value, condition.value, true, logger);
                    break;
                case TYPE_LE:
                    result = mana_cost_gt(condition.value, value, true, logger);
                    break;
                default:
                    throw new Error(
                        `Invalid condition type "${condition.type}" for property "${condition.prop}".`
                    );
            }

            if (result) {
                return true;
            }
        }
    } else {
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
                    result = value > condition.value;
                    break;
                case TYPE_LT:
                    result = value < condition.value;
                    break;
                case TYPE_GE:
                    result = value >= condition.value;
                    break;
                case TYPE_LE:
                    result = value <= condition.value;
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
                    throw new Error(`Invalid condition type "${condition.type}".`);
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

/** Gets the value of the given property of all faces of the given card. */
function card_prop_values(card, prop) {
    const props = [prop];

    if (prop == PROP_NAME) {
        props.push('flavor_name');
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
    return document.querySelector(query);
}

function el(tagName) {
    return document.createElement(tagName);
}

function deep_eq(a, b) {
    if (a instanceof Set) {
        if (!(b instanceof Set)) {
            return false;
        }

        return a.size == b.size && a.isSubsetOf(b);
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

    function test_query(name, query, expected_matches) {
        test(`${name} (${query})`, logger => {
            const expected = new Set(expected_matches);
            const cards = matching_cards(query, logger, c => expected.has(c.name)).map(c => c.name);
            assert_eq(new Set(cards), expected);
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

    if (executed === succeeded) {
        Console_Logger.info(`Ran ${executed} tests, all succeeded.`);
    } else {
        Console_Logger.info(`Ran ${executed} tests, ${executed - succeeded} failed.`);
        alert('Tests failed!');
    }
}

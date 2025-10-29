import { assert, unreachable, string_to_int, type Mutable } from './core';
import {
    type Query,
    type Prop,
    type Condition,
    type Comparison_Condition,
    type Mana_Cost,
    type Predicate_Condition,
    type Substring_Condition,
    type Subset_Condition,
    type Subset,
    MANA_WHITE,
    MANA_BLUE,
    MANA_BLACK,
    MANA_RED,
    MANA_GREEN,
    MANA_COLORLESS,
    MANA_GENERIC,
    MANA_GENERIC_X,
    MANA_SNOW,
    MANA_PHYREXIAN,
    MANA_WUBRG,
    RARITY_COMMON,
    RARITY_UNCOMMON,
    RARITY_RARE,
    RARITY_MYTHIC,
    RARITY_SPECIAL,
    RARITY_BONUS,
    INEXACT_REGEX,
    TRUE_CONDITION,
    FALSE_CONDITION,
} from './query';
const freeze = Object.freeze;

type Operator = ':' | '=' | '!=' | '<' | '>' | '<=' | '>=';

export function parse_query(
    name_to_subset: ReadonlyMap<string, Subset>,
    query_string: string,
): Query {
    return new Query_Parser().parse(name_to_subset, query_string);
}

class Query_Parser {
    private name_to_subset!: ReadonlyMap<string, Subset>;
    private query_string!: string;
    private pos!: number;
    private props!: Set<Prop>;

    parse(name_to_subset: ReadonlyMap<string, Subset>, query_string: string): Query {
        this.name_to_subset = name_to_subset;
        this.query_string = query_string;
        this.pos = 0;
        this.props = new Set();

        let condition: Condition | false | null = this.parse_disjunction();

        if (condition === false || this.chars_left()) {
            condition = FALSE_CONDITION;
        } else if (condition === null) {
            condition = TRUE_CONDITION;
        }

        return freeze({
            props: freeze([...this.props]),
            condition,
        });
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

        return freeze({
            type: 'or',
            conditions: freeze(conditions),
        });
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

        return freeze({
            type: 'and',
            conditions: freeze(conditions),
        });
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
        let result: Condition | null = null;

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
                result = this.parse_substring_cond(operator, 'oracle_search');
                break;

            case 'fulloracle':
            case 'fo':
                result = this.parse_substring_cond(operator, 'full_oracle_search');
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

            case 'subset':
            case 'ss':
                result = this.parse_subset_cond(operator);
                break;

            case 'type':
            case 't':
                result = this.parse_substring_cond(operator, 'type_search');
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

        return freeze({
            type: 'not',
            condition,
        });
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
        let value: Mutable<Mana_Cost> | null = null;

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
            value: freeze(value),
        });
    }

    private parse_date_cond(operator: Operator): Condition | null {
        const start_pos = 0;
        const match = this.parse_regex(/(\d{4})(-(\d{2})(-(\d{2}))?)?/y);

        if (match === null) {
            return null;
        }

        const [_ignore0, year_str, _ignore1, month_group, _ignore2, day_group] = match;
        const year = string_to_int(year_str) as number;
        const month = string_to_int(month_group);
        const day = string_to_int(day_group);
        const cond = this.create_released_at_cond(operator, year, month, day);

        if (cond === null) {
            this.pos = start_pos;
        }

        return cond;
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
                return freeze({
                    type: 'eq',
                    prop,
                    value,
                });

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

    private parse_mana_value_cond(
        operator: Operator,
    ): Comparison_Condition | Predicate_Condition | null {
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
                return TRUE_CONDITION;
            }

            if (conditions.length === 1) {
                return conditions[0];
            }

            return freeze({
                type: 'and',
                conditions: freeze(conditions),
            });
        }
    }

    private parse_substring_cond(operator: Operator, prop: Prop): Substring_Condition | null {
        if (operator !== ':' && operator !== '=') {
            return null;
        }

        const { value } = this.parse_string();

        if (value.length === 0) {
            return null;
        }

        return this.add_prop({
            type: 'substring',
            prop,
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

    private parse_subset_cond(operator: Operator): Subset_Condition | null {
        if (operator !== ':' && operator !== '=') {
            return null;
        }

        const { value } = this.parse_string();

        if (value.length === 0) {
            return null;
        }

        const subset = this.name_to_subset.get(value);

        if (subset === undefined) {
            return null;
        }

        for (const prop of subset.query.props) {
            this.props.add(prop);
        }

        return freeze({
            type: 'subset',
            id: subset.id,
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

    private parse_year_cond(operator: Operator): Condition | null {
        const start_pos = 0;
        const year = string_to_int(this.parse_word());

        if (year === null) {
            return null;
        }

        const cond = this.create_released_at_cond(operator, year, null, null);

        if (cond === null) {
            this.pos = start_pos;
        }

        return cond;
    }

    private parse_string(): { value: string, quoted: boolean } {
        switch (this.char()) {
            case '"':
            case "'": {
                const end = this.query_string.indexOf(this.char(), this.pos + 1);

                if (end !== -1) {
                    const start_pos = this.pos + 1;
                    this.pos = end + 1;
                    return {
                        value: this.query_string.slice(start_pos, this.pos - 1),
                        quoted: true,
                    };
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
        return freeze(cond);
    }

    private create_released_at_cond(
        operator: Operator,
        year: number,
        month: number | null,
        day: number | null,
    ): Condition | null {
        if (year <= 99) {
            // Date.UTC would map this to 1900-1999.
            return null;
        }

        if (month !== null && (month < 1 || month > 12)) {
            return null;
        }

        const type = this.operator_to_type(operator, 'eq');

        if (day !== null) {
            // Complete date, use as-is.
            assert(month !== null);

            const date = new Date(Date.UTC(year, month - 1, day));

            if (date.getUTCFullYear() !== year
                || date.getUTCMonth() !== month - 1
                || date.getUTCDate() !== day
            ) {
                return null;
            }

            return this.add_prop({
                type,
                prop: 'released_at',
                value: date,
            });
        }

        // Incomplete date, interpret depending on the type.
        if (type === 'eq' || type === 'ne') {
            const start = this.create_date_from_partial(year, month, true);
            const end = this.create_date_from_partial(year, month, false);
            const condition = this.add_prop({
                type: 'range',
                prop: 'released_at',
                start,
                start_inc: true,
                end,
                end_inc: true,
            });

            if (type === 'ne') {
                return freeze({ type: 'not', condition });
            }

            return condition;
        }

        const value = this.create_date_from_partial(year, month, type !== 'gt' && type !== 'le');
        return this.add_prop({
            type,
            prop: 'released_at',
            value,
        });
    }

    /**
     * @param start Whether the created date should be at the start or the end of the range
     *              specified by year and month.
     */
    private create_date_from_partial(
        year: number,
        month: number | null,
        start: boolean,
    ): Date {
        month = month ?? (start ? 1 : 12);
        const date = new Date(Date.UTC(year, month - 1, 1));

        if (!start) {
            date.setUTCMonth(date.getUTCMonth() + 1);
            date.setUTCDate(0);
        }

        return date;
    }
}

export function parse_mana_cost(input: string, start = 0): { cost: Mana_Cost, len: number } {
    let pos = start;
    const cost: Mutable<Mana_Cost> = {};

    for (; ;) {
        const result = parse_mana_symbol(input, pos);

        if (result === null) {
            break;
        }

        const { symbol, generic, len } = result;
        cost[symbol] = (cost[symbol] ?? 0) + (generic ?? 1);
        pos += len;
    }

    return { cost: freeze(cost), len: pos - start };
}

function parse_mana_symbol(
    input: string,
    start: number,
): { readonly symbol: string, readonly generic: number | null, readonly len: number } | null {
    let pos = start;
    const initial_regex = /([WUBRGCXS]|\d+)/iy;
    initial_regex.lastIndex = pos;
    const initial_match = initial_regex.exec(input);

    if (initial_match !== null) {
        const symbol_or_generic = initial_match[0].toLocaleUpperCase('en');
        const generic = string_to_int(symbol_or_generic);
        const symbol = generic === null ? symbol_or_generic : MANA_GENERIC;
        return freeze({ symbol, generic, len: initial_match[0].length });
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

    return freeze({ symbol: str, generic, len: pos - start });
}

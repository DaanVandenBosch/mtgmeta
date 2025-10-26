export function assert(condition: boolean, message?: () => string): asserts condition {
    if (!condition) {
        throw Error(message ? message() : 'Assertion failed.');
    }
}

export function assert_eq<T>(actual: T, expected: T) {
    assert(
        deep_eq(actual, expected),
        () => `Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}.`,
    );
}

export function assert_nonnullish<T>(actual: T | undefined | null): T {
    assert_nonnullish_helper(actual);
    return actual;
}

/** Need this helper, because we can't have a return type and an asserts clause at the same time. */
function assert_nonnullish_helper<T>(
    actual: T | undefined | null,
): asserts actual is T extends undefined | null ? never : T {
    assert(
        actual != null,
        () => `Expected nonnullish value but got ${actual}.`,
    );
}

export function unreachable(message?: string): never {
    throw Error(message ?? `Should never reach this code.`);
}

export function deep_eq<T>(a: T, b: T): boolean {
    if (a instanceof Set) {
        return b instanceof Set && a.size === b.size && a.isSubsetOf(b);
    } else if (Array.isArray(a) || (typeof a === 'object' && a !== null)) {
        throw Error(`Type of ${a} is unsupported.`);
    } else {
        return a === b;
    }
}

/** Counts the number of bits set in a 32-bit integer. */
export function pop_count_32(n: number): number {
    n = n - ((n >>> 1) & 0x55555555);
    n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
    return ((n + (n >>> 4) & 0xF0F0F0F) * 0x1010101) >>> 24;
}

export function string_to_int(s: string): number | null {
    if (!/^-?\d+$/.test(s)) {
        return null;
    }

    return parseInt(s, 10);
}

export interface Logger {
    should_log: boolean;

    log(...args: any[]): void;
    info(...args: any[]): void;
    error(...args: any[]): void;
    group(...args: any[]): void;
    group_end(): void;
    time(label?: string): void;
    time_end(label?: string): void;
}

export const Nop_Logger: Logger = {
    should_log: false,

    log() { },
    info() { },
    error() { },
    group() { },
    group_end() { },
    time() { },
    time_end() { },
};

export const Console_Logger: Logger = {
    should_log: true,

    log(...args: any[]) { console.log(...args); },
    info(...args: any[]) { console.info(...args); },
    error(...args: any[]) { console.error(...args); },
    group(...args: any[]) { console.group(...args); },
    group_end() { console.groupEnd(); },
    time(label?: string) { console.time(label); },
    time_end(label?: string) { console.timeEnd(label); },
};

export class Mem_Logger implements Logger {
    private messages: { level: keyof Logger, args: any[] }[] = [];

    should_log = true;

    log(...args: any[]) { this.message('log', ...args); }
    info(...args: any[]) { this.message('info', ...args); }
    error(...args: any[]) { this.message('error', ...args); }
    group(...args: any[]) { this.message('group', ...args); }
    group_end() { this.message('group_end'); }
    time(label?: string) { this.message('time', ...(label === undefined ? [] : [label])); }
    time_end(label?: string) { this.message('time_end', ...(label === undefined ? [] : [label])); }

    private message(level: keyof Logger, ...args: any[]) {
        this.messages.push({ level, args });
    }

    log_to(logger: Logger) {
        for (const message of this.messages) {
            (logger[message.level] as (...args: any[]) => void)(...message.args);
        }
    }
}

export function create_el<E extends HTMLElement>(tagName: string): E {
    return document.createElement(tagName) as E;
}

export function get_el<E extends Element>(parent: ParentNode, query: string): E {
    const element = parent.querySelector(query);

    if (element === null) {
        throw Error(`No element found for query "${query}".`);
    }

    return element as E;
}

export function to_string(object: any) {
    return JSON.stringify(object, (_k, v) => {
        if (v instanceof Set) {
            return [...v];
        } else {
            return v;
        }
    });
}

export function time_to_string(time: number): string {
    const m = Math.floor(time / 60_000);
    const s = Math.floor(time / 1_000) - m * 60;
    const ms = time - s * 1000 - m * 60_000;
    const m_str = m.toString().padStart(2, '0');
    const s_str = s.toString().padStart(2, '0');
    const ms_str = ms.toString().padStart(3, '0');
    return `${m_str}:${s_str}.${ms_str}`;
}

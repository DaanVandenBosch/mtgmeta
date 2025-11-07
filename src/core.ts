const freeze = Object.freeze;

export type Mutable<T> = { -readonly [K in keyof T]: T[K] };

export const EMPTY_MAP: ReadonlyMap<never, never> = freeze(new Map<never, never>);

export const TEXT_ENCODER = new TextEncoder;
export const TEXT_DECODER = new TextDecoder;

export function assert(condition: boolean, message?: () => string): asserts condition {
    if (!condition) {
        throw Error(message ? message() : 'Assertion failed.');
    }
}

export function assert_eq<T>(actual: T, expected: T) {
    assert(
        actual === expected,
        () => `Expected ${JSON.stringify(expected)} but got ${JSON.stringify(actual)}.`,
    );
}

export function unreachable(message?: string): never {
    throw Error(message ?? `Should never reach this code.`);
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

export function index_of<T>(array_like: ArrayLike<T>, search_item: T, from_index?: number): number {
    return Array.prototype.indexOf.call(array_like, search_item, from_index);
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

export function get_params(): URLSearchParams {
    return new URLSearchParams(globalThis.location.search);
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

export function key_combo(e: KeyboardEvent): string {
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

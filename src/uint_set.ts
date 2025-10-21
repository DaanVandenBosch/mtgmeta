import { pop_count_32 } from "./core.js";

const memory = new ArrayBuffer(256 * 1024);

/** Set optimized for unsigned integers. */
export interface Uint_Set {
    size: number;

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

export class Bitset implements Uint_Set {
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

    copy(): Bitset {
        const new_set = new Bitset(this.cap, this.m_end - this.m_off);
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

export class Bitset_32 implements Uint_Set {
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
        this.values = cap === 32 ? 0xFFFFFFFF : (1 << cap) - 1;
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

export class Array_Set implements Uint_Set {
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

import { pop_count_32 } from "./core";

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
    static with_cap(cap: number): Bitset {
        return new Bitset(new Uint32Array((cap + 31) >>> 5), cap);
    }

    data: Uint32Array;
    cap: number;
    size: number;

    constructor(data: Uint32Array, cap: number) {
        this.data = data;
        this.cap = cap;
        this.size = 0;
    }

    copy(): Bitset {
        const new_set = new Bitset(new Uint32Array(this.data), this.cap);
        new_set.size = this.size;
        return new_set;
    }

    copy_into(other: Bitset) {
        if (this.cap !== other.cap) {
            throw Error(`Capacities ${this.cap} and ${other.cap} don't match.`);
        }

        other.data.set(this.data);
        other.size = this.size;
    }

    has(value: number): boolean {
        const slot_offset = value >>> 5;
        const slot = this.data[slot_offset];
        const bit_mask = 1 << (value & 0b11111);
        return (slot & bit_mask) !== 0;
    }

    first_or_null(): number | null {
        if (this.size === 0) {
            return null;
        }

        const data = this.data;
        const len = data.length;

        for (let i = 0; i < len; i++) {
            const slot = data[i];

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

        const data = this.data;
        const slot_offset = value >>> 5;
        const slot = data[slot_offset];
        const bit_mask = 1 << (value & 0b11111);
        const new_slot = slot | bit_mask;
        data[slot_offset] = new_slot;

        if (new_slot !== slot) {
            this.size += 1;
        }
    }

    fill() {
        const data = this.data;
        const cap = this.cap;
        const len = data.length;
        data.fill(0xFFFFFFFF, 0, len - 1);
        data[len - 1] = (1 << (cap & 0b11111)) - 1;
        this.size = cap;
    }

    delete(value: number) {
        if (value < 0 || value >= this.cap) {
            throw Error(`Value ${value} out of bounds for capacity ${this.cap}.`);
        }

        const data = this.data;
        const slot_offset = value >>> 5;
        const slot = data[slot_offset];
        const bit_mask = 1 << (value & 0b11111);
        const new_slot = slot & ~bit_mask;
        data[slot_offset] = new_slot;

        if (new_slot !== slot) {
            this.size -= 1;
        }
    }

    clear() {
        this.data.fill(0);
        this.size = 0;
    }

    invert() {
        const data = this.data;
        const len = data.length;
        const cap = this.cap;

        for (let i = 0; i < len - 1; i++) {
            data[i] = ~data[i];
        }

        data[len - 1] = ~data[len - 1] & ((1 << (cap & 0b11111)) - 1);
        this.size = cap - this.size;
    }

    union(other: Bitset) {
        if (this.cap !== other.cap) {
            throw Error(`Capacities ${this.cap} and ${other.cap} don't match.`);
        }

        const data = this.data;
        const len = data.length;
        const other_data = other.data;
        let size = 0;

        for (let i = 0; i < len; i++) {
            let slot = data[i];
            slot |= other_data[i];
            size += pop_count_32(slot);
            data[i] = slot;
        }

        this.size = size;
    }

    diff(other: Bitset) {
        if (this.cap !== other.cap) {
            throw Error(`Capacities ${this.cap} and ${other.cap} don't match.`);
        }

        const data = this.data;
        const len = data.length;
        const other_data = other.data;
        let size = 0;

        for (let i = 0; i < len; i++) {
            let slot = data[i];
            slot &= ~other_data[i];
            size += pop_count_32(slot);
            data[i] = slot;
        }

        this.size = size;
    }

    to_array(): number[] {
        const data = this.data;
        const len = data.length;
        const array = [];

        for (let i = 0; i < len; i++) {
            const slot = data[i];

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
    static with_cap(cap: number): Array_Set {
        return new Array_Set(new Uint16Array(cap));
    }

    data: Uint16Array;
    size: number;

    constructor(data: Uint16Array) {
        this.data = data;
        this.size = 0;
    }

    copy(): Array_Set {
        const new_set = new Array_Set(new Uint16Array(this.data));
        new_set.size = this.size;
        return new_set;
    }

    copy_into(other: Array_Set) {
        const data = this.data;
        const other_data = other.data;

        if (data.length !== other_data.length) {
            throw Error(`Capacities ${data.length} and ${other_data.length} don't match.`);
        }

        const size = this.size;
        other_data.set(data.subarray(0, size));
        other.size = size;
    }

    has(value: number): boolean {
        const data = this.data;
        const size = this.size;

        for (let i = 0; i < size; i++) {
            const v = data[i];

            if (v === value) {
                return true;
            } else if (v > value) {
                return false;
            }
        }

        return false;
    }

    at(idx: number): number {
        return this.data[idx];
    }

    first_or_null(): number | null {
        if (this.size === 0) {
            return null;
        }

        return this.data[0];
    }

    insert(value: number) {
        const data = this.data;
        const size = this.size;

        if (size >= data.length) {
            throw Error(`Capacity reached.`);
        }

        for (let i = 0; i < size; i++) {
            const v = data[i];

            if (v === value) {
                return;
            } else if (v > value) {
                data.copyWithin(i + 1, i, size);
                data[i] = value;
                this.size = size + 1;
                return;
            }
        }

        data[size] = value;
        this.size = size + 1;
    }

    insert_unchecked(value: number) {
        const data = this.data;
        const size = this.size;

        if (size >= data.length) {
            throw Error(`Capacity reached.`);
        }

        data[size] = value;
        this.size = size + 1;
    }

    fill() {
        const data = this.data;
        const len = data.length;

        for (let value = 0; value < len; value++) {
            data[value] = value;
        }

        this.size = len;
    }

    delete(value: number) {
        const data = this.data;
        const size = this.size;

        for (let i = 0; i < size; i++) {
            const v = data[i];

            if (v === value) {
                data.copyWithin(i, i + 1, size);
                this.size = size - 1;
                return;
            } else if (v > value) {
                // Value not in the set.
                return;
            }
        }
    }

    delete_at(idx: number) {
        const data = this.data;
        const size = this.size;
        data.copyWithin(idx, idx + 1, size);
        this.size = size - 1;
    }

    clear() {
        this.size = 0;
    }

    union(other: Array_Set) {
        const data = this.data;
        let size = this.size;
        const other_data = other.data;
        const other_size = other.size;
        let i = 0;

        outer: for (let j = 0; j < other_size; j++) {
            const other_value = other_data[j];

            for (; ;) {
                if (i >= size) {
                    data.set(other_data.subarray(j, other_size), i);
                    size += other_size - j;
                    break outer;
                }

                const value = data[i];

                if (other_value === value) {
                    i++;
                    break;
                } else if (other_value < value) {
                    data.copyWithin(i + 1, i, size);
                    data[i] = other_value;
                    size++;
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
        const data = this.data;
        let size = this.size;
        const other_data = other.data;
        let i = size - 1;

        outer: for (let j = other.size - 1; j >= 0; j--) {
            const other_value = other_data[j];

            for (; ;) {
                if (i < 0) {
                    break outer;
                }

                const value = data[i];

                if (other_value === value) {
                    data.copyWithin(i, i + 1, size);
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
        const data = this.data;
        const size = this.size;
        const array = [];

        for (let i = 0; i < size; i++) {
            array.push(data[i]);
        }

        return array;
    }
}

import { assert, TEXT_ENCODER } from "./core";

export class Buffer {
    readonly #buf: ArrayBuffer;
    readonly #view: DataView;
    #pos = 0;

    private constructor(buf: ArrayBuffer, view: DataView) {
        this.#buf = buf;
        this.#view = view;
    }

    static of_size(size: number): Buffer {
        const buf = new ArrayBuffer(size);
        return new Buffer(buf, new DataView(buf));
    }

    /** The view should wrap the entire array buffer. */
    static of_array_buffer(buf: ArrayBuffer, view: DataView): Buffer {
        return new Buffer(buf, view);
    }

    get pos(): number {
        return this.#pos;
    }

    get space(): number {
        return this.#buf.byteLength - this.#pos;
    }

    copy(): ArrayBuffer {
        return this.#buf.slice(0, this.#pos);
    }

    write_u8(value: number): void {
        this.check_space(1);
        this.#view.setUint8(this.#pos, value);
        this.#pos++;
    }

    write_u16(value: number): void {
        this.check_space(2);
        this.#view.setUint16(this.#pos, value, true);
        this.#pos += 2;
    }

    write_u32(value: number): void {
        this.check_space(4);
        this.#view.setUint32(this.#pos, value, true);
        this.#pos += 4;
    }

    write_u64(value: bigint): void {
        this.check_space(8);
        this.#view.setBigUint64(this.#pos, value, true);
        this.#pos += 8;
    }

    write_i32(value: number): void {
        this.check_space(4);
        this.#view.setInt32(this.#pos, value, true);
        this.#pos += 4;
    }

    write_f64(value: number): void {
        this.check_space(8);
        this.#view.setFloat64(this.#pos, value, true);
        this.#pos += 8;
    }

    write_utf8(value: string): void {
        const { written } =
            TEXT_ENCODER.encodeInto(value, new Uint8Array(this.#buf, this.#pos, this.space));
        this.#pos += written;
    }

    /** Write a fixed-length UTF-8 string, padding with zero bytes if necessary. */
    write_utf8_fixed(value: string, size: number): void {
        this.check_space(size);
        const u8s = new Uint8Array(this.#buf, this.#pos, size);
        const { written } = TEXT_ENCODER.encodeInto(value, u8s);

        for (let i = written; i < size; i++) {
            u8s[i] = 0;
        }

        this.#pos += size;
    }

    set_u32(offset: number, value: number) {
        this.check(offset, 4);
        this.#view.setUint32(offset, value, true);
    }

    private check_space(space: number): void {
        assert(
            space <= this.space,
            () => `Not enough space left for object of size ${space}.`,
        );
    }

    private check(offset: number, size: number) {
        assert(
            offset + size <= this.#pos,
            () => `Offset ${offset} with size ${size} is out of bounds.`,
        );
    }
}

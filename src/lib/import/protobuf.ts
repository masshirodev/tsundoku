/**
 * Just enough protobuf to read a Mihon backup, with no schema compiler and no
 * dependency: a message is a list of (field number, value) pairs, and the
 * caller knows which numbers it wants (see mihon-backup.ts for the schema).
 *
 * Varints come back as bigint because Mihon's source ids are full 64-bit
 * values that don't survive a JavaScript number. `num()` narrows the ones
 * that are known to be small (flags, timestamps, counts).
 */

export type Field =
	| { no: number; wire: 0; value: bigint }
	| { no: number; wire: 1; value: Uint8Array }
	| { no: number; wire: 2; value: Uint8Array }
	| { no: number; wire: 5; value: Uint8Array };

export class ProtobufError extends Error {}

function varint(buf: Uint8Array, at: number): [bigint, number] {
	let result = 0n;
	let shift = 0n;
	for (let i = at; i < buf.length; i++) {
		const byte = buf[i];
		result |= BigInt(byte & 0x7f) << shift;
		if (byte < 0x80) return [result, i + 1];
		shift += 7n;
		if (shift > 63n) throw new ProtobufError('varint too long');
	}
	throw new ProtobufError('truncated varint');
}

/** Every field of one message, in wire order. Repeated fields repeat. */
export function readMessage(buf: Uint8Array): Field[] {
	const out: Field[] = [];
	let at = 0;
	while (at < buf.length) {
		const [key, next] = varint(buf, at);
		at = next;
		const no = Number(key >> 3n);
		const wire = Number(key & 7n);
		if (wire === 0) {
			const [value, n] = varint(buf, at);
			at = n;
			out.push({ no, wire, value });
		} else if (wire === 1 || wire === 5) {
			const size = wire === 1 ? 8 : 4;
			if (at + size > buf.length) throw new ProtobufError('truncated fixed field');
			out.push({ no, wire, value: buf.subarray(at, at + size) });
			at += size;
		} else if (wire === 2) {
			const [len, n] = varint(buf, at);
			const end = n + Number(len);
			if (end > buf.length) throw new ProtobufError('truncated length-delimited field');
			out.push({ no, wire, value: buf.subarray(n, end) });
			at = end;
		} else {
			throw new ProtobufError(`unsupported wire type ${wire}`);
		}
	}
	return out;
}

const decoder = new TextDecoder('utf-8');

type Bytes = Extract<Field, { wire: 2 }>;
const bytesOf =
	(no: number) =>
	(f: Field): f is Bytes =>
		f.no === no && f.wire === 2;

/** Typed reads over one decoded message. Absent fields give the proto3 default. */
export class Message {
	readonly fields: Field[];
	constructor(buf: Uint8Array) {
		this.fields = readMessage(buf);
	}
	private first(no: number): Field | undefined {
		return this.fields.find((f) => f.no === no);
	}
	has(no: number): boolean {
		return this.first(no) !== undefined;
	}
	big(no: number, fallback = 0n): bigint {
		const f = this.first(no);
		return f?.wire === 0 ? f.value : fallback;
	}
	num(no: number, fallback = 0): number {
		const f = this.first(no);
		return f?.wire === 0 ? Number(f.value) : fallback;
	}
	bool(no: number, fallback = false): boolean {
		const f = this.first(no);
		return f?.wire === 0 ? f.value !== 0n : fallback;
	}
	/**
	 * A 32-bit float, at the precision it actually has. 2.1 can't be stored
	 * exactly in 32 bits; read back as a double it is 2.0999999046325684, which
	 * is what reached the chapter list. Seven significant digits is all a
	 * float32 holds, so rounding to them gives back the number that was meant.
	 */
	float(no: number, fallback = 0): number {
		const f = this.first(no);
		if (f?.wire !== 5) return fallback;
		const raw = new DataView(f.value.buffer, f.value.byteOffset, 4).getFloat32(0, true);
		return Number.isFinite(raw) ? Number(raw.toPrecision(7)) : raw;
	}
	str(no: number, fallback = ''): string {
		const f = this.first(no);
		return f?.wire === 2 ? decoder.decode(f.value) : fallback;
	}
	strs(no: number): string[] {
		return this.fields.filter(bytesOf(no)).map((f) => decoder.decode(f.value));
	}
	/** Repeated varints, packed or not. */
	nums(no: number): number[] {
		const out: number[] = [];
		for (const f of this.fields) {
			if (f.no !== no) continue;
			if (f.wire === 0) out.push(Number(f.value));
			else if (f.wire === 2) {
				let at = 0;
				while (at < f.value.length) {
					const [v, n] = varint(f.value, at);
					out.push(Number(v));
					at = n;
				}
			}
		}
		return out;
	}
	messages(no: number): Message[] {
		return this.fields.filter(bytesOf(no)).map((f) => new Message(f.value));
	}
}

// ---- writing ---------------------------------------------------------------------------

/**
 * A message to encode, the reader's mirror: (field number, value) pairs, in
 * order. Integers and booleans are varints, `{ f32 }` a 32-bit float, strings
 * and bytes length-delimited, and a nested list a nested message.
 */
export type EncodeValue = bigint | number | string | boolean | Uint8Array | { f32: number } | Msg;
export type Msg = [number, EncodeValue][];

const encoder = new TextEncoder();

function varintBytes(n: bigint): Uint8Array {
	const out: number[] = [];
	let v = BigInt.asUintN(64, n);
	while (v >= 0x80n) {
		out.push(Number((v & 0x7fn) | 0x80n));
		v >>= 7n;
	}
	out.push(Number(v));
	return Uint8Array.from(out);
}

/**
 * Encodes [msg]. Built from chunks joined once, never by spreading a
 * payload into an array: a backup's message for thousands of chapters runs
 * past the number of arguments a call can take.
 */
export function encode(msg: Msg): Uint8Array {
	const chunks: Uint8Array[] = [];
	for (const [no, value] of msg) {
		if (typeof value === 'bigint' || typeof value === 'number' || typeof value === 'boolean') {
			chunks.push(varintBytes(BigInt(no << 3)), varintBytes(BigInt(value)));
		} else if (typeof value === 'object' && !(value instanceof Uint8Array) && 'f32' in value) {
			const b = new Uint8Array(4);
			new DataView(b.buffer).setFloat32(0, value.f32, true);
			chunks.push(varintBytes(BigInt((no << 3) | 5)), b);
		} else {
			const payload =
				typeof value === 'string'
					? encoder.encode(value)
					: value instanceof Uint8Array
						? value
						: encode(value);
			chunks.push(varintBytes(BigInt((no << 3) | 2)), varintBytes(BigInt(payload.length)), payload);
		}
	}
	const out = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0));
	let at = 0;
	for (const c of chunks) {
		out.set(c, at);
		at += c.length;
	}
	return out;
}

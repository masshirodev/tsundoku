/**
 * The inverse of src/lib/import/protobuf.ts, for synthesising Mihon backups
 * in tests. Real backups hold the owner's library and stay off the repo.
 */
type Value = bigint | number | string | boolean | Uint8Array | { f32: number } | Msg;
export type Msg = [number, Value][];

function varint(n: bigint): number[] {
	const out: number[] = [];
	let v = BigInt.asUintN(64, n);
	while (v >= 0x80n) {
		out.push(Number((v & 0x7fn) | 0x80n));
		v >>= 7n;
	}
	out.push(Number(v));
	return out;
}

export function encode(msg: Msg): Uint8Array {
	const bytes: number[] = [];
	for (const [no, value] of msg) {
		if (typeof value === 'bigint' || typeof value === 'number' || typeof value === 'boolean') {
			bytes.push(...varint(BigInt(no << 3)), ...varint(BigInt(value)));
		} else if (typeof value === 'object' && 'f32' in value) {
			const b = new Uint8Array(4);
			new DataView(b.buffer).setFloat32(0, value.f32, true);
			bytes.push(...varint(BigInt((no << 3) | 5)), ...b);
		} else {
			const payload =
				typeof value === 'string'
					? new TextEncoder().encode(value)
					: value instanceof Uint8Array
						? value
						: encode(value);
			bytes.push(...varint(BigInt((no << 3) | 2)), ...varint(BigInt(payload.length)), ...payload);
		}
	}
	return Uint8Array.from(bytes);
}

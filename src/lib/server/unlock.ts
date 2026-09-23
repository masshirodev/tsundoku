import { randomBytes } from 'node:crypto';
import type { Cookies } from '@sveltejs/kit';
import {
	generateAuthenticationOptions,
	generateRegistrationOptions,
	verifyAuthenticationResponse,
	verifyRegistrationResponse,
	type AuthenticationResponseJSON,
	type RegistrationResponseJSON
} from '@simplewebauthn/server';
import { getDb } from './db';
import { isRevealed, setRevealed } from './prefs';

/**
 * The fingerprint gate for /reveal (doc/PRIVACY.md). Once a device is
 * enrolled with `/lock`, `/reveal` only works after that device's platform
 * authenticator -- fingerprint or screen lock, user verification required --
 * signs a fresh challenge. The prompt is Android's own; tsundoku only draws
 * what sits behind it, and nothing hidden sits there.
 *
 * WebAuthn needs a secure context, which is why this came with HTTPS
 * (doc/SERVING.md). The relying party is whatever host the app is served on:
 * the tailnet name in production, localhost in development and tests.
 */

export type Purpose = 'reveal' | 'enrol' | 'remove';

type Ceremony = { challenge: string; purpose: Purpose; expires: number };

const CEREMONY_COOKIE = 'tsundoku_ceremony';
const TTL_MS = 2 * 60_000;
// One process, one owner: ceremonies live in memory, keyed by a random id in
// an httpOnly cookie, and expire in two minutes.
const ceremonies = new Map<string, Ceremony>();

export class GateRefused extends Error {}

type CredentialRow = { id: string; public_key: Buffer; counter: number; transports: string };

function credentials(): CredentialRow[] {
	return getDb()
		.prepare(`SELECT id, public_key, counter, transports FROM unlock_credentials`)
		.all() as CredentialRow[];
}

/** Whether /reveal needs a fingerprint. */
export const isGated = () => credentials().length > 0;

function rp(url: URL) {
	return { rpID: url.hostname, origin: url.origin };
}

function begin(cookies: Cookies, url: URL, purpose: Purpose, challenge: string): void {
	const now = Date.now();
	for (const [k, c] of ceremonies) if (c.expires < now) ceremonies.delete(k);
	const id = randomBytes(18).toString('base64url');
	ceremonies.set(id, { challenge, purpose, expires: now + TTL_MS });
	cookies.set(CEREMONY_COOKIE, id, {
		path: '/',
		httpOnly: true,
		sameSite: 'strict',
		secure: url.protocol === 'https:',
		maxAge: TTL_MS / 1000
	});
}

/** The pending ceremony, once: a challenge is never accepted twice. */
function take(cookies: Cookies, purpose: Purpose): Ceremony {
	const id = cookies.get(CEREMONY_COOKIE);
	cookies.delete(CEREMONY_COOKIE, { path: '/' });
	const c = id ? ceremonies.get(id) : undefined;
	if (id) ceremonies.delete(id);
	if (!c || c.purpose !== purpose || c.expires < Date.now())
		throw new GateRefused('no pending request');
	return c;
}

/**
 * Options for the browser. Enrolling a device is allowed while there is no
 * gate yet, or while reveal is on -- that is, only by someone who is already
 * past the gate. Revealing and removing the gate ask an enrolled device.
 */
export async function options(purpose: Purpose, url: URL, cookies: Cookies) {
	const { rpID } = rp(url);
	if (purpose === 'enrol') {
		if (isGated() && !isRevealed(cookies))
			throw new GateRefused('reveal first: only an unlocked session can add a device');
		const opts = await generateRegistrationOptions({
			rpName: 'tsundoku',
			rpID,
			userName: 'owner',
			userDisplayName: 'tsundoku',
			attestationType: 'none',
			excludeCredentials: credentials().map((c) => ({
				id: c.id,
				transports: JSON.parse(c.transports)
			})),
			// The device's own lock: fingerprint or screen lock, never a roaming key.
			authenticatorSelection: {
				authenticatorAttachment: 'platform',
				residentKey: 'discouraged',
				userVerification: 'required'
			}
		});
		begin(cookies, url, purpose, opts.challenge);
		return { gated: isGated(), kind: 'register' as const, options: opts };
	}
	const creds = credentials();
	if (creds.length === 0) return { gated: false as const };
	const opts = await generateAuthenticationOptions({
		rpID,
		userVerification: 'required',
		allowCredentials: creds.map((c) => ({ id: c.id, transports: JSON.parse(c.transports) }))
	});
	begin(cookies, url, purpose, opts.challenge);
	return { gated: true as const, kind: 'authenticate' as const, options: opts };
}

/** Check the browser's answer and do what it was for. */
export async function verify(
	purpose: Purpose,
	response: unknown,
	url: URL,
	cookies: Cookies
): Promise<void> {
	const { rpID, origin } = rp(url);
	const pending = take(cookies, purpose);
	if (purpose === 'enrol') {
		const r = await verifyRegistrationResponse({
			response: response as RegistrationResponseJSON,
			expectedChallenge: pending.challenge,
			expectedOrigin: origin,
			expectedRPID: rpID,
			requireUserVerification: true
		});
		if (!r.verified) throw new GateRefused('the device did not verify');
		const { credential } = r.registrationInfo;
		getDb()
			.prepare(
				`INSERT OR REPLACE INTO unlock_credentials (id, public_key, counter, transports, created_at) VALUES (?, ?, ?, ?, ?)`
			)
			.run(
				credential.id,
				Buffer.from(credential.publicKey),
				credential.counter,
				JSON.stringify(credential.transports ?? []),
				Date.now()
			);
		return;
	}
	const answer = response as AuthenticationResponseJSON;
	const row = credentials().find((c) => c.id === answer?.id);
	if (!row) throw new GateRefused('not an enrolled device');
	const r = await verifyAuthenticationResponse({
		response: answer,
		expectedChallenge: pending.challenge,
		expectedOrigin: origin,
		expectedRPID: rpID,
		requireUserVerification: true,
		credential: {
			id: row.id,
			publicKey: new Uint8Array(row.public_key),
			counter: row.counter,
			transports: JSON.parse(row.transports)
		}
	});
	if (!r.verified) throw new GateRefused('not unlocked');
	getDb()
		.prepare(`UPDATE unlock_credentials SET counter = ? WHERE id = ?`)
		.run(r.authenticationInfo.newCounter, row.id);
	if (purpose === 'reveal') setRevealed(cookies, true, url.protocol === 'https:');
	else getDb().prepare(`DELETE FROM unlock_credentials`).run();
}

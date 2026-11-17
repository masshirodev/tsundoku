import { execFile } from 'node:child_process';
import { readFile } from 'node:fs/promises';

/**
 * A firewall on the computer, for the WI-FI panel (doc/WIFI.md, "A firewall
 * on the computer"). Windows asks once, with a dialog; Linux asks
 * nothing: with ufw, firewalld or an nftables rule on, the phone's request is
 * dropped in silence and the panel looks fine. So the panel names the port
 * and the home network, and gives the line to copy for the common ones.
 *
 * - **The platform is the server's** (`process.platform`), never the
 *   browser's user agent. The panel is drawn only on the computer itself
 *   (the WI-FI panel answers localhost alone), so the browser and the server
 *   are the same machine; the server is still the one that knows.
 * - **The probe runs without privileges, and never sudo.** Measured on Arch:
 *   `ufw status` refuses without root
 *   ("ERROR: You need to be root to run this script", exit 1), so ufw is
 *   read the way its own boot does: its unit active (`systemctl is-active
 *   ufw`) and `ENABLED=yes` in `/etc/ufw/ufw.conf`, which anyone may read.
 *   Both, because Arch ships `ENABLED=yes` with the unit not enabled (this
 *   box: `ENABLED=yes`, `inactive`), and Ubuntu leaves the unit active after
 *   `ufw disable`. firewalld's `firewall-cmd --state` answers without root
 *   (`running`, or `not running` with exit 252). An nftables or iptables
 *   ruleset can't be listed without root at all (`nft list ruleset`:
 *   "Operation not permitted"), so it is never named: the general line
 *   covers it.
 * - **Bounded**: each command has 2 s. A missing binary, a refusal, an
 *   answer it doesn't know and a timeout are all `unknown`, which shows the
 *   general line, never a claim that nothing is on.
 * - **Kept 30 s**: the panel asks every 5 s, and a firewall switched on
 *   meanwhile is named within one keep.
 *
 * The e2e's seams, read only when set, which no launcher sets
 * (`ops/release/launcher/plan.ts`): `TSUNDOKU_FIREWALL_PLATFORM` (`linux`,
 * `win32`, `darwin`) stands for `process.platform`,
 * `TSUNDOKU_FIREWALL_PROBE` (`ufw`, `firewalld`, `none`) for the probe, and
 * `TSUNDOKU_FIREWALL_QUIET_MS` for the 30 s a code waits for a phone.
 */

export type FirewallPlatform = 'linux' | 'windows' | 'other';
export type ProbeAnswer = 'on' | 'off' | 'unknown';
/** A firewall the probe found on, by name; null when none was, or nothing could be known. */
export type FirewallFound = 'ufw' | 'firewalld' | null;

/** Each probe command's time. */
export const PROBE_MS = 2000;
/** How long one probe's answer is kept. */
export const PROBE_KEEP_MS = 30_000;

export function platformOf(p: string): FirewallPlatform {
	return p === 'linux' ? 'linux' : p === 'win32' ? 'windows' : 'other';
}

/** The server's platform, or the e2e's stand-in for it. */
export function serverPlatform(env: NodeJS.ProcessEnv = process.env): FirewallPlatform {
	return platformOf(env.TSUNDOKU_FIREWALL_PLATFORM || process.platform);
}

/** What a command said, or null: it didn't run (missing, refused to start) or didn't finish in time. */
export type Ran = { code: number; out: string } | null;

/** Runs a command without a shell, with a time limit; never throws. */
export function runCommand(cmd: string, args: string[], ms = PROBE_MS): Promise<Ran> {
	return new Promise((done) => {
		try {
			execFile(
				cmd,
				args,
				{ timeout: ms, killSignal: 'SIGKILL', windowsHide: true, encoding: 'utf8' },
				(err, stdout) => {
					if (!err) return done({ code: 0, out: String(stdout) });
					const e = err as NodeJS.ErrnoException & { killed?: boolean; code?: unknown };
					// A number is the command's own exit; anything else (ENOENT, a kill) is no answer.
					if (e.killed || typeof e.code !== 'number') return done(null);
					done({ code: e.code, out: String(stdout) });
				}
			);
		} catch {
			done(null);
		}
	});
}

/** ufw from its unit's state and its own config: on only when both say so. */
export function readUfw(active: Ran, conf: string | null): ProbeAnswer {
	if (!active) return 'unknown';
	const state = active.out.trim();
	if (state === 'inactive' || state === 'failed') return 'off';
	if (state !== 'active') return 'unknown';
	if (conf === null) return 'unknown';
	const enabled = /^\s*ENABLED\s*=\s*(\w+)/m.exec(conf)?.[1]?.toLowerCase();
	return enabled === 'yes' ? 'on' : enabled === 'no' ? 'off' : 'unknown';
}

/** firewalld from `firewall-cmd --state`. */
export function readFirewalld(state: Ran): ProbeAnswer {
	if (!state) return 'unknown';
	const s = state.out.trim();
	return s === 'running' ? 'on' : s === 'not running' ? 'off' : 'unknown';
}

type Probes = {
	run?: (cmd: string, args: string[]) => Promise<Ran>;
	read?: (path: string) => Promise<string | null>;
};

const readText = (path: string) => readFile(path, 'utf8').catch(() => null);

/** Asks the computer, unprivileged: ufw first, then firewalld. Linux only. */
export async function probeFirewall(o: Probes = {}): Promise<FirewallFound> {
	const run = o.run ?? ((cmd, args) => runCommand(cmd, args));
	const read = o.read ?? readText;
	const [active, conf, state] = await Promise.all([
		run('systemctl', ['is-active', 'ufw']),
		read('/etc/ufw/ufw.conf'),
		run('firewall-cmd', ['--state'])
	]);
	if (readUfw(active, conf) === 'on') return 'ufw';
	if (readFirewalld(state) === 'on') return 'firewalld';
	return null;
}

let kept: { at: number; found: Promise<FirewallFound> } | null = null;

/** The probe's answer for the panel: the e2e's stand-in, else Linux's probe, kept 30 s. */
export function firewallFound(
	platform: FirewallPlatform,
	now = Date.now(),
	env: NodeJS.ProcessEnv = process.env
): Promise<FirewallFound> {
	const fake = env.TSUNDOKU_FIREWALL_PROBE;
	if (fake) return Promise.resolve(fake === 'ufw' || fake === 'firewalld' ? fake : null);
	if (platform !== 'linux') return Promise.resolve(null);
	if (!kept || now - kept.at >= PROBE_KEEP_MS) kept = { at: now, found: probeFirewall() };
	return kept.found;
}

/** Forgets the kept answer (a spec's, between cases). */
export const forgetProbe = () => {
	kept = null;
};

/** The lines to copy, with the running app's port and the computer's own home network. */
export function firewallCommands(port: number, subnet: string): { ufw: string; firewalld: string } {
	return {
		ufw: `sudo ufw allow from ${subnet} to any port ${port} proto tcp`,
		// The default zone, where an interface no one assigned is; limited to the
		// home network as the ufw line is, rather than the port opened to all.
		firewalld:
			`sudo firewall-cmd --permanent --add-rich-rule='rule family="ipv4" source address="${subnet}" ` +
			`port port="${port}" protocol="tcp" accept' && sudo firewall-cmd --reload`
	};
}

export type FirewallView = {
	platform: FirewallPlatform;
	found: FirewallFound;
	port: number;
	subnet: string;
	commands: { ufw: string; firewalld: string };
};

export function firewallView(o: {
	platform: FirewallPlatform;
	found: FirewallFound;
	port: number;
	subnet: string;
}): FirewallView {
	return { ...o, commands: firewallCommands(o.port, o.subnet) };
}

/** How long a live code waits for a phone before the panel asks whether a firewall is in the way. */
export const QUIET_MS = 30_000;

export const quietMs = (env: NodeJS.ProcessEnv = process.env) => {
	const n = Number(env.TSUNDOKU_FIREWALL_QUIET_MS);
	return Number.isFinite(n) && n > 0 ? n : QUIET_MS;
};

/**
 * NO PHONE HAS REACHED THIS COMPUTER YET: a live code has been up for
 * `quiet` ms, and nothing yet shows that a phone can reach this computer.
 * "Reached" is any request at all from a home-network client by the Wi-Fi
 * listeners now open (the sign-in page, the pair link, a paired phone's
 * page): any of them proves the firewall lets a phone in. A paired phone
 * proves it too, so a reader whose phones are paired and closed is never
 * asked. Neither depends on the code: a request before NEW CODES proves the
 * same firewall, so a new code alone doesn't start the wait again. What does
 * is new listeners (OFF and ON, a moved address, a restart: `reachedAt`
 * resets in lan-listen.ts), since they can meet a new rule, and then only
 * on a computer no phone is paired with.
 */
export function noPhoneYet(o: {
	live: boolean;
	madeAt: number | null;
	reachedAt: number | null | undefined;
	/** Phones paired with this computer (`pairedDevices().size`). */
	paired: number;
	now: number;
	quiet: number;
}): boolean {
	if (!o.live || o.madeAt === null) return false;
	if (o.now - o.madeAt < o.quiet) return false;
	return o.reachedAt == null && o.paired === 0;
}

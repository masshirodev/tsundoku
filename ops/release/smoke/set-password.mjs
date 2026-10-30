// Sets a password in a data folder the way SET UP does (doc/SIGN-IN.md), for
// a smoke test that needs one before tsundoku starts: on Tailscale it won't
// start without (ops/release/smoke/windows-tailscale.ps1).
//
//   node set-password.mjs <bundle folder> <data folder> <password | none>
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const [bundle, home, password] = process.argv.slice(2);
const { makeLogin, writeLogin } = await import(
	pathToFileURL(join(bundle, 'app', 'src', 'lib', 'server', 'login.ts')).href
);
writeLogin(home, makeLogin(password === 'none' ? null : password));
console.log(`${password === 'none' ? 'no password' : 'password'} set in ${home}`);

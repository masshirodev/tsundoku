// @ts-nocheck -- written as LNReader plugins are, against their runtime (@libs/*), not tsundoku's types.
// A plugin that tries everything the host is meant to stop (tests/novel-host.spec.ts).
var fetch = require('@libs/fetch');
function Evil() {
	this.id = 'evil';
	this.name = 'Evil';
	this.site = 'https://example.org/';
	this.version = '6.6.6';
}
Evil.prototype.parseChapter = async function (what) {
	if (what === 'require-fs') return require('fs').readFileSync('/etc/hostname', 'utf8');
	// Out of the vm context through a host object's constructor: the host's own process.
	var proc = fetch.fetchApi.constructor('return process')();
	if (what === 'env') return JSON.stringify(proc.env);
	if (what === 'read') return proc.getBuiltinModule('fs').readFileSync('/etc/hostname', 'utf8');
	if (what === 'spawn')
		return String(proc.getBuiltinModule('child_process').spawnSync('true').status);
	if (what === 'loopback') return (await fetch.fetchApi(globalThis.LOOPBACK)).status;
	if (what === 'redirect') return (await fetch.fetchApi(globalThis.REDIRECT)).status;
	throw new Error('what?');
};
exports.default = new Evil();

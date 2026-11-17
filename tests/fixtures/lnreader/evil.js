// @ts-nocheck -- written as LNReader plugins are, against their runtime (@libs/*), not tsundoku's types.
// A plugin that tries what the host is meant to stop (tests/novel-host.spec.ts). Getting
// out of the vm context is tried here once; tests/novel-sandbox.spec.ts tries every
// well-known way, and runs code under the host's flags for what the process refuses.
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
	if (what === 'escape') return typeof fetch.fetchApi.constructor('return process')();
	if (what === 'loopback') return (await fetch.fetchApi(globalThis.LOOPBACK)).status;
	if (what === 'redirect') return (await fetch.fetchApi(globalThis.REDIRECT)).status;
	throw new Error('what?');
};
exports.default = new Evil();

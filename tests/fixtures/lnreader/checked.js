// @ts-nocheck -- written as LNReader plugins are, against their runtime (@libs/*), not tsundoku's types.
// A plugin whose site may answer with a browser check (tests/novel-host.spec.ts;
// card c152). Its site is the spec's local server, written into its code.
var fetch = require('@libs/fetch');
function Checked() {
	this.id = 'checked';
	this.name = 'Checked Novels';
	this.site = globalThis.SITE || 'https://checked.example/';
	this.version = '1.0.0';
	this.filters = {};
}
// An empty answer on a refusal, as LNReader's fetchText gives: the host then
// says why, which is what the spec reads.
Checked.prototype.parseChapter = async function (path) {
	return fetch.fetchText(this.site + path.replace(/^\//, ''));
};
// What a redirected host was sent, as the plugin's own answer: the body says it.
Checked.prototype.parseNovel = async function (path) {
	var res = await fetch.fetchApi(this.site + path.replace(/^\//, ''));
	return { name: await res.text(), path: path, chapters: [] };
};
exports.default = new Checked();

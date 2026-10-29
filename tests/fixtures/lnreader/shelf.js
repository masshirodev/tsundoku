// @ts-nocheck -- written as LNReader plugins are, against their runtime (@libs/*), not tsundoku's types.
// A plugin whose site is in its own code (tests/browse-novels.e2e.ts): it
// answers every call without the network, which the host keeps loopback away
// from, so a novel is added, downloaded and read through the real host.
var status = require('@libs/novelStatus');
function Shelf() {
	this.id = 'shelf';
	this.name = 'Shelf Novels';
	this.site = 'https://shelf.example/';
	this.version = '1.0.0';
	this.filters = {};
}
var CHAPTERS = [
	{ name: 'Chapter 1 - Dust', path: '/quiet/1' },
	{ name: 'Chapter 2 - Light', path: '/quiet/2' },
	{ name: 'Chapter 3 - Rain', path: '/quiet/3' }
];
Shelf.prototype.popularNovels = async function (page) {
	return page === 1 ? [{ name: 'The Quiet Shelf', path: '/novel/quiet', cover: '' }] : [];
};
Shelf.prototype.searchNovels = async function () {
	return [];
};
Shelf.prototype.parseNovel = async function (path) {
	return {
		name: 'The Quiet Shelf',
		path: path,
		cover: '',
		author: 'A. Writer',
		status: status.NovelStatus.Ongoing,
		genres: 'Slice of Life',
		summary: 'Three chapters, downloaded one at a time.',
		chapters: CHAPTERS
	};
};
Shelf.prototype.parseChapter = async function (path) {
	var n = path.slice(path.lastIndexOf('/') + 1);
	var lines = [];
	for (var i = 1; i <= 12; i++)
		lines.push('<p>Line ' + i + ' of chapter ' + n + ', where the shelf is quiet.</p>');
	return '<div class="chapter"><script>track()</script>' + lines.join('') + '</div>';
};
exports.default = new Shelf();

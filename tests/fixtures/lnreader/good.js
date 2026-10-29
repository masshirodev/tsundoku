// A plugin as LNReader's are built (CommonJS, exports.default an instance),
// written for the host's tests (tests/novel-host.spec.ts). Its site is the
// spec's local server, which the spec opens to the host.
var cheerio = require('cheerio');
var fetch = require('@libs/fetch');
var status = require('@libs/novelStatus');
var filters = require('@libs/filterInputs');
var storage = require('@libs/storage');
var dayjs = require('dayjs');
function Good() {
	this.id = 'good';
	this.name = 'Good Novels';
	this.site = globalThis.SITE || 'http://127.0.0.1:4170/';
	this.version = '1.0.0';
	this.filters = {
		sort: {
			type: filters.FilterTypes.Picker,
			label: 'Sort',
			value: 'new',
			options: [
				{ label: 'New', value: 'new' },
				{ label: 'Top', value: 'top' }
			]
		}
	};
}
Good.prototype.popularNovels = async function (page, opts) {
	storage.storage.set('asked', page);
	var html = await fetch.fetchText(
		this.site +
			'list?page=' +
			page +
			'&sort=' +
			opts.filters.sort.value +
			(opts.showLatestNovels ? '&latest=1' : '')
	);
	var $ = cheerio.load(html);
	return $('a.novel')
		.map(function (_, a) {
			return { name: $(a).text(), path: $(a).attr('href'), cover: '' };
		})
		.get();
};
Good.prototype.searchNovels = async function (term, page) {
	var res = await fetch.fetchApi(this.site + 'search?q=' + encodeURIComponent(term));
	return (await res.json()).map(function (n) {
		return { name: n, path: '/n/' + n };
	});
};
Good.prototype.parseNovel = async function (path) {
	return {
		name: 'A Novel',
		path: path,
		status: status.NovelStatus.Ongoing,
		chapters: [
			{
				name: 'Chapter 1',
				path: path + '/1',
				releaseTime: dayjs('2026-10-28').format('YYYY-MM-DD')
			}
		]
	};
};
Good.prototype.parseChapter = async function (path) {
	return '<p>' + path + '</p>';
};
exports.default = new Good();

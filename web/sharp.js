// sharp, the native image library, for the web edition's server worker
// (doc/WEB-EDITION.md). A tab cannot load native code. tsundoku uses sharp for
// cover thumbnails and the image hashes duplicate detection compares; in a
// browser both belong to createImageBitmap and OffscreenCanvas in a worker,
// which is a stand-in still to write. Until then an image call says so, and
// the settings sharp takes while modules load (cache, concurrency) are
// accepted and ignored.
const notYet = () => {
	throw new Error('sharp (image processing) is not in the web edition yet');
};
const sharp = Object.assign(notYet, {
	cache: () => ({}),
	concurrency: () => 1,
	simd: () => false,
	counters: () => ({}),
	format: {},
	versions: {}
});
export default sharp;

// What the test page and the test both know, kept apart from either so that
// importing it runs neither.

/** The User-Agent the page asks for, as the engine would. */
export const ENGINE_AGENT = 'tsundoku-engine-test/1.0';

/** The binary answer: every byte value, four times. */
export const BINARY_ANSWER = Array.from({ length: 1024 }, (_, i) => i % 256);

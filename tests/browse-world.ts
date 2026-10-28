/**
 * What BROWSE's browser suite shares between its global setup
 * (browse-setup.ts) and its specs: the two ports, the sources the fake
 * engine serves, and the shape of a call to it.
 */

export const BROWSE_PORT = Number(process.env.PLAYWRIGHT_BROWSE_PORT ?? 4194);
export const ENGINE_PORT = Number(process.env.PLAYWRIGHT_ENGINE_PORT ?? 4195);

export const SOURCES = {
	open: { id: '100', pkg: 'e2e.open', name: 'Open Source' } as {
		id: string;
		pkg: string;
		name: string;
		failed?: string;
	},
	hidden: { id: '200', pkg: 'e2e.hidden', name: 'Toonily' } as {
		id: string;
		pkg: string;
		name: string;
		failed?: string;
	},
	broken: { id: '300', pkg: 'e2e.broken', name: 'Broken Source', failed: 'protobuf' }
};

export type EngineCall = {
	method: string;
	sourceId: string;
	page?: number;
	search?: string;
	filterList?: { name: string; type: string; stateInt?: number; stateList?: unknown[] }[];
};

const ENGINE = `http://127.0.0.1:${ENGINE_PORT}`;
export const resetEngine = () => fetch(`${ENGINE}/__reset`, { method: 'POST' });
export const engineDown = () => fetch(`${ENGINE}/__down`, { method: 'POST' });
export const engineCalls = async () =>
	(await (await fetch(`${ENGINE}/__calls`)).json()) as EngineCall[];

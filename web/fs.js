// The web edition's `node:fs` (doc/WEB-EDITION.md, "Files"): the calls the
// server code makes, on a SQLite table in the browser's own storage
// (web/fs-store.js). The stand-in plugin (web/node-stubs.js) takes every name
// exported here as the real call and stubs the rest of `node:fs`, each
// throwing "not in the web edition" when called.
import Database from './sqlite.js';
import { createFs } from './fs-store.js';

/** The files' own database, beside the library's in the same OPFS pool. */
export const FILES_DATABASE = '/tsundoku-files.sqlite';

// Opened on first use: the server worker opens the pool (ready()) before any
// server code runs, so the first file call finds it open.
const fs = createFs(() => new Database(FILES_DATABASE));

export const existsSync = fs.existsSync;
export const mkdirSync = fs.mkdirSync;
export const writeFileSync = fs.writeFileSync;
export const appendFileSync = fs.appendFileSync;
export const readFileSync = fs.readFileSync;
export const renameSync = fs.renameSync;
export const rmSync = fs.rmSync;
export const rmdirSync = fs.rmdirSync;
export const unlinkSync = fs.unlinkSync;
export const readdirSync = fs.readdirSync;
export const statSync = fs.statSync;
export const lstatSync = fs.lstatSync;
export const copyFileSync = fs.copyFileSync;
export const cpSync = fs.cpSync;
export const statfsSync = fs.statfsSync;
export const promises = fs.promises;

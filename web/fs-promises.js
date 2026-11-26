// The web edition's `node:fs/promises`: web/fs.js's calls, answered as
// promises (doc/WEB-EDITION.md, "Files").
import { promises } from './fs.js';

export const stat = promises.stat;
export const lstat = promises.lstat;
export const readFile = promises.readFile;
export const readdir = promises.readdir;
export const mkdir = promises.mkdir;
export const writeFile = promises.writeFile;
export const appendFile = promises.appendFile;
export const rm = promises.rm;
export const rmdir = promises.rmdir;
export const rename = promises.rename;
export const unlink = promises.unlink;
export const copyFile = promises.copyFile;
export const cp = promises.cp;
export const access = promises.access;

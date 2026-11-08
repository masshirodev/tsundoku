// The build inlines order.js above site.js in one <script> (site/build.ts,
// which also strips order.js' `export`s), so site.js calls these as globals.
declare const detectOS: typeof import('./order.js').detectOS;
declare const plan: typeof import('./order.js').plan;

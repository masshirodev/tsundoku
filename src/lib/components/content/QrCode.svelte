<script lang="ts">
	import { encode } from 'uqr';

	/**
	 * A QR code, drawn as SVG squares (doc/WIFI.md; Wifi.dc.html's pairing
	 * cell). Encoded here, in the browser, so the server carries no QR library.
	 * Dark modules on whatever the caller puts behind it: the handoff draws an
	 * inverse cell, dark on light, so a camera reads it off a monitor.
	 */
	let { text, size, label }: { text: string; size: number; label: string } = $props();

	const qr = $derived(encode(text, { ecc: 'M', border: 0 }));
	const path = $derived.by(() => {
		let d = '';
		qr.data.forEach((row, y) =>
			row.forEach((on, x) => {
				if (on) d += `M${x} ${y}h1v1h-1z`;
			})
		);
		return d;
	});
</script>

<svg
	role="img"
	aria-label={label}
	width={size}
	height={size}
	viewBox="0 0 {qr.size} {qr.size}"
	shape-rendering="crispEdges"
>
	<path d={path} fill="currentColor" />
</svg>

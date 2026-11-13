/** Maintenance page: neutral HTML, no brand, no external resource. */

import type { MaintenancePage } from "./types";

const HTML_ESCAPES: Readonly<Record<string, string>> = {
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
};

export function escapeHtml(text: string): string {
    return text.replace(/[&<>"']/g, (character) => HTML_ESCAPES[character] ?? character);
}

/** Strict CSP of the page: nothing may load, only the inline style carrying the nonce. */
export function maintenanceCsp(nonce: string): string {
    return `default-src 'none'; style-src 'nonce-${nonce}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`;
}

export function maintenanceHtml(page: MaintenancePage, nonce: string): string {
    const title = escapeHtml(page.title);
    return `<!doctype html>
<html lang="${escapeHtml(page.lang)}">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title}</title>
<style nonce="${escapeHtml(nonce)}">
html { color-scheme: light dark; }
body { margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; line-height: 1.5; }
main { max-width: 32rem; padding: 2rem; text-align: center; }
h1 { font-size: 1.5rem; margin: 0 0 1rem; }
p { margin: 0; opacity: 0.8; }
</style>
</head>
<body>
<main>
<h1>${title}</h1>
<p>${escapeHtml(page.message)}</p>
</main>
</body>
</html>
`;
}

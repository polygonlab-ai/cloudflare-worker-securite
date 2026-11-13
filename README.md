```
       ▄▄▀▀▄▄        ____       _                         _          _
    ▄▀▀  ▄▄  ▀▀▄    |  _ \ ___ | |_   _  __ _  ___  _ __ | |    __ _| |__
    █  ▄▀  ▀▄  █    | |_) / _ \| | | | |/ _` |/ _ \| '_ \| |   / _` | '_ \
    █  ▀▄  ▄▀  █    |  __/ (_) | | |_| | (_| | (_) | | | | |__| (_| | |_) |
    ▀▄▄  ▀▀  ▄▄▀    |_|   \___/|_|\__, |\__, |\___/|_| |_|_____\__,_|_.__/
       ▀▀▄▄▀▀                     |___/ |___/
                                   polygonlab.ai
```

# cloudflare-worker-securite

> Cloudflare Worker that adds security headers per host, keeps the origin CSP when asked, and serves a maintenance page when the origin is down. For anyone who runs one or several sites behind Cloudflare.

[![CI](https://github.com/polygonlab-ai/cloudflare-worker-securite/actions/workflows/ci.yml/badge.svg)](https://github.com/polygonlab-ai/cloudflare-worker-securite/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/polygonlab-ai/cloudflare-worker-securite)](https://github.com/polygonlab-ai/cloudflare-worker-securite/releases)
[![License](https://img.shields.io/badge/license-MIT-blue)](LICENSE)
[![Node.js](https://img.shields.io/badge/node-24%20%7C%2026-blue)](package.json)

```
Visitor
   │  HTTPS
   ▼
Cloudflare Worker (this repository)
   │  1. address blocked?            ──► 403, origin never called
   │  2. request sent to the origin  ──► unreachable, 521/522/523/525/526/530 ──► maintenance page (503)
   │  3. security headers of the host added, CSP handled by its mode, Server / X-Powered-By removed
   ▼
Your site (origin): body, status, redirects and other headers passed through untouched
```

## Why

Security headers are easy to forget on one site and painful to keep consistent on ten. A Worker in front of
the sites can add them everywhere, but a naive Worker **overwrites** the Content-Security-Policy (CSP) sent
by a site, and the external libraries that this site had allowed stop loading. This Worker sets the headers
host by host, keeps the CSP of the site when you ask it to, and stays quiet about itself: no header reveals
that it exists or how it works.

## Features

- One typed configuration file, per host: exact names (`www.example.com`) and patterns (`*.example.com`).
- Safe defaults for any host absent from the configuration.
- `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, `frame-ancestors` and `X-Frame-Options`.
- Three CSP modes per host: `override`, `keep-origin` (default) and `report-only`.
- Removal of `Server`, `X-Powered-By`, `X-AspNet-Version` and of any header you list.
- Neutral maintenance page (503, `Retry-After`, `no-store`) when the origin is down.
- IPv4 and IPv6 blocking by CIDR range, with exceptions; sober 403.
- Configuration checked at start-up: a mistake stops the deployment with a clear message.
- No runtime dependency. Bodies, redirects and other headers are never modified.

## Installation

You need Node.js 24 or later and a Cloudflare account whose sites are proxied by Cloudflare (orange cloud).

```bash
git clone https://github.com/polygonlab-ai/cloudflare-worker-securite.git
cd cloudflare-worker-securite
npm ci
```

## Quick start

**1. Try it on your computer first.** In a first terminal, start any local site (here, a test page served by Python):

```bash
mkdir -p /tmp/test-site && echo '<p>hello</p>' > /tmp/test-site/index.html
python3 -m http.server 8000 --directory /tmp/test-site
```

In a second terminal, from the repository folder, start the Worker in front of it, then look at the headers:

```bash
npx wrangler dev --local-upstream localhost:8000 --port 8787
```

```bash
curl -I http://localhost:8787/
```

Expected output (dates aside): the security headers are added and the `Server` header of the local site is gone.

```text
HTTP/1.1 200 OK
Content-Length: 13
Content-Type: text/html
Strict-Transport-Security: max-age=31536000; includeSubDomains
Content-Security-Policy: object-src 'none'; base-uri 'self'; frame-ancestors 'none'
Cross-Origin-Opener-Policy: same-origin-allow-popups
Cross-Origin-Resource-Policy: same-site
Permissions-Policy: accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()
Referrer-Policy: strict-origin-when-cross-origin
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
```

Stop the Python site (Ctrl+C in the first terminal) and run `curl -I http://localhost:8787/` again: the answer is now
`HTTP/1.1 503 Service Unavailable` with `Retry-After: 300`, and the maintenance page is served.

**2. Configure.** Write your hosts in [`src/config.ts`](src/config.ts) (the file holds a commented example), then
uncomment and adapt the `routes` of [`wrangler.toml`](wrangler.toml):

```toml
routes = [
  { pattern = "www.example.com/*", zone_name = "example.com" },
]
```

**3. Deploy.**

```bash
npx wrangler login
npx wrangler deploy
```

**4. Check** your site: `curl -I https://www.example.com/` must show the headers of its configuration.

## Usage

### Configuration file

```ts
import type { WorkerConfig } from "./types";

const config: WorkerConfig = {
    defaults: {
        removeHeaders: ["Server", "X-Powered-By", "X-AspNet-Version", "X-AspNetMvc-Version"],
    },
    hosts: {
        "www.example.com": {
            cspMode: "override",
            csp: "default-src 'self'; script-src 'self' https://cdn.example.com; object-src 'none'; base-uri 'self'",
        },
        "shop.example.com": { cspMode: "keep-origin" },
        "beta.example.com": { cspMode: "report-only", csp: "default-src 'self'" },
        "*.example.com": {
            frameAncestors: "self",
            maintenance: { title: "Maintenance en cours", message: "Merci de réessayer plus tard.", lang: "fr" },
        },
    },
    ipFilter: {
        block: ["198.51.100.0/24", "2001:db8:bad::/48"],
        allow: ["198.51.100.7"],
    },
};

export default config;
```

The policy of a host is built in three layers: the built-in defaults, then `defaults`, then the entry of the
host. A host takes its exact entry first, otherwise the most specific `*.` pattern (`*.eu.example.com` before
`*.example.com`), otherwise the defaults. A pattern matches subdomains at any depth, never the bare domain:
`*.example.com` matches `shop.example.com` and `a.b.example.com`, not `example.com`.

Every option of a header takes a value (the Worker sets the header and replaces the one of the origin) or
`false` (the Worker leaves the header exactly as the origin sent it).

### CSP modes

| Mode | Origin sends a CSP | Origin sends no CSP |
|---|---|---|
| `override` | Replaced by the CSP of the configuration | CSP of the configuration added |
| `keep-origin` (default) | **Kept untouched** | CSP of the configuration added |
| `report-only` | Kept untouched; the CSP of the configuration is added as `Content-Security-Policy-Report-Only` | Only `Content-Security-Policy-Report-Only` is added: nothing is blocked |

With `csp: false`, the Worker never touches the CSP, whatever the mode.

### Why `keep-origin`

A site often knows better than its proxy which scripts it needs. Picture a dashboard that draws its charts
with a library loaded from a CDN, and that allows this CDN in its own CSP. A Worker then placed in front of
every site, with one CSP written for the main site, replaces that header on every response: the browser now
applies a policy that does not mention the CDN, refuses to load the library, and the charts silently
disappear. Nothing fails on the server side; only the visitors see a broken page, and the cause is far from
the symptom.

`keep-origin` avoids this trap: when a site sends its own CSP, the Worker keeps it as it is; it adds the CSP
of the configuration only to the sites that send none. Use `override` only for a host whose full list of
sources you know, and test it first with `report-only`.

### Testing a configuration

Look at the headers actually received, without downloading the page:

```bash
curl -sI https://www.example.com/ | grep -iE 'content-security|strict-transport|x-frame|referrer|permissions|cross-origin'
```

To try a new CSP without breaking anything, deploy it in `report-only` mode first:

```ts
"www.example.com": {
    cspMode: "report-only",
    csp: "default-src 'self'; script-src 'self' https://cdn.example.com; report-to csp",
},
```

Open the site with the developer tools of your browser: every resource the policy would block appears in the
console as a report, while the page keeps working. To collect the reports, add a `report-to` directive and the
matching `Reporting-Endpoints` header on your site. When the console stays clean, switch the host to `override`.

### Maintenance page

When Cloudflare cannot reach the origin (status 521, 522, 523, 525, 526 or 530) or when the request to the
origin fails, the visitor receives a neutral page, without brand, in the language you choose:

```ts
maintenance: {
    title: "Maintenance en cours",
    message: "Le site est en maintenance. Merci de réessayer dans quelques minutes.",
    lang: "fr",
    retryAfter: 600,
},
```

The response has the status 503 (search engines keep the page in their index), `Retry-After`,
`Cache-Control: no-store` (the page is never cached) and a strict CSP of its own. Other errors of the origin
(500, 502, 504...) are passed through: they are answers of your site, not an outage of the connection.

### Address blocking

```ts
ipFilter: {
    block: ["198.51.100.0/24", "2001:db8:bad::/48"],
    allow: ["198.51.100.7"],
},
```

A visitor whose address (header `CF-Connecting-IP`, set by Cloudflare) falls in a `block` range receives a 403
with the body `Access denied.`, and the origin is never called. An address in `allow` is never blocked. The
response does not say which rule applied. An IPv4-mapped IPv6 address (`::ffff:198.51.100.7`) is matched as
the IPv4 address it carries. A range whose address has bits set after the prefix (`198.51.100.1/24`) is
refused at start-up, with the correct value in the message.

## Configuration

### Headers and default values

| Option | Header | Default | Why |
|---|---|---|---|
| `hsts` | `Strict-Transport-Security` | `max-age=31536000; includeSubDomains` | One year of HTTPS only, subdomains included. No `preload`: joining the browsers' preload list is a separate, lasting decision |
| `contentTypeOptions` | `X-Content-Type-Options` | `nosniff` | The browser trusts the declared type and never guesses it, which blocks a class of script injections |
| `referrerPolicy` | `Referrer-Policy` | `strict-origin-when-cross-origin` | Full address within the site, only the domain to other sites, nothing over plain HTTP |
| `permissionsPolicy` | `Permissions-Policy` | `accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()` | Turns off powerful features most sites never use; a site that needs one overrides the value |
| `crossOriginOpenerPolicy` | `Cross-Origin-Opener-Policy` | `same-origin-allow-popups` | Isolates the page from windows opened by other sites, while sign-in and payment popups keep working (`same-origin` would break them) |
| `crossOriginResourcePolicy` | `Cross-Origin-Resource-Policy` | `same-site` | Other sites cannot embed your files, while `www.example.com` can still load images from `static.example.com` |
| `frameAncestors` | `frame-ancestors` (CSP) and `X-Frame-Options` | `"none"`, that is `frame-ancestors 'none'` and `DENY` | No other site can show yours in a frame (clickjacking). `"self"` gives `'self'` and `SAMEORIGIN`. `X-Frame-Options` is kept for older browsers |
| `csp` | `Content-Security-Policy` | `object-src 'none'; base-uri 'self'` | Minimal on purpose: it blocks plug-ins and `<base>` hijacking, and cannot block a script, a style sheet or an image. Write a full policy per host |
| `cspMode` | | `keep-origin` | The CSP of the site wins over the one of the configuration (see "Why `keep-origin`") |
| `removeHeaders` | | `Server`, `X-Powered-By`, `X-AspNet-Version` | These headers tell an attacker which software and which version run the site |

`frame-ancestors` is managed by `frameAncestors` only: writing it in `csp` while `frameAncestors` is set is
refused at start-up. To allow specific sites, set `frameAncestors: false` and write the directive in `csp`.

Headers the Worker never sends: `X-XSS-Protection` (obsolete, and harmful in some browsers), and any header
that would reveal the Worker or its processing time.

### All options

| Option | Type | Default | Role |
|---|---|---|---|
| `defaults` | host options | `{}` | Options applied to every host, over the built-in defaults |
| `hosts` | object: host name or `*.` pattern to host options | `{}` | Options of each host, over `defaults` |
| `ipFilter.block` | list of addresses or CIDR ranges | `[]` | Visitors answered with a 403 |
| `ipFilter.allow` | list of addresses or CIDR ranges | `[]` | Exceptions, never blocked |
| `hsts`, `referrerPolicy`, `permissionsPolicy` | text or `false` | see above | Value of the header |
| `contentTypeOptions` | `"nosniff"` or `false` | `"nosniff"` | Value of the header |
| `crossOriginOpenerPolicy` | `"same-origin"`, `"same-origin-allow-popups"`, `"noopener-allow-popups"`, `"unsafe-none"` or `false` | `"same-origin-allow-popups"` | Value of the header |
| `crossOriginResourcePolicy` | `"same-origin"`, `"same-site"`, `"cross-origin"` or `false` | `"same-site"` | Value of the header |
| `frameAncestors` | `"none"`, `"self"` or `false` | `"none"` | Framing protection |
| `csp` | text or `false` | see above | CSP of the configuration, without `frame-ancestors` |
| `cspMode` | `"override"`, `"keep-origin"` or `"report-only"` | `"keep-origin"` | What to do with the CSP |
| `removeHeaders` | list of header names | see above | Headers removed from every response (the security headers above cannot be listed) |
| `maintenance.title` | text | `Temporarily unavailable` | Title and heading of the maintenance page |
| `maintenance.message` | text | a sentence in English | Text of the maintenance page |
| `maintenance.lang` | language tag | `en` | `lang` attribute of the page |
| `maintenance.retryAfter` | whole number, 1 to 86400 | `300` | `Retry-After` header, in seconds |

The configuration is checked when the Worker starts. A mistake stops the deployment and lists every problem,
for example:

```text
Invalid configuration (src/config.ts), 2 problem(s):
  - hosts["WWW.example.com"]: host names must be written in lowercase
  - ipFilter.block: "198.51.100.1/24": the address has bits set after the prefix (the range starts at 198.51.100.0/24)
```

## Compatibility

- Cloudflare Workers, `compatibility_date` 2026-11-01 or later, on routes of zones proxied by Cloudflare.
- Node.js 24 and 26 (current and previous LTS lines) for the tools, tested by the continuous integration.
- TypeScript in strict mode. No runtime dependency.

## Tests

```bash
npm ci
npm test
```

`npm run check` runs everything the continuous integration runs: `tsc --noEmit` in strict mode, ESLint,
Prettier, then the tests with coverage (90 % minimum). The tests run inside the Workers runtime (workerd)
through Vitest; the header computation is made of pure functions, tested without network.

## Limits and roadmap

Limits of this version:

- A WebSocket handshake (status 101) is passed through without security headers.
- The IP filter is common to every host, and a request without `CF-Connecting-IP` (only possible outside
  Cloudflare, for example in local tests) is not filtered.
- The maintenance page is served for connection failures only; it does not replace the error pages of the site.
- The Worker reads its configuration from `src/config.ts`: a change needs a new deployment.

Roadmap, not in this version:

- Rate limiting with the Cloudflare `ratelimit` binding.
- Logging to an external service.
- An npm package, to use the Worker as a library.

## Contributing

See [CONTRIBUTING.md](https://github.com/polygonlab-ai/.github/blob/main/CONTRIBUTING.md).

## Security

Report a vulnerability privately, never in a public issue: see
[SECURITY.md](https://github.com/polygonlab-ai/.github/blob/main/SECURITY.md).

## License

MIT License: see [LICENSE](LICENSE).

---
— Conçu et développé par PolygonLab · polygonlab.ai · Licence MIT

# Changelog

All notable changes to this repository are documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and the project adheres to
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.1.0] - 2026-11-14 - Security headers, CSP modes, maintenance page and IP blocking

### Added

- Per-host configuration in a typed file (`src/config.ts`): exact host names and `*.example.com` patterns, merged over safe defaults; a host absent from the configuration receives the defaults.
- Configuration checked when the Worker starts: every problem is listed in one clear message and the deployment stops.
- Security headers with documented defaults: `Strict-Transport-Security`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, `Cross-Origin-Opener-Policy`, `Cross-Origin-Resource-Policy`, and framing protection (`frame-ancestors` in the CSP plus `X-Frame-Options`).
- Three CSP modes per host: `override`, `keep-origin` (default: the CSP sent by the origin is kept) and `report-only`.
- Removal of `Server`, `X-Powered-By`, `X-AspNet-Version` and of any configured header.
- Neutral maintenance page (title, message and language configurable) with status 503, `Retry-After` and `Cache-Control: no-store`, served when Cloudflare returns 521, 522, 523, 525, 526 or 530, or when the origin cannot be reached.
- Address blocking by IPv4 and IPv6 CIDR ranges, with exceptions that always win; sober 403 that does not reveal the rule applied.
- Response bodies, redirects and the other origin headers passed through untouched.
- Tests in the Workers runtime (Vitest), coverage above 90 %, strict TypeScript, ESLint and Prettier, run by the continuous integration on the current and previous Node.js LTS lines.

[0.1.0]: https://github.com/polygonlab-ai/cloudflare-worker-securite/releases/tag/v0.1.0

---
— Conçu et développé par PolygonLab · polygonlab.ai · Licence MIT

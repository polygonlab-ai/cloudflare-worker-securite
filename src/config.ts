/**
 * Your configuration. Edit this file, then run `npx wrangler deploy`.
 *
 * Any option left out takes its default value (README, "Headers and default values"). A host
 * absent from `hosts` receives the defaults. The configuration is checked when the Worker
 * starts: a mistake stops the deployment with a clear message.
 *
 * The values below are an example built on example.com and on documentation address ranges.
 */

import type { WorkerConfig } from "./types";

const config: WorkerConfig = {
    // Options shared by every host (optional).
    defaults: {
        removeHeaders: ["Server", "X-Powered-By", "X-AspNet-Version", "X-AspNetMvc-Version"],
    },

    hosts: {
        // The Worker imposes its own policy on the main site.
        "www.example.com": {
            cspMode: "override",
            csp: "default-src 'self'; script-src 'self' https://cdn.example.com; img-src 'self' data:; object-src 'none'; base-uri 'self'",
            hsts: "max-age=63072000; includeSubDomains; preload",
        },

        // The shop sends its own CSP, which allows its payment and chart libraries: keep it.
        "shop.example.com": {
            cspMode: "keep-origin",
            crossOriginOpenerPolicy: "same-origin-allow-popups",
            permissionsPolicy: "camera=(), microphone=(), geolocation=(), payment=(self)",
        },

        // A stricter policy being tested: violations are reported, nothing is blocked.
        "beta.example.com": {
            cspMode: "report-only",
            csp: "default-src 'self'; object-src 'none'; base-uri 'self'",
        },

        // Every other subdomain of example.com.
        "*.example.com": {
            frameAncestors: "self",
            maintenance: {
                title: "Maintenance en cours",
                message: "Le site est en maintenance. Merci de réessayer dans quelques minutes.",
                lang: "fr",
                retryAfter: 600,
            },
        },
    },

    ipFilter: {
        block: ["198.51.100.0/24", "2001:db8:bad::/48"],
        // An exception always wins over a block.
        allow: ["198.51.100.7"],
    },
};

export default config;

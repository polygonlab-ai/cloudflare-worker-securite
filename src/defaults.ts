import type { HostPolicy } from "./types";

/**
 * Built-in defaults, applied to any host absent from the configuration.
 *
 * They are chosen to protect without breaking a site: the reason for each value is given in the
 * README ("Headers and default values").
 */
export const DEFAULT_POLICY: HostPolicy = {
    // One year, subdomains included. No `preload`: joining the preload list is a separate decision.
    hsts: "max-age=31536000; includeSubDomains",
    contentTypeOptions: "nosniff",
    referrerPolicy: "strict-origin-when-cross-origin",
    // Powerful features a typical site does not use. A host that needs one overrides this value.
    permissionsPolicy:
        "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
    // Keeps sign-in and payment popups working while isolating the page from cross-origin openers.
    crossOriginOpenerPolicy: "same-origin-allow-popups",
    // `same-site` lets www.example.com load images from static.example.com.
    crossOriginResourcePolicy: "same-site",
    frameAncestors: "none",
    // Minimal on purpose: it cannot block a script, a style sheet or an image.
    csp: "object-src 'none'; base-uri 'self'",
    cspMode: "keep-origin",
    removeHeaders: ["Server", "X-Powered-By", "X-AspNet-Version"],
    maintenance: {
        title: "Temporarily unavailable",
        message:
            "This site is temporarily unavailable, for maintenance or because of a technical problem. Please try again in a few minutes.",
        lang: "en",
        retryAfter: 300,
    },
};

/** Status codes returned by Cloudflare when the origin cannot be reached. */
export const MAINTENANCE_STATUSES: ReadonlySet<number> = new Set([521, 522, 523, 525, 526, 530]);

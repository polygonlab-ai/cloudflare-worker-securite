/**
 * Configuration types.
 *
 * Every header option takes either a value (the Worker sets the header, replacing what the
 * origin sent) or `false` (the Worker leaves the header exactly as the origin sent it).
 */

/** How the Worker handles the Content-Security-Policy. */
export type CspMode = "override" | "keep-origin" | "report-only";

/** Who may display the site in a frame. Drives `frame-ancestors` and `X-Frame-Options`. */
export type FrameAncestors = "none" | "self";

export type CrossOriginOpenerPolicy =
    "same-origin" | "same-origin-allow-popups" | "noopener-allow-popups" | "unsafe-none";

export type CrossOriginResourcePolicy = "same-origin" | "same-site" | "cross-origin";

/** Page served with a 503 status when the origin cannot be reached. */
export interface MaintenancePage {
    /** Page title and heading. */
    readonly title: string;
    /** Sentence shown under the heading. */
    readonly message: string;
    /** Language of the page (`lang` attribute), for example `en` or `fr`. */
    readonly lang: string;
    /** Value of the `Retry-After` header, in seconds (1 to 86400). */
    readonly retryAfter: number;
}

/** Complete policy applied to one host. */
export interface HostPolicy {
    /** `Strict-Transport-Security`. */
    readonly hsts: string | false;
    /** `X-Content-Type-Options`. */
    readonly contentTypeOptions: "nosniff" | false;
    /** `Referrer-Policy`. */
    readonly referrerPolicy: string | false;
    /** `Permissions-Policy`. */
    readonly permissionsPolicy: string | false;
    /** `Cross-Origin-Opener-Policy`. */
    readonly crossOriginOpenerPolicy: CrossOriginOpenerPolicy | false;
    /** `Cross-Origin-Resource-Policy`. */
    readonly crossOriginResourcePolicy: CrossOriginResourcePolicy | false;
    /**
     * Framing protection: adds `frame-ancestors` to the CSP of the configuration and sets
     * `X-Frame-Options` (`DENY` or `SAMEORIGIN`) for older browsers.
     */
    readonly frameAncestors: FrameAncestors | false;
    /** Content-Security-Policy of the configuration, without `frame-ancestors`. */
    readonly csp: string | false;
    /** What to do with the CSP: see the README, "CSP modes". */
    readonly cspMode: CspMode;
    /** Response headers removed before the response reaches the visitor. */
    readonly removeHeaders: readonly string[];
    /** Maintenance page of this host. */
    readonly maintenance: MaintenancePage;
}

/** Options of one host, merged over the defaults. */
export type HostOverrides = Partial<Omit<HostPolicy, "maintenance">> & {
    readonly maintenance?: Partial<MaintenancePage>;
};

/** Address ranges, in CIDR notation (`192.0.2.0/24`, `2001:db8::/32`) or single addresses. */
export interface IpFilter {
    /** Visitors whose address falls in one of these ranges receive a 403. */
    readonly block: readonly string[];
    /** Exceptions: an address listed here is never blocked. */
    readonly allow: readonly string[];
}

/** The configuration written in `src/config.ts`. */
export interface WorkerConfig {
    /** Overrides of the built-in defaults, applied to every host (optional). */
    readonly defaults?: HostOverrides;
    /** Per-host options: exact names (`www.example.com`) or patterns (`*.example.com`). */
    readonly hosts?: Readonly<Record<string, HostOverrides>>;
    /** Address blocking, common to every host (optional). */
    readonly ipFilter?: Partial<IpFilter>;
}

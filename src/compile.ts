/**
 * Configuration check and compilation, run once when the Worker starts.
 *
 * Every problem is collected, then reported in a single `ConfigError`: a wrong configuration
 * stops the Worker at deployment instead of producing wrong headers in production.
 */

import { DEFAULT_POLICY } from "./defaults";
import { parseRange, type IpRange } from "./ip";
import type { HostOverrides, HostPolicy, MaintenancePage, WorkerConfig } from "./types";

export interface CompiledConfig {
    /** Policy of the hosts absent from the configuration. */
    readonly defaultPolicy: HostPolicy;
    /** Exact host names. */
    readonly exact: ReadonlyMap<string, HostPolicy>;
    /** `*.example.com` patterns, most specific first. */
    readonly wildcards: readonly { readonly suffix: string; readonly policy: HostPolicy }[];
    readonly block: readonly IpRange[];
    readonly allow: readonly IpRange[];
}

export class ConfigError extends Error {
    constructor(readonly problems: readonly string[]) {
        super(
            `Invalid configuration (src/config.ts), ${String(problems.length)} problem(s):\n` +
                problems.map((problem) => `  - ${problem}`).join("\n"),
        );
        this.name = "ConfigError";
    }
}

/** Headers set by the Worker: they cannot be listed in `removeHeaders`. */
export const MANAGED_HEADERS: readonly string[] = [
    "strict-transport-security",
    "x-content-type-options",
    "referrer-policy",
    "permissions-policy",
    "cross-origin-opener-policy",
    "cross-origin-resource-policy",
    "x-frame-options",
    "content-security-policy",
    "content-security-policy-report-only",
];

const TOP_LEVEL_KEYS = ["defaults", "hosts", "ipFilter"];
const IP_FILTER_KEYS = ["block", "allow"];
const MAINTENANCE_KEYS = ["title", "message", "lang", "retryAfter"];
const POLICY_KEYS = [
    "hsts",
    "contentTypeOptions",
    "referrerPolicy",
    "permissionsPolicy",
    "crossOriginOpenerPolicy",
    "crossOriginResourcePolicy",
    "frameAncestors",
    "csp",
    "cspMode",
    "removeHeaders",
    "maintenance",
];

const REFERRER_POLICIES = new Set([
    "no-referrer",
    "no-referrer-when-downgrade",
    "origin",
    "origin-when-cross-origin",
    "same-origin",
    "strict-origin",
    "strict-origin-when-cross-origin",
    "unsafe-url",
]);
const COOP_VALUES = ["same-origin", "same-origin-allow-popups", "noopener-allow-popups", "unsafe-none"];
const CORP_VALUES = ["same-origin", "same-site", "cross-origin"];
const CSP_MODES = ["override", "keep-origin", "report-only"];
const FRAME_ANCESTORS = ["none", "self"];

const HEADER_NAME = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
const LABEL = "(?!-)[a-z0-9-]{1,63}(?<!-)";
const HOST_NAME = new RegExp(`^(?=.{1,253}$)${LABEL}(?:\\.${LABEL})*$`);
const LANGUAGE_TAG = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/;
const HSTS = /(?:^|;)\s*max-age=\d+\s*(?:;|$)/i;
const PERMISSION = /^[a-z][a-z0-9-]*=\S/;
const CSP_DIRECTIVE = /^[a-z][a-z-]*(?:\s|$)/;

type Problems = string[];

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function describe(value: unknown): string {
    if (typeof value === "string") {
        return `"${value}"`;
    }
    return value === undefined ? "undefined" : JSON.stringify(value);
}

function hasControlCharacter(value: string): boolean {
    for (let index = 0; index < value.length; index++) {
        const code = value.charCodeAt(index);
        if (code < 0x20 || code === 0x7f) {
            return true;
        }
    }
    return false;
}

function checkKeys(
    path: string,
    value: Readonly<Record<string, unknown>>,
    known: readonly string[],
    problems: Problems,
): void {
    for (const key of Object.keys(value)) {
        if (!known.includes(key)) {
            problems.push(`${path}: unknown option "${key}" (known options: ${known.join(", ")})`);
        }
    }
}

function checkHeaderValue(path: string, value: unknown, problems: Problems): value is string {
    if (typeof value !== "string" || value.trim() === "") {
        problems.push(`${path}: a non-empty string or false is expected, got ${describe(value)}`);
        return false;
    }
    if (hasControlCharacter(value)) {
        problems.push(`${path}: line breaks and control characters are not allowed in a header value`);
        return false;
    }
    return true;
}

function checkOneOf(
    path: string,
    value: unknown,
    allowed: readonly string[],
    problems: Problems,
    allowFalse = true,
): void {
    if ((allowFalse && value === false) || (typeof value === "string" && allowed.includes(value))) {
        return;
    }
    const choices = allowed.map((choice) => `"${choice}"`).join(", ") + (allowFalse ? " or false" : "");
    problems.push(`${path}: expected ${choices}, got ${describe(value)}`);
}

function checkPolicyValue(path: string, key: string, value: unknown, problems: Problems): void {
    const at = `${path}.${key}`;
    switch (key) {
        case "hsts":
            if (value !== false && checkHeaderValue(at, value, problems) && !HSTS.test(value)) {
                problems.push(`${at}: "max-age=<seconds>" is required, got ${describe(value)}`);
            }
            return;
        case "contentTypeOptions":
            checkOneOf(at, value, ["nosniff"], problems);
            return;
        case "referrerPolicy":
            if (value !== false && checkHeaderValue(at, value, problems)) {
                for (const token of value.split(",").map((part) => part.trim())) {
                    if (!REFERRER_POLICIES.has(token)) {
                        problems.push(`${at}: unknown referrer policy "${token}"`);
                    }
                }
            }
            return;
        case "permissionsPolicy":
            if (value !== false && checkHeaderValue(at, value, problems)) {
                for (const entry of value.split(",").map((part) => part.trim())) {
                    if (!PERMISSION.test(entry)) {
                        problems.push(`${at}: "${entry}" is not a "feature=allowlist" entry, for example "camera=()"`);
                    }
                }
            }
            return;
        case "crossOriginOpenerPolicy":
            checkOneOf(at, value, COOP_VALUES, problems);
            return;
        case "crossOriginResourcePolicy":
            checkOneOf(at, value, CORP_VALUES, problems);
            return;
        case "frameAncestors":
            checkOneOf(at, value, FRAME_ANCESTORS, problems);
            return;
        case "cspMode":
            checkOneOf(at, value, CSP_MODES, problems, false);
            return;
        case "csp":
            if (value !== false && checkHeaderValue(at, value, problems)) {
                for (const directive of value
                    .split(";")
                    .map((part) => part.trim())
                    .filter((part) => part !== "")) {
                    if (!CSP_DIRECTIVE.test(directive)) {
                        problems.push(`${at}: "${directive}" is not a CSP directive`);
                    }
                }
            }
            return;
        case "removeHeaders":
            if (!Array.isArray(value)) {
                problems.push(`${at}: a list of header names is expected, got ${describe(value)}`);
                return;
            }
            for (const name of value as readonly unknown[]) {
                if (typeof name !== "string" || !HEADER_NAME.test(name)) {
                    problems.push(`${at}: ${describe(name)} is not a header name`);
                } else if (MANAGED_HEADERS.includes(name.toLowerCase())) {
                    problems.push(
                        `${at}: "${name}" is set by the Worker and cannot be removed (set its option to false instead)`,
                    );
                }
            }
            return;
        default:
            return;
    }
}

function checkMaintenance(path: string, value: unknown, problems: Problems): void {
    if (!isRecord(value)) {
        problems.push(`${path}: an object is expected, got ${describe(value)}`);
        return;
    }
    checkKeys(path, value, MAINTENANCE_KEYS, problems);
    for (const key of ["title", "message"]) {
        if (key in value && (typeof value[key] !== "string" || value[key].trim() === "")) {
            problems.push(`${path}.${key}: a non-empty string is expected, got ${describe(value[key])}`);
        }
    }
    if ("lang" in value && (typeof value.lang !== "string" || !LANGUAGE_TAG.test(value.lang))) {
        problems.push(`${path}.lang: a language tag such as "en" or "fr-FR" is expected, got ${describe(value.lang)}`);
    }
    const retryAfter = value.retryAfter;
    if (
        "retryAfter" in value &&
        (typeof retryAfter !== "number" || !Number.isInteger(retryAfter) || retryAfter < 1 || retryAfter > 86400)
    ) {
        problems.push(
            `${path}.retryAfter: a whole number of seconds between 1 and 86400 is expected, got ${describe(retryAfter)}`,
        );
    }
}

/** Checks one set of overrides (only the options it contains). */
function checkOverrides(path: string, value: unknown, problems: Problems): HostOverrides {
    if (!isRecord(value)) {
        problems.push(`${path}: an object is expected, got ${describe(value)}`);
        return {};
    }
    checkKeys(path, value, POLICY_KEYS, problems);
    for (const [key, option] of Object.entries(value)) {
        if (key === "maintenance") {
            checkMaintenance(`${path}.maintenance`, option, problems);
        } else {
            checkPolicyValue(path, key, option, problems);
        }
    }
    return value;
}

function merge(base: HostPolicy, overrides: HostOverrides): HostPolicy {
    const maintenance: MaintenancePage = { ...base.maintenance, ...overrides.maintenance };
    return { ...base, ...overrides, maintenance };
}

/** Rules that involve several options, checked on the merged policy of a host. */
function checkCombination(path: string, policy: HostPolicy, problems: Problems): void {
    if (policy.frameAncestors !== false && policy.csp !== false && /(?:^|;)\s*frame-ancestors\b/i.test(policy.csp)) {
        problems.push(
            `${path}: "frame-ancestors" is written in csp while frameAncestors is "${policy.frameAncestors}"; ` +
                "remove the directive from csp, or set frameAncestors to false to manage framing in csp yourself",
        );
    }
}

function checkHostKey(key: string, problems: Problems): string | null {
    const name = key.startsWith("*.") ? key.slice(2) : key;
    if (key !== key.toLowerCase()) {
        problems.push(`hosts["${key}"]: host names must be written in lowercase`);
        return null;
    }
    if (!HOST_NAME.test(name) || (key.startsWith("*.") && !name.includes("."))) {
        problems.push(
            `hosts["${key}"]: expected an exact host name ("www.example.com") or a pattern ("*.example.com"), without scheme, port or path`,
        );
        return null;
    }
    return name;
}

function compileRanges(path: string, value: unknown, problems: Problems): IpRange[] {
    if (value === undefined) {
        return [];
    }
    if (!Array.isArray(value)) {
        problems.push(`${path}: a list of addresses or CIDR ranges is expected, got ${describe(value)}`);
        return [];
    }
    const ranges: IpRange[] = [];
    for (const entry of value as readonly unknown[]) {
        const range = typeof entry === "string" ? parseRange(entry.trim()) : `${describe(entry)} is not a string`;
        if (typeof range === "string") {
            problems.push(`${path}: ${range}`);
        } else {
            ranges.push(range);
        }
    }
    return ranges;
}

/**
 * Checks the configuration and prepares it for the request handler.
 * @throws ConfigError listing every problem found.
 */
export function compileConfig(config: WorkerConfig): CompiledConfig {
    const problems: Problems = [];
    const raw: unknown = config;
    if (!isRecord(raw)) {
        throw new ConfigError(["the configuration must be an object"]);
    }
    checkKeys("config", raw, TOP_LEVEL_KEYS, problems);

    const defaultPolicy = merge(
        DEFAULT_POLICY,
        raw.defaults === undefined ? {} : checkOverrides("defaults", raw.defaults, problems),
    );
    checkCombination("defaults", defaultPolicy, problems);

    const exact = new Map<string, HostPolicy>();
    const wildcards: { suffix: string; policy: HostPolicy }[] = [];
    if (raw.hosts !== undefined && !isRecord(raw.hosts)) {
        problems.push(`hosts: an object is expected, got ${describe(raw.hosts)}`);
    } else if (raw.hosts !== undefined) {
        for (const [key, overrides] of Object.entries(raw.hosts)) {
            const path = `hosts["${key}"]`;
            const name = checkHostKey(key, problems);
            const hostOverrides = checkOverrides(path, overrides, problems);
            const policy = merge(defaultPolicy, hostOverrides);
            // A combination inherited from the defaults is reported once, under "defaults".
            if ("csp" in hostOverrides || "frameAncestors" in hostOverrides) {
                checkCombination(path, policy, problems);
            }
            if (name === null) {
                continue;
            }
            if (key.startsWith("*.")) {
                wildcards.push({ suffix: name, policy });
            } else {
                exact.set(name, policy);
            }
        }
    }
    wildcards.sort((a, b) => b.suffix.length - a.suffix.length);

    let block: IpRange[] = [];
    let allow: IpRange[] = [];
    if (raw.ipFilter !== undefined && !isRecord(raw.ipFilter)) {
        problems.push(`ipFilter: an object is expected, got ${describe(raw.ipFilter)}`);
    } else if (raw.ipFilter !== undefined) {
        checkKeys("ipFilter", raw.ipFilter, IP_FILTER_KEYS, problems);
        block = compileRanges("ipFilter.block", raw.ipFilter.block, problems);
        allow = compileRanges("ipFilter.allow", raw.ipFilter.allow, problems);
    }

    if (problems.length > 0) {
        throw new ConfigError([...new Set(problems)]);
    }
    return { defaultPolicy, exact, wildcards, block, allow };
}

/** Policy of a host: exact name first, then the most specific `*.` pattern, then the defaults. */
export function policyFor(config: CompiledConfig, hostname: string): HostPolicy {
    const host = hostname.toLowerCase().replace(/\.$/, "");
    const exact = config.exact.get(host);
    if (exact !== undefined) {
        return exact;
    }
    for (const { suffix, policy } of config.wildcards) {
        if (host.endsWith(`.${suffix}`)) {
            return policy;
        }
    }
    return config.defaultPolicy;
}

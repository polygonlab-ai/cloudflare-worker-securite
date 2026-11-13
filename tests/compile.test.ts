import { describe, expect, it } from "vitest";
import { compileConfig, ConfigError, policyFor } from "../src/compile";
import exampleConfig from "../src/config";
import { DEFAULT_POLICY } from "../src/defaults";
import type { WorkerConfig } from "../src/types";

/** Problems reported for a configuration that is wrong at run time (as a JavaScript file could be). */
function problems(config: unknown): readonly string[] {
    try {
        compileConfig(config as WorkerConfig);
    } catch (error) {
        if (error instanceof ConfigError) {
            return error.problems;
        }
        throw error;
    }
    throw new Error("the configuration was accepted");
}

describe("valid configurations", () => {
    it("accepts an empty configuration and applies the defaults", () => {
        const config = compileConfig({});
        expect(config.defaultPolicy).toEqual(DEFAULT_POLICY);
        expect(config.exact.size).toBe(0);
        expect(config.wildcards).toEqual([]);
        expect(config.block).toEqual([]);
        expect(config.allow).toEqual([]);
    });

    it("accepts the example of src/config.ts", () => {
        expect(() => compileConfig(exampleConfig)).not.toThrow();
    });

    it("merges defaults, then host options, field by field", () => {
        const config = compileConfig({
            defaults: { referrerPolicy: "no-referrer", maintenance: { lang: "fr" } },
            hosts: { "www.example.com": { cspMode: "override", maintenance: { title: "Maintenance" } } },
        });
        const www = policyFor(config, "www.example.com");
        expect(www.referrerPolicy).toBe("no-referrer");
        expect(www.cspMode).toBe("override");
        expect(www.maintenance).toEqual({ ...DEFAULT_POLICY.maintenance, lang: "fr", title: "Maintenance" });
        expect(config.defaultPolicy.cspMode).toBe("keep-origin");
        expect(config.defaultPolicy.maintenance.lang).toBe("fr");
    });

    it("accepts every valid value of each option", () => {
        expect(() =>
            compileConfig({
                defaults: {
                    hsts: "max-age=0",
                    referrerPolicy: "no-referrer, strict-origin-when-cross-origin",
                    permissionsPolicy: "camera=(self), fullscreen=*",
                    crossOriginOpenerPolicy: "noopener-allow-popups",
                    crossOriginResourcePolicy: "cross-origin",
                    frameAncestors: false,
                    csp: "default-src 'self'; frame-ancestors https://partner.example.com",
                    removeHeaders: [],
                    maintenance: { title: "Pause", message: "Back soon.", lang: "fr-FR", retryAfter: 86400 },
                },
            }),
        ).not.toThrow();
    });
});

describe("host matching", () => {
    const config = compileConfig({
        hosts: {
            "www.example.com": { referrerPolicy: "no-referrer" },
            "*.example.com": { referrerPolicy: "same-origin" },
            "*.eu.example.com": { referrerPolicy: "origin" },
        },
    });

    it("uses the exact host first", () => {
        expect(policyFor(config, "www.example.com").referrerPolicy).toBe("no-referrer");
    });

    it("then the most specific pattern, at any depth", () => {
        expect(policyFor(config, "shop.example.com").referrerPolicy).toBe("same-origin");
        expect(policyFor(config, "a.b.example.com").referrerPolicy).toBe("same-origin");
        expect(policyFor(config, "shop.eu.example.com").referrerPolicy).toBe("origin");
    });

    it("gives the defaults to an unknown host", () => {
        expect(policyFor(config, "example.org")).toBe(config.defaultPolicy);
        expect(policyFor(config, "example.com")).toBe(config.defaultPolicy);
        expect(policyFor(config, "notexample.com")).toBe(config.defaultPolicy);
    });

    it("ignores case and a final dot", () => {
        expect(policyFor(config, "WWW.Example.COM.").referrerPolicy).toBe("no-referrer");
    });
});

describe("wrong configurations are rejected with a clear message", () => {
    it("lists every problem in the error message", () => {
        expect(() => compileConfig({ defaults: { hsts: "1 year", cspMode: "strict" as never } })).toThrow(
            /Invalid configuration \(src\/config\.ts\), 2 problem\(s\):\n {2}- defaults\.hsts: .*\n {2}- defaults\.cspMode: /,
        );
    });

    it.each([
        [null, "the configuration must be an object"],
        [{ host: {} }, 'config: unknown option "host"'],
        [{ defaults: [] }, "defaults: an object is expected"],
        [{ defaults: { hstss: "max-age=1" } }, 'defaults: unknown option "hstss"'],
        [{ defaults: { hsts: "includeSubDomains" } }, 'defaults.hsts: "max-age=<seconds>" is required'],
        [{ defaults: { hsts: "" } }, "defaults.hsts: a non-empty string or false is expected"],
        [{ defaults: { hsts: true } }, "defaults.hsts: a non-empty string or false is expected, got true"],
        [{ defaults: { hsts: "max-age=1\r\nSet-Cookie: a=b" } }, "line breaks and control characters"],
        [{ defaults: { contentTypeOptions: "sniff" } }, 'defaults.contentTypeOptions: expected "nosniff" or false'],
        [{ defaults: { referrerPolicy: "never" } }, 'unknown referrer policy "never"'],
        [{ defaults: { permissionsPolicy: "camera" } }, '"camera" is not a "feature=allowlist" entry'],
        [{ defaults: { crossOriginOpenerPolicy: "same-site" } }, "defaults.crossOriginOpenerPolicy: expected"],
        [{ defaults: { crossOriginResourcePolicy: "none" } }, "defaults.crossOriginResourcePolicy: expected"],
        [{ defaults: { frameAncestors: "all" } }, 'defaults.frameAncestors: expected "none", "self" or false'],
        [
            { defaults: { cspMode: false } },
            'defaults.cspMode: expected "override", "keep-origin", "report-only", got false',
        ],
        [{ defaults: { csp: "default-src 'self'; 'unsafe-inline'" } }, `"'unsafe-inline'" is not a CSP directive`],
        [{ defaults: { csp: "default-src 'self'; frame-ancestors 'self'" } }, '"frame-ancestors" is written in csp'],
        [{ defaults: { removeHeaders: "Server" } }, "defaults.removeHeaders: a list of header names is expected"],
        [{ defaults: { removeHeaders: ["X Bad"] } }, '"X Bad" is not a header name'],
        [{ defaults: { removeHeaders: [42] } }, "42 is not a header name"],
        [{ defaults: { removeHeaders: ["Content-Security-Policy"] } }, "is set by the Worker and cannot be removed"],
        [{ defaults: { maintenance: "down" } }, "defaults.maintenance: an object is expected"],
        [{ defaults: { maintenance: { colour: "red" } } }, 'defaults.maintenance: unknown option "colour"'],
        [{ defaults: { maintenance: { title: " " } } }, "defaults.maintenance.title: a non-empty string is expected"],
        [{ defaults: { maintenance: { message: 3 } } }, "defaults.maintenance.message: a non-empty string is expected"],
        [{ defaults: { maintenance: { lang: "english language" } } }, "defaults.maintenance.lang: a language tag"],
        [{ defaults: { maintenance: { retryAfter: 0 } } }, "defaults.maintenance.retryAfter: a whole number"],
        [{ defaults: { maintenance: { retryAfter: 1.5 } } }, "defaults.maintenance.retryAfter: a whole number"],
        [{ defaults: { maintenance: { retryAfter: "60" } } }, "defaults.maintenance.retryAfter: a whole number"],
        [{ hosts: [] }, "hosts: an object is expected"],
        [{ hosts: { "WWW.example.com": {} } }, 'hosts["WWW.example.com"]: host names must be written in lowercase'],
        [{ hosts: { "https://www.example.com": {} } }, "without scheme, port or path"],
        [{ hosts: { "www.example.com:8443": {} } }, "without scheme, port or path"],
        [{ hosts: { "www.*.example.com": {} } }, "without scheme, port or path"],
        [{ hosts: { "*.com": {} } }, "without scheme, port or path"],
        [{ hosts: { "-bad.example.com": {} } }, "without scheme, port or path"],
        [{ hosts: { "www.example.com": "override" } }, 'hosts["www.example.com"]: an object is expected'],
        [{ hosts: { "www.example.com": { cspMode: "strict" } } }, 'hosts["www.example.com"].cspMode: expected'],
        [{ hosts: { "www.example.com": { csp: "frame-ancestors *" } } }, 'hosts["www.example.com"]: "frame-ancestors"'],
        [{ ipFilter: [] }, "ipFilter: an object is expected"],
        [{ ipFilter: { deny: [] } }, 'ipFilter: unknown option "deny"'],
        [{ ipFilter: { block: "192.0.2.0/24" } }, "ipFilter.block: a list of addresses or CIDR ranges is expected"],
        [{ ipFilter: { block: ["192.0.2.0/40"] } }, 'ipFilter.block: "192.0.2.0/40": the prefix length'],
        [{ ipFilter: { allow: ["not-an-address"] } }, 'ipFilter.allow: "not-an-address" is not a valid address'],
        [{ ipFilter: { allow: [7] } }, "ipFilter.allow: 7 is not a string"],
    ])("rejects %j", (config, message) => {
        expect(problems(config).join("\n")).toContain(message);
    });

    it("gives the message shown in the README", () => {
        expect(() =>
            compileConfig({ hosts: { "WWW.example.com": {} }, ipFilter: { block: ["198.51.100.1/24"] } }),
        ).toThrow(
            [
                "Invalid configuration (src/config.ts), 2 problem(s):",
                '  - hosts["WWW.example.com"]: host names must be written in lowercase',
                '  - ipFilter.block: "198.51.100.1/24": the address has bits set after the prefix (the range starts at 198.51.100.0/24)',
            ].join("\n"),
        );
    });

    it("reports a problem of the defaults once, not once per host", () => {
        const found = problems({
            defaults: { csp: "default-src 'self'; frame-ancestors 'none'" },
            hosts: { "a.example.com": {}, "b.example.com": {} },
        });
        expect(found.filter((problem) => problem.includes("frame-ancestors"))).toEqual([
            expect.stringMatching(/^defaults: "frame-ancestors" is written in csp/),
        ]);
    });
});

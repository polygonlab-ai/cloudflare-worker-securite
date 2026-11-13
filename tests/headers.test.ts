import { describe, expect, it } from "vitest";
import { applyChanges, configuredCsp, CSP, CSP_REPORT_ONLY, generatedHeaders, planHeaders } from "../src/headers";
import { policy } from "./helpers";

const ORIGIN_CSP = "default-src 'self'; script-src 'self' https://charts.example.com";

function result(overrides: Parameters<typeof policy>[0], originHeaders: HeadersInit = {}): Headers {
    const headers = new Headers(originHeaders);
    applyChanges(headers, planHeaders(policy(overrides), headers));
    return headers;
}

describe("security headers", () => {
    it("sets every default header", () => {
        const headers = result({});
        expect(Object.fromEntries(headers)).toEqual({
            "strict-transport-security": "max-age=31536000; includeSubDomains",
            "x-content-type-options": "nosniff",
            "referrer-policy": "strict-origin-when-cross-origin",
            "permissions-policy":
                "accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=()",
            "cross-origin-opener-policy": "same-origin-allow-popups",
            "cross-origin-resource-policy": "same-site",
            "x-frame-options": "DENY",
            "content-security-policy": "object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        });
    });

    it("replaces the value sent by the origin", () => {
        const headers = result({}, { "Referrer-Policy": "unsafe-url", "X-Frame-Options": "ALLOWALL" });
        expect(headers.get("Referrer-Policy")).toBe("strict-origin-when-cross-origin");
        expect(headers.get("X-Frame-Options")).toBe("DENY");
    });

    it("leaves a header untouched when its option is false", () => {
        const headers = result(
            {
                hsts: false,
                contentTypeOptions: false,
                referrerPolicy: false,
                permissionsPolicy: false,
                crossOriginOpenerPolicy: false,
                crossOriginResourcePolicy: false,
                frameAncestors: false,
                csp: false,
            },
            { "Permissions-Policy": "camera=(self)" },
        );
        expect(Object.fromEntries(headers)).toEqual({ "permissions-policy": "camera=(self)" });
    });

    it("uses SAMEORIGIN and frame-ancestors 'self' when framing by the same site is allowed", () => {
        const headers = result({ frameAncestors: "self" });
        expect(headers.get("X-Frame-Options")).toBe("SAMEORIGIN");
        expect(headers.get(CSP)).toContain("frame-ancestors 'self'");
    });

    it("removes the configured headers and keeps the others", () => {
        const headers = result(
            { removeHeaders: ["Server", "X-Powered-By", "X-AspNet-Version", "X-Debug"] },
            {
                Server: "web-server/1.2",
                "X-Powered-By": "framework/3",
                "X-AspNet-Version": "4.0",
                "X-Debug": "on",
                "Content-Type": "text/html",
                "Cache-Control": "max-age=60",
            },
        );
        for (const name of ["Server", "X-Powered-By", "X-AspNet-Version", "X-Debug"]) {
            expect(headers.has(name)).toBe(false);
        }
        expect(headers.get("Content-Type")).toBe("text/html");
        expect(headers.get("Cache-Control")).toBe("max-age=60");
    });

    it("never adds a header that reveals the Worker or its timing", () => {
        const names = [...result({}).keys()];
        expect(names.filter((name) => /worker|timing|x-xss/i.test(name))).toEqual([]);
    });
});

describe("CSP modes", () => {
    const csp = "default-src 'self'";
    const expected = "default-src 'self'; frame-ancestors 'none'";

    it("override: imposes the configured CSP when the origin sends one", () => {
        const headers = result({ cspMode: "override", csp }, { [CSP]: ORIGIN_CSP });
        expect(headers.get(CSP)).toBe(expected);
        expect(headers.has(CSP_REPORT_ONLY)).toBe(false);
    });

    it("override: imposes the configured CSP when the origin sends none", () => {
        expect(result({ cspMode: "override", csp }).get(CSP)).toBe(expected);
    });

    it("keep-origin: keeps the CSP of the origin untouched", () => {
        const headers = result({ cspMode: "keep-origin", csp }, { [CSP]: ORIGIN_CSP });
        expect(headers.get(CSP)).toBe(ORIGIN_CSP);
        expect(headers.has(CSP_REPORT_ONLY)).toBe(false);
    });

    it("keep-origin: applies the configured CSP when the origin sends none", () => {
        expect(result({ cspMode: "keep-origin", csp }).get(CSP)).toBe(expected);
    });

    it("keep-origin is the default mode", () => {
        expect(result({}, { [CSP]: ORIGIN_CSP }).get(CSP)).toBe(ORIGIN_CSP);
    });

    it("report-only: reports the configured CSP and keeps the CSP of the origin", () => {
        const headers = result({ cspMode: "report-only", csp }, { [CSP]: ORIGIN_CSP });
        expect(headers.get(CSP_REPORT_ONLY)).toBe(expected);
        expect(headers.get(CSP)).toBe(ORIGIN_CSP);
    });

    it("report-only: blocks nothing when the origin sends no CSP", () => {
        const headers = result({ cspMode: "report-only", csp });
        expect(headers.get(CSP_REPORT_ONLY)).toBe(expected);
        expect(headers.has(CSP)).toBe(false);
    });

    it("csp false: the CSP of the origin is left as is, in every mode", () => {
        for (const cspMode of ["override", "keep-origin", "report-only"] as const) {
            const headers = result({ cspMode, csp: false }, { [CSP]: ORIGIN_CSP });
            expect(headers.get(CSP)).toBe(ORIGIN_CSP);
            expect(headers.has(CSP_REPORT_ONLY)).toBe(false);
        }
    });
});

describe("configuredCsp", () => {
    it("normalises the separators and appends frame-ancestors", () => {
        expect(configuredCsp(policy({ csp: " default-src 'self' ;; img-src * ;" }))).toBe(
            "default-src 'self'; img-src *; frame-ancestors 'none'",
        );
    });

    it("does not add frame-ancestors when framing is not managed", () => {
        expect(configuredCsp(policy({ csp: "default-src 'self'", frameAncestors: false }))).toBe("default-src 'self'");
    });

    it("returns null without a configured CSP", () => {
        expect(configuredCsp(policy({ csp: false }))).toBeNull();
    });
});

describe("generatedHeaders", () => {
    it("adds the security headers, the given CSP, the content type and no-store", () => {
        const headers = generatedHeaders(policy({ cspMode: "report-only" }), "text/plain", "default-src 'none'");
        expect(headers.get(CSP)).toBe("default-src 'none'");
        expect(headers.has(CSP_REPORT_ONLY)).toBe(false);
        expect(headers.get("Content-Type")).toBe("text/plain");
        expect(headers.get("Cache-Control")).toBe("no-store");
        expect(headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
    });
});

import { afterEach, describe, expect, it, vi } from "vitest";
import worker from "../src/index";
import { escapeHtml, maintenanceHtml } from "../src/maintenance";

afterEach(() => {
    vi.restoreAllMocks();
});

describe("entry point", () => {
    it("sends the request to the origin without following redirects", async () => {
        const spy = vi
            .spyOn(globalThis, "fetch")
            .mockResolvedValue(new Response(null, { status: 302, headers: { Location: "/login" } }));
        const response = await worker.fetch(new Request("https://www.example.com/account"));
        expect(spy).toHaveBeenCalledOnce();
        const [sent, init] = spy.mock.calls[0] ?? [];
        expect(sent).toBeInstanceOf(Request);
        expect((sent as Request).url).toBe("https://www.example.com/account");
        expect(init).toEqual({ redirect: "manual" });
        expect(response.status).toBe(302);
        expect(response.headers.get("Location")).toBe("/login");
        expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=63072000; includeSubDomains; preload");
    });

    it("applies the example configuration of src/config.ts", async () => {
        vi.spyOn(globalThis, "fetch").mockResolvedValue(
            new Response("<p>shop</p>", {
                headers: {
                    "Content-Security-Policy": "default-src 'self' https://charts.example.com",
                    "X-AspNetMvc-Version": "5",
                },
            }),
        );
        const response = await worker.fetch(new Request("https://shop.example.com/"));
        expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'self' https://charts.example.com");
        expect(response.headers.get("Permissions-Policy")).toBe(
            "camera=(), microphone=(), geolocation=(), payment=(self)",
        );
        expect(response.headers.has("X-AspNetMvc-Version")).toBe(false);
        expect(await response.text()).toBe("<p>shop</p>");
    });

    it("serves the maintenance page when the origin cannot be reached", async () => {
        vi.spyOn(globalThis, "fetch").mockRejectedValue(new TypeError("Network connection lost."));
        const response = await worker.fetch(new Request("https://blog.example.com/"));
        expect(response.status).toBe(503);
        expect(response.headers.get("Retry-After")).toBe("600");
        expect(await response.text()).toContain("<title>Maintenance en cours</title>");
    });
});

describe("start-up", () => {
    it("refuses to start with a wrong configuration", async () => {
        vi.resetModules();
        vi.doMock("../src/config", () => ({ default: { defaults: { cspMode: "strict" } } }));
        await expect(import("../src/index")).rejects.toThrow(/Invalid configuration \(src\/config\.ts\)/);
        vi.doUnmock("../src/config");
        vi.resetModules();
    });
});

describe("maintenance HTML", () => {
    it("escapes every special character", () => {
        expect(escapeHtml(`<a href="x" onclick='y'>&</a>`)).toBe(
            "&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;",
        );
    });

    it("is a neutral page without external resource", () => {
        const html = maintenanceHtml({ title: "Down", message: "Soon.", lang: "en", retryAfter: 60 }, "abc");
        expect(html).toContain('<meta name="robots" content="noindex">');
        expect(html).not.toMatch(/https?:|<script|<img|<link/);
    });
});

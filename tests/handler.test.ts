import { describe, expect, it } from "vitest";
import { handleRequest, isBlocked } from "../src/handler";
import { compiled, origin, request } from "./helpers";

const config = compiled({
    hosts: {
        "www.example.com": { cspMode: "override", csp: "default-src 'self'" },
        "*.example.com": { maintenance: { title: "Maintenance <en cours>", lang: "fr", retryAfter: 600 } },
    },
    ipFilter: {
        block: ["198.51.100.0/24", "2001:db8:bad::/48"],
        allow: ["198.51.100.7", "2001:db8:bad::7"],
    },
});

const ok = () => new Response("hello", { headers: { "Content-Type": "text/plain", Server: "web-server" } });

describe("origin responses", () => {
    it("passes the request to the origin and adds the headers of the host", async () => {
        const upstream = origin(ok);
        const response = await handleRequest(request("https://www.example.com/page?q=1"), config, upstream);
        expect(upstream.requests.map((r) => r.url)).toEqual(["https://www.example.com/page?q=1"]);
        expect(response.status).toBe(200);
        expect(await response.text()).toBe("hello");
        expect(response.headers.get("Content-Security-Policy")).toBe("default-src 'self'; frame-ancestors 'none'");
        expect(response.headers.get("Strict-Transport-Security")).toBe("max-age=31536000; includeSubDomains");
        expect(response.headers.has("Server")).toBe(false);
        expect(response.headers.get("Content-Type")).toBe("text/plain");
    });

    it("gives the default policy to an unknown host", async () => {
        const response = await handleRequest(request("https://other.example.org/"), config, origin(ok));
        expect(response.headers.get("Content-Security-Policy")).toBe(
            "object-src 'none'; base-uri 'self'; frame-ancestors 'none'",
        );
    });

    it("never modifies the body, byte for byte", async () => {
        const bytes = new Uint8Array(4096).map((_, index) => (index * 31) % 256);
        const response = await handleRequest(
            request("https://www.example.com/file.bin"),
            config,
            origin(() => new Response(bytes, { headers: { "Content-Type": "application/octet-stream" } })),
        );
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
    });

    it("keeps redirects, their status and their Location", async () => {
        for (const status of [301, 302, 307, 308]) {
            const response = await handleRequest(
                request("https://www.example.com/old"),
                config,
                origin(() => new Response(null, { status, headers: { Location: "https://www.example.com/new" } })),
            );
            expect(response.status).toBe(status);
            expect(response.headers.get("Location")).toBe("https://www.example.com/new");
            expect(response.headers.get("X-Frame-Options")).toBe("DENY");
        }
    });

    it("keeps the status, the status text and every Set-Cookie header", async () => {
        const headers = new Headers();
        headers.append("Set-Cookie", "a=1; Secure");
        headers.append("Set-Cookie", "b=2; Secure");
        const response = await handleRequest(
            request("https://www.example.com/missing"),
            config,
            origin(() => new Response("not found", { status: 404, statusText: "Not Found", headers })),
        );
        expect(response.status).toBe(404);
        expect(response.statusText).toBe("Not Found");
        expect(response.headers.getSetCookie()).toEqual(["a=1; Secure", "b=2; Secure"]);
    });

    it("passes a WebSocket handshake through untouched", async () => {
        const pair = new WebSocketPair();
        const handshake = new Response(null, { status: 101, webSocket: pair[0] });
        const response = await handleRequest(
            request("https://www.example.com/socket"),
            config,
            origin(() => handshake),
        );
        expect(response).toBe(handshake);
    });
});

describe("maintenance page", () => {
    it.each([521, 522, 523, 525, 526, 530])("replaces a %i from Cloudflare", async (status) => {
        const response = await handleRequest(
            request("https://www.example.com/"),
            config,
            origin(() => new Response("origin error page", { status })),
        );
        expect(response.status).toBe(503);
        expect(response.headers.get("Retry-After")).toBe("300");
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        expect(response.headers.get("Content-Type")).toBe("text/html; charset=utf-8");
        const html = await response.text();
        expect(html).toContain("<title>Temporarily unavailable</title>");
        expect(html).not.toContain("origin error page");
    });

    it("replaces a network error", async () => {
        const failing = () => Promise.reject(new TypeError("Network connection lost."));
        const response = await handleRequest(request("https://shop.example.com/"), config, failing);
        expect(response.status).toBe(503);
        expect(response.headers.get("Retry-After")).toBe("600");
        const html = await response.text();
        expect(html).toContain('<html lang="fr">');
        expect(html).toContain("<h1>Maintenance &lt;en cours&gt;</h1>");
    });

    it("protects the page with a strict CSP whose nonce matches the style", async () => {
        const response = await handleRequest(
            request("https://www.example.com/"),
            config,
            origin(() => new Response(null, { status: 522 })),
        );
        const csp = response.headers.get("Content-Security-Policy") ?? "";
        const nonce = /'nonce-([0-9a-f]{32})'/.exec(csp)?.[1];
        expect(csp).toMatch(
            /^default-src 'none'; style-src 'nonce-[0-9a-f]{32}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'$/,
        );
        expect(await response.text()).toContain(`<style nonce="${String(nonce)}">`);
        expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    });

    it("uses a new nonce for each page", async () => {
        const down = origin(() => new Response(null, { status: 522 }));
        const first = await handleRequest(request("https://www.example.com/"), config, down);
        const second = await handleRequest(request("https://www.example.com/"), config, down);
        expect(first.headers.get("Content-Security-Policy")).not.toBe(second.headers.get("Content-Security-Policy"));
    });

    it("leaves other server errors of the origin as they are", async () => {
        for (const status of [500, 502, 503, 504, 520, 524]) {
            const response = await handleRequest(
                request("https://www.example.com/"),
                config,
                origin(() => new Response("origin page", { status })),
            );
            expect(response.status).toBe(status);
            expect(await response.text()).toBe("origin page");
        }
    });

    it("answers a HEAD request without a body", async () => {
        const response = await handleRequest(
            request("https://www.example.com/", { method: "HEAD" }),
            config,
            origin(() => new Response(null, { status: 521 })),
        );
        expect(response.status).toBe(503);
        expect(await response.text()).toBe("");
    });
});

describe("address blocking", () => {
    it.each([
        ["198.51.100.42", "IPv4"],
        ["2001:db8:bad:1::9", "IPv6"],
        ["::ffff:198.51.100.42", "IPv4-mapped IPv6"],
    ])("blocks %s (%s) with a sober 403, without calling the origin", async (ip) => {
        const upstream = origin(ok);
        const response = await handleRequest(request("https://www.example.com/", { ip }), config, upstream);
        expect(response.status).toBe(403);
        expect(await response.text()).toBe("Access denied.\n");
        expect(response.headers.get("Content-Type")).toBe("text/plain; charset=utf-8");
        expect(response.headers.get("Cache-Control")).toBe("no-store");
        expect(response.headers.get("Content-Security-Policy")).toBe(
            "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
        );
        expect(upstream.requests).toEqual([]);
    });

    it("does not reveal the rule that was applied", async () => {
        const response = await handleRequest(
            request("https://www.example.com/", { ip: "198.51.100.42" }),
            config,
            origin(ok),
        );
        const text = [await response.text(), ...[...response.headers].flat()].join("\n");
        expect(text).not.toMatch(/198\.51\.100|2001:db8|block|range|rule/i);
    });

    it("lets an exception win over a block, in IPv4 and IPv6", async () => {
        for (const ip of ["198.51.100.7", "2001:db8:bad::7"]) {
            const response = await handleRequest(request("https://www.example.com/", { ip }), config, origin(ok));
            expect(response.status).toBe(200);
        }
    });

    it("lets other visitors through", async () => {
        for (const ip of ["192.0.2.10", "203.0.113.5", "2001:db8:bae::1"]) {
            const response = await handleRequest(request("https://www.example.com/", { ip }), config, origin(ok));
            expect(response.status).toBe(200);
        }
    });

    it("answers a blocked HEAD request without a body", async () => {
        const response = await handleRequest(
            request("https://www.example.com/", { method: "HEAD", ip: "198.51.100.1" }),
            config,
            origin(ok),
        );
        expect(response.status).toBe(403);
        expect(await response.text()).toBe("");
    });

    it("does not filter a request without a readable address", () => {
        expect(isBlocked(config, null)).toBe(false);
        expect(isBlocked(config, "unknown")).toBe(false);
        expect(isBlocked(compiled({ ipFilter: { allow: ["192.0.2.1"] } }), "192.0.2.9")).toBe(false);
    });
});

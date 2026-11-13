import { describe, expect, it } from "vitest";
import { matchesAny, parseIp, parseRange, rangeContains, type IpRange } from "../src/ip";

function range(text: string): IpRange {
    const parsed = parseRange(text);
    if (typeof parsed === "string") {
        throw new Error(parsed);
    }
    return parsed;
}

function address(text: string) {
    const parsed = parseIp(text);
    if (parsed === null) {
        throw new Error(`invalid address ${text}`);
    }
    return parsed;
}

describe("parseIp", () => {
    it("reads IPv4 addresses", () => {
        expect(parseIp("192.0.2.1")).toEqual({ version: 4, value: 0xc0000201n });
        expect(parseIp(" 203.0.113.255 ")).toEqual({ version: 4, value: 0xcb0071ffn });
    });

    it("reads IPv6 addresses in every notation", () => {
        const full = { version: 6, value: 0x20010db8000000000000000000000001n };
        expect(parseIp("2001:db8::1")).toEqual(full);
        expect(parseIp("2001:0DB8:0000:0000:0000:0000:0000:0001")).toEqual(full);
        expect(parseIp("::")).toEqual({ version: 6, value: 0n });
        expect(parseIp("2001:db8::")).toEqual({ version: 6, value: 0x20010db8n << 96n });
        expect(parseIp("2001:db8::192.0.2.1")).toEqual({ version: 6, value: (0x20010db8n << 96n) | 0xc0000201n });
    });

    it("reads an IPv4-mapped IPv6 address as IPv4", () => {
        expect(parseIp("::ffff:192.0.2.1")).toEqual({ version: 4, value: 0xc0000201n });
        expect(parseIp("::ffff:c000:201")).toEqual({ version: 4, value: 0xc0000201n });
    });

    it.each([
        "",
        "192.0.2",
        "192.0.2.1.5",
        "192.0.2.256",
        "192.0.2.01",
        "192.0.2.a",
        "2001:db8:::1",
        "2001:db8::1::2",
        "1:2:3:4:5:6:7:8:9",
        "1:2:3:4:5:6:7",
        "1:2:3:4:5:6:7:8::",
        "2001:db8::12345",
        "2001:db8::1%eth0",
        "2001:db8::192.0.2.300",
        "example.com",
    ])("rejects %j", (text) => {
        expect(parseIp(text)).toBeNull();
    });
});

describe("parseRange", () => {
    it("reads CIDR ranges and single addresses", () => {
        expect(range("192.0.2.0/24")).toEqual({ version: 4, network: 0xc0000200n, prefix: 24 });
        expect(range("192.0.2.7")).toEqual({ version: 4, network: 0xc0000207n, prefix: 32 });
        expect(range("0.0.0.0/0")).toEqual({ version: 4, network: 0n, prefix: 0 });
        expect(range("2001:db8::/32")).toEqual({ version: 6, network: 0x20010db8n << 96n, prefix: 32 });
        expect(range("2001:db8::1")).toEqual({ version: 6, network: (0x20010db8n << 96n) | 1n, prefix: 128 });
    });

    it.each([
        ["192.0.2.0/33", "between 0 and 32"],
        ["2001:db8::/129", "between 0 and 128"],
        ["192.0.2.0/", "between 0 and 32"],
        ["192.0.2.0/024", "between 0 and 32"],
        ["192.0.2.0/2a", "between 0 and 32"],
        ["192.0.2.0/24/8", "not a valid address"],
        ["192.0.2/24", "not a valid address"],
        ["192.0.2.1/24", "the range starts at 192.0.2.0/24"],
        ["2001:db8::1/32", "the range starts at 2001:db8:0:0:0:0:0:0/32"],
    ])("rejects %j", (text, message) => {
        const parsed = parseRange(text);
        expect(typeof parsed).toBe("string");
        expect(parsed).toContain(message);
    });
});

describe("matching", () => {
    it("matches an IPv4 range", () => {
        expect(rangeContains(range("198.51.100.0/24"), address("198.51.100.42"))).toBe(true);
        expect(rangeContains(range("198.51.100.0/24"), address("192.0.2.10"))).toBe(false);
        expect(rangeContains(range("0.0.0.0/0"), address("203.0.113.9"))).toBe(true);
    });

    it("matches an IPv6 range", () => {
        expect(rangeContains(range("2001:db8:bad::/48"), address("2001:db8:bad:1::5"))).toBe(true);
        expect(rangeContains(range("2001:db8:bad::/48"), address("2001:db8:bae::5"))).toBe(false);
    });

    it("never mixes IPv4 and IPv6", () => {
        expect(rangeContains(range("::/0"), address("192.0.2.1"))).toBe(false);
        expect(rangeContains(range("0.0.0.0/0"), address("2001:db8::1"))).toBe(false);
    });

    it("matches an IPv4-mapped IPv6 visitor against an IPv4 range", () => {
        expect(matchesAny([range("192.0.2.0/24")], address("::ffff:192.0.2.9"))).toBe(true);
    });

    it("matchesAny is false for an empty list", () => {
        expect(matchesAny([], address("192.0.2.1"))).toBe(false);
    });
});

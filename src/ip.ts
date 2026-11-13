/**
 * IPv4 and IPv6 addresses and CIDR ranges. Pure functions, no dependency.
 *
 * Addresses are held as `bigint` (32 bits for IPv4, 128 bits for IPv6). An IPv4-mapped IPv6
 * address (`::ffff:192.0.2.1`) is matched as the IPv4 address it carries.
 */

export interface IpAddress {
    readonly version: 4 | 6;
    readonly value: bigint;
}

export interface IpRange {
    readonly version: 4 | 6;
    readonly network: bigint;
    readonly prefix: number;
}

const BITS = { 4: 32, 6: 128 } as const;
const IPV4_PART = /^(?:0|[1-9]\d{0,2})$/;
const IPV6_GROUP = /^[0-9a-f]{1,4}$/i;
const IPV4_MAPPED_PREFIX = 0xffffn;

function parseIpv4(text: string): bigint | null {
    const parts = text.split(".");
    if (parts.length !== 4) {
        return null;
    }
    let value = 0n;
    for (const part of parts) {
        if (!IPV4_PART.test(part) || Number(part) > 255) {
            return null;
        }
        value = (value << 8n) | BigInt(part);
    }
    return value;
}

function parseGroups(text: string): bigint[] | null {
    if (text === "") {
        return [];
    }
    const groups: bigint[] = [];
    const parts = text.split(":");
    for (const [index, part] of parts.entries()) {
        if (index === parts.length - 1 && part.includes(".")) {
            const ipv4 = parseIpv4(part);
            if (ipv4 === null) {
                return null;
            }
            groups.push(ipv4 >> 16n, ipv4 & 0xffffn);
        } else if (IPV6_GROUP.test(part)) {
            groups.push(BigInt(`0x${part}`));
        } else {
            return null;
        }
    }
    return groups;
}

function parseIpv6(text: string): bigint | null {
    const halves = text.split("::");
    if (halves.length > 2) {
        return null;
    }
    const head = parseGroups(halves[0] ?? "");
    const tail = halves.length === 2 ? parseGroups(halves[1] ?? "") : [];
    if (head === null || tail === null) {
        return null;
    }
    const missing = 8 - head.length - tail.length;
    if (halves.length === 2 ? missing < 1 : missing !== 0) {
        return null;
    }
    const groups = [...head, ...Array<bigint>(missing).fill(0n), ...tail];
    return groups.reduce((value, group) => (value << 16n) | group, 0n);
}

/** Parses an address as written in a configuration (no IPv4-mapped conversion). */
function parseLiteral(text: string): IpAddress | null {
    if (text.includes(":")) {
        const value = parseIpv6(text);
        return value === null ? null : { version: 6, value };
    }
    const value = parseIpv4(text);
    return value === null ? null : { version: 4, value };
}

/**
 * Parses a visitor address. Returns `null` for anything that is not a plain IPv4 or IPv6
 * address. An IPv4-mapped IPv6 address is returned as IPv4.
 */
export function parseIp(text: string): IpAddress | null {
    const address = parseLiteral(text.trim());
    if (address?.version === 6 && address.value >> 32n === IPV4_MAPPED_PREFIX) {
        return { version: 4, value: address.value & 0xffffffffn };
    }
    return address;
}

function mask(version: 4 | 6, prefix: number): bigint {
    const bits = BigInt(BITS[version]);
    const all = (1n << bits) - 1n;
    return (all >> BigInt(prefix)) ^ all;
}

/**
 * Parses a range (`192.0.2.0/24`, `2001:db8::/32`) or a single address. Returns an error
 * message when the text is not a valid range.
 */
export function parseRange(text: string): IpRange | string {
    const [addressText = "", prefixText, extra] = text.split("/");
    if (extra !== undefined) {
        return `"${text}" is not a valid address or CIDR range`;
    }
    const address = parseLiteral(addressText);
    if (address === null) {
        return `"${text}" is not a valid address or CIDR range`;
    }
    const bits = BITS[address.version];
    if (prefixText === undefined) {
        return { version: address.version, network: address.value, prefix: bits };
    }
    if (!/^(?:0|[1-9]\d{0,2})$/.test(prefixText) || Number(prefixText) > bits) {
        return `"${text}": the prefix length must be between 0 and ${String(bits)}`;
    }
    const prefix = Number(prefixText);
    const network = address.value & mask(address.version, prefix);
    if (network !== address.value) {
        return `"${text}": the address has bits set after the prefix (the range starts at ${formatNetwork(address.version, network)}/${String(prefix)})`;
    }
    return { version: address.version, network, prefix };
}

function formatNetwork(version: 4 | 6, value: bigint): string {
    if (version === 4) {
        return [24n, 16n, 8n, 0n].map((shift) => String((value >> shift) & 0xffn)).join(".");
    }
    const groups: string[] = [];
    for (let shift = 112n; shift >= 0n; shift -= 16n) {
        groups.push(((value >> shift) & 0xffffn).toString(16));
    }
    return groups.join(":");
}

export function rangeContains(range: IpRange, address: IpAddress): boolean {
    return range.version === address.version && (address.value & mask(range.version, range.prefix)) === range.network;
}

export function matchesAny(ranges: readonly IpRange[], address: IpAddress): boolean {
    return ranges.some((range) => rangeContains(range, address));
}

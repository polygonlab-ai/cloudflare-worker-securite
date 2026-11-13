/**
 * Request handling: address filter, call to the origin, maintenance page, security headers.
 *
 * The body of an origin response is never read nor modified: it is streamed to the visitor as is.
 */

import { policyFor, type CompiledConfig } from "./compile";
import { MAINTENANCE_STATUSES } from "./defaults";
import { applyChanges, generatedHeaders, planHeaders } from "./headers";
import { matchesAny, parseIp } from "./ip";
import { maintenanceCsp, maintenanceHtml } from "./maintenance";
import type { HostPolicy } from "./types";

/** Sends the request to the origin. Injected so that tests run without network. */
export type OriginFetch = (request: Request) => Promise<Response>;

/** Header set by Cloudflare with the address of the visitor (it cannot be forged by the visitor). */
export const CLIENT_IP_HEADER = "CF-Connecting-IP";

const FORBIDDEN_CSP = "default-src 'none'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/**
 * True when the visitor must receive a 403: the address is in a blocked range and in no
 * exception. A request without a readable address (only possible outside Cloudflare) is not
 * filtered.
 */
export function isBlocked(config: CompiledConfig, clientIp: string | null): boolean {
    if (clientIp === null || config.block.length === 0) {
        return false;
    }
    const address = parseIp(clientIp);
    if (address === null) {
        return false;
    }
    return !matchesAny(config.allow, address) && matchesAny(config.block, address);
}

function bodyFor(request: Request, body: string): string | null {
    return request.method === "HEAD" ? null : body;
}

export function forbiddenResponse(request: Request, policy: HostPolicy): Response {
    return new Response(bodyFor(request, "Access denied.\n"), {
        status: 403,
        headers: generatedHeaders(policy, "text/plain; charset=utf-8", FORBIDDEN_CSP),
    });
}

export function maintenanceResponse(request: Request, policy: HostPolicy): Response {
    const nonce = crypto.randomUUID().replaceAll("-", "");
    const headers = generatedHeaders(policy, "text/html; charset=utf-8", maintenanceCsp(nonce));
    headers.set("Retry-After", String(policy.maintenance.retryAfter));
    return new Response(bodyFor(request, maintenanceHtml(policy.maintenance, nonce)), {
        status: 503,
        headers,
    });
}

export async function handleRequest(
    request: Request,
    config: CompiledConfig,
    originFetch: OriginFetch,
): Promise<Response> {
    const policy = policyFor(config, new URL(request.url).hostname);

    if (isBlocked(config, request.headers.get(CLIENT_IP_HEADER))) {
        return forbiddenResponse(request, policy);
    }

    let origin: Response;
    try {
        origin = await originFetch(request);
    } catch {
        return maintenanceResponse(request, policy);
    }

    if (MAINTENANCE_STATUSES.has(origin.status)) {
        await origin.body?.cancel();
        return maintenanceResponse(request, policy);
    }

    // A WebSocket handshake cannot be copied: it is passed through untouched.
    if (origin.status === 101) {
        return origin;
    }

    const response = new Response(origin.body, origin);
    applyChanges(response.headers, planHeaders(policy, origin.headers));
    return response;
}

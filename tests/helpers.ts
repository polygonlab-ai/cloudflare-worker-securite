import { compileConfig, type CompiledConfig } from "../src/compile";
import { DEFAULT_POLICY } from "../src/defaults";
import type { OriginFetch } from "../src/handler";
import type { HostOverrides, HostPolicy, WorkerConfig } from "../src/types";

/** Default policy with some options changed. */
export function policy(overrides: HostOverrides = {}): HostPolicy {
    return {
        ...DEFAULT_POLICY,
        ...overrides,
        maintenance: { ...DEFAULT_POLICY.maintenance, ...overrides.maintenance },
    };
}

export function compiled(config: WorkerConfig = {}): CompiledConfig {
    return compileConfig(config);
}

/** Origin that always answers with the given response, and records the requests it receives. */
export function origin(response: () => Response): OriginFetch & { readonly requests: Request[] } {
    const requests: Request[] = [];
    const fetchOrigin = (request: Request): Promise<Response> => {
        requests.push(request);
        return Promise.resolve(response());
    };
    return Object.assign(fetchOrigin, { requests });
}

export function request(url: string, init: RequestInit & { ip?: string } = {}): Request {
    const { ip, ...rest } = init;
    const headers = new Headers(rest.headers);
    if (ip !== undefined) {
        headers.set("CF-Connecting-IP", ip);
    }
    return new Request(url, { ...rest, headers });
}

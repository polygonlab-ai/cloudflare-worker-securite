/**
 * Entry point of the Worker.
 *
 * The configuration is checked once, when the Worker starts: a wrong configuration makes the
 * deployment fail with a message listing every problem (see `ConfigError`).
 */

import { compileConfig } from "./compile";
import config from "./config";
import { handleRequest } from "./handler";

const compiled = compileConfig(config);

export default {
    fetch(request: Request): Promise<Response> {
        // `manual`: redirects of the origin are passed to the visitor, never followed by the Worker.
        return handleRequest(request, compiled, (outgoing) => fetch(outgoing, { redirect: "manual" }));
    },
} satisfies ExportedHandler;

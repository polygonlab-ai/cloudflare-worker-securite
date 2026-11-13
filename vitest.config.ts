import { cloudflareTest } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

// Tests run inside the Workers runtime (workerd), with the settings of wrangler.toml.
export default defineConfig({
    plugins: [cloudflareTest({ wrangler: { configPath: "./wrangler.toml" } })],
    test: {
        coverage: {
            provider: "istanbul",
            include: ["src/**/*.ts"],
            reporter: ["text", "json-summary"],
            thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
        },
    },
});

import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const root = fileURLToPath(new URL(".", import.meta.url));

// The real SDK lives on an auth-gated registry. Until it is installed, the game
// builds against a local stub with the same surface so it still runs in a browser.
const hasLittleSdk = existsSync(`${root}node_modules/@kabletv/little-sdk/package.json`);

export default defineConfig({
  resolve: {
    alias: hasLittleSdk
      ? {}
      : { "@kabletv/little-sdk": `${root}src/platform/little-stub.ts` },
  },
  define: {
    __LITTLE_STUB__: JSON.stringify(!hasLittleSdk),
  },
  build: {
    target: "es2020",
    assetsInlineLimit: 0,
    chunkSizeWarningLimit: 1200,
  },
  server: {
    strictPort: true,
  },
});

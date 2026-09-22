// Replaces @lovable.dev/vite-tanstack-config, which bundled these plugins and forced a
// Cloudflare nitro preset inside Lovable's own build. Everything it set up that this app
// relies on is spelled out here: the TanStack Start plugin (SSR entry at src/server.ts),
// React, Tailwind, tsconfig path aliases, the "@" alias, React/Query dedupe, and nitro.
//
// The server preset comes from NITRO_PRESET (node-server in production).
import { defineConfig } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import tsConfigPaths from "vite-tsconfig-paths";
import { nitro } from "nitro/vite";

export default defineConfig({
  server: {
    host: "::",
    port: 8080,
  },
  plugins: [
    tsConfigPaths({ projects: ["./tsconfig.json"] }),
    tailwindcss(),
    tanstackStart({
      // src/server.ts wraps the SSR handler with our error reporting.
      server: { entry: "server" },
    }),
    nitro(),
    viteReact(),
  ],
  resolve: {
    alias: { "@": `${process.cwd()}/src` },
    dedupe: [
      "react",
      "react-dom",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "@tanstack/react-query",
      "@tanstack/query-core",
    ],
  },
});

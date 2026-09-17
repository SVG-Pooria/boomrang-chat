import { defineConfig, loadEnv } from "vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitro } from "nitro/vite";
import viteReact from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const env = loadEnv(process.env["NODE_ENV"] ?? "development", process.cwd(), "");
const backendOrigin = env["BACKEND_ORIGIN"] || "http://127.0.0.1:1234";

const proxy = {
  "/api": { target: backendOrigin, changeOrigin: true },
  "/socket.io": { target: backendOrigin, changeOrigin: true, ws: true },
};

export default defineConfig(({ command }) => ({
  css: { transformer: "lightningcss" as const },
  resolve: {
    tsconfigPaths: true,
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
  optimizeDeps: {
    include: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
    ],
  },
  server: { proxy },
  preview: { proxy },
  plugins: [
    tailwindcss(),
    tanstackStart({
      server: { entry: "server" },
      spa: { enabled: true },
      prerender: { filter: () => false },
      importProtection: {
        behavior: "error",
        client: { files: ["**/server/**"], specifiers: ["server-only"] },
      },
    }),
    ...(command === "build" ? [nitro({ preset: "node-server" })] : []),
    viteReact(),
  ],
}));

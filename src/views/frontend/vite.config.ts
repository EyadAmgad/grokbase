import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { loadEnv } from "vite";

// This project lives at src/views/frontend and builds into the FastAPI-served
// static directory (src/views/static/react), so the shell app can be reached
// at http://localhost:8000/static/react/ without touching main.py.
//
// In dev (`npm run dev`), proxy backend traffic so the adapter can use
// relative "/api" URLs — the same code path as production.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    base: "/static/react/",
    plugins: [react(), tailwindcss()],
    build: {
      outDir: "../static/react",
      emptyOutDir: true,
    },
    server: {
      port: 5173,
      proxy: {
        "/api": {
          target: env.VITE_PROXY_TARGET || "http://localhost:8000",
          changeOrigin: true,
        },
      },
    },
  };
});

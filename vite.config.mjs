import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const localKeyPath = resolve("certs/local-dev-key.pem");
const localCertPath = resolve("certs/local-dev-cert.pem");
const localHttps = existsSync(localKeyPath) && existsSync(localCertPath)
  ? {
      key: readFileSync(localKeyPath),
      cert: readFileSync(localCertPath),
    }
  : true;

export default defineConfig({
  optimizeDeps: {
    include: ["react", "react-dom/client"],
  },
  server: {
    host: "0.0.0.0",
    https: localHttps,
    proxy: {
      "/api": "http://127.0.0.1:4174",
    },
    warmup: {
      clientFiles: ["./src/main.jsx"],
    },
  },
  plugins: [react()],
});

import { spawn } from "node:child_process";

const run = (name, command, args, env = {}) => {
  const child = spawn(command, args, {
    env: { ...process.env, ...env },
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    if (code && code !== 0) process.exit(code);
  });

  return child;
};

const api = run("api", "node", ["server/server.mjs"]);
const vite = run("vite", process.platform === "win32" ? "cmd" : "npm", process.platform === "win32"
  ? ["/c", "npm", "run", "dev:vite", "--", "--port", "5173"]
  : ["run", "dev:vite", "--", "--port", "5173"]);

const shutdown = () => {
  api.kill("SIGTERM");
  vite.kill("SIGTERM");
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

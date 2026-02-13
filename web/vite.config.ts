import { fileURLToPath, URL } from "node:url";
import type { Socket } from "node:net";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { createLogger, defineConfig, type Logger } from "vite";

const IGNORABLE_WS_PROXY_ERROR_CODES = new Set(["EPIPE", "ECONNRESET", "ECONNREFUSED"]);

function isIgnorableWsProxyError(error: unknown): boolean {
  if (!(error instanceof Error)) {
    return false;
  }

  const code = (error as NodeJS.ErrnoException).code;
  return typeof code === "string" && IGNORABLE_WS_PROXY_ERROR_CODES.has(code);
}

function isWsProxyLogMessage(message: string): boolean {
  return message.includes("ws proxy error") || message.includes("ws proxy socket error");
}

function destroySocketSafe(socket: Socket | null | undefined): void {
  if (socket == null || socket.destroyed) {
    return;
  }

  try {
    socket.destroy();
  } catch {
    // Ignore teardown races on sockets that are already closing.
  }
}

const viteLogger = createLogger();
const filteredLogger: Logger = {
  ...viteLogger,
  error(message, options) {
    const shouldSilence =
      isWsProxyLogMessage(message) &&
      (isIgnorableWsProxyError(options?.error) || /EPIPE|ECONNRESET|ECONNREFUSED/u.test(message));

    if (shouldSilence) {
      return;
    }

    viteLogger.error(message, options);
  },
};

export default defineConfig({
  customLogger: filteredLogger,
  plugins: [react(), tailwindcss()],
  build: {
    chunkSizeWarningLimit: 1300,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (!id.includes("node_modules")) {
            return undefined;
          }

          if (id.includes("phaser")) {
            return "vendor-phaser";
          }
          if (id.includes("framer-motion")) {
            return "vendor-motion";
          }
          if (id.includes("react") || id.includes("scheduler")) {
            return "vendor-react";
          }

          return "vendor-misc";
        },
      },
    },
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "@server": fileURLToPath(new URL("./server", import.meta.url)),
    },
  },
  server: {
    port: 3210,
    watch: {
      ignored: ["**/game-state.yaml"],
    },
    proxy: {
      "/api": {
        target: "http://localhost:3200",
        changeOrigin: true,
      },
      "/ws": {
        target: "http://localhost:3200",
        ws: true,
        changeOrigin: true,
        configure(proxy) {
          proxy.on("error", (error, _request, socket) => {
            if (!isIgnorableWsProxyError(error)) {
              return;
            }

            destroySocketSafe(socket as Socket | undefined);
          });
          proxy.on("close", (_response, socket) => {
            destroySocketSafe(socket as Socket | undefined);
          });
        },
      },
    },
  },
});

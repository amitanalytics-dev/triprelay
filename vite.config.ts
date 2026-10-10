import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  return {
    plugins: [react()],
    define: {
      "import.meta.env.VITE_CONVEX_URL": JSON.stringify(
        env.VITE_CONVEX_URL || env.CONVEX_URL,
      ),
    },
    server: { host: "127.0.0.1", port: 5173, strictPort: true },
  };
});

import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath, URL } from "node:url";
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  if (
    env.VERCEL_ENV === "production" &&
    (!env.VITE_API_URL?.startsWith("https://") ||
      env.VITE_API_URL.includes(".invalid"))
  )
    throw new Error("Set the production HTTPS VITE_API_URL");
  return {
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
    },
  };
});

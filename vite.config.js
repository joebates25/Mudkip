import { defineConfig } from "vite";

export default defineConfig({
  // Required for Electron file:// loading. Absolute /assets paths break in packaged desktop builds.
  base: "./",
});

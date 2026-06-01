import { defineConfig } from "vitest/config";

// Unit tests run in a plain Node environment — the modules under test
// are deliberately dependency-free (no React/DOM/Supabase). Keep test
// files colocated with the code they cover (app/**/*.test.ts).
export default defineConfig({
  test: {
    environment: "node",
    include: ["app/**/*.test.ts", "app/**/*.test.tsx"],
  },
});

import { defineConfig } from "drizzle-kit";

export default defineConfig({
  dialect: "sqlite",
  out: "./drizzle",
  schema: "./src/lib/server/schema.ts",
  dbCredentials: {
    url: ".promptbar/promptbar.sqlite",
  },
});

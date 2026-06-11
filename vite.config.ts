import { defineConfig } from "vite-plus";

export default defineConfig({
  staged: {
    "*": "vp check --fix",
  },
  pack: {
    dts: {
      tsgo: true,
      build: true,
      incremental: true,
    },
    format: ["esm"],
    exports: true,
    entry: ["./src/index.ts", "./src/client.ts"],
    treeshake: true,
  },
  lint: {
    options: {
      typeAware: true,
      typeCheck: true,
    },
    ignorePatterns: ["tests/*", "examples/**"],
  },
  fmt: {},
  test: {
    clearMocks: true,
    restoreMocks: true,
  },
});

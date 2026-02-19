import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/providers/niconico/index.ts"
  ],
  format: ["esm", "cjs"],
  dts: true,              // 型定義も自動生成
  splitting: false,       // ライブラリなら基本false
  sourcemap: true,
  clean: true,
  outDir: "dist",
  target: "es2020",
  external: ["events", "ws", "protobufjs/minimal.js"],
});

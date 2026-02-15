import esbuild from 'rollup-plugin-esbuild';
import dts from 'rollup-plugin-dts';

const external = ['events', 'ws', 'protobufjs/minimal.js'];

/** @type {import('rollup').RollupOptions[]} */
export default [
  // JS bundles
  {
    input: {
      index: 'src/index.ts',
      'providers/niconico/index': 'src/providers/niconico/index.ts',
    },
    output: {
      dir: 'dist',
      format: 'esm',
      sourcemap: true,
      chunkFileNames: '[name].js',
    },
    external,
    plugins: [esbuild({ target: 'esnext' })],
  },
  // Declaration bundles
  {
    input: {
      index: 'src/index.ts',
      'providers/niconico/index': 'src/providers/niconico/index.ts',
    },
    output: {
      dir: 'dist',
      format: 'esm',
    },
    external,
    plugins: [dts()],
  },
];

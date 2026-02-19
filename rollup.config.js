import esbuild from 'rollup-plugin-esbuild';
import typescript from '@rollup/plugin-typescript';

const external = ['events', 'ws', 'protobufjs/minimal.js'];

/** @type {import('rollup').RollupOptions[]} */
export default {
  input: {
    index: 'src/index.ts',
    'providers/niconico/index': 'src/providers/niconico/index.ts',
  },
  output: [
    {
      dir: 'dist',
      format: 'esm',
      sourcemap: true,
      chunkFileNames: '[name].js',
    },
    {
      dir: 'dist',
      format: 'cjs',
      sourcemap: true,
      chunkFileNames: '[name].cjs',
    },
  ],
  external,
  plugins: [esbuild({ target: 'esnext' }), typescript()],
};

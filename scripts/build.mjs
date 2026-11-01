// Bundles the extension, the CLI and (with --tests) the test suite with esbuild.
import * as esbuild from 'esbuild';
import fs from 'node:fs';

const watch = process.argv.includes('--watch');
const tests = process.argv.includes('--tests');
const production = process.argv.includes('--production');

const common = {
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node18',
  sourcemap: !production,
  minify: production,
  logLevel: 'info',
};

const builds = [
  { ...common, entryPoints: ['src/extension.ts'], outfile: 'dist/extension.js', external: ['vscode'] },
  { ...common, entryPoints: ['src/cli.ts'], outfile: 'dist/cli.js', banner: { js: '#!/usr/bin/env node' } },
];
if (tests) {
  fs.rmSync('dist-test', { recursive: true, force: true });
  const entryPoints = fs.readdirSync('src/test').filter((f) => f.endsWith('.test.ts')).map((f) => `src/test/${f}`);
  // Tests run in plain Node: swap the `vscode` module for a small mock.
  builds.push({ ...common, entryPoints, outdir: 'dist-test', sourcemap: true, logLevel: 'warning', alias: { vscode: './src/test/vscode-mock.ts' } });
}

if (watch) {
  for (const b of builds) await (await esbuild.context(b)).watch();
} else {
  await Promise.all(builds.map((b) => esbuild.build(b)));
}

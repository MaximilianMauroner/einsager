import { execFileSync } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { compileNative } from '../scripts/native-macos.mjs';

await mkdir('target/tests', { recursive: true });
compileNative('target/tests/native-hover-tests', {
  tests: true,
  extraSources: ['apps/desktop/native/macos/tests/HoverTests.swift'],
});
execFileSync('target/tests/native-hover-tests', { stdio: 'inherit', timeout: 15_000 });

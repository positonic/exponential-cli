#!/usr/bin/env node
import { buildProgram, isBareVersionRequest, PKG_VERSION } from './program.js';

if (isBareVersionRequest(process.argv.slice(2))) {
  // Backwards-compatible `exponential --version`; see program.ts for why the
  // registered flag is `--cli-version`.
  console.log(PKG_VERSION);
} else {
  buildProgram().parse();
}

#!/usr/bin/env node
import { main } from '../../../harness.mjs';
main().catch(e => { console.error(e.message); process.exitCode = 1; });

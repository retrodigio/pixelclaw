#!/usr/bin/env node
// Runs the TypeScript sources directly (Node >= 22.18 strips types natively).
import { main } from '../src/main.ts';

process.exitCode = main(process.argv.slice(2));

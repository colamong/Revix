#!/usr/bin/env node
import { convertSwePrBenchDataset } from "../src/evaluation/swe-prbench.js";

const args = parseArgs(process.argv.slice(2));
const rawDir = args.raw ?? "eval-data/swe-prbench/raw/dataset";
const outDir = args.out ?? "eval-data/swe-prbench/converted";
const limit = args.limit ? Number.parseInt(args.limit, 10) : undefined;
const evalSplit = args["eval-split"];

const result = await convertSwePrBenchDataset({ rawDir, outDir, limit, evalSplit });

console.log(`Converted ${result.count} SWE-PRBench cases.`);
console.log(`Cases: ${result.casesPath}`);
console.log(`Summary: ${result.summaryPath}`);

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (!value.startsWith("--")) continue;
    const key = value.slice(2);
    parsed[key] = argv[index + 1];
    index += 1;
  }
  return parsed;
}

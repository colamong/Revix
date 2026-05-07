#!/usr/bin/env node
import { createWriteStream } from "node:fs";
import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";

const DEFAULT_REPO = "foundry-ai/swe-prbench";
const DEFAULT_REVISION = "main";
const DEFAULT_PATHS = ["dataset/prs.jsonl", "dataset/annotations", "dataset/evals"];
const DEFAULT_OUT = "eval-data/swe-prbench/raw";

const args = parseArgs(process.argv.slice(2));
const repo = args.repo ?? DEFAULT_REPO;
const revision = args.revision ?? DEFAULT_REVISION;
const datasetPaths = (args.path ?? args.paths)?.split(",").map((path) => path.trim()).filter(Boolean) ?? DEFAULT_PATHS;
const outDir = args.out ?? DEFAULT_OUT;

const files = uniqueFiles((await Promise.all(datasetPaths.map((datasetPath) => listDatasetFiles({ repo, revision, datasetPath })))).flat());
if (files.length === 0) {
  throw new Error(`No downloadable files found under ${repo}/${datasetPaths.join(",")}`);
}

await mkdir(outDir, { recursive: true });
await writeFile(join(outDir, "SOURCE.json"), `${JSON.stringify({
  repo,
  revision,
  paths: datasetPaths,
  source_url: `https://huggingface.co/datasets/${repo}/tree/${revision}/dataset`,
  downloaded_at: new Date().toISOString()
}, null, 2)}\n`);

let downloaded = 0;
let skipped = 0;
for (const file of files) {
  const target = join(outDir, file.path);
  if (await hasExpectedSize(target, file.size)) {
    skipped += 1;
    continue;
  }
  await mkdir(dirname(target), { recursive: true });
  await downloadFile(resolveUrl({ repo, revision, path: file.path }), target);
  downloaded += 1;
}

const rowSummary = await downloadDatasetRows({ repo, outDir });

console.log(`SWE-PRBench download complete: ${downloaded} downloaded, ${skipped} skipped, ${files.length} total.`);
console.log(`Viewer rows: ${rowSummary.records} train records, ${rowSummary.evalTasks} eval tasks.`);
console.log(`Raw data: ${outDir}`);

async function listDatasetFiles({ repo, revision, datasetPath }) {
  if (looksLikeFile(datasetPath)) {
    return [{ path: datasetPath, size: null }];
  }
  const apiUrl = `https://huggingface.co/api/datasets/${repo}/tree/${revision}/${encodePath(datasetPath)}?recursive=true`;
  const response = await fetch(apiUrl);
  if (!response.ok) {
    throw new Error(`Failed to list ${apiUrl}: ${response.status} ${response.statusText}`);
  }
  const entries = await response.json();
  return entries
    .filter((entry) => entry.type === "file")
    .map((entry) => ({ path: entry.path, size: entry.size ?? entry.lfs?.size ?? null }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function looksLikeFile(path) {
  return /\.[a-z0-9]+$/i.test(path);
}

function uniqueFiles(files) {
  const byPath = new Map();
  for (const file of files) byPath.set(file.path, file);
  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}

function resolveUrl({ repo, revision, path }) {
  return `https://huggingface.co/datasets/${repo}/resolve/${revision}/${encodePath(path)}`;
}

async function downloadFile(url, target) {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to download ${url}: ${response.status} ${response.statusText}`);
  }
  await pipeline(response.body, createWriteStream(target));
}

async function downloadDatasetRows({ repo, outDir }) {
  const records = await fetchRowsWithFallback({ repo, configs: ["prs", "train", "default", "swe-prbench"], split: "train" });
  const evalRows = await fetchRowsWithFallback({ repo, configs: ["eval_split"], split: "train" });
  const datasetDir = join(outDir, "dataset");
  const evalDir = join(datasetDir, "evals");
  await mkdir(evalDir, { recursive: true });
  await writeFile(join(datasetDir, "prs.jsonl"), `${records.map((record) => JSON.stringify(record)).join("\n")}\n`);
  await writeFile(join(evalDir, "eval_100.json"), `${JSON.stringify({
    description: "SWE-PRBench eval_split rows downloaded from Hugging Face Dataset Viewer.",
    n: evalRows.length,
    task_ids: evalRows.map((record) => record.task_id)
  }, null, 2)}\n`);
  return { records: records.length, evalTasks: evalRows.length };
}

async function fetchRowsWithFallback({ repo, configs, split }) {
  const errors = [];
  for (const config of configs) {
    try {
      return await fetchRows({ repo, config, split });
    } catch (error) {
      errors.push(`${config}/${split}: ${error.message}`);
    }
  }
  throw new Error(`Failed to fetch dataset rows. Tried ${errors.join("; ")}`);
}

async function fetchRows({ repo, config, split }) {
  const rows = [];
  const pageSize = 100;
  for (let offset = 0; ; offset += pageSize) {
    const url = `https://datasets-server.huggingface.co/rows?dataset=${repo}&config=${encodeURIComponent(config)}&split=${encodeURIComponent(split)}&offset=${offset}&length=${pageSize}`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Failed to fetch dataset rows ${config}/${split}: ${response.status} ${response.statusText}`);
    }
    const page = await response.json();
    const pageRows = (page.rows ?? []).map((item) => item.row);
    rows.push(...pageRows);
    const total = page.num_rows_total ?? rows.length;
    if (rows.length >= total || pageRows.length === 0) break;
  }
  return rows;
}

async function hasExpectedSize(path, expectedSize) {
  if (!expectedSize) return false;
  try {
    const current = await stat(path);
    return current.size === expectedSize;
  } catch {
    return false;
  }
}

function encodePath(path) {
  return path.split("/").map((segment) => encodeURIComponent(segment)).join("/");
}

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

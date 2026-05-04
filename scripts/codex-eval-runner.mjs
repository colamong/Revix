#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { spawn } from "node:child_process";

const prompt = await readStdin();
const dir = await mkdtemp(join(tmpdir(), "revix-codex-eval-"));
const promptPath = join(dir, "prompt.txt");
const outputPath = join(dir, "output.txt");
await writeFile(promptPath, prompt);

try {
  await runCodex({ promptPath, outputPath });
  process.stdout.write(await readFile(outputPath, "utf8"));
} finally {
  await rm(dir, { recursive: true, force: true });
}

function runCodex({ promptPath, outputPath }) {
  return new Promise((resolve, reject) => {
    const child = spawn("cmd", [
      "/c",
      "codex",
      "-a",
      "never",
      "exec",
      "--ignore-user-config",
      "--ephemeral",
      "--ignore-rules",
      "--sandbox",
      "read-only",
      "-o",
      outputPath,
      "-"
    ], {
      stdio: ["pipe", "ignore", "pipe"],
      windowsHide: true
    });
    let stderr = "";
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`codex exited ${code}: ${stderr.trim()}`));
      }
    });
    readFile(promptPath, "utf8").then((text) => child.stdin.end(text), reject);
  });
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let text = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      text += chunk;
    });
    process.stdin.on("error", reject);
    process.stdin.on("end", () => resolve(text));
  });
}

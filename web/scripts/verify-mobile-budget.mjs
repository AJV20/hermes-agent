#!/usr/bin/env node
import { gzipSync } from "node:zlib";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const LIMITS = {
  maxGzipBytes: 140 * 1024,
  // Today + secure push adds less than 1 KiB over the original raw cap; keep the
  // compressed-transfer and request ceilings unchanged because they govern cold start.
  maxRawBytes: 501 * 1024,
  maxRequests: 13,
};

function parseArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === "--manifest" || argument === "--root") {
      const value = argv[index + 1];
      if (!value) throw new Error(`Missing value for ${argument}`);
      options[argument.slice(2)] = resolve(value);
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${argument}`);
    }
  }
  return options;
}

function findIndexEntry(manifest) {
  const entry = Object.entries(manifest).find(([key, chunk]) =>
    chunk.isEntry && (key === "index.html" || chunk.src === "index.html"),
  );
  if (!entry) throw new Error("Vite manifest does not contain an index.html entry");
  return entry[0];
}

function findMobileEntry(manifest, indexKey) {
  const seen = new Set();
  const visit = (key) => {
    if (seen.has(key)) return null;
    seen.add(key);
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Vite manifest is missing dynamic entry ${key}`);
    if (key.endsWith("mobile-main.tsx") || chunk.src?.endsWith("mobile-main.tsx")) return key;
    for (const dependency of chunk.dynamicImports ?? []) {
      const found = visit(dependency);
      if (found) return found;
    }
    return null;
  };
  const mobileKey = visit(indexKey);
  if (!mobileKey) throw new Error("Vite manifest has no dynamically imported mobile-main entry");
  return mobileKey;
}

function collectInitialMobileFiles(manifest, indexKey, mobileKey) {
  const files = [];
  const seenChunks = new Set();
  const addFile = (file) => {
    if (file && !files.includes(file)) files.push(file);
  };
  const visitStatic = (key) => {
    if (seenChunks.has(key)) return;
    seenChunks.add(key);
    const chunk = manifest[key];
    if (!chunk) throw new Error(`Vite manifest is missing static import ${key}`);
    addFile(chunk.file);
    for (const dependency of chunk.imports ?? []) visitStatic(dependency);
    for (const css of chunk.css ?? []) addFile(css);
  };

  addFile("index.html");
  visitStatic(indexKey);
  visitStatic(mobileKey);
  return files;
}

function fileMetrics(root, files) {
  return files.map((file) => {
    const path = join(root, file);
    if (!existsSync(path)) throw new Error(`Built asset missing from graph: ${path}`);
    const contents = readFileSync(path);
    return { file, gzipBytes: gzipSync(contents).length, rawBytes: contents.length };
  });
}

function buildReport(root, manifestPath) {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const indexKey = findIndexEntry(manifest);
  const mobileKey = findMobileEntry(manifest, indexKey);
  const files = collectInitialMobileFiles(manifest, indexKey, mobileKey);
  const assets = fileMetrics(root, files);
  const rawBytes = assets.reduce((total, asset) => total + asset.rawBytes, 0);
  const gzipBytes = assets.reduce((total, asset) => total + asset.gzipBytes, 0);
  const requestCount = assets.length;
  return {
    assets,
    files,
    gzipBytes,
    indexKey,
    limits: LIMITS,
    mobileKey,
    rawBytes,
    requestCount,
    withinBudget:
      rawBytes <= LIMITS.maxRawBytes &&
      gzipBytes <= LIMITS.maxGzipBytes &&
      requestCount <= LIMITS.maxRequests,
  };
}

function main() {
  const options = parseArguments(process.argv.slice(2));
  const defaultRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../hermes_cli/web_dist");
  const manifestPath = options.manifest ?? join(defaultRoot, ".vite", "manifest.json");
  const root = options.root ?? (options.manifest ? dirname(manifestPath) : defaultRoot);
  const report = buildReport(root, manifestPath);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  if (!report.withinBudget) {
    process.stderr.write(
      `Mobile cold-start budget exceeded: ${report.rawBytes}/${LIMITS.maxRawBytes} raw bytes, ` +
      `${report.gzipBytes}/${LIMITS.maxGzipBytes} gzip bytes, ` +
      `${report.requestCount}/${LIMITS.maxRequests} requests.\n`,
    );
    process.exitCode = 1;
  }
}

try {
  main();
} catch (error) {
  process.stderr.write(`Mobile cold-start budget verification failed: ${error.message}\n`);
  process.exitCode = 1;
}

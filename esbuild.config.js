import { chmod, mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { analyzeMetafile, build } from "esbuild";

const productionOutfile = "dist/production/hybrid-model-switcher-mcp.cjs";
const splitOutdir = "dist/production/split";
const metafilePath = "dist/production/esbuild-meta.json";
const analysisPath = "dist/production/esbuild-analysis.txt";

const shared = {
  entryPoints: ["./src/index.ts"],
  platform: "node",
  target: "node20",
  bundle: true,
  treeShaking: true,
  minify: true,
  sourcemap: "external",
  sourcesContent: false,
  legalComments: "none",
  logLevel: "info",
  packages: "bundle",
  conditions: ["node", "import"],
  define: {
    "process.env.NODE_ENV": JSON.stringify("production"),
  },
};

await mkdir(dirname(productionOutfile), { recursive: true });

const singleFileBuild = await build({
  ...shared,
  format: "cjs",
  outfile: productionOutfile,
  metafile: true,
});

await chmod(productionOutfile, 0o755);
await writeFile(metafilePath, JSON.stringify(singleFileBuild.metafile, null, 2), "utf8");
await writeFile(
  analysisPath,
  await analyzeMetafile(singleFileBuild.metafile, { verbose: true }),
  "utf8",
);

await build({
  ...shared,
  format: "esm",
  banner: {
    js: "import { createRequire as __hybridCreateRequire } from 'node:module';const require = __hybridCreateRequire(import.meta.url);",
  },
  outdir: splitOutdir,
  splitting: true,
  entryNames: "[name]",
  chunkNames: "chunks/[name]-[hash]",
});

console.log(`Production MCP executable: ${resolve(productionOutfile)}`);
console.log(`Code-split verification build: ${resolve(splitOutdir)}`);

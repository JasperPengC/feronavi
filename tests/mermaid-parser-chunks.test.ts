// @vitest-environment node
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { build } from "vite";
import { expect, it } from "vitest";
import { mermaidParserGrammars } from "../scripts/build-tools/mermaid-parser-grammars.ts";

it("将上游预打包语法数据分块，保留转义、延迟解析和缓存语义", async () => {
  const directory = await mkdtemp(join(tmpdir(), "feronavi-parser-chunks-"));
  const input = join(directory, "node_modules/@mermaid-js/parser/dist/chunks/mermaid-parser.core/fixture.mjs");
  const grammar = { name: "中文'`\\语法", regex: "[\\w]+\\n" };
  try {
    await mkdir(join(input, ".."), { recursive: true });
    await writeFile(input, `let calls=0; let cached;
function loadGrammarFromJson(value) { calls++; return JSON.parse(value); }
export function read() { return cached ?? (cached=loadGrammarFromJson(${JSON.stringify(JSON.stringify(grammar))})); }
export const count=()=>calls;
export const dynamic=value=>loadGrammarFromJson(value);`);
    const result = await build({
      configFile: false, logLevel: "silent", plugins: [mermaidParserGrammars()],
      build: { outDir: join(directory, "out"), minify: false, sourcemap: true,
        rollupOptions: { input, preserveEntrySignatures: "strict", output: {
          entryFileNames: "entry.mjs", chunkFileNames: "[name].mjs",
          manualChunks: id => id.startsWith("\0mermaid-parser-grammar:") ? "grammar-data" : undefined,
        } },
      },
    });
    if (Array.isArray(result) || !("output" in result)) throw new Error("Expected one Rollup output");
    expect(result.output.some(item => item.fileName === "grammar-data.mjs")).toBe(true);
    const module = await import(/* @vite-ignore */ pathToFileURL(join(directory, "out/entry.mjs")).href);
    expect(module.count()).toBe(0);
    const parsed = module.read();
    expect(parsed).toEqual(grammar);
    expect(module.read()).toBe(parsed);
    expect(module.count()).toBe(1);
    expect(module.dynamic('{"name":"dynamic"}')).toEqual({ name: "dynamic" });
  } finally { await rm(directory, { recursive: true, force: true }); }
});

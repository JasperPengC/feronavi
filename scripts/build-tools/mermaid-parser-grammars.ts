import { createHash } from "node:crypto";
import MagicString from "magic-string";
import type { Plugin } from "vite";

const prefix = "\0mermaid-parser-grammar:";
type Node = { type: string; start: number; end: number; [key: string]: unknown };

/** 上游把所有语法字符串合入解析器；只抽取静态数据，保持解析函数与 AST API 原样。 */
export function mermaidParserGrammars(): Plugin {
  const literals = new Map<string, string>();
  return {
    name: "feronavi-mermaid-parser-grammars",
    apply: "build",
    buildStart() { literals.clear(); },
    resolveId(id) { if (id.startsWith(prefix)) return id; },
    load(id) { const literal = literals.get(id); if (literal !== undefined) return `export default ${literal};`; },
    transform(code, id) {
      if (!id.includes("/@mermaid-js/parser/dist/chunks/mermaid-parser.core/")) return;
      const output = new MagicString(code);
      const imports: string[] = [];
      const visit = (node: Node) => {
        if (node.type === "CallExpression" && (node.callee as Node)?.type === "Identifier"
            && (node.callee as Node).name === "loadGrammarFromJson") {
          const args = node.arguments as Node[];
          const argument = args[0];
          if (args.length === 1 && argument && (
            (argument.type === "Literal" && typeof argument.value === "string")
            || (argument.type === "TemplateLiteral" && (argument.expressions as Node[]).length === 0)
          )) {
            const literal = code.slice(argument.start, argument.end);
            const virtualId = prefix + createHash("sha256").update(literal).digest("hex").slice(0, 16);
            literals.set(virtualId, literal);
            const binding = `__feronaviGrammar${imports.length}`;
            imports.push(`import ${binding} from ${JSON.stringify(virtualId)};`);
            output.overwrite(argument.start, argument.end, binding);
            return;
          }
        }
        for (const value of Object.values(node)) {
          if (Array.isArray(value)) {
            for (const child of value) if (child && typeof child.type === "string") visit(child as Node);
          } else if (value && typeof value === "object" && "type" in value) visit(value as Node);
        }
      };
      visit(this.parse(code) as unknown as Node);
      if (!imports.length) return;
      output.prepend(imports.join("\n") + "\n");
      return { code: output.toString(), map: output.generateMap({ hires: true, source: id, includeContent: true }).toString() };
    },
  };
}

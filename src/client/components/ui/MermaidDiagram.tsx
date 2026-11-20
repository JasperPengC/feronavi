import { useEffect, useId, useRef, useState } from "react";
import { t, useLocale } from "../../i18n/index.ts";
import { Icon } from "../Icon.tsx";
import { Button } from "./Button.tsx";

// Mermaid共享配置，串行初始化及绘制，防止并发图表串主题。
let rendering = Promise.resolve();
export function MermaidDiagram({ source }: { source: string }) {
  useLocale();
  const id = `diagram-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const host = useRef<HTMLElement>(null);
  const [dark, setDark] = useState(false);
  const [result, setResult] = useState<{ svg: string; ratio: number; width: number } | null>(null);
  const [fit, setFit] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const update = () => setDark(!!host.current?.closest(".theme-dark"));
    update();
    const observer = new MutationObserver(update);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class"], subtree: true });
    return () => observer.disconnect();
  }, []);
  useEffect(() => {
    let active = true; setResult(null); setFailed(false);
    const task = async () => {
      if (!active) return;
      try {
        if (source.length > 12_000) throw new Error("Diagram too large");
        const { default: mermaid } = await import("mermaid");
        if (!active) return;
        // 资料中的图表不应重配渲染器或注入自定义CSS；保留图表语法和原始源码。
        const diagram = source.replace(/^\s*---[ \t]*\r?\n[\s\S]*?\r?\n[ \t]*---[ \t]*(?:\r?\n|$)/, "").replace(/%%\{[\s\S]*?\}%%/g, "");
        if (/^\s*---|%%\s*\{/.test(diagram)) throw new Error("Invalid diagram directive");
        mermaid.initialize({ startOnLoad: false, securityLevel: "strict", layout: /^\s*flowchart-elk\b/u.test(diagram) ? "elk" : "dagre", theme: dark ? "dark" : "neutral", maxTextSize: 12_000, maxEdges: 200, suppressErrorRendering: true, flowchart: { htmlLabels: false }, secure: ["secure", "securityLevel", "startOnLoad", "maxTextSize", "maxEdges", "suppressErrorRendering", "themeCSS", "themeVariables", "htmlLabels"] });
        const { svg } = await mermaid.render(id, diagram);
        const viewBox = new DOMParser().parseFromString(svg, "image/svg+xml").documentElement.getAttribute("viewBox")?.split(/[\s,]+/).map(Number);
        const ratio = viewBox && viewBox[2]! > 0 && viewBox[3]! > 0 ? viewBox[2]! / viewBox[3]! : 2;
        const width = viewBox && Number.isFinite(viewBox[2]) && viewBox[2]! > 0 ? Math.min(viewBox[2]!, 2400) : 760;
        if (active) setResult({ svg, ratio, width });
      } catch { if (active) setFailed(true); }
    };
    rendering = rendering.then(task, task);
    return () => { active = false; };
  }, [source, dark, id]);
  const srcDoc = result ? `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src data:; base-uri 'none'; form-action 'none'"><style>html,body{margin:0;background:transparent;color-scheme:${dark ? "dark" : "light"}}svg{display:block;width:100%;height:auto;max-width:100%!important}a{pointer-events:none}</style></head><body>${result.svg}</body></html>` : "";
  return <figure className="markdown-diagram" ref={host}>
    {!result && !failed && <p role="status">{t("markdown.diagramLoading")}</p>}
    {failed && <p role="status">{t("markdown.diagramFailed")}</p>}
    {result && <>
      <div className="markdown-diagram-viewport" role="region" aria-label={t("markdown.diagramTitle")} tabIndex={0}>
        <iframe title={t("markdown.diagramTitle")} sandbox="" referrerPolicy="no-referrer" srcDoc={srcDoc} style={{ aspectRatio: String(result.ratio), width: fit ? "100%" : result.width }} />
      </div>
      <figcaption className="markdown-diagram-tools"><span>{fit ? t("markdown.diagramOverview") : t("markdown.diagramScroll")}</span><Button variant="ghost" size="sm" onClick={() => setFit(!fit)}>{t(fit ? "markdown.diagramActual" : "markdown.diagramFit")}</Button></figcaption>
    </>}
    <details open={failed || undefined}><summary><Icon name="chevron-down" size={12} />{t("markdown.diagramSource")}</summary><pre><code className="language-mermaid">{source}</code></pre></details>
  </figure>;
}

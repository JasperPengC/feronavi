/**
 * React 错误边界（D3）
 *
 * 为什么必须有：没有它时，任何一处组件抛错都会让整棵树被卸载，
 * 用户看到的是**纯黑屏**（深色主题下），控制台之外毫无线索。
 * 这里把错误**显示在页面上**，并给出可操作的建议。
 *
 * 刻意用 class 组件 —— React 至今只有 class 能实现 `componentDidCatch`。
 */
import { Component, type ErrorInfo, type ReactNode } from "react";
import { t as tr } from "../i18n/index.ts";
import { Button } from "../components/ui/Button.tsx";

interface Props { children: ReactNode }
interface State { error: Error | null }

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 保留到控制台，便于排查；页面上只给用户看可读信息
    console.error("[Feronavi] 渲染错误:", error, info.componentStack);
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;

    return (
      <div style={{ padding: "40px 24px", maxWidth: 720, margin: "0 auto", fontFamily: "var(--font-sans)" }}>
        <h1 style={{ fontSize: "var(--text-xl)", margin: "0 0 8px" }}>{tr("eb.title")}</h1>
        <p style={{ color: "var(--text-muted)", margin: "0 0 16px" }}>
          {tr("eb.desc")}
        </p>
        <pre style={{
          padding: 12, background: "var(--bg-muted)", borderRadius: "var(--radius)",
          fontSize: "var(--text-xs)", overflow: "auto", maxHeight: 200, whiteSpace: "pre-wrap",
        }}>
          {error.message}
        </pre>
        <div style={{ display: "flex", gap: 8, marginTop: 16 }}>
          <Button variant="primary" onClick={() => location.reload()}>{tr("eb.reload")}</Button>
          <Button onClick={() => this.setState({ error: null })}>{tr("eb.back")}</Button>
        </div>
      </div>
    );
  }
}

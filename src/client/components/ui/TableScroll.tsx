import { useLayoutEffect, useRef, type ReactNode } from "react";

/** 表头与数据共用一张表；分页放在此容器外，避免列宽和滚动位置不同步。 */
export function TableScroll({ children, label, className = "", resetKey }: {
  children: ReactNode;
  label: string;
  className?: string;
  resetKey?: string | number;
}) {
  const container = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (container.current) container.current.scrollTop = 0;
  }, [resetKey]);
  return <div ref={container} className={`data-scroll ${className}`} data-custom-scroll
    role="region" aria-label={label} tabIndex={0}>{children}</div>;
}

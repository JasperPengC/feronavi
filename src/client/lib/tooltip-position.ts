type Rect = { left: number; right: number; top: number; bottom: number };
type Size = { width: number; height: number };

/** 所有坐标均为视口 CSS 像素；用气泡的实际尺寸进行边缘避让。 */
export function tooltipPosition(anchor: Rect, size: Size, viewport: Size, pointer: boolean) {
  const edge = 8;
  let left = pointer ? anchor.right + 12 : (anchor.left + anchor.right - size.width) / 2;
  let top = pointer ? anchor.bottom + 12 : anchor.top - size.height - 8;
  if (pointer && left + size.width > viewport.width - edge) left = anchor.left - size.width - 12;
  if (pointer && top + size.height > viewport.height - edge) top = anchor.top - size.height - 12;
  if (!pointer && top < edge) top = anchor.bottom + 8;
  return {
    left: Math.max(edge, Math.min(left, viewport.width - size.width - edge)),
    top: Math.max(edge, Math.min(top, viewport.height - size.height - edge)),
  };
}

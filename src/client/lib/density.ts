/** 密度只影响信息容器，不压缩触控目标或改变账号配置。 */
export function applyDensity(value?: string | null): void {
  document.documentElement.dataset.density = value === "compact" ? "compact" : "comfortable";
}

export function baselineFileName(key, variant) {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(key)) throw new Error("视觉基线必须使用稳定路由 key");
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(variant)) throw new Error("视觉基线变体不合法");
  return `${key}-${variant}.png`;
}

export function baselineAction(update, exists) {
  if (update) return "write";
  return exists ? "compare" : "missing";
}

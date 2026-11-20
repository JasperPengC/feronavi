const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });

export function firstGrapheme(name: string, username: string): string {
  const text = name.trim() || username.trim() || "?";
  return segmenter.segment(text).containing(0)?.segment ?? "?";
}

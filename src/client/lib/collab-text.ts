import * as Y from "yjs";

/** Apply only the changed span so concurrent edits outside the cursor range remain mergeable. */
export function applyTextValue(text: Y.Text, value: string): void {
  const current = text.toString();
  if (current === value) return;
  let prefix = 0;
  const maxPrefix = Math.min(current.length, value.length);
  while (prefix < maxPrefix && current[prefix] === value[prefix]) prefix++;
  let suffix = 0;
  while (suffix < current.length - prefix && suffix < value.length - prefix
    && current[current.length - suffix - 1] === value[value.length - suffix - 1]) suffix++;
  const removeLength = current.length - prefix - suffix;
  const insert = value.slice(prefix, value.length - suffix);
  if (removeLength) text.delete(prefix, removeLength);
  if (insert) text.insert(prefix, insert);
}

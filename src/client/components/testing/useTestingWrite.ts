import { useRef } from "react";
import { api } from "../../lib/api.ts";
/** 网络失败重试沿用同一请求键，修改输入后生成新键。 */
export function useTestingWrite() {
  const requests = useRef(new Map<string, string>());
  return <T>(path: string, body: unknown, method = "POST") => {
    const signature = JSON.stringify({ path, method, body });
    let key = requests.current.get(signature);
    if (!key) {
      key = crypto.randomUUID();
      requests.current.set(signature, key);
    }
    return api<T>(path, { method, body, idempotencyKey: key });
  };
}

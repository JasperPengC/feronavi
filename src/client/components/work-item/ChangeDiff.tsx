import { useMemo, useState } from "react";
import { compareText } from "../../../shared/requirement-diff.ts";
import { t } from "../../i18n/index.ts";
import { Button } from "../ui/Button.tsx";
import { DiffBlock } from "./RequirementHistory.tsx";

export function ChangeDiff({label,before,after}:{label:string;before:string;after:string}) {
  const [expanded,setExpanded]=useState(false);
  const result=useMemo(()=>compareText(before,after),[before,after]);
  if(before===after)return null;
  const hasContext=result.chunks.some(c=>c.kind==="equal");
  return <div className="requirement-changes__diff">
    {hasContext&&<Button size="sm" variant="ghost" aria-pressed={expanded} onClick={()=>setExpanded(!expanded)}>{t(expanded?"change.onlyChanges":"change.showContext")}</Button>}
    <DiffBlock label={label} chunks={expanded?result.chunks:result.chunks.filter(c=>c.kind!=="equal")} />
    {result.coarse&&<p className="muted">{t("revision.coarse")}</p>}
  </div>;
}

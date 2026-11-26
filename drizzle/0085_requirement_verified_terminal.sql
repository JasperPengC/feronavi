-- 只修正与原默认模板完全一致的需求流；任何自定义状态/动作/权限保持原样。
WITH eligible AS (
 SELECT w.id FROM workflow w
 WHERE w.applies_to_type = 'REQUIREMENT' AND w.name = '需求流' AND w.is_default
 AND (SELECT jsonb_agg(jsonb_build_array(s.key,s.name,s.category,s.color,s.sort_order) ORDER BY s.sort_order) FROM workflow_state s WHERE s.workflow_id=w.id) = '[["DRAFT","草稿","NOT_STARTED","neutral",1],["CONFIRMED","已确认","IN_PROGRESS","info",2],["SCHEDULED","已排期","IN_PROGRESS","info",3],["IN_PROGRESS","进行中","IN_PROGRESS","info",4],["DELIVERED","已交付","IN_PROGRESS","info",5],["VERIFIED","已验证","IN_PROGRESS","info",6],["REJECTED","已驳回","TERMINAL","danger",7],["CANCELLED","已取消","TERMINAL","danger",8]]'::jsonb
 AND NOT EXISTS (SELECT 1 FROM workflow_state s WHERE s.workflow_id=w.id AND (s.archived_at IS NOT NULL OR s.wip_limit IS NOT NULL))
 AND (SELECT jsonb_agg(jsonb_build_array(f.key,t.key) ORDER BY f.key COLLATE "C",t.key COLLATE "C") FROM workflow_transition e JOIN workflow_state f ON f.id=e.from_state_id JOIN workflow_state t ON t.id=e.to_state_id WHERE e.workflow_id=w.id) = '[["CANCELLED","DRAFT"],["CONFIRMED","REJECTED"],["CONFIRMED","SCHEDULED"],["DELIVERED","IN_PROGRESS"],["DELIVERED","VERIFIED"],["DRAFT","CONFIRMED"],["DRAFT","REJECTED"],["IN_PROGRESS","DELIVERED"],["IN_PROGRESS","SCHEDULED"],["REJECTED","DRAFT"],["SCHEDULED","CONFIRMED"],["SCHEDULED","IN_PROGRESS"],["VERIFIED","IN_PROGRESS"]]'::jsonb
 AND NOT EXISTS (SELECT 1 FROM workflow_transition e WHERE e.workflow_id=w.id AND (e.allowed_role_ids <> '[]'::jsonb OR e.required_fields <> '[]'::jsonb OR e.requires_approval OR e.approver_role_keys <> '[]'::jsonb OR e.label IS NOT NULL OR e.sort_order <> 0))
), corrected AS (
 UPDATE workflow_state s SET category='TERMINAL',color='success'
 FROM eligible e WHERE s.workflow_id=e.id AND s.key='VERIFIED' RETURNING s.id
)
UPDATE work_item w SET completed_at=COALESCE(w.completed_at,w.updated_at), version=w.version+1
WHERE w.status_id IN (SELECT id FROM corrected) AND w.deleted_at IS NULL;

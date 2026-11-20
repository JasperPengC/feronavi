import { z } from "zod";
import type { RagChatResult } from "./rag.ts";
import {ragReferencesShape,type RagReferences} from "./rag.ts";

export const ragConversationCreateSchema = z.object({ projectId: z.string().uuid().optional(), title: z.string().trim().min(1).max(120).optional() }).strict();
export const ragConversationUpdateSchema = z.object({ title: z.string().trim().min(1).max(120).optional(), deleted: z.boolean().optional() }).strict().refine(v => v.title !== undefined || v.deleted !== undefined);
export const ragConversationListSchema = z.object({ deleted: z.enum(["true", "false"]).default("false"), page: z.coerce.number().int().min(1).default(1), pageSize: z.coerce.number().int().min(1).max(50).default(50) }).strict();
export const ragConversationDetailSchema = z.object({ before: z.string().uuid().optional() }).strict();
export const ragMessageCreateSchema = z.object({ requestId: z.string().uuid(), question: z.string().trim().min(1).max(1000),...ragReferencesShape }).strict();
export const ragConversationIdSchema = z.object({ conversationId: z.string().uuid() }).strict();
export const ragRequestIdSchema = ragConversationIdSchema.extend({ requestId: z.string().uuid() });
export type RagConversationCreate = z.infer<typeof ragConversationCreateSchema>;
export type RagConversationUpdate = z.infer<typeof ragConversationUpdateSchema>;
export type RagConversationListInput = z.infer<typeof ragConversationListSchema>;
export type RagMessageCreate = z.infer<typeof ragMessageCreateSchema>;
export interface RagConversation {
  id: string; title: string; projectId: string | null; projectName: string | null;
  available: boolean; createdAt: string; updatedAt: string; deletedAt: string | null;
}
export interface RagMessage {
  references?: RagReferences;
  id: string; conversationId: string; requestId: string; question: string;
  status: "pending" | "completed" | "failed" | "cancelled" | "unavailable";
  reply: RagChatResult | null; createdAt: string; updatedAt: string;
}
export interface RagConversationList { items: RagConversation[]; total: number; page: number; pageSize: number }
export interface RagConversationDetail { conversation: RagConversation; messages: RagMessage[]; hasMore: boolean }
export interface RagMessageResult { conversation: RagConversation; message: RagMessage }

export const ragActionDecisionSchema = z.object({ decision: z.enum(["confirm", "reject"]) }).strict();
export const ragActionIdSchema = ragRequestIdSchema.extend({ actionId: z.string().uuid() });
export type RagAssistantStreamEvent =
  | { type: "accepted"; result: RagMessageResult }
  | { type: "status"; phase: "thinking" | "tool" | "answering"; toolName?: string }
  | { type: "delta"; text: string }
  | { type: "reset" }
  | { type: "result"; result: RagMessageResult }
  | { type: "error"; message: string };

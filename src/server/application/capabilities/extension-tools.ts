import { WORK_PLANNING_TOOLS } from "./work-planning-tools.ts";
import { CONTENT_TOOLS } from "./content-tools.ts";
import { PROJECT_TOOLS } from "./project-tools.ts";
import { OPERATIONS_TOOLS } from "./operations-tools.ts";
import { ADMINISTRATION_TOOLS } from "./administration-tools.ts";
import { COLLABORATION_TOOLS } from "./collaboration-tools.ts";

export const EXTENSION_TOOLS = [...WORK_PLANNING_TOOLS, ...CONTENT_TOOLS, ...PROJECT_TOOLS, ...OPERATIONS_TOOLS, ...ADMINISTRATION_TOOLS, ...COLLABORATION_TOOLS];

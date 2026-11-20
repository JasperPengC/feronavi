import { bootstrapBusinessEffects } from "../src/server/application/bootstrap-business-effects.ts";
/** 必须先通过隔离环境校验，再导入数据库或业务模块。 */
import { assertIsolatedTestEnvironment } from "./test-environment.mjs";

assertIsolatedTestEnvironment();

await bootstrapBusinessEffects();

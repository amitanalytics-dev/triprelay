import {WorkflowManager} from "@convex-dev/workflow";
import {components} from "./_generated/api";
// Journal step results contain status only; supplier bodies stay in private tables.
export const manager=new WorkflowManager(components.workflow,{workpoolOptions:{maxParallelism:2,retryActionsByDefault:false}});

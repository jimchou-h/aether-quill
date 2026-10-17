/**
 * 章节精修剩余路径修复后的确定性复现（2026-10-07 收口轮）。
 *
 * 与 `reverification-probes.ts`（记录修复前的缺陷）相对，本脚本断言**修复后应成立**的行为：
 *  - F1：调用/补修名额与用量在调用前原子落库，取消后不重置；
 *  - F2：场景内事实不得跨场取证，越界即违规；
 *  - F3：最终修复/回退后必须重检新接缝；
 *  - F5：仅出现在原文的历史状态不得当作当前确定状态；
 *  - F6：超长完整输入在准入即被拒绝，不把超限输入发给模型。
 *
 * 断言失败即代表对应修复回退。运行方式（services/api 下）：
 *   node --import tsx ../../openspec/changes/add-chapter-refinement-orchestration/evidence/remediation-probes-2026-10-07.ts
 */
import assert from 'node:assert/strict';
import { OrchestratedRefinementEngine } from '../../../../services/api/src/modules/projects/chapter-refinement.engine';
import { ChapterRefinementService } from '../../../../services/api/src/modules/projects/chapter-refinement.service';
import { MapChapterRefinementRunRepository } from '../../../../services/api/src/modules/projects/chapter-refinement-run.repository';
import { ChapterRefinementEventBus } from '../../../../services/api/src/modules/projects/chapter-refinement-event-bus';
import { createInitialRefinementCheckpoint, resolveRefinementPolicy } from '../../../../services/api/src/modules/projects/chapter-refinement.types';
import { buildRefinementSourceBlocks, parsePlanOutputWithRecovery, buildPlanUserPrompt, verifyRefinementStateFact } from '../../../../services/api/src/modules/projects/chapter-refinement.util';

const base = '甲推开门，放下钥匙。\n\n乙走进院子，关好门。';
const inspect = JSON.stringify({ windowId: 'w0', sceneFragments: [0,1].map(i => ({ startBlockId:`b${i}`,endBlockId:`b${i}`,startsNewScene:true,confidence:'high',goal:'保持事件',entryFacts:[],exitFacts:[],proposedBeatEnds:[] })),issues:[] });
const sceneBrief = (i:number) => ({ sceneId:`s${i+1}`,sourceBlockIds:[`b${i}`],decision:'rewrite',reason:'改善表达',editIntent:'改善表达',expectedChange:'改善表达',entryFacts:[],exitFacts:[],protectedSpanIds:[],targetLength:{direction:'hold'},checks:[] });
const plan = JSON.stringify({chapterIntent:'改善表达',protectedFacts:[],sceneBriefs:[sceneBrief(0),sceneBrief(1)]});
const review = JSON.stringify({issues:[],exitStateFacts:[]});
const fixedAt = new Date('2026-10-07T00:00:00.000Z');
function record() {return { runId:'probe',projectId:'p',chapterNo:1,creatorId:'u',clientRequestId:'probe',payloadHash:'h',status:'running',phase:'reading',revision:2,attemptId:'a',pauseReason:null,resumable:false,baseUpdatedAt:fixedAt.toISOString(),baseHash:'h',rewritePolicy:'preserve-plot',snapshot:{instruction:'改善表达，保留所有事件',baseTitle:'样章',baseText:base,systemPromptText:'风格指导',templateVersions:[],modelRoute:{tier:'writing',provider:'deepseek',model:'frozen-model',temperature:0.3},modelRoutes:{writing:{tier:'writing',provider:'deepseek',model:'frozen-model',temperature:0.3},utility:{tier:'utility',provider:'deepseek',model:'frozen-utility',temperature:0.1}},resolvedPolicy:resolveRefinementPolicy({}),frozenAt:fixedAt.toISOString()},checkpoint:createInitialRefinementCheckpoint(base),tombstone:false,createdAt:fixedAt.toISOString(),updatedAt:fixedAt.toISOString(),expiresAt:'2030-01-01T00:00:00.000Z'} as any;}
function response(text:string,ok=true){return {ok,text,traceId:'probe',aborted:false};}
const outputs:any[]=[];

async function run(){
 let budgetCalls=0;const budgetRecord=record();budgetRecord.snapshot.resolvedPolicy.maxCallsPerAttempt=1;
 const budgetResult=await new OrchestratedRefinementEngine({async generate(){budgetCalls++;return response('invalid JSON');}}).run({record:budgetRecord,signal:new AbortController().signal,onStage(){}});
 assert.equal(budgetCalls,1);assert.equal(budgetResult.status,'paused');outputs.push({probe:'call_cap_fixed',actual:budgetCalls,status:budgetResult.status});
 let reviewCalls=0;const requests:any[]=[];
 const failedReview=await new OrchestratedRefinementEngine({async generate(req:any){requests.push(req);const key=req.templateKey.split('.').at(-1);if(key==='inspect')return response(inspect);if(key==='plan')return response(plan);if(key==='rewrite')return response('甲推门进屋，将钥匙放下。');reviewCalls++;return response('invalid JSON');}}).run({record:record(),signal:new AbortController().signal,onStage(){}});
 assert.equal(failedReview.status,'paused');assert.equal(failedReview.checkpoint.changes.length,0);outputs.push({probe:'unit_review_failure_fixed',status:failedReview.status,changes:failedReview.checkpoint.changes.length,modelRouteForwarded:requests.every(r=>!!r.modelRoute)});
 let planCalls=0;const inspected=JSON.parse(inspect);inspected.sceneFragments[0].entryFacts=[{key:'key',value:'钥匙',sourceBlockId:'b0',anchorQuote:'钥匙'}];const invalidPlan=JSON.parse(plan);invalidPlan.protectedFacts=[{key:'key',value:null}];
 const rejectedFact=await new OrchestratedRefinementEngine({async generate(req:any){const key=req.templateKey.split('.').at(-1);if(key==='inspect')return response(JSON.stringify(inspected));if(key==='plan'){planCalls++;return response(JSON.stringify(invalidPlan));}throw new Error('Invalid Fact must not start rewrite');}}).run({record:record(),signal:new AbortController().signal,onStage(){}});
 assert.equal(rejectedFact.status,'paused');assert.equal(planCalls,2);outputs.push({probe:'known_fact_null_fixed',status:rejectedFact.status,planCalls});
 const blocks=buildRefinementSourceBlocks(base);const scenes:any=[{sceneId:'s1',startBlockIndex:0,endBlockIndex:1,fragments:[{entryFacts:[{key:'key',value:'钥匙',sourceBlockId:'b0',anchorQuote:'钥匙'}],exitFacts:[]}]}];const badQuote=JSON.parse(plan);badQuote.sceneBriefs=[sceneBrief(0)];badQuote.protectedFacts=[{key:'key',value:'钥匙',anchorQuote:'已有但错误的引文'}];const parsed=parsePlanOutputWithRecovery({raw:JSON.stringify(badQuote),blocks,scenes});assert.ok(parsed.violations.length>0);outputs.push({probe:'existing_bad_quote_fixed',violations:parsed.violations.length});
 let seamReviews=0;let repairs=0;
 const finalIssue=JSON.stringify({issues:[{kind:'hard_constraint',severity:'high',anchorQuote:'甲推门进屋',expectedFact:'接缝状态一致',sourceEvidence:'甲推开门',fixIntent:'修复当前范围与后文接缝'}],exitStateFacts:[]});
 const reverted=await new OrchestratedRefinementEngine({async generate(req:any){const key=req.templateKey.split('.').at(-1);if(key==='inspect')return response(inspect);if(key==='plan')return response(plan);if(key==='rewrite')return response(req.prompt.includes('甲推开门')?'甲推门进屋，将钥匙放下。':'乙来到院中，将门关好。');if(key==='review'){seamReviews++;return response(seamReviews<=2?review:finalIssue);}if(key==='repair'){repairs++;return response('',false);}throw new Error(key);}}).run({record:record(),signal:new AbortController().signal,onStage(){}});
 // F3 修复：回退后必须重检新接缝；本例冲突范围已回退，重检确认无残留阻断后方可 ready_with_issues
 assert.equal(reverted.status,'ready_with_issues');assert.equal(seamReviews,4);assert.ok(reverted.checkpoint.acceptedDraftText.startsWith('甲推开门'));outputs.push({probe:'final_revert_rechecked',status:reverted.status,reviewCalls:seamReviews,repairCalls:repairs,postRevertReviewCalls:seamReviews-3});
 let reachedRepair!:()=>void;const reached=new Promise<void>(resolve=>reachedRepair=resolve);let unitReviews=0;let actualCalls=0;
 const runningGateway={async generate(req:any){actualCalls++;const key=req.templateKey.split('.').at(-1);if(key==='inspect')return response(inspect);if(key==='plan')return response(plan);if(key==='rewrite')return response(req.prompt.includes('甲推开门')?'甲推门进屋，将钥匙放下。':'乙来到院中，将门关好。');if(key==='review'){unitReviews++;return response(unitReviews===2?JSON.stringify({issues:[{kind:'hard_constraint',severity:'high',anchorQuote:'乙来到院中',expectedFact:'保留关门事件',sourceEvidence:'乙走进院子，关好门。',fixIntent:'补齐必要事件'}],exitStateFacts:[]}):review);}if(key==='repair'){reachedRepair();await new Promise<void>(resolve=>{if(req.signal.aborted)resolve();else req.signal.addEventListener('abort',()=>resolve(),{once:true});});return {ok:false,text:'',traceId:'probe',aborted:true};}throw new Error(key);}};
 const repo=new MapChapterRefinementRunRepository();const bus=new ChapterRefinementEventBus();const materials:any={resolve:()=>({systemPromptText:'风格指导',templateVersions:[],templateTexts:{},modelRoutes:record().snapshot.modelRoutes,referenceMaterials:{materials:[],promptText:'',personaText:'',knowledgeText:'',styleSampleBlock:'',frozenAt:fixedAt.toISOString()}})};const projects:any={checkAccess(){return {role:'editor'};},getChapterRefinementSource(){return {chapterNo:1,title:'样章',content:base,updatedAt:fixedAt,chapterOptimizeSegmentCharSize:3000};}};const service=new ChapterRefinementService(projects,repo,new OrchestratedRefinementEngine(runningGateway),bus,materials);
 const created=await service.createRun('p',1,{clientRequestId:'retry-persist',expectedChapterUpdatedAt:fixedAt.toISOString(),instruction:'改善表达，保留事件'},'u');
 let waitTimer:any;await Promise.race([reached,new Promise((_,reject)=>{waitTimer=setTimeout(()=>reject(new Error('repair probe timed out')),5000);})]);clearTimeout(waitTimer);
 const inFlight=await repo.getById(created.runId);assert.equal(inFlight?.checkpoint.changes.length,1);assert.equal(inFlight?.checkpoint.unitRecovery?.repairCount,1);
 await service.cancelRun('p',1,created.runId,'u',{});await new Promise(resolve=>setTimeout(resolve,20));const cancelled=await repo.getById(created.runId);assert.equal(cancelled?.checkpoint.changes.length,1);assert.equal(cancelled?.checkpoint.unitRecovery?.repairCount,1);
 // F1 修复：补修名额在调用前即已落库，取消后不重置
 outputs.push({probe:'cancel_preserves_draft_and_reserved_repair',acceptedChanges:cancelled?.checkpoint.changes.length,repairCallsStarted:1,persistedRepairCount:cancelled?.checkpoint.unitRecovery?.repairCount,actualCalls,persistedCalls:cancelled?.checkpoint.usage.callCount,status:cancelled?.status});service.clearForTest();
 const overlong=record();overlong.snapshot.systemPromptText='长'.repeat(200000);let inspectCalls=0;let sentChars=0;const oversized=await new OrchestratedRefinementEngine({async generate(req:any){const key=req.templateKey.split('.').at(-1);if(key==='inspect'){inspectCalls++;sentChars=req.projectSystemPromptText.length+req.systemPromptText.length+req.prompt.length;return response(inspect);}if(key==='plan')return response(plan);return response(review);}}).run({record:overlong,signal:new AbortController().signal,onStage(){}});
 // F6 修复：超长冻结指导在 inspect 准入即被拒绝，不把超限输入发给模型
 assert.equal(inspectCalls,0);assert.equal(sentChars,0);assert.equal(oversized.status,'paused');assert.equal(oversized.pauseReason,'context_budget');outputs.push({probe:'inspect_admitted_within_budget',inspectCalls,sentChars,eventualStatus:oversized.status,pauseReason:oversized.pauseReason});
 const stale=verifyRefinementStateFact({key:'holding',value:'拿着钥匙',sourceBlockId:'b0',anchorQuote:'甲拿着钥匙入场'},{original:'甲拿着钥匙入场，散场时把钥匙留在桌上。',candidate:'甲把钥匙留在桌上，独自走出门。'});
 // F5 修复：仅出现在原文、不在候选中的状态只作历史证据，不得当作当前确定状态
 assert.deepEqual(stale,{status:'historical'});outputs.push({probe:'historical_original_fact_not_current_state',verdict:stale});
 const scopedPlan=JSON.parse(plan);scopedPlan.protectedFacts=[{key:'key',value:'钥匙',sourceBlockId:'b0',anchorQuote:'钥匙'}];scopedPlan.sceneBriefs[1].entryFacts=[{key:'key',value:'钥匙'}];const bothScenes:any=[...scenes,{sceneId:'s2',startBlockIndex:1,endBlockIndex:2,fragments:[{entryFacts:[],exitFacts:[]}]}];const outside=parsePlanOutputWithRecovery({raw:JSON.stringify(scopedPlan),blocks,scenes:bothScenes});
 // F2 修复：场景内事实不得跨场取证；越界即记违规，不得回填他场证据
 assert.ok(outside.violations.length>0);assert.notEqual(outside.brief?.sceneBriefs[1].entryFacts[0]?.sourceBlockId,'b0');outputs.push({probe:'cross_scene_backfill_blocked',violations:outside.violations.length,scene2AllowedBlocks:['b1'],copiedSourceBlock:outside.brief?.sceneBriefs[1].entryFacts[0]?.sourceBlockId});
 console.log(JSON.stringify(outputs,null,2));
}
run().catch(error=>{console.error(error);process.exitCode=1;});

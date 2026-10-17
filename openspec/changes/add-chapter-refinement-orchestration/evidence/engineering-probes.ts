import assert from 'node:assert/strict';
import { OrchestratedRefinementEngine } from '../../../../services/api/src/modules/projects/chapter-refinement.engine';
import { ChapterRefinementService } from '../../../../services/api/src/modules/projects/chapter-refinement.service';
import { MapChapterRefinementRunRepository } from '../../../../services/api/src/modules/projects/chapter-refinement-run.repository';
import { ChapterRefinementEventBus } from '../../../../services/api/src/modules/projects/chapter-refinement-event-bus';
import { createInitialRefinementCheckpoint, resolveRefinementPolicy } from '../../../../services/api/src/modules/projects/chapter-refinement.types';
import { buildRefinementSourceBlocks, parsePlanOutputWithRecovery, buildPlanUserPrompt } from '../../../../services/api/src/modules/projects/chapter-refinement.util';

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
 // Retry can cross the configured call cap because the guard is outside callModel.
 let budgetCalls=0;
 const budgetRecord=record(); budgetRecord.snapshot.resolvedPolicy.maxCallsPerAttempt=1;
 const budgetResult=await new OrchestratedRefinementEngine({async generate(){budgetCalls++;return response(budgetCalls===1?'invalid JSON':inspect);}}).run({record:budgetRecord,signal:new AbortController().signal,onStage(){}});
 assert.equal(budgetCalls,2);
 outputs.push({probe:'call_budget',configured:1,actual:budgetCalls,status:budgetResult.status});

 // Invalid review can be replaced by a warning while the final review is accepted.
 let reviewCalls=0;
 const requests:any[]=[];
 const failedReviewResult=await new OrchestratedRefinementEngine({async generate(req:any){requests.push(req); const key=req.templateKey.split('.').at(-1);if(key==='inspect')return response(inspect);if(key==='plan')return response(plan);if(key==='rewrite')return response(req.prompt.includes('甲推开门')?'甲推门进屋，将钥匙放下。':'乙来到院中，将门关好。');if(key==='review'){reviewCalls++;return response(reviewCalls<=2?'invalid JSON':review);}return response('',false);}}).run({record:record(),signal:new AbortController().signal,onStage(){}});
 assert.equal(failedReviewResult.status,'ready_with_issues');
 assert.ok(failedReviewResult.checkpoint.issues.some((i:any)=>i.message.includes('检查未完成')));
 outputs.push({probe:'incomplete_review',status:failedReviewResult.status,uncompletedReviewWarnings:failedReviewResult.checkpoint.issues.filter((i:any)=>i.message.includes('检查未完成')).length,modelRouteForwarded:requests.some(r=>'modelRoute' in r||'model' in r||'provider' in r)});

 // The additional plan response can discard a known Fact by outputting null.
 let planCalls=0;
 const inspectWithFact=JSON.parse(inspect);inspectWithFact.sceneFragments[0].entryFacts=[{key:'key',value:'钥匙',sourceBlockId:'b0',anchorQuote:'钥匙'}];
 const invalidPlan=JSON.parse(plan);invalidPlan.protectedFacts=[{key:'key',value:'钥匙',sourceBlockId:'missing',anchorQuote:'不在原文'}];
 const nullPlan=JSON.parse(plan);nullPlan.protectedFacts=[{key:'key',value:null}];
 const nullResult=await new OrchestratedRefinementEngine({async generate(req:any){const key=req.templateKey.split('.').at(-1);if(key==='inspect')return response(JSON.stringify(inspectWithFact));if(key==='plan'){planCalls++;return response(JSON.stringify(planCalls===1?invalidPlan:nullPlan));}if(key==='rewrite')return response(req.prompt.includes('甲推开门')?'甲推门进屋，将钥匙放下。':'乙来到院中，将门关好。');return response(review);}}).run({record:record(),signal:new AbortController().signal,onStage(){}});
 assert.equal(planCalls,2);assert.equal(nullResult.status,'ready');
 outputs.push({probe:'known_fact_to_null',planCalls,status:nullResult.status,acceptedAfterKnownFactBecameNull:true});

 // Backfilling the missing source ID also overwrites the supplied incorrect quote.
 const block=buildRefinementSourceBlocks(base);
 const scenes:any=[{sceneId:'s1',startBlockIndex:0,endBlockIndex:1,fragments:[{entryFacts:[{key:'key',value:'钥匙',sourceBlockId:'b0',anchorQuote:'钥匙'}],exitFacts:[]}]}];
 const backfillPlan=JSON.parse(plan);backfillPlan.sceneBriefs=[sceneBrief(0)];backfillPlan.protectedFacts=[{key:'key',value:'钥匙',anchorQuote:'已有但错误的引文'}];
 const parsed=parsePlanOutputWithRecovery({raw:JSON.stringify(backfillPlan),blocks:block,scenes});
 assert.equal(parsed.violations.length,0);assert.equal(parsed.brief?.protectedFacts[0].anchorQuote,'钥匙');
 outputs.push({probe:'overwrite_existing_fact_field',violations:parsed.violations.length,existingWrongQuoteReplaced:true});

 // Service persistence remains at the initial checkpoint while the second unit is in flight.
 let releaseSecond!:()=>void;const secondWait=new Promise<void>(r=>releaseSecond=r);
 let signalReached!:()=>void;const reachedSecond=new Promise<void>(r=>signalReached=r);
 let rewriteCalls=0;
 const runningGateway={async generate(req:any){const key=req.templateKey.split('.').at(-1);if(key==='inspect')return response(inspect);if(key==='plan')return response(plan);if(key==='rewrite'){rewriteCalls++;if(rewriteCalls===2){signalReached();await secondWait;if(req.signal.aborted)return {ok:false,text:'',traceId:'probe',aborted:true};return response('乙来到院中，将门关好。');}return response('甲推门进屋，将钥匙放下。');}return response(review);}};
 const repo=new MapChapterRefinementRunRepository();
 const eventBus=new ChapterRefinementEventBus();
 const materials:any={resolve:()=>({systemPromptText:'风格指导',templateVersions:[],templateTexts:{},modelRoutes:record().snapshot.modelRoutes})};
 const projects:any={checkAccess(){return {role:'editor'};},getChapterRefinementSource(){return {chapterNo:1,title:'样章',content:base,updatedAt:fixedAt,chapterOptimizeSegmentCharSize:3000};}};
 const service=new ChapterRefinementService(projects,repo,new OrchestratedRefinementEngine(runningGateway),eventBus,materials);
 const summary=await service.createRun('p',1,{clientRequestId:'persist-probe',expectedChapterUpdatedAt:fixedAt.toISOString(),instruction:'改善表达，保留事件'},'u');
 await Promise.race([reachedSecond,new Promise((_,reject)=>setTimeout(()=>reject(new Error('probe timeout')),5000))]);
 const inFlight=await repo.getById(summary.runId);
 assert.equal(inFlight?.checkpoint.changes.length,0);assert.equal(inFlight?.checkpoint.acceptedDraftText,base);
 outputs.push({probe:'checkpoint_while_second_unit_running',firstUnitAccepted:true,persistedChanges:inFlight?.checkpoint.changes.length,persistedDraftStillOriginal:inFlight?.checkpoint.acceptedDraftText===base,phaseStored:inFlight?.phase});
 await service.cancelRun('p',1,summary.runId,'u',{expectedAttemptId:inFlight!.attemptId});releaseSecond();
 await new Promise(r=>setTimeout(r,40));
 const cancelled=await repo.getById(summary.runId);
 assert.equal(cancelled?.checkpoint.changes.length,0);
 outputs.push({probe:'explicit_cancel_loses_accepted_unit',status:cancelled?.status,storedChanges:cancelled?.checkpoint.changes.length,resumeState:cancelled?.checkpoint.resumeState??null});
 service.clearForTest();
 console.log(JSON.stringify(outputs,null,2));
}
run().catch(error=>{console.error(error);process.exitCode=1;});


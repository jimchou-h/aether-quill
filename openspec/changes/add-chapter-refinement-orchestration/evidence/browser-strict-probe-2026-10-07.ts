/** Independent acceptance: full UI equality and exact ready statuses. Local fixtures and fake model only. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import path from 'node:path';
import { loginViaUi } from '../../../../apps/web/e2e/helpers';
import { createRefinementFixture, deleteRefinementFixture, discardRefinementRuns, readChapter, readRefinementRunView } from '../../../../apps/web/e2e/support/refinement-fixture';

const root=path.resolve(process.cwd(),'../..');
const webRequire=createRequire(path.join(root,'apps/web/package.json'));
const {chromium,expect}=webRequire('@playwright/test');
const fake=process.env.E2E_FAKE_ORCHESTRATOR_URL!;
const hash=(s:string)=>createHash('sha256').update(s).digest('hex');
const observations:unknown[]=[];
async function main(){
  const browser=await chromium.launch({headless:true});
  try {
    for(const width of [1440,768]) for(const issues of [false,true]) {
      const fixture=await createRefinementFixture();
      const context=await browser.newContext({baseURL:process.env.E2E_BASE_URL,viewport:{width,height:1024}});
      const page=await context.newPage();
      try {
        assert.equal((await fetch(fake+'/__reset',{method:'POST'})).ok,true);
        // A low warning alone legitimately finishes ready. A placeholder fails the
        // program gate (empty text is retried), forcing a real retained_original path.
        const review={issues:[],exitStateFacts:[]};
        const rewrite=issues?['（此处省略）甲进门。','（严格验收改写）']:['（严格验收改写）'];
        assert.equal((await fetch(fake+'/__control',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({script:{rewrite,review:JSON.stringify(review)}})})).ok,true);
        await loginViaUi(page);
        await page.goto(`/projects/${fixture.projectId}/chapters?refinement=1`);
        await page.getByRole('button',{name:'章节优化'}).first().click();
        const dialog=page.locator('.ant-modal').filter({hasText:/文笔优化/}).first();
        await dialog.getByRole('button',{name:/智能精修/}).first().click();
        const panel=page.locator('.refinement-panel').first();
        await panel.locator('#chapter-refinement-instruction').fill('保持剧情与人物状态，改善表达。');
        await panel.getByRole('button',{name:/开始智能精修/}).click();
        const expectedStatus=issues?'ready_with_issues':'ready';
        await expect(panel).toHaveAttribute('data-status',expectedStatus,{timeout:60000});
        const runId=await panel.getAttribute('data-run-id');
        const view=await readRefinementRunView(fixture,runId!);
        assert.equal(view.status,expectedStatus);
        const before=await readChapter(fixture);
        const responsePromise=page.waitForResponse((r:any)=>/\/knowledge\/chapters\/[^/]+\/optimize\/apply$/.test(r.url()));
        await panel.getByRole('button',{name:/应用候选稿/}).first().click();
        const confirm=page.locator('.ant-modal-confirm').last();
        await confirm.getByRole('button',{name:/确认|确定|应用|我已阅读/}).first().click();
        const response=await responsePromise;
        assert.equal(response.ok(),true);
        const payload=await response.json();
        const returned=payload.data.chapter.content;
        assert.equal(returned,view.acceptedDraftText);
        await expect(page.locator('.content-text').first()).toContainText('（严格验收改写）',{timeout:30000});
        const after=await readChapter(fixture);
        assert.equal(after.content,returned);
        assert.equal(after.summary,before.summary);
        assert.equal(await page.locator('.content-text').first().textContent(),returned);
        await page.reload();
        await expect(page.locator('.content-text').first()).toContainText('（严格验收改写）',{timeout:30000});
        assert.equal(await page.locator('.content-text').first().textContent(),returned);
        observations.push({width,status:expectedStatus,runId,sourceHash:hash(before.content),candidateHash:hash(view.acceptedDraftText),responseHash:hash(returned),persistedHash:hash(after.content),uiHash:hash(await page.locator('.content-text').first().textContent()),summaryPreserved:true});
        console.log(`PASS width=${width} status=${expectedStatus} fullEquality=true`);
      } finally {
        await context.close();
        await discardRefinementRuns(fixture);
        await deleteRefinementFixture(fixture);
      }
    }
  } finally {
    await browser.close();
    writeFileSync(path.join(root,'openspec/changes/add-chapter-refinement-orchestration/evidence/browser-strict-observations-2026-10-07.json'),JSON.stringify(observations,null,2)+'\n');
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});

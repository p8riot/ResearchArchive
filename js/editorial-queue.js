// ============================================================================
// [JS-EDITORIAL-01] CONSOLIDATED RESEARCH QUEUE
// Derived from canonical case, claim, question, task and review records.
// Queue items are not separately persisted or uploaded, preventing duplicate
// work items, stale second copies and artificial activity noise.
// ============================================================================
import {caseEditorialReview} from './editorial-review.js';

export const QUEUE_VIEWS = [
    ['all','All work'],
    ['questions','Open questions'],
    ['tasks','Research tasks'],
    ['citations','Citation gaps'],
    ['reviews','Case reviews']
];

export function buildEditorialQueue(rows) {
    const cases = rows.filter(row => row.type === 'case' && !row.deleted)
        .sort((a,b) => String(a.payload?.title||'').localeCompare(String(b.payload?.title||'')) || a.id.localeCompare(b.id));
    const active = rows.filter(row => !row.deleted);
    const byId = new Map(active.map(row => [row.id,row]));
    const entries = [];

    for (const investigation of cases) {
        const caseId = investigation.id;
        const caseTitle = investigation.payload?.title || 'Untitled case';
        const within = active.filter(row => row.payload?.caseId === caseId);
        for (const row of within) {
            const payload = row.payload || {};
            if (row.type === 'question' && !['Answered','Set aside'].includes(payload.status)) {
                entries.push({
                    id:'question:'+row.id, kind:'questions', caseId, caseTitle,
                    recordId:row.id, tab:'questions', urgency:2,
                    title:payload.text || 'Unwritten evidence question',
                    detail:payload.status || 'Open'
                });
            }
            if (row.type === 'claim' && (!payload.assessment || payload.assessment === 'Unresolved')) {
                entries.push({
                    id:'claim:'+row.id, kind:'questions', caseId, caseTitle,
                    recordId:row.id, tab:'claims', urgency:2,
                    title:'Unresolved claim: '+String(payload.text || 'Unnamed claim'),
                    detail:'Review the recorded evidence and uncertainty. An unresolved claim is not automatically false.'
                });
            }
            if (row.type === 'task' && payload.done !== true) {
                entries.push({
                    id:'task:'+row.id, kind:'tasks', caseId, caseTitle,
                    recordId:row.id, tab:'notes', urgency:2,
                    title:payload.title || 'Untitled research task',detail:'Research checklist',
                    priority:payload.priority || 'Routine',dueOn:payload.dueOn || ''
                });
            }
        }
        const report=caseEditorialReview(rows,caseId);
        for (let i=0; i<report.findings.length; i++) {
            const finding=report.findings[i];
            // Required missing citations and provenance advisories are actionable
            // research leads; non-citation checklist gaps remain on the review page.
            if (!/source|citation|author|publication date|provenance|retelling/i.test(finding.description)) continue;
            const related=finding.recordId?byId.get(finding.recordId):null;
            entries.push({
                id:'citation:'+caseId+':'+i, kind:'citations', caseId, caseTitle,
                recordId:related?.id || caseId,
                tab:related?.type==='claim'?'claims':related?.type==='source'?'sources':'review',
                urgency:finding.level==='blocking'?0:3,
                title:finding.description,
                detail:finding.level==='blocking'?'Required citation gap':'Source documentation recommendation'
            });
        }
        if (!report.current) {
            entries.push({
                id:'review:'+caseId, kind:'reviews', caseId, caseTitle,
                recordId:caseId, tab:'review', urgency:report.stale?1:3,
                title:report.stale?'Editorial review out of date':'Case awaiting editorial review',
                detail:report.blocking+' required item(s), '+report.advisory+' advisory item(s). Review is not a truth endorsement.'
            });
        }
    }
    return entries.sort((a,b) => a.urgency-b.urgency || a.caseTitle.localeCompare(b.caseTitle) || a.kind.localeCompare(b.kind) || a.id.localeCompare(b.id));
}

export function filterEditorialQueue(entries, {view='all',caseId='',query=''}={}) {
    const needle=query.trim().toLocaleLowerCase();
    return entries.filter(entry => (view==='all'||entry.kind===view) &&
        (!caseId||entry.caseId===caseId) &&
        (!needle || [entry.title,entry.caseTitle,entry.detail].some(text=>text.toLocaleLowerCase().includes(needle))));
}

export function editorialQueueCounts(entries) {
    const result={all:entries.length,questions:0,tasks:0,citations:0,reviews:0};
    for (const entry of entries)result[entry.kind]++;
    return result;
}

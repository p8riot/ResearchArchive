// ============================================================================
// [JS-WORKFLOW-01] SOURCE-AWARE CASE COMPLETION AND GUIDED RESEARCH
// Derived from the same canonical case, claim, citation, question, and review
// records. No duplicate completion flags, AI-generated content, or truth score.
// A step marked documented means only that the specified research field exists.
// ============================================================================
import {caseEditorialReview} from './editorial-review.js';
import {evidenceReviewGaps} from './claim-evidence.js';

const filled = value => typeof value === 'string' && value.trim().length > 0;
const linkedIds = payload => [...new Set([
    ...(Array.isArray(payload?.sourceIds) ? payload.sourceIds : []),
    ...(Array.isArray(payload?.supportSourceIds) ? payload.supportSourceIds : []),
    ...(Array.isArray(payload?.contrarySourceIds) ? payload.contrarySourceIds : [])
])];

export function caseResearchWorkflow(rows, caseId) {
    const active=rows.filter(row=>row && !row.deleted);
    const investigation=active.find(row=>row.id===caseId && row.type==='case');
    if(!investigation)throw Error('Case is unavailable');
    const p=investigation.payload||{};
    const child=type=>active.filter(row=>row.type===type && row.payload?.caseId===caseId);
    const claims=child('claim');
    const explanations=child('explanation');
    const questions=child('question');
    const tasks=child('task');
    const allSources=new Map(active.filter(row=>row.type==='source').map(row=>[row.id,row]));
    const usedIds=new Set(child('source').map(row=>row.id));
    for(const record of [...claims,...explanations,...questions,...child('theory_event')]){
        for(const id of linkedIds(record.payload))usedIds.add(id);
    }
    const missingSourceIds=[...usedIds].filter(id=>!allSources.has(id));
    const usableSources=[...usedIds].filter(id=>allSources.has(id));
    const incompleteClaims=claims.filter(claim=>{
        const cp=claim.payload||{};
        const gaps=evidenceReviewGaps(claim,[...allSources.values()]);
        return !filled(cp.text) || !filled(cp.assessment) ||
            !gaps.hasCitation || gaps.missingIds.length>0 ||
            (!filled(cp.support) && !filled(cp.contrary));
    });
    const openQuestions=questions.filter(row=>!['Answered','Set aside'].includes(row.payload?.status));
    const pendingTasks=tasks.filter(row=>row.payload?.done!==true);
    const report=caseEditorialReview(rows,caseId);
    const foundation=filled(p.centralQuestion)&&filled(p.summary);
    const sourced=usableSources.length>0 && missingSourceIds.length===0;
    const claimsReady=claims.length>0&&incompleteClaims.length===0;
    const storyWritten=filled(p.story);

    // Required steps reflect the existing review gate, not proof of the claims.
    // Optional work must never become an accidental hard gate to sign-off.
    const steps=[
        {id:'scope',title:'Define the research question',tab:'story',required:true,
            done:foundation,
            detail:foundation?'Question and Quick Overview are recorded.':'Write a central question and a source-aware Quick Overview.',
            action:'Edit case',actionType:'editCase'},
        {id:'sources',title:'Build a traceable source trail',tab:'sources',required:true,
            done:sourced,
            detail:sourced?`${usableSources.length} available source reference(s) recorded.`:
                missingSourceIds.length?`${missingSourceIds.length} referenced source(s) missing or in Trash. Relink or correct the citation.`:
                'Add original records or documented secondary sources. Record origins and citation locations.',
            action:'Review sources',actionType:'openTab'},
        {id:'claims',title:'Assess individual claims',tab:'claims',required:true,
            done:claimsReady,
            detail:claimsReady?`${claims.length} claim(s) have source links and an evidence/limitations discussion.`:
                !claims.length?'Create at least one testable claim, then link source evidence.':
                `${incompleteClaims.length} of ${claims.length} claim(s) need source links, exact wording, or evidence context.`,
            action:'Review claims',actionType:'openTab'},
        {id:'questions',title:'Resolve or document open questions',tab:'questions',required:false,
            done:openQuestions.length===0,
            detail:openQuestions.length?`${openQuestions.length} open question(s) remain. Unanswered is a legitimate outcome.`:
                'No active evidence questions remain. This does not prove every issue has an answer.',
            action:'Explore questions',actionType:'openTab'},
        {id:'tasks',title:'Follow through on research tasks',tab:'notes',required:false,
            done:pendingTasks.length===0,
            detail:pendingTasks.length?`${pendingTasks.length} task(s) unfinished.`:'No outstanding recorded research tasks.',
            action:'Review tasks',actionType:'openTab'},
        {id:'story',title:'Draft the full narrative',tab:'story',required:false,
            done:storyWritten,
            detail:storyWritten?'A Full Story draft is available. Verify that its claims match cited evidence.':
                'Optional but recommended: tell the story without inventing documentation.',
            action:'Edit narrative',actionType:'editCase'},
        {id:'review',title:'Conduct human editorial review',tab:'review',required:true,
            done:report.current,
            detail:report.current?'Human review is current for these records. Not a truth certification.':
                report.stale?'Earlier review is outdated because research changed.':
                `${report.blocking} required gap(s) and ${report.advisory} advisory item(s). Human sign-off required.`,
            action:'Open review',actionType:'openTab'}
    ];
    const required=steps.filter(s=>s.required);
    const completedRequired=required.filter(s=>s.done).length;
    // Guide sequencing prioritizes true blockers, then worthwhile optional
    // follow-through, with human editorial sign-off always last.
    const next=steps.find(s=>s.required&&!s.done&&s.id!=='review') ||
        steps.find(s=>!s.required&&!s.done) ||
        steps.find(s=>s.id==='review'&&!s.done) || null;
    return {
        caseId,steps,next,requiredCount:required.length,completedRequired,
        review:report,claimCount:claims.length,sourceCount:usableSources.length,
        missingSourceCount:missingSourceIds.length,incompleteClaimCount:incompleteClaims.length,
        openQuestionCount:openQuestions.length,pendingTaskCount:pendingTasks.length,
        explanationCount:explanations.length,
        label:report.current?'Editorial review current':
            completedRequired===required.length-1?'Ready for a human review check':'Research in progress',
        caveat:'Checklist completion measures recorded research work, never truth, credibility, or permission to publish.'
    };
}

export function prioritizeResearchCases(rows, limit=4) {
    const active=rows.filter(row=>row.type==='case'&&!row.deleted);
    const result=active.map(row=>({case:row,workflow:caseResearchWorkflow(rows,row.id)}));
    result.sort((a,b)=>{
        const reviewPenalty=w=>w.review.current?2:w.review.stale?0:1;
        return reviewPenalty(a.workflow)-reviewPenalty(b.workflow) ||
            a.workflow.completedRequired-b.workflow.completedRequired ||
            String(a.case.payload?.title||'').localeCompare(String(b.case.payload?.title||''));
    });
    return result.slice(0,Math.max(0,limit));
}

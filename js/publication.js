// ============================================================================
// [JS-PUBLIC-01] PUBLICATION CANDIDATE BOUNDARY
// A reviewed private case is NOT automatically cleared for public release.
// This module builds an explicit, minimal export candidate; it never publishes.
// ============================================================================
import {caseEditorialReview} from './editorial-review.js';

export const PUBLIC_APPROVALS = Object.freeze([
    {id:'privacy',label:'I reviewed every exported field for private details, contact information, and potentially identifying material.'},
    {id:'allegations',label:'I checked assertions about real people and organizations, clearly separated allegations from documented facts, and removed unsupported harmful claims.'},
    {id:'rights',label:'I confirmed I have the rights or other valid permission to publish the included narrative, quotations, and citations.'},
    {id:'sources',label:'I checked the original source references, citation accuracy, evidence qualifications, and factual uncertainty.'},
    {id:'preview',label:'I read the exact export preview and understand this is only a downloadable candidate, not a published page.'}
]);

const unique = ids => [...new Set(ids.filter(id=>typeof id==='string'))];
const text = value => typeof value==='string' ? value : '';
const REFERENCE_FIELDS = new Set(['sourceIds','supportSourceIds','contrarySourceIds']);
// Published citation links must be real HTTP(S) URLs, not merely strings with
// an HTTP-looking prefix. Embedded credentials and control characters are
// particularly misleading when a reader follows a public source citation.
export function validPublicSourceUrl(value) {
    if (typeof value!=='string' || value!==value.trim() || !/^https?:\/\//i.test(value) || /[\u0000-\u001f\u007f]/.test(value)) return false;
    try {
        const parsed=new URL(value);
        return (parsed.protocol==='https:' || parsed.protocol==='http:') &&
            !!parsed.hostname && !parsed.username && !parsed.password;
    } catch {return false;}
}

function selected(object,fields) {
    const result={};
    for(const field of fields) {
        const value=object[field];
        if(value===undefined || value===null)continue;
        if(REFERENCE_FIELDS.has(field)) {
            if(!Array.isArray(value) || !value.every(id=>typeof id==='string'))
                throw Error('Invalid source reference field in public candidate: '+field);
            result[field]=[...value];
        } else {
            if(typeof value!=='string')throw Error('Non-text value in a public candidate field: '+field);
            result[field]=value;
        }
    }
    return result;
}

function currentCase(rows,caseId) {
    const record=rows.find(row=>row.id===caseId && row.type==='case' && !row.deleted);
    if (!record)throw Error('Case is missing or in Trash');
    return record;
}

export function publicationAssessment(rows,caseId) {
    const record=currentCase(rows,caseId);
    const research=caseEditorialReview(rows,caseId);
    const blockers=[];
    const warnings=[];
    if (!research.current) blockers.push(research.reviewed ? 'The research review is out of date; refresh it before preparing a public candidate.' : 'Finish the manual research review before preparing a public candidate.');
    if (!research.eligible) blockers.push(`${research.blocking} required research-review item(s) remain unresolved.`);
    if (record.payload.sample)blockers.push('Demonstration or illustrative cases cannot become public candidates.');
    if (!text(record.payload.summary).trim() || !text(record.payload.story).trim())blockers.push('Both Quick Overview and Full Story text are required for public candidates.');
    const claims=rows.filter(row=>!row.deleted && row.type==='claim' && row.payload?.caseId===caseId);
    const referenced=new Set(claims.flatMap(row=>['sourceIds','supportSourceIds','contrarySourceIds'].flatMap(field=>Array.isArray(row.payload?.[field])?row.payload[field]:[])));
    const sources=rows.filter(row=>!row.deleted && row.type==='source' && (row.payload?.caseId===caseId || referenced.has(row.id)));
    const found=new Set(sources.map(row=>row.id));
    for(const id of referenced)if(!found.has(id))blockers.push('A claim cites a missing or deleted source; correct its citations.');
    for(const row of sources) {
        if (row.payload?.url && !validPublicSourceUrl(row.payload.url))blockers.push('A source contains an invalid, credential-bearing, or non-HTTP(S) link that must be corrected before export.');
        if(!text(row.payload?.author).trim() || !text(row.payload?.date).trim() || !text(row.payload?.citationLocator).trim()){
            warnings.push('Some selected source citations lack author, date, or locator details.');
            break;
        }
    }
    // Imported data can contain malformed nested objects even though the editor
    // normally saves strings. Public exports reject those, rather than copying
    // opaque objects that could carry unrelated private information.
    try { publicCandidatePreview(rows,caseId); }
    catch(error) { blockers.push('A candidate field has an invalid data type; correct imported research before export.'); }
    if (claims.some(row=>['Disputed','Unsubstantiated','Unresolved','Contradicted'].includes(row.payload?.assessment)))
        warnings.push('Some claims remain disputed, unsupported, contradicted, or unresolved. Preserve those qualifications in public-facing prose.');
    warnings.push('No automated scan can certify privacy, legal rights, factual accuracy, or safety of allegations. Human examination of every export field is required.');
    return {eligible:blockers.length===0,blockers:unique(blockers),warnings,claimCount:claims.length,sourceCount:sources.length,reviewCurrent:research.current,reviewSignature:research.signature};
}

// This explicit allowlist deliberately excludes notes, inbox, tasks, questions,
// entities, source details, local filenames, paths, file hashes, and attachments.
export function publicCandidatePreview(rows,caseId) {
    const record=currentCase(rows,caseId);
    const claims=rows.filter(row=>!row.deleted && row.type==='claim' && row.payload?.caseId===caseId)
        .sort((a,b)=>a.id.localeCompare(b.id));
    const citations=unique(claims.flatMap(row=>['sourceIds','supportSourceIds','contrarySourceIds'].flatMap(field=>Array.isArray(row.payload?.[field])?row.payload[field]:[])));
    const sources=rows.filter(row=>!row.deleted && row.type==='source' && (row.payload?.caseId===caseId || citations.includes(row.id)))
        .sort((a,b)=>a.id.localeCompare(b.id));
    return {
        exportFormat:'research-archive-public-candidate-v1',
        status:'EDITORIAL_CANDIDATE_NOT_PUBLISHED',
        case:selected(record.payload,['title','category','centralQuestion','summary','story']),
        claims:claims.map(row=>({id:row.id,...selected(row.payload,['text','assessment','support','contrary','sourceIds','supportSourceIds','contrarySourceIds'])})),
        sources:sources.map(row=>({id:row.id,...selected(row.payload,['title','sourceType','author','date','url','citationLocator','provenanceRole','independence'])}))
    };
}

export function createPublicCandidate(rows,caseId,approvals) {
    const status=publicationAssessment(rows,caseId);
    if(!status.eligible)throw Error('Publication review is blocked: '+status.blockers.join(' '));
    if(!approvals || PUBLIC_APPROVALS.some(item=>approvals[item.id]!==true))
        throw Error('Every publication safety confirmation must be checked explicitly.');
    return {
        ...publicCandidatePreview(rows,caseId),
        review:{researchSignature:status.reviewSignature,approvedAt:new Date().toISOString(),checklist:PUBLIC_APPROVALS.map(item=>item.id)},
        warning:'This file is a manually reviewed candidate only. Nothing has been published or shared automatically.'
    };
}

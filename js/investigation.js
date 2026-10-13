// ============================================================================
// [JS-INV-01] CROSS-RECORD SEARCH AND EVIDENCE BOARD RULES
// Pure domain helpers; no browser storage, file handles or cloud dependency.
// ============================================================================
import {searchLocalRecords, searchLocalRecordsWindow} from './search-index.js';

export const BOARD_KINDS=['Supports','Challenges','Context','Requires follow-up'];
export const BOARD_TYPES=['claim','source','explanation','note'];

export function boardNodes(rows,caseId){
    const cited=new Set(rows.filter(r=>!r.deleted&&['claim','explanation','theory_event'].includes(r.type)&&r.payload?.caseId===caseId)
        .flatMap(r=>['sourceIds','supportSourceIds','contrarySourceIds'].flatMap(field=>Array.isArray(r.payload?.[field])?r.payload[field]:[])));
    return rows.filter(r=>!r.deleted&&BOARD_TYPES.includes(r.type)&&
        (r.payload?.caseId===caseId || (r.type==='source'&&!r.payload?.caseId&&cited.has(r.id))));
}
export function boardTitle(row){
    if(!row)return 'Unavailable record';
    return String(row.payload?.title||row.payload?.text||'Untitled record');
}
export function validateBoardLink(payload, rows,editingId=null){
    const nodes=boardNodes(rows,payload.caseId);
    if(!payload.caseId || !BOARD_KINDS.includes(payload.kind) || !String(payload.rationale||'').trim())
        throw Error('A board connection needs a case, classification and explanation.');
    if(payload.fromId===payload.toId)throw Error('A record cannot connect to itself.');
    if(!nodes.some(x=>x.id===payload.fromId)||!nodes.some(x=>x.id===payload.toId))
        throw Error('Both board endpoints must be active research records in the same case.');
    if(rows.some(r=>r.type==='board_link'&&!r.deleted&&r.id!==editingId&&
        r.payload?.caseId===payload.caseId&&r.payload?.fromId===payload.fromId&&
        r.payload?.toId===payload.toId&&r.payload?.kind===payload.kind))
        throw Error('This specific board connection already exists. Edit the existing connection instead.');
    return true;
}

// Preserve the stable research search API while reusing a cached, local index.
export function searchRecords(rows, rawQuery, type='All') {
    return searchLocalRecords(rows, rawQuery, type);
}

// Bounded ordered results with an exact total for the incremental UI.
export function searchRecordsWindow(rows, rawQuery, type='All', limit=60) {
    return searchLocalRecordsWindow(rows, rawQuery, type, limit);
}

export function auditReferences(rows){
    const active=new Map(rows.filter(r=>!r.deleted).map(r=>[r.id,r]));
    const issues=[];
    const mention=(row,field,id)=>{
        if(!id)return;
        if(!active.has(id))issues.push({recordId:row.id,type:row.type,field,targetId:id});
    };
    for(const row of active.values()){
        const p=row.payload||{};
        for(const field of ['caseId','claimId','sourceId','fromId','toId'])mention(row,field,p[field]);
        for(const field of ['sourceIds','supportSourceIds','contrarySourceIds','derivedFromIds','itemIds','completedIds','caseIds']){
            if(Array.isArray(p[field]))for(const id of p[field])mention(row,field,id);
        }
    }
    return issues;
}

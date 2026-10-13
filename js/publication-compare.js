// Pure, read-only comparison of two explicit public-candidate v1 documents.
// Imported JSON never becomes research data, approval, sync state, or an upload.
const FIELDS={
    case:['title','category','centralQuestion','summary','story'],
    claims:['text','assessment','support','contrary','sourceIds','supportSourceIds','contrarySourceIds'],
    sources:['title','sourceType','author','date','url','citationLocator','provenanceRole','independence']
};
const REFERENCES=new Set(['sourceIds','supportSourceIds','contrarySourceIds']);
const isRecord=value=>value!==null && typeof value==='object' && !Array.isArray(value);
const MAX_RECORDS=5000;
export const MAX_CANDIDATE_BYTES=4*1024*1024;

function normalizedFields(value,kind){
    if(!isRecord(value))throw Error(`Invalid ${kind} content in prior candidate.`);
    const allowed=FIELDS[kind];
    if(Object.keys(value).some(key=>!allowed.includes(key)))throw Error(`Unsupported ${kind} field in prior candidate.`);
    const result={};
    for(const key of allowed){
        if(!Object.hasOwn(value,key))continue;
        const entry=value[key];
        if(REFERENCES.has(key)){
            if(!Array.isArray(entry) || entry.length>MAX_RECORDS || entry.some(id=>typeof id!=='string' || !id || id.length>256))
                throw Error(`Invalid ${key} citation list in prior candidate.`);
            result[key]=[...entry];
        }else{
            if(typeof entry!=='string' || entry.length>400000)throw Error(`Invalid ${key} text in prior candidate.`);
            result[key]=entry;
        }
    }
    return result;
}
function normalizedRecords(value,kind){
    if(!Array.isArray(value) || value.length>MAX_RECORDS)throw Error(`Invalid ${kind} list in prior candidate.`);
    const ids=new Set();
    return value.map(row=>{
        if(!isRecord(row) || typeof row.id!=='string' || !row.id || row.id.length>256 || ids.has(row.id))
            throw Error(`Invalid or duplicate ${kind} record ID in prior candidate.`);
        ids.add(row.id);
        const {id,...rest}=row;
        return {id,...normalizedFields(rest,kind)};
    });
}
export function validatePreviousCandidate(document){
    if(!isRecord(document) || document.exportFormat!=='research-archive-public-candidate-v1'
        || document.status!=='EDITORIAL_CANDIDATE_NOT_PUBLISHED')
        throw Error('Choose a Research Archive public-candidate v1 JSON file, not a private archive backup.');
    // Reject unknown top-level keys so a differently shaped import is not
    // silently treated as proof of a matching or safely reviewed publication.
    if(Object.keys(document).some(key=>!['exportFormat','status','case','claims','sources','review','warning'].includes(key)))
        throw Error('Unsupported prior candidate file structure.');
    return {exportFormat:document.exportFormat,status:document.status,
        case:normalizedFields(document.case,'case'),
        claims:normalizedRecords(document.claims,'claims'),
        sources:normalizedRecords(document.sources,'sources')};
}
export function parsePreviousCandidate(json){
    if(typeof json!=='string' || new TextEncoder().encode(json).length>MAX_CANDIDATE_BYTES)
        throw Error('Prior candidate is too large to compare safely (4 MiB maximum).');
    let doc;
    try{doc=JSON.parse(json);}catch{throw Error('Prior candidate is not valid JSON.');}
    return validatePreviousCandidate(doc);
}
export function comparePublicCandidates(previous,current){
    const prior=validatePreviousCandidate(previous);
    const now=validatePreviousCandidate(current);
    const changes=[];
    function compareFields(kind,id,oldRow,newRow){
        for(const field of FIELDS[kind]){
            const before=oldRow?.[field],after=newRow?.[field];
            if(JSON.stringify(before)===JSON.stringify(after))continue;
            changes.push({kind,id,field,change:'modified',before:before===undefined?null:before,after:after===undefined?null:after});
        }
    }
    compareFields('case','case',prior.case,now.case);
    for(const kind of ['claims','sources']){
        const oldMap=new Map(prior[kind].map(row=>[row.id,row]));
        const newMap=new Map(now[kind].map(row=>[row.id,row]));
        for(const [id,oldRow] of oldMap){
            const newRow=newMap.get(id);
            if(!newRow)changes.push({kind,id,field:'record',change:'removed',before:oldRow,after:null});
            else compareFields(kind,id,oldRow,newRow);
        }
        for(const [id,newRow] of newMap){
            if(!oldMap.has(id))changes.push({kind,id,field:'record',change:'added',before:null,after:newRow});
        }
    }
    const added=changes.filter(c=>c.change==='added').length;
    const removed=changes.filter(c=>c.change==='removed').length;
    return {changes,changedFields:changes.length-added-removed,addedRecords:added,removedRecords:removed,
        previousTitle:prior.case.title||'',currentTitle:now.case.title||'',
        // v1 deliberately contains no immutable case identity. Never imply identity proof.
        sameCaseVerified:false};
}

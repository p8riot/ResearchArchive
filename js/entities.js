// ============================================================================
// [JS-SUBJECTS-01] EXPLICIT ENTITY REGISTER AND TAG-DERIVED TOPIC INDEX
// A shared name, tag or subject is NOT evidence of a factual relationship.
// Only user-chosen entity.caseIds are explicit case associations.
// ============================================================================

export const ENTITY_KINDS = ['Person', 'Organization', 'Place', 'Event', 'Subject'];

export const normalizedSubject = value => String(value ?? '').normalize('NFKC')
    .trim().replace(/\s+/gu, ' ').toLocaleLowerCase();

const active = row => row && !row.deleted;
const uniqueStrings = value => Array.isArray(value) ? [...new Set(value.filter(x => typeof x === 'string' && x.trim()))] : [];

export function validateEntity(payload, rows, editingId = null) {
    const name = String(payload?.name || '').trim();
    if (!name || name.length > 180) throw Error('Entity name is required and must be at most 180 characters.');
    if (!ENTITY_KINDS.includes(payload.kind)) throw Error('Choose a supported entity type.');
    if (typeof payload.description !== 'string' || payload.description.length > 15000) {
        throw Error('Entity context must be 15,000 characters or fewer.');
    }
    const caseIds = uniqueStrings(payload.caseIds);
    if (caseIds.length !== (payload.caseIds || []).length) throw Error('Each linked case must be selected once.');
    const caseSet = new Set(rows.filter(row => active(row) && row.type === 'case').map(row => row.id));
    if (caseIds.some(id => !caseSet.has(id))) throw Error('An entity link points to a missing or deleted case.');
    if (!Array.isArray(payload.aliases) || payload.aliases.length > 50 ||
        payload.aliases.some(x => typeof x !== 'string' || x.length > 180)) {
        throw Error('Enter at most 50 short aliases.');
    }
    if (normalizedSubject(name) === '' || payload.aliases.some(a => normalizedSubject(a) === '')) {
        throw Error('Names and aliases must not be blank.');
    }
    const duplicates = rows.filter(row => active(row) && row.type === 'entity' && row.id !== editingId &&
        row.payload?.kind === payload.kind && normalizedSubject(row.payload?.name) === normalizedSubject(name));
    return {caseIds, duplicateIds:duplicates.map(row => row.id)};
}

export function buildSubjectIndex(rows) {
    const cases = new Map(rows.filter(row => active(row) && row.type === 'case').map(row => [row.id, row]));
    const entities = rows.filter(row => active(row) && row.type === 'entity')
        .map(row => ({...row, caseRows:uniqueStrings(row.payload?.caseIds).map(id => cases.get(id)).filter(Boolean)}))
        .sort((a,b) => String(a.payload.name || '').localeCompare(String(b.payload.name || '')) || a.id.localeCompare(b.id));
    const topicMap = new Map();
    for (const caseRow of cases.values()) {
        for (const tag of uniqueStrings(caseRow.payload?.tags)) {
            const key = normalizedSubject(tag);
            if (!key) continue;
            if (!topicMap.has(key)) topicMap.set(key,{key, label:tag.trim(), cases:new Map()});
            topicMap.get(key).cases.set(caseRow.id,caseRow);
        }
    }
    const topics = [...topicMap.values()].map(topic => ({key:topic.key,label:topic.label,
        caseRows:[...topic.cases.values()].sort((a,b) => String(a.payload.title||'').localeCompare(String(b.payload.title||'')))}))
        .sort((a,b) => a.label.localeCompare(b.label) || a.key.localeCompare(b.key));
    return {entities,topics,caseCount:cases.size};
}

export function caseSubjectLinks(index,caseId){
    return {entities:index.entities.filter(row => row.caseRows.some(c => c.id === caseId)),
        topics:index.topics.filter(topic => topic.caseRows.some(row => row.id === caseId))};
}

export function filterSubjectIndex(index,query = '',kind = 'All'){
    const needle = normalizedSubject(query);
    const entities = kind === 'Topics' ? [] : index.entities.filter(row =>
        (kind === 'All' || kind === row.payload.kind) &&
        (!needle || [row.payload.name,row.payload.description,...uniqueStrings(row.payload.aliases)].some(s => normalizedSubject(s).includes(needle))));
    const topics = (kind === 'All' || kind === 'Topics') ?
        index.topics.filter(topic => !needle || normalizedSubject(topic.label).includes(needle)) : [];
    return {entities,topics};
}

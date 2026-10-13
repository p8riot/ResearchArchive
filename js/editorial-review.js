import {evidenceReviewGaps} from './claim-evidence.js';
// ============================================================================
// [JS-REVIEW-01] MANUAL RESEARCH EDITORIAL REVIEW
// Review status concerns source traceability and completion only. A passing
// checklist never confirms that a theory, historical allegation, or claim is true.
// ============================================================================

const hasText = value => typeof value === 'string' && value.trim().length > 0;

const CONTENT_FIELDS = {
    case:['title','summary','story','centralQuestion','category'],
    claim:['caseId','text','assessment','support','contrary','sourceIds','supportSourceIds','contrarySourceIds'],
    source:['caseId','title','url','author','date','sourceType','details','derivedFromIds','provenanceRole','independence','citationLocator','filename'],
    explanation:['caseId','title','description','assessment','support','contrary','sourceIds'],
    theory_event:['caseId','claimId','period','title','changeKind','details','sourceIds'],
    timeline:['caseId','date','title','details','certainty'],
    note:['caseId','sourceId','title','content'],
    board_link:['caseId','fromId','toId','kind','rationale'],
    question:['caseId','text','status','answer','sourceIds']
};
function editorialFields(row) {
    const allowed = CONTENT_FIELDS[row.type] || [];
    return allowed.map(field => [field,row.payload?.[field] ?? null]);
}

function contentSignature(rows, caseId) {
    const parent = rows.find(row => row.id === caseId && row.type === 'case' && !row.deleted);
    if (!parent) throw Error('Case is unavailable');
    const children = rows.filter(row => !row.deleted && row.payload?.caseId === caseId && CONTENT_FIELDS[row.type]);
    const citedIds = new Set(children.flatMap(row => ['sourceIds','supportSourceIds','contrarySourceIds'].flatMap(field=>Array.isArray(row.payload?.[field])?row.payload[field]:[])));
    const linked = rows.filter(row => !row.deleted && row.type === 'source' && citedIds.has(row.id));
    const records = [...new Map([parent,...children,...linked].map(row => [row.id,row])).values()]
        .sort((a,b) => a.id.localeCompare(b.id));
    // Only canonical research content contributes. Server timestamps, device
    // mutations, local file availability and browser handles are excluded so
    // the same research has the same fingerprint on Windows, iPhone and Android.
    const value = JSON.stringify(records.map(row => [row.id,row.type,editorialFields(row)]));
    let hash = 2166136261;
    for (let i=0; i<value.length; i++) {
        hash ^= value.charCodeAt(i);
        hash = Math.imul(hash, 16777619);
    }
    return 'review-v1:' + (hash >>> 0).toString(16).padStart(8,'0') + ':' + value.length;
}

export function caseEditorialReview(rows, caseId) {
    const parent = rows.find(row => row.id === caseId && row.type === 'case' && !row.deleted);
    if (!parent) throw Error('Case not found');
    const p = parent.payload || {};
    const related = rows.filter(row => !row.deleted && row.payload?.caseId === caseId);
    const claims = related.filter(row => row.type === 'claim');
    const sources = rows.filter(row => row.type === 'source' && !row.deleted);
    const sourceById = new Map(sources.map(row => [row.id,row]));
    const explanations = related.filter(row => row.type === 'explanation');
    const findings = [];
    const add = (level, description, recordId = null) => findings.push({level, description, recordId});

    if (!hasText(p.title)) add('blocking','Case needs a title.');
    if (!hasText(p.centralQuestion)) add('blocking','Write a central research question.');
    if (!hasText(p.summary)) add('blocking','Write a source-aware Quick Overview.');
    if (!hasText(p.story)) add('advisory','The Full Story reading narrative is not drafted.');
    if (p.sample) add('blocking','Demonstration outlines cannot be signed off as researched cases.');
    if (!claims.length) add('blocking','Record at least one independently assessed claim.');
    if (!sources.some(row => row.payload?.caseId === caseId ||
        related.some(item => ['sourceIds','supportSourceIds','contrarySourceIds'].some(field=>Array.isArray(item.payload?.[field]) && item.payload[field].includes(row.id))))) {
        add('blocking','Link at least one traceable source to this investigation.');
    }

    for (const claim of claims) {
        const cp = claim.payload || {};
        if (!hasText(cp.text)) add('blocking','A claim is missing its exact assertion.',claim.id);
        if (!hasText(cp.assessment) || cp.assessment === 'Unresolved') {
            add('advisory','A claim remains unresolved or unassessed. Explain the uncertainty.',claim.id);
        }
        const evidence=evidenceReviewGaps(claim,sources);
        if(!evidence.hasCitation)add('blocking','A claim has no linked source records.',claim.id);
        for(const id of evidence.missingIds)add('blocking','A claim cites a missing or trashed source.',claim.id);
        if(evidence.hasCitation&&!evidence.hasClassifiedCitation)
            add('advisory','Distinguish supporting versus challenging source citations where possible.',claim.id);
        if(evidence.duplicateOpposingIds.length)
            add('advisory','A source is recorded on both sides of a claim; explain the distinction.',claim.id);
        if (!hasText(cp.support) && !hasText(cp.contrary)) {
            add('blocking','A claim needs an explicit evidence and limitations discussion.',claim.id);
        }
    }

    const used = new Map();
    for (const source of sources) {
        if (source.payload?.caseId === caseId) used.set(source.id,source);
    }
    for (const row of [...claims, ...explanations, ...related.filter(r => r.type === 'theory_event')]) {
        for(const field of ['sourceIds','supportSourceIds','contrarySourceIds'])for (const id of row.payload?.[field] || []) if (sourceById.has(id)) used.set(id,sourceById.get(id));
    }
    for (const source of used.values()) {
        const sp = source.payload || {};
        if (!hasText(sp.author) || !hasText(sp.date) || !hasText(sp.citationLocator)) {
            add('advisory','Source lacks an author, publication date, or precise citation locator.',source.id);
        }
        if (!hasText(sp.provenanceRole) || sp.provenanceRole === 'Unclassified') {
            add('advisory','Classify whether a source is primary, secondary, or a retelling.',source.id);
        }
    }
    const signature = contentSignature(rows, caseId);
    const reviewed = !!p.reviewedAt && !!p.reviewSignature;
    const stale = reviewed && (p.reviewSignature !== signature || p.status !== 'Reviewed');
    return {
        findings, blocking: findings.filter(item => item.level === 'blocking').length,
        advisory: findings.filter(item => item.level === 'advisory').length,
        eligible: !findings.some(item => item.level === 'blocking'),
        reviewed, stale, current: reviewed && !stale,
        signature, reviewedAt: p.reviewedAt || null,
        caveat: 'Research review documents traceability and editorial work, not the truth of a theory.'
    };
}

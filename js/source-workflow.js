// ============================================================================
// [JS-SOURCES-01] CASE CITATION COVERAGE AND PROVENANCE CHECKLIST
// ============================================================================
// Source records can be reused across cases. A shared citation is a pointer,
// not a duplicate source or independent corroboration.
import {sourceClaimUses} from './claim-evidence.js';

const citedIds = payload => ['sourceIds','supportSourceIds','contrarySourceIds','derivedFromIds']
    .flatMap(key => Array.isArray(payload?.[key]) ? payload[key] : []);

export function caseSourceCoverage(rows, caseId) {
    const active = rows.filter(row => row && !row.deleted);
    const sources = new Map(active.filter(row => row.type === 'source').map(row => [row.id,row]));
    const used = new Set();
    for (const row of active) {
        if (row.payload?.caseId !== caseId) continue;
        if (row.type === 'source') used.add(row.id);
        if (['claim','question','explanation','theory_event','note'].includes(row.type)) {
            for (const id of citedIds(row.payload)) used.add(id);
            if (row.type === 'note' && row.payload?.sourceId) used.add(row.payload.sourceId);
        }
    }
    const available = [...used].filter(id => sources.has(id)).map(id => sources.get(id));
    available.sort((a,b) => Number(a.payload?.caseId !== caseId) - Number(b.payload?.caseId !== caseId) ||
        String(a.payload?.title || '').localeCompare(String(b.payload?.title || '')) || a.id.localeCompare(b.id));
    return {
        sources: available,
        sharedIds: available.filter(row => row.payload?.caseId !== caseId).map(row => row.id),
        missingIds: [...used].filter(id => !sources.has(id))
    };
}

export function sourceDocumentationStatus(row, rows, caseId) {
    const p = row?.payload || {};
    const missing = [];
    if (!String(p.author || '').trim()) missing.push('author or organization');
    if (!String(p.date || '').trim()) missing.push('publication date');
    if (!String(p.citationLocator || '').trim()) missing.push('page, timestamp or passage');
    if (!p.provenanceRole || p.provenanceRole === 'Unclassified') missing.push('origin classification');
    if (!p.independence || p.independence === 'Not assessed') missing.push('independence assessment');
    const uses = sourceClaimUses(rows,row.id,caseId);
    const roles = {support:0,challenge:0,background:0};
    for (const use of uses) {
        for (const role of use.roles) {
            const label = role.toLowerCase();
            if (label.includes('support')) roles.support++;
            else if (label.includes('challeng') || label.includes('contrar')) roles.challenge++;
            else roles.background++;
        }
    }
    return {missing, uses:uses.length, roles, shared:p.caseId !== caseId,
        caveat:'A complete citation record does not verify its accuracy, independence, or the associated claim.'};
}

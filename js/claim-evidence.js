// ============================================================================
// [JS-EVIDENCE-01] SOURCE-TO-CLAIM TRACEABILITY
// A citation's presence does not establish that it supports the claim.
// Optional roles enrich legacy sourceIds without changing old data.
// ============================================================================
export const EVIDENCE_ROLES = [
    ['supportSourceIds', 'Supporting citations'],
    ['contrarySourceIds', 'Challenging citations'],
    ['sourceIds', 'Background and unclassified citations']
];

function uniqueIds(value) {
    return Array.isArray(value) ? [...new Set(value.filter(x => typeof x === 'string' && x))] : [];
}

export function claimEvidenceGroups(claim, sourceRecords) {
    const sources = new Map(sourceRecords.filter(r => r.type === 'source' && !r.deleted).map(r => [r.id, r]));
    const claimed = claim?.payload || claim || {};
    const classified = new Set([...uniqueIds(claimed.supportSourceIds), ...uniqueIds(claimed.contrarySourceIds)]);
    return EVIDENCE_ROLES.map(([field, label]) => {
        const ids = uniqueIds(claimed[field]).filter(id => field !== 'sourceIds' || !classified.has(id));
        return {field, label, ids, found: ids.map(id => sources.get(id)).filter(Boolean), missing: ids.filter(id => !sources.has(id))};
    });
}

export function sourceClaimUses(rows, sourceId, caseId = null) {
    const uses = [];
    for (const claim of rows) {
        if (claim.deleted || claim.type !== 'claim' || (caseId && claim.payload?.caseId !== caseId)) continue;
        const groups = claimEvidenceGroups(claim, rows);
        const roles = groups.filter(group => group.ids.includes(sourceId)).map(group => group.label);
        // A source may legitimately be cited on both sides, but this does not
        // count as two independently corroborating references.
        if (roles.length) uses.push({claim, roles});
    }
    return uses.sort((a,b) => String(a.claim.payload?.text||'').localeCompare(String(b.claim.payload?.text||'')));
}

export function evidenceReviewGaps(claim, sources) {
    const groups = claimEvidenceGroups(claim, sources);
    const linked = new Set(groups.flatMap(group => group.ids));
    const missing = [...new Set(groups.flatMap(group => group.missing))];
    return {
        hasCitation:linked.size>0,
        hasClassifiedCitation:groups.some(group => group.field !== 'sourceIds' && group.ids.length>0),
        missingIds:missing,
        duplicateOpposingIds:groups[0].ids.filter(id => groups[1].ids.includes(id))
    };
}

// ============================================================================
// [JS-PICKER-01] MOBILE-FRIENDLY, BOUNDED SOURCE CHOICE MODEL
// Source checkboxes are stateful outside the rendered search results, so
// changing the query or loading more results never discards chosen citations.
// This module only works with source metadata. It never reads original files.
// ============================================================================

const uniqueIds = ids => [...new Set((Array.isArray(ids) ? ids : [])
    .filter(id => typeof id === 'string' && id.length > 0))];

export function sourcePickerResults(rows, {field, caseId='', excludedId='', selectedIds=[], query='', limit=24}={}) {
    const selected = uniqueIds(selectedIds);
    const selectedSet = new Set(selected);
    const sourceById = new Map(rows.filter(row => row.type === 'source' && !row.deleted)
        .map(row => [row.id, row]));
    const available = [...sourceById.values()].filter(row => row.id !== excludedId &&
        (field === 'derivedFromIds' || !caseId || !row.payload?.caseId || row.payload.caseId === caseId));
    available.sort((a, b) => String(a.payload?.title || '').localeCompare(String(b.payload?.title || '')) || a.id.localeCompare(b.id));
    const eligibleIds = new Set(available.map(row => row.id));
    const normalized = String(query).normalize('NFKC').toLocaleLowerCase().trim();
    const matches = available.filter(row => !selectedSet.has(row.id) &&
        (!normalized || [row.payload?.title, row.payload?.author, row.payload?.date, row.payload?.citationLocator]
            .some(value => String(value || '').normalize('NFKC').toLocaleLowerCase().includes(normalized))));
    const chosen = selected.map(id => ({
        id,
        row: sourceById.get(id) || null,
        selected: true,
        unavailable: !sourceById.has(id),
        outsideCase: sourceById.has(id) && !eligibleIds.has(id)
    }));
    const listed = matches.slice(0, Math.max(1, Number(limit) || 24));
    return {
        items: [...chosen, ...listed.map(row => ({id: row.id, row, selected: false, unavailable: false, outsideCase: false}))],
        selectedCount: selected.length,
        matchCount: matches.length,
        shownMatches: listed.length,
        hasMore: listed.length < matches.length
    };
}

// ============================================================================
// [JS-SEARCH-01] CACHED, LOCAL-ONLY RESEARCH INDEX
// Every searchable word is derived from allowed local research text. No network
// requests, remote search, inference, or mutation of canonical records occurs.
// ============================================================================

const FIELDS = {
    case: ['title', 'aliases', 'tags', 'summary', 'centralQuestion', 'story', 'category'],
    source: ['title', 'author', 'date', 'sourceType', 'details', 'citationLocator', 'url', 'filename'],
    claim: ['text', 'assessment', 'support', 'contrary'],
    explanation: ['title', 'description', 'assessment', 'support', 'contrary'],
    theory_event: ['period', 'title', 'details', 'changeKind'],
    timeline: ['date', 'title', 'details'],
    note: ['title', 'content'],
    discovery: ['title', 'value', 'note', 'kind'],
    task: ['title'],
    question: ['text','status','answer'],
    relation: ['rationale', 'kind'],
    board_link: ['rationale', 'kind'],
    collection: ['title', 'description'],
    journey: ['title', 'description'],
    entity: ['name','kind','aliases','description']
};

const normalize = value => String(value ?? '').normalize('NFKC').toLocaleLowerCase();
const words = value => normalize(value).match(/[\p{L}\p{N}]+/gu) || [];
const asText = value => Array.isArray(value) ? value.join(' ') : String(value ?? '');
let cache = null;

// Three-character vocabulary shingles let ordinary partial-word queries skip
// scanning every term in a large archive. One- and two-character fragments
// retain the original full-vocabulary fallback, preserving search semantics.
function shingles(value) {
    const characters = Array.from(value);
    const result = new Set();
    for (let i = 0; i + 3 <= characters.length; i++)
        result.add(characters.slice(i, i + 3).join(''));
    return result;
}

// The standard sort and bounded first-page search share one ranking contract.
function compareResult(a, b) {
    return b.score - a.score || String(b.row.modifiedAt).localeCompare(String(a.row.modifiedAt)) ||
        a.row.id.localeCompare(b.row.id);
}


function fingerprint(rows) {
    // Cheap invalidation check: edits, imports, remote revisions, and deletes
    // change these properties. Uses the original record order, not wall time.
    return rows.map(row => [row.id, row.mutationId, row.modifiedAt, row.deleted ? 1 : 0,
        row.remoteVersion].join(':')).join('|');
}

export function createSearchIndex(rows) {
    const cases = new Map(rows.filter(row => !row.deleted && row.type === 'case')
        .map(row => [row.id, row]));
    const entries = [];
    const terms = new Map();

    for (const row of rows) {
        if (row.deleted || !FIELDS[row.type]) continue;
        const payload = row.payload || {};
        const headline = String(payload.title || payload.name || payload.text || payload.rationale || payload.period || row.type);
        const context = String(cases.get(payload.caseId)?.payload?.title || '');
        const searchable = FIELDS[row.type].map(field => asText(payload[field])).join(' ');
        const haystack = normalize(headline + ' ' + context + ' ' + searchable);
        const entry = {
            row, headline, context, haystack,
            snippet: String(payload.summary || payload.text || payload.details || payload.content ||
                payload.note || payload.description || payload.rationale || payload.story || '').slice(0, 240)
        };
        const position = entries.push(entry) - 1;
        for (const term of new Set(words(haystack))) {
            if (!terms.has(term)) terms.set(term, new Set());
            terms.get(term).add(position);
        }
    }
    const grams = new Map();
    for (const term of terms.keys()) {
        for (const gram of shingles(term)) {
            if (!grams.has(gram)) grams.set(gram, new Set());
            grams.get(gram).add(term);
        }
    }
    return {entries, terms, grams, partCache: new Map()};
}

function candidatesFor(index, rawQuery) {
    const query = normalize(rawQuery).trim();
    if (!query) return {query, parts: [], candidate: new Set()};
    const parts = query.split(/\s+/u).filter(Boolean).slice(0, 12);
    let candidate = null;

    for (const part of parts) {
        let matches = index.partCache.get(part);
        if (!matches) {
            const union = new Set();
            if (/^[\p{L}\p{N}]+$/u.test(part)) {
                let vocabulary = index.terms.keys();
                if (Array.from(part).length >= 3) {
                    const grams = shingles(part);
                    // Every matching term contains each query shingle. The
                    // smallest posting list is a safe candidate vocabulary.
                    let smallest = null;
                    for (const gram of grams) {
                        const posting = index.grams.get(gram);
                        if (!posting) { smallest = []; break; }
                        if (smallest === null || posting.size < smallest.size) smallest = posting;
                    }
                    vocabulary = smallest || [];
                }
                for (const term of vocabulary) {
                    if (!term.includes(part)) continue;
                    for (const position of index.terms.get(term)) union.add(position);
                }
            } else {
                // A source citation can include punctuation; the final
                // haystack substring check remains the authority.
                for (let position = 0; position < index.entries.length; position++) union.add(position);
            }
            matches = union;
            if (index.partCache.size >= 48) index.partCache.clear();
            index.partCache.set(part, matches);
        }
        candidate = candidate === null ? new Set(matches) :
            new Set([...candidate].filter(position => matches.has(position)));
        if (!candidate.size) break;
    }
    return {query, parts, candidate: candidate || new Set()};
}

function *matchingResults(index, rawQuery, type) {
    const {query, parts, candidate} = candidatesFor(index, rawQuery);
    if (!query) return;
    for (const position of candidate) {
        const found = index.entries[position];
        const {row, headline, context, haystack} = found;
        if (type !== 'All' && row.type !== type) continue;
        if (!parts.every(part => haystack.includes(part))) continue;
        const p = row.payload || {};
        const normalizedHeadline = normalize(headline);
        const normalizedContext = normalize(context);
        let score = parts.length;
        if (normalizedHeadline.includes(query)) score += 35;
        if (normalizedHeadline.startsWith(query)) score += 20;
        if (normalizedContext.includes(query)) score += 8;
        if (row.type === 'case') score += 8;
        if ((p.aliases || []).some(alias => normalize(alias).includes(query))) score += 18;
        yield {row, score, context, snippet: found.snippet};
    }
}

export function searchIndex(index, rawQuery, type = 'All') {
    return [...matchingResults(index, rawQuery, type)].sort(compareResult);
}

// Keep only the best visible results in memory when showing the Search screen.
// All matches still contribute to the exact count; the full-result API above
// remains available and returns the same sort order for existing callers.
export function searchIndexWindow(index, rawQuery, type = 'All', limit = 60) {
    if (!Number.isSafeInteger(limit) || limit < 1) throw Error('Invalid search result window');
    const heap = [];
    let total = 0;
    for (const result of matchingResults(index, rawQuery, type)) {
        total++;
        if (heap.length < limit) {
            heap.push(result);
            let child = heap.length - 1;
            while (child > 0) {
                const parent = (child - 1) >> 1;
                if (compareResult(heap[child], heap[parent]) <= 0) break;
                [heap[child], heap[parent]] = [heap[parent], heap[child]];
                child = parent;
            }
        } else if (compareResult(result, heap[0]) < 0) {
            heap[0] = result;
            let parent = 0;
            while (2 * parent + 1 < heap.length) {
                const left = 2 * parent + 1;
                const right = left + 1;
                const worst = right < heap.length && compareResult(heap[right], heap[left]) > 0 ? right : left;
                if (compareResult(heap[parent], heap[worst]) >= 0) break;
                [heap[parent], heap[worst]] = [heap[worst], heap[parent]];
                parent = worst;
            }
        }
    }
    return {total, results: heap.sort(compareResult)};
}

function currentIndex(rows) {
    const current = fingerprint(rows);
    if (!cache || cache.fingerprint !== current) {
        cache = {fingerprint: current, index: createSearchIndex(rows)};
    }
    return cache.index;
}

export function searchLocalRecords(rows, query, type = 'All') {
    return searchIndex(currentIndex(rows), query, type);
}

export function searchLocalRecordsWindow(rows, query, type = 'All', limit = 60) {
    return searchIndexWindow(currentIndex(rows), query, type, limit);
}

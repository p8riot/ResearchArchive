// ============================================================================
// [JS-SOURCE-INTAKE-01] REVIEW-FIRST MANUAL LINK INTAKE AND REFERENCE COPY
// No network fetching, metadata inference, source-file reads or record writes.
// ============================================================================
export const INTAKE_MAX_ROWS = 20;
export const INTAKE_MAX_CHARS = 16000;

// Normalize for *exact-link duplicate hints*, not as a claim that two
// different URLs represent the same historical document.
export function sourceLinkKey(value) {
    if (typeof value !== 'string') return null;
    try {
        const url = new URL(value.trim());
        if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
            /\s/.test(value.trim()) || value.trim().length > 2048) return null;
        return url.href;
    } catch { return null; }
}

export function prepareSourceIntake(input, rows=[], caseId='') {
    if (typeof input !== 'string' || input.length > INTAKE_MAX_CHARS) {
        throw Error('Source list must be text no longer than 16,000 characters.');
    }
    if (typeof caseId !== 'string' || !caseId.trim()) throw Error('Choose a Case File first.');
    const lines=input.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
    if (!lines.length || lines.length > INTAKE_MAX_ROWS) {
        throw Error('Enter between 1 and 20 nonempty source lines.');
    }
    const existing=new Map();
    for (const row of rows) {
        if (!row || row.type!=='source') continue;
        const key=sourceLinkKey(row.payload?.url);
        if (key && (!existing.has(key) || (existing.get(key).deleted && !row.deleted))) existing.set(key,row);
    }
    const seen=new Map(), accepted=[], duplicates=[], errors=[];
    for (let i=0;i<lines.length;i++) {
        const line=lines[i], split=line.lastIndexOf('|');
        if (split<0) { errors.push({line:i+1,message:'Use Title | https://example.org/page'});continue; }
        const title=line.slice(0,split).trim(), rawUrl=line.slice(split+1).trim();
        if (!title || title.length>240) {errors.push({line:i+1,message:'Title must contain 1 to 240 characters.'});continue;}
        const url=sourceLinkKey(rawUrl);
        if (!url) {errors.push({line:i+1,message:'Link must be a complete HTTP(S) URL without credentials or whitespace.'});continue;}
        const record={line:i+1,title,url};
        if (seen.has(url)) duplicates.push({...record,reason:`Repeated on line ${seen.get(url)}`});
        else if (existing.has(url)) duplicates.push({...record,reason:existing.get(url).deleted?'In recoverable Trash, restore the original source':'Already recorded',existingId:existing.get(url).id,existingTitle:existing.get(url).payload?.title||''});
        else accepted.push(record);
        seen.set(url,i+1);
    }
    // Invalid lines block *all* saves. A user must fix them, not lose data
    // because a partial list was silently accepted.
    return {accepted,duplicates,errors,total:lines.length};
}

export function sourceReferenceText(row) {
    if (!row || row.type!=='source' || row.deleted) throw Error('Source is unavailable.');
    const p=row.payload || {};
    const title=String(p.title||'').replace(/[\x00-\x1f\x7f-\x9f]+/g,' ').trim();
    if (!title) throw Error('A source title is required.');
    const value=(v)=>String(v??'').replace(/[\x00-\x1f\x7f-\x9f]+/g,' ').trim() || 'Not recorded';
    const url=sourceLinkKey(p.url);
    return [
        'Research Archive source reference (user-entered, not fact-checked)',
        `Title: ${title}`,
        `Author / organization: ${value(p.author)}`,
        `Publication date: ${value(p.date)}`,
        `Type: ${value(p.sourceType)}`,
        `Page / passage / timestamp: ${value(p.citationLocator)}`,
        `Public link: ${url||(p.url?'Invalid HTTP(S) link':'Not recorded')}`, 
        `Origin classification: ${value(p.provenanceRole)}`,
        `Independence assessment: ${value(p.independence)}`,
        `Archive record ID: ${value(row.id)}`,
        'Verify all details against the original before citing or publishing.'
    ].join('\n');
}

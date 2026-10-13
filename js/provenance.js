// ============================================================================
// [JS-PROV-01] RESEARCH SOURCE DEPENDENCY ANALYSIS
// Dependency links are user-authored metadata, never automatic proof or scores.
// All traversal has fixed limits to prevent pathological cyclic archives.
// ============================================================================

export function traceSourceOrigins(rows, sourceId, maxDepth=8) {
    const sources=new Map(rows.filter(r=>r.type==='source'&&!r.deleted).map(r=>[r.id,r]));
    const start=sources.get(sourceId);
    if(!start)throw Error('The source is missing or in Trash.');
    const branches=[];
    const observed=new Set([sourceId]);
    const cycles=[];
    const missing=[];
    let truncated=false;

    function walk(id, path, depth) {
        if(branches.length>=150){truncated=true;return;}
        const current=sources.get(id);
        if(!current){missing.push(id);branches.push({ids:[...path,id],issue:'missing'});return;}
        const dependencies=[...new Set((current.payload?.derivedFromIds||[]).filter(x=>typeof x==='string'))];
        if(!dependencies.length){branches.push({ids:path,issue:null});return;}
        if(depth>=maxDepth){truncated=true;branches.push({ids:path,issue:'depth-limit'});return;}
        for(const parentId of dependencies) {
            if(path.includes(parentId)){
                cycles.push([...path,parentId]);branches.push({ids:[...path,parentId],issue:'cycle'});continue;
            }
            observed.add(parentId);
            walk(parentId,[...path,parentId],depth+1);
        }
    }
    walk(sourceId,[sourceId],0);
    const citing=[...sources.values()].filter(r=>(r.payload?.derivedFromIds||[]).includes(sourceId));
    const direct=(start.payload?.derivedFromIds||[]).map(id=>sources.get(id)).filter(Boolean);
    const rootIds=[...new Set(branches.filter(b=>!b.issue).map(b=>b.ids.at(-1)))];
    return {
        source:start, sources, branches, direct, citing,
        ancestorCount:observed.size-1, rootIds, cycles, missing:[...new Set(missing)], truncated,
        note:'Recorded dependency paths show citation reuse, not factual accuracy or independent corroboration.'
    };
}

// Groups only source IDs connected through EXPLICIT dependency records.
// A source without a recorded origin remains unknown, not verified independent.
export function relatedSourceGroups(rows, sourceIds) {
    const requested=[...new Set((sourceIds||[]).filter(x=>typeof x==='string'))];
    const sources=new Map(rows.filter(r=>r.type==='source'&&!r.deleted).map(r=>[r.id,r]));
    const ancestorCache=new Map();
    function ancestry(id) {
        if(ancestorCache.has(id))return ancestorCache.get(id);
        const found=new Set(), queue=[id];
        while(queue.length && found.size<2000){
            const node=queue.pop();
            if(found.has(node))continue;
            found.add(node);
            for(const parentId of sources.get(node)?.payload?.derivedFromIds||[])
                if(sources.has(parentId)&&!found.has(parentId))queue.push(parentId);
        }
        ancestorCache.set(id,found);
        return found;
    }
    const parent=requested.map((_,i)=>i);
    function root(i){while(parent[i]!==i){parent[i]=parent[parent[i]];i=parent[i];}return i;}
    for(let i=0;i<requested.length;i++){
        const own=ancestry(requested[i]);
        for(let j=0;j<i;j++){
            const other=ancestry(requested[j]);
            if([...own].some(id=>other.has(id)))parent[root(i)]=root(j);
        }
    }
    const groups=new Map();
    requested.forEach((id,i)=>{const r=root(i);if(!groups.has(r))groups.set(r,[]);groups.get(r).push(id);});
    return {
        groups:[...groups.values()],
        unavailable:requested.filter(id=>!sources.has(id)),
        note:'Only recorded dependency overlaps are grouped. Different groups are not verified independent.'
    };
}

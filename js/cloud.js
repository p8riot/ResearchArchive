// ============================================================================
// [JS-CLOUD-01] OPTIONAL FREE-TIER STRUCTURED SYNC
// This adapter never sends physical files, browser handles, or local paths.
// Requires separate user-configured Supabase Free project and schema.sql.
// ============================================================================
import {allRecords, putRemote, markAccepted, allConflicts, getMeta, setMeta} from './data.js';

const SYNC_FIELDS = {
    case:['title','category','summary','story','status','aliases','tags','bookmarked','pinned','centralQuestion','sample','reviewedAt','reviewSignature'],
    source:['title','url','author','date','sourceType','details','derivedFromIds','provenanceRole','independence','citationLocator','filename','filesize','filetype','filehash','caseId','localOnly'],
    claim:['caseId','text','assessment','support','contrary','sourceIds','supportSourceIds','contrarySourceIds'],
    timeline:['caseId','date','title','details','certainty'],
    note:['caseId','sourceId','title','content','private'],
    discovery:['title','kind','value','note','status','caseId','tags','date'],
    relation:['fromId','toId','kind','rationale','sourceIds'],
    collection:['title','description','itemIds'],
    task:['caseId','title','done','priority','dueOn'],
    question:['caseId','text','status','answer','sourceIds'],
    explanation:['caseId','title','description','assessment','support','contrary','sourceIds'],
    theory_event:['caseId','claimId','period','title','changeKind','details','sourceIds'],
    journey:['title','description','itemIds','completedIds'],
    board_link:['caseId','fromId','toId','kind','rationale'],
    entity:['name','kind','aliases','description','caseIds'],
};

export function permittedPayload(type,payload) {
    const allowed=Object.hasOwn(SYNC_FIELDS,type) ? SYNC_FIELDS[type] : null;
    if (!allowed) throw Error('Record type not permitted for sync: '+type);
    const cleaned={};
    for (const key of allowed) {
        const value=payload[key];
        if (value===undefined || value===null) continue;
        if (Array.isArray(value)) {
            if (value.length>500 || !value.every(item=>typeof item==='string' && item.length<=2000))
                throw Error(`Research ${key} exceeds cloud list limits; nothing was shortened or uploaded.`);
            cleaned[key]=[...value];
        } else if (typeof value==='string') {
            if (value.length>200000)
                throw Error(`Research ${key} exceeds the cloud text limit; nothing was shortened or uploaded.`);
            cleaned[key]=value;
        } else if (typeof value==='boolean' || (typeof value==='number' && Number.isFinite(value))) {
            cleaned[key]=value;
        } else throw Error(`Unsupported cloud field value for ${key}; nothing was uploaded.`);
    }
    // Incoming pages are limited by UTF-8 bytes, not JavaScript character count.
    // Never silently truncate authored stories, tags, or citations to fit cloud limits.
    if (new TextEncoder().encode(JSON.stringify(cleaned)).length>250000)
        throw Error('Research record exceeds the cloud byte limit; nothing was shortened or uploaded.');
    return cleaned;
}


// Check an entire remote response page before applying its first record.
// Supabase RLS establishes account ownership on the server, but a response is
// still untrusted data. Reject unexpected keys rather than persisting local
// file state, extra private metadata, or malformed nested objects from it.
export function validateCloudPage(page) {
    if (!Array.isArray(page) || page.length > 500)
        throw Error('Cloud returned an invalid record page; nothing from this page was applied');
    const ids=new Set();
    for (const row of page) {
        if (!row || typeof row!=='object' || Array.isArray(row) ||
            typeof row.id!=='string' || !/^[0-9a-f-]{36}$/i.test(row.id) ||
            typeof row.kind!=='string' || !Object.hasOwn(SYNC_FIELDS,row.kind) ||
            !Number.isSafeInteger(row.revision) || row.revision<1 ||
            typeof row.deleted!=='boolean' ||
            typeof row.updated_at!=='string' || !Number.isFinite(Date.parse(row.updated_at)) ||
            typeof row.last_op_id!=='string' || !row.last_op_id || row.last_op_id.length>128 ||
            !row.payload || typeof row.payload!=='object' || Array.isArray(row.payload) ||
            ids.has(row.id))
            throw Error('Cloud returned malformed or duplicate record metadata; page was not applied');
        ids.add(row.id);
        const allowed=new Set(SYNC_FIELDS[row.kind]);
        for (const [key,value] of Object.entries(row.payload)) {
            if (!allowed.has(key) || value===null) {
                // Null values have no defined meaning in the metadata-only sync
                // format. Reject, do not quietly reinterpret them as deletions.
                throw Error('Cloud returned a field outside the permitted metadata format');
            }
            if (Array.isArray(value)) {
                if (value.length>500 || !value.every(v=>typeof v==='string' && v.length<=2000))
                    throw Error('Cloud returned an invalid metadata list');
            } else if (typeof value==='string') {
                if (value.length>200000)throw Error('Cloud returned an oversized text field');
            } else if (typeof value!=='boolean' &&
                       !(typeof value==='number' && Number.isFinite(value))) {
                throw Error('Cloud returned unsupported nested metadata');
            }
        }
        if (new TextEncoder().encode(JSON.stringify(row.payload)).length>250000)
            throw Error('Cloud returned an oversized research record');
    }
    return page;
}

export class CloudSync {
    constructor() { this.config=null; this.session=null; this.boundOwner=null; this.busy=false; }
    async init() {
        this.config=await getMeta('cloud_config')||null;
        this.boundOwner=await getMeta('cloud_owner_id')||null;
        this.session=await getMeta('cloud_session')||null;
        // Older v0.1.0 sessions didn't record an immutable account owner.
        // Require a fresh sign-in instead of guessing which account owns local data.
        if (this.session && (!this.boundOwner || this.session.user_id!==this.boundOwner.userId ||
            this.boundOwner.url!==this.config?.url)) {
            this.session=null;
            await setMeta('cloud_session',null);
        }
    }
    async configure(url,key) {
        const value=url.trim().replace(/\/+$/,'');
        if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(value)) throw Error('Enter a Supabase project HTTPS URL ending in .supabase.co');
        if (!key.trim()) throw Error('Public anon or publishable key is required');
        if (/^sb_secret_/i.test(key.trim())) throw Error('Never enter a secret or service-role key into this app');
        const tokenParts=key.trim().split('.');
        if (tokenParts.length===3) {
            try {
                const normalized=tokenParts[1].replace(/-/g,'+').replace(/_/g,'/');
                const claims=JSON.parse(atob(normalized));
                if (claims.role==='service_role' || claims.role==='supabase_admin') {
                    throw Error('Never enter a secret or service-role key into this app');
                }
            } catch (error) {
                if (String(error?.message).includes('service-role')) throw error;
            }
        }
        if (this.boundOwner && value!==this.boundOwner.url) {
            throw Error('This local archive belongs to a different cloud project. Back up the research and use a separate browser profile for another project.');
        }
        const nextConfig={url:value,key:key.trim()};
        await setMeta('cloud_config',nextConfig);
        this.config=nextConfig;
    }
    async request(path,options={},authorized=true) {
        if (!this.config) throw Error('Cloud sync is not configured');
        if (authorized && this.session?.expires_at && Date.now()>this.session.expires_at-60000) await this.refresh();
        const h={'apikey':this.config.key,'Content-Type':'application/json',...options.headers};
        if (authorized) {
            if (!this.session?.access_token) throw Error('Sign in to synchronize');
            h.Authorization='Bearer '+this.session.access_token;
        }
        const res=await fetch(this.config.url+path,{...options,headers:h});
        let data=null;
        const body=await res.text();
        try{ data=body?JSON.parse(body):null; }catch{ data=body; }
        if (!res.ok) throw Error(typeof data==='object'?(data?.msg||data?.message||data?.error_description||data?.hint||data?.error||`HTTP ${res.status}`):`HTTP ${res.status}`);
        return data;
    }
    async signup(email,password) {
        const data=await this.request('/auth/v1/signup',{method:'POST',body:JSON.stringify({email,password})},false);
        if (data?.access_token) await this.setSession(data);
        return data;
    }
    async signin(email,password) {
        const data=await this.request('/auth/v1/token?grant_type=password',{method:'POST',body:JSON.stringify({email,password})},false);
        await this.setSession(data);
    }
    async setSession(data) {
        if (!data?.access_token || !data?.refresh_token || !data.user?.id) {
            throw Error('Authentication did not provide a verified account identity');
        }
        const incoming={url:this.config?.url,userId:data.user.id};
        if (this.boundOwner && (this.boundOwner.url!==incoming.url || this.boundOwner.userId!==incoming.userId)) {
            throw Error('This browser archive is already linked to a different cloud account. Sign in with the original account, or export your research and start in a separate browser profile. Nothing was uploaded.');
        }
        if (!this.boundOwner) {
            await setMeta('cloud_owner_id',incoming);
            this.boundOwner=incoming;
        }
        const nextSession={access_token:data.access_token,refresh_token:data.refresh_token,
            expires_at:Date.now()+(data.expires_in||3600)*1000,
            email:data.user.email||'',user_id:data.user.id};
        await setMeta('cloud_session',nextSession);
        this.session=nextSession;
    }
    async refresh() {
        const token=this.session?.refresh_token;
        if (!token) throw Error('Sign in again to resume synchronization');
        const data=await this.request('/auth/v1/token?grant_type=refresh_token',{method:'POST',body:JSON.stringify({refresh_token:token})},false);
        await this.setSession(data);
    }
    async signout() {
        // This disconnects the local device; it does not delete research or pending edits.
        await setMeta('cloud_session',null);
        this.session=null;
    }
    async sync(onStatus=()=>{}) {
        if (this.busy) return {busy:true};
        if (!this.config || !this.session) throw Error('Configure and sign in to cloud sync first');
        if (!this.boundOwner || this.boundOwner.url!==this.config.url ||
            this.boundOwner.userId!==this.session.user_id) {
            throw Error('Cloud identity mismatch: sign in again with the original archive account');
        }
        this.busy=true;
        let pulled=0,pushed=0,conflicted=0;
        try {
            onStatus('Downloading remote changes…');
            // IDs never change, unlike updated_at. A timestamp/offset scan can
            // silently skip rows when tied timestamps are returned in different
            // orders or a record changes while pages are being downloaded.
            // Keyset paging gives every record a stable position in this pass.
            let lastId=null;
            for (;;) {
                const cursor=lastId===null ? '' : `&id=gt.${encodeURIComponent(lastId)}`;
                const path=`/rest/v1/research_records?select=id,kind,payload,revision,deleted,updated_at,last_op_id&order=id.asc&limit=500${cursor}`;
                const remote=validateCloudPage(await this.request(path));
                // Validate the entire page before applying any of its records.
                // A non-advancing cursor indicates an invalid remote response,
                // not successful completion of an account's research download.
                let previousId=lastId;
                for (const row of remote) {
                    if (previousId!==null && row.id<=previousId)
                        throw Error('Cloud returned an out-of-order cursor page; synchronization stopped before applying this page.');
                    previousId=row.id;
                }
                for (const row of remote) {
                    const result=await putRemote(row);
                    if(result==='added'||result==='updated')pulled++;
                    if(result==='conflict')conflicted++;
                }
                if (remote.length<500)break;
                lastId=previousId;
            }
            const locals=await allRecords(true);
            for(const row of locals.filter(r=>r.pending&&!r.conflict)) {
                onStatus('Uploading permitted research records…');
                const payload=permittedPayload(row.type,row.payload);
                const data=await this.request('/rest/v1/rpc/research_apply',{method:'POST',body:JSON.stringify({p_id:row.id,p_kind:row.type,p_payload:payload,p_expected:row.remoteVersion||0,p_deleted:row.deleted,p_op_id:row.mutationId})});
                if(data?.ok){
                    if (!Number.isSafeInteger(data.revision) || data.revision<1)
                        throw Error('Cloud returned an invalid upload revision; this change remains pending.');
                    await markAccepted(row.id,row.mutationId,data.revision);
                    pushed++;
                }
                else if(data?.conflict){
                    const [remote]=validateCloudPage([data.remote]);
                    if(remote.id!==row.id || remote.kind!==row.type)
                        throw Error('Cloud returned a conflict for an unrelated record');
                    await putRemote(remote);
                    conflicted++;
                } else throw Error('Unexpected synchronization response');
            }
            const n=(await allConflicts()).length;
            await setMeta('last_sync',new Date().toISOString());
            onStatus(n?`${n} conflict(s) need review`:`Up to date on this device`);
            return {pulled,pushed,conflicted:n};
        } finally {this.busy=false;}
    }
}

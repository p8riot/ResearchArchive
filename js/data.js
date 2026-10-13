// ============================================================================
// [JS-DATA-01] RESEARCH DATA STORE
// IndexedDB is the local source for all editable records. No file bytes live here.
// ============================================================================
const NAME = 'p8core-mystery-research-v1';
const SCHEMA = 1;
let connection;

function request(req) {
    return new Promise((resolve, reject) => {
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

function transactionComplete(tx) {
    return new Promise((resolve, reject) => {
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
        tx.onabort = () => reject(tx.error || new Error('Database transaction cancelled'));
    });
}

export async function initData() {
    if (connection) return connection;
    connection = await new Promise((resolve, reject) => {
        const r = indexedDB.open(NAME, SCHEMA);
        r.onupgradeneeded = () => {
            const db = r.result;
            const records = db.createObjectStore('records', {keyPath:'id'});
            records.createIndex('type', 'type');
            records.createIndex('pending', 'pending');
            db.createObjectStore('meta', {keyPath:'key'});
            db.createObjectStore('handles', {keyPath:'id'});
            db.createObjectStore('conflicts', {keyPath:'id'});
        };
        r.onsuccess = () => resolve(r.result);
        r.onerror = () => reject(r.error);
    });
    return connection;
}

function store(name, mode = 'readonly') {
    return connection.transaction(name, mode).objectStore(name);
}

export async function allRecords(includeDeleted=false) {
    const rows = await request(store('records').getAll());
    return includeDeleted ? rows : rows.filter(r=>!r.deleted);
}

export async function listRecords(type, includeDeleted=false) {
    const rows = type ? await request(store('records').index('type').getAll(type)) : await allRecords(true);
    return rows.filter(r=>includeDeleted || !r.deleted).sort((a,b)=>String(b.modifiedAt).localeCompare(String(a.modifiedAt)));
}

export function getRecord(id) { return request(store('records').get(id)); }

// A read/modify/write must share one IndexedDB transaction. Separate
// transactions can silently lose edits when two windows change a record.
export async function saveRecord(type, payload, id=null) {
    const recordId=id || crypto.randomUUID();
    const draft=structuredClone(payload);
    const now=new Date().toISOString();
    const tx=connection.transaction('records','readwrite');
    const done=transactionComplete(tx);
    const records=tx.objectStore('records');
    let saved;
    const get=records.get(recordId);
    get.onsuccess=()=>{
        const old=get.result;
        saved={
            id:recordId, type, payload:draft,
            createdAt:old?.createdAt||now,
            modifiedAt:now,
            deleted:false, pending:true,
            remoteVersion:old?.remoteVersion||0,
            mutationId:crypto.randomUUID(),
            // Editing a conflicted record must NOT lift its upload quarantine.
            // Only explicit conflict resolution may clear this marker.
            conflict:!!old?.conflict
        };
        records.put(saved);
    };
    await done;
    return saved;
}

async function setDeleted(id, deleted) {
    const tx=connection.transaction('records','readwrite');
    const done=transactionComplete(tx);
    const records=tx.objectStore('records');
    const get=records.get(id);
    get.onsuccess=()=>{
        const row=get.result;
        if (!row) return;
        row.deleted=deleted;
        row.pending=true;
        row.modifiedAt=new Date().toISOString();
        row.mutationId=crypto.randomUUID();
        records.put(row);
    };
    await done;
}

export function trashRecord(id) {return setDeleted(id,true);}
export function restoreRecord(id) {return setDeleted(id,false);}

export async function putRemote(remote) {
    if (!remote || typeof remote.id!=='string' || !Number.isInteger(remote.revision) || remote.revision<1) {
        throw Error('Invalid remote record');
    }
    const tx=connection.transaction(['records','conflicts'],'readwrite');
    const done=transactionComplete(tx);
    const records=tx.objectStore('records');
    const conflicts=tx.objectStore('conflicts');
    let outcome='unchanged';
    const get=records.get(remote.id);
    get.onsuccess=()=>{
        const local=get.result;
        if (!local) {
            records.put({
                id:remote.id, type:remote.kind, payload:remote.payload,
                createdAt:remote.updated_at, modifiedAt:remote.updated_at,
                deleted:remote.deleted, pending:false,
                remoteVersion:remote.revision,
                mutationId:remote.last_op_id, conflict:false
            });
            outcome='added';
            return;
        }
        if (local.pending) {
            if (remote.last_op_id && remote.last_op_id===local.mutationId) {
                local.remoteVersion=Math.max(local.remoteVersion,remote.revision);
                local.pending=false;
                local.conflict=false;
                records.put(local);
                outcome='acknowledged';
                return;
            }
            if (remote.revision>local.remoteVersion) {
                local.conflict=true;
                records.put(local);
                conflicts.put({id:local.id,local:structuredClone(local),remote:structuredClone(remote),detectedAt:new Date().toISOString()});
                outcome='conflict';
                return;
            }
            outcome='pending';
            return;
        }
        if (remote.revision>local.remoteVersion) {
            records.put({
                id:remote.id, type:remote.kind,
                // A Windows file handle is stored separately by stable source ID.
                // Preserve a local availability hint only for the same filename;
                // never synchronize it or claim that another device has the file.
                payload:remote.kind==='source' && local.type==='source' &&
                    local.payload?.filename===remote.payload?.filename && local.payload?.fileStatus
                    ? {...remote.payload,fileStatus:local.payload.fileStatus} : remote.payload,
                createdAt:local.createdAt, modifiedAt:remote.updated_at,
                deleted:remote.deleted, pending:false,
                remoteVersion:remote.revision,
                mutationId:remote.last_op_id, conflict:false
            });
            outcome='updated';
        }
    };
    await done;
    return outcome;
}

export async function markAccepted(id, mutationId, version) {
    const tx=connection.transaction('records','readwrite');
    const done=transactionComplete(tx);
    const records=tx.objectStore('records');
    const get=records.get(id);
    get.onsuccess=()=>{
        const row=get.result;
        if (!row) return;
        row.remoteVersion=Math.max(row.remoteVersion||0,version);
        if (row.mutationId===mutationId) {row.pending=false;row.conflict=false;}
        records.put(row);
    };
    await done;
}

export function allConflicts() { return request(store('conflicts').getAll()); }

// A conflict dialog is a snapshot, not permission to replace later edits.
// Read both sides and commit the decision in the SAME readwrite transaction.
// Optional view tokens reject decisions made from an out-of-date open dialog.
export async function resolveConflict(id, choice, combined=null, expectedMutationId=null, expectedRemoteRevision=null) {
    if (!['local','remote','combine'].includes(choice) ||
        (choice==='combine' && (!combined || typeof combined!=='object' || Array.isArray(combined)))) {
        throw Error('Invalid conflict resolution choice');
    }
    const tx=connection.transaction(['records','conflicts'],'readwrite');
    const done=transactionComplete(tx);
    const records=tx.objectStore('records');
    const conflicts=tx.objectStore('conflicts');
    let failure=null;
    const conflictRequest=conflicts.get(id);
    conflictRequest.onsuccess=()=>{
        const conflict=conflictRequest.result;
        if (!conflict) {failure=Error('Conflict not found');return;}
        const recordRequest=records.get(id);
        recordRequest.onsuccess=()=>{
            const current=recordRequest.result;
            if (!current) {failure=Error('Record no longer exists');return;}
            const reviewedMutation=expectedMutationId ?? conflict.local?.mutationId;
            if (!current.conflict || !reviewedMutation || current.mutationId!==reviewedMutation ||
                (expectedRemoteRevision!==null && conflict.remote?.revision!==expectedRemoteRevision)) {
                failure=Error('Research changed since this conflict was reviewed. Review both versions again; nothing was replaced.');
                return;
            }
            // The remote revision becomes the base of a later compare-and-swap.
            // Keeping local uses CURRENT text, never an old saved conflict copy.
            records.put({
                ...current,
                payload:choice==='remote' ? structuredClone(conflict.remote.payload) :
                    choice==='combine' ? structuredClone(combined) : current.payload,
                type:choice==='remote' ? conflict.remote.kind : current.type,
                remoteVersion:conflict.remote.revision,
                modifiedAt:new Date().toISOString(),
                deleted:choice==='remote' ? conflict.remote.deleted : current.deleted,
                pending:choice!=='remote',conflict:false,mutationId:crypto.randomUUID()
            });
            conflicts.delete(id);
        };
    };
    await done;
    if (failure) throw failure;
}

export function getMeta(key) { return request(store('meta').get(key)).then(r=>r?.value); }

// A successful IDBRequest only means IndexedDB accepted the operation.
// Storage can still fail during transaction commit (quota, disk, shutdown).
// Await transaction completion before telling the caller its write persisted.
async function committedWrite(storeName, method, argument) {
    const tx=connection.transaction(storeName,'readwrite');
    const done=transactionComplete(tx);
    const operation=tx.objectStore(storeName)[method](argument);
    await done;
    return operation.result;
}

export function setMeta(key,value) { return committedWrite('meta','put',{key,value}); }
export function getHandle(id) { return request(store('handles').get(id)).then(r=>r?.handle); }
export function setHandle(id,handle) { return committedWrite('handles','put',{id,handle}); }
export function removeHandle(id) { return committedWrite('handles','delete',id); }

// A restore may link only a source it actually inserted. The import transaction
// returns its fresh mutation token, which also prevents a later edit or sync
// from being silently replaced. Handle and local source hint commit together.
export async function linkRestoredSource(id, mutationId, originalPayload, handle, filename) {
    const linked = {...originalPayload, filename, fileStatus:'linked-local'};
    const tx = connection.transaction(['records','handles'], 'readwrite');
    const done = transactionComplete(tx);
    const records = tx.objectStore('records');
    const handles = tx.objectStore('handles');
    let result = 'conflict';
    const lookup = records.get(id);
    lookup.onsuccess = () => {
        const current = lookup.result;
        if (!current || current.type !== 'source' || current.deleted ||
            current.mutationId !== mutationId || current.pending !== true ||
            current.conflict || current.remoteVersion !== 0) return;
        // Support safe resume if a previous transaction committed but its
        // progress-journal write was interrupted. Never accept other edits.
        const original = JSON.stringify(current.payload) === JSON.stringify(originalPayload);
        const alreadyLinked = JSON.stringify(current.payload) === JSON.stringify(linked);
        if (!original && !alreadyLinked) return;
        handles.put({id, handle});
        records.put({...current, payload:linked});
        result = 'linked';
    };
    await done;
    return result;
}

// Validate the entire archive before opening a write transaction. This prevents
// a malformed later record from leaving a partially imported collection.
// Imported backups are untrusted, even when their ZIP checksums match.
// Bound nesting and reject prototype-related object keys before any write.
function validateImportedPayload(payload) {
    const stack=[{value:payload,depth:0}];
    const visited=new Set();
    let nodes=0;
    while(stack.length) {
        const {value,depth}=stack.pop();
        if (++nodes>100000 || depth>32)throw Error('Imported record is too complex');
        if (!value || typeof value!=='object')continue;
        if (visited.has(value))throw Error('Imported record contains repeated or cyclic objects');
        visited.add(value);
        const proto=Object.getPrototypeOf(value);
        if (Array.isArray(value)) {
            if (proto!==Array.prototype)throw Error('Imported record contains invalid list data');
            for (const item of value)stack.push({value:item,depth:depth+1});
        } else {
            if (proto!==Object.prototype && proto!==null)
                throw Error('Imported record contains non-JSON objects');
            for(const [key,item] of Object.entries(value)) {
                if (key==='__proto__' || key==='constructor' || key==='prototype')
                    throw Error('Imported record contains unsafe object keys');
                stack.push({value:item,depth:depth+1});
            }
        }
    }
}

export function validateImportedRecords(records) {
    if (!Array.isArray(records) || records.length > 100000) throw Error('Invalid archive record list');
    const types=new Set(['case','source','claim','timeline','note','discovery','relation','collection','task','explanation','theory_event','journey','board_link','question','entity']);
    const seen=new Set();
    for (const row of records) {
        if (!row || typeof row.id!=='string' || !/^[0-9a-f-]{36}$/i.test(row.id) ||
            !types.has(row.type) || !row.payload || typeof row.payload!=='object' ||
            Array.isArray(row.payload) || seen.has(row.id)) {
            throw Error('Invalid or duplicate record in archive; nothing was imported');
        }
        validateImportedPayload(row.payload);
        if (JSON.stringify(row.payload).length > 1000000) {
            throw Error('Research record exceeds the import safety limit');
        }
        seen.add(row.id);
    }
    return records.length;
}

export async function importRecords(records, options={}) {
    validateImportedRecords(records);
    // Lookup and conditional insertion occur in one IndexedDB transaction.
    // Any failure aborts the whole operation; existing IDs are preserved.
    const tx=connection.transaction('records','readwrite');
    const complete=transactionComplete(tx);
    const recordsStore=tx.objectStore('records');
    let added=0,skipped=0;
    const addedIds=options.collectAddedIds===true ? [] : null;
    const addedMutations=options.collectAddedMutations===true ? [] : null;
    for (const row of records) {
        const query=recordsStore.get(row.id);
        query.onsuccess=()=>{
            if (query.result) { skipped++; return; }
            const now=new Date().toISOString();
            const mutationId=crypto.randomUUID();
            recordsStore.put({
                id:row.id, type:row.type, payload:structuredClone(row.payload),
                createdAt:row.createdAt||now, modifiedAt:row.modifiedAt||now,
                deleted:!!row.deleted, pending:true, remoteVersion:0,
                mutationId, conflict:false
            });
            added++;
            if (addedIds) {
                addedIds.push(row.id);
            }
            if (addedMutations) addedMutations.push({id:row.id,mutationId});
        };
    }
    await complete;
    return {...{added,skipped},...(addedIds ? {addedIds} : {}),
        ...(addedMutations ? {addedMutations} : {})};
}

export async function exportRecords() {
    const records=await allRecords(true);
    return {format:'p8core-research-metadata',formatVersion:1,exportedAt:new Date().toISOString(),
        notice:'Metadata-only backup. Does not contain PC-only PDFs, images or other research files.',
        records:records.map(({id,type,payload,createdAt,modifiedAt,deleted})=>({id,type,payload,createdAt,modifiedAt,deleted}))};
}

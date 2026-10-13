// ============================================================================
// [JS-DIR-01] LARGE ARCHIVE BACKUP, VERIFICATION, RECOVERY
// User-selected PC directories only. Never uploads document bytes, writes
// over existing files, or assumes a destination is physically independent.
// Each source is streamed: memory use is bounded by the browser's chunk size.
// ============================================================================
import {
    allRecords, exportRecords, importRecords, validateImportedRecords,
    getHandle, linkRestoredSource
} from './data.js';

const encoder=new TextEncoder();
const decoder=new TextDecoder();
const FORMAT='p8core-research-directory-archive';
const RESTORE_PROGRESS='restore-progress.json';

async function metadataDigest(metadata){
    const buffer=await crypto.subtle.digest('SHA-256',encoder.encode(JSON.stringify(metadata)));
    return [...new Uint8Array(buffer)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}

async function snapshotFingerprint(manifest,metadata){
    const value=JSON.stringify({manifest,metadata});
    const digest=await crypto.subtle.digest('SHA-256',encoder.encode(value));
    return [...new Uint8Array(digest)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
const TABLE=Array.from({length:256},(_,i)=>{
    let c=i;
    for(let n=0;n<8;n++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;
    return c>>>0;
});
function extendCRC(state, chunk){
    let c=state;
    for(const byte of chunk)c=TABLE[(c^byte)&255]^(c>>>8);
    return c>>>0;
}
function safeName(name){
    const clean=String(name||'file').replace(/[^a-zA-Z0-9._ -]/g,'_').replace(/^\.+/,'_').replace(/\.\./g,'_').slice(0,90);
    return clean||'file';
}
function snapshotFolder(prefix){
    return `${prefix}-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomUUID().slice(0,8)}`;
}
async function exclusiveFolder(parent,prefix){
    const name=snapshotFolder(prefix);
    try{await parent.getDirectoryHandle(name,{create:false});throw Error('Backup folder collision. Retry with a new folder.');}
    catch(e){if(e.name!=='NotFoundError')throw e;}
    return {name,handle:await parent.getDirectoryHandle(name,{create:true})};
}
async function writeNewFile(folder,name,bytes){
    const handle=await folder.getFileHandle(name,{create:true});
    const writer=await handle.createWritable();
    try{await writer.write(bytes);await writer.close();}
    catch(e){try{await writer.abort();}catch{}throw e;}
    return handle;
}
async function readJSON(folder,name){
    const handle=await folder.getFileHandle(name,{create:false});
    const file=await handle.getFile();
    if(file.size>120*1024*1024)throw Error('Metadata or manifest is too large for safe JSON parsing.');
    return JSON.parse(await file.text());
}
async function fileChecksum(file){
    const reader=file.stream().getReader();
    let state=0xffffffff,size=0;
    try{
        while(true){const {done,value}=await reader.read();if(done)break;
            size+=value.byteLength;state=extendCRC(state,value);
        }
    } finally {reader.releaseLock();}
    return {size,crc32:(state^0xffffffff)>>>0};
}
async function streamCopy(source,destination){
    const readable=source.stream().getReader();
    const writable=await destination.createWritable();
    let state=0xffffffff,size=0;
    try{
        while(true){const {done,value}=await readable.read();if(done)break;
            await writable.write(value);size+=value.byteLength;state=extendCRC(state,value);
        }
        await writable.close();
    } catch(e){try{await writable.abort();}catch{}throw e;}
    finally{readable.releaseLock();}
    return {size,crc32:(state^0xffffffff)>>>0};
}
function validateManifest(manifest,metadata){
    if(manifest?.format!==FORMAT||manifest.version!==1||metadata?.format!=='p8core-research-metadata'||metadata.formatVersion!==1)
        throw Error('Unsupported directory archive format.');
    validateImportedRecords(metadata.records);
    if(manifest.metadataSha256!==undefined && (typeof manifest.metadataSha256!=='string'||!/^[a-f0-9]{64}$/.test(manifest.metadataSha256)))
        throw Error('Invalid research metadata digest in archive manifest');
    if(!Array.isArray(manifest.files)||!Array.isArray(manifest.missing)||manifest.files.length>100000)
        throw Error('Invalid directory archive file manifest.');
    if(!Number.isInteger(manifest.sourceReferences)||manifest.sourceReferences<0||
        manifest.sourceReferences!==manifest.files.length+manifest.missing.length||
        manifest.complete!==(manifest.missing.length===0)||
        manifest.metadataRecords!==metadata.records.length)
        throw Error('Backup file counts and completion status are inconsistent.');
    const sources=new Set(metadata.records.filter(r=>r.type==='source' && !r.deleted &&
        typeof r.payload?.filename==='string' && r.payload.filename.length>0).map(r=>r.id));
    if(manifest.sourceReferences!==sources.size)
        throw Error('Source inventory does not cover every linked document in research metadata.');
    const seen=new Set();
    const storedNames=new Set();
    for(const item of manifest.files){
        if(!item||!sources.has(item.id)||seen.has(item.id)||
            typeof item.name!=='string'||!/^[-a-zA-Z0-9._ ]{1,140}$/.test(item.name)||
            item.name.includes('..')||!Number.isSafeInteger(item.size)||item.size<0||
            !Number.isInteger(item.crc32)||item.crc32<0||item.crc32>0xffffffff)
            throw Error('Unsafe or inconsistent file manifest entry.');
        if(storedNames.has(item.name))throw Error('Backup manifest reuses a physical file name for more than one source.');
        storedNames.add(item.name);
        seen.add(item.id);
    }
    for(const item of manifest.missing){
        if(!item||!sources.has(item.id)||seen.has(item.id)||
            typeof item.filename!=='string'||item.filename.length<1||item.filename.length>512 ||
            item.filename!==metadata.records.find(row=>row.id===item.id)?.payload?.filename)
            throw Error('Invalid missing-file manifest entry.');
        seen.add(item.id);
    }
    if(seen.size!==sources.size)throw Error('Backup manifest omits a linked research source.');
    return true;
}
async function getBackupFiles(folder){
    const manifest=await readJSON(folder,'backup-manifest.json');
    const metadata=await readJSON(folder,'research-metadata.json');
    validateManifest(manifest,metadata);
    if(manifest.metadataSha256 && manifest.metadataSha256!==await metadataDigest(metadata))
        throw Error('Backup research metadata integrity check failed');
    const sourceFolder=manifest.files.length?await folder.getDirectoryHandle('source-files',{create:false}):null;
    return {manifest,metadata,sourceFolder};
}
// An unfinished snapshot retains a durable progress journal after every
// verified source file. Completed source copies are never overwritten on resume.
const PROGRESS = 'backup-progress.json';

async function writeProgress(folder, progress) {
    await writeNewFile(folder, PROGRESS, encoder.encode(JSON.stringify(progress, null, 2)));
}

function validateProgress(progress, metadata) {
    if (!progress || progress.format !== FORMAT || progress.version !== 1 ||
        progress.phase !== 'in-progress' || !Array.isArray(progress.files) ||
        !Array.isArray(progress.missing)) throw Error('Not a resumable backup progress journal');
    validateImportedRecords(metadata.records);
    const sources = metadata.records.filter(row => row.type === 'source' &&
        row.payload?.filename && !row.deleted);
    if (progress.metadataSha256 !== undefined &&
        (typeof progress.metadataSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(progress.metadataSha256)))
        throw Error('Invalid research metadata digest in backup progress journal');
    if (progress.sourceReferences !== sources.length || progress.metadataRecords !== metadata.records.length)
        throw Error('Snapshot progress does not match its saved research metadata');
    const ids = new Set(sources.map(row => row.id));
    const seen = new Set();
    const names = new Set();
    const filenames = new Map(sources.map(row => [row.id,row.payload.filename]));
    for (const item of [...progress.files, ...progress.missing]) {
        if (!item || !ids.has(item.id) || seen.has(item.id))
            throw Error('Snapshot progress contains a duplicate or unrelated source');
        seen.add(item.id);
        if ('name' in item) {
            if (typeof item.name !== 'string' || !/^[-a-zA-Z0-9._ ]{1,140}$/.test(item.name) ||
                item.name.includes('..') || names.has(item.name) ||
                !Number.isSafeInteger(item.size) || item.size < 0 ||
                !Number.isInteger(item.crc32) || item.crc32 < 0 || item.crc32 > 0xffffffff)
                throw Error('Invalid source file entry in backup journal');
            names.add(item.name);
        } else if (typeof item.filename !== 'string' || item.filename !== filenames.get(item.id) ||
                   typeof item.reason !== 'string' || item.reason.length > 2048) {
            throw Error('Invalid missing-file entry in backup journal');
        }
    }
    return sources;
}

async function finishDirectoryBackup(folder, progress, metadata, onProgress) {
    const sources = validateProgress(progress, metadata);
    // An interrupted backup must resume the exact saved metadata snapshot.
    // The final manifest hash alone cannot detect pre-finalization changes.
    if (progress.metadataSha256 && progress.metadataSha256 !== await metadataDigest(metadata))
        throw Error('Interrupted backup metadata changed or failed integrity verification. Start a fresh snapshot; existing files were not modified.');
    const sourceFolder = sources.length ? await folder.getDirectoryHandle('source-files', {create:true}) : null;
    const done = new Set([...progress.files, ...progress.missing].map(item => item.id));
    for (const item of progress.files) {
        const file = await (await sourceFolder.getFileHandle(item.name, {create:false})).getFile();
        const verified = await fileChecksum(file);
        if (verified.size !== item.size || verified.crc32 !== item.crc32)
            throw Error('An earlier source copy failed verification. The snapshot is NOT complete. Start a fresh backup.');
    }
    for (let i=0; i<sources.length; i++) {
        const row = sources[i];
        if (done.has(row.id)) continue;
        onProgress(`${i+1}/${sources.length}: ${row.payload.filename}`);
        let file;
        try {
            const handle = await getHandle(row.id);
            if (!handle) throw Error('No accessible file handle in this browser');
            if (typeof handle.queryPermission === 'function' &&
                (await handle.queryPermission({mode:'read'})) !== 'granted')
                throw Error('File permission needs to be granted or relinked');
            file = await handle.getFile();
            if (!file || typeof file.stream !== 'function') throw Error('Source file is not readable as a stream');
        } catch(error) {
            progress.missing.push({id:row.id, filename:row.payload.filename, reason:String(error.message || error)});
            await writeProgress(folder, progress);
            continue;
        }
        // A random backup-only name avoids clobbering an orphaned partial copy
        // left by an interruption before the previous journal write.
        const name = `${row.id}_${crypto.randomUUID().slice(0,8)}_${safeName(file.name)}`;
        const target = await sourceFolder.getFileHandle(name, {create:true});
        const transferred = await streamCopy(file, target);
        if (transferred.size !== file.size) throw Error('Source changed during backup. Resume later or begin a fresh snapshot.');
        const verified = await fileChecksum(await target.getFile());
        if (verified.size !== transferred.size || verified.crc32 !== transferred.crc32)
            throw Error('Copied file failed read-back verification. The snapshot is NOT complete.');
        progress.files.push({id:row.id, name, size:verified.size, crc32:verified.crc32});
        await writeProgress(folder, progress);
    }
    const manifest = {
        format:FORMAT, version:1, createdAt:progress.createdAt,
        sourceReferences:progress.sourceReferences,
        complete:progress.missing.length === 0,
        metadataRecords:metadata.records.length,
        metadataSha256:await metadataDigest(metadata),
        files:progress.files, missing:progress.missing,
        checksum:'CRC-32 per file, with read-back verification; detects accidental corruption, not a cryptographic signature.',
        notice:'Backup is only independently protected if stored on a separate physical drive. Never synced to cloud.'
    };
    validateManifest(manifest,metadata);
    // A successful FileSystemWritableFileStream.close() is not proof that the
    // stored snapshot contains the intended bytes. Check metadata already on
    // disk and read the final manifest back before reporting backup success.
    // No existing source copy or local research record is changed by this gate.
    let storedMetadata;
    try {storedMetadata=await readJSON(folder,'research-metadata.json');}
    catch {throw Error('Backup metadata failed final read-back verification. Start a NEW backup; this folder is not verified.');}
    if(await metadataDigest(storedMetadata)!==manifest.metadataSha256)
        throw Error('Backup metadata failed final read-back verification. Start a NEW backup; this folder is not verified.');
    const manifestBytes=encoder.encode(JSON.stringify(manifest,null,2));
    await writeNewFile(folder,'backup-manifest.json',manifestBytes);
    const savedManifest=await (await folder.getFileHandle('backup-manifest.json',{create:false})).getFile();
    const savedBytes=new Uint8Array(await savedManifest.arrayBuffer());
    if(savedBytes.length!==manifestBytes.length || savedBytes.some((byte,index)=>byte!==manifestBytes[index]))
        throw Error('Backup final manifest read-back verification failed. Start a NEW backup; this folder is not verified.');
    // Only a byte-for-byte read-back verified final manifest qualifies as finished.
    onProgress(manifest.complete?'Backup written and verified':'Partial backup written, inspect missing list');
    return {files:progress.files.length, missing:progress.missing,
        complete:manifest.complete, records:metadata.records.length,
        journalIntegrity:progress.metadataSha256 ? 'SHA-256 journal verified' : 'legacy journal without original metadata digest'};
}

export async function backupToDirectory(destination, onProgress=()=>{}) {
    const {name, handle:folder} = await exclusiveFolder(destination,'ResearchArchive-backup');
    const metadata = await exportRecords();
    const sources = metadata.records.filter(row => row.type==='source' && row.payload?.filename && !row.deleted);
    await writeNewFile(folder,'research-metadata.json',encoder.encode(JSON.stringify(metadata)));
    const progress = {format:FORMAT, version:1, phase:'in-progress',
        createdAt:new Date().toISOString(), sourceReferences:sources.length,
        metadataRecords:metadata.records.length, metadataSha256:await metadataDigest(metadata),
        files:[], missing:[]};
    await writeProgress(folder, progress);
    try {
        return {folder:name,...await finishDirectoryBackup(folder, progress, metadata, onProgress)};
    } catch(error) {
        if (/Backup (metadata|final manifest) .*read-back verification/i.test(error.message))
            throw Error(`${error.message} Snapshot folder: ${name}. Do NOT resume this damaged finalization; make a fresh backup in a new folder.`);
        throw Error(`${error.message} Unfinished snapshot folder: ${name}. Use Resume Interrupted Backup in Settings; do not treat it as a complete backup.`);
    }
}

export async function resumeDirectoryBackup(folder, onProgress=()=>{}) {
    try {
        await folder.getFileHandle('backup-manifest.json', {create:false});
        throw Error('This snapshot already has a final manifest. It cannot be resumed or modified.');
    } catch(error) {
        if (error.name !== 'NotFoundError') throw error;
    }
    const metadata = await readJSON(folder,'research-metadata.json');
    const progress = await readJSON(folder,PROGRESS);
    validateProgress(progress,metadata);
    return finishDirectoryBackup(folder,progress,metadata,onProgress);
}

export async function verifyDirectoryBackup(folder,onProgress=()=>{}){
    const {manifest,metadata,sourceFolder}=await getBackupFiles(folder);
    const failures=[];
    for(let i=0;i<manifest.files.length;i++){
        const entry=manifest.files[i];onProgress(`Verifying ${i+1}/${manifest.files.length}: ${entry.name}`);
        try{
            const file=await (await sourceFolder.getFileHandle(entry.name,{create:false})).getFile();
            const actual=await fileChecksum(file);
            if(actual.size!==entry.size||actual.crc32!==entry.crc32)throw Error('CRC-32 or file size mismatch');
        }catch(e){failures.push({id:entry.id,name:entry.name,reason:String(e.message||e)});}
    }
    return {ok:failures.length===0,complete:manifest.complete && !failures.length,
        metadataIntegrity:manifest.metadataSha256?'SHA-256 verified':'Legacy backup: no metadata digest',
        files:manifest.files.length,metadataRecords:metadata.records.length,
        missing:manifest.missing,failures,manifest,metadata};
}
// Restore journals are stored in the NEW destination folder, never in the
// source snapshot. The folder and journal are reusable after interruption.
// They cannot silently be repointed to another backup or set of source IDs.
function validateRestoreProgress(progress,check,fingerprint){
    // Older interrupted journals predate import-ownership receipts. A journal
    // still in the copying phase can be upgraded safely because its metadata
    // transaction has not begun. Later phases cannot prove ownership and must
    // not silently inherit permission to relink other records.
    if(progress && !Object.hasOwn(progress,'ownedMutations')){
        if(progress.phase!=='copying' || !Array.isArray(progress.linked) || progress.linked.length)
            throw Error('Older interrupted restore journal cannot prove record ownership. Start a fresh restore in a NEW destination folder; existing records remain unchanged.');
        progress.ownedMutations=[];
    }
    if(!progress || progress.format!==FORMAT || progress.version!==1 ||
        !['copying','importing','linking','complete'].includes(progress.phase) ||
        progress.snapshotFingerprint!==fingerprint ||
        !Array.isArray(progress.newRecordIds) || !Array.isArray(progress.files) ||
        !Array.isArray(progress.linked) || !Array.isArray(progress.ownedMutations) ||
        progress.files.length>100000 || progress.ownedMutations.length>100000)
        throw Error('Restore progress does not match this verified backup');
    const expectedIds=new Set(check.metadata.records.map(row=>row.id));
    if(progress.newRecordIds.some(id=>!expectedIds.has(id)) || new Set(progress.newRecordIds).size!==progress.newRecordIds.length)
        throw Error('Restore journal contains invalid planned record IDs');
    const expectedFiles=new Map(check.manifest.files.map(item=>[item.id,item]));
    const seen=new Set();
    const destinationNames=new Set();
    for(const item of progress.files){
        const expected=expectedFiles.get(item.id);
        if(!expected || seen.has(item.id) || !progress.newRecordIds.includes(item.id) ||
            item.originalName!==expected.name || item.size!==expected.size || item.crc32!==expected.crc32 ||
            typeof item.name!=='string' || !/^[-a-zA-Z0-9._ ]{1,140}$/.test(item.name) || item.name.includes('..') ||
            item.name===RESTORE_PROGRESS)
            throw Error('Restore journal has invalid or duplicate file entries');
        if(destinationNames.has(item.name))
            throw Error('Restore journal reuses a physical destination file name; no records or source links were changed.');
        destinationNames.add(item.name);
        seen.add(item.id);
    }
    const owned=new Set();
    for(const entry of progress.ownedMutations){
        if(!entry || typeof entry.id!=='string' || typeof entry.mutationId!=='string' ||
            !/^[0-9a-f-]{36}$/i.test(entry.mutationId) ||
            !progress.newRecordIds.includes(entry.id) || owned.has(entry.id))
            throw Error('Restore journal has invalid or duplicate imported-record claims');
        owned.add(entry.id);
    }
    if(progress.linked.some(id=>!seen.has(id) || !owned.has(id)) ||
        new Set(progress.linked).size!==progress.linked.length)
        throw Error('Restore journal has inconsistent relink progress');
}

async function writeRestoreProgress(folder,progress){
    await writeNewFile(folder,RESTORE_PROGRESS,encoder.encode(JSON.stringify(progress,null,2)));
}

async function advanceRestore(check,snapshot,destinationFolder,progress,onProgress){
    const fingerprint=await snapshotFingerprint(check.manifest,check.metadata);
    validateRestoreProgress(progress,check,fingerprint);
    const expectedFiles=check.manifest.files.filter(file=>progress.newRecordIds.includes(file.id));
    const snapshotFiles=expectedFiles.length?await snapshot.getDirectoryHandle('source-files',{create:false}):null;
    // Verify all previously copied destination files before doing anything else.
    for(const entry of progress.files){
        const file=await (await destinationFolder.getFileHandle(entry.name,{create:false})).getFile();
        const actual=await fileChecksum(file);
        if(actual.size!==entry.size || actual.crc32!==entry.crc32)
            throw Error('Previously restored file failed verification. Research data was not overwritten.');
    }
    const copied=new Set(progress.files.map(file=>file.id));
    for(let index=0;index<expectedFiles.length;index++){
        const item=expectedFiles[index];
        if(copied.has(item.id))continue;
        onProgress(`Copying ${index+1}/${expectedFiles.length}: ${item.name}`);
        const original=await (await snapshotFiles.getFileHandle(item.name,{create:false})).getFile();
        // Fresh randomized names avoid overwriting incomplete copies from a
        // crash before the journal could record successful verification.
        const name=`restored_${item.id}_${crypto.randomUUID().slice(0,8)}_${safeName(item.name)}`.slice(0,140);
        const destination=await destinationFolder.getFileHandle(name,{create:true});
        const copiedFile=await streamCopy(original,destination);
        if(copiedFile.size!==item.size || copiedFile.crc32!==item.crc32)
            throw Error('Restore copy mismatch; no existing research data was changed.');
        const verified=await fileChecksum(await destination.getFile());
        if(verified.size!==item.size || verified.crc32!==item.crc32)
            throw Error('Restored source failed read-back verification.');
        progress.files.push({id:item.id,originalName:item.name,name,size:item.size,crc32:item.crc32});
        await writeRestoreProgress(destinationFolder,progress);
    }
    let result={added:0,skipped:0};
    if(progress.phase!=='linking'){
        progress.phase='importing';
        await writeRestoreProgress(destinationFolder,progress);
        // Only IDs freshly inserted by this restore transaction are owned.
        // If the app stops after commit but before journaling ownership,
        // leave those records unlinked rather than claiming another edit.
        result=await importRecords(check.metadata.records,{collectAddedIds:true,collectAddedMutations:true});
        const owned=new Map(progress.ownedMutations.map(entry=>[entry.id,entry]));
        for(const entry of result.addedMutations)owned.set(entry.id,entry);
        progress.ownedMutations=[...owned.values()];
        progress.phase='linking';
        await writeRestoreProgress(destinationFolder,progress);
    }
    const importedById=new Map(check.metadata.records.map(row=>[row.id,row]));
    const owned=new Map(progress.ownedMutations.map(entry=>[entry.id,entry.mutationId]));
    const alreadyLinked=new Set(progress.linked);
    const conflicts=[];
    for(const item of progress.files){
        if(alreadyLinked.has(item.id))continue;
        const original=importedById.get(item.id);
        const mutationId=owned.get(item.id);
        if(!original || !mutationId){
            // Another tab, cloud sync, or a journal interruption may have
            // inserted this ID. It must not acquire a restored file handle.
            continue;
        }
        const handle=await destinationFolder.getFileHandle(item.name,{create:false});
        const status=await linkRestoredSource(item.id,mutationId,original.payload,handle,original.payload.filename);
        if(status!=='linked'){
            conflicts.push(item.id);
            continue;
        }
        progress.linked.push(item.id);
        await writeRestoreProgress(destinationFolder,progress);
    }
    if(conflicts.length){
        // Keep journal resumable for explicit future attention. No source
        // record or file handle from conflicting data is overwritten.
        throw Error(`${conflicts.length} restored source(s) changed after snapshot. No conflicting sources were overwritten. Resolve them before resuming.`);
    }
    progress.phase='complete';
    await writeRestoreProgress(destinationFolder,progress);
    const unlinked=progress.files.length-progress.linked.length;
    return {...result,filesRestored:progress.linked.length,filesUnlinked:unlinked,missing:check.missing,
        fullBackup:check.complete,folder:progress.folderName||'',
        warning:unlinked
            ? `${unlinked} copied source(s) were left unlinked because they were not verifiably inserted by this restore. Relink manually if needed. Keep the original backup separately.`
            : 'The restore was verified, copied to a separate folder, and merged without replacing existing IDs. Keep the original backup separately.'};
}

export async function restoreDirectoryBackup(snapshot,target,onProgress=()=>{}){
    const check=await verifyDirectoryBackup(snapshot,onProgress);
    if(!check.ok)throw Error('Backup verification failed. Restore cancelled before writing any files or records.');
    const existing=new Set((await allRecords(true)).map(row=>row.id));
    const chosen=await exclusiveFolder(target,'ResearchArchive-restored-files');
    const fingerprint=await snapshotFingerprint(check.manifest,check.metadata);
    const progress={format:FORMAT,version:1,phase:'copying',folderName:chosen.name,
        snapshotFingerprint:fingerprint,
        newRecordIds:check.metadata.records.filter(row=>!existing.has(row.id)).map(row=>row.id),
        files:[],linked:[],ownedMutations:[]};
    await writeRestoreProgress(chosen.handle,progress);
    try{return await advanceRestore(check,snapshot,chosen.handle,progress,onProgress);}
    catch(error){throw Error(`${error.message} Interrupted restore destination: ${chosen.name}. Choose Resume Interrupted Restore and this destination subfolder after correcting the issue.`);}
}

export async function resumeDirectoryRestore(snapshot,unfinishedFolder,onProgress=()=>{}){
    const check=await verifyDirectoryBackup(snapshot,onProgress);
    if(!check.ok)throw Error('Source backup no longer verifies. Restore cannot resume.');
    const progress=await readJSON(unfinishedFolder,RESTORE_PROGRESS);
    validateRestoreProgress(progress,check,await snapshotFingerprint(check.manifest,check.metadata));
    if(progress.phase==='complete')throw Error('This restore is already complete.');
    return advanceRestore(check,snapshot,unfinishedFolder,progress,onProgress);
}

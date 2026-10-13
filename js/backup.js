// ============================================================================
// [JS-BACKUP-01] SMALL ARCHIVE ZIP BACKUP AND RESTORE
// Store-only ZIP format. No external libraries, CDN, or network transfer.
// Bound size to keep browser memory usage predictable. The large-archive
// backup policy remains separate physical-drive copying.
// ============================================================================
import {allRecords, exportRecords, importRecords, validateImportedRecords, getHandle, linkRestoredSource} from './data.js';

const encoder=new TextEncoder();
const decoder=new TextDecoder();
const MAX_TOTAL=120*1024*1024;
const CRC_TABLE=Array.from({length:256},(_,i)=>{
    let c=i;
    for(let j=0;j<8;j++)c=(c&1)?0xedb88320^(c>>>1):c>>>1;
    return c>>>0;
});
function crc32(bytes){
    let c=0xffffffff;
    for(const b of bytes)c=CRC_TABLE[(c^b)&255]^(c>>>8);
    return (c^0xffffffff)>>>0;
}
function u16(out,n){out.push(n&255,(n>>>8)&255);}
function u32(out,n){u16(out,n);u16(out,n>>>16);}
function zipStored(entries){
    const parts=[],directory=[];
    let offset=0;
    for(const {name,bytes} of entries){
        const filename=encoder.encode(name),crc=crc32(bytes);
        const header=[];
        u32(header,0x04034b50);u16(header,20);u16(header,0x0800);u16(header,0);
        u16(header,0);u16(header,0);u32(header,crc);u32(header,bytes.length);
        u32(header,bytes.length);u16(header,filename.length);u16(header,0);
        const data=new Uint8Array(header.length+filename.length+bytes.length);
        data.set(header);data.set(filename,header.length);data.set(bytes,header.length+filename.length);
        parts.push(data);
        const central=[];
        u32(central,0x02014b50);u16(central,20);u16(central,20);
        u16(central,0x0800);u16(central,0);u16(central,0);u16(central,0);
        u32(central,crc);u32(central,bytes.length);u32(central,bytes.length);
        u16(central,filename.length);u16(central,0);u16(central,0);
        u16(central,0);u16(central,0);u32(central,0);u32(central,offset);
        directory.push(new Uint8Array([...central,...filename]));
        offset+=data.length;
    }
    const directoryStart=offset;
    for(const d of directory){parts.push(d);offset+=d.length;}
    const ending=[];
    u32(ending,0x06054b50);u16(ending,0);u16(ending,0);
    u16(ending,entries.length);u16(ending,entries.length);
    u32(ending,offset-directoryStart);u32(ending,directoryStart);u16(ending,0);
    parts.push(new Uint8Array(ending));
    return new Blob(parts,{type:'application/zip'});
}
function readZipStore(buffer){
    const bytes=new Uint8Array(buffer),view=new DataView(buffer);
    const entries=new Map(),local=[];
    let offset=0;
    while(offset+30<=bytes.length && view.getUint32(offset,true)===0x04034b50){
        const flags=view.getUint16(offset+6,true),method=view.getUint16(offset+8,true);
        const checksum=view.getUint32(offset+14,true);
        const compressed=view.getUint32(offset+18,true),uncompressed=view.getUint32(offset+22,true);
        const nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true);
        if(flags!==0x0800||method!==0||compressed!==uncompressed||!nameLength)
            throw Error('Unsupported ZIP compression, flags or streaming format');
        const nameStart=offset+30,bodyStart=nameStart+nameLength+extraLength;
        if(bodyStart>bytes.length || compressed>bytes.length-bodyStart)throw Error('Truncated archive');
        const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(nameStart,nameStart+nameLength));
        const content=bytes.slice(bodyStart,bodyStart+compressed);
        if(crc32(content)!==checksum)throw Error('Backup integrity check failed: '+name);
        if(entries.has(name))throw Error('Duplicate file in backup: '+name);
        entries.set(name,content);
        local.push({name,offset,checksum,size:compressed});
        offset=bodyStart+compressed;
    }
    // Verify every central-directory entry against the actual local header.
    // Merely checking the trailing entry count allows forged or omitted files.
    const tail=bytes.length-22;
    if(tail<offset || view.getUint32(tail,true)!==0x06054b50 || view.getUint16(tail+20,true)!==0 ||
       view.getUint16(tail+4,true)!==0 || view.getUint16(tail+6,true)!==0 ||
       view.getUint16(tail+8,true)!==local.length || view.getUint16(tail+10,true)!==local.length ||
       view.getUint32(tail+16,true)!==offset)
        throw Error('Unsupported ZIP directory or trailing data');
    const directoryLength=view.getUint32(tail+12,true);
    if(directoryLength!==tail-offset)throw Error('ZIP directory size mismatch');
    let position=offset;
    for(const expected of local){
        if(position+46>tail || view.getUint32(position,true)!==0x02014b50)
            throw Error('ZIP directory entry is missing or malformed');
        const flags=view.getUint16(position+8,true),method=view.getUint16(position+10,true);
        const crc=view.getUint32(position+16,true),compressed=view.getUint32(position+20,true);
        const uncompressed=view.getUint32(position+24,true);
        const nameLength=view.getUint16(position+28,true),extraLength=view.getUint16(position+30,true);
        const commentLength=view.getUint16(position+32,true);
        const disk=view.getUint16(position+34,true),relative=view.getUint32(position+42,true);
        const next=position+46+nameLength+extraLength+commentLength;
        if(next>tail || flags!==0x0800 || method!==0 || disk!==0 || compressed!==uncompressed ||
           crc!==expected.checksum || compressed!==expected.size || relative!==expected.offset)
            throw Error('ZIP directory disagrees with file contents');
        const name=new TextDecoder('utf-8',{fatal:true}).decode(bytes.subarray(position+46,position+46+nameLength));
        if(name!==expected.name)throw Error('ZIP directory filename mismatch');
        position=next;
    }
    if(position!==tail)throw Error('Unexpected files or bytes in ZIP directory');
    return entries;
}
function downloadZip(blob,name){
    const url=URL.createObjectURL(blob),link=document.createElement('a');
    link.href=url;link.download=name;document.body.appendChild(link);link.click();link.remove();
    setTimeout(()=>URL.revokeObjectURL(url),5000);
}
export async function createSmallBackup(){
    if(!('showOpenFilePicker' in window))throw Error('Full source-file backup requires a supported Windows browser. Metadata export still works.');
    const metadata=await exportRecords();
    const sources=(await allRecords()).filter(r=>r.type==='source'&&r.payload.filename);
    const entries=[];const manifest=[];const missing=[];
    let total=0;
    for(const source of sources){
        const handle=await getHandle(source.id);
        if(!handle){missing.push(`${source.payload.filename} (${source.id}): not linked for this browser profile`);continue;}
        try{
            let permission=await handle.queryPermission({mode:'read'});
            if(permission!=='granted')permission=await handle.requestPermission({mode:'read'});
            if(permission!=='granted')throw Error('Permission denied');
            const file=await handle.getFile();
            if(total+file.size>MAX_TOTAL)throw Error('Archive exceeds 120 MB in-browser limit');
            const bytes=new Uint8Array(await file.arrayBuffer());
            const sanitized=file.name.replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,100);
            const archivePath=`source-files/${source.id}/${sanitized}`;
            entries.push({name:archivePath,bytes});total+=bytes.byteLength;
            manifest.push({id:source.id,name:file.name,path:archivePath,size:file.size,crc32:crc32(bytes)});
        }catch(e){missing.push(`${source.payload.filename} (${source.id}): ${e.message}`);}
    }
    const info={format:'p8core-research-small-archive',version:1,createdAt:new Date().toISOString(),complete:missing.length===0,sourceFiles:manifest,missingFiles:missing,note:'No cloud upload. Metadata plus selected PC files. Backup destination must be physically independent of the original hard drive.'};
    const metaBytes=encoder.encode(JSON.stringify(metadata,null,2));
    const manifestBytes=encoder.encode(JSON.stringify(info,null,2));
    entries.unshift({name:'backup-manifest.json',bytes:manifestBytes},{name:'research-metadata.json',bytes:metaBytes});
    if(total+metaBytes.length+manifestBytes.length>MAX_TOTAL)throw Error('Total archive exceeds 120 MB in-browser limit');
    const blob=zipStored(entries);
    const filename=`research-${info.complete?'complete':'PARTIAL'}-${new Date().toISOString().slice(0,10)}.zip`;
    downloadZip(blob,filename);
    return {complete:info.complete,files:manifest.length,missing,bytes:blob.size};
}
// Small backups cannot guarantee one atomic transaction across IndexedDB and
// a user-selected filesystem. Copy and read back source files BEFORE importing
// any metadata, then link only the IDs actually inserted in that transaction.
async function freshRestoreFile(folder,originalName,id){
    const sanitized=String(originalName).replace(/[^a-zA-Z0-9._ -]/g,'_').slice(0,95)||'source';
    for(let attempt=0;attempt<20;attempt++){
        const name=`${id}_${crypto.randomUUID().slice(0,8)}_${sanitized}`.slice(0,160);
        try{await folder.getFileHandle(name,{create:false});}
        catch(error){
            if(error?.name==='NotFoundError')return {name,handle:await folder.getFileHandle(name,{create:true})};
            throw error;
        }
    }
    throw Error('Could not find an unused restore filename');
}

export async function restoreSmallBackup(file){
    if(file.size>MAX_TOTAL*1.2)throw Error('ZIP is too large for this browser importer. Use an external file backup tool.');
    const contents=readZipStore(await file.arrayBuffer());
    if(!contents.has('backup-manifest.json')||!contents.has('research-metadata.json'))throw Error('Not a recognized Research Archive ZIP');
    const manifest=JSON.parse(decoder.decode(contents.get('backup-manifest.json')));
    const archive=JSON.parse(decoder.decode(contents.get('research-metadata.json')));
    if(manifest.format!=='p8core-research-small-archive'||manifest.version!==1||
       archive.format!=='p8core-research-metadata'||archive.formatVersion!==1)
        throw Error('Unsupported backup version');
    validateImportedRecords(archive.records);
    if(!Array.isArray(manifest.sourceFiles)||!Array.isArray(manifest.missingFiles)||
       manifest.sourceFiles.length+2!==contents.size)
        throw Error('Invalid backup file inventory');
    const sources=new Map(archive.records.filter(row=>row.type==='source'&&!row.deleted).map(row=>[row.id,row]));
    const paths=new Set(),ids=new Set();
    for(const entry of manifest.sourceFiles){
        if(!entry || !sources.has(entry.id) || ids.has(entry.id) ||
           typeof entry.name!=='string' || typeof entry.path!=='string' ||
           !entry.path.startsWith(`source-files/${entry.id}/`) ||
           !/^source-files\/[0-9a-f-]{36}\/[^/\\]+$/i.test(entry.path) ||
           paths.has(entry.path) || !Number.isSafeInteger(entry.size) || entry.size<0 ||
           !Number.isInteger(entry.crc32) || entry.crc32<0 || entry.crc32>0xffffffff)
            throw Error('Invalid or duplicate source manifest entry');
        ids.add(entry.id);paths.add(entry.path);
        const content=contents.get(entry.path);
        if(!content || content.length!==entry.size || crc32(content)!==entry.crc32)
            throw Error('Source integrity check failed: '+entry.name);
    }
    for(const name of contents.keys()){
        if(name!=='backup-manifest.json' && name!=='research-metadata.json' && !paths.has(name))
            throw Error('Unreferenced or unexpected source file in ZIP');
    }
    if(manifest.complete!==undefined && manifest.complete!==(manifest.missingFiles.length===0))
        throw Error('Inconsistent small-backup completion status');
    const missingIds=new Set();
    for(const entry of manifest.missingFiles){
        // Older archives may store a description string for unavailable originals.
        if(typeof entry==='string')continue;
        if(!entry || typeof entry!=='object' || !sources.has(entry.id) || ids.has(entry.id) || missingIds.has(entry.id))
            throw Error('Invalid missing-source entry');
        missingIds.add(entry.id);
    }
    if(!confirm(`Backup contains ${archive.records.length} metadata records and ${manifest.sourceFiles.length} source files. ${manifest.missingFiles.length} original files were unavailable during export. Existing record IDs will NOT be overwritten. Continue import?`))return {cancelled:true};

    const existing=new Set((await allRecords(true)).map(row=>row.id));
    const candidates=manifest.sourceFiles.filter(entry=>!existing.has(entry.id));
    const staged=new Map();
    if(candidates.length && 'showDirectoryPicker' in window &&
       confirm(`Copy ${candidates.length} source files for NEW records to a PC folder before importing metadata? This never replaces existing source links.`)){
        const folder=await window.showDirectoryPicker({mode:'readwrite'});
        for(const entry of candidates){
            const {name,handle}=await freshRestoreFile(folder,entry.name,entry.id);
            const writer=await handle.createWritable();
            try{await writer.write(contents.get(entry.path));await writer.close();}
            catch(error){try{await writer.abort();}catch{}throw Error(`File copy interrupted before metadata import: ${error.message}`);}
            const readBack=new Uint8Array(await (await handle.getFile()).arrayBuffer());
            if(readBack.length!==entry.size || crc32(readBack)!==entry.crc32)
                throw Error('Restored file verification failed before metadata import: '+entry.name);
            staged.set(entry.id,{name,handle});
        }
    }
    // IDs returned by the committed transaction, not a pre-import snapshot,
    // decide which source records may be modified and linked.
    const result=await importRecords(archive.records,{collectAddedIds:true,collectAddedMutations:true});
    const inserted=new Set(result.addedIds);
    const owned=new Map(result.addedMutations.map(entry=>[entry.id,entry.mutationId]));
    let filesRestored=0;
    for(const entry of candidates){
        const saved=staged.get(entry.id);
        if(!saved || !inserted.has(entry.id))continue;
        const original=sources.get(entry.id);
        if(!original || await linkRestoredSource(entry.id,owned.get(entry.id),
            original.payload,saved.handle,saved.name)!=='linked')continue;
        filesRestored++;
    }
    return {added:result.added,skipped:result.skipped,filesRestored,
        filesUnlinked:candidates.filter(entry=>inserted.has(entry.id)).length-filesRestored,
        existingSourceFilesSkipped:manifest.sourceFiles.length-candidates.length,
        backupComplete:manifest.complete,missing:manifest.missingFiles};
}



// ============================================================================
// [JS-BACKUP-04] NON-DESTRUCTIVE PC SOURCE-FILE INVENTORY
// An inventory is not a backup. No source files are copied or transmitted.
// ============================================================================
export async function auditLocalSourceFiles(){
    const sources=(await allRecords()).filter(r=>r.type==='source'&&r.payload?.filename);
    const details=[];
    for(const source of sources){
        const reference={id:source.id,title:source.payload.title||'Untitled source',
            filename:source.payload.filename,status:'not-linked-on-this-device'};
        const handle=await getHandle(source.id);
        if(!handle){details.push(reference);continue;}
        try{
            const permission=typeof handle.queryPermission==='function'
                ? await handle.queryPermission({mode:'read'}) : 'unknown';
            if(permission!=='granted'){
                details.push({...reference,status:'permission-required'});
                continue;
            }
            const file=await handle.getFile();
            const expected=Number(source.payload.filesize);
            const mismatch=Number.isFinite(expected)&&expected>0&&expected!==file.size;
            details.push({...reference,status:mismatch?'size-mismatch':'available',
                actualName:file.name,actualSize:file.size,expectedSize:expected>0?expected:null});
        }catch(e){
            details.push({...reference,status:'unavailable',reason:String(e?.name||'File not accessible')});
        }
    }
    const available=details.filter(d=>d.status==='available').length;
    return {format:'p8core-research-source-inventory',version:1,
        generatedAt:new Date().toISOString(),records:sources.length,
        available,needsReview:details.length-available,
        notice:'This is a metadata inventory, not a copy of any original file and not an independently verified backup.',
        details};
}

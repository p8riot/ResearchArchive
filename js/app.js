// ============================================================================
// [JS-01] APPLICATION ENTRY AND SHARED STATE
// The Research Archive is a local-first application. Actual source file bytes
// never enter IndexedDB research records or the optional cloud sync transport.
// ============================================================================
import {
    initData, allRecords, listRecords, getRecord, saveRecord, trashRecord,
    restoreRecord, exportRecords, importRecords, getMeta, setMeta, getHandle,
    setHandle, allConflicts, resolveConflict
} from './data.js';
import {CloudSync} from './cloud.js';
import {createSmallBackup, restoreSmallBackup, auditLocalSourceFiles} from './backup.js';
import {backupToDirectory, resumeDirectoryBackup, verifyDirectoryBackup, restoreDirectoryBackup, resumeDirectoryRestore} from './directory-backup.js';
import {boardNodes, boardTitle, validateBoardLink, BOARD_KINDS, searchRecords, searchRecordsWindow, auditReferences} from './investigation.js';
import {traceSourceOrigins, relatedSourceGroups} from './provenance.js';
import {prepareBoardLayout, boardEdgeCoordinates, applyBoardMove} from './board-layout.js';
import {caseEditorialReview} from './editorial-review.js';
import {PUBLIC_APPROVALS, publicationAssessment, publicCandidatePreview, createPublicCandidate} from './publication.js';
import {MAX_CANDIDATE_BYTES, parsePreviousCandidate, comparePublicCandidates} from './publication-compare.js';
import {readingSections} from './reading-sections.js';
import {caseResearchWorkflow, prioritizeResearchCases} from './case-workflow.js';
import {TASK_PRIORITIES, QUEUE_SORTS, ATTENTION_FILTERS, validCalendarDay, queuePriority, triageEditorialQueue} from './editorial-triage.js';
import {caseSourceCoverage, sourceDocumentationStatus} from './source-workflow.js';
import {buildEditorialQueue, filterEditorialQueue, editorialQueueCounts, QUEUE_VIEWS} from './editorial-queue.js';
import {claimEvidenceGroups, sourceClaimUses} from './claim-evidence.js';
import {sourcePickerResults} from './source-picker.js';
import {prepareSourceIntake, sourceReferenceText} from './source-intake.js';
import {ENTITY_KINDS, validateEntity, buildSubjectIndex, caseSubjectLinks, filterSubjectIndex} from './entities.js';
import {createNavigationTrail} from './navigation-trail.js';
import {summarizeRecovery, recoveryChecklist} from './recovery-readiness.js';
import {isolateDialogBackground, manageDialogTab} from './dialog-accessibility.js';

const VERSION='0.19.13';
const SESSION_CHECK_ID=crypto.randomUUID();
const cloud=new CloudSync();
const state={page:'desk',caseId:null,caseTab:'story',readingDepth:'quick',readingFocus:false,search:'',archiveCategory:'All',archiveStatus:'All',archiveSort:'updated',archiveView:'grid',inboxStatus:'Active',libraryTab:'bookmarks',connectionFocus:'',relationFilter:'All',searchType:'All',boardFilter:'All',boardSelected:'',boardVisible:32,boardLinksVisible:48,caseItemsVisible:40,archiveVisible:48,searchVisible:60,libraryVisible:36,queueFilter:'all',queueCaseId:'',queueQuery:'',queueAttention:'all',queueSort:'attention',queueVisible:48,subjectQuery:'',subjectKind:'All',subjectVisible:48,focusRecord:''};
const researchTrail=createNavigationTrail({page:'desk',caseId:null,caseTab:'story',libraryTab:'bookmarks',connectionFocus:'',focusRecord:''});
const NAV=[['desk','◈','Research Desk'],['archive','▤','The Archive'],['inbox','⊞','Research Inbox'],['connections','◎','Connections'],['library','◇','My Library']];
const CATEGORIES=['Conspiracy Theories','Historical Mysteries','Paranormal & Supernatural','Science & Cosmic Mysteries','Documented Secret Operations','Legends & Cultural Phenomena'];
const STATUSES=['Not started','Researching','Ready for review','Reviewed'];
const ASSESSMENTS=['Documented','Supported','Disputed','Unsubstantiated','Contradicted','Unresolved'];
const RELATION_TYPES=['Documented','Claimed','Thematic','Disputed'];
const STARTER_TASKS={
    'Conspiracy Theories':['Identify the earliest traceable version of the claim','Find primary sources and distinguish repeated reporting','Evaluate relevant alternative explanations'],
    'Historical Mysteries':['Locate contemporary records and establish a chronology','Distinguish historical documentation from later retellings','Compare evidence for different interpretations'],
    'Paranormal & Supernatural':['Trace the earliest known account or local tradition','Separate witness accounts from later retellings','Review ordinary explanations and remaining unknowns'],
    'Science & Cosmic Mysteries':['Locate the original observation or study','Check scientific interpretations and uncertainty','Distinguish peer-reviewed findings from speculation'],
    'Documented Secret Operations':['Locate original declassified or institutional records','Establish dates, agencies, and program scope','Separate verified activities from unsubstantiated extensions'],
    'Legends & Cultural Phenomena':['Identify earliest surviving versions','Research historical and cultural context','Track how later adaptations changed the story']
};
const FIELD_DEFINITIONS={
    case:[
        ['title','Case title','text',true],['category','Primary category','select',false,CATEGORIES],
        ['status','Research stage','select',false,STATUSES],['aliases','Aliases (comma separated)','text'],
        ['tags','Topics / tags (comma separated)','text'],['centralQuestion','Central question','text'],
        ['summary','Quick overview','textarea'],['story','Full story / reading narrative','largearea']
    ],
    claim:[['caseId','Related case','cases',true],['text','Specific claim','textarea',true],['assessment','Evidence assessment','select',false,ASSESSMENTS],['support','Supporting evidence and qualifications','textarea'],['contrary','Contrary evidence and limitations','textarea'],['sourceIds','Background / unclassified source records','sources'],['supportSourceIds','Sources supporting this claim','sources'],['contrarySourceIds','Sources challenging this claim','sources']],
    source:[['caseId','Related case','cases'],['title','Source title','text',true],['sourceType','Source type','select',false,['Document','Article','Book','Video','Interview','Website','Image','Other']],['author','Author / organization','text'],['date','Publication date / year','text'],['provenanceRole','Origin classification','select',false,['Unclassified','Primary source','Secondary analysis','Retelling','Compilation']],['independence','Independent origin assessment','select',false,['Not assessed','Independent origin documented','Derives from identified source(s)','Independence uncertain']],['citationLocator','Page, chapter, timestamp, or passage locator','text'],['url','Public source URL (optional)','url'],['details','Source provenance and notes','textarea'],['derivedFromIds','This source cites or derives from','sources']],
    timeline:[['caseId','Related case','cases',true],['date','Event date or period','text',true],['title','Event title','text',true],['certainty','Date certainty','select',false,['Documented','Approximate','Alleged','Later account']],['details','Event details and source references','textarea']],
    note:[['caseId','Related case (optional)','cases'],['title','Note title','text',true],['content','Private notebook entry','largearea',true]],
    discovery:[['title','Discovery title','text',true],['kind','Discovery type','select',false,['Link','Idea','Note','File reference']],['value','URL / idea / reference','textarea'],['note','Why it matters / follow-up','textarea'],['status','Inbox stage','select',false,['Inbox','Reviewing','Filed','Archived']],['caseId','Related case (optional)','cases']],
    relation:[['fromId','From case','cases',true],['toId','Connected case','cases',true],['kind','Relationship classification','select',false,RELATION_TYPES],['rationale','Why these cases connect','textarea',true]],
    collection:[['title','Collection name','text',true],['description','Description','textarea']],
    task:[['caseId','Related case','cases',true],['title','Research task','text',true],['priority','My priority','select',false,TASK_PRIORITIES],['dueOn','Optional target date','date']],
    question:[['caseId','Related case','cases',true],['text','Open evidence question','textarea',true],['status','Question stage','select',false,['Open','Investigating','Answered','Set aside']],['answer','Current answer or reason set aside','textarea'],['sourceIds','Sources relevant to the question','sources']],
    explanation:[['caseId','Related case','cases',true],['title','Proposed explanation','text',true],['description','What this explanation proposes','textarea'],['assessment','Assessment','select',false,ASSESSMENTS],['support','Support and context','textarea'],['contrary','Counterarguments / gaps','textarea'],['sourceIds','Evidence source records','sources']],
    theory_event:[['caseId','Related case','cases',true],['claimId','Related claim (optional)','claims'],['period','When this version circulated (date or period)','text',true],['title','Change in the theory','text',true],['changeKind','Type of evolution','select',false,['Origin','Spread','Revision','Reassessment']],['details','What changed and what establishes the date','textarea'],['sourceIds','Supporting sources for this history','sources']],
    journey:[['title','Journey title','text',true],['description','Editorial guide / introduction','textarea']],
    entity:[['name','Canonical entity name','text',true],['kind','Entity category','select',true,ENTITY_KINDS],['aliases','Known aliases (comma separated)','text'],['description','Context and identification notes','textarea'],['caseIds','Explicitly associated Case Files','case_links']],
    board_link:[['caseId','Related case','cases',true],['fromId','From research record','board_nodes',true],['toId','To research record','board_nodes',true],['kind','Connection meaning','select',true,BOARD_KINDS],['rationale','Reason and evidence context','textarea',true]]
};

// ----- Text safety and UI helpers ------------------------------------------
const $=sel=>document.querySelector(sel);
const safe=s=>String(s??'').replace(/[&<>"']/g,ch=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const short=(s,n=145)=>String(s??'').length>n?String(s).slice(0,n-1)+'…':String(s??'');
const stamp=iso=>iso?new Date(iso).toLocaleDateString(undefined,{month:'short',day:'numeric',year:'numeric'}):'Undated';
const tags=items=>(items||[]).map(i=>`<span class="badge">${safe(i)}</span>`).join(' ');
const entry=(id,label,extra='')=>`<button class="link-button" data-action="openCase" data-id="${safe(id)}" ${extra}>${safe(label)}</button>`;
const children=(rows,type,caseId)=>rows.filter(r=>r.type===type&&r.payload.caseId===caseId);
const button=(action,label,cls='btn',attrs='')=>`<button type="button" class="${cls}" data-action="${action}" ${attrs}>${label}</button>`;
const empty=(title,message,action='',label='')=>`<div class="panel empty"><div class="empty-icon">⌁</div><h2>${safe(title)}</h2><p>${safe(message)}</p>${action?button(action,safe(label),'btn btn-gold'):''}</div>`;
const formatURL=value=>{try{const u=new URL(value);return ['https:','http:'].includes(u.protocol)?u.href:null;}catch{return null;}};
const selectOptions=(items,value)=>items.map(i=>`<option value="${safe(i)}" ${String(i)===String(value)?'selected':''}>${safe(i)}</option>`).join('');
let toastTimer;
let autoSyncTimer;
let previousAutoSync=0;
let selectedRecoverySnapshot=null;
let boardDragging=null;
let suppressBoardClickUntil=0;
let searchDelayTimer=null;
let sourcePickerSession=null;
let sourceIntakeSession=null;
function scheduleAutoSync(){
    if (!cloud.config || !cloud.session || !navigator.onLine || document.visibilityState==='hidden') return;
    clearTimeout(autoSyncTimer);
    autoSyncTimer=setTimeout(async()=>{
        if(Date.now()-previousAutoSync<45000 || cloud.busy)return;
        previousAutoSync=Date.now();
        try{await cloud.sync(message=>{$('#footer-status').textContent=message;});if(!$('#modal-root').children.length)render();}
        catch(e){$('#footer-status').textContent='Cloud sync paused: '+e.message;}
    },4500);
}
function notify(message){const el=$('#toast');el.textContent=message;el.hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.hidden=true,4100);}
function downloadBlob(blob,name){const url=URL.createObjectURL(blob);const link=document.createElement('a');link.href=url;link.download=name;document.body.append(link);link.click();link.remove();setTimeout(()=>URL.revokeObjectURL(url),3000);}

// ============================================================================
// [JS-02] NAVIGATION, RENDERING, MODAL LIFECYCLE
// ============================================================================
function trailSnapshot() {
    return {
        page: state.page,
        caseId: state.caseId,
        caseTab: state.caseTab,
        libraryTab: state.libraryTab,
        connectionFocus: state.connectionFocus,
        focusRecord: state.focusRecord,
        search: state.search,
        searchType: state.searchType,
        inboxStatus: state.inboxStatus,
        archiveCategory: state.archiveCategory,
        archiveStatus: state.archiveStatus,
        archiveSort: state.archiveSort,
        queueFilter: state.queueFilter,
        queueCaseId: state.queueCaseId,
        queueQuery: state.queueQuery
    };
}

function setNavigation(page,caseId=null,preferredTab=null,focusRecord='') {
    researchTrail.remember(trailSnapshot());
    const changingCase = page === 'case' && caseId !== state.caseId;
    if(changingCase){
        state.caseId=caseId;
        state.boardSelected='';
        state.caseItemsVisible=40;
        state.boardVisible=32;
        state.boardLinksVisible=48;
    }
    state.page=page;
    if(page==='case')state.caseTab=preferredTab||'story';
    state.focusRecord=focusRecord||'';
    state.search='';
    researchTrail.visit(trailSnapshot());
    window.scrollTo({top:0,behavior:'instant'});
    render().then(()=>{
        const focusTarget=state.focusRecord && document.getElementById('research-'+state.focusRecord);
        if(focusTarget){focusTarget.scrollIntoView({block:'center'});focusTarget.focus({preventScroll:true});}
        else $('#view')?.focus({preventScroll:true});
    });
}

function travelResearchTrail(delta) {
    const destination=researchTrail.travel(delta);
    if(!destination)return;
    Object.assign(state,destination);
    window.scrollTo({top:0,behavior:'instant'});
    render().then(()=>{
        const focused=state.focusRecord && document.getElementById('research-'+state.focusRecord);
        if(focused){focused.scrollIntoView({block:'center'});focused.focus({preventScroll:true});}
        else $('#view')?.focus({preventScroll:true});
    });
}

function renderNavigation(){
    $('#desktop-nav').innerHTML=NAV.map(([id,ico,label])=>`<button class="nav-button ${state.page===id?'active':''}" data-page="${id}" ${state.page===id?'aria-current="page"':''}><span class="nav-ico" aria-hidden="true">${ico}</span>${label}</button>`).join('')+`<div class="sep"></div><button class="nav-button ${state.page==='settings'?'active':''}" data-page="settings"><span class="nav-ico">⚙</span>Settings</button>`;
    $('#mobile-nav').innerHTML=NAV.map(([id,ico,label])=>`<button data-page="${id}" class="${state.page===id||(state.page==='case'&&id==='archive')?'active':''}" ${state.page===id?'aria-current="page"':''}><span class="nav-ico" aria-hidden="true">${ico}</span>${label==='Research Desk'?'Desk':label==='The Archive'?'Archive':label==='Research Inbox'?'Inbox':label}</button>`).join('');
}
function openModal(title,body,after=null){
    const origin = $('#modal-root').children.length ? window.modalRestore : document.activeElement;
    $('#modal-root').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${safe(title)}" tabindex="-1"><div class="modal-header"><h2>${safe(title)}</h2><button class="icon-button" data-action="closeModal" aria-label="Close dialog">×</button></div>${body}</section></div>`;
    window.modalRestore=origin;
    isolateDialogBackground(document,true);
    $('.modal').focus();
    if(after)after();
}
function closeModal(){
    sourceIntakeSession=null;
    selectedRecoverySnapshot=null;
    $('#modal-root').innerHTML='';
    isolateDialogBackground(document,false);
    const origin=window.modalRestore;
    window.modalRestore=null;
    if(origin?.isConnected)origin.focus?.({preventScroll:true});
    else $('#view')?.focus({preventScroll:true});
}
function pageHeader(label,title,description,actions=''){
    return `<div class="page-head"><div><div class="kicker">${safe(label)}</div><h1>${safe(title)}</h1><p class="page-sub">${safe(description)}</p></div>${actions?`<div class="actions">${actions}</div>`:''}</div>`;
}
function recordCard(r,action='openCase'){
    const p=r.payload;
    return `<article class="card"><div class="kicker">${safe(p.category||r.type)}</div><h3 class="card-title">${safe(p.title||'Untitled')}</h3><p class="card-desc">${safe(short(p.summary||p.note||p.content||p.value||'No summary yet.',150))}</p><div class="chips" style="margin-bottom:13px">${tags((p.tags||[]).slice(0,3))}</div><div class="card-foot"><span class="badge">${safe(p.status||'Draft')}</span>${button(action,'Explore →','btn btn-small',`data-id="${r.id}"`)}</div></article>`;
}
async function render(){
    const rows=await allRecords();
    state.sourceNames=new Map(rows.filter(row=>row.type==='source').map(row=>[row.id,row.payload.title||'Untitled source']));
    const views={desk:renderDesk,archive:renderArchive,inbox:renderInbox,connections:renderConnections,library:renderLibrary,settings:renderSettings,search:renderSearch,case:renderCase,editorial:renderEditorialWorkspace,subjects:renderSubjects};
    const info={desk:['RESEARCH DESK','Your private investigation workspace'],archive:['THE ARCHIVE','Browse your cases'],inbox:['RESEARCH INBOX','Capture and investigate leads'],connections:['CONNECTIONS','How mysteries relate'],library:['MY LIBRARY','Your saved research'],settings:['SETTINGS','Workspace preferences'],editorial:['RESEARCH QUEUE','Editorial work across investigations'],search:['ARCHIVE SEARCH','Search across research records'],subjects:['SUBJECT DISCOVERY','Explore recorded people, places and topics'],case:['CASE FILE','Investigation dossier']};
    renderNavigation();
    const trail=researchTrail.status();
    $('#trail-back').disabled=!trail.canBack;
    $('#trail-forward').disabled=!trail.canForward;
    $('#breadcrumb').textContent=info[state.page][0];
    $('#header-title').textContent=info[state.page][1];
    $('#view').innerHTML=await views[state.page](rows);
    const pending=(await allRecords(true)).filter(r=>r.pending).length;
    $('#footer-status').textContent=!cloud.session?(pending?`${pending} change(s) saved locally · Cloud not connected`:'Local archive ready · Cloud not connected'):(pending?`${pending} change(s) awaiting sync`:'Local archive up to date');
}

// ============================================================================
// [JS-03] RESEARCH DESK AND ARCHIVE
// ============================================================================
async function renderDesk(rows){
    const cases=rows.filter(r=>r.type==='case'), discoveries=rows.filter(r=>r.type==='discovery'),notes=rows.filter(r=>r.type==='note');
    const ongoing=cases.filter(r=>r.payload.status==='Researching');
    const active=[...cases].sort((a,b)=>(!!b.payload.pinned)-(!!a.payload.pinned)||b.modifiedAt.localeCompare(a.modifiedAt)).slice(0,4);
    const queue=buildEditorialQueue(rows);
    const queueCounts=editorialQueueCounts(queue);
    const priorityCases=prioritizeResearchCases(rows,3);
    const last=await getMeta('recent_case');
    const recent=cases.find(r=>r.id===last);
    return `${pageHeader('PRIVATE RESEARCH HEADQUARTERS','Welcome to your research desk','A quiet place to follow questions, preserve sources, and investigate without losing the thread.',button('addDiscovery','＋ Add Discovery','btn btn-gold')+button('newCase','New Case','btn'))}
        <div class="grid four" style="margin-bottom:20px">
            <div class="panel"><div class="stat-number">${cases.length}</div><div class="stat-label">Cases in your archive</div></div>
            <div class="panel"><div class="stat-number">${ongoing.length}</div><div class="stat-label">Active investigations</div></div>
            <div class="panel"><div class="stat-number">${discoveries.filter(r=>r.payload.status==='Inbox').length}</div><div class="stat-label">Inbox discoveries</div></div>
            <div class="panel"><div class="stat-number">${notes.length}</div><div class="stat-label">Private research notes</div></div>
        </div>
        ${recent?`<section class="panel" style="margin-bottom:20px"><div class="kicker">CONTINUE INVESTIGATING</div><div class="hstack between" style="gap:14px;flex-wrap:wrap"><div><h2>${safe(recent.payload.title)}</h2><p class="muted">Resume your last case file and research notes.</p></div>${button('openCase','Resume dossier →','btn btn-gold',`data-id="${recent.id}"`)}</div></section>`:''}
        ${priorityCases.length?`<section class="panel workflow-desk"><div class="panel-head"><div><div class="kicker">SUGGESTED RESEARCH NEXT STEPS</div><h2>Continue the investigation</h2></div>${button('goEditorial','See research queue →','btn btn-small')}</div><div class="workflow-desk-items">${priorityCases.map(item=>`<div class="case-item"><div class="item-main"><strong>${safe(item.case.payload.title||'Untitled case')}</strong><small>${safe(item.workflow.next?.title||'Review up to date')} · ${item.workflow.completedRequired}/${item.workflow.requiredCount} required editorial steps recorded</small></div>${button('workflowStep','Open step →','btn btn-small',`data-case="${safe(item.case.id)}" data-tab="${safe(item.workflow.next?.tab||'workflow')}" data-step="${safe(item.workflow.next?.actionType||'openTab')}"`)}</div>`).join('')}</div><small>Suggested steps track missing work, not which theory is credible. You decide what to investigate next.</small></section>`:''}
        <section class="panel editorial-desk"><div class="panel-head"><div><div class="kicker">RESEARCH FOLLOW-THROUGH</div><h2>Editorial Research Queue</h2></div>${button('goEditorial','Open Research Queue →','btn btn-gold')}</div><p class="muted">${queueCounts.all} actionable item(s) across ${cases.length} cases, derived from existing research. Includes ${queueCounts.questions} open questions, ${queueCounts.tasks} tasks, ${queueCounts.citations} citation gaps and ${queueCounts.reviews} case reviews. Counts describe work, not credibility.</p></section>
        <div class="split"><section class="panel"><div class="panel-head"><h2>Active Investigations</h2>${button('newCase','＋ New','btn btn-small')}</div>${active.length?active.slice(0,12).map(r=>`<div class="case-item"><div class="item-main"><strong>${safe(r.payload.title)}</strong><small>${safe(r.payload.category)} · ${safe(r.payload.status)}</small></div>${button('openCase','Open →','btn btn-small',`data-id="${r.id}"`)}</div>`).join('')+(active.length>12?`<p class="muted">Showing the first 12 active cases.</p>${button('goArchive','Browse all cases →','btn btn-small')}`:''):empty('Your first case starts here','Create a case or explore a sample dossier to get started.','newCase','Create a case')}
        </section><div class="vstack"><section class="panel"><div class="kicker">RESEARCH INBOX</div><h2>Capture first. Organize later.</h2><p class="muted">Save a link, idea, question, or research reference in seconds.</p>${button('addDiscovery','＋ Capture a discovery','btn btn-gold block')}</section>
        <section class="panel"><div class="kicker">A THREAD WORTH PULLING</div><h2>Explore something unexpected</h2><p class="muted">Pick a random case from your own collection.</p>${button('roulette','◈ Surprise Me','btn block',cases.length?'':'disabled')}</section>
        <section class="panel"><div class="kicker">ARCHIVE HEALTH</div><p class="muted">Your research is saved in this browser. Export independent backups regularly. PC source files need a separate backup too.</p>${button('goSettings','Backup & Sync Settings','btn btn-small')}</section></div></div>`;
}
// ============================================================================
// [JS-EDITORIAL-02] CONTEXTUAL RESEARCH QUEUE
// The view is opened from the Desk or dossier, not another main navigation tab.
// ==========================================================================
async function renderEditorialWorkspace(rows) {
    const cases=rows.filter(row=>row.type==='case').sort((a,b)=>String(a.payload.title||'').localeCompare(String(b.payload.title||'')));
    const all=buildEditorialQueue(rows);
    const counts=editorialQueueCounts(all);
    const filtered=filterEditorialQueue(all,{view:state.queueFilter,caseId:state.queueCaseId,query:state.queueQuery});
    const current=triageEditorialQueue(filtered,{attention:state.queueAttention,sort:state.queueSort});
    const limit=state.queueVisible;
    const tabs=QUEUE_VIEWS.map(([id,label])=>`<button type="button" class="tab ${state.queueFilter===id?'active':''}" data-action="queueTab" data-tab="${id}" aria-pressed="${state.queueFilter===id?'true':'false'}">${safe(label)} <span class="queue-count">${counts[id]}</span></button>`).join('');
    const filters=`<div class="toolbar"><label class="field">Filter by case<select class="input" data-filter="queueCaseId"><option value="">All cases</option>${cases.map(row=>`<option value="${safe(row.id)}" ${state.queueCaseId===row.id?'selected':''}>${safe(row.payload.title||'Untitled case')}</option>`).join('')}</select></label><label class="field">Find a work item<input class="input" data-filter="queueQuery" placeholder="Find a question, task, source or case" value="${safe(state.queueQuery)}"></label><label class="field">Attention filter<select class="input" data-filter="queueAttention">${ATTENTION_FILTERS.map(([v,l])=>`<option value="${v}" ${v===state.queueAttention?'selected':''}>${safe(l)}</option>`).join('')}</select></label><label class="field">Sort work<select class="input" data-filter="queueSort">${QUEUE_SORTS.map(([v,l])=>`<option value="${v}" ${v===state.queueSort?'selected':''}>${safe(l)}</option>`).join('')}</select></label></div>`;
    const list=current.slice(0,limit).map(entry=>`<article class="case-item editorial-work-item"><div class="item-main"><div class="kicker">${safe(entry.kind.slice(0,-1).toUpperCase())} · ${safe(entry.caseTitle)}</div><strong>${safe(short(entry.title,260))}</strong><small>${safe(entry.detail)}</small>${entry.reason?`<small class="queue-priority ${entry.rank===0?'queue-priority-attention':''}">${safe(entry.reason)}</small>`:''}${entry.dueOn?`<small>Target: ${safe(entry.dueOn)}</small>`:''}</div><div class="actions">${button('openWorkItem','Open →','btn btn-small',`data-id="${safe(entry.recordId)}" data-case="${safe(entry.caseId)}" data-tab="${safe(entry.tab)}"`)}</div></article>`).join('');
    return `${pageHeader('RESEARCH DESK / EDITORIAL','Research Queue','A unified view of open questions, unfinished tasks, citation gaps, and cases due for human review. Records stay in their original Case Files.',button('goDesk','← Research Desk','btn')+button('newEditorialQuestion','＋ Evidence Question','btn btn-gold'))}
        <div class="grid four queue-stats">${QUEUE_VIEWS.filter(item=>item[0]!=='all').map(([kind,label])=>`<div class="panel"><div class="stat-number">${counts[kind]}</div><div class="stat-label">${safe(label)}</div></div>`).join('')}</div>
        <div class="tabs queue-tabs" role="group" aria-label="Research queue filters">${tabs}</div>
        ${filters}<p class="muted">Showing ${Math.min(current.length,limit)} of ${current.length} matching work items. Source gaps come from the existing case editorial reviews; they are not a separate list of facts or credibility scores.</p>
        <div class="vstack">${list||empty('No work items match','Change the filters or record a new evidence question in a Case File.')}</div>
        ${current.length>limit?button('moreQueue',`Show more work items (${Math.min(48,current.length-limit)} next)`,'btn'):''}`;
}

async function renderArchive(rows){
    const cases=rows.filter(r=>r.type==='case');
    const matched=state.search.trim() ? searchRecords(rows,state.search,'case').map(item=>item.row) : cases;
    const found=matched.filter(r=>
        (state.archiveCategory==='All'||r.payload.category===state.archiveCategory)&&
        (state.archiveStatus==='All'||r.payload.status===state.archiveStatus));
    const sorted=[...found];
    if(state.archiveSort==='title')sorted.sort((a,b)=>String(a.payload.title||'').localeCompare(String(b.payload.title||'')) || a.id.localeCompare(b.id));
    else if(state.archiveSort==='category')sorted.sort((a,b)=>String(a.payload.category||'').localeCompare(String(b.payload.category||'')) || String(a.payload.title||'').localeCompare(String(b.payload.title||'')) || a.id.localeCompare(b.id));
    else sorted.sort((a,b)=>String(b.modifiedAt||'').localeCompare(String(a.modifiedAt||'')) || a.id.localeCompare(b.id));
    return `${pageHeader('THE COMPLETE CATALOG','The Archive','Every case has one authoritative record. Browse by subject, search aliases, or start an entirely new investigation.',button('newCase','＋ New Case','btn btn-gold')+button('roulette','◈ Surprise Me','btn'))}
        <div class="toolbar"><input class="input" data-filter="search" aria-label="Search cases" placeholder="Search titles, aliases, descriptions…" value="${safe(state.search)}"><select class="input" aria-label="Filter category" data-filter="category">${selectOptions(['All',...CATEGORIES],state.archiveCategory)}</select><select class="input" aria-label="Filter research stage" data-filter="status">${selectOptions(['All',...STATUSES],state.archiveStatus)}</select><select class="input" aria-label="Sort cases" data-filter="archiveSort">${[['updated','Recently updated'],['title','Title A to Z'],['category','Category then title']].map(([v,l])=>`<option value="${v}" ${state.archiveSort===v?'selected':''}>${l}</option>`).join('')}</select></div>
        <p class="muted">Showing ${Math.min(found.length,state.archiveVisible)} of ${found.length} matching cases · Research stage is not a truth assessment.</p>
        ${found.length?`<div class="grid">${sorted.slice(0,state.archiveVisible).map(r=>recordCard(r)).join('')}</div>${found.length>state.archiveVisible?button('moreArchive',`Show more cases (${Math.min(found.length-state.archiveVisible,48)} next)`,'btn'):''}`:empty(cases.length?'No matching cases':'Your archive is ready','Create your first case, or load a few clearly labeled demonstration cases.','newCase','Create your first case')}
        ${!cases.length?`<div class="actions" style="margin-top:16px">${button('loadSamples','Load example research outlines','btn')}</div>`:''}`;
}

// ============================================================================
// [JS-SEARCH] GLOBAL CROSS-RECORD DISCOVERY
// Search is strictly local; it never sends queries or private notes to a server.
// ============================================================================
async function renderSearch(rows){
    const types=[['All','Everything'],['case','Cases'],['entity','Entities'],['source','Sources'],['question','Questions'],['claim','Claims'],['note','Notes'],['discovery','Discoveries'],['explanation','Explanations'],['theory_event','Theory history'],['timeline','Timelines'],['board_link','Board links']];
    const {total:matchCount,results:matches}=searchRecordsWindow(rows,state.search,state.searchType,state.searchVisible);
    return `${pageHeader('LOCAL ARCHIVE INDEX','Search the Research Archive','Search titles, aliases, source references, claims, notes, and connections. Results use your locally available records only.')}
        <div class="toolbar"><input class="input" data-filter="search" aria-label="Search all research records" placeholder="Enter a title, alias, phrase or research question…" value="${safe(state.search)}" autofocus><select class="input" aria-label="Result type" data-filter="searchType">${types.map(([id,label])=>`<option value="${id}" ${state.searchType===id?'selected':''}>${label}</option>`).join('')}</select></div>
        ${state.search.trim()?`<p class="muted">${matchCount} matching records · Local search · No query uploaded</p>${matches.length?`<div class="vstack">${matches.map(({row,context,snippet})=>{
            const title=row.payload?.title||row.payload?.text||row.payload?.rationale||row.type;
            return `<article class="case-item"><div class="item-main"><div class="kicker">${safe(row.type.toUpperCase())}${context?' · '+safe(context):''}</div><strong>${safe(short(title,160))}</strong><small>${safe(short(snippet,215))}</small></div><div class="actions">${button('viewSearchResult','Open →','btn btn-small',`data-id="${safe(row.id)}"`)}</div></article>`;
        }).join('')}</div>${matchCount>state.searchVisible?button('moreSearch',`Show more search results (${Math.min(matchCount-state.searchVisible,60)} next)`,'btn'):''}`:empty('No matching records','Try a shorter phrase, alternate spelling, or remove the result-type filter.')}`:empty('Search the entire archive','Enter a term to search your saved research across record types.')}`;
}

// ============================================================================
// [JS-04] CASE FILE: THREE READING DEPTHS + INVESTIGATION SECTIONS
// ============================================================================
async function renderCase(rows){
    const r=rows.find(row=>row.type==='case'&&row.id===state.caseId);
    if(!r)return empty('Case not found','The case may have been deleted or is not available on this device.','goArchive','Back to Archive');
    const p=r.payload;
    const citationCoverage=caseSourceCoverage(rows,r.id);
    const claims=children(rows,'claim',r.id),sources=citationCoverage.sources,timelines=children(rows,'timeline',r.id),notes=children(rows,'note',r.id),tasks=children(rows,'task',r.id),questions=children(rows,'question',r.id),explanations=children(rows,'explanation',r.id);
    const relations=rows.filter(x=>x.type==='relation'&&(x.payload.fromId===r.id||x.payload.toId===r.id));
    const theoryEvents=children(rows,'theory_event',r.id);
    const sectionTabs=[['story','Story'],['workflow','Research Guide'],['claims','Claims & Evidence'],['timeline','Timeline'],['evolution','Theory Evolution'],['sources','Sources'],['explanations','Explanations'],['board','Investigation Board'],['questions','Open Questions'],['notes','My Notes'],['subjects','Subjects'],['related','Related'],['review','Editorial Review'],['publication','Publication Review']];
    const subjectLinks=caseSubjectLinks(buildSubjectIndex(rows),r.id);
    const review=caseEditorialReview(rows,r.id);
    const publishing=publicationAssessment(rows,r.id);
    const workflow=caseResearchWorkflow(rows,r.id);
    let content='';
    if(state.caseTab==='workflow') {
        content=`<div class="kicker">GUIDED RESEARCH / EDITORIAL PREPARATION</div><h2>Case Completion Summary</h2>
            <p class="muted">${safe(workflow.caveat)} Work through these stages in any order. Optional steps remain optional; contested conclusions are not endorsed.</p>
            <div class="workflow-summary"><div><strong>${workflow.completedRequired} of ${workflow.requiredCount}</strong><small>Required steps documented</small></div><div><strong>${workflow.openQuestionCount}</strong><small>Open evidence questions</small></div><div><strong>${workflow.pendingTaskCount}</strong><small>Unfinished tasks</small></div></div>
            <p class="muted">${safe(workflow.label)}. Recorded citations: ${workflow.sourceCount}. Proposed explanations: ${workflow.explanationCount}. Human review remains separate from research-stage labels.</p>
            <ol class="workflow-steps">${workflow.steps.map(step=>`<li class="workflow-step"><div class="workflow-step-header"><span class="badge ${step.done?'success':step.required?'warn':''}">${step.done?'Recorded':step.required?'Needed':'Optional'}</span><strong>${safe(step.title)}</strong></div><p class="muted">${safe(step.detail)}</p>${button('workflowStep',safe(step.action)+' →','btn btn-small',`data-case="${safe(r.id)}" data-tab="${safe(step.tab)}" data-step="${safe(step.actionType)}"`)}</li>`).join('')}</ol>
            <div class="callout"><strong>Use source evidence, not automated conclusions.</strong><p class="muted">Some cases should remain unresolved. The guide never fabricates missing material, assigns a truth score, or automatically marks an editorial review complete.</p></div>`;
    } else if(state.caseTab==='review') {
        const label=review.current?'Reviewed and current':review.stale?'Review needs refreshing':review.reviewed?'Review recorded':'Not reviewed';
        content=`<div class="kicker">MANUAL EDITORIAL REVIEW</div><h2>${safe(label)}</h2>
            <p class="muted">${safe(review.caveat)} Reviews do not assert that contested stories or interpretations are true.</p>
            ${review.reviewedAt?`<p>Last reviewed: <strong>${safe(stamp(review.reviewedAt))}</strong>${review.stale?' · Evidence or narrative changed since that review.':''}</p>`:''}
            <div class="grid two"><div class="callout"><strong>${review.blocking} required item(s)</strong><p>Fix these before recording a completed review.</p></div>
            <div class="callout"><strong>${review.advisory} advisory item(s)</strong><p>Consider these caveats and gaps during review.</p></div></div>
            ${review.findings.length?`<div class="vstack" style="margin-top:16px">${review.findings.map(f=>`<div class="case-item"><div class="item-main"><span class="badge ${f.level==='blocking'?'warn':''}">${safe(f.level)}</span><strong>${safe(f.description)}</strong></div></div>`).join('')}</div>`:'<p class="muted">No checklist deficiencies detected. Verify all content yourself before recording a review.</p>'}
            <div class="sep"></div><div class="actions">${review.eligible?button('markCaseReviewed','Mark Editorial Review Complete','btn btn-gold',`data-id="${r.id}"`):button('caseTab','Review claims & sources first','btn',`data-tab="claims"`)}</div>
            <small>This is a human-controlled research-stage checkpoint, not automatic verification of claims or suitability for public publishing.</small>`;
    } else if(state.caseTab==='publication') {
        content=`<div class="kicker">PRIVATE-TO-PUBLIC BOUNDARY</div><h2>Publication Candidate Review</h2>
            <p class="muted">No records are published or transmitted here. The only output is a manually reviewed, minimal JSON candidate you may choose to download for a separate future publishing workflow.</p>
            <div class="callout"><strong>${publishing.eligible?'Eligible for human publication checks':'Export is blocked'}</strong><p class="muted">Research review must be current. Publication clearance is separate and never inherited from a case being marked Reviewed.</p></div>
            ${publishing.blockers.length?`<div class="vstack" style="margin:12px 0">${publishing.blockers.map(t=>`<p class="warning-text">• ${safe(t)}</p>`).join('')}</div>`:''}
            <h3>Privacy and accuracy cautions</h3><div class="vstack">${publishing.warnings.map(t=>`<p class="muted">• ${safe(t)}</p>`).join('')}</div>
            <p class="muted">Proposed candidate includes case title, category, central question, Quick Overview, Full Story, claim assessments, and minimal citation metadata (${publishing.claimCount} claims / ${publishing.sourceCount} sources). Private notes, Inbox, tasks, questions, attachments, PC filenames, directory paths, and source research notes are excluded by allowlist.</p>
            <div class="actions">${button('previewPublicCandidate','Inspect exact candidate content','btn')}${publishing.eligible?button('approvePublicCandidate','Review safety checklist and export','btn btn-gold'):button('caseTab','Return to Editorial Review','btn btn-small','data-tab="review"')}</div>
            <div class="sep"></div><h3>Compare an earlier publication candidate</h3>
            <p class="muted">Choose an earlier candidate JSON downloaded from this app to see exactly which narrative, claims and citation fields changed. Files stay on this device and are not imported into your research or cloud. Comparison does not grant publication approval.</p>
            <label class="public-compare-input" for="previous-public-candidate">Earlier public-candidate JSON file (4 MiB maximum)</label>
            <input class="input" type="file" id="previous-public-candidate" data-public-compare="1" accept=".json,application/json" aria-describedby="public-compare-help">
            <small id="public-compare-help">The earlier candidate format does not include an immutable case ID. Confirm manually that both drafts belong to the same case, even if their titles differ.</small>
            <small>The app cannot reliably detect allegations, personal information, copyright violations, or attribution mistakes within author-written narrative. You must inspect the full candidate yourself before export.</small>`;
    } else if(state.caseTab==='story') {
        if(state.readingDepth==='quick')content=`<div class="kicker">QUICK OVERVIEW</div><h2>${safe(p.title)}</h2><div class="prose">${safe(p.summary||'No quick overview has been written yet. Select Edit Case to add one.')}</div><div class="sep"></div><div class="kicker">THE CENTRAL QUESTION</div><p>${safe(p.centralQuestion||'Not specified yet.')}</p>`;
        else if(state.readingDepth==='full'){
            const sections=readingSections(p.story||'The full narrative has not been written yet. Use Edit Case to begin drafting.');
            const indexed=sections.length>1;
            content=`<div class="kicker">THE FULL STORY</div><h2>${safe(p.title)}</h2>
                ${indexed?`<nav class="reading-jump-nav" aria-label="Jump within this long story"><strong>Jump to reading section</strong><div class="actions">${sections.map((section,i)=>button('readingJump',`Section ${i+1}`,'btn btn-small',`data-section="${i}"`)).join('')}</div><small>Sections are reading landmarks only. They do not change the story or imply new evidence.</small></nav>`:''}
                <article class="reading-story">${sections.map((section,i)=>`<section class="reading-story-section" id="reading-section-${i}" ${indexed?'tabindex="-1"':''}>${indexed?`<h3 class="reading-section-heading">Reading section ${i+1} of ${sections.length}</h3>`:''}<div class="prose">${safe(section.text)}</div></section>`).join('')}</article>`;
        }
        else content=`<div class="kicker">DEEP DIVE</div><h2>Research overview</h2><p class="prose">${safe(p.summary||'A research overview has not been written yet.')}</p><div class="sep"></div><div class="grid two"><div class="callout"><strong>${claims.length} assessed claims</strong><p class="muted">Evaluate assertions individually, with support and counterevidence.</p>${button('caseTab','Explore claims →','btn btn-small','data-tab="claims"')}</div><div class="callout"><strong>${sources.length} recorded sources</strong><p class="muted">Inspect provenance and PC-only attachment references.</p>${button('caseTab','Explore sources →','btn btn-small','data-tab="sources"')}</div></div>`;
    } else if(state.caseTab==='claims') {
        content=sectionList('Claims & Evidence','Individual assertions are not the same as case-wide truth.',claims,'claim',r.id,row=>`<strong>${safe(row.payload.text)}</strong><div class="chips" style="margin:9px 0"><span class="badge ${row.payload.assessment==='Documented'?'success':row.payload.assessment==='Unsubstantiated'?'warn':''}">${safe(row.payload.assessment||'Unassessed')}</span></div><p class="muted">${safe(short(row.payload.support||row.payload.contrary||'No evidence analysis entered.'))}</p>${renderClaimEvidence(row,rows)}${sourceIndependenceNotice(rows,[...new Set([...(row.payload.sourceIds||[]),...(row.payload.supportSourceIds||[]),...(row.payload.contrarySourceIds||[])])])}`);
    } else if(state.caseTab==='timeline') {
        content=`${sectionTitle('Timeline','Dates of events and dates of later claims must remain distinguishable.','timeline',r.id)}${timelines.length?`<div class="timeline">${timelines.sort((a,b)=>String(a.payload.date).localeCompare(String(b.payload.date))).slice(0,state.caseItemsVisible).map(row=>`<div class="timeline-row"><div class="kicker">${safe(row.payload.date)} · ${safe(row.payload.certainty)}</div><h3>${safe(row.payload.title)}</h3><p class="muted">${safe(row.payload.details||'No details added.')}</p>${itemActions(row)}</div>`).join('')}</div>`:empty('No timeline events','Add the first dated event to begin the chronology.')}`;
    } else if(state.caseTab==='evolution') {
        const ordered=[...theoryEvents].sort((a,b)=>String(a.payload.period||'').localeCompare(String(b.payload.period||'')));
        content=`${sectionTitle('Theory Evolution','Track when a story changed, not when the alleged event occurred. Dates and changes require source support.','theory_event',r.id)}
            <div class="callout" style="margin-bottom:17px"><strong>Separate research clocks</strong><p class="muted" style="margin:7px 0 0">Historical Timeline records when events allegedly or demonstrably happened. Theory Evolution records when a claim appeared, spread, changed, or was reconsidered. Neither establishes that the claim is true.</p></div>
            ${ordered.length?`<div class="timeline">${ordered.slice(0,state.caseItemsVisible).map(row=>{const ev=row.payload;const claim=rows.find(x=>x.type==='claim'&&x.id===ev.claimId);return `<article class="timeline-row"><div class="kicker">${safe(ev.period)} · ${safe(ev.changeKind||'Evolution')}</div><h3>${safe(ev.title)}</h3>${claim?`<div class="chips"><span class="badge">Related claim: ${safe(short(claim.payload.text,65))}</span></div>`:''}<div class="prose">${safe(ev.details||'Supporting details not entered yet.')}</div>${sourceReferences(ev.sourceIds)}<div class="actions" style="margin-top:11px">${itemActions(row)}</div></article>`;}).join('')}</div>`:empty('No theory history recorded','Record traceable developments as you locate originals, revisions, and later reassessments.')}`;
    } else if(state.caseTab==='sources') {
        content=`${sectionTitle('Sources & Documents','Bibliography and PC-local documents. Source references sync; source file bytes do not.','source',r.id)}<div class="actions" style="margin-bottom:14px">${button('openSourceIntake','Paste source links','btn btn-small',`data-case="${safe(r.id)}"`)}</div>${citationCoverage.missingIds.length?`<p class="warning-text">${citationCoverage.missingIds.length} cited source reference(s) are missing or in Trash. Review the affected claims and questions.</p>`:''}${sources.length?[...sources.slice(0,state.caseItemsVisible),...sources.filter(row=>row.id===state.focusRecord&&!sources.slice(0,state.caseItemsVisible).some(item=>item.id===row.id))].map(row=>sourceCard(row,rows,r.id)).join(''):empty('No sources yet','Record original documents, later commentary, books, interviews, or public links.')}`;
    } else if(state.caseTab==='explanations') {
        content=`${sectionTitle('Competing Explanations','Each explanation has independent support, objections and cited sources. Uncertainty is not equivalence.','explanation',r.id)}
            ${explanations.length?`<div class="explanation-grid">${explanations.slice(0,state.caseItemsVisible).map(row=>{const e=row.payload;return `<article class="card explanation-card"><div class="kicker">PROPOSED EXPLANATION</div><h3>${safe(e.title)}</h3><span class="badge ${e.assessment==='Documented'?'success':''}">${safe(e.assessment||'Unassessed')}</span><p class="prose">${safe(e.description||'No explanation drafted yet.')}</p><div class="evidence-block"><strong>Supporting evidence</strong><p>${safe(e.support||'None recorded')}</p></div><div class="evidence-block"><strong>Challenges and gaps</strong><p>${safe(e.contrary||'None recorded')}</p></div>${sourceReferences(e.sourceIds)}<div class="card-foot"><small>${stamp(row.modifiedAt)}</small>${itemActions(row)}</div></article>`;}).join('')}</div>`:empty('No explanations compared','Create one or more competing explanations. Compare evidence and limitations explicitly.')}`;

    } else if(state.caseTab==='board') {
        content=await renderInvestigationBoard(rows,r,claims,sources,explanations,notes);
    } else if(state.caseTab==='questions') {
        content=`${sectionTitle('Evidence Questions','Record testable open questions. An answered question needs an authored explanation; this is not a truth assessment.','question',r.id)}${questions.length?[...questions.slice(0,state.caseItemsVisible),...questions.filter(row=>row.id===state.focusRecord&&!questions.slice(0,state.caseItemsVisible).some(item=>item.id===row.id))].map(row=>`<article class="case-item" id="research-${safe(row.id)}" tabindex="-1"><div class="item-main"><strong>${safe(row.payload.text||'Untitled question')}</strong><div class="chips"><span class="badge">${safe(row.payload.status||'Open')}</span></div>${row.payload.answer?`<p class="muted">${safe(row.payload.answer)}</p>`:''}${sourceReferences(row.payload.sourceIds)}</div><div class="actions">${itemActions(row)}</div></article>`).join(''):empty('No evidence questions yet','Capture uncertainties as testable questions instead of hiding them inside a long note.')}`;
    } else if(state.caseTab==='subjects') {
        content=`<div class="panel-head"><div><h2>People, places and topics</h2><p class="muted">Explicit entity links and case tags create browsing paths. A shared subject does not establish a factual connection.</p></div>${button('newCaseEntity','＋ Link entity','btn btn-small',`data-case="${safe(r.id)}"`)}</div>
            <h3>Documented subject entries (${subjectLinks.entities.length})</h3>${subjectLinks.entities.length?subjectLinks.entities.slice(0,state.caseItemsVisible).map(entity=>`<article class="case-item"><div class="item-main"><span class="badge">${safe(entity.payload.kind)}</span><strong>${safe(entity.payload.name)}</strong><small>${safe(short(entity.payload.description||'No descriptive context recorded.',140))}</small></div><div class="actions">${button('openEntity','Explore','btn btn-small',`data-id="${safe(entity.id)}"`)}${button('editRecord','Edit','btn btn-small',`data-id="${safe(entity.id)}"`)}${button('unlinkCaseEntity','Unlink','btn btn-small',`data-id="${safe(entity.id)}" data-case="${safe(r.id)}"`)}</div></article>`).join(''):'<p class="muted">No entities explicitly linked to this case yet.</p>'}
            <div class="sep"></div><h3>Case topic tags (${subjectLinks.topics.length})</h3><div class="chips">${subjectLinks.topics.length?subjectLinks.topics.map(topic=>button('openTopic',safe(topic.label),'btn btn-small',`data-name="${safe(topic.key)}"`)).join(''):'<p class="muted">Add topic tags when editing this Case File.</p>'}</div><div class="actions" style="margin-top:18px">${button('goSubjects','Browse all subjects →','btn btn-small')}</div>`;
    } else if(state.caseTab==='notes') {
        content=`${sectionTitle('Private Investigation','Notebook entries remain private research records.','note',r.id)}${notes.length?notes.slice(0,state.caseItemsVisible).map(row=>`<div class="card" style="margin-bottom:10px"><h3>${safe(row.payload.title)}</h3><div class="prose">${safe(row.payload.content)}</div><div class="card-foot"><small>${stamp(row.modifiedAt)}</small>${itemActions(row)}</div></div>`).join(''):empty('Your notebook is empty','Capture observations, questions and tentative hypotheses here.')}
        ${sectionTitle('Research Checklist','Completing a task does not prove a claim.','task',r.id)}${tasks.length?[...tasks.slice(0,state.caseItemsVisible),...tasks.filter(row=>row.id===state.focusRecord&&!tasks.slice(0,state.caseItemsVisible).some(item=>item.id===row.id))].map(row=>{const info=queuePriority({kind:'tasks',priority:row.payload.priority,dueOn:row.payload.dueOn,urgency:2});return `<div class="case-item" id="research-${safe(row.id)}" tabindex="-1"><div class="item-main"><label><input type="checkbox" data-action="toggleTask" data-id="${row.id}" ${row.payload.done?'checked':''}> ${safe(row.payload.title)}</label><small>${safe(row.payload.priority||'Routine')} priority${row.payload.dueOn?' · Target '+safe(row.payload.dueOn):' · No target date'}${!row.payload.done&&info.reason?' · '+safe(info.reason):''}</small></div>${itemActions(row)}</div>`;}).join(''):'<p class="muted">No research tasks yet.</p>'}`;
    } else {
        content=`${sectionTitle('Related Investigations','A connection needs a specific explanation of what it means.','relation',r.id)}${relations.length?relations.slice(0,state.caseItemsVisible).map(row=>{const other=rows.find(c=>c.type==='case'&&c.id===(row.payload.fromId===r.id?row.payload.toId:row.payload.fromId));return `<div class="card" style="margin-bottom:10px"><div class="chips"><span class="badge">${safe(row.payload.kind)}</span></div><h3>${other?entry(other.id,other.payload.title):'Missing case reference'}</h3><p class="muted">${safe(row.payload.rationale)}</p>${itemActions(row)}</div>`;}).join(''):empty('No case connections yet','Link a second case and explain the relationship, not just a shared keyword.')}`;
    }
    if(state.caseTab!=='story'&&state.caseTab!=='board'&&state.caseTab!=='claims'){
        const maxEntries=({timeline:timelines.length,evolution:theoryEvents.length,sources:sources.length,explanations:explanations.length,notes:Math.max(notes.length,tasks.length),questions:questions.length,subjects:subjectLinks.entities.length,related:relations.length})[state.caseTab]||0;
        if(maxEntries>state.caseItemsVisible)content+=button('moreCaseItems',`Show more case entries (${Math.min(40,maxEntries-state.caseItemsVisible)} next)`,'btn');
    }
    const readingToolbar=state.caseTab==='story' ? `<div class="reading-controls" role="group" aria-label="Reading comfort settings">
        <span class="kicker">READING COMFORT</span>
        ${button('readingSize','Smaller text','btn btn-small',`data-size="small" aria-pressed="${state.readingSize==='small'}"`)}
        ${button('readingSize','Standard text','btn btn-small',`data-size="normal" aria-pressed="${state.readingSize==='normal'}"`)}
        ${button('readingSize','Larger text','btn btn-small',`data-size="large" aria-pressed="${state.readingSize==='large'}"`)}
        ${button('readingFocus',state.readingFocus?'Exit focused reading':'Focus on story','btn btn-small',`aria-pressed="${state.readingFocus}"`)}
    </div>` : '';
    const progress=workflow.steps;
    return `<div class="page-head"><div><div class="kicker">${safe(p.category||'CASE FILE')} · ${r.id.slice(0,8).toUpperCase()}</div><h1>${safe(p.title)}</h1><p class="page-sub">${safe(p.centralQuestion||p.summary||'A new investigation waiting for its first research notes.')}</p><div class="chips" style="margin-top:11px"><span class="badge">${safe(p.status)}</span>${review.stale?'<span class="badge warn">Review out of date</span>':''}${p.sample?'<span class="badge warn">Demonstration outline · Unsourced</span>':''}${tags(p.tags)}</div></div><div class="actions">${button('toggleBookmark',p.bookmarked?'★ Saved':'☆ Bookmark','btn btn-small',`data-id="${r.id}"`)}${button('togglePin',p.pinned?'Unpin':'Pin','btn btn-small',`data-id="${r.id}"`)}${button('editRecord','Edit Case','btn btn-gold',`data-id="${r.id}"`)}</div></div>
        <div class="tabs" role="navigation" aria-label="Dossier sections">${sectionTabs.map(([id,label])=>`<button class="tab ${state.caseTab===id?'active':''}" data-action="caseTab" data-tab="${id}" ${state.caseTab===id?'aria-current="page"':''}>${label}</button>`).join('')}</div>
        <div class="split case-layout ${state.readingFocus&&state.caseTab==='story'?'reading-focus':''}"><section class="panel">${readingToolbar}${state.caseTab==='story'?`<div class="actions" style="margin-bottom:22px"><span class="kicker">READING DEPTH</span>${[['quick','Quick'],['full','Full Story'],['deep','Deep Dive']].map(([id,label])=>button('readingDepth',label,`btn btn-small ${state.readingDepth===id?'btn-gold':''}`,`data-depth="${id}"`)).join('')}</div>`:''}${content}</section>
        <div class="vstack"><section class="panel"><div class="kicker">CASE OVERVIEW</div><div class="sep"></div><p><strong>Research stage</strong><br><span class="muted">${safe(p.status||'Not started')}</span></p><p><strong>Sources</strong><br><span class="muted">${sources.length} recorded</span></p><p><strong>Claims</strong><br><span class="muted">${claims.length} recorded</span></p><p><strong>Updated</strong><br><span class="muted">${stamp(r.modifiedAt)}</span></p></section>
        <section class="panel"><div class="kicker">EDITORIAL CHECKLIST</div><div class="sep"></div><p><strong>${workflow.completedRequired} of ${workflow.requiredCount} required stages recorded</strong></p><p class="muted">${safe(workflow.next?.title||'No outstanding guided steps')} · ${safe(workflow.label)}</p>${progress.filter(step=>step.required).map(step=>`<p class="workflow-mini">${step.done?'☑':'☐'} ${safe(step.title)}</p>`).join('')}${button('caseTab','Open Research Guide','btn btn-small','data-tab="workflow"')}${button('caseTab','Editorial Review','btn btn-small','data-tab="review"')}${button('goEditorial','All research follow-ups','btn btn-small')}<small>Research completeness is not a measure of a theory's truth.</small></section><section class="panel"><div class="kicker">RESEARCH TOOLS</div><div class="sep"></div><div class="vstack">${button('newNote','✎ Add private note','btn btn-small',`data-case="${r.id}"`)}${button('addDiscovery','＋ Capture discovery','btn btn-small')}${button('openConnections','◎ Explore connections','btn btn-small',`data-id="${r.id}"`)}${button('print','Print case','btn btn-small')}</div></section></div></div>`;
}
// ============================================================================
// [JS-BOARD] ONE-CASE INVESTIGATION BOARD
// Visual edges are representations of explicit user-authored relationships.
// The accessible record list is the complete board, including on mobile.
// ============================================================================
async function renderInvestigationBoard(rows,caseRecord,claims,sources,explanations,notes){
    const candidates=boardNodes(rows,caseRecord.id);
    const byId=new Map(candidates.map(r=>[r.id,r]));
    const links=rows.filter(row=>row.type==='board_link'&&row.payload.caseId===caseRecord.id);
    const shown=links.filter(l=>state.boardFilter==='All'||l.payload.kind===state.boardFilter);
    const missing=links.filter(l=>!byId.has(l.payload.fromId)||!byId.has(l.payload.toId));
    const column=(heading,records)=>`<div class="board-column"><h3>${safe(heading)} <span class="badge">${records.length}</span></h3>${records.length?records.slice(0,state.boardVisible).map(r=>`<div class="board-node"><span class="kicker">${safe(r.type)}</span><strong>${safe(short(boardTitle(r),110))}</strong><div class="actions">${button('editRecord','Review record','btn btn-small',`data-id="${safe(r.id)}"`)}</div></div>`).join(''):'<p class="muted">No records yet</p>'}${records.length>state.boardVisible?`<small>${records.length-state.boardVisible} more records in this column. Use Show More below.</small>`:''}</div>`;
    const saved=await getMeta('board_layout:'+caseRecord.id)||{};
    const visual=prepareBoardLayout(candidates,saved,state.boardVisible);
    const positioned=visual.positions;
    const visibleIds=new Set(visual.visible.map(r=>r.id));
    const edges=shown.filter(l=>visibleIds.has(l.payload.fromId)&&visibleIds.has(l.payload.toId));
    const selected=byId.get(state.boardSelected);
    const edgeHtml=edges.map(l=>{const coords=boardEdgeCoordinates(positioned[l.payload.fromId],positioned[l.payload.toId]);return `<line data-board-from="${safe(l.payload.fromId)}" data-board-to="${safe(l.payload.toId)}" x1="${coords.x1}" y1="${coords.y1}" x2="${coords.x2}" y2="${coords.y2}" class="board-edge ${safe(l.payload.kind.toLowerCase().replaceAll(' ','-'))}"/>`;}).join('');
    const nodesHtml=visual.visible.map(r=>{const point=positioned[r.id];return `<button type="button" class="board-canvas-node ${state.boardSelected===r.id?'selected':''}" data-action="boardSelectNode" data-board-node="${safe(r.id)}" aria-pressed="${state.boardSelected===r.id?'true':'false'}" aria-label="${safe(r.type+': '+short(boardTitle(r),160))}. Select or use arrow keys to reposition." style="left:${point.x}px;top:${point.y}px"><span class="kicker">${safe(r.type)}</span><span class="board-canvas-label">${safe(short(boardTitle(r),73))}</span></button>`;}).join('');
    const inspector=selected?`<div class="kicker">SELECTED ${safe(selected.type.toUpperCase())}</div><h4>${safe(boardTitle(selected))}</h4><p class="muted">${safe(short(selected.payload?.text||selected.payload?.description||selected.payload?.details||selected.payload?.content||'',220)||'Open the record for its research details.')}</p><div class="actions">${button('boardEditSelected','Open selected record','btn btn-small')}${button('boardLinkSelected','Connect this node','btn btn-gold',candidates.length<2?'disabled':'')}</div>`:'<p class="muted">Select a node to inspect its record or create an explained connection. On the visual board, drag a node or use the arrow keys while it has focus.</p>';
    return `<div class="panel-head"><div><h2>Investigation Board</h2><p class="muted">Connect specific claims, sources, explanations and notes. Every line must be explained; connections are not proof.</p></div>${button('newBoardLink','＋ Link Evidence','btn btn-gold',candidates.length<2?'disabled':'')}</div>
        <div class="callout" style="margin-bottom:15px">${candidates.length} research records · ${links.length} explicit connections. Only relationships you create will appear. Board node positions are saved on this device only.</div>
        ${candidates.length?`<div class="board-columns">${column('Claims',claims)}${column('Source records',candidates.filter(x=>x.type==='source'))}${column('Explanations',explanations)}${column('Notes',notes)}</div>${Math.max(claims.length,sources.length,explanations.length,notes.length)>state.boardVisible?button('moreBoardRecords','Show more research records','btn'):''}`:empty('No evidence records yet','Add at least two claims, sources, explanations, or notes before connecting them.')}
        ${visual.visible.length>0?`<details class="board-visual"><summary>Open interactive evidence diagram (${visual.visible.length} records)</summary><div class="board-tools"><p class="muted">Choose a node for details. Drag to arrange it, or focus it and press an arrow key to move. Shift + arrow moves farther. This diagram is optional; every connection is also listed below.</p>${button('resetBoardLayout','Reset diagram layout','btn btn-small')}</div><div class="board-graph" aria-label="Horizontally scrollable research diagram"><div class="board-stage" style="width:${visual.width}px;height:${visual.height}px" data-board-height="${visual.height}" data-board-case="${safe(caseRecord.id)}"><svg class="board-wires" viewBox="0 0 ${visual.width} ${visual.height}" aria-hidden="true" focusable="false">${edgeHtml}</svg>${nodesHtml}</div></div>${visual.hidden?`<small>${visual.hidden} nodes not currently shown in the diagram. Show More reveals additional nodes.</small>`:''}<div id="board-inspector" class="board-inspector" aria-live="polite">${inspector}</div></details>`:''}
        <div class="sep"></div><div class="panel-head"><h3>Relationship evidence</h3><select class="input board-filter" data-filter="board" aria-label="Filter board connection meaning">${selectOptions(['All',...BOARD_KINDS],state.boardFilter)}</select></div>
        ${shown.length?shown.slice(0,state.boardLinksVisible).map(l=>{const a=byId.get(l.payload.fromId),b=byId.get(l.payload.toId);return `<article class="case-item"><div class="item-main"><span class="badge">${safe(l.payload.kind)}</span><strong>${safe(short(boardTitle(a),110))} → ${safe(short(boardTitle(b),110))}</strong><small>${safe(l.payload.rationale)}</small>${!a||!b?'<small class="warning-text">A linked record is missing or in Trash. Restore or edit this connection.</small>':''}</div><div class="actions">${button('editRecord','Edit link','btn btn-small',`data-id="${safe(l.id)}"`)}${button('trashRecord','Trash','btn btn-small btn-danger',`data-id="${safe(l.id)}"`)}</div></article>`;}).join(''):empty('No matching board connections','Use Link Evidence to record a specific relationship, with a reason.')}${shown.length>state.boardLinksVisible?button('moreBoardLinks',`Show more relationships (${Math.min(48,shown.length-state.boardLinksVisible)} next)`,'btn'):''}
        ${missing.length?`<p class="warning-text">${missing.length} connection(s) reference a missing or trashed record. No automatic reassignment has been made.</p>`:''}`;
}

function boardInspectorContent(row){
    if(!row)return '<p class="muted">Selected record is unavailable. Select another node.</p>';
    return `<div class="kicker">SELECTED ${safe(row.type.toUpperCase())}</div><h4>${safe(boardTitle(row))}</h4><p class="muted">${safe(short(row.payload?.text||row.payload?.description||row.payload?.details||row.payload?.content||'',220)||'Open the record for its research details.')}</p><div class="actions">${button('boardEditSelected','Open selected record','btn btn-small')}${button('boardLinkSelected','Connect this node','btn btn-gold')}</div>`;
}

async function selectBoardNode(id){
    const row=await getRecord(id);
    if(!row||row.deleted)return;
    state.boardSelected=id;
    document.querySelectorAll('[data-board-node]').forEach(node=>{
        const active=node.dataset.boardNode===id;
        node.classList.toggle('selected',active);
        node.setAttribute('aria-pressed',String(active));
    });
    const inspector=$('#board-inspector');
    if(inspector)inspector.innerHTML=boardInspectorContent(row);
}

function redrawBoardEdges(){
    const stage=$('.board-stage');
    if(!stage)return;
    const lookup=new Map(Array.from(stage.querySelectorAll('[data-board-node]')).map(el=>[el.dataset.boardNode,{x:el.offsetLeft,y:el.offsetTop}]));
    stage.querySelectorAll('[data-board-from]').forEach(line=>{
        const a=lookup.get(line.dataset.boardFrom),b=lookup.get(line.dataset.boardTo);
        if(!a||!b)return;
        const xy=boardEdgeCoordinates(a,b);
        for(const [attr,value] of Object.entries(xy))line.setAttribute(attr,String(value));
    });
}

async function rememberBoardNodePosition(el){
    const stage=el.closest('.board-stage');
    if(!stage)return;
    const key='board_layout:'+stage.dataset.boardCase;
    const old=await getMeta(key)||{};
    const current={...old,[el.dataset.boardNode]:{x:el.offsetLeft,y:el.offsetTop}};
    await setMeta(key,current);
}

function renderClaimEvidence(claim,rows){
    const groups=claimEvidenceGroups(claim,rows);
    const hasAny=groups.some(group=>group.ids.length);
    if(!hasAny)return '<p class="warning-text">No citation recorded for this claim.</p>';
    return `<div class="evidence-roles">${groups.map(group=>group.ids.length?`<div class="evidence-role"><strong>${safe(group.label)}</strong>${sourceReferences(group.ids)}</div>`:'').join('')}</div>`;
}

function sourceIndependenceNotice(rows,ids){
    if(!Array.isArray(ids)||ids.length<2)return '';
    const report=relatedSourceGroups(rows,ids);
    const reused=report.groups.filter(g=>g.length>1);
    if(!reused.length)return '<small class="muted">No shared source ancestry is recorded. Independence is not established by this absence.</small>';
    const sources=new Map(rows.filter(r=>r.type==='source').map(r=>[r.id,r.payload.title]));
    return `<div class="callout"><strong>Recorded citation overlap</strong><p class="muted">${reused.length} cluster(s) of linked sources share documented ancestry. Multiple citations may repeat one origin and are not necessarily independent corroboration.</p>${reused.map(g=>`<small>${g.map(id=>safe(short(sources.get(id)||'Unavailable source',50))).join(' · ')}</small>`).join('<div class="sep"></div>')}</div>`;
}

function sourceReferences(ids){
    if(!ids?.length)return '';
    return `<div class="callout"><strong>Linked sources</strong><div class="chips">${ids.map(id=>state.sourceNames?.has(id)?button('inspectSource',safe(short(state.sourceNames.get(id),70)),'btn btn-small',`data-id="${safe(id)}" aria-label="Inspect provenance for ${safe(state.sourceNames.get(id))}"`):`<span class="badge warn">Missing source ${safe(String(id).slice(0,8))}</span>`).join('')}</div><small>Select a source to inspect its recorded origin and citations.</small></div>`;
}
function sectionTitle(title,desc,type,caseId){return `<div class="panel-head"><div><h2>${safe(title)}</h2><p class="muted" style="margin:0">${safe(desc)}</p></div>${button('newRecord','＋ Add','btn btn-small',`data-type="${type}" data-case="${caseId}"`)}</div>`;}
function sectionList(title,desc,rows,type,caseId,body){return `${sectionTitle(title,desc,type,caseId)}${rows.length?[...rows.slice(0,state.caseItemsVisible),...rows.filter(row=>row.id===state.focusRecord&&!rows.slice(0,state.caseItemsVisible).some(item=>item.id===row.id))].map(row=>`<article id="research-${safe(row.id)}" tabindex="-1" class="card ${row.id===state.focusRecord?'record-spotlight':''}" style="margin-bottom:12px">${body(row)}<div class="card-foot"><small>${stamp(row.modifiedAt)}</small>${itemActions(row)}</div></article>`).join(''):empty(`No ${title.toLowerCase()} yet`,'Create the first entry to expand your dossier.')}${rows.length>state.caseItemsVisible?button('moreCaseItems',`Show more (${Math.min(40,rows.length-state.caseItemsVisible)} next)`,'btn'):''}`;}
function itemActions(row){return `<div class="actions">${button('editRecord','Edit','btn btn-small',`data-id="${row.id}"`)}${button('trashRecord','Move to Trash','btn btn-small btn-danger',`data-id="${row.id}"`)}</div>`;}
function sourceCard(row,rows=[],caseId=null){const p=row.payload;const uses=sourceClaimUses(rows,row.id,caseId);const documentation=sourceDocumentationStatus(row,rows,caseId);const external=formatURL(p.url);const desktopFileControls=!/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);return `<article id="research-${safe(row.id)}" tabindex="-1" class="card ${row.id===state.focusRecord?'record-spotlight':''}" style="margin-bottom:12px"><div class="kicker">${safe(p.sourceType||'REFERENCE')}</div><h3>${safe(p.title)}</h3>${documentation.shared?'<div class="chips"><span class="badge">Shared source from another case</span></div>':''}<p class="muted">${safe([p.author,p.date].filter(Boolean).join(' · '))}</p><p>${safe(p.details||'No provenance notes entered.')}</p>${external?`<a href="${safe(external)}" target="_blank" rel="noopener noreferrer">Open public source ↗</a>`:''}${sourceReferences(p.derivedFromIds)}<div class="source-documentation"><strong>Source documentation</strong><small>${documentation.missing.length?'To improve: '+safe(documentation.missing.join(', ')):'Core provenance fields recorded. Verify accuracy against the original.'}</small><small>In this case: ${documentation.roles.support} supporting, ${documentation.roles.challenge} challenging, ${documentation.roles.background} background claim reference(s). Citations do not prove claims.</small>${documentation.missing.length?button('editRecord','Improve source record','btn btn-small',`data-id="${safe(row.id)}"`):''}</div>${uses.length?`<div class="callout"><strong>Claims citing this source (${uses.length})</strong>${uses.slice(0,20).map(usage=>`<div class="source-claim-use"><span class="badge">${safe(usage.roles.join(' / '))}</span> ${button('goClaim',safe(short(usage.claim.payload.text,95)),'btn btn-small',`data-id="${usage.claim.id}"`)}</div>`).join('')}${uses.length>20?'<small>Additional citations can be found through local search.</small>':''}</div>`:''}${p.filename?`<div class="callout" style="margin-top:12px">▤ ${safe(p.filename)} <span class="badge">PC-only file</span><br><small>Actual file bytes are never cloud-synchronized.</small><br>${desktopFileControls?button('openFile','Open PC File','btn btn-small',`data-id="${row.id}"`):'<small>Original document available on the Windows PC only.</small>'}</div>`:''}<div class="card-foot">${button('inspectSource','Inspect provenance','btn btn-small',`data-id="${row.id}"`)}${button('copySourceReference','Copy source reference','btn btn-small',`data-id="${safe(row.id)}"`)}${desktopFileControls?button('attachFile',p.filename?'Relink PC file':'Associate PC file','btn btn-small',`data-id="${row.id}"`):'<small>File linking is available on Windows.</small>'}${itemActions(row)}</div></article>`;}

// ============================================================================
// [JS-SUBJECTS-02] CROSS-CASE SUBJECT DISCOVERY
// An explicit subject association is a research navigation cue only.
// ============================================================================
async function renderSubjects(rows){
    const index=buildSubjectIndex(rows);
    const filtered=filterSubjectIndex(index,state.subjectQuery,state.subjectKind);
    const combined=[...filtered.entities.map(row => ({type:'entity',item:row})),
        ...filtered.topics.map(topic => ({type:'topic',item:topic}))];
    const visible=combined.slice(0,state.subjectVisible);
    const filters=`<div class="toolbar"><label class="field">Find a subject<input class="input" data-filter="subjectQuery" value="${safe(state.subjectQuery)}" placeholder="Find entity name, alias or topic" aria-label="Search subjects"></label><label class="field">Subject type<select class="input" data-filter="subjectKind">${['All','Topics',...ENTITY_KINDS].map(kind=>`<option value="${safe(kind)}" ${state.subjectKind===kind?'selected':''}>${safe(kind)}</option>`).join('')}</select></label></div>`;
    return `${pageHeader('CONNECTIONS / SUBJECT INDEX','People, places and topics','Browse entities explicitly linked to cases and topics derived from tags. Shared names are not evidence of any underlying relationship.',button('goConnections','← Connections','btn')+button('newEntity','＋ Record entity','btn btn-gold'))}
        <div class="grid three" style="margin-bottom:17px"><div class="panel"><div class="stat-number">${index.entities.length}</div><div class="stat-label">Explicit entity records</div></div><div class="panel"><div class="stat-number">${index.topics.length}</div><div class="stat-label">Distinct case topics</div></div><div class="panel"><div class="stat-number">${index.caseCount}</div><div class="stat-label">Available cases</div></div></div>
        ${filters}<p class="muted">Showing ${visible.length} of ${combined.length} matches. Record names and associations are user-entered; this view does not infer people, relationships or corroboration.</p>
        <section class="panel">${visible.length?visible.map(entry=>{
            if(entry.type==='topic'){
                const topic=entry.item;
                return `<article class="case-item"><div class="item-main"><div class="kicker">TOPIC TAG · ${topic.caseRows.length} case(s)</div><strong>${safe(topic.label)}</strong><small>Grouped from explicitly entered case tags</small></div><div class="actions">${button('openTopic','View Cases','btn btn-small',`data-name="${safe(topic.key)}"`)}</div></article>`;
            }
            const row=entry.item,p=row.payload;
            return `<article class="case-item"><div class="item-main"><div class="kicker">${safe(p.kind||'SUBJECT')} · ${row.caseRows.length} linked case(s)</div><strong>${safe(p.name)}</strong><small>${safe(short(p.description||((p.aliases||[]).length?'Also known as: '+p.aliases.join(', '):'No descriptive context entered.'),155))}</small></div><div class="actions">${button('openEntity','View Cases','btn btn-small',`data-id="${safe(row.id)}"`)}${button('editRecord','Edit','btn btn-small',`data-id="${safe(row.id)}"`)}</div></article>`;
        }).join(''):empty('No matching subjects','Try a shorter name or record a new entity to associate with investigations.')}</section>
        ${combined.length>state.subjectVisible?button('moreSubjects',`Show more subjects (${Math.min(48,combined.length-state.subjectVisible)} next)`,'btn'):''}`;
}
async function openEntityDetail(id){
    const rows=await allRecords();
    const entity=buildSubjectIndex(rows).entities.find(row=>row.id===id);
    if(!entity)return notify('This entity is no longer available.');
    const p=entity.payload;
    const cases=entity.caseRows;
    const links=cases.length?cases.map(row=>`<div class="case-item"><div class="item-main"><strong>${safe(row.payload.title)}</strong><small>${safe(row.payload.category||'Uncategorized')}</small></div>${button('openEntityCase','Open Case →','btn btn-small',`data-id="${safe(row.id)}"`)}</div>`).join(''):'<p class="muted">This entity has no active case associations.</p>';
    openModal('Subject: '+p.name,`<div class="chips"><span class="badge">${safe(p.kind)}</span></div><p class="prose">${safe(p.description||'No identification context recorded.')}</p>${p.aliases?.length?`<p class="muted">Recorded aliases: ${safe(p.aliases.join(', '))}</p>`:''}<h3>Explicit case associations</h3>${links}<p class="muted">These links are navigational metadata, not independent evidence of a factual relationship.</p><div class="modal-actions">${button('closeModal','Close','btn')}${button('editEntityFromDetail','Edit entity','btn btn-gold',`data-id="${safe(id)}"`)}</div>`);
}
async function openTopicDetail(key){
    const topic=buildSubjectIndex(await allRecords()).topics.find(row=>row.key===key);
    if(!topic)return notify('That topic is no longer present in active Case Files.');
    const links=topic.caseRows.map(row=>`<div class="case-item"><div class="item-main"><strong>${safe(row.payload.title)}</strong><small>${safe(row.payload.category||'Uncategorized')}</small></div>${button('openEntityCase','Open Case →','btn btn-small',`data-id="${safe(row.id)}"`)}</div>`).join('');
    openModal('Topic: '+topic.label,`<p class="muted">Grouped by a case tag. Identical tags do not prove linked events, people or claims.</p>${links}<div class="modal-actions">${button('closeModal','Close','btn')}</div>`);
}

// ============================================================================
// [JS-05] RESEARCH INBOX, CONNECTIONS, PERSONAL LIBRARY
// ============================================================================
async function renderInbox(rows){
    const inbox=rows.filter(r=>r.type==='discovery');
    const visible=inbox.filter(r=>state.inboxStatus==='Active'?r.payload.status!=='Archived':state.inboxStatus==='All'||r.payload.status===state.inboxStatus).filter(r=>JSON.stringify(r.payload).toLowerCase().includes(state.search.toLowerCase()));
    return `${pageHeader('QUICK CAPTURE / RESEARCH INTAKE','Research Inbox','Save things worth investigating. File them into cases when you have time.',button('addDiscovery','＋ Add Discovery','btn btn-gold'))}
        <div class="grid four" style="margin-bottom:20px">${['Inbox','Reviewing','Filed','Archived'].map(s=>`<div class="panel"><div class="stat-number">${inbox.filter(x=>x.payload.status===s).length}</div><div class="stat-label">${s}</div></div>`).join('')}</div>
        <div class="toolbar"><input class="input" data-filter="search" value="${safe(state.search)}" placeholder="Find a discovery…" aria-label="Search discoveries"><select class="input" data-filter="inbox" aria-label="Filter inbox">${selectOptions(['Active','Inbox','Reviewing','Filed','Archived','All'],state.inboxStatus)}</select></div>
        <section class="panel">${visible.length?visible.map(row=>{const p=row.payload;return `<article class="case-item"><div class="item-main"><div class="kicker">${safe(p.kind||'Discovery')} · ${stamp(row.createdAt)}</div><strong>${safe(p.title)}</strong><small>${safe(short(p.note||p.value||'',210))}</small><div class="chips" style="margin-top:8px"><span class="badge">${safe(p.status||'Inbox')}</span></div></div><div class="actions">${button('editRecord','Review','btn btn-small',`data-id="${row.id}"`)}${button('fileDiscovery','File to case','btn btn-small',`data-id="${row.id}"`)}${button('archiveDiscovery',p.status==='Archived'?'Restore':'Archive','btn btn-small',`data-id="${row.id}"`)}</div></article>`;}).join(''):empty('No discoveries in this view','Capture a link, idea, note or reference to begin collecting research.')}</section>`;
}
async function renderConnections(rows){
    const cases=rows.filter(r=>r.type==='case');const relations=rows.filter(r=>r.type==='relation');
    const center=cases.find(r=>r.id===state.connectionFocus)||cases[0];
    const visible=relations.filter(r=>(state.relationFilter==='All'||r.payload.kind===state.relationFilter)&&(!center||r.payload.fromId===center.id||r.payload.toId===center.id));
    let graph='';
    if(center){
        const linked=visible.map((r,i)=>({relation:r,case:cases.find(c=>c.id===(r.payload.fromId===center.id?r.payload.toId:r.payload.fromId)),index:i})).filter(x=>x.case).slice(0,10);
        const coords=linked.map((x,i)=>({x:275+205*Math.cos((i/Math.max(1,linked.length))*Math.PI*2),y:210+145*Math.sin((i/Math.max(1,linked.length))*Math.PI*2),...x}));
        graph=`<div class="graph-shell"><svg class="graph-svg" viewBox="0 0 550 420" role="img" aria-label="Connection diagram for ${safe(center.payload.title)}. Equivalent relationship list follows.">${coords.map(c=>`<line class="graph-line ${safe(c.relation.payload.kind.toLowerCase())}" x1="275" y1="210" x2="${c.x}" y2="${c.y}"/>`).join('')}${coords.map(c=>`<g class="graph-node" data-case-node="${c.case.id}" role="button" tabindex="0" aria-label="Explore ${safe(c.case.payload.title)}"><circle cx="${c.x}" cy="${c.y}" r="49"/><text x="${c.x}" y="${c.y+4}" text-anchor="middle">${safe(short(c.case.payload.title,16))}</text></g>`).join('')}<g><circle cx="275" cy="210" r="58" fill="var(--accent-dark)" stroke="var(--accent)" stroke-width="3"/><text x="275" y="214" text-anchor="middle" fill="var(--ink)" font-size="14" font-weight="800">${safe(short(center.payload.title,19))}</text></g></svg></div>`;
    }
    return `${pageHeader('FOLLOW THE THREAD','Connections','Connections have explicit meanings. Documented, claimed, disputed and thematic relationships are never interchangeable.',button('newRelation','＋ Link Cases','btn btn-gold')+button('goSubjects','Browse subjects →','btn'))}
        <div class="toolbar"><select class="input" data-filter="connectionCase" aria-label="Focus case"><option value="">Select case…</option>${cases.map(c=>`<option value="${c.id}" ${center?.id===c.id?'selected':''}>${safe(c.payload.title)}</option>`).join('')}</select><select class="input" data-filter="relation" aria-label="Filter relationship">${selectOptions(['All',...RELATION_TYPES],state.relationFilter)}</select></div>
        ${center?`<div class="split"><section class="panel"><div class="panel-head"><h2>${safe(center.payload.title)}</h2><span class="badge">Focused view</span></div>${graph}<p class="muted" style="margin-top:14px">Choose a linked node in the diagram or the accessible list. Relationships are not proof of an underlying theory.</p></section><section class="panel"><h2>Relationship records</h2>${visible.length?visible.map(r=>{const c=cases.find(x=>x.id===(r.payload.fromId===center.id?r.payload.toId:r.payload.fromId));return `<article class="case-item"><div class="item-main"><span class="badge">${safe(r.payload.kind)}</span><strong>${c?safe(c.payload.title):'Missing case'}</strong><small>${safe(r.payload.rationale)}</small></div><div class="actions">${c?button('focusCase','Focus','btn btn-small',`data-id="${c.id}"`):''}${button('editRecord','Edit','btn btn-small',`data-id="${r.id}"`)}</div></article>`;}).join(''):'<p class="muted">No recorded connections for this case. Add one and explain the relationship.</p>'}</section></div>`:empty('Connect your first investigations','Create at least two cases and add a clearly described relationship.','newCase','Create a Case')}`;
}
async function renderLibrary(rows){
    const bookmarks=rows.filter(r=>r.type==='case'&&r.payload.bookmarked),collections=rows.filter(r=>r.type==='collection'),notes=rows.filter(r=>r.type==='note'),journeys=rows.filter(r=>r.type==='journey');
    const tabs=[['bookmarks','Bookmarks'],['collections','Collections'],['journeys','Research Journeys'],['notes','Research Journal'],['recent','Recently Viewed'],['trash','Trash']];
    let content='';
    if(state.libraryTab==='bookmarks')content=bookmarks.length?`<div class="grid">${bookmarks.slice(0,state.libraryVisible).map(r=>recordCard(r)).join('')}</div>${bookmarks.length>state.libraryVisible?button('moreLibrary','Show more bookmarked cases','btn'):''}`:empty('No bookmarked cases','Use the Bookmark action in a Case File to save it here.');
    if(state.libraryTab==='collections')content=`<div class="actions" style="margin-bottom:16px">${button('newCollection','＋ New Collection','btn btn-gold')}</div>${collections.length?collections.map(r=>`<div class="card" style="margin-bottom:10px"><h3>${safe(r.payload.title)}</h3><p class="muted">${safe(r.payload.description||'Custom research collection')}</p><p>${(r.payload.itemIds||[]).map(id=>{const c=rows.find(x=>x.id===id&&x.type==='case');return c?`<span class="badge">${entry(c.id,c.payload.title)}</span>`:'';}).join(' ')||'<small>No cases added yet.</small>'}</p><div class="actions">${button('collectionItems','Manage Cases','btn btn-small',`data-id="${r.id}"`)}${itemActions(r)}</div></div>`).join(''):empty('No collections yet','Group bookmarks or cases without duplicating the originals.')}`;
    if(state.libraryTab==='journeys')content=`<div class="callout" style="margin-bottom:15px"><strong>Curated journeys</strong><p class="muted" style="margin:7px 0 0">Build your own intentional reading paths between existing cases. A journey is an editorial route, not proof that its subjects are causally related.</p></div><div class="actions" style="margin-bottom:16px">${button('newJourney','＋ New Journey','btn btn-gold')}</div>${journeys.length?journeys.map(r=>{const p=r.payload;const ids=p.itemIds||[];const done=p.completedIds||[];return `<section class="card journey-card"><div class="hstack between"><div><div class="kicker">GUIDED RESEARCH PATH</div><h3>${safe(p.title)}</h3></div><span class="badge">${ids.filter(id=>done.includes(id)).length}/${ids.length} visited</span></div><p class="muted">${safe(p.description||'No introductory notes yet.')}</p>${ids.length?`<ol class="journey-steps">${ids.map((caseId,index)=>{const c=rows.find(x=>x.id===caseId&&x.type==='case');return `<li><div class="journey-step"><div class="item-main">${c?entry(c.id,c.payload.title):'<span class="warning-text">Unavailable case</span>'}<small>${c?safe(short(c.payload.centralQuestion||c.payload.summary||'',100)):'This case may be in Trash or missing.'}</small></div><label class="journey-check"><input type="checkbox" data-action="journeyStep" data-id="${r.id}" data-case="${caseId}" ${done.includes(caseId)?'checked':''}> Read</label></div></li>`;}).join('')}</ol>`:'<p class="muted">Add cases to create an ordered reading journey.</p>'}<div class="card-foot"><small>Choose cases in the intended order.</small><div class="actions">${button('manageJourney','Choose / reorder cases','btn btn-small',`data-id="${r.id}"`)}${itemActions(r)}</div></div></section>`;}).join(''):empty('No journeys yet','Curate a path connecting several investigations without duplicating their research records.')}`;
    if(state.libraryTab==='notes')content=notes.length?notes.slice(0,state.libraryVisible).map(r=>`<article class="card" style="margin-bottom:10px"><h3>${safe(r.payload.title)}</h3><p class="muted">${safe(short(r.payload.content,350))}</p><div class="card-foot"><small>${stamp(r.modifiedAt)}</small>${itemActions(r)}</div></article>`).join('')+(notes.length>state.libraryVisible?button('moreLibrary','Show more notes','btn'):''):empty('No research notes','Capture a Notebook entry anywhere in the app.');
    if(state.libraryTab==='recent')content=`<p class="muted">Your most recently viewed case appears on the Research Desk.</p>${button('goDesk','Return to Research Desk','btn')}`;
    if(state.libraryTab==='trash') {
        const deleted=(await allRecords(true)).filter(r=>r.deleted);
        content=deleted.length?deleted.slice(0,state.libraryVisible).map(r=>`<div class="case-item"><div class="item-main"><strong>${safe(r.payload.title||r.type)}</strong><small>${safe(r.type)} · moved to trash</small></div>${button('restoreRecord','Restore','btn btn-small',`data-id="${r.id}"`)}</div>`).join('')+(deleted.length>state.libraryVisible?button('moreLibrary','Show more trashed records','btn'):''):empty('Trash is empty','Deleted research records appear here until restored.');
    }
    return `${pageHeader('YOUR PERSONAL COLLECTION','My Library','Bookmarked investigations, collections, private notes, and recently explored research.',button('newNote','✎ New Notebook Entry','btn btn-gold'))}<div class="tabs">${tabs.map(([id,label])=>`<button class="tab ${state.libraryTab===id?'active':''}" data-action="libraryTab" data-tab="${id}">${label}</button>`).join('')}</div>${content}`;
}

// ============================================================================
// [JS-06] SETTINGS, PC FILE CUSTODY, BACKUP AND OPTIONAL SYNC
// ============================================================================
async function renderSettings(rows){
    const theme=await getMeta('theme')||'archive';
    const read=await getMeta('font_size')||'normal';
    const desktopFileControls=!/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
    const pending=(await allRecords(true)).filter(r=>r.pending).length;
    const conflicts=await allConflicts();
    const brokenReferences=auditReferences(rows);
    const last=await getMeta('last_sync');
    const persistenceProbe=await getMeta('local_persistence_probe');
    const recovery=summarizeRecovery(rows,pending,conflicts.length,brokenReferences.length);
    return `${pageHeader('PERSONAL CONTROL PANEL','Settings','Manage appearance, local source-file references, independent exports, and optional strictly-free research sync.')}
    <div class="split"><div class="vstack"><section class="panel"><h2>Appearance & Reading</h2><div class="form-grid"><label class="field">Color theme<select class="input" data-setting="theme">${selectOptions(['archive','slate','midnight','forest','paper'],theme)}</select></label><label class="field">Reading text size<select class="input" data-setting="font_size">${selectOptions(['small','normal','large'],read)}</select></label></div><p class="muted" style="margin-top:14px">Themes change presentation only; evidence classifications keep the same meanings.</p></section>
    <section class="panel recovery-center"><div class="panel-head"><h2>Recovery readiness</h2><span class="badge ${recovery.warning?'warn':''}">Guidance, not verification</span></div>
    <p class="muted">A cloud account and one PC hard drive are not independent backups. This summary has not checked a second drive.</p>
    <div class="recovery-stat-grid">
        <div><strong>${recovery.researchRecords}</strong><small>Active research records</small></div>
        <div><strong>${recovery.pcSourceFiles}</strong><small>PC-only source files referenced</small></div>
        <div><strong>${recovery.awaitingSync}</strong><small>Changes awaiting sync</small></div>
        <div><strong>${recovery.unresolvedConflicts}</strong><small>Unresolved sync conflicts</small></div>
    </div>
    ${recovery.brokenReferences?`<p class="warning-text">${recovery.brokenReferences} missing research relationship(s) need review.</p>`:''}
    <p class="muted">${safe(recovery.caveat)}</p>
    <div class="actions">${button('recoveryGuide','View Recovery Guide','btn btn-gold')}${button('downloadRecoveryChecklist','Download Checklist','btn')}</div></section>
    <section class="panel"><h2>Backup & Restore</h2><p class="muted">Export metadata JSON, make a small ZIP (up to 120 MB), or write a streaming directory backup for larger source-file collections. Directory backups copy and verify eligible PC-linked files without cloud uploads. Choose a separate physical drive for disaster recovery; not all missing originals can be backed up.</p><div class="actions">${button('exportData','Download Metadata Backup','btn btn-gold')}${button('importData','Import & Merge Metadata','btn')}${desktopFileControls?button('fullBackup','Small Archive ZIP (120 MB max)','btn')+button('directoryBackup','Large Archive Folder Backup','btn btn-gold')+button('directoryResume','Resume Interrupted Backup','btn')+button('directoryRestore','Verify / Restore Folder Backup','btn'):''}${desktopFileControls?button('directoryRestoreResume','Resume Interrupted Restore','btn'):''}${button('importZip','Restore ZIP Archive','btn')}${desktopFileControls?button('auditFiles','Check PC File Links','btn')+button('exportFileInventory','Export File Inventory','btn'):''}</div><div class="sep"></div><p><strong>PC-only research documents</strong></p><p class="muted">Link existing sources in the Case File. Files remain where you keep them and are never copied to the sync server. If a file can't be reopened, use Relink PC file.</p></section>
    <section class="panel"><h2>Archive Integrity</h2><p class="muted">This local consistency scan checks references between available records. It does not verify original file bytes on your PC.</p><p><strong>${brokenReferences.length}</strong> missing or trashed relationship target(s).</p>${brokenReferences.length?`<details><summary>View details</summary>${brokenReferences.slice(0,40).map(issue=>`<p class="muted">${safe(issue.type)} · ${safe(issue.field)} · ${safe(issue.targetId.slice(0,8))}</p>`).join('')}</details>`:'<p class="muted">No broken research references detected.</p>'}</section>
    <section class="panel"><h2>Local Persistence Check</h2><p class="muted">This is a non-destructive, manual restart check. It stores only a random test marker in this browser profile. No cloud connection or source file is needed.</p>
    <div class="callout">${persistenceProbe ? `A test marker exists from ${safe(persistenceProbe.startedAt||'an earlier session')}. ${persistenceProbe.session===SESSION_CHECK_ID?'Close and reopen the app before verifying.':'You can now check whether the marker survived a reload or browser restart.'}` : 'No persistence test is pending.'}</div>
    <div class="actions">${button('startPersistenceCheck','1. Save Test Marker','btn')}${button('verifyPersistenceCheck','2. Verify After Restart','btn btn-gold')}</div><small>Passing this check proves one marker survived a reload in this browser profile. It does not prove cloud sync, source-file permissions or long-term device storage guarantees.</small></section>
    <section class="panel"><h2>Cloud Sync (Optional)</h2><div class="callout"><strong>Local-first by default.</strong><br><span class="muted">Supabase Free is not bundled or activated. You can work offline without an account. You must provision a strictly free project yourself to enable PC/phone synchronization.</span></div>
    <div class="sep"></div>${cloud.config?`<p>Configured project: <code>${safe(cloud.config.url)}</code></p>`:'<p class="muted">No cloud project configured.</p>'}
    ${cloud.session?`<p><span class="badge success">Signed in</span> ${safe(cloud.session.email||'Private account')}</p>`:'<p><span class="badge warn">Not connected</span></p>'}
    <p class="muted">Pending local edits: <strong>${pending}</strong> · Unresolved conflicts: <strong>${conflicts.length}</strong> · Last sync: <strong>${last?stamp(last):'Never'}</strong></p>
    <div class="actions">${button('configureCloud','Configure Free Cloud','btn')}${cloud.config&&!cloud.session?button('signIn','Sign in / Register','btn'):''}${cloud.config&&cloud.session?button('syncNow','↻ Sync Now','btn btn-gold')+button('signOut','Sign Out','btn'):''}</div>
    ${conflicts.length?`<div class="sep"></div><h3>Conflicts requiring review</h3>${conflicts.map(c=>`<div class="case-item"><div class="item-main"><strong>${safe(c.local.payload.title||c.local.type)}</strong><small>Both versions saved</small></div>${button('reviewConflict','Compare','btn btn-small',`data-id="${c.id}"`)}</div>`).join('')}`:''}
    <div class="sep"></div><small>Optional cloud sync includes case stories, note contents (even notes marked Private), source filenames, and other permitted research metadata. Original PDFs/images/file bytes, file handles, and PC paths are not sent. Hosted text is not end-to-end encrypted. Keep highly sensitive text offline if you do not want it hosted.</small></section></div>
    <div class="vstack"><section class="panel"><div class="kicker">ARCHIVE INFORMATION</div><h2>Research Archive <span class="badge">${VERSION}</span></h2><p class="muted">Development build · not validated on physical iPhone/Android devices</p><div class="sep"></div><p><strong>${rows.filter(r=>r.type==='case').length}</strong> cases</p><p><strong>${rows.filter(r=>r.type==='source').length}</strong> source records</p><p><strong>${rows.filter(r=>r.type==='note').length}</strong> private notes</p></section><section class="panel"><div class="kicker">MOBILE INSTALLATION</div><h3>iPhone</h3><p class="muted">Open the hosted HTTPS version in Safari, select Share, then Add to Home Screen.</p><h3>Android</h3><p class="muted">Open the hosted HTTPS version in Chrome and choose Install app or Add to Home Screen when offered.</p><div class="sep"></div><small>Local file previews require a supported desktop browser and user permission. iPhone/Android only receive file references.</small></section><section class="panel"><div class="kicker">PRIVACY</div><p class="muted">Anyone with access to this device's browser profile may be able to access locally cached research. Sign-out alone does not erase it. Don't use shared devices for sensitive private notes.</p></section></div></div>`;
}

// ============================================================================
// [JS-07] RECORD EDITORS AND INTERACTIVE ACTIONS
// ============================================================================
// ----- Source citation picker (touch, keyboard and desktop) -----------------
function pickerFieldHtml(field,label) {
    const searchId='citation-search-'+field;
    return `<fieldset class="source-picker field span-2" data-source-field="${safe(field)}">
        <legend>${safe(label)}</legend>
        <label class="source-search-label" for="${safe(searchId)}">Find source by title, author, date, or locator</label>
        <input class="input" id="${safe(searchId)}" data-source-search="${safe(field)}" type="search" autocomplete="off" placeholder="Search saved sources…">
        <div class="source-picker-count" data-source-count="${safe(field)}" aria-live="polite"></div>
        <div class="source-picker-options" data-source-options="${safe(field)}"></div>
        <div class="actions source-picker-more" data-source-more="${safe(field)}"></div>
        <small>Tap or click a checkbox to select a citation. Chosen sources stay selected when you search.</small>
    </fieldset>`;
}
function updateSourcePickerField(field) {
    const session=sourcePickerSession;
    const picker=document.querySelector(`[data-source-field="${field}"]`);
    if (!session || !picker || !session.selections.has(field)) return;
    const result=sourcePickerResults(session.sources,{
        field,caseId:session.caseId,excludedId:session.recordId,
        selectedIds:[...session.selections.get(field)],
        query:session.queries.get(field)||'',limit:session.limits.get(field)||24
    });
    picker.querySelector('[data-source-count]').textContent=`${result.selectedCount} selected · ${result.matchCount} matching available sources`;
    picker.querySelector('[data-source-options]').innerHTML=result.items.length ? result.items.map(item=>{
        const title=item.row?.payload?.title||'Missing source record';
        const context=[item.row?.payload?.author,item.row?.payload?.date].filter(Boolean).join(' · ');
        const warning=item.unavailable?'Missing or deleted':item.outsideCase?'Outside this case':' ';
        return `<label class="source-picker-choice ${item.selected?'selected':''}">
            <input type="checkbox" data-source-choice="${safe(field)}" value="${safe(item.id)}" ${item.selected?'checked':''}>
            <span class="source-picker-description"><strong>${safe(short(title,115))}</strong>
            <small>${safe(warning.trim()||context||'Saved source')}</small></span>
        </label>`;
    }).join(''):'<p class="muted">No matching sources. Add a source from the Case File first.</p>';
    picker.querySelector('[data-source-more]').innerHTML=result.hasMore ? button('moreSourceCandidates',
        `Show ${Math.min(24,result.matchCount-result.shownMatches)} more source${result.matchCount-result.shownMatches===1?'':'s'}`,
        'btn btn-small',`data-field="${safe(field)}"`) : '';
}
function refreshSourcePickerFields() {
    if (!sourcePickerSession) return;
    for (const field of sourcePickerSession.selections.keys()) updateSourcePickerField(field);
}

async function editRecord(type,id=null,preset={}){
    const existing=id?await getRecord(id):null;
    if(!type)type=existing?.type;
    if(!FIELD_DEFINITIONS[type]){notify('Editor not available for this record type');return;}
    const cases=await listRecords('case');
    const sources=await listRecords('source');
    const claimsForEditor=await listRecords('claim');
    const allForBoard=await allRecords();
    const p={...preset,...(existing?.payload||{})};
    sourcePickerSession={sources,recordId:id||'',caseId:p.caseId||'',selections:new Map(),queries:new Map(),limits:new Map()};
    const fields=FIELD_DEFINITIONS[type].map(([name,label,kind,required,options])=>{
        const value=p[name]??(kind==='select'?options?.[0]||'':kind==='cases'?'': '');
        const attr=`name="${name}" ${required?'required':''}`;
        let input='';
        if(kind==='claims') {
            input=`<select class="input" ${attr}><option value="">No specific claim selected</option>${claimsForEditor.filter(c=>!p.caseId||c.payload.caseId===p.caseId).map(c=>`<option value="${c.id}" ${c.id===value?'selected':''}>${safe(short(c.payload.text,110))}</option>`).join('')}</select>`;
        }
        else if(kind==='board_nodes'){
            const available=boardNodes(allForBoard,p.caseId);
            input=`<select class="input" ${attr}><option value="">Choose a research record</option>${available.map(r=>`<option value="${safe(r.id)}" ${r.id===value?'selected':''}>${safe(r.type.toUpperCase()+' · '+short(boardTitle(r),90))}</option>`).join('')}</select><span class="field-hint">Only records from this case can be connected.</span>`;
        }
        else if(kind==='case_links'){
            const selected=new Set(Array.isArray(value)?value:[]);
            input=`<div class="entity-case-options" role="group" aria-label="Explicitly link cases to this entity">${cases.length?cases.map(row=>`<label class="entity-case-choice"><input type="checkbox" name="caseIds" value="${safe(row.id)}" ${selected.has(row.id)?'checked':''}><span>${safe(short(row.payload.title,105))}</span></label>`).join(''):'<p class="muted">Create a Case File before linking a subject to it.</p>'}</div><span class="field-hint">Only selected cases are linked. A shared entity is not proof of causation or corroboration.</span>`;
        }
        else if(kind==='sources'){
            sourcePickerSession.selections.set(name,new Set(Array.isArray(value)?value:[]));
            return pickerFieldHtml(name,label);
        }
        else if(kind==='select')input=`<select class="input" ${attr}>${selectOptions(options,value)}</select>`;
        else if(kind==='cases')input=`<select class="input" ${attr}><option value="">No case selected</option>${cases.map(r=>`<option value="${r.id}" ${r.id===value?'selected':''}>${safe(r.payload.title)}</option>`).join('')}</select>`;
        else if(kind==='textarea'||kind==='largearea')input=`<textarea class="input" ${attr} style="min-height:${kind==='largearea'?'225px':'100px'}">${safe(Array.isArray(value)?value.join(', '):value)}</textarea>`;
        else input=`<input class="input" ${attr} type="${kind}" value="${safe(Array.isArray(value)?value.join(', '):value)}">`;
        return `<label class="field ${kind==='textarea'||kind==='largearea'?'span-2':''}">${label}${input}</label>`;
    }).join('');
    const extras=type==='case'?'<p class="muted">Guided case structure: Quick Overview, Full Story, individual claims, sources, timeline, notes, and related investigations. The full case remains private by default.</p>':type==='source'?'<p class="muted">You can attach a PC-only file after saving this source. File bytes never enter cloud synchronization.</p>':'';
    openModal((id?'Edit ':'New ')+type.charAt(0).toUpperCase()+type.slice(1),`${extras}<form id="record-form" data-kind="${type}" data-id="${id||''}"><div class="form-grid">${fields}</div>${type==='case'&&!id?'<label class="case-item"><input type="checkbox" name="starterTasks" checked> Add a starter research checklist appropriate to the case category</label>':''}<div class="modal-actions">${button('closeModal','Cancel','btn') }<button class="btn btn-gold" type="submit">${id?'Save changes':'Create '+type}</button></div></form>`);
    refreshSourcePickerFields();
}
async function saveForm(form){
    const type=form.dataset.kind;
    const id=form.dataset.id||null;
    const old=id?await getRecord(id):null;
    const fd=new FormData(form);
    const payload={...(old?.payload||{})};
    for(const [name] of FIELD_DEFINITIONS[type]) {
        if(name==='caseIds' && type==='entity'){
            payload[name]=[...new Set(fd.getAll('caseIds').map(String))];
            continue;
        }
        if(sourcePickerSession?.selections.has(name)) {
            payload[name]=[...sourcePickerSession.selections.get(name)];
            continue;
        }
        const val=String(fd.get(name)||'').trim();
        payload[name]=['tags','aliases'].includes(name)?val.split(',').map(s=>s.trim()).filter(Boolean):val;
    }
    if(type==='entity'){
        const validation=validateEntity(payload,await allRecords(),id);
        payload.caseIds=validation.caseIds;
        if(validation.duplicateIds.length && !confirm('An entity of this type already has this exact name. Keep a separate record instead of editing the existing one?'))return;
    }
    if(type==='source'){
        payload.localOnly=true;
        if(payload.derivedFromIds?.includes(id))throw Error('A source cannot cite itself as its origin');
        const existingSources=await listRecords('source');
        const graph=new Map(existingSources.filter(s=>s.id!==id).map(s=>[s.id,s.payload.derivedFromIds||[]]));
        if(id)graph.set(id,payload.derivedFromIds||[]);
        const visit=(node,seen=new Set())=>{if(node===id)return true;if(seen.has(node))return false;seen.add(node);return (graph.get(node)||[]).some(next=>visit(next,seen));};
        if(id&&(payload.derivedFromIds||[]).some(source=>visit(source)))throw Error('This source dependency would create a circular citation.');
    }
    if(type==='board_link')validateBoardLink(payload,await allRecords(),id);
    if(type==='case'){
        payload.sample=false;
        // A substantive case edit invalidates a prior sign-off. Review must be
        // explicitly completed again from the Editorial Review tab.
        if(payload.status==='Reviewed')payload.status='Ready for review';
    }
    if(type==='task'){
        payload.done=old?.payload.done||false;
        if(!TASK_PRIORITIES.includes(payload.priority))throw Error('Choose a supported task priority.');
        if(!validCalendarDay(payload.dueOn))throw Error('Enter a valid target date or leave it blank.');
    }
    if(type==='question' && payload.status==='Answered' && !payload.answer?.trim())throw Error('Add an evidence-based answer before marking this question Answered.');
    if(type==='journey'){payload.itemIds=old?.payload.itemIds||[];payload.completedIds=old?.payload.completedIds||[];}
    if(type==='relation'&&payload.fromId===payload.toId)throw Error('Choose two different cases to connect');
    if(type==='source'&&payload.url&&!formatURL(payload.url))throw Error('Source URL must begin with https:// or http://');
    if(type==='discovery'&&payload.kind==='Link'&&payload.value&&!formatURL(payload.value))throw Error('A link discovery must use an http:// or https:// URL');
    if(type==='case'&&!id){const all=await listRecords('case');if(all.some(x=>x.payload.title.toLowerCase()===payload.title.toLowerCase())){if(!confirm('Another case with this exact title exists. Create a separate case anyway?'))return;}}
    const result=await saveRecord(type,payload,id);
    if(type==='case'&&!id&&fd.has('starterTasks')){
        for(const title of STARTER_TASKS[payload.category]||[]){
            await saveRecord('task',{caseId:result.id,title,done:false,priority:'Routine',dueOn:''});
        }
    }
    closeModal();
    notify((id?'Updated ':'Created ')+type+' locally');
    if(type==='entity' && state.page!=='case')state.page='subjects';
    if(type==='case'){state.caseId=result.id;state.boardSelected='';state.page='case';state.caseTab='story';await setMeta('recent_case',result.id);}
    render();
    scheduleAutoSync();
}
async function quickCapture(note=false,caseId=''){
    if(note){await editRecord('note',null,{caseId,title:'Research note'});return;}
    await editRecord('discovery',null,{status:'Inbox',kind:'Link',caseId});
}
async function attachFile(id){
    if (/Android|iPhone|iPad|iPod/i.test(navigator.userAgent)) { notify('Original source files are PC-only. Add file references from your Windows computer.'); return; }
    const source=await getRecord(id);
    if(!source||source.type!=='source')return;
    let file,handle=null;
    if(window.showOpenFilePicker){
        try{const handles=await window.showOpenFilePicker({multiple:false});handle=handles[0];file=await handle.getFile();}
        catch(e){if(e.name==='AbortError')return;}
    }
    if(!file){
        file=await new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.onchange=()=>resolve(input.files?.[0]||null);input.click();});
        if(!file)return;
    }
    // File bytes are neither persisted in IndexedDB nor transmitted to cloud.
    const p={...source.payload,filename:file.name,filesize:file.size,filetype:file.type||'unknown',fileStatus:handle?'linked-local':'reselect',localOnly:true};
    if(handle)await setHandle(id,handle);
    await saveRecord('source',p,id);
    notify(handle?'PC file linked. Original unchanged.':'File metadata saved. You must reselect this file to open it later.');
    render();
}
async function openPCFile(id){
    let handle=await getHandle(id);
    if(!handle){notify('This file is only available on its PC. Relink it to open here.');return;}
    try {
        let permission=await handle.queryPermission({mode:'read'});
        if(permission!=='granted')permission=await handle.requestPermission({mode:'read'});
        if(permission!=='granted')throw Error('File permission is not granted');
        const file=await handle.getFile();
        const url=URL.createObjectURL(file);
        window.open(url,'_blank','noopener');
        setTimeout(()=>URL.revokeObjectURL(url),120000);
    } catch(e){notify('File unavailable or permission expired: '+e.message);}
}
async function importMetadata(){
    const file=await new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.accept='.json,application/json';input.onchange=()=>resolve(input.files?.[0]||null);input.click();});
    if(!file)return;
    try{
        if(file.size>20*1024*1024)throw Error('Metadata file is too large for this importer (20 MB maximum)');
        const data=JSON.parse(await file.text());
        if(data.format!=='p8core-research-metadata'||data.formatVersion!==1||!Array.isArray(data.records))throw Error('Unsupported metadata archive');
        const existing=await allRecords(true);const unique=data.records.filter(r=>!existing.some(e=>e.id===r.id)).length;
        if(!confirm(`This import contains ${data.records.length} records; approximately ${unique} new IDs. Existing IDs will be SKIPPED, never overwritten. No PC source files are included. Continue?`))return;
        const outcome=await importRecords(data.records);
        notify(`Imported ${outcome.added} records; skipped ${outcome.skipped} existing IDs.`);
        render();
    }catch(e){notify('Import failed: '+e.message);}
}
async function configureCloud(){
    openModal('Configure Supabase Free',`<div class="callout"><strong>No billing-enabled plans or file uploads.</strong><p>First provision your own Supabase Free project, apply <code>supabase/schema.sql</code> in its SQL editor, and enable email/password authentication. This app never provisions a service automatically.</p><p class="muted">The public anon/publishable project key is not a service-role secret. Never enter your service-role key here.</p></div><form id="cloud-config"><div class="form-grid"><label class="field span-2">Project URL<input class="input" name="url" type="url" required placeholder="https://yourproject.supabase.co" value="${safe(cloud.config?.url||'')}"></label><label class="field span-2">Public anon / publishable key<input class="input" name="key" required autocomplete="off" value="${safe(cloud.config?.key||'')}"></label></div><div class="modal-actions">${button('closeModal','Cancel','btn')}<button class="btn btn-gold" type="submit">Save configuration</button></div></form>`);
}
async function signinModal(){
    openModal('Private Cloud Account',`<p class="muted">Sign in with an account you created in your own strictly free Supabase project. Signup may require email confirmation. Your local work remains available without sign-in.</p><form id="auth-form"><div class="form-grid"><label class="field span-2">Email<input class="input" required type="email" name="email" autocomplete="username"></label><label class="field span-2">Password<input class="input" required type="password" name="password" autocomplete="current-password" minlength="6"></label></div><div class="modal-actions">${button('closeModal','Cancel','btn')}<button class="btn" type="submit" name="mode" value="signup">Create Account</button><button class="btn btn-gold" type="submit" name="mode" value="signin">Sign In</button></div></form>`);
}
async function conflictModal(id){
    const conflict=(await allConflicts()).find(c=>c.id===id);
    if(!conflict)return;
    const current=await getRecord(id);
    if(!current?.conflict)return notify('Conflict state changed. Reopen cloud review.');
    // Show the latest local revision, not the stale snapshot taken at detection.
    // Buttons carry the displayed mutation and remote revision as freshness guards.
    const local=JSON.stringify(current.payload,null,2),remote=JSON.stringify(conflict.remote.payload,null,2);
    const guard=`data-id="${safe(id)}" data-mutation="${safe(current.mutationId)}" data-remote-revision="${conflict.remote.revision}"`;
    openModal('Review Conflicting Edits',`<p class="warning-text">Both versions are preserved. Choose carefully: the selected version becomes the candidate for the next sync. No silent overwrites.</p><div class="grid two"><div><h3>This device (latest saved)</h3><pre class="callout" style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:.72rem;max-height:220px;overflow:auto">${safe(local)}</pre></div><div><h3>Cloud version</h3><pre class="callout" style="white-space:pre-wrap;overflow-wrap:anywhere;font-size:.72rem;max-height:220px;overflow:auto">${safe(remote)}</pre></div></div><div class="modal-actions">${button('closeModal','Keep unresolved','btn')}${button('chooseConflict','Keep cloud version','btn',`${guard} data-choice="remote"`)}${button('chooseConflict','Keep this device version','btn btn-gold',`${guard} data-choice="local"`)}</div>`);
}
async function manageCollection(id){
    const col=await getRecord(id),cases=await listRecords('case');
    if(!col)return;
    openModal('Manage collection: '+col.payload.title,`<form id="collection-form" data-id="${id}"><p class="muted">Choose which existing cases belong to this collection. No case is duplicated.</p><div class="vstack">${cases.map(c=>`<label class="case-item"><span class="item-main"><strong>${safe(c.payload.title)}</strong></span><input type="checkbox" name="case" value="${c.id}" ${(col.payload.itemIds||[]).includes(c.id)?'checked':''}></label>`).join('')||'<p>No cases yet.</p>'}</div><div class="modal-actions">${button('closeModal','Cancel','btn')}<button class="btn btn-gold" type="submit">Save collection</button></div></form>`);
}
async function manageJourney(id){
    const journey=await getRecord(id);if(!journey||journey.type!=='journey')return;
    const cases=await listRecords('case'),ids=journey.payload.itemIds||[];
    openModal('Build journey: '+journey.payload.title,`<p class="muted">Choose cases to include, then use the order controls. These are links to the original Case Files, not duplicate cases.</p><form id="journey-form" data-id="${id}"><div class="vstack">${cases.map(c=>`<label class="case-item"><span class="item-main"><strong>${safe(c.payload.title)}</strong></span><input name="case" type="checkbox" value="${c.id}" ${ids.includes(c.id)?'checked':''}></label>`).join('')||'<p>No cases yet. Create a Case File first.</p>'}</div><div class="modal-actions"><button type="submit" class="btn btn-gold">Save selected cases</button></div></form>${ids.length?`<div class="sep"></div><h3>Current reading order</h3><ol class="journey-steps">${ids.map((caseId,i)=>{const c=cases.find(x=>x.id===caseId);return `<li class="journey-sort"><span>${safe(c?.payload.title||'Unavailable case')}</span><div class="actions">${button('journeyShift','↑','btn btn-small',`aria-label="Move step earlier" data-id="${id}" data-case="${caseId}" data-shift="-1" ${i===0?'disabled':''}`)}${button('journeyShift','↓','btn btn-small',`aria-label="Move step later" data-id="${id}" data-case="${caseId}" data-shift="1" ${i===ids.length-1?'disabled':''}`)}</div></li>`;}).join('')}</ol>`:''}`);
}
function openSourceIntake(caseId, draft='') {
    sourceIntakeSession=null;
    openModal('Paste source links',`<p class="muted">Enter up to 20 sources, one per line: <strong>Source title | https://example.org/page</strong>. Only the title and URL are copied into new source records. Other details must be recorded by you after capture. No sites are fetched, checked or automatically cited.</p>
        <form id="source-intake-form" data-case="${safe(caseId)}">
            <label class="field">Titled source links<textarea class="input" name="sourceLines" rows="9" maxlength="16000" required placeholder="Original report | https://example.org/report">${safe(draft)}</textarea></label>
            <p class="muted">Existing identical links are shown as duplicates and will not be re-created. Already-recorded sources in other cases are not automatically reassigned.</p>
            <div class="modal-actions">${button('closeModal','Cancel','btn')}<button class="btn btn-gold" type="submit">Review links</button></div>
        </form>`);
}

async function previewSourceIntake(form) {
    const caseId=form.dataset.case;
    const parent=await getRecord(caseId);
    if (!parent || parent.deleted || parent.type!=='case') throw Error('The selected Case File is unavailable.');
    const raw=String(new FormData(form).get('sourceLines')||'');
    const preview=prepareSourceIntake(raw,await allRecords(true),caseId);
    sourceIntakeSession={raw,caseId,expected:preview.accepted.map(({title,url})=>({title,url}))};
    const listing=(items,label)=>items.length?`<h3>${label} (${items.length})</h3><div class="vstack">${items.map(item=>`<div class="case-item"><span class="item-main"><strong>Line ${item.line}: ${safe(item.title||'Invalid entry')}</strong><small style="overflow-wrap:anywhere">${safe(item.url||item.message||'')}</small>${item.reason?`<small>${safe(item.reason)}${item.existingTitle?': '+safe(item.existingTitle):''}</small>`:''}</span></div>`).join('')}</div>`:'';
    openModal('Review source intake',`<p class="muted">Review the exact links before any record is written. No website content, author, date or independence has been verified. Each new source begins with incomplete provenance.</p>
        ${listing(preview.errors,'Fix invalid lines')}${listing(preview.duplicates,'Skipped duplicates')}${listing(preview.accepted,'New source records')}
        ${preview.errors.length?'<p class="warning-text">Nothing can be saved until all invalid lines are corrected.</p>':''}
        <p class="muted">${preview.accepted.length} new link(s), ${preview.duplicates.length} duplicate(s), ${preview.errors.length} invalid line(s).</p>
        <div class="modal-actions">${button('editSourceIntake','Edit lines','btn')}${button('closeModal','Cancel','btn')}${preview.accepted.length&&!preview.errors.length?button('commitSourceIntake',`Save ${preview.accepted.length} source(s) locally`,'btn btn-gold'):''}</div>`);
}

async function commitSourceIntake() {
    const session=sourceIntakeSession;
    if (!session?.expected?.length) throw Error('The source review is no longer available. Start again.');
    const parent=await getRecord(session.caseId);
    if (!parent || parent.type!=='case' || parent.deleted) throw Error('Case File unavailable. No sources were saved.');
    const fresh=prepareSourceIntake(session.raw,await allRecords(true),session.caseId);
    if (fresh.errors.length || fresh.accepted.length!==session.expected.length ||
        fresh.accepted.some((item,i)=>item.title!==session.expected[i].title || item.url!==session.expected[i].url)) {
        throw Error('Sources changed since preview. Start again to review duplicates before saving.');
    }
    // One IDB transaction, not multiple saveRecord calls. No partial batch
    // when validation or a storage write fails. No existing rows overwritten.
    const rows=fresh.accepted.map(item=>({id:crypto.randomUUID(),type:'source',payload:{
        caseId:session.caseId,title:item.title,url:item.url,sourceType:'Other',
        author:'',date:'',citationLocator:'',details:'',provenanceRole:'Unclassified',
        independence:'Not assessed',derivedFromIds:[],localOnly:true
    }}));
    const result=await importRecords(rows);
    if (result.added!==rows.length || result.skipped) throw Error('Unexpected source import result. Inspect existing source records.');
    closeModal();
    notify(`${result.added} source link(s) saved. Complete provenance details before relying on them.`);
    if (state.page==='case'&&state.caseId===session.caseId){state.caseTab='sources';state.caseItemsVisible=40;}
    await render();scheduleAutoSync();
}

async function inspectSource(id){
    const rows=await allRecords();
    let report;
    try { report=traceSourceOrigins(rows,id); }
    catch(e){return notify(e.message);}
    const {source, sources, direct, citing, branches, cycles, missing, truncated, rootIds}=report;
    const uses=sourceClaimUses(rows,id);
    const p=source.payload;
    const named=sourceId=>sources.get(sourceId);
    const group=(records,none)=>records.length?`<div class="vstack">${records.map(x=>`<div class="case-item"><div class="item-main"><strong>${safe(x.payload.title)}</strong><small>${safe(x.payload.author||'Author not recorded')} · ${safe(x.payload.date||'Date not recorded')}</small></div>${button('inspectSource','Trace','btn btn-small',`data-id="${x.id}"`)}</div>`).join('')}</div>`:`<p class="muted">${safe(none)}</p>`;
    const branchText=branches.map(branch=>`<li>${branch.ids.map(sourceId=>{
        const record=named(sourceId);
        return record?button('inspectSource',safe(short(record.payload.title||'Untitled source',55)),'btn btn-small',`data-id="${record.id}"`):`<span class="warning-text">Missing ${safe(sourceId.slice(0,8))}</span>`;
    }).join(' <span aria-hidden="true">←</span> ')}${branch.issue?` <span class="badge warn">${safe(branch.issue)}</span>`:''}</li>`).join('');
    openModal('Source Origin Inspector',`<div class="kicker">RECORDED SOURCE LINEAGE</div><h3>${safe(p.title)}</h3><p>${safe(p.details||'No provenance information entered.')}</p><div class="chips"><span class="badge">${safe(p.provenanceRole||'Unclassified')}</span><span class="badge">${safe(p.independence||'Not assessed')}</span></div><p class="muted">Locator: ${safe(p.citationLocator||'No page or timestamp provided')}</p><div class="sep"></div><h3>Directly cited or derived sources</h3>${group(direct,'No dependencies have been recorded. This does not establish an independent origin.')}<div class="sep"></div><h3>Source lineage, up to eight steps</h3>${branches.length?`<ol class="source-paths">${branchText}</ol>`:'<p class="muted">No lineage recorded.</p>'}<p class="muted">${rootIds.length} recorded root source(s) · ${report.ancestorCount} unique upstream references. Roots do not prove independent evidence.</p>${cycles.length?`<p class="warning-text">${cycles.length} citation cycle(s) recorded. Review these links for errors.</p>`:''}${missing.length?`<p class="warning-text">${missing.length} linked source(s) are missing or in Trash.</p>`:''}${truncated?'<p class="warning-text">The analysis reached a safety limit. Only part of the trail is shown.</p>':''}<div class="sep"></div><h3>Later sources that cite this one</h3>${group(citing,'No downstream reference has been recorded.')}<div class="sep"></div><h3>Claims using this source</h3>${uses.length?uses.slice(0,40).map(usage=>`<div class="case-item"><div class="item-main"><strong>${safe(short(usage.claim.payload.text,125))}</strong><small>${safe(usage.roles.join(' / '))}</small></div>${button('goClaim','Open claim','btn btn-small',`data-id="${usage.claim.id}"`)}</div>`).join(''):'<p class="muted">No claims cite this source yet.</p>'}<div class="sep"></div><p class="muted">${safe(report.note)}</p><div class="modal-actions">${button('closeModal','Close inspector','btn')}</div>`);
}

async function fileDiscovery(id){
    const discovery=await getRecord(id);if(!discovery)return;
    const cases=await listRecords('case');
    openModal('File Discovery',`<form id="file-discovery" data-id="${id}"><p class="muted">Associate this discovery with a case. The original capture remains intact.</p><label class="field">Case<select class="input" name="caseId" required><option value="">Choose a case</option>${cases.map(c=>`<option value="${c.id}">${safe(c.payload.title)}</option>`).join('')}</select></label><div class="modal-actions">${button('closeModal','Cancel','btn')}<button class="btn btn-gold" type="submit" ${cases.length?'':'disabled'}>File to case</button></div></form>`);
}
function renderAfterFilter(changedValue,target){
    const el=document.activeElement;
    const focusName=el?.getAttribute('data-filter');
    const cursor=(el instanceof HTMLInputElement)?el.selectionStart:null;
    render().then(()=>{
        if(focusName==='search'||focusName==='queueQuery'||focusName==='subjectQuery'){const newEl=$(`[data-filter="${focusName}"]`);newEl?.focus();if(cursor!==null)newEl?.setSelectionRange(cursor,cursor);}
    });
}

// ============================================================================
// [JS-08] EVENTS, KEYBOARD, PWA AND INITIALIZATION
// ============================================================================
async function handleAction(action,el){
    const id=el.dataset.id;
    if(action==='closeModal'){selectedRecoverySnapshot=null;closeModal();return;}
    if(action==='moreSourceCandidates'){
        const field=el.dataset.field;
        if(sourcePickerSession?.selections.has(field)){sourcePickerSession.limits.set(field,(sourcePickerSession.limits.get(field)||24)+24);updateSourcePickerField(field);}
        return;
    }
    if(action==='goSubjects'){state.subjectVisible=48;return setNavigation('subjects');}
    if(action==='goConnections')return setNavigation('connections');
    if(action==='moreSubjects'){state.subjectVisible+=48;return render();}
    if(action==='newEntity')return editRecord('entity',null,{kind:ENTITY_KINDS[0]});
    if(action==='newCaseEntity'){
        const caseId=el.dataset.case;
        const caseRow=await getRecord(caseId);
        if(!caseRow || caseRow.deleted || caseRow.type!=='case')return notify('This case is no longer available.');
        const entities=buildSubjectIndex(await allRecords()).entities.filter(row => !row.caseRows.some(c => c.id===caseId));
        const list=entities.slice(0,80).map(row=>`<div class="case-item"><div class="item-main"><strong>${safe(row.payload.name)}</strong><small>${safe(row.payload.kind||'Subject')}</small></div>${button('linkExistingEntity','Link to case','btn btn-small',`data-id="${safe(row.id)}" data-case="${safe(caseId)}"`)}</div>`).join('');
        return openModal('Associate entity with case',`<p class="muted">Choose an existing canonical entity, or record a new one. Shared subjects are navigation, not evidence of a factual connection.</p>${list||'<p class="muted">All existing entities are already linked, or none have been recorded.</p>'}${entities.length>80?'<p class="muted">Showing the first 80 unlinked entities. Use the Subjects index to edit other entities.</p>':''}<div class="modal-actions">${button('closeModal','Cancel','btn')}${button('createCaseEntity','＋ New entity','btn btn-gold',`data-case="${safe(caseId)}"`)}</div>`);
    }
    if(action==='createCaseEntity'){closeModal();return editRecord('entity',null,{kind:ENTITY_KINDS[0],caseIds:[el.dataset.case]});}
    if(action==='linkExistingEntity'){
        const entity=await getRecord(id);
        const linkedCase=await getRecord(el.dataset.case);
        if(!entity || entity.deleted || entity.type!=='entity' || !linkedCase || linkedCase.deleted || linkedCase.type!=='case')return notify('The entity or case is no longer available.');
        const caseIds=[...new Set([...(entity.payload.caseIds||[]),linkedCase.id])];
        validateEntity({...entity.payload,caseIds},await allRecords(),id);
        await saveRecord('entity',{...entity.payload,caseIds},id);
        closeModal();scheduleAutoSync();notify('Existing entity linked without creating a duplicate.');return render();
    }
    if(action==='unlinkCaseEntity'){
        const entity=await getRecord(id);
        if(!entity || entity.deleted || entity.type!=='entity')return notify('Entity unavailable.');
        if(!confirm('Remove this case association? The entity and other case links will remain intact.'))return;
        await saveRecord('entity',{...entity.payload,caseIds:(entity.payload.caseIds||[]).filter(x=>x!==el.dataset.case)},id);
        scheduleAutoSync();return render();
    }
    if(action==='openEntity')return openEntityDetail(id);
    if(action==='openTopic')return openTopicDetail(el.dataset.name);
    if(action==='openEntityCase'){closeModal();return setNavigation('case',id,'subjects');}
    if(action==='editEntityFromDetail'){closeModal();return editRecord('entity',id);}
    if(action==='moreArchive'){state.archiveVisible+=48;return render();}
    if(action==='moreSearch'){state.searchVisible+=60;return render();}
    if(action==='moreLibrary'){state.libraryVisible+=36;return render();}
    if(action==='trailBack'){travelResearchTrail(-1);return;}
    if(action==='trailForward'){travelResearchTrail(1);return;}
    if(action==='moreBoardRecords'){state.boardVisible+=32;return render();}
    if(action==='moreCaseItems'){state.caseItemsVisible+=40;return render();}
    if(action==='moreBoardLinks'){state.boardLinksVisible+=48;return render();}
    if(action==='boardSelectNode'){if(Date.now()<suppressBoardClickUntil)return;return selectBoardNode(el.dataset.boardNode);}
    if(action==='boardEditSelected'){if(!state.boardSelected)return;const row=await getRecord(state.boardSelected);if(row&&!row.deleted)return editRecord(row.type,row.id);return notify('This record is no longer available.');}
    if(action==='boardLinkSelected'){if(state.boardSelected)return editRecord('board_link',null,{caseId:state.caseId,fromId:state.boardSelected,kind:'Supports'});return;}
    if(action==='resetBoardLayout'){if(!confirm('Reset node positions on this device? Research records and evidence links will not change.'))return;await setMeta('board_layout:'+state.caseId,{});notify('Board arrangement reset on this device.');return render();}
    if(action==='workflowStep'){
        const caseId=el.dataset.case||state.caseId;
        const step=el.dataset.step;
        if(!caseId)return;
        if(step==='editCase'){
            const record=await getRecord(caseId);
            if(!record || record.deleted || record.type!=='case')return notify('This case is unavailable.');
            return editRecord('case',caseId);
        }
        return setNavigation('case',caseId,el.dataset.tab||'workflow');
    }
    if(action==='goEditorial')return setNavigation('editorial');
    if(action==='queueTab'){state.queueFilter=el.dataset.tab;state.queueVisible=48;return render();}
    if(action==='moreQueue'){state.queueVisible+=48;return render();}
    if(action==='openWorkItem'){const target=await getRecord(el.dataset.id);if(target?.type==='source' && target.payload.caseId!==el.dataset.case)return inspectSource(target.id);return setNavigation('case',el.dataset.case,el.dataset.tab,el.dataset.id);}
    if(action==='newEditorialQuestion'){const chosen=state.queueCaseId || (await listRecords('case'))[0]?.id;if(!chosen)return notify('Create a Case File first to record a question.');return editRecord('question',null,{caseId:chosen,status:'Open'});}
    if(action==='newCase')return editRecord('case',null,{category:CATEGORIES[0],status:STATUSES[0]});
    if(action==='newNote')return quickCapture(true,el.dataset.case|| (state.page==='case'?state.caseId:''));
    if(action==='addDiscovery')return quickCapture(false,state.page==='case'?state.caseId:'');
    if(action==='newRecord')return editRecord(el.dataset.type,null,{caseId:el.dataset.case,fromId:el.dataset.case});
    if(action==='newRelation')return editRecord('relation',null,{fromId:state.connectionFocus});
    if(action==='newCollection')return editRecord('collection');
    if(action==='newJourney')return editRecord('journey');
    if(action==='newBoardLink')return editRecord('board_link',null,{caseId:state.caseId,kind:'Supports',fromId:state.boardSelected||''});
    if(action==='viewSearchResult'){
        const r=await getRecord(id);if(!r||r.deleted)return notify('The result is no longer available.');
        if(r.type==='case')return handleAction('openCase',el);
        if(r.type==='entity')return openEntityDetail(id);
        if(r.type==='discovery'){state.inboxStatus='All';return setNavigation('inbox');}
        if(r.type==='collection'||r.type==='journey'){state.libraryTab=r.type==='collection'?'collections':'journeys';return setNavigation('library');}
        if(r.type==='relation')return setNavigation('connections');
        if(r.payload?.caseId){
            const parent=await getRecord(r.payload.caseId);
            if(parent&&!parent.deleted){const tab=({claim:'claims',source:'sources',timeline:'timeline',note:'notes',explanation:'explanations',theory_event:'evolution',board_link:'board',task:'notes',question:'questions'})[r.type]||'story';return setNavigation('case',parent.id,tab,r.id);}
        }
        return editRecord(r.type,id);
    }
    if(action==='manageJourney')return manageJourney(id);
    if(action==='inspectSource')return inspectSource(id);
    if(action==='goClaim'){const row=await getRecord(id);if(!row||row.deleted||row.type!=='claim')return notify('Claim no longer available.');closeModal();return setNavigation('case',row.payload.caseId,'claims',id);}
    if(action==='journeyStep'){const journey=await getRecord(id);if(!journey)return;const current=journey.payload.completedIds||[];const next=el.checked?[...new Set([...current,el.dataset.case])]:current.filter(x=>x!==el.dataset.case);await saveRecord('journey',{...journey.payload,completedIds:next},id);scheduleAutoSync();return render();}
    if(action==='journeyShift'){const journey=await getRecord(id);if(!journey)return;const ids=[...(journey.payload.itemIds||[])];const index=ids.indexOf(el.dataset.case),step=Number(el.dataset.shift);if(index<0||index+step<0||index+step>=ids.length)return;[ids[index],ids[index+step]]=[ids[index+step],ids[index]];await saveRecord('journey',{...journey.payload,itemIds:ids},id);scheduleAutoSync();return manageJourney(id);}
    if(action==='openCase') {await setMeta('recent_case',id);state.caseTab='story';return setNavigation('case',id);}
    if(action==='editRecord'){const r=await getRecord(id);return editRecord(r.type,id);}
    if(action==='markCaseReviewed') {
        const rows=await allRecords();
        const report=caseEditorialReview(rows,id);
        if(!report.eligible) return notify('Resolve the required review items first.');
        if(!confirm('Have you personally reviewed the case narrative, citations, and evidence caveats? This does not establish that the theory is true.'))return;
        const caseRow=await getRecord(id);
        await saveRecord('case',{...caseRow.payload,status:'Reviewed',reviewedAt:new Date().toISOString(),reviewSignature:report.signature},id);
        scheduleAutoSync();notify('Editorial review recorded. Subsequent research changes will flag it as outdated.');
        return render();
    }
    if(action==='toggleBookmark'||action==='togglePin') {
        const r=await getRecord(id);const key=action==='toggleBookmark'?'bookmarked':'pinned';
        await saveRecord(r.type,{...r.payload,[key]:!r.payload[key]},id);scheduleAutoSync();return render();
    }
    if(action==='trashRecord'){const r=await getRecord(id);if(confirm(`Move "${r.payload.title||r.type}" to recoverable Trash? Related records will remain and may show missing references.`)){await trashRecord(id);notify('Moved to Trash. Restore from My Library.');render();}return;}
    if(action==='restoreRecord'){await restoreRecord(id);notify('Research record restored.');return render();}
    if(action==='caseTab'){researchTrail.remember(trailSnapshot());state.caseTab=el.dataset.tab;state.focusRecord='';state.caseItemsVisible=40;researchTrail.visit(trailSnapshot());return render();}
    if(action==='readingDepth'){state.readingDepth=el.dataset.depth;return render();}
    if(action==='readingJump'){
        const index=Number(el.dataset.section);
        if(!Number.isSafeInteger(index)||index<0)return;
        const target=document.getElementById('reading-section-'+index);
        if(target){target.focus({preventScroll:true});target.scrollIntoView({block:'start',behavior:'auto'});}
        return;
    }
    if(action==='readingSize'){
        const size=el.dataset.size;
        if(!['small','normal','large'].includes(size))return;
        state.readingSize=size;
        await setMeta('font_size',size);
        document.documentElement.style.setProperty('--read-size',size==='large'?'1.18rem':size==='small'?'0.91rem':'1rem');
        return render();
    }
    if(action==='readingFocus'){
        state.readingFocus=!state.readingFocus;
        await setMeta('reading_focus',state.readingFocus);
        return render();
    }
    if(action==='previewPublicCandidate'){
        const rows=await allRecords();
        const preview=publicCandidatePreview(rows,state.caseId);
        const report=publicationAssessment(rows,state.caseId);
        return openModal('Exact public candidate preview',`<div class="public-preview-warning">Not published. Review all text before approving. ${report.eligible?'The research gate is current.':'The research gate is blocked.'}</div><pre class="public-preview-data" tabindex="0">${safe(JSON.stringify(preview,null,2))}</pre><div class="actions">${button('closeModal','Close preview','btn')}</div>`);
    }
    if(action==='approvePublicCandidate'){
        const rows=await allRecords();
        const assessment=publicationAssessment(rows,state.caseId);
        if(!assessment.eligible)return notify('Resolve the blocking publication checks first.');
        const html=`<p class="muted">Inspect the exact candidate before proceeding. This is a new review, separate from the case research review. Nothing is uploaded or published.</p>
            <div class="public-approval-list">${PUBLIC_APPROVALS.map(item=>`<label class="public-approval"><input type="checkbox" data-public-approval="${safe(item.id)}"><span>${safe(item.label)}</span></label>`).join('')}</div>
            <div class="actions">${button('downloadPublicCandidate','Download reviewed candidate JSON','btn btn-gold',`data-id="${safe(state.caseId)}"`)}${button('closeModal','Cancel','btn')}</div>`;
        return openModal('Human publication review checklist',html);
    }
    if(action==='downloadPublicCandidate'){
        const checks=Object.fromEntries([...document.querySelectorAll('[data-public-approval]')].map(input=>[input.dataset.publicApproval,input.checked]));
        const rows=await allRecords();
        const candidate=createPublicCandidate(rows,id,checks);
        if(!confirm('Download this reviewed candidate? This does not publish or share it.'))return;
        downloadBlob(new Blob([JSON.stringify(candidate,null,2)],{type:'application/json'}),`public-candidate-${id.slice(0,8)}-${new Date().toISOString().slice(0,10)}.json`);
        closeModal();notify('Candidate downloaded to this device only. No content published or uploaded.');return;
    }
    if(action==='libraryTab'){researchTrail.remember(trailSnapshot());state.libraryTab=el.dataset.tab;state.libraryVisible=36;researchTrail.visit(trailSnapshot());return render();}
    if(action==='goArchive')return setNavigation('archive');
    if(action==='goSearch')return setNavigation('search');
    if(action==='goDesk')return setNavigation('desk');
    if(action==='goSettings')return setNavigation('settings');
    if(action==='print'){window.print();return;}
    if(action==='openConnections'){state.connectionFocus=id;return setNavigation('connections');}
    if(action==='focusCase'){state.connectionFocus=id;return render();}
    if(action==='roulette'){const cases=await listRecords('case');if(!cases.length){notify('Add cases to your archive first.');return;}const random=cases[Math.floor(Math.random()*cases.length)];await setMeta('recent_case',random.id);return setNavigation('case',random.id);}
    if(action==='openSourceIntake'){
        const caseId=el.dataset.case||state.caseId;
        const parent=caseId?await getRecord(caseId):null;
        if(!parent || parent.type!=='case' || parent.deleted)return notify('Select a valid Case File.');
        return openSourceIntake(caseId);
    }
    if(action==='editSourceIntake'){
        if(!sourceIntakeSession)return notify('No source draft is available.');
        const {caseId,raw}=sourceIntakeSession;return openSourceIntake(caseId,raw);
    }
    if(action==='commitSourceIntake')return commitSourceIntake();
    if(action==='copySourceReference'){
        const row=await getRecord(id);
        const text=sourceReferenceText(row);
        try {
            if(!navigator.clipboard?.writeText)throw Error('Clipboard permission unavailable');
            await navigator.clipboard.writeText(text);
            notify('Recorded source details copied. Verify before citing.');
        } catch {
            // Useful on file://, Safari, or restricted clipboard environments;
            // selecting text is not falsely reported as a successful copy.
            openModal('Select source reference to copy',`<p class="muted">Automatic clipboard access is unavailable. Select and copy the text below manually. This includes only recorded citation metadata, not PC-file paths.</p><textarea class="input" id="source-copy-text" rows="12" readonly>${safe(text)}</textarea><div class="modal-actions">${button('closeModal','Close','btn')}</div>`,()=>$('#source-copy-text')?.select());
        }
        return;
    }
    if(action==='attachFile')return attachFile(id);
    if(action==='openFile')return openPCFile(id);
    if(action==='archiveDiscovery') {const r=await getRecord(id);await saveRecord('discovery',{...r.payload,status:r.payload.status==='Archived'?'Inbox':'Archived'},id);return render();}
    if(action==='fileDiscovery')return fileDiscovery(id);
    if(action==='collectionItems')return manageCollection(id);
    if(action==='toggleTask'){const r=await getRecord(id);await saveRecord('task',{...r.payload,done:el.checked},id);return render();}
    if(action==='recoveryGuide'){
        openModal('Independent Recovery Guide',`<p class="muted">Use these steps to prepare for a damaged PC, a lost phone, or a cloud outage. No backup is being started from this screen.</p>
        <ol class="recovery-steps"><li>Export current research metadata, including unsynchronized local changes.</li><li>On Windows, choose a verified ZIP or directory backup of linked source files.</li><li>Read the missing-file report and fix or separately copy any originals that could not be included.</li><li>Keep at least one completed copy on another physical drive.</li><li>Before restoring, preserve newer local changes and compare cloud revisions. Imports merge rather than overwrite existing records.</li><li>Confirm both metadata and original files are present after any future restore.</li></ol>
        <p class="warning-text">This is a plan, not proof that your separate backup exists.</p><div class="modal-actions">${button('closeModal','Close','btn')}${button('downloadRecoveryChecklist','Download checklist','btn btn-gold')}</div>`);
        return;
    }
    if(action==='downloadRecoveryChecklist'){
        downloadBlob(new Blob([recoveryChecklist()],{type:'text/plain'}),'Research_Archive_Independent_Recovery_Checklist.txt');
        notify('Recovery checklist downloaded. Original PC files were not copied.');return;
    }
    if(action==='exportData') {const data=await exportRecords();downloadBlob(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),`research-metadata-${new Date().toISOString().slice(0,10)}.json`);notify('Metadata exported. Back up your original PC files separately.');return;}
    if(action==='importData')return importMetadata();
    if(action==='auditFiles'||action==='exportFileInventory'){
        const report=await auditLocalSourceFiles();
        if(action==='exportFileInventory'){
            downloadBlob(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}),`pc-file-inventory-${new Date().toISOString().slice(0,10)}.json`);
            notify('Source inventory downloaded. This does not contain original files.');return;
        }
        openModal('PC Source File Inventory',`<p><strong>${report.available}</strong> of ${report.records} linked source files accessible without asking for new permissions.</p><p class="muted">${report.needsReview} need review. Unavailable or permission-required is not evidence of deletion. This report does not copy or back up any originals.</p>${report.details.length?`<div class="vstack">${report.details.map(d=>`<div class="case-item"><div class="item-main"><strong>${safe(d.title)}</strong><small>${safe(d.filename)} · ${safe(d.status)}</small></div></div>`).join('')}</div>`:'<p class="muted">There are no PC-file references in your research yet.</p>'}<div class="modal-actions">${button('closeModal','Close','btn')}</div>`);return;
    }
    if(action==='directoryResume') {
        if(typeof window.showDirectoryPicker!=='function')return notify('Folder backup resume requires Windows Chrome or Edge.');
        const folder=await window.showDirectoryPicker({mode:'readwrite'});
        if(!confirm('Resume this exact unfinished backup folder? Verified copied files will be preserved. No source file on your PC will be changed.'))return;
        try{
            const result=await resumeDirectoryBackup(folder,message=>$('#footer-status').textContent=message);
            const notice=result.journalIntegrity==='legacy journal without original metadata digest'
                ? ' Warning: this older interrupted backup journal cannot confirm its research metadata was unchanged. Create a fresh verified backup before relying on it.' : '';
            notify((result.complete?`Interrupted backup resumed and verified: ${result.files} files.`:
                `Resumed partial backup: ${result.missing.length} unavailable original files.`)+notice);
            render();
        }catch(error){notify('Backup resume stopped: '+error.message);}
        return;
    }
    if(action==='directoryBackup'){
        if(typeof window.showDirectoryPicker!=='function')return notify('Folder backups require supported Windows Chrome or Edge, using HTTPS or localhost.');
        const destination=await window.showDirectoryPicker({mode:'readwrite'});
        if(!confirm('A NEW backup subfolder will be created inside your chosen folder. For protection against PC drive failure, choose a different physical drive. Begin writing a snapshot?'))return;
        try{
            const result=await backupToDirectory(destination,message=>$('#footer-status').textContent=message);
            notify(result.complete?`Directory backup saved with ${result.files} verified files.`:`PARTIAL folder backup: ${result.missing.length} missing or inaccessible sources. Review its manifest.`);
        }catch(e){notify(`Backup stopped: ${e.message}. Inspect any newly created folder before retrying.`);}
        return;
    }
    if(action==='directoryRestoreResume'){
        if(typeof window.showDirectoryPicker!=='function')return notify('Directory access is not supported in this browser.');
        notify('Select the original backup snapshot folder first.');
        const snapshot=await window.showDirectoryPicker({mode:'read'});
        notify('Select the specific unfinished ResearchArchive-restored-files folder next.');
        const unfinished=await window.showDirectoryPicker({mode:'readwrite'});
        if(!confirm('Verify the backup and resume only this unfinished restore? Existing research IDs will not be overwritten.'))return;
        try{const outcome=await resumeDirectoryRestore(snapshot,unfinished,message=>$('#footer-status').textContent=message);notify(`Restore resumed: ${outcome.filesRestored} source files linked; ${outcome.added} records newly imported this run.${outcome.filesUnlinked ? ` WARNING: ${outcome.filesUnlinked} copied file(s) need manual relinking. Existing sources were not changed.` : ''}`);return render();}
        catch(e){notify('Restore resume stopped: '+e.message);}return;
    }
    if(action==='directoryRestore'){
        if(typeof window.showDirectoryPicker!=='function')return notify('Directory restoration requires supported Windows Chrome or Edge.');
        const snapshot=await window.showDirectoryPicker({mode:'read'});
        selectedRecoverySnapshot=null;
        try{
            const check=await verifyDirectoryBackup(snapshot,message=>$('#footer-status').textContent=message);
            if(!check.ok){
                return openModal('Archive Verification Failed',`<p class="warning-text">${check.failures.length} included file(s) did not verify. No records or source files were imported.</p><div class="modal-actions">${button('closeModal','Close','btn')}</div>`);
            }
            selectedRecoverySnapshot=snapshot;
            const warning=(check.complete?'All included file copies verified.':'This is a PARTIAL backup. Some original files were missing when it was created.') + (check.metadataIntegrity==='Legacy backup: no metadata digest'?' Research metadata does not have the newer integrity digest.':'');
            openModal('Verified Directory Backup',`<p>${safe(warning)}</p><p><strong>${check.metadataRecords}</strong> metadata records · <strong>${check.files}</strong> verified source files · <strong>${check.missing.length}</strong> missing originals at backup time.</p><p class="muted">Restoration will MERGE previously unseen record IDs and copy their source files into a new folder. It will not overwrite existing research. Choose a distinct PC destination folder next, not your only backup copy.</p><div class="modal-actions">${button('closeModal','Cancel','btn')}${button('directoryRestoreDestination','Choose Destination and Restore','btn btn-gold')}</div>`);
        }catch(e){notify('Could not verify folder backup: '+e.message);}
        return;
    }
    if(action==='directoryRestoreDestination'){
        if(!selectedRecoverySnapshot)return notify('Choose and verify a backup folder first.');
        // The second directory picker needs its own direct user click on this button.
        const destination=await window.showDirectoryPicker({mode:'readwrite'});
        if(!confirm('Restore a verified snapshot into a NEW subfolder here? Only missing record IDs will be imported. Existing research will remain untouched.'))return;
        try{
            const outcome=await restoreDirectoryBackup(selectedRecoverySnapshot,destination,message=>$('#footer-status').textContent=message);
            selectedRecoverySnapshot=null;closeModal();
            notify(`Restored ${outcome.added} new records and linked ${outcome.filesRestored} PC source files. Existing IDs preserved.${outcome.filesUnlinked ? ` WARNING: ${outcome.filesUnlinked} copied file(s) need manual relinking.` : ''}`);
            render();
        }catch(e){notify('Restore stopped: '+e.message+'; see new destination folder for any partial copied files.');}
        return;
    }
    if(action==='fullBackup'){const out=await createSmallBackup();notify(out.complete?`Archive downloaded with ${out.files} source files. Store on another drive.`:`PARTIAL ZIP downloaded: ${out.missing.length} missing source files. See manifest.`);return;}
    if(action==='importZip'){const file=await new Promise(resolve=>{const input=document.createElement('input');input.type='file';input.accept='.zip,application/zip';input.onchange=()=>resolve(input.files?.[0]||null);input.click();});if(!file)return;const out=await restoreSmallBackup(file);if(out&&!out.cancelled){notify(`Imported ${out.added} new records; ${out.skipped} existing records preserved. ${out.filesRestored} new source files restored; ${out.filesUnlinked} still need relinking.`);render();}return;}
    if(action==='startPersistenceCheck'){
        const marker={id:crypto.randomUUID(),session:SESSION_CHECK_ID,startedAt:new Date().toISOString()};
        await setMeta('local_persistence_probe',marker);
        const persisted=await getMeta('local_persistence_probe');
        if(persisted?.id!==marker.id)throw Error('Could not verify the local test write');
        notify('Test marker saved. Close and reopen the app, then select Verify After Restart.');
        return render();
    }
    if(action==='verifyPersistenceCheck'){
        const marker=await getMeta('local_persistence_probe');
        if(!marker) {notify('No test marker found. Select Save Test Marker first.');return;}
        if(marker.session===SESSION_CHECK_ID){notify('Please close and reopen or reload the app before verification.');return;}
        await setMeta('local_persistence_probe',null);
        notify('PASS: the marker survived a page restart in this browser profile.');
        return render();
    }
    if(action==='configureCloud')return configureCloud();
    if(action==='signIn')return signinModal();
    if(action==='signOut'){if(confirm('Sign out of cloud sync on this device? Your local research and pending edits will remain.')){await cloud.signout();notify('Signed out. Local research preserved.');render();}return;}
    if(action==='syncNow') {try{notify('Synchronizing allowed research records…');const outcome=await cloud.sync(message=>$('#footer-status').textContent=message);notify(`Sync finished: ${outcome.pushed} uploaded, ${outcome.pulled} received, ${outcome.conflicted} conflicts`);render();}catch(e){notify('Sync unavailable: '+e.message);}return;}
    if(action==='reviewConflict')return conflictModal(id);
    if(action==='chooseConflict'){
        try{
            await resolveConflict(id,el.dataset.choice,null,el.dataset.mutation,Number(el.dataset.remoteRevision));
            closeModal();notify('Conflict decision saved locally. Sync again to reconcile with server.');return render();
        }catch(error){
            if(!String(error.message).includes('Research changed since'))throw error;
            notify(error.message);return conflictModal(id);
        }
    }
    if(action==='loadSamples'){
        if(!confirm('Create four clearly labeled unsourced demonstration case outlines? You can edit or trash them later.'))return;
        const examples=[
            ['The Roswell Incident','Science & Cosmic Mysteries','What was recovered near Roswell in 1947?','A debris recovery in New Mexico became a major UFO controversy. This example requires independent source research before publication.'],
            ['MKUltra','Documented Secret Operations','What can official records establish about the MKUltra program?','The CIA operated MKUltra, a program involving behavioral research and experimentation. This demonstration outline does not include citations.'],
            ['The Voynich Manuscript','Historical Mysteries','What is the origin and meaning of this illustrated manuscript?','The Voynich Manuscript is an illustrated manuscript with undeciphered writing. This is a starter outline, not a completed investigation.'],
            ['The Wow! Signal','Science & Cosmic Mysteries','What produced the 1977 radio observation?','A 1977 radio observation attracted attention in the search for extraterrestrial intelligence. This outline requires sourced research.']
        ];
        for(const [title,category,centralQuestion,summary] of examples)await saveRecord('case',{title,category,centralQuestion,summary,status:'Not started',aliases:[],tags:[],story:'',sample:true,bookmarked:false,pinned:false});
        notify('Four unsourced demonstration outlines added.');return render();
    }
}

async function main(){
    try {await initData();await cloud.init();}
    catch(e){$('#view').innerHTML=`<div class="panel"><h1>Local storage unavailable</h1><p>${safe(e.message)}</p><p>Use a supported non-private browser profile. No research has been saved.</p></div>`;window.researchArchiveBoot?.failed();return;}
    const theme=await getMeta('theme')||'archive';document.body.dataset.theme=theme;
    const f=await getMeta('font_size')||'normal';state.readingSize=f;state.readingFocus=(await getMeta('reading_focus'))===true;document.documentElement.style.setProperty('--read-size',f==='large'?'1.18rem':f==='small'?'0.91rem':'1rem');
    await render();
    window.addEventListener('online',scheduleAutoSync);
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')scheduleAutoSync();});
    setInterval(()=>{if(document.visibilityState==='visible'&&Date.now()-previousAutoSync>10*60*1000)scheduleAutoSync();},60000);
    scheduleAutoSync();
    // Drag only inside an explicitly opened evidence diagram. The node remains a
    // real button for keyboard/screen-reader use. Layout is never cloud-synced.
    document.body.addEventListener('pointerdown',event=>{
        const el=event.target.closest?.('[data-board-node]');
        if(!el || event.button!==0 || !el.closest('.board-stage'))return;
        boardDragging={el,id:event.pointerId,x:event.clientX,y:event.clientY,originX:el.offsetLeft,originY:el.offsetTop,moved:false};
        el.setPointerCapture?.(event.pointerId);
    });
    document.body.addEventListener('pointermove',event=>{
        const drag=boardDragging;
        if(!drag || drag.id!==event.pointerId)return;
        const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
        if(!drag.moved && Math.hypot(dx,dy)<5)return;
        drag.moved=true;
        const height=Number(drag.el.closest('.board-stage')?.dataset.boardHeight||250);
        const pos=applyBoardMove({x:drag.originX,y:drag.originY},dx,dy,height);
        drag.el.style.left=pos.x+'px';drag.el.style.top=pos.y+'px';
        redrawBoardEdges();
    });
    document.body.addEventListener('pointerup',async event=>{
        const drag=boardDragging;
        if(!drag||drag.id!==event.pointerId)return;
        boardDragging=null;
        if(!drag.moved)return;
        suppressBoardClickUntil=Date.now()+350;
        try{await rememberBoardNodePosition(drag.el);await selectBoardNode(drag.el.dataset.boardNode);}
        catch(e){notify('Could not save board layout: '+e.message);}
    });
    document.body.addEventListener('pointercancel',()=>{boardDragging=null;});
    document.body.addEventListener('click',async event=>{
        const nav=event.target.closest('[data-page]');if(nav){setNavigation(nav.dataset.page);return;}
        const node=event.target.closest('[data-case-node]');if(node){state.connectionFocus=node.dataset.caseNode;render();return;}
        const act=event.target.closest('[data-action]');
        if(!act)return;
        if(act.tagName==='BUTTON' && act.type==='submit' && act.closest('form'))return;
        try{await handleAction(act.dataset.action,act);}catch(e){console.error(e);notify(e.message||'Action could not be completed');}
    });
    document.body.addEventListener('keydown',async event=>{
        const el=event.target.closest?.('[data-board-node]');
        if(!el || !['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(event.key))return;
        event.preventDefault();
        const step=event.shiftKey?64:16;
        const shift={ArrowUp:[0,-step],ArrowDown:[0,step],ArrowLeft:[-step,0],ArrowRight:[step,0]}[event.key];
        const height=Number(el.closest('.board-stage')?.dataset.boardHeight||250);
        const pos=applyBoardMove({x:el.offsetLeft,y:el.offsetTop},shift[0],shift[1],height);
        el.style.left=pos.x+'px';el.style.top=pos.y+'px';
        redrawBoardEdges();
        try {await rememberBoardNodePosition(el);await selectBoardNode(el.dataset.boardNode);}catch(e){notify('Unable to store board layout: '+e.message);}
    });
    document.body.addEventListener('keydown',event=>{
        const dialog=$('.modal');
        if(dialog&&manageDialogTab(event,dialog,document.activeElement))return;
        if(event.key==='Escape'&&$('#modal-root').children.length){closeModal();return;}
        if(event.shiftKey&&event.altKey&&['ArrowLeft','ArrowRight'].includes(event.key)&&!$('#modal-root').children.length){event.preventDefault();travelResearchTrail(event.key==='ArrowLeft'?-1:1);return;}
        if(event.key==='/'&&!(event.target instanceof HTMLInputElement)&&!(event.target instanceof HTMLTextAreaElement)){event.preventDefault();setNavigation('search');setTimeout(()=>$('[data-filter="search"]')?.focus(),50);}
        if((event.key==='Enter'||event.key===' ')&&event.target.matches('[data-case-node]')){event.preventDefault();state.connectionFocus=event.target.dataset.caseNode;render();}
    });
    document.body.addEventListener('click',async e=>{
        if(e.target.classList.contains('modal-backdrop'))closeModal();
    });
    document.body.addEventListener('submit',async event=>{
        const form=event.target;if(!form.id)return;
        event.preventDefault();
        try {
            if(form.id==='record-form')await saveForm(form);
            if(form.id==='source-intake-form')await previewSourceIntake(form);
            if(form.id==='cloud-config'){const d=new FormData(form);await cloud.configure(String(d.get('url')),String(d.get('key')));closeModal();notify('Free cloud configuration saved. Sign in when ready.');render();}
            if(form.id==='auth-form'){
                const submitter=event.submitter;const d=new FormData(form);
                if(submitter?.value==='signup'){const response=await cloud.signup(String(d.get('email')),String(d.get('password')));closeModal();notify(response?.session||cloud.session?'Account created and signed in.':'Account created. Check email confirmation before signing in.');}
                else{await cloud.signin(String(d.get('email')),String(d.get('password')));closeModal();notify('Signed in. Use Sync Now to transfer changes.');scheduleAutoSync();}render();
            }
            if(form.id==='journey-form'){const id=form.dataset.id,journey=await getRecord(id);if(!journey)return;const selected=new Set(new FormData(form).getAll('case').map(String));const old=journey.payload.itemIds||[];const ids=[...old.filter(x=>selected.has(x)),...Array.from(selected).filter(x=>!old.includes(x))];await saveRecord('journey',{...journey.payload,itemIds:ids,completedIds:(journey.payload.completedIds||[]).filter(x=>selected.has(x))},id);closeModal();scheduleAutoSync();notify('Journey updated');return render();}
            if(form.id==='collection-form'){const id=form.dataset.id,col=await getRecord(id);await saveRecord('collection',{...col.payload,itemIds:[...new FormData(form).getAll('case')]},id);closeModal();render();}
            if(form.id==='file-discovery'){const id=form.dataset.id,row=await getRecord(id);await saveRecord('discovery',{...row.payload,caseId:String(new FormData(form).get('caseId')),status:'Filed'},id);closeModal();notify('Discovery filed to case.');render();}
        }catch(e){console.error(e);notify(e.message||'Unable to save');}
    });
    document.body.addEventListener('change',async event=>{
        const t=event.target;
        if(t.dataset.publicCompare){
            const file=t.files?.[0];
            if(!file)return;
            try{
                if(file.size>MAX_CANDIDATE_BYTES)throw Error('Earlier candidate exceeds the 4 MiB limit.');
                const previous=parsePreviousCandidate(await file.text());
                // Rebuild the live candidate from canonical records. Do not reuse a
                // stale preview or trust approval metadata from the imported file.
                if(state.page!=='case'||state.caseTab!=='publication'||!state.caseId)return;
                const current=publicCandidatePreview(await allRecords(),state.caseId);
                const result=comparePublicCandidates(previous,current);
                const previewValue=value=>value===null?'(not present)':typeof value==='string'?value:JSON.stringify(value,null,2);
                const previewChanges=result.changes.slice(0,100).map((item,index)=>`<details class="public-change"><summary>${index+1}. ${safe(item.kind)} · ${safe(item.field)} · ${safe(item.change)}${item.id==='case'?'':` (${safe(item.id.slice(0,32))})`}</summary><div class="public-change-grid"><div><strong>Earlier</strong><pre>${safe(previewValue(item.before))}</pre></div><div><strong>Current</strong><pre>${safe(previewValue(item.after))}</pre></div></div></details>`).join('');
                return openModal('Publication candidate revision comparison',`<div class="public-preview-warning" role="note">Local comparison only. Earlier files cannot prove case identity, rights, approval, or factual accuracy. Neither candidate is published.</div><p><strong>Earlier title:</strong> ${safe(result.previousTitle)}<br><strong>Current title:</strong> ${safe(result.currentTitle)}</p><p class="muted">Confirm these are the same case. Titles may change, and a matching title alone does not prove identity.</p><p><strong>${result.changedFields}</strong> changed fields · <strong>${result.addedRecords}</strong> added records · <strong>${result.removedRecords}</strong> removed records.</p>${result.changes.length?`<p class="muted">Showing ${Math.min(result.changes.length,100)} of ${result.changes.length} changes. Open a row to read earlier and current text in full.</p><div class="public-change-list">${previewChanges}</div>`:'<p>No exported fields differ between these two candidates.</p>'}<div class="actions">${button('closeModal','Close comparison','btn')}</div>`);
            }catch(error){console.warn('Publication candidate comparison rejected:',error);notify(error.message||'Unable to compare candidate.');}
            finally{t.value='';}
            return;
        }
        if(t.dataset.sourceChoice && sourcePickerSession?.selections.has(t.dataset.sourceChoice)){
            const choice=sourcePickerSession.selections.get(t.dataset.sourceChoice);
            if(t.checked)choice.add(t.value);else choice.delete(t.value);
            const wasFocused=document.activeElement===t;
            updateSourcePickerField(t.dataset.sourceChoice);
            if(wasFocused){
                const replacement=[...document.querySelectorAll('[data-source-choice]')].find(node=>node.dataset.sourceChoice===t.dataset.sourceChoice && node.value===t.value);
                replacement?.focus();
            }
            return;
        }
        if(t.name==='caseId' && t.closest('#record-form') && sourcePickerSession){
            sourcePickerSession.caseId=t.value;
            refreshSourcePickerFields();
            return;
        }
        if(t.dataset.setting){await setMeta(t.dataset.setting,t.value);if(t.dataset.setting==='font_size')state.readingSize=t.value;if(t.dataset.setting==='theme')document.body.dataset.theme=t.value;else document.documentElement.style.setProperty('--read-size',t.value==='large'?'1.18rem':t.value==='small'?'0.91rem':'1rem');notify('Preference saved locally');}
        if(t.dataset.filter==='category'){state.archiveCategory=t.value;state.archiveVisible=48;}
        if(t.dataset.filter==='status'){state.archiveStatus=t.value;state.archiveVisible=48;}
        if(t.dataset.filter==='archiveSort'){state.archiveSort=t.value;state.archiveVisible=48;}
        if(t.dataset.filter==='subjectKind'){state.subjectKind=t.value;state.subjectVisible=48;}
        if(t.dataset.filter==='queueCaseId'){state.queueCaseId=t.value;state.queueVisible=48;}
        if(t.dataset.filter==='queueAttention'){state.queueAttention=t.value;state.queueVisible=48;}
        if(t.dataset.filter==='queueSort'){state.queueSort=t.value;state.queueVisible=48;}
        if(t.dataset.filter==='queueQuery')return; // handled by the debounced input listener
        if(t.dataset.filter==='inbox')state.inboxStatus=t.value;
        if(t.dataset.filter==='relation')state.relationFilter=t.value;
        if(t.dataset.filter==='searchType'){state.searchType=t.value;state.searchVisible=60;}
        if(t.dataset.filter==='board'){state.boardFilter=t.value;state.boardLinksVisible=48;}
        if(t.dataset.filter==='connectionCase')state.connectionFocus=t.value;
        if(t.dataset.filter)render();
    });
    document.body.addEventListener('input',event=>{
        const target=event.target;
        if(target.dataset.sourceSearch && sourcePickerSession?.selections.has(target.dataset.sourceSearch)){
            const field=target.dataset.sourceSearch;
            sourcePickerSession.queries.set(field,target.value);
            sourcePickerSession.limits.set(field,24);
            updateSourcePickerField(field);
            return;
        }
        if(event.target.dataset.filter==='search'){state.search=event.target.value;state.searchVisible=60;state.archiveVisible=48;clearTimeout(searchDelayTimer);searchDelayTimer=setTimeout(()=>renderAfterFilter(),160);}
        if(event.target.dataset.filter==='subjectQuery'){state.subjectQuery=event.target.value;state.subjectVisible=48;clearTimeout(searchDelayTimer);searchDelayTimer=setTimeout(()=>renderAfterFilter(),180);}
        if(event.target.dataset.filter==='queueQuery'){state.queueQuery=event.target.value;state.queueVisible=48;clearTimeout(searchDelayTimer);searchDelayTimer=setTimeout(()=>renderAfterFilter(),180);}
    });
    $('#side-capture').addEventListener('click',()=>quickCapture(false));
    $('#top-capture').addEventListener('click',()=>quickCapture(false));
    $('#quick-note').addEventListener('click',()=>quickCapture(true,state.page==='case'?state.caseId:''));
    $('#global-search-btn').addEventListener('click',()=>{setNavigation('search');setTimeout(()=>$('[data-filter="search"]')?.focus(),50);});
    window.researchArchiveBoot?.ready();
    if ('serviceWorker' in navigator && (location.protocol==='https:' || ['localhost','127.0.0.1'].includes(location.hostname))) {
        navigator.serviceWorker.register('./sw.js').catch(()=>{});
    }
}
main().catch(error => {
    console.error('Research Archive startup failed:', error);
    window.researchArchiveBoot?.failed();
});

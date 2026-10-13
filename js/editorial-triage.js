// ============================================================================
// [JS-TRIAGE-01] HUMAN-SET RESEARCH PRIORITIES AND QUEUE ORDER
// ============================================================================
// Planning urgency is not a statement about the truth of a claim.
// The caller supplies the local calendar day; no network clock is required.
export const TASK_PRIORITIES = ['Routine', 'Soon', 'Urgent'];
export const QUEUE_SORTS = [
    ['attention', 'Suggested attention'],
    ['case', 'Case title'],
    ['type', 'Work type'],
    ['date', 'Target date']
];
export const ATTENTION_FILTERS = [
    ['all', 'All attention levels'],
    ['urgent', 'Needs attention'],
    ['scheduled', 'Has target date'],
    ['unscheduled', 'No target date']
];

export function localCalendarDay(date = new Date()) {
    const d = value => String(value).padStart(2, '0');
    return `${date.getFullYear()}-${d(date.getMonth() + 1)}-${d(date.getDate())}`;
}

export function validCalendarDay(value) {
    if (value === '') return true;
    if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const [y,m,d] = value.split('-').map(Number);
    const checked = new Date(0);
    checked.setFullYear(y, m - 1, d);
    return checked.getFullYear() === y && checked.getMonth() === m - 1 && checked.getDate() === d;
}

function dayDifference(from, to) {
    const utc = value => {const [y,m,d] = value.split('-').map(Number); return Date.UTC(y,m-1,d);};
    return Math.round((utc(to)-utc(from))/86400000);
}

export function queuePriority(entry, today = localCalendarDay()) {
    const priority = TASK_PRIORITIES.includes(entry.priority) ? entry.priority : 'Routine';
    const dueOn = validCalendarDay(entry.dueOn) && entry.dueOn ? entry.dueOn : '';
    const days = dueOn && validCalendarDay(today) ? dayDifference(today, dueOn) : null;
    const overdue = days !== null && days < 0;
    const blocking = entry.kind === 'citations' && entry.urgency === 0;
    const stale = entry.kind === 'reviews' && entry.urgency === 1;
    const attention = overdue || blocking || (entry.kind === 'tasks' && priority === 'Urgent');
    const upcoming = days !== null && days <= 7 && days >= 0;
    const rank = attention ? 0 : (stale || upcoming || (entry.kind === 'tasks' && priority === 'Soon') ? 1 : 2);
    let reason = '';
    if (overdue) reason = `Target date passed (${dueOn})`;
    else if (blocking) reason = 'Required citation gap';
    else if (entry.kind === 'tasks' && priority === 'Urgent') reason = 'Marked urgent by you';
    else if (stale) reason = 'Editorial review needs refreshing';
    else if (upcoming) reason = days === 0 ? 'Target date today' : `Target date in ${days} day${days === 1 ? '' : 's'}`;
    else if (entry.kind === 'tasks' && priority === 'Soon') reason = 'Marked soon by you';
    return {...entry, priority, dueOn, rank, attention, reason};
}

export function triageEditorialQueue(entries, {attention = 'all', sort = 'attention', today = localCalendarDay()} = {}) {
    const annotated = entries.map(entry => queuePriority(entry,today));
    const filtered = annotated.filter(entry => attention === 'all' ||
        (attention === 'urgent' && entry.rank === 0) ||
        (attention === 'scheduled' && !!entry.dueOn) ||
        (attention === 'unscheduled' && !entry.dueOn));
    const compareText = (a,b) => String(a).localeCompare(String(b));
    return filtered.sort((a,b) => {
        if (sort === 'case') return compareText(a.caseTitle,b.caseTitle) || a.rank-b.rank || compareText(a.id,b.id);
        if (sort === 'type') return compareText(a.kind,b.kind) || a.rank-b.rank || compareText(a.id,b.id);
        if (sort === 'date') return compareText(a.dueOn || '9999-12-31', b.dueOn || '9999-12-31') || a.rank-b.rank || compareText(a.id,b.id);
        return a.rank-b.rank || a.urgency-b.urgency || compareText(a.caseTitle,b.caseTitle) || compareText(a.id,b.id);
    });
}

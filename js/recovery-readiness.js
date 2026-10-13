// ============================================================================
// [JS-RECOVERY-01] NON-DESTRUCTIVE RECOVERY READINESS SUMMARY
// A status summary is never a substitute for verified independent backups.
// ============================================================================

export function summarizeRecovery(rows, pending, conflicts, missingReferences) {
    const sourceFiles = rows.filter(row =>
        row.type === 'source' && !row.deleted && Boolean(row.payload?.filename)
    );
    const researchRecords = rows.filter(row => !row.deleted).length;

    return {
        researchRecords,
        pcSourceFiles: sourceFiles.length,
        awaitingSync: pending,
        unresolvedConflicts: conflicts,
        brokenReferences: missingReferences,
        warning: pending > 0 || conflicts > 0 || missingReferences > 0,
        caveat: 'No independent hard-drive backup has been verified by this summary.'
    };
}

export function recoveryChecklist() {
    return [
        'THE RESEARCH ARCHIVE - INDEPENDENT RECOVERY CHECKLIST',
        '',
        '1. In Settings, export current research metadata to a safe destination.',
        '2. On Windows, use Small ZIP or Directory Folder Backup when supported.',
        '3. Check the resulting manifest for missing or inaccessible source files.',
        '4. Copy original research PDFs, images and other files to a SEPARATE physical drive.',
        '5. Keep the independent backup disconnected or otherwise protected between copies.',
        '6. Keep a verified backup separate from the computer and browser profile.',
        '7. After a device or account problem, inspect existing local edits before restoring.',
        '8. Preview and verify backups before merging records. Do not overwrite newer work.',
        '',
        'Cloud synchronization is not backup; metadata alone is not a full archive.',
        'This checklist is guidance only and does not certify that files were copied.',
        ''
    ].join('\n');
}

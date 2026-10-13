// Shared modal isolation keeps an open dialog separate from the research workspace.
// The modal root itself must never be inert, so its buttons remain operable.
const BACKGROUND = ['.app-shell', '#mobile-nav'];
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export function isolateDialogBackground(root, active) {
    for (const selector of BACKGROUND) {
        const element = root.querySelector(selector);
        if (element) element.inert = active;
    }
}

export function manageDialogTab(event, dialog, activeElement) {
    if (event.key !== 'Tab') return false;
    const items = [...dialog.querySelectorAll(FOCUSABLE)]
        .filter(el => !el.hidden && !el.closest('[inert]') && el.getClientRects().length);
    if (!items.length) {
        event.preventDefault();
        dialog.focus();
        return true;
    }
    const first = items[0], last = items[items.length - 1];
    // If a browser extension or scripted focus move escaped the modal, recover.
    if (!dialog.contains(activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
        return true;
    }
    if (event.shiftKey && (activeElement === first || activeElement === dialog)) {
        event.preventDefault();
        last.focus();
    } else if (!event.shiftKey && (activeElement === last || activeElement === dialog)) {
        event.preventDefault();
        first.focus();
    }
    return true;
}

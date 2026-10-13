// ============================================================================
// [JS-NAV-01] EPHEMERAL RESEARCH TRAIL
// Back/forward navigation is session-only and never enters cloud records.
// ============================================================================

export function createNavigationTrail(initial, capacity = 35) {
    const locations = [{...initial}];
    let position = 0;

    return {
        remember(location) {
            locations[position] = {...location};
            return this.status();
        },

        visit(location) {
            const next = {...location};
            const current = locations[position];
            if (JSON.stringify(current) === JSON.stringify(next)) return this.status();
            locations.splice(position + 1);
            locations.push(next);
            if (locations.length > capacity) locations.shift();
            position = locations.length - 1;
            return this.status();
        },

        travel(delta) {
            const destination = position + delta;
            if (destination < 0 || destination >= locations.length) return null;
            position = destination;
            return {...locations[position]};
        },

        status() {
            return {
                canBack: position > 0,
                canForward: position < locations.length - 1,
                entries: locations.length
            };
        }
    };
}

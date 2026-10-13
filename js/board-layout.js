// ============================================================================
// [JS-BOARD-01] LOCAL, ACCESSIBLE INVESTIGATION BOARD LAYOUT
// Positions are presentation preferences, never evidence or cloud research.
// ============================================================================

export const BOARD_WIDTH = 1100;
export const BOARD_NODE_WIDTH = 218;
export const BOARD_NODE_HEIGHT = 76;
export const BOARD_PADDING = 20;
const LEFT_BY_TYPE = {claim:22, source:302, explanation:582, note:862};
const BOARD_ORDER = ['claim','source','explanation','note'];

export function clampBoardPosition(position, height) {
    const x = Number(position?.x);
    const y = Number(position?.y);
    return {
        x: Number.isFinite(x) ? Math.round(Math.max(BOARD_PADDING, Math.min(BOARD_WIDTH-BOARD_NODE_WIDTH-BOARD_PADDING, x))) : BOARD_PADDING,
        y: Number.isFinite(y) ? Math.round(Math.max(BOARD_PADDING, Math.min(height-BOARD_NODE_HEIGHT-BOARD_PADDING, y))) : BOARD_PADDING
    };
}

export function prepareBoardLayout(nodes, preferences={}, limit=32) {
    const ordered=[...nodes].sort((a,b)=>{
        const typeOrder=BOARD_ORDER.indexOf(a.type)-BOARD_ORDER.indexOf(b.type);
        return typeOrder || String(a.payload?.title||a.payload?.text||a.id).localeCompare(String(b.payload?.title||b.payload?.text||b.id));
    });
    const visible=ordered.slice(0,Math.max(1,Math.min(64,limit)));
    const counts={claim:0,source:0,explanation:0,note:0};
    const maxColumn=Math.max(1,...BOARD_ORDER.map(type=>visible.filter(r=>r.type===type).length));
    const height=Math.max(250, 30 + maxColumn * 112);
    const positions={};
    for(const node of visible) {
        const fallback={x:LEFT_BY_TYPE[node.type]??BOARD_PADDING,y:22+(counts[node.type]++||0)*112};
        positions[node.id]=clampBoardPosition(preferences[node.id]||fallback,height);
    }
    return {visible, positions, width:BOARD_WIDTH, height, hidden:Math.max(0,ordered.length-visible.length)};
}

export function boardEdgeCoordinates(from, to) {
    const x1=from.x+BOARD_NODE_WIDTH/2, y1=from.y+BOARD_NODE_HEIGHT/2;
    const x2=to.x+BOARD_NODE_WIDTH/2, y2=to.y+BOARD_NODE_HEIGHT/2;
    return {x1,y1,x2,y2};
}

export function applyBoardMove(current,dx,dy,height) {
    return clampBoardPosition({x:current.x+dx,y:current.y+dy},height);
}

// Where the window sits. Pure functions, so they can be tested without a screen.

const MARGIN = 12; // gap kept between the window and the screen edge
const MAGNET = 44; // a window dropped this close to an edge sticks to it

const CORNERS = ["top-left", "top-right", "bottom-left", "bottom-right"];

/** Bounds for a window of the given size tucked into a corner of the work area. */
function cornerBounds(corner, { width, height }, area, margin = MARGIN) {
  const left = corner.endsWith("left");
  const top = corner.startsWith("top");
  return {
    x: Math.round(left ? area.x + margin : area.x + area.width - width - margin),
    y: Math.round(top ? area.y + margin : area.y + area.height - height - margin),
    width, height,
  };
}

/** After a drag: pull the window flush to any edge it was dropped near, and keep it on screen. */
function snap(b, area, margin = MARGIN, magnet = MAGNET) {
  let { x, y } = b;
  const right = area.x + area.width - margin - b.width;
  const bottom = area.y + area.height - margin - b.height;
  if (Math.abs(x - (area.x + margin)) <= magnet) x = area.x + margin;
  else if (Math.abs(x - right) <= magnet) x = right;
  if (Math.abs(y - (area.y + margin)) <= magnet) y = area.y + margin;
  else if (Math.abs(y - bottom) <= magnet) y = bottom;
  x = Math.min(Math.max(x, area.x), area.x + area.width - b.width);
  y = Math.min(Math.max(y, area.y), area.y + area.height - b.height);
  return { x: Math.round(x), y: Math.round(y), width: b.width, height: b.height };
}

/** The corner a window is closest to (used to grow mini mode in the right direction). */
function nearestCorner(b, area) {
  const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
  const left = cx < area.x + area.width / 2;
  const top = cy < area.y + area.height / 2;
  return `${top ? "top" : "bottom"}-${left ? "left" : "right"}`;
}

/** Changes the height while keeping the edge nearest the screen edge in place. */
function resizeAnchored(b, height, area) {
  const top = nearestCorner(b, area).startsWith("top");
  const y = top ? b.y : b.y + b.height - height;
  return { x: b.x, y: Math.max(area.y, Math.round(y)), width: b.width, height };
}

module.exports = { MARGIN, MAGNET, CORNERS, cornerBounds, snap, nearestCorner, resizeAnchored };

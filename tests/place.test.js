const test = require("node:test");
const assert = require("node:assert/strict");
const place = require("../lib/place");

const area = { x: 0, y: 25, width: 1512, height: 920 };
const size = { width: 292, height: 440 };

test("corners sit inside the work area with the margin", () => {
  assert.deepEqual(place.cornerBounds("top-left", size, area), { x: 12, y: 37, ...size });
  assert.deepEqual(place.cornerBounds("bottom-right", size, area), { x: 1512 - 292 - 12, y: 25 + 920 - 440 - 12, ...size });
});

test("a window dropped near an edge sticks to it; far away it stays put", () => {
  assert.deepEqual(place.snap({ x: 30, y: 60, ...size }, area), { x: 12, y: 37, ...size });
  const mid = { x: 600, y: 300, ...size };
  assert.deepEqual(place.snap(mid, area), mid);
  const nearRight = place.snap({ x: 1512 - 292 - 40, y: 300, ...size }, area);
  assert.equal(nearRight.x, 1512 - 292 - 12);
});

test("a window dragged off screen comes back", () => {
  const b = place.snap({ x: 1700, y: -100, ...size }, area);
  assert.ok(b.x + b.width <= area.x + area.width);
  assert.ok(b.y >= area.y);
});

test("mini mode keeps the edge closest to the screen edge", () => {
  const bottom = place.cornerBounds("bottom-right", size, area);
  const mini = place.resizeAnchored(bottom, 46, area);
  assert.equal(mini.y + mini.height, bottom.y + bottom.height);
  const top = place.cornerBounds("top-left", size, area);
  assert.equal(place.resizeAnchored(top, 46, area).y, top.y);
});

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dockFrame, nearestEdge } from '../placement.ts';

test('all four docks remain within a negative-origin display', () => {
  const area = { x: -1600, y: 90, width: 1600, height: 850 };
  for (const edge of ['bottom', 'top', 'left', 'right'] as const) {
    const frame = dockFrame({ width: 360, height: 88 }, area, edge);
    assert.ok(frame.x >= area.x && frame.y >= area.y);
    assert.ok(frame.x + frame.width <= area.x + area.width);
    assert.ok(frame.y + frame.height <= area.y + area.height);
  }
  assert.equal(nearestEdge({ x: -800, y: 92 }, area), 'top');
  assert.equal(nearestEdge({ x: -1598, y: 500 }, area), 'left');
  assert.equal(dockFrame({ width: 360, height: 88 }, area, 'top').y, 102);
});

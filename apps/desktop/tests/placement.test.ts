import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dockFrame, nearestEdge } from '../src/main/placement.ts';

test('all four docks remain within a negative-origin display', () => {
  const area = { x: -1600, y: 90, width: 1600, height: 850 };
  for (const edge of ['bottom', 'top', 'left', 'right'] as const) {
    const frame = dockFrame({ width: 360, height: 88 }, area, edge, 28);
    assert.ok(frame.x >= area.x && frame.y >= area.y);
    assert.ok(frame.x + frame.width <= area.x + area.width);
    assert.ok(frame.y + frame.height <= area.y + area.height);
  }
  assert.equal(nearestEdge({ x: -800, y: 92 }, area), 'top');
  assert.equal(nearestEdge({ x: -1598, y: 500 }, area), 'left');
  assert.equal(dockFrame({ width: 360, height: 88 }, area, 'top', 28).y, 102);
});

test('side-docked pill stays centered as hover, recovery, and recording labels expand', () => {
  const area = { x: -1600, y: 90, width: 1600, height: 850 };
  for (const edge of ['left', 'right'] as const) {
    for (const [height, pillHeight] of [[8, 8], [68, 28], [102, 8], [126, 28]]) {
      const frame = dockFrame({ width: 360, height }, area, edge, pillHeight);
      assert.equal(frame.y + height - pillHeight / 2, area.y + area.height / 2);
    }
  }
});

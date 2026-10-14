import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dockFrame, dockWindow, nearestEdge, panelFrame, type Rectangle } from '../src/main/placement.ts';

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

test('docking at the height the system kept keeps the visible pill in place', () => {
  const area = { x: -1600, y: 90, width: 1600, height: 850 };
  // A minimum of 8 accepts every request, as X11 reports. Windows kept 39 for the 8 px handle; 50 stands for another system.
  for (const minimum of [8, 39, 50]) {
    for (const edge of ['bottom', 'top', 'left', 'right'] as const) {
      for (const [height, pillHeight] of [[8, 8], [28, 28], [68, 28]]) {
        const calls: Rectangle[] = [];
        let bounds: Rectangle = { x: 0, y: 0, width: 40, height: 8 };
        // Like Windows, the window keeps its minimum height and reports it when setBounds returns.
        const window = {
          getBounds: () => bounds,
          setBounds(next: Rectangle) { calls.push(next); bounds = { ...next, height: Math.max(minimum, next.height) }; },
        };
        dockWindow(window, { width: 40, height }, area, edge, pillHeight);
        // The renderer keeps the pill at the bottom of the window, or at its top for the top edge.
        const pillTop = edge === 'top' ? bounds.y : bounds.y + bounds.height - pillHeight;
        const sideTop = area.y + area.height / 2 - pillHeight / 2;
        const expected = { bottom: area.y + area.height - 12 - pillHeight, top: area.y + 12, left: sideTop, right: sideTop };
        assert.equal(pillTop, expected[edge]);
        assert.ok(bounds.y >= area.y && bounds.y + bounds.height <= area.y + area.height);
        assert.equal(calls.length, height < minimum ? 2 : 1);
        // Docking again at the current size, as after a display change, is one call that keeps the window in place.
        const docked = bounds;
        calls.length = 0;
        dockWindow(window, docked, area, edge, pillHeight);
        assert.deepEqual(calls, [docked]);
      }
    }
  }
});

test('the tray panel opens beside its icon, toward the screen, and stays on screen', () => {
  const size = { width: 340, height: 520 };
  // macOS: menu-bar icon near the right edge, above the work area.
  const mac = { x: 0, y: 25, width: 1512, height: 920 };
  const below = panelFrame(size, { x: 1400, y: 0, width: 24, height: 24 }, mac);
  assert.deepEqual(below, { x: 1512 - 340, y: 30, width: 340, height: 520 });
  // Windows: notification-area icon in a bottom taskbar, below the work area.
  const windows = { x: 0, y: 0, width: 1920, height: 1040 };
  const above = panelFrame(size, { x: 1700, y: 1048, width: 24, height: 24 }, windows);
  assert.deepEqual(above, { x: 1712 - 170, y: 1040 - 520, width: 340, height: 520 });
  // Linux trays that report no bounds open the panel in the top-right corner.
  assert.deepEqual(panelFrame(size, { x: 0, y: 0, width: 0, height: 0 }, windows), { x: 1920 - 340 - 12, y: 12, width: 340, height: 520 });
  // A short display limits the panel's height instead of pushing it off screen.
  assert.equal(panelFrame(size, { x: 10, y: 0, width: 24, height: 24 }, { x: 0, y: 25, width: 800, height: 400 }).height, 400);
});

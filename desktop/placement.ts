import type { DockEdge } from './contract.ts';

export interface Rectangle { x: number; y: number; width: number; height: number }

export function dockFrame(size: { width: number; height: number }, area: Rectangle, edge: DockEdge): Rectangle {
  const width = Math.min(size.width, area.width);
  const height = Math.min(size.height, area.height);
  const centeredX = area.x + (area.width - width) / 2;
  const centeredY = area.y + (area.height - height) / 2;
  const positions = {
    bottom: { x: centeredX, y: area.y + area.height - height - 12 },
    top: { x: centeredX, y: area.y + 12 },
    left: { x: area.x + 12, y: centeredY },
    right: { x: area.x + area.width - width - 12, y: centeredY },
  };
  return clampFrame({ ...positions[edge], width, height }, area);
}

export function clampFrame(frame: Rectangle, area: Rectangle): Rectangle {
  return { ...frame,
    x: Math.round(Math.max(area.x, Math.min(frame.x, area.x + area.width - frame.width))),
    y: Math.round(Math.max(area.y, Math.min(frame.y, area.y + area.height - frame.height))),
  };
}

export function nearestEdge(point: { x: number; y: number }, area: Rectangle): DockEdge {
  const distances: [DockEdge, number][] = [
    ['top', Math.abs(point.y - area.y)], ['bottom', Math.abs(point.y - area.y - area.height)],
    ['left', Math.abs(point.x - area.x)], ['right', Math.abs(point.x - area.x - area.width)],
  ];
  distances.sort((a, b) => a[1] - b[1]);
  return distances[0][0];
}

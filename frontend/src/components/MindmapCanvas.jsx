import React, { useMemo, useRef, useState } from "react";

/* ------------------ helpers ------------------ */

function addIds(node) {
  return {
    ...node,
    _id: crypto.randomUUID(),
    children: (node.children || []).map(addIds),
  };
}

export function buildMindmapRoot(mindmap, title) {
  if (!mindmap) return null;

  const root = Array.isArray(mindmap)
    ? { title: title || "Mind Map", children: mindmap }
    : {
        title: title || mindmap.title || "Mind Map",
        children: mindmap.children || [],
      };

  return addIds(root);
}

/* ------------------ layout ------------------ */

function layoutTree(node, x = 0, y = 0, level = 0, out = []) {
  const nodeX = x;
  const nodeY = y;

  out.push({
    id: node._id,
    title: node.title,
    x: nodeX,
    y: nodeY,
    parent: null,
  });

  const gapX = 220;
  const gapY = 120;

  const startX =
    x - ((node.children?.length || 0) - 1) * (gapX / 2);

  node.children?.forEach((child, i) => {
    const childX = startX + i * gapX;
    const childY = y + gapY;

    out.push({
      id: child._id,
      title: child.title,
      x: childX,
      y: childY,
      parent: node._id,
    });

    layoutTree(child, childX, childY, level + 1, out);
  });

  return out;
}

/* ------------------ component ------------------ */

export default function MindmapCanvas({ root }) {
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [scale, setScale] = useState(1);
  const dragging = useRef(false);

  const nodes = useMemo(() => {
    if (!root) return [];
    return layoutTree(root);
  }, [root]);

  const edges = nodes.filter((n) => n.parent);

  return (
    <div
      className="relative w-full h-[520px] overflow-hidden rounded-xl bg-black/30 border border-white/10"
      onMouseDown={() => (dragging.current = true)}
      onMouseUp={() => (dragging.current = false)}
      onMouseLeave={() => (dragging.current = false)}
      onMouseMove={(e) => {
        if (!dragging.current) return;
        setPan((p) => ({
          x: p.x + e.movementX,
          y: p.y + e.movementY,
        }));
      }}
      onWheel={(e) => {
        e.preventDefault();
        setScale((s) =>
          Math.min(2.5, Math.max(0.4, s + (e.deltaY > 0 ? -0.1 : 0.1)))
        );
      }}
    >
      <div
        className="absolute left-1/2 top-1/2"
        style={{
          transform: `translate(-50%, -50%) translate(${pan.x}px, ${pan.y}px) scale(${scale})`,
        }}
      >
        {/* connections */}
        <svg
          className="absolute inset-0 pointer-events-none"
          width="2000"
          height="2000"
        >
          {edges.map((n) => {
            const from = nodes.find((x) => x.id === n.parent);
            if (!from) return null;

            return (
              <path
                key={`${from.id}-${n.id}`}
                d={`M ${from.x} ${from.y + 30}
                    C ${from.x} ${from.y + 80},
                      ${n.x} ${n.y - 80},
                      ${n.x} ${n.y}`}
                stroke="rgba(56,189,248,0.6)"
                strokeWidth="2"
                fill="none"
              />
            );
          })}
        </svg>

        {/* nodes */}
        {nodes.map((n) => (
          <div
            key={n.id}
            className="absolute px-4 py-2 rounded-xl bg-cyan-500/20 border border-cyan-400/40 text-sm text-white font-semibold"
            style={{
              left: n.x,
              top: n.y,
              transform: "translate(-50%, -50%)",
            }}
          >
            {n.title}
          </div>
        ))}
      </div>

      <div className="absolute bottom-2 right-3 text-[11px] text-slate-400">
        Drag to move · Scroll to zoom
      </div>
    </div>
  );
}

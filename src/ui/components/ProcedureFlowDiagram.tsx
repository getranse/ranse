import { useMemo } from 'react';
import type { DiagramEdge, DiagramNode } from '../../procedures/diagram';
import { layoutProcedure } from '../../procedures/diagram';
import type { ProcedureSpec } from '../../types/procedure';

// SVG renderer for a procedure flow. Pure data → DOM, no interactivity
// beyond the operator hovering edges/nodes (tooltip is the node title
// attribute). Layout math is `src/procedures/diagram.ts`; this file is
// strictly presentation so the diagram is easy to swap for a richer
// renderer later (mermaid, react-flow) without touching the spec-shape
// contract.

interface ProcedureFlowDiagramProps {
  spec: ProcedureSpec;
  maxHeight?: number;
}

const COLORS = {
  terminal: '#111827',
  process: '#1f2937',
  io: '#0369a1',
  decision: '#a16207',
  loop: '#7c3aed',
  approval: '#b91c1c',
  edge: '#94a3b8',
  edgeLabel: '#475569',
  fill: '#ffffff',
  fillSubtle: '#f8fafc',
  fillApproval: '#fff1f2',
};

export function ProcedureFlowDiagram({ spec, maxHeight = 720 }: ProcedureFlowDiagramProps) {
  const diagram = useMemo(() => layoutProcedure(spec), [spec]);

  return (
    <div
      style={{
        maxHeight,
        overflow: 'auto',
        border: '1px solid #e5e7eb',
        borderRadius: 8,
        background: COLORS.fillSubtle,
      }}
    >
      <svg
        role="img"
        aria-label={`Flow diagram for ${spec.name}`}
        width={diagram.width}
        height={diagram.height}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <marker
            id="ranse-arrow"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M 0 0 L 10 5 L 0 10 z" fill={COLORS.edge} />
          </marker>
        </defs>
        {diagram.edges.map((edge, idx) => renderEdge(diagram.nodes, edge, idx))}
        {diagram.nodes.map((node) => renderNode(node))}
      </svg>
    </div>
  );
}

function renderNode(node: DiagramNode) {
  const baseStyle = {
    stroke: nodeStrokeColor(node),
    strokeWidth: node.shape === 'loop_container' ? 2 : 1.5,
    fill: node.approvalGate ? COLORS.fillApproval : COLORS.fill,
  };
  return (
    <g key={node.id} transform={`translate(${node.x}, ${node.y})`}>
      <title>{`${node.label}${node.sublabel ? ` — ${node.sublabel}` : ''}`}</title>
      {renderShape(node, baseStyle)}
      <text
        x={node.width / 2}
        y={node.sublabel ? node.height / 2 - 4 : node.height / 2 + 4}
        textAnchor="middle"
        dominantBaseline="middle"
        fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
        fontSize={13}
        fontWeight={600}
        fill={nodeStrokeColor(node)}
      >
        {truncate(node.label, 32)}
      </text>
      {node.sublabel && (
        <text
          x={node.width / 2}
          y={node.height / 2 + 12}
          textAnchor="middle"
          dominantBaseline="middle"
          fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
          fontSize={11}
          fill="#475569"
        >
          {truncate(node.sublabel, 40)}
        </text>
      )}
      {node.approvalGate && (
        <text
          x={node.width - 6}
          y={14}
          textAnchor="end"
          fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
          fontSize={10}
          fontWeight={700}
          fill={COLORS.approval}
        >
          APPROVAL
        </text>
      )}
    </g>
  );
}

interface ShapeStyle {
  stroke: string;
  strokeWidth: number;
  fill: string;
}

function renderShape(node: DiagramNode, style: ShapeStyle) {
  const w = node.width;
  const h = node.height;
  if (node.shape === 'terminal') {
    return <rect width={w} height={h} rx={h / 2} ry={h / 2} {...style} />;
  }
  if (node.shape === 'decision') {
    return <polygon points={`${w / 2},0 ${w},${h / 2} ${w / 2},${h} 0,${h / 2}`} {...style} />;
  }
  if (node.shape === 'io') {
    const skew = 12;
    return <polygon points={`${skew},0 ${w},0 ${w - skew},${h} 0,${h}`} {...style} />;
  }
  if (node.shape === 'loop_container') {
    return (
      <>
        <rect width={w} height={h} rx={6} ry={6} {...style} />
        <rect
          x={3}
          y={3}
          width={w - 6}
          height={h - 6}
          rx={4}
          ry={4}
          fill="transparent"
          stroke={nodeStrokeColor(node)}
          strokeWidth={1}
        />
      </>
    );
  }
  return <rect width={w} height={h} rx={6} ry={6} {...style} />;
}

function renderEdge(nodes: DiagramNode[], edge: DiagramEdge, idx: number) {
  const from = nodes.find((n) => n.id === edge.fromId);
  const to = nodes.find((n) => n.id === edge.toId);
  if (!from || !to) return null;
  const start = { x: from.x + from.width / 2, y: from.y + from.height };
  const end = { x: to.x + to.width / 2, y: to.y };
  // Right-angle path when columns differ, straight line when same column.
  const midY = start.y + (end.y - start.y) / 2;
  const d =
    Math.abs(end.x - start.x) < 4
      ? `M ${start.x},${start.y} L ${end.x},${end.y - 8}`
      : `M ${start.x},${start.y} L ${start.x},${midY} L ${end.x},${midY} L ${end.x},${end.y - 8}`;
  return (
    <g key={`edge-${idx}`}>
      <path
        d={d}
        stroke={COLORS.edge}
        strokeWidth={1.5}
        fill="none"
        markerEnd="url(#ranse-arrow)"
      />
      {edge.label && (
        <text
          x={(start.x + end.x) / 2 + 6}
          y={midY - 4}
          fontFamily="system-ui, -apple-system, Segoe UI, sans-serif"
          fontSize={11}
          fontWeight={600}
          fill={COLORS.edgeLabel}
        >
          {edge.label}
        </text>
      )}
    </g>
  );
}

function nodeStrokeColor(node: DiagramNode): string {
  if (node.approvalGate) return COLORS.approval;
  if (node.shape === 'decision') return COLORS.decision;
  if (node.shape === 'io') return COLORS.io;
  if (node.shape === 'loop_container') return COLORS.loop;
  return COLORS.process;
}

function truncate(value: string, max: number): string {
  return value.length > max ? `${value.slice(0, max - 1)}…` : value;
}

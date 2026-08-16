export function addDrawSegmentsShape(store: Record<string, unknown>): void {
  store["shape:draw-segments"] = {
    id: "shape:draw-segments",
    typeName: "shape",
    type: "draw",
    x: 0,
    y: 0,
    rotation: 0,
    index: "a4",
    parentId: "page:page-1",
    props: {
      color: "black",
      dash: "draw",
      fill: "none",
      isClosed: false,
      isComplete: true,
      isPen: false,
      scale: 1,
      scaleX: 1,
      scaleY: 1,
      segments: [{ type: "free", path: "AAAAAAAAAAAAAAA/uLJmLgAAZrZSNAAAuL2uOQAAOMHNPQAAQ8RSPQAA88RmPAAAYcZSPAAAvcGFNwAA9r17OAAAuLZmMgAACq8K" }],
      size: "m"
    }
  };
}

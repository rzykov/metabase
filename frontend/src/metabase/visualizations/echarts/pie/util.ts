import { checkNotNull } from "metabase/lib/types";

import type { SliceTree, SliceTreeNode } from "./model/types";

export function getSliceTreeNodesFromPath(
  sliceTree: SliceTree,
  path: string[],
) {
  let sliceTreeNode: SliceTreeNode | undefined = undefined;
  const nodes: SliceTreeNode[] = [];

  for (const key of path) {
    const currentSliceTree: SliceTree =
      sliceTreeNode == null ? sliceTree : sliceTreeNode.children;

    sliceTreeNode = checkNotNull(currentSliceTree.get(key));
    nodes.push(sliceTreeNode);
  }

  return { sliceTreeNode: checkNotNull(sliceTreeNode), nodes };
}

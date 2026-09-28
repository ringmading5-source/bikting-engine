export type TaskNodeStatus = "PENDING" | "READY" | "RUNNING" | "BLOCKED" | "VALIDATING" | "FAILED" | "COMPLETED";
export interface TaskNode { id: string; dependsOn: readonly string[]; status: TaskNodeStatus; objective: string; resultReference?: string }
export interface TaskGraph { projectId: string; nodes: TaskNode[] }

export function refreshReady(graph: TaskGraph): TaskGraph {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  if (byId.size !== graph.nodes.length) throw new Error("Duplicate task ID.");
  for (const node of graph.nodes) for (const dependency of node.dependsOn) if (!byId.has(dependency) || dependency === node.id) throw new Error(`Invalid dependency: ${dependency}`);
  const visited = new Set<string>(), visiting = new Set<string>();
  const visit = (id: string): void => { if (visiting.has(id)) throw new Error("Task dependency cycle."); if (visited.has(id)) return; visiting.add(id); for (const dep of byId.get(id)!.dependsOn) visit(dep); visiting.delete(id); visited.add(id); };
  for (const node of graph.nodes) visit(node.id);
  return { projectId: graph.projectId, nodes: graph.nodes.map((node) => node.status === "PENDING" && node.dependsOn.every((id) => byId.get(id)?.status === "COMPLETED") ? { ...node, status: "READY" } : { ...node }) };
}

export function transitionTask(graph: TaskGraph, id: string, status: TaskNodeStatus, resultReference?: string): TaskGraph {
  const node = graph.nodes.find((item) => item.id === id);
  if (!node) throw new Error(`Unknown task: ${id}`);
  const allowed: Record<TaskNodeStatus, readonly TaskNodeStatus[]> = { PENDING: ["BLOCKED"], READY: ["RUNNING", "BLOCKED"], RUNNING: ["VALIDATING", "FAILED", "BLOCKED"], VALIDATING: ["COMPLETED", "FAILED"], BLOCKED: ["READY", "FAILED"], FAILED: [], COMPLETED: [] };
  if (!allowed[node.status].includes(status)) throw new Error(`Invalid task transition: ${node.status} -> ${status}`);
  if (status === "COMPLETED" && !resultReference) throw new Error("Completed tasks require a validated result reference.");
  return refreshReady({ ...graph, nodes: graph.nodes.map((item) => item.id === id ? { ...item, status, resultReference } : { ...item }) });
}

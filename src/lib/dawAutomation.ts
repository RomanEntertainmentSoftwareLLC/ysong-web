export type AutomationParameter = "track:level" | "track:pan" | `effect:${string}:thresholdDb`;
export type AutomationPoint = { id: string; bar: number; value: number };
export type AutomationLane = { parameter: AutomationParameter; enabled: boolean; interpolation: "linear" | "step"; points: AutomationPoint[] };

export const automationBounds: Record<"track:level" | "track:pan", [number, number]> = {
  "track:level": [0, 127], "track:pan": [-1, 1],
};

export function normalizeAutomationLanes(raw: unknown): AutomationLane[] {
  if (!Array.isArray(raw)) return [];
  const seen = new Set<AutomationParameter>();
  return raw.flatMap((entry: unknown): AutomationLane[] => {
    if (!entry || typeof entry !== "object") return [];
    const lane = entry as Partial<AutomationLane>;
    if (lane.parameter !== "track:level" && lane.parameter !== "track:pan" && !(typeof lane.parameter === "string" && /^effect:[^:]+:thresholdDb$/.test(lane.parameter))) return [];
    if (seen.has(lane.parameter)) return [];
    seen.add(lane.parameter);
    const [min, max] = lane.parameter.startsWith("effect:") ? [-60, 0] : automationBounds[lane.parameter as "track:level" | "track:pan"];
    const points = Array.isArray(lane.points) ? lane.points.flatMap((point): AutomationPoint[] => {
      if (!point || typeof point !== "object" || !Number.isFinite(point.bar) || !Number.isFinite(point.value)) return [];
      return [{ id: typeof point.id === "string" && point.id ? point.id : crypto.randomUUID(), bar: Math.max(1, point.bar), value: Math.max(min, Math.min(max, point.value)) }];
    }) : [];
    return [{ parameter: lane.parameter, enabled: lane.enabled !== false, interpolation: lane.interpolation === "step" ? "step" : "linear", points: points.sort((a, b) => a.bar - b.bar) }];
  });
}

export function automationValue(lane: AutomationLane | undefined, bar: number, fallback: number): number {
  if (!lane?.enabled || lane.points.length === 0) return fallback;
  const points = lane.points;
  if (bar <= points[0].bar) return points[0].value;
  for (let index = 1; index < points.length; index++) {
    if (bar <= points[index].bar) {
      const previous = points[index - 1], next = points[index];
      if (lane.interpolation === "step") return previous.value;
      return previous.value + (next.value - previous.value) * (bar - previous.bar) / Math.max(0.000001, next.bar - previous.bar);
    }
  }
  return points[points.length - 1].value;
}

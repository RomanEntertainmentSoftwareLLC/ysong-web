import type { CritiqueFinding } from "./api";

export type CritiqueRepairPass = "deClick" | "repairMicroGaps" | "softenEnd";

/** Only measured findings with a matching surgical Humanize pass can propose a repair. */
export function critiqueRepairPass(finding: CritiqueFinding): CritiqueRepairPass | null {
  if (finding.suggested_action === "repair_click" && ["transient_click", "click", "click_candidate"].includes(finding.type)) return "deClick";
  if (finding.suggested_action === "repair_gap" && ["micro_gap", "gap", "dropout"].includes(finding.type)) return "repairMicroGaps";
  if (finding.suggested_action === "repair_tail" && ["abrupt_end", "abrupt_cutoff", "terminal_click"].includes(finding.type)) return "softenEnd";
  return null;
}

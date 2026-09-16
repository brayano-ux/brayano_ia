export type LeadStatus =
  | "NEW"
  | "QUALIFYING"
  | "QUALIFIED"
  | "ROUTED"
  | "CONTACTED"
  | "CONVERTED"
  | "LOST";

export type LeadConsentStatus = "unknown" | "granted" | "refused";

export type LeadRouteStatus = "pending" | "sent" | "failed";

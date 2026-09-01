/** What a chat sees of each existing Agent when drafting a cast (app.ts's /draft-plan route). */
export interface CapabilityCandidate {
  id: string;
  name: string;
  capabilitySummary: string;
}

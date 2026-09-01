/** What a chat's instructions embed for each existing Agent it may cast (see agent-service.ts's createAgent). */
export interface CapabilityCandidate {
  id: string;
  name: string;
  capabilitySummary: string;
}

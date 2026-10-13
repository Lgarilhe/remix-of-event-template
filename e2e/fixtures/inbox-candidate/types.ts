export type Row = Record<string, unknown>;
export type Operation = [method: string, args: unknown[]];
export interface CandidateFixtureState {
  userId: string;
  organizationId: string;
  organizationType: 'agency' | 'enterprise' | 'freelance';
  accountId: string | null;
  accountsReady: boolean;
  mappingsReady: boolean;
}
export interface CandidateFixtureWindow extends Window {
  qaCandidateState: CandidateFixtureState;
  qaCandidatePatch: (patch: Partial<CandidateFixtureState>) => void;
  qaCandidateTables: Record<string, Row[]>;
  qaCandidateQueries: Array<{ table: string; operations: Operation[] }>;
  qaCandidateCalls: Array<{ name: string; body: Row }>;
  qaCandidateWrites: Array<{ table: string; operations: Operation[] }>;
  qaCandidateNotificationWrites: Array<{ table: string; operations: Operation[] }>;
  qaCandidateFailures: string[];
  qaCandidateAllowedWrites?: string[];
  qaCandidateDelayTable?: string;
  qaCandidateDelayOrg?: string;
  qaCandidateRelease?: () => void;
  qaCandidateAddress: string;
  qaCandidateInvalidations: () => void;
  axe: { run: (node: Document, options: import('axe-core').RunOptions) => Promise<import('axe-core').AxeResults> };
}

export type Row = Record<string, unknown>;
export type QueryOperation = [method: string, args: unknown[]];
export interface ProfileFixtureState {
  userId: string | null;
  organizationId: string | null;
  accountId: string | null;
  accountsReady: boolean;
  mappingsReady: boolean;
  profileId: string | null;
  profileUrl: string | null;
  profileName: string;
  aliases: string[];
}
export interface ProfileFixtureWindow extends Window {
  qaProfileState: ProfileFixtureState;
  qaProfilePatch: (patch: Partial<ProfileFixtureState>) => void;
  qaProfileInvalidate: () => void;
  qaProfileTables: Record<string, Row[]>;
  qaProfileQueries: Array<{ table: string; operations: QueryOperation[] }>;
  qaProfileCalls: Array<Row>;
  qaProfileQuota: Array<{ type: string; count: number; accountId?: string }>;
  qaProfileQueryDelay?: number;
  qaProfileQueryErrors?: string[];
  qaProfileMissingColumns?: string[];
  axe: { run: (node: Document, options: import('axe-core').RunOptions) => Promise<import('axe-core').AxeResults> };
}

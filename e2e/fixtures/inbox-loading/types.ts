export type Row = Record<string, unknown>;
export type FixtureState = Partial<Record<'authReady' | 'orgReady' | 'accountsReady' | 'accountsLoading' | 'accountsError' | 'mappingsReady' | 'mappingsError' | 'mapping', boolean>>;
export type QueryOperation = [method: string, args: unknown[]];
interface FixtureControls {
  qaState: FixtureState;
  qaSetState: (patch: FixtureState) => void;
  qaTables: Record<string, Row[]>;
  qaCalls?: Array<{ name: string; body: Row; at: number }>;
  qaQueries?: Array<{ table: string; operations: QueryOperation[]; at: number }>;
  qaTableDelays?: Record<string, number>;
  qaFailTable?: string;
  qaReloads?: number;
}

declare global {
  interface Window extends FixtureControls {
    axe: { run: (node: Document, options: import('axe-core').RunOptions) => Promise<import('axe-core').AxeResults> };
  }
}
export type FixtureWindow = Window;

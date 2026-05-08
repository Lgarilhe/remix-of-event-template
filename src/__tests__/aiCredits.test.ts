/**
 * Unit tests for the AI credits system.
 * Run with: npx vitest run src/__tests__/aiCredits.test.ts
 *
 * Tests the core credit calculation logic that protects margins.
 */

import { describe, it, expect } from 'vitest';
import {
  estimateCredits,
  resolveModel,
  getDefaultModel,
  MODEL_CATALOG,
  ACTION_COSTS,
  CREDIT_PACKS,
} from '../types/aiCredits';

// ─── estimateCredits ────────────────────────────────────────────────────────

describe('estimateCredits', () => {
  it('returns floor when tokens are very low', () => {
    // Gemini Flash with 4000 typical tokens: ceil(4000/1000 * 0.15) = ceil(0.6) = 1
    // Floor for scoring is 2, so max(2, 1) = 2
    const cost = estimateCredits('scoring', 'gemini-2.5-flash');
    expect(cost).toBe(2);
  });

  it('returns calculated value when above floor', () => {
    // Sonnet 4.6 with 4000 tokens: ceil(4000/1000 * 1.0) = 4
    // Floor for scoring is 2, so max(2, 4) = 4
    const cost = estimateCredits('scoring', 'claude-sonnet-4-6');
    expect(cost).toBe(4);
  });

  it('Opus costs more than Sonnet for same action', () => {
    const sonnet = estimateCredits('scoring', 'claude-sonnet-4-6');
    const opus = estimateCredits('scoring', 'claude-opus-4-6');
    expect(opus).toBeGreaterThan(sonnet);
  });

  it('Haiku costs less than Sonnet for same action', () => {
    const haiku = estimateCredits('scoring', 'claude-haiku-4-5');
    const sonnet = estimateCredits('scoring', 'claude-sonnet-4-6');
    expect(haiku).toBeLessThanOrEqual(sonnet);
  });

  it('returns 1 for unknown action', () => {
    const cost = estimateCredits('nonexistent_action', 'claude-sonnet-4-6');
    expect(cost).toBe(1);
  });

  it('uses multiplier 1.0 for unknown model', () => {
    // Unknown model defaults to multiplier 1.0
    // scoring: ceil(4000/1000 * 1.0) = 4
    const cost = estimateCredits('scoring', 'unknown-model');
    expect(cost).toBe(4);
  });

  it('live coaching costs more than scoring', () => {
    const scoring = estimateCredits('scoring', 'claude-sonnet-4-6');
    const coaching = estimateCredits('live_coaching', 'claude-sonnet-4-6');
    expect(coaching).toBeGreaterThan(scoring);
  });

  it('agent search run is the most expensive action', () => {
    const agentRun = estimateCredits('agent_search_run', 'claude-sonnet-4-6');
    const scoring = estimateCredits('scoring', 'claude-sonnet-4-6');
    expect(agentRun).toBeGreaterThan(scoring * 3);
  });
});

// ─── resolveModel ───────────────────────────────────────────────────────────

describe('resolveModel', () => {
  it('returns default model when no override', () => {
    const model = resolveModel('default');
    expect(model).toBe('claude-sonnet-4-6');
  });

  it('returns fast model for fast tier', () => {
    const model = resolveModel('fast');
    expect(model).toBe('claude-haiku-4-5');
  });

  it('returns thinking model for thinking tier', () => {
    const model = resolveModel('thinking');
    expect(model).toBe('claude-sonnet-4-5');
  });

  it('user override takes priority over everything', () => {
    const model = resolveModel('default', 'claude-opus-4-6', 'claude-haiku-4-5');
    expect(model).toBe('claude-opus-4-6');
  });

  it('org default takes priority over routing for default tier', () => {
    const model = resolveModel('default', null, 'claude-opus-4-6');
    expect(model).toBe('claude-opus-4-6');
  });

  it('org default is IGNORED for fast tier (protects margin)', () => {
    const model = resolveModel('fast', null, 'claude-opus-4-6');
    expect(model).toBe('claude-haiku-4-5');
  });

  it('invalid user override falls back to routing default', () => {
    const model = resolveModel('default', 'nonexistent-model');
    expect(model).toBe('claude-sonnet-4-6');
  });

  it('action.autoDefault is honored when no user/org override (scoring → Haiku)', () => {
    const model = resolveModel('default', null, null, 'scoring');
    expect(model).toBe('claude-haiku-4-5');
  });

  it('orgDefault still wins over autoDefault', () => {
    const model = resolveModel('default', null, 'claude-opus-4-6', 'scoring');
    expect(model).toBe('claude-opus-4-6');
  });

  it('userOverride still wins over autoDefault', () => {
    const model = resolveModel('default', 'claude-sonnet-4-6', null, 'scoring');
    expect(model).toBe('claude-sonnet-4-6');
  });

  it('autoDefault falls back to tier default when action has none', () => {
    const model = resolveModel('default', null, null, 'outreach_message');
    expect(model).toBe('claude-sonnet-4-6');
  });
});

// ─── MODEL_CATALOG ──────────────────────────────────────────────────────────

describe('MODEL_CATALOG', () => {
  it('has all 6 models', () => {
    expect(Object.keys(MODEL_CATALOG).length).toBe(6);
  });

  it('all models have required fields', () => {
    for (const model of Object.values(MODEL_CATALOG)) {
      expect(model.id).toBeTruthy();
      expect(model.name).toBeTruthy();
      expect(model.provider).toMatch(/^(anthropic|google)$/);
      expect(model.tier).toMatch(/^(budget|balanced|premium)$/);
      expect(model.multiplier).toBeGreaterThan(0);
      expect(model.contextWindow).toBeGreaterThan(0);
    }
  });

  it('Sonnet 4.6 is the baseline (multiplier 1.0)', () => {
    expect(MODEL_CATALOG['claude-sonnet-4-6'].multiplier).toBe(1.0);
  });

  it('Opus is more expensive than Sonnet', () => {
    expect(MODEL_CATALOG['claude-opus-4-6'].multiplier).toBeGreaterThan(
      MODEL_CATALOG['claude-sonnet-4-6'].multiplier
    );
  });

  it('Haiku is cheaper than Sonnet', () => {
    expect(MODEL_CATALOG['claude-haiku-4-5'].multiplier).toBeLessThan(
      MODEL_CATALOG['claude-sonnet-4-6'].multiplier
    );
  });

  it('Gemini Flash is the cheapest', () => {
    const flash = MODEL_CATALOG['gemini-2.5-flash'].multiplier;
    for (const model of Object.values(MODEL_CATALOG)) {
      expect(flash).toBeLessThanOrEqual(model.multiplier);
    }
  });
});

// ─── ACTION_COSTS ───────────────────────────────────────────────────────────

describe('ACTION_COSTS', () => {
  it('all actions have required fields', () => {
    for (const action of Object.values(ACTION_COSTS)) {
      expect(action.action).toBeTruthy();
      expect(action.label).toBeTruthy();
      expect(action.floor).toBeGreaterThanOrEqual(1);
      expect(action.typicalTokens).toBeGreaterThan(0);
      expect(action.routingTier).toMatch(/^(fast|default|thinking)$/);
      expect(action.category).toMatch(/^(sourcing|outreach|qualification|agent)$/);
    }
  });

  it('floor is always >= 1', () => {
    for (const action of Object.values(ACTION_COSTS)) {
      expect(action.floor).toBeGreaterThanOrEqual(1);
    }
  });

  it('scoring action exists with correct routing', () => {
    expect(ACTION_COSTS.scoring).toBeDefined();
    expect(ACTION_COSTS.scoring.routingTier).toBe('default');
  });

  it('fast tier actions use less tokens', () => {
    const fastActions = Object.values(ACTION_COSTS).filter(a => a.routingTier === 'fast');
    const defaultActions = Object.values(ACTION_COSTS).filter(a => a.routingTier === 'default');

    const avgFast = fastActions.reduce((s, a) => s + a.typicalTokens, 0) / fastActions.length;
    const avgDefault = defaultActions.reduce((s, a) => s + a.typicalTokens, 0) / defaultActions.length;

    expect(avgFast).toBeLessThan(avgDefault);
  });
});

// ─── CREDIT_PACKS ───────────────────────────────────────────────────────────

describe('CREDIT_PACKS', () => {
  it('has 3 packs', () => {
    expect(CREDIT_PACKS.length).toBe(3);
  });

  it('price per credit decreases with pack size', () => {
    for (let i = 1; i < CREDIT_PACKS.length; i++) {
      expect(CREDIT_PACKS[i].price_per_credit_cents).toBeLessThan(
        CREDIT_PACKS[i - 1].price_per_credit_cents
      );
    }
  });

  it('all packs have positive credits and price', () => {
    for (const pack of CREDIT_PACKS) {
      expect(pack.credits).toBeGreaterThan(0);
      expect(pack.price_eur).toBeGreaterThan(0);
    }
  });
});

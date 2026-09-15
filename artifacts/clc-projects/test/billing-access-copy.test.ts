import assert from 'node:assert/strict';
import test from 'node:test';
import type { EffectiveBillingAccess } from '@workspace/api-client-react';
import { getBillingAccessPresentation } from '../src/lib/billing-access-copy.ts';

const access = (
  state: EffectiveBillingAccess['state'],
  subscriptionStatus: string | null = null,
  billingConfigured = true,
): EffectiveBillingAccess => ({
  billingConfigured,
  state,
  subscriptionStatus,
  cancelAtPeriodEnd: state === 'scheduled_cancellation',
  planId: null,
  planName: null,
  entitlements: {},
});

test('explains active and trialing access separately', () => {
  assert.equal(getBillingAccessPresentation(access('active', 'active')).label, 'Active');
  assert.equal(getBillingAccessPresentation(access('active', 'trialing')).label, 'Trial active');
  assert.equal(getBillingAccessPresentation(access('active', 'trialing')).showRecoveryAction, false);
});

test('offers the billing portal for grace, scheduled cancellation, and suspension', () => {
  for (const [state, status] of [
    ['grace_period', 'past_due'],
    ['scheduled_cancellation', 'active'],
    ['suspended', 'unpaid'],
    ['suspended', 'canceled'],
  ] as const) {
    const presentation = getBillingAccessPresentation(access(state, status));
    assert.equal(presentation.showRecoveryAction, true);
  }
});

test('distinguishes an unconfigured workspace from a configured workspace without a subscription', () => {
  const configured = getBillingAccessPresentation(access('not_subscribed', null, true));
  const unconfigured = getBillingAccessPresentation(access('not_subscribed', null, false));

  assert.equal(configured.title, 'No active subscription');
  assert.equal(configured.showRecoveryAction, true);
  assert.equal(unconfigured.title, 'Billing is not set up');
  assert.equal(unconfigured.showRecoveryAction, false);
});
import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PLATFORM_CUSTOMER_SETUP_FAILURE_MESSAGE,
  canSubmitPlatformCustomerCreation,
  needsOwnerInvitationRetry,
  platformCustomerCreationMessage,
} from '../src/lib/platform-customer-recovery.ts';

test('shows the server recovery message instead of replacing it with a generic error', () => {
  const serverMessage = 'Customer workspace setup failed. No workspace was created. Please try again.';

  assert.equal(
    platformCustomerCreationMessage({ data: { error: serverMessage } }),
    serverMessage,
  );
  assert.equal(platformCustomerCreationMessage(new Error('network failure')), PLATFORM_CUSTOMER_SETUP_FAILURE_MESSAGE);
});

test('keeps the customer form retryable after setup failure', () => {
  assert.equal(canSubmitPlatformCustomerCreation(false, 1), true);
  assert.equal(canSubmitPlatformCustomerCreation(true, 1), false);
  assert.equal(canSubmitPlatformCustomerCreation(false, 0), false);
});

test('recognizes a created workspace that needs an owner invitation retry', () => {
  assert.equal(needsOwnerInvitationRetry('failed'), true);
  assert.equal(needsOwnerInvitationRetry('created'), false);
  assert.equal(needsOwnerInvitationRetry('not_requested'), false);
});

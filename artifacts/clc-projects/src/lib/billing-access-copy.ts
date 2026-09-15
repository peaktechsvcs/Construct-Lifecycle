import type { EffectiveBillingAccess } from '@workspace/api-client-react';

export type BillingAccessPresentation = {
  label: string;
  title: string;
  description: string;
  tone: 'green' | 'orange' | 'red' | 'neutral';
  showRecoveryAction: boolean;
};

export function getBillingAccessPresentation(
  access: EffectiveBillingAccess,
): BillingAccessPresentation {
  if (access.state === 'active' && access.subscriptionStatus === 'trialing') {
    return {
      label: 'Trial active',
      title: 'Trial access is active',
      description: 'Your workspace has access to its current plan during the trial.',
      tone: 'green',
      showRecoveryAction: false,
    };
  }

  switch (access.state) {
    case 'active':
      return {
        label: 'Active',
        title: 'Workspace access is active',
        description: 'Your workspace has access to its current plan.',
        tone: 'green',
        showRecoveryAction: false,
      };
    case 'grace_period':
      return {
        label: 'Payment retry grace period',
        title: 'Payment needs attention',
        description: 'Your workspace still has access while Stripe retries the payment. Update the payment method in the billing portal to avoid interruption.',
        tone: 'orange',
        showRecoveryAction: true,
      };
    case 'scheduled_cancellation':
      return {
        label: 'Cancellation scheduled',
        title: 'Access continues until the current period ends',
        description: 'Your workspace remains active until the scheduled cancellation. Reactivate the subscription in the billing portal to keep access afterward.',
        tone: 'orange',
        showRecoveryAction: true,
      };
    case 'suspended':
      return {
        label: 'Suspended',
        title: 'Workspace access is suspended',
        description: 'Paid workspace features are unavailable until billing is restored. Open the billing portal to update payment details or resume the subscription.',
        tone: 'red',
        showRecoveryAction: true,
      };
    case 'not_subscribed':
      return {
        label: 'Not subscribed',
        title: access.billingConfigured ? 'No active subscription' : 'Billing is not set up',
        description: access.billingConfigured
          ? 'Paid workspace features require an active subscription. Choose a plan below or review billing in the Stripe portal.'
          : 'This workspace does not have a connected subscription. Access is currently managed by the platform.',
        tone: 'neutral',
        showRecoveryAction: access.billingConfigured,
      };
  }
}
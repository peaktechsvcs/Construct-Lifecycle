export const PLATFORM_CUSTOMER_SETUP_FAILURE_MESSAGE =
  'Customer workspace setup failed. No workspace was created. Please try again.';

export function platformCustomerCreationMessage(error: unknown): string {
  const data = error && typeof error === 'object' ? (error as { data?: unknown }).data : null;
  const message = data && typeof data === 'object' ? (data as { error?: unknown }).error : null;
  return typeof message === 'string' && message.trim()
    ? message
    : PLATFORM_CUSTOMER_SETUP_FAILURE_MESSAGE;
}

export function canSubmitPlatformCustomerCreation(isPending: boolean, businessTypeCount: number): boolean {
  return !isPending && businessTypeCount > 0;
}

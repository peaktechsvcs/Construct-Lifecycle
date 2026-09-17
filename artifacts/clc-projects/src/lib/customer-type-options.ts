export const CUSTOMER_TYPE_OPTIONS = [
  { value: 'business', label: 'Business' },
  { value: 'builder', label: 'Builder' },
  { value: 'designer', label: 'Designer / architect' },
  { value: 'homeowner', label: 'Homeowner' },
  { value: 'developer', label: 'Developer' },
  { value: 'property_manager', label: 'Property manager' },
  { value: 'supplier', label: 'Supplier' },
  { value: 'subcontractor', label: 'Subcontractor' },
  { value: 'other', label: 'Other' },
] as const;

export function customerTypeOptions(current?: string) {
  if (!current || CUSTOMER_TYPE_OPTIONS.some((option) => option.value === current)) {
    return CUSTOMER_TYPE_OPTIONS;
  }
  return [{ value: current, label: current }, ...CUSTOMER_TYPE_OPTIONS];
}
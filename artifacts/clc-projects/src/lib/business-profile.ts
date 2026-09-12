import { BusinessType, type BusinessType as BusinessTypeValue } from '@workspace/api-client-react';

export const BUSINESS_TYPE_OPTIONS: Array<{
  value: BusinessTypeValue;
  label: string;
  description: string;
}> = [
  {
    value: BusinessType['general-contractor'],
    label: 'General contractor',
    description: 'Contracts, schedules, project controls, and delivery oversight.',
  },
  {
    value: BusinessType.subcontractor,
    label: 'Subcontractor / trade contractor',
    description: 'Trade scopes, compliance, billing, and closeout responsibilities.',
  },
  {
    value: BusinessType.supplier,
    label: 'Material supplier',
    description: 'Products, quotes, orders, deliveries, and receiving.',
  },
];

export const businessTypeLabel = (value: BusinessTypeValue) =>
  BUSINESS_TYPE_OPTIONS.find((option) => option.value === value)?.label ?? value;

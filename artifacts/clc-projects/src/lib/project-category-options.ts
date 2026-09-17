export const PROJECT_CATEGORY_OPTIONS = [
  { value: 'Residential', label: 'Residential' },
  { value: 'Commercial', label: 'Commercial' },
  { value: 'Multifamily', label: 'Multifamily' },
  { value: 'Hospitality', label: 'Hospitality' },
  { value: 'Institutional', label: 'Institutional' },
  { value: 'Industrial', label: 'Industrial' },
  { value: 'Other', label: 'Other' },
] as const;

export const PRODUCT_CATEGORY_OPTIONS = [
  { value: 'Casework', label: 'Casework' },
  { value: 'Cabinetry', label: 'Cabinetry' },
  { value: 'Countertops', label: 'Countertops' },
  { value: 'Flooring', label: 'Flooring' },
  { value: 'Tile', label: 'Tile' },
  { value: 'Plumbing', label: 'Plumbing' },
  { value: 'Electrical', label: 'Electrical' },
  { value: 'Lighting', label: 'Lighting' },
  { value: 'Appliances', label: 'Appliances' },
  { value: 'Hardware', label: 'Hardware' },
  { value: 'Paint & finishes', label: 'Paint & finishes' },
  { value: 'Other', label: 'Other' },
] as const;

export function optionsWithCurrentValue(
  options: readonly { value: string; label: string }[],
  current?: string,
) {
  if (!current || options.some((option) => option.value === current)) return options;
  return [{ value: current, label: current }, ...options];
}

export function productOptionsWithCurrentValues(current: string[]) {
  const knownValues = new Set<string>(PRODUCT_CATEGORY_OPTIONS.map((option) => option.value));
  const legacyOptions = current
    .filter((value) => value && !knownValues.has(value))
    .map((value) => ({ value, label: value }));
  return [...legacyOptions, ...PRODUCT_CATEGORY_OPTIONS];
}
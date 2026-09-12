export type ProjectControlFinancialInput = {
  contractValue: number;
  committedCost: number;
  forecastCost: number;
};

export function forecastMargin(input: ProjectControlFinancialInput) {
  return input.contractValue - input.forecastCost;
}

export function forecastMarginPercent(input: ProjectControlFinancialInput) {
  if (input.contractValue <= 0) return 0;
  return Math.round((forecastMargin(input) / input.contractValue) * 100);
}

export function sumCommittedCost(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}
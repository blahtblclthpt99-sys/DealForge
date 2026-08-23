export function isFinancialGateCertified() {
  return process.env.DEALFORGE_FINANCIAL_GATE_CERTIFIED === "true";
}

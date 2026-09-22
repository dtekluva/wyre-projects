import type { VatTreatment } from "./types";

/** Nigerian VAT is 7.5% (Finance Act 2019, retained by the 2025 Tax Act). Per-project rate so zero-rated work can be 0. */
export const DEFAULT_VAT_RATE = 7.5;

/** VAT on a net amount. Exempt / zero-rated work carries none regardless of the rate on file. */
export const vatOn = (net: number, rate: number, treatment: VatTreatment) =>
  treatment === "exempt" || !(rate > 0) ? 0 : Math.round(net * rate) / 100;

export const grossOf = (net: number, rate: number, treatment: VatTreatment) => net + vatOn(net, rate, treatment);

/** Back out the net from a gross figure — for the person who only holds the VAT-inclusive number. */
export const netFromGross = (gross: number, rate: number, treatment: VatTreatment) =>
  treatment === "exempt" || !(rate > 0) ? gross : Math.round(gross / (1 + rate / 100) * 100) / 100;

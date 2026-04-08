import type { IndicatorOption } from "@/types/imf";

const AFRICAN_COUNTRY_CODES = new Set([
  "AGO",
  "BDI",
  "BEN",
  "BFA",
  "BWA",
  "CAF",
  "CIV",
  "CMR",
  "COD",
  "COG",
  "COM",
  "CPV",
  "DJI",
  "DZA",
  "EGY",
  "ERI",
  "ETH",
  "GAB",
  "GHA",
  "GIN",
  "GMB",
  "GNB",
  "GNQ",
  "KEN",
  "LBR",
  "LBY",
  "LSO",
  "MAR",
  "MDG",
  "MLI",
  "MOZ",
  "MRT",
  "MUS",
  "MWI",
  "NAM",
  "NER",
  "NGA",
  "RWA",
  "SDN",
  "SEN",
  "SLE",
  "SOM",
  "SSD",
  "STP",
  "SWZ",
  "SYC",
  "TCD",
  "TGO",
  "TUN",
  "TZA",
  "UGA",
  "ZAF",
  "ZMB",
  "ZWE",
]);

const WEO_FALLBACK_CODE_MAP: Record<string, string> = {
  BCA_GDP: "BCA_NGDPD",
  GGX_GDP: "GGX_NGDP",
  GGXCNL_GDP: "GGXCNL_NGDP",
  GGRXG_GDP: "GGR_NGDP",
  GGXWDG_GDP: "GGXWDG_NGDP",
  NGDP_R_PCH: "NGDP_RPCH",
  NGS_GDP: "NGSD_NGDP",
  NI_GDP: "NID_NGDP",
  PCPI_PCH: "PCPIPCH",
  PCPIE_PCH: "PCPIEPCH",
};

const WEO_FALLBACK_LABEL_RULES: Array<{ code: string; pattern: RegExp }> = [
  { code: "NGDP_RPCH", pattern: /real gdp growth/i },
  { code: "PCPIPCH", pattern: /(consumer prices.*average|inflation rate.*average consumer prices)/i },
  { code: "PCPIEPCH", pattern: /(consumer prices.*end of period|inflation rate.*end of period consumer prices)/i },
  { code: "GGXCNL_NGDP", pattern: /(overall fiscal balance|net lending|borrowing)/i },
  { code: "GGXWDG_NGDP", pattern: /(government debt|gross debt)/i },
  { code: "BCA_NGDPD", pattern: /(external current account|current account balance)/i },
  { code: "NID_NGDP", pattern: /total investment/i },
  { code: "NGSD_NGDP", pattern: /gross national savings/i },
];

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "annual",
  "average",
  "change",
  "consumer",
  "end",
  "including",
  "inflation",
  "of",
  "period",
  "percent",
  "prices",
  "rate",
  "the",
]);

const normalizeText = (value: string | undefined): string =>
  String(value ?? "")
    .trim()
    .toUpperCase();

const getDatasetCode = (dataset: string | undefined): string => normalizeText(dataset);

const getMeaningfulTokens = (value: string): string[] =>
  normalizeText(value)
    .replace(/[^A-Z0-9]+/g, " ")
    .split(/\s+/)
    .filter((token) => token.length > 2 && !STOP_WORDS.has(token.toLowerCase()));

const scoreLabelSimilarity = (sourceLabel: string, candidateLabel: string): number => {
  const sourceTokens = new Set(getMeaningfulTokens(sourceLabel));
  const candidateTokens = new Set(getMeaningfulTokens(candidateLabel));
  let score = 0;

  for (const token of sourceTokens) {
    if (candidateTokens.has(token)) {
      score += 1;
    }
  }

  return score;
};

const getWEOIndicators = (indicators: IndicatorOption[]): IndicatorOption[] =>
  indicators.filter((option) => getDatasetCode(option.dataset) === "WEO");

export const REGION_SPECIFIC_DATASET_HINT =
  "Some datasets are region-specific. Unsupported indicators are hidden and the app falls back to WEO when possible.";

export function isAfricanCountry(countryCode: string): boolean {
  return AFRICAN_COUNTRY_CODES.has(normalizeText(countryCode));
}

export function isDatasetValidForCountry(countryCode: string, dataset: string | undefined): boolean {
  const normalizedCountry = normalizeText(countryCode);
  const normalizedDataset = getDatasetCode(dataset);

  if (!normalizedCountry || !normalizedDataset) {
    return true;
  }

  if (normalizedDataset === "AFRREO") {
    return isAfricanCountry(normalizedCountry);
  }

  return true;
}

export function isIndicatorAvailableForCountry(countryCode: string, indicator: IndicatorOption): boolean {
  if (!countryCode) {
    return true;
  }

  return isDatasetValidForCountry(countryCode, indicator.dataset);
}

export function isIndicatorAvailableForAnyCountry(countryCodes: string[], indicator: IndicatorOption): boolean {
  if (!countryCodes.length) {
    return true;
  }

  return countryCodes.some((countryCode) => isDatasetValidForCountry(countryCode, indicator.dataset));
}

export function getDatasetCountryMessage(dataset: string | undefined): string {
  if (getDatasetCode(dataset) === "AFRREO") {
    return "AFR Regional Economic Outlook indicators are available only for African countries.";
  }

  return "The selected dataset is not available for this country.";
}

export function resolveWEOFallbackIndicator(
  indicator: IndicatorOption,
  indicators: IndicatorOption[],
): IndicatorOption | null {
  const weoIndicators = getWEOIndicators(indicators);
  if (!weoIndicators.length) {
    return null;
  }

  if (getDatasetCode(indicator.dataset) === "WEO") {
    return indicator;
  }

  const normalizedCode = normalizeText(indicator.value);
  const mappedCode = WEO_FALLBACK_CODE_MAP[normalizedCode];

  if (mappedCode) {
    const mappedIndicator = weoIndicators.find((option) => normalizeText(option.value) === mappedCode);
    if (mappedIndicator) {
      return mappedIndicator;
    }
  }

  const sameCodeIndicator = weoIndicators.find((option) => normalizeText(option.value) === normalizedCode);
  if (sameCodeIndicator) {
    return sameCodeIndicator;
  }

  for (const rule of WEO_FALLBACK_LABEL_RULES) {
    if (!rule.pattern.test(indicator.label)) {
      continue;
    }

    const matchedIndicator = weoIndicators.find((option) => normalizeText(option.value) === rule.code);
    if (matchedIndicator) {
      return matchedIndicator;
    }
  }

  const bestLabelMatch = weoIndicators
    .map((option) => ({
      option,
      score: scoreLabelSimilarity(indicator.label, option.label),
    }))
    .sort((left, right) => right.score - left.score)[0];

  if (bestLabelMatch && bestLabelMatch.score >= 2) {
    return bestLabelMatch.option;
  }

  return null;
}

const pluralize = (count: number, singular: string, plural: string): string => (count === 1 ? singular : plural);

const toSentenceCase = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed) {
    return trimmed;
  }

  return trimmed.charAt(0).toUpperCase() + trimmed.slice(1);
};

export function formatFriendlyWarning(warning: string): string {
  const normalizedWarning = warning.replace(/\s+/g, " ").trim();
  const parts = normalizedWarning.match(/^(.+?) \/ (.+?):\s*(.+)$/);

  if (!parts) {
    return toSentenceCase(normalizedWarning);
  }

  const [, country, indicator, detail] = parts;

  const noYearsMatch = detail.match(
    /data is not available for the latest (\d+) years, and no historical values were found\./i,
  );
  if (noYearsMatch) {
    return `${country}: ${indicator} does not have data for the last ${noYearsMatch[1]} years or any older years.`;
  }

  const lastAvailableYearsMatch = detail.match(
    /data is not available for the latest (\d+) years\. Exporting the last \d+ available years instead \((\d{4})-(\d{4})\)\./i,
  );
  if (lastAvailableYearsMatch) {
    return `${country}: ${indicator} did not have recent data, so we used ${lastAvailableYearsMatch[2]} to ${lastAvailableYearsMatch[3]} instead.`;
  }

  const availableYearsMatch = detail.match(
    /data is not available for the latest (\d+) years\. Exporting (\d+) available years instead \((\d{4})-(\d{4})\)\./i,
  );
  if (availableYearsMatch) {
    return `${country}: ${indicator} only had ${availableYearsMatch[2]} years of data, so we used ${availableYearsMatch[3]} to ${availableYearsMatch[4]}.`;
  }

  if (/exported using the IMF WEO fallback/i.test(detail)) {
    return `${country}: ${indicator} used the closest available IMF series instead.`;
  }

  if (/available only for African countries/i.test(detail) || /selected dataset is not available for this country/i.test(detail)) {
    return `${country}: ${indicator} is not available for this country.`;
  }

  if (/no data available/i.test(detail) || /returned no data/i.test(detail)) {
    return `${country}: ${indicator} has no data for this selection.`;
  }

  return `${country}: ${indicator}. ${toSentenceCase(detail)}`;
}

export function getExplorerNoticeMessages(sourceLabel: string) {
  return {
    creatingExcel: `Creating your ${sourceLabel} Excel file...`,
    filteredIndicators: "Some indicators are not available for the countries you picked, so we removed them.",
    genericError: `We couldn't create the ${sourceLabel} Excel file. Please try again.`,
    gettingData: `Getting your ${sourceLabel} data...`,
    initial: "Ready to go. Choose your countries, indicators, and date range, then download Excel.",
    metadataError: (baseUrl: string) => `We couldn't load ${sourceLabel} data from ${baseUrl}. Check the backend URL and try again.`,
    metadataLoaded: (countryCount: number, indicatorCount: number) =>
      `Ready to go. Browse ${countryCount} country options and ${indicatorCount} indicators.`,
    metadataLoadedStatus: (countryCount: number, indicatorCount: number) =>
      `Loaded ${countryCount} country options and ${indicatorCount} indicators.`,
    noData: `We couldn't find ${sourceLabel} data for that selection.`,
    selectionRequired: "Please choose at least one country and one indicator.",
  };
}

export function getLoadingScreenMessages(sourceLabel: string): string[] {
  return [
    `Connecting to ${sourceLabel} services...`,
    "Loading country options...",
    "Loading indicator options...",
    "Getting everything ready...",
    "Almost ready...",
  ];
}

export function buildDownloadSuccessMessage({
  rowCount,
  sourceLabel,
  warnings,
}: {
  rowCount: number;
  sourceLabel: string;
  warnings: string[];
}): string {
  const baseMessage = `Your ${sourceLabel} Excel file is ready. We found ${rowCount} data ${pluralize(rowCount, "row", "rows")}.`;

  if (!warnings.length) {
    return baseMessage;
  }

  const firstWarning = formatFriendlyWarning(warnings[0]);
  const remainingWarnings = warnings.length - 1;

  if (!remainingWarnings) {
    return `${baseMessage} ${firstWarning}`;
  }

  return `${baseMessage} ${firstWarning} ${remainingWarnings} other ${pluralize(remainingWarnings, "selection had", "selections had")} limited or missing data.`;
}

export function getFriendlyErrorMessage(sourceLabel: string, errorCode: string, fallbackMessage: string): string {
  switch (errorCode) {
    case "NO_DATA":
    case "NO_DATA_AFTER_FALLBACK":
      return `We couldn't find ${sourceLabel} data for that selection.`;
    case "COUNTRY_NOT_FOUND":
      return "One of the selected countries could not be found.";
    case "INDICATOR_NOT_FOUND":
      return "One of the selected indicators could not be found.";
    case "INVALID_DATASET_COUNTRY":
      return "One of the selected indicators is not available for the chosen country.";
    case "BACKEND_UNREACHABLE":
      return "We couldn't connect to the data service right now. Please try again.";
    default:
      return fallbackMessage;
  }
}

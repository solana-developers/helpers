export const getCustomErrorMessage = (
  possibleProgramErrors: Array<string>,
  errorMessage: string,
): string | null => {
  const customErrorExpression = /.*custom program error: 0x(?<errorNumber>[0-9abcdef]+)/;

  const match = customErrorExpression.exec(errorMessage);
  const errorNumberFound = match?.groups?.errorNumber;
  if (!errorNumberFound) {
    return null;
  }
  // errorNumberFound is a base16 string
  const errorNumber = parseInt(errorNumberFound, 16);
  return possibleProgramErrors[errorNumber] || null;
};

const encodeURL = (baseUrl: string, searchParams: Record<string, string>) => {
  // This was a little new to me, but it's the
  // recommended way to build URLs with query params
  // (and also means you don't have to do any encoding)
  // https://developer.mozilla.org/en-US/docs/Web/API/URLSearchParams
  const url = new URL(baseUrl);
  url.search = new URLSearchParams(searchParams).toString();
  return url.toString();
};

/**
 * The Solana network an Explorer link is for. 'localnet' is a local solana-test-validator.
 */
export type ExplorerCluster = "mainnet" | "devnet" | "testnet" | "localnet";

// Solana's main network was called 'mainnet-beta' until it was renamed to 'mainnet'.
// We still accept the old name, but warn (once, to avoid flooding logs) so people update their code.
let hasWarnedAboutMainnetBeta = false;
const warnAboutMainnetBeta = () => {
  if (hasWarnedAboutMainnetBeta) {
    return;
  }
  hasWarnedAboutMainnetBeta = true;
  console.warn(`'mainnet-beta' is now called 'mainnet'. Please use 'mainnet' instead.`);
};

type ExplorerLinkType = "transaction" | "tx" | "address" | "block";

/** @deprecated 'mainnet-beta' is now called 'mainnet'. Use 'mainnet' instead. */
export function getExplorerLink(
  linkType: ExplorerLinkType,
  id: string,
  cluster: "mainnet-beta",
): string;
export function getExplorerLink(
  linkType: ExplorerLinkType,
  id: string,
  cluster?: ExplorerCluster,
): string;
export function getExplorerLink(
  linkType: ExplorerLinkType,
  id: string,
  cluster: ExplorerCluster | "mainnet-beta" = "mainnet",
): string {
  if (cluster === "mainnet-beta") {
    warnAboutMainnetBeta();
    cluster = "mainnet";
  }
  const searchParams: Record<string, string> = {};
  if (cluster === "localnet") {
    // localnet technically isn't a cluster, so requires special handling
    searchParams["cluster"] = "custom";
    searchParams["customUrl"] = "http://localhost:8899";
  } else if (cluster !== "mainnet") {
    // Mainnet is Explorer's default, so it doesn't need a cluster parameter
    searchParams["cluster"] = cluster;
  }
  let baseUrl: string = "";
  if (linkType === "address") {
    baseUrl = `https://explorer.solana.com/address/${id}`;
  }
  if (linkType === "transaction" || linkType === "tx") {
    baseUrl = `https://explorer.solana.com/tx/${id}`;
  }
  if (linkType === "block") {
    baseUrl = `https://explorer.solana.com/block/${id}`;
  }
  return encodeURL(baseUrl, searchParams);
}

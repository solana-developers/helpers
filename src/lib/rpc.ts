// The newest transaction version the helpers can read. Version 1 transactions (SIMD-0385) carry
// their compute budget in the message and can be up to 4096 bytes. RPC nodes refuse to return
// transactions newer than the 'maxSupportedTransactionVersion' a request asks for.
// See https://github.com/solana-foundation/solana-improvement-documents/blob/main/proposals/0385-transaction-v1.md
export const MAX_SUPPORTED_TRANSACTION_VERSION = 1;

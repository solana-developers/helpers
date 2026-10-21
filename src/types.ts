export interface InitializeKeypairOptions {
  envFileName?: string;
  envVariableName?: string;
  airdropAmount?: number | bigint | null;
  minimumBalance?: number | bigint;
  keypairPath?: string;
}

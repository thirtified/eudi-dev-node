export {
  PLATFORM_PACKAGES,
  type PlatformPackage,
  platformPackage,
  type ResolveBinaryOptions,
  resolveBinary,
} from './binary.js';
export {
  type CallOptions,
  type CredentialCategory,
  type DecodeFormat,
  type DecodeOptions,
  type IssueCommonOptions,
  type IssueDisplayOptions,
  type IssueJwtOptions,
  type IssueMdocOptions,
  type IssueRegistrationOptions,
  type IssueResult,
  type IssueSdJwtOptions,
  isDecodedCredential,
  type ValidateOptions,
  type ValidateResult,
} from './commands/credentials.js';
export type {
  AccessCertOptions,
  AddIssuerOptions,
  AddVerifierOptions,
  AttestationOptions,
  ExtendIssuerOptions,
  ExtendVerifierOptions,
  IntendedUseOptions,
  PartyCommands,
  PartyOptions,
  RegistrarCommands,
  RegistrationCertOptions,
  RegistrationScopeOptions,
} from './commands/registrar.js';
export type { TrustAddCaOptions, TrustCommands, TrustListId, TrustShowOptions, TrustUrlOptions } from './commands/trust.js';
export { EudiDevBinaryError, EudiDevError, type EudiDevErrorDetails } from './errors.js';
export { EudiDev, type EudiDevOptions } from './eudi.js';
export type { FileInput, Input } from './input.js';
export { Runner, type RunnerConfig, type RunOptions, type RunResult } from './runner.js';
export * from './types.js';
export { EUDI_DEV_VERSION, SUPPORTED_MAJOR, UPSTREAM_REPO } from './version.js';

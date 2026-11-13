// Compile-time guard: every exported option type must accept an explicit
// `undefined` for each optional property, so callers that compile with
// `exactOptionalPropertyTypes: true` can pass maybe-undefined values.
// tsconfig.json turns that flag on; `pnpm run typecheck` fails when an
// option type loses `| undefined`. The runtime test only keeps node:test happy.

import assert from 'node:assert/strict';
import { it } from 'node:test';

import type {
  AccessCertificateRequest,
  AccessCertOptions,
  AddIssuerOptions,
  AddVerifierOptions,
  DcqlClaimQuery,
  DcqlCredentialQuery,
  DcqlQuery,
  DecodeOptions,
  Enrolment,
  EudiDevErrorDetails,
  EudiDevOptions,
  ExtendIssuerOptions,
  ExtendVerifierOptions,
  IssueJwtOptions,
  IssueMdocOptions,
  IssueSdJwtOptions,
  RegistrationCertOptions,
  RegistrationScopeOptions,
  ResolveBinaryOptions,
  RunnerConfig,
  RunOptions,
  TrustAddCaOptions,
  TrustShowOptions,
  TrustUrlOptions,
  ValidateOptions,
} from '../../src/index.js';

/** Declared keys, without the `[key: string]: unknown` of open document types. */
type KnownKeys<T> = keyof { [K in keyof T as string extends K ? never : number extends K ? never : K]: T[K] };
// biome-ignore lint/complexity/noBannedTypes: `{} extends Pick<T, K>` is the standard test for an optional key.
type OptionalKeys<T> = { [K in KnownKeys<T>]-?: {} extends Pick<T, K> ? K : never }[KnownKeys<T>];
/** `true` when every optional property of T accepts an explicit `undefined`. */
type AcceptsUndefined<T> = { [K in OptionalKeys<T>]: undefined } extends Pick<T, OptionalKeys<T>> ? true : false;

const checks: { [name: string]: true } = {
  AccessCertificateRequest: true satisfies AcceptsUndefined<AccessCertificateRequest>,
  AccessCertOptions: true satisfies AcceptsUndefined<AccessCertOptions>,
  AddIssuerOptions: true satisfies AcceptsUndefined<AddIssuerOptions>,
  AddVerifierOptions: true satisfies AcceptsUndefined<AddVerifierOptions>,
  DcqlClaimQuery: true satisfies AcceptsUndefined<DcqlClaimQuery>,
  DcqlCredentialQuery: true satisfies AcceptsUndefined<DcqlCredentialQuery>,
  DcqlQuery: true satisfies AcceptsUndefined<DcqlQuery>,
  DecodeOptions: true satisfies AcceptsUndefined<DecodeOptions>,
  Enrolment: true satisfies AcceptsUndefined<Enrolment>,
  EnrolmentRelyingParty: true satisfies AcceptsUndefined<Enrolment['relyingParty']>,
  EudiDevErrorDetails: true satisfies AcceptsUndefined<EudiDevErrorDetails>,
  EudiDevOptions: true satisfies AcceptsUndefined<EudiDevOptions>,
  ExtendIssuerOptions: true satisfies AcceptsUndefined<ExtendIssuerOptions>,
  ExtendVerifierOptions: true satisfies AcceptsUndefined<ExtendVerifierOptions>,
  IssueJwtOptions: true satisfies AcceptsUndefined<IssueJwtOptions>,
  IssueMdocOptions: true satisfies AcceptsUndefined<IssueMdocOptions>,
  IssueSdJwtOptions: true satisfies AcceptsUndefined<IssueSdJwtOptions>,
  RegistrationCertOptions: true satisfies AcceptsUndefined<RegistrationCertOptions>,
  RegistrationScopeOptions: true satisfies AcceptsUndefined<RegistrationScopeOptions>,
  ResolveBinaryOptions: true satisfies AcceptsUndefined<ResolveBinaryOptions>,
  RunnerConfig: true satisfies AcceptsUndefined<RunnerConfig>,
  RunOptions: true satisfies AcceptsUndefined<RunOptions>,
  TrustAddCaOptions: true satisfies AcceptsUndefined<TrustAddCaOptions>,
  TrustShowOptions: true satisfies AcceptsUndefined<TrustShowOptions>,
  TrustUrlOptions: true satisfies AcceptsUndefined<TrustUrlOptions>,
  ValidateOptions: true satisfies AcceptsUndefined<ValidateOptions>,
};

it('option types accept explicit undefined (checked at compile time)', () => {
  assert.ok(Object.values(checks).every(Boolean));
});

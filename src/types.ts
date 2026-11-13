/**
 * Types for the `--json` documents of eudi-dev v3.
 *
 * Written by hand from the Go structs and JSON builders at v3.10.1
 * (internal/output, internal/validate, internal/statuslist, internal/registrar,
 * internal/trustedlists, internal/certinfo). Upstream has no OpenAPI or JSON
 * schema for these documents. Within v3 fields are only added (ADR 0020), so
 * every object type also accepts unknown keys.
 */

/** A JSON object whose shape this package does not pin down. */
export type JsonObject = { [key: string]: unknown };

/** Lets an object carry fields added by later v3 releases. */
type Open = { [key: string]: unknown };

/**
 * Like `Partial<T>`, but also accepts an explicit `undefined` under
 * `exactOptionalPropertyTypes`. Used for objects that callers pass in.
 */
export type Loose<T> = { [K in keyof T]?: T[K] | undefined };

// ── Checks ────────────────────────────────────────────────────────────────

export type CheckStatus = 'pass' | 'fail' | 'warning' | 'skipped';

/** Check names, in the order `validate` runs them. */
export type CheckName =
  | 'type'
  | 'expiry'
  | 'integrity'
  | 'trusted list'
  | 'signature'
  | 'trust'
  | 'status'
  | 'certificate revocation'
  | 'status list signature'
  | 'haip'
  | (string & {});

/** The trusted list service behind a passing trust or status list signature check. */
export interface TrustAnchor extends Open {
  entry?: string;
  list_url: string;
  service: string;
}

export interface Check extends Open {
  name: CheckName;
  status: CheckStatus;
  detail: string;
  /** The check was skipped because the validation ran offline. */
  needsNetwork?: boolean;
  anchor?: TrustAnchor;
}

// ── Certificates ──────────────────────────────────────────────────────────

export interface CertificateExtension extends Open {
  oid?: string;
  name?: string;
  critical?: boolean;
  value?: unknown;
}

export interface CertificateInfo extends Open {
  subject: string;
  issuer: string;
  serialNumber: string;
  /** RFC 3339 time. */
  notBefore: string;
  /** RFC 3339 time. */
  notAfter: string;
  selfSigned: boolean;
  ca: boolean;
  maxPathLength?: number;
  publicKey: string;
  signatureAlgorithm: string;
  keyUsage?: string[];
  extendedKeyUsage?: string[];
  subjectAltNames?: string[];
  policies?: string[];
  crlDistributionPoints?: string[];
  ocspServers?: string[];
  issuingCertificateURLs?: string[];
  subjectKeyId?: string;
  authorityKeyId?: string;
  extensions: CertificateExtension[];
  sha256Fingerprint: string;
  pem: string;
}

// ── Decoded credentials ───────────────────────────────────────────────────

export interface Disclosure extends Open {
  name: string;
  value: unknown;
  salt: string;
  digest: string;
  isArrayEntry: boolean;
  /** False for a disclosure whose digest the credential does not reference. */
  referenced: boolean;
}

interface DecodedBase extends Open {
  /** Parser warnings. */
  warnings?: string[];
  /** Spec deviations (for example RFC 9901 §7.1 rejection rules). */
  deviations?: string[];
  /** The x5c (JWT) or x5chain (mdoc) certificates, leaf first. */
  certificates?: CertificateInfo[];
}

export interface DecodedSdJwt extends DecodedBase {
  format: 'dc+sd-jwt';
  header: JsonObject;
  payload: JsonObject;
  disclosures: Disclosure[];
  /** The payload with every disclosure applied. */
  resolvedClaims: JsonObject;
  keyBindingJWT?: { header: JsonObject; payload: JsonObject };
}

export interface DecodedJwt extends DecodedBase {
  format: 'jwt';
  header: JsonObject;
  payload: JsonObject;
}

export interface MdocValidityInfo extends Open {
  signed?: string;
  validFrom?: string;
  validUntil?: string;
}

export interface DecodedMdoc extends DecodedBase {
  format: 'mso_mdoc';
  docType: string;
  /** namespace → element identifier → value. */
  claims: Record<string, Record<string, unknown>>;
  isDeviceResponse?: boolean;
  responseVersion?: string;
  responseStatus?: number;
  mso?: {
    version: string;
    digestAlgorithm: string;
    docType: string;
    validityInfo?: MdocValidityInfo;
    status?: unknown;
    /** namespace → digest id → base64url digest. */
    valueDigests?: Record<string, Record<string, string>>;
    deviceKeyInfo?: unknown;
  } & Open;
  deviceKey?: unknown;
  issuerAuth?: unknown;
}

export interface DecodedCertificates extends Open {
  format: 'x509';
  certificates: CertificateInfo[];
}

export type DecodedCredential = DecodedSdJwt | DecodedJwt | DecodedMdoc | DecodedCertificates;

/**
 * `decode --json` of a credential or certificate. It runs the decoder's
 * checks offline-capable, so the result carries `validation.checks`.
 */
export type DecodeCredentialResult = DecodedCredential & { validation: { checks: Check[] } };

/**
 * `decode --json` of an OpenID4VCI offer, an OpenID4VP request or a trusted
 * list. Their documents are not typed by this package.
 */
export type DecodeOtherResult = JsonObject;

export type DecodeResult = DecodeCredentialResult | DecodeOtherResult;

// ── validate ──────────────────────────────────────────────────────────────

export interface SignatureVerification extends Open {
  signatureValid: boolean;
  expired: boolean;
  notYetValid: boolean;
  algorithm?: string;
  errors?: string[];
  /** SD-JWT / JWT. */
  keyId?: string;
  issuer?: string;
  expiresAt?: string;
  issuedAt?: string;
  notBefore?: string;
  /** mdoc. */
  docType?: string;
  validFrom?: string;
  validUntil?: string;
  signed?: string;
  warnings?: string[];
}

export interface StatusResult extends Open {
  uri: string;
  index: number;
  status: number;
  /** VALID, INVALID, SUSPENDED, an application specific value, or unknown. */
  statusName: string;
  isValid: boolean;
  bitsPerEntry: number;
  /** "jwt" or "cwt". */
  format: string;
  subject?: string;
  signatureValid?: boolean;
  trustAnchored: boolean;
  warnings?: string[];
  haipFindings?: string[];
}

export interface CatalogueTrust extends Open {
  entry: string;
  category: string;
  anchored_by?: string;
  findings?: string[];
  warnings?: string[];
}

/** `validate --json`: the decoded credential plus the checks at top level. */
export type ValidateReport = DecodedCredential & {
  checks: Check[];
  verification?: SignatureVerification;
  status?: StatusResult;
  trust?: CatalogueTrust;
  /** Present with `--haip` (empty when there are no findings). */
  haipFindings?: string[];
};

// ── dcql ──────────────────────────────────────────────────────────────────

// Also an input (registrar add --dcql), so optional fields accept undefined.
export interface DcqlClaimQuery extends Open {
  id?: string | undefined;
  path: (string | number | null)[];
  values?: unknown[] | undefined;
}

export interface DcqlCredentialQuery extends Open {
  id: string;
  format: 'dc+sd-jwt' | 'jwt_vc_json' | 'mso_mdoc' | (string & {});
  meta?: ({ vct_values?: string[] | undefined; doctype_value?: string | undefined } & Open) | undefined;
  claims?: DcqlClaimQuery[] | undefined;
  claim_sets?: string[][] | undefined;
}

export interface DcqlQuery extends Open {
  credentials: DcqlCredentialQuery[];
  credential_sets?: unknown[] | undefined;
}

// ── issue ─────────────────────────────────────────────────────────────────

/** `issue <format> --json`. `id` is set only when the wallet stored the credential. */
export interface IssueDocument extends Open {
  credential: string;
  id?: string;
}

// ── version ───────────────────────────────────────────────────────────────

export interface VersionInfo extends Open {
  name: string;
  version: string;
}

// ── trust ─────────────────────────────────────────────────────────────────

export interface TrustEntity extends Open {
  id: string;
  list: string;
  name: string;
  certificates: unknown[];
}

export interface TrustListLink extends Open {
  url: string;
  configured?: boolean;
  via?: string;
  error?: string;
}

/** `trust list --json`. */
export interface TrustOverview extends Open {
  entities: TrustEntity[];
  entity_lists: string[];
  lists: TrustListLink[];
  lists_url: string;
  relying_party_cas?: string[];
  trusted_list_cas?: string[];
  trust_lists: ({ id: string; default?: boolean; category?: string; path?: string } & Open)[];
}

/** A JWKS document as `trust ca-cert --jwks` prints it. */
export interface Jwks extends Open {
  keys: JsonObject[];
}

// ── registrar ─────────────────────────────────────────────────────────────

export interface RegistrarIdentifier extends Open {
  identifier: string;
  type?: string;
}

export interface MultiLangString extends Open {
  lang?: string;
  content?: string;
}

export interface IntendedUse extends Open {
  intendedUseIdentifier: string;
  purpose: MultiLangString[];
  privacyPolicy: unknown[];
  createdAt: string;
  credentials: unknown[];
}

export interface ProvidedAttestation extends Open {
  format: string;
  type: string;
}

export interface RelyingPartyService extends Open {
  serviceTradeName: string;
  serviceIdentifier?: string;
  supportURI?: string;
  srvDescription?: unknown;
  entitlements: string[];
  providesAttestations?: ProvidedAttestation[];
  credentialIssuer?: string;
  isIntermediary: boolean;
  intendedUses?: IntendedUse[];
}

export interface RelyingParty extends Open {
  identifier: RegistrarIdentifier[];
  legalPerson: { legalName: string[] } & Open;
  country: string;
  tradeName?: string;
  isPSB: boolean;
  supervisoryAuthority: JsonObject;
  registryURI: string;
  services: RelyingPartyService[];
}

export interface RegistrationCertificateResult extends Open {
  /** The bare registration certificate JWT (typ rc-wrp+jwt). */
  registrationCertificate: string;
  /** JSON array as a string, ready for a request's verifier_info parameter. */
  verifierInfo?: string;
  /** JSON array as a string, ready for the issuer metadata's issuer_info. */
  issuerInfo?: string;
}

export interface AccessCertificateResult extends Open {
  /** PEM leaf. */
  certificate: string;
  /** PEM leaf followed by the issuing CA. */
  chain: string;
  clientIds: string[];
}

export interface AccessCertificateRequest extends Open {
  identifier?: string | undefined;
  serviceIdentifier?: string | undefined;
  csr: string;
  dnsNames?: string[] | undefined;
  validity?: string | undefined;
}

/** Input of `registrar enrol`, as for POST /api/registrar/enrolments. */
export interface Enrolment extends Open {
  relyingParty: Loose<RelyingParty> & Open;
  access?: AccessCertificateRequest | undefined;
  registration?: JsonObject | undefined;
}

export interface EnrolmentResult extends Open {
  relyingParty: RelyingParty;
  access?: AccessCertificateResult;
  registration?: RegistrationCertificateResult;
}

/** `registrar verifiers add --to` / `registrar issuers add --to`. */
export interface RegistrationExtensionResult extends Open {
  relyingParty: RelyingParty;
  intendedUse?: string;
  registration: RegistrationCertificateResult | null;
}

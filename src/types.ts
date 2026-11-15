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

// ── wallet ────────────────────────────────────────────────────────────────
// internal/wallet: CredentialSummary and CredentialSummaryWithStatus
// (wallet.go, wallet_status.go), credential_trust.go, credential_display.go,
// credential_certificates.go, deferred.go, wallet.go (LogEntry).

export type CredentialFormat = 'dc+sd-jwt' | 'mso_mdoc' | 'jwt_vc_json';

/** Whether the wallet holds the credential's binding key. Only `this_wallet` can be presented. */
export type HolderBinding = 'this_wallet' | 'other_key' | 'none';

/** Revocation and expiry of the credential's certificate chain, from the wallet's own records (no CRL fetch). */
export interface CertificateStatus extends Open {
  status: 'valid' | 'revoked' | 'expired' | 'unchecked' | 'unknown' | 'none';
  /** Common names of the revoked or expired certificates. */
  problems?: string[];
}

/** The card display, with stored images replaced by wallet API paths. */
export interface CredentialDisplay extends Open {
  name?: string;
  description?: string;
  locale?: string;
  background_color?: string;
  text_color?: string;
  logo_alt_text?: string;
  logo_uri?: string;
  background_uri?: string;
}

/** The credential's status list entry. `managed` is true when this wallet issued it and keeps its status. */
export interface CredentialStatusInfo extends Open {
  managed: boolean;
  uri?: string;
  idx?: number;
  /** Set instead of `uri` and `idx` for a malformed status reference. */
  error?: string;
  /** With `managed`: the current value, 0 is valid. */
  status?: number;
  statusName?: string;
}

/** One credential as `wallet list` shows it, without claims and raw form. */
export interface WalletCredentialSummary extends Open {
  id: string;
  format: CredentialFormat | (string & {});
  claim_count: number;
  vct?: string;
  doctype?: string;
  protected?: boolean;
  /** Set for a batch, which the wallet lists once. */
  batch?: boolean;
  batch_size?: number;
  display?: CredentialDisplay;
  /** RFC 3339. */
  valid_from?: string;
  expires_at?: string;
  issued_at?: string;
  /** `iss` for SD-JWT and JWT, the signer's common name (`cert`) for mdoc, or a `did`. */
  issuer?: { kind: 'iss' | 'cert' | 'did' | (string & {}); value: string };
  issuer_name?: string;
  /** Whether the signature verifies against the embedded key. That doesn't mean the issuer is trusted. */
  signature?: { algorithm: string; self_consistent: boolean };
  can_renew?: boolean;
  issuer_key_did?: string;
  status?: CredentialStatusInfo;
  certificate_status: CertificateStatus;
  holder_binding: HolderBinding;
  key_binding_not_held?: boolean;
}

/** A stored credential with its claims and raw form: `wallet show`, `wallet import`. */
export interface WalletCredential extends WalletCredentialSummary {
  claims: JsonObject;
  /** The credential as stored: SD-JWT / JWT compact form, or base64url mdoc. */
  raw: string;
}

/** A credential the issuer deferred (OpenID4VCI deferred issuance). */
export interface DeferredIssuance extends Open {
  id: string;
  transaction_id: string;
  issuer: string;
  credential_configuration_id: string;
  format: string;
  vct: string;
  doctype: string;
  display: unknown;
  can_refresh: boolean;
  /** Go duration, such as `5s`. */
  interval: string;
  created_at: string;
  next_attempt_at: string;
  attempts: number;
  last_error: string;
  issuer_name?: string;
}

/** `wallet list`. */
export interface WalletCredentialList extends Open {
  credentials: WalletCredentialSummary[];
  /** Credentials on their way from an issuer. */
  deferred?: DeferredIssuance[];
}

/** `wallet info`: the wallet's configuration. */
export interface WalletInfo extends Open {
  wallet_dir: string;
  storage: string;
  templates_dir: string;
  credential_count: number;
  validation_mode: 'debug' | 'strict' | (string & {});
  base_url: string;
  issuer_url: string;
  status_list_url: string;
  remote_url: string;
  auto_accept: boolean;
  require_haip: boolean;
  require_arf: boolean;
  seeded_keys: boolean;
  vci_version: string;
}

/** One entry of the wallet's activity log. */
export interface WalletLogEntry extends Open {
  /** RFC 3339. */
  time: string;
  action: string;
  detail: string;
  success: boolean;
  /** `warning` for a violation that didn't fail the action. */
  severity?: string;
  details?: JsonObject;
}

// ── templates ─────────────────────────────────────────────────────────────
// internal/credtemplate (Template, TemplateDisplay), internal/wallet
// (TransactionTemplateFileEntry), cmd/templates.go, cmd/templates_transactions.go.

export interface CredentialTemplateDisplay extends Open {
  name?: string | undefined;
  description?: string | undefined;
  background_color?: string | undefined;
  text_color?: string | undefined;
  logo?: string | undefined;
  logo_alt_text?: string | undefined;
  background_image?: string | undefined;
  /** Claim labels by claim path. */
  claims?: Record<string, string> | undefined;
}

/** A credential template: `templates show` and `templates list`, and the input of `templates import`. */
export interface CredentialTemplate extends Open {
  name?: string | undefined;
  description?: string | undefined;
  /** `sdjwt`, `jwt` or `mdoc`. Empty: any. */
  format?: 'sdjwt' | 'jwt' | 'mdoc' | (string & {}) | undefined;
  vct?: string | undefined;
  doctype?: string | undefined;
  namespace?: string | undefined;
  /** Default expiry, a Go duration such as `720h`. */
  exp?: string | undefined;
  claims: JsonObject;
  always_disclosed?: string[] | undefined;
  category?: string | undefined;
  unique_claims?: string[] | undefined;
  rulebook?: string | undefined;
  baseline?: boolean | undefined;
  display?: CredentialTemplateDisplay | undefined;
  /** Catalogue entry added with the template. */
  catalog?: unknown;
  /** Set on output for the templates built into eudi-dev. */
  predefined?: boolean | undefined;
  /** Set on output for templates from `wallet serve --templates` files. */
  configured?: boolean | undefined;
}

/** A saved or imported credential template. */
export interface SavedTemplate extends Open {
  name: string;
  /** The file it was written to. */
  path: string;
}

/** A transaction data entry (OpenID4VP 1.0 §5.1). Its members depend on `type`. */
export interface TransactionData extends Open {
  type: string;
  credential_ids?: string[] | undefined;
  transaction_data_hashes_alg?: string[] | undefined;
}

/** A transaction template: `templates transactions show`, and the input of `templates transactions import`. */
export interface TransactionTemplate extends Open {
  name: string;
  description?: string | undefined;
  transaction_data: TransactionData;
  predefined?: boolean | undefined;
}

export interface TransactionTypeField extends Open {
  name: string;
  /** JSON type, such as `string` or `object`. */
  type: string;
  required?: boolean;
}

/** `templates transactions types`: the transaction data types the wallet knows. */
export interface TransactionTypes extends Open {
  types: { type: string; ts12: boolean; fields: TransactionTypeField[] }[];
  hash_algs: string[];
}

// ── catalog ───────────────────────────────────────────────────────────────
// internal/registrar/catalog.go (CatalogAttestation, AttestationSchema).

export interface CatalogCredential extends Open {
  format: string;
  type: string;
  /** Claim paths. */
  claims?: (string | number | null)[][];
}

export interface CatalogTrustAuthority extends Open {
  /** `aki`, `etsi_tl` or `openid_federation`. */
  frameworkType: string;
  value: string;
  isLOTE?: boolean;
}

/** An attestation type in the wallet's catalogue of attestations (EC TS11). */
export interface CatalogAttestation extends Open {
  name: string;
  credentials: CatalogCredential[];
  schema: {
    /** The id `catalog.remove()` takes. */
    id?: string;
    version: string;
    rulebookURI: string;
    trustedAuthorities?: CatalogTrustAuthority[];
    /** Such as `iso_18045_high`. */
    attestationLoS: string;
    bindingType: string;
    supportedFormats: string[];
    schemaURIs: { formatIdentifier: string; uri: string }[];
  } & Open;
  category?: string;
  credentialIssuer?: string;
  /** The entry belongs to a credential template. */
  template?: boolean;
  /** The entry comes from a `wallet serve --catalog` file. */
  operator?: boolean;
  removed?: boolean;
}

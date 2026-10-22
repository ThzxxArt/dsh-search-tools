/** Credential status shared by the page and the adapter form without a circular import. */

export interface CredentialInfo {
  configured: boolean
  source?: string
  writable: boolean
}

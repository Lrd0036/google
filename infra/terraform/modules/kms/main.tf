variable "project_id" { type = string }
variable "region" { type = string }

resource "google_kms_key_ring" "keyring" {
  name     = "runbook-keyring"
  location = var.region
}

resource "google_kms_crypto_key" "action_grant_key" {
  name     = "action-grant-signer"
  key_ring = google_kms_key_ring.keyring.id
  purpose  = "ASYMMETRIC_SIGN"

  version_template {
    algorithm        = "RSA_SIGN_PKCS1_4096_SHA256"
    protection_level = "SOFTWARE"
  }
}

output "action_grant_key_id" {
  value = google_kms_crypto_key.action_grant_key.id
}

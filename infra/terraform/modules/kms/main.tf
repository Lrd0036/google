variable "project_id" { type = string }
variable "region" { type = string }

resource "google_kms_key_ring" "keyring" {
  project  = var.project_id
  name     = "runbook-keyring"
  location = var.region
}

resource "google_kms_crypto_key" "action_grant_key" {
  name                          = "action-grant-signer"
  key_ring                      = google_kms_key_ring.keyring.id
  purpose                       = "ASYMMETRIC_SIGN"
  skip_initial_version_creation = true
  version_template {
    algorithm        = "RSA_SIGN_PSS_3072_SHA256"
    protection_level = "SOFTWARE"
  }
  lifecycle { prevent_destroy = true }
}

resource "google_kms_crypto_key_version" "action_grant_key" {
  crypto_key = google_kms_crypto_key.action_grant_key.id
  lifecycle { prevent_destroy = true }
}

output "action_grant_key_id" { value = google_kms_crypto_key.action_grant_key.id }
output "action_grant_key_version_name" { value = google_kms_crypto_key_version.action_grant_key.name }

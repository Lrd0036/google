variable "project_id" { type = string }
variable "region" { type = string }
variable "lock_retention" { type = bool }

resource "google_storage_bucket" "audit_bucket" {
  name          = "${var.project_id}-runbook-audit-logs"
  location      = var.region
  force_destroy = false

  uniform_bucket_level_access = true
  public_access_prevention    = "enforced"

  retention_policy {
    is_locked        = var.lock_retention
    retention_period = 31536000 # 1 year retention
  }

  versioning {
    enabled = true
  }

  lifecycle { prevent_destroy = true }
}

output "audit_bucket_name" {
  value = google_storage_bucket.audit_bucket.name
}

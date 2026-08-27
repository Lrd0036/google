variable "project_id" { type = string }
variable "region" { type = string }

resource "google_storage_bucket" "audit_bucket" {
  name          = "${var.project_id}-runbook-audit-logs"
  location      = var.region
  force_destroy = false

  uniform_bucket_level_access = true

  retention_policy {
    is_locked        = true
    retention_period = 31536000 # 1 year retention
  }

  versioning {
    enabled = true
  }
}

output "audit_bucket_name" {
  value = google_storage_bucket.audit_bucket.name
}

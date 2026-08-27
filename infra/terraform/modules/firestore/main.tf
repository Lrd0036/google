variable "project_id" { type = string }
variable "region" { type = string }

resource "google_firestore_database" "database" {
  project     = var.project_id
  name        = "(default)"
  location_id = var.region
  type        = "FIRESTORE_NATIVE"
}

# Composite index for execution history queries (tenant_id ASC, runbook.id ASC, created_at DESC)
resource "google_firestore_index" "execution_history_index" {
  project    = var.project_id
  database   = google_firestore_database.database.name
  collection = "executions"

  fields {
    field_path = "tenant_id"
    order      = "ASCENDING"
  }

  fields {
    field_path = "runbook.id"
    order      = "ASCENDING"
  }

  fields {
    field_path = "created_at"
    order      = "DESCENDING"
  }
}

resource "google_firestore_backup_schedule" "daily" {
  project   = var.project_id
  database  = google_firestore_database.database.name
  retention = "604800s"
  daily_recurrence {}
  deletion_policy = "ABANDON"
}

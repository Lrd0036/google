variable "project_id" { type = string }

locals {
  identities = {
    control      = "rb-control"
    broker       = "rb-broker"
    worker       = "acme-worker"
    console      = "rb-console"
    pubsub       = "rb-pubsub-push"
    authority    = "rb-authority"
    audit_writer = "rb-audit-writer"
    release_gate = "rb-release-gate"
  }
}

resource "google_service_account" "service" {
  for_each     = local.identities
  project      = var.project_id
  account_id   = each.value
  display_name = "Runbook Compiler ${each.key} identity"
}

resource "google_project_iam_custom_role" "control_role" {
  project     = var.project_id
  role_id     = "runbookControlRole"
  title       = "Runbook Control Plane Role"
  description = "Firestore execution-state access"
  permissions = [
    "datastore.entities.get",
    "datastore.entities.list",
    "datastore.entities.create",
    "datastore.entities.update",
  ]
}

resource "google_project_iam_custom_role" "broker_role" {
  project     = var.project_id
  role_id     = "runbookBrokerRole"
  title       = "Runbook Action Broker Role"
  description = "Firestore operation, replay, and fencing access"
  permissions = [
    "datastore.entities.get",
    "datastore.entities.create",
    "datastore.entities.update",
  ]
}

resource "google_project_iam_member" "control_role" {
  project = var.project_id
  role    = google_project_iam_custom_role.control_role.name
  member  = "serviceAccount:${google_service_account.service["control"].email}"
}

resource "google_project_iam_member" "broker_role" {
  project = var.project_id
  role    = google_project_iam_custom_role.broker_role.name
  member  = "serviceAccount:${google_service_account.service["broker"].email}"
}

resource "google_project_iam_member" "authority_datastore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.service["authority"].email}"
}

resource "google_project_iam_member" "audit_writer_datastore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.service["audit_writer"].email}"
}

resource "google_project_iam_member" "release_gate_datastore" {
  project = var.project_id
  role    = "roles/datastore.user"
  member  = "serviceAccount:${google_service_account.service["release_gate"].email}"
}

output "control_service_account_email" { value = google_service_account.service["control"].email }
output "broker_service_account_email" { value = google_service_account.service["broker"].email }
output "worker_service_account_email" { value = google_service_account.service["worker"].email }
output "console_service_account_email" { value = google_service_account.service["console"].email }
output "pubsub_service_account_email" { value = google_service_account.service["pubsub"].email }
output "authority_service_account_email" { value = google_service_account.service["authority"].email }
output "audit_writer_service_account_email" { value = google_service_account.service["audit_writer"].email }
output "release_gate_service_account_email" { value = google_service_account.service["release_gate"].email }

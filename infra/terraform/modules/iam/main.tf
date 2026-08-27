variable "project_id" { type = string }

locals {
  identities = {
    control = "rb-control"
    broker  = "rb-broker"
    worker  = "acme-worker"
    console = "rb-console"
    pubsub  = "rb-pubsub-push"
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

output "control_service_account_email" { value = google_service_account.service["control"].email }
output "broker_service_account_email" { value = google_service_account.service["broker"].email }
output "worker_service_account_email" { value = google_service_account.service["worker"].email }
output "console_service_account_email" { value = google_service_account.service["console"].email }
output "pubsub_service_account_email" { value = google_service_account.service["pubsub"].email }

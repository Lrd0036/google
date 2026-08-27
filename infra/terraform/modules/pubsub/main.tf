variable "project_id" { type = string }
variable "project_number" { type = string }
variable "control_resume_endpoint" { type = string }
variable "push_service_account" { type = string }
variable "enable_control_push" { type = bool }

locals { pubsub_service_agent = "service-${var.project_number}@gcp-sa-pubsub.iam.gserviceaccount.com" }

resource "google_pubsub_topic" "dead_letter" {
  project = var.project_id
  name    = "rb-execution-dlq"
}

resource "google_pubsub_topic" "resume_events" {
  project = var.project_id
  name    = "rb-resume-events"
}

resource "google_pubsub_subscription" "dead_letter" {
  project                    = var.project_id
  name                       = "rb-execution-dlq-sub"
  topic                      = google_pubsub_topic.dead_letter.id
  ack_deadline_seconds       = 60
  message_retention_duration = "604800s"
}

resource "google_pubsub_subscription" "resume_subscription" {
  count                = var.enable_control_push ? 1 : 0
  project              = var.project_id
  name                 = "rb-resume-events-sub"
  topic                = google_pubsub_topic.resume_events.id
  ack_deadline_seconds = 60
  push_config {
    push_endpoint = var.control_resume_endpoint
    oidc_token {
      service_account_email = var.push_service_account
      audience              = trimsuffix(var.control_resume_endpoint, "/events/resume")
    }
  }
  retry_policy {
    minimum_backoff = "5s"
    maximum_backoff = "60s"
  }
  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter.id
    max_delivery_attempts = 10
  }
}

resource "google_pubsub_topic_iam_member" "dead_letter_publisher" {
  project = var.project_id
  topic   = google_pubsub_topic.dead_letter.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:${local.pubsub_service_agent}"
}

resource "google_pubsub_subscription_iam_member" "forwarding_subscriber" {
  count        = var.enable_control_push ? 1 : 0
  project      = var.project_id
  subscription = google_pubsub_subscription.resume_subscription[0].name
  role         = "roles/pubsub.subscriber"
  member       = "serviceAccount:${local.pubsub_service_agent}"
}

resource "google_service_account_iam_member" "push_token_creator" {
  service_account_id = "projects/${var.project_id}/serviceAccounts/${var.push_service_account}"
  role               = "roles/iam.serviceAccountTokenCreator"
  member             = "serviceAccount:${local.pubsub_service_agent}"
}

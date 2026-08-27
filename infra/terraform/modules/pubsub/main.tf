variable "project_id" { type = string }

resource "google_pubsub_topic" "dead_letter" {
  name = "rb-execution-dlq"
}

resource "google_pubsub_topic" "resume_events" {
  name = "rb-resume-events"
}

resource "google_pubsub_subscription" "resume_subscription" {
  name  = "rb-resume-events-sub"
  topic = google_pubsub_topic.resume_events.name

  ack_deadline_seconds = 60

  retry_policy {
    minimum_backoff = "5s"
    maximum_backoff = "60s"
  }

  dead_letter_policy {
    dead_letter_topic     = google_pubsub_topic.dead_letter.id
    max_delivery_attempts = 10
  }
}

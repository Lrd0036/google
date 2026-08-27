variable "project_id" { type = string }
variable "project_number" { type = string }

resource "google_pubsub_topic" "ops_alerts" {
  project = var.project_id
  name    = "rb-ops-alerts"
}

resource "google_pubsub_topic_iam_member" "monitoring_publisher" {
  project = var.project_id
  topic   = google_pubsub_topic.ops_alerts.name
  role    = "roles/pubsub.publisher"
  member  = "serviceAccount:service-${var.project_number}@gcp-sa-monitoring-notification.iam.gserviceaccount.com"
}

resource "google_monitoring_notification_channel" "ops_alerts" {
  project      = var.project_id
  display_name = "Runbook Compiler operations alerts"
  type         = "pubsub"
  labels       = { topic = google_pubsub_topic.ops_alerts.id }
  depends_on   = [google_pubsub_topic_iam_member.monitoring_publisher]
}

resource "google_monitoring_alert_policy" "cloud_run_5xx" {
  project      = var.project_id
  display_name = "Runbook Compiler Cloud Run 5xx"
  combiner     = "OR"
  conditions {
    display_name = "Cloud Run 5xx responses"
    condition_threshold {
      filter          = "resource.type = \"cloud_run_revision\" AND metric.type = \"run.googleapis.com/request_count\" AND metric.labels.response_code_class = \"5xx\""
      duration        = "60s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      aggregations {
        alignment_period     = "60s"
        per_series_aligner   = "ALIGN_RATE"
        cross_series_reducer = "REDUCE_SUM"
        group_by_fields      = ["resource.label.service_name"]
      }
      trigger { count = 1 }
    }
  }
  alert_strategy { auto_close = "1800s" }
  notification_channels = [google_monitoring_notification_channel.ops_alerts.name]
}

resource "google_monitoring_alert_policy" "dead_letter_depth" {
  project      = var.project_id
  display_name = "Runbook Compiler dead-letter depth"
  combiner     = "OR"
  conditions {
    display_name = "DLQ has undelivered messages"
    condition_threshold {
      filter          = "resource.type = \"pubsub_subscription\" AND metric.type = \"pubsub.googleapis.com/subscription/num_undelivered_messages\" AND resource.label.subscription_id = \"rb-execution-dlq-sub\""
      duration        = "60s"
      comparison      = "COMPARISON_GT"
      threshold_value = 0
      aggregations {
        alignment_period   = "60s"
        per_series_aligner = "ALIGN_MAX"
      }
    }
  }
  notification_channels = [google_monitoring_notification_channel.ops_alerts.name]
}

variable "project_id" { type = string }
variable "region" { type = string }

resource "google_cloud_tasks_queue" "deadlines" {
  project  = var.project_id
  name     = "rb-deadlines"
  location = var.region
  rate_limits {
    max_concurrent_dispatches = 20
    max_dispatches_per_second = 10
  }
  retry_config {
    max_attempts  = 10
    min_backoff   = "5s"
    max_backoff   = "300s"
    max_doublings = 5
  }
}

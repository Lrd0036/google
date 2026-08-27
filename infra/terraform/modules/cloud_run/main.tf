variable "project_id" { type = string }
variable "region" { type = string }
variable "repository_url" { type = string }
variable "image_tag" { type = string }
variable "min_instances" { type = number }
variable "control_service_account" { type = string }
variable "broker_service_account" { type = string }
variable "worker_service_account" { type = string }
variable "console_service_account" { type = string }
variable "kms_key_version" { type = string }

locals {
  common_limits = { cpu = "1", memory = "512Mi" }
}

resource "google_cloud_run_v2_service" "broker" {
  project  = var.project_id
  name     = "rb-broker"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"
  template {
    service_account                  = var.broker_service_account
    max_instance_request_concurrency = 32
    scaling {
      min_instance_count = var.min_instances
      max_instance_count = 10
    }
    containers {
      image = "${var.repository_url}/rb-broker:${var.image_tag}"
      ports { container_port = 8080 }
      resources {
        limits            = local.common_limits
        startup_cpu_boost = true
      }
      env {
        name  = "GCP_PROJECT"
        value = var.project_id
      }
      env {
        name  = "GCP_SERVICE_AUTH"
        value = "true"
      }
      env {
        name  = "KMS_KEY_VERSION"
        value = var.kms_key_version
      }
      env {
        name  = "BROKER_SIGNING_KEY_ID"
        value = var.kms_key_version
      }
      env {
        name  = "ALLOWED_CAPABILITY_ORIGINS"
        value = google_cloud_run_v2_service.worker.uri
      }
      env {
        name  = "REQUIRE_AUTHORITATIVE_FENCE"
        value = "true"
      }
      startup_probe {
        http_get { path = "/health" }
        initial_delay_seconds = 1
        timeout_seconds       = 2
        period_seconds        = 3
        failure_threshold     = 10
      }
    }
  }
}

resource "google_cloud_run_v2_service" "worker" {
  project  = var.project_id
  name     = "acme-worker"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"
  template {
    service_account                  = var.worker_service_account
    max_instance_request_concurrency = 32
    scaling {
      min_instance_count = var.min_instances
      max_instance_count = 10
    }
    containers {
      image = "${var.repository_url}/acme-worker:${var.image_tag}"
      ports { container_port = 8080 }
      resources {
        limits            = { cpu = "1", memory = "512Mi" }
        startup_cpu_boost = true
      }
      startup_probe {
        http_get { path = "/health" }
        initial_delay_seconds = 1
        timeout_seconds       = 2
        period_seconds        = 3
        failure_threshold     = 10
      }
    }
  }
}

resource "google_cloud_run_v2_service" "console" {
  project  = var.project_id
  name     = "rb-console"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"
  template {
    service_account                  = var.console_service_account
    max_instance_request_concurrency = 32
    scaling {
      min_instance_count = var.min_instances
      max_instance_count = 10
    }
    containers {
      image = "${var.repository_url}/rb-console:${var.image_tag}"
      ports { container_port = 8080 }
      resources {
        limits            = { cpu = "1", memory = "512Mi" }
        startup_cpu_boost = true
      }
      startup_probe {
        http_get { path = "/" }
        initial_delay_seconds = 1
        timeout_seconds       = 2
        period_seconds        = 3
        failure_threshold     = 10
      }
    }
  }
}

resource "google_cloud_run_v2_service" "control" {
  project  = var.project_id
  name     = "rb-control"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"
  template {
    service_account                  = var.control_service_account
    max_instance_request_concurrency = 16
    scaling {
      min_instance_count = var.min_instances
      max_instance_count = 10
    }
    containers {
      image = "${var.repository_url}/rb-control:${var.image_tag}"
      ports { container_port = 8080 }
      resources {
        limits            = local.common_limits
        startup_cpu_boost = true
      }
      env {
        name  = "GCP_PROJECT"
        value = var.project_id
      }
      env {
        name  = "PUBSUB_PROJECT_ID"
        value = var.project_id
      }
      env {
        name  = "DEPLOYMENT_MODE"
        value = "cloud"
      }
      env {
        name  = "CORS_ORIGIN"
        value = google_cloud_run_v2_service.console.uri
      }
      startup_probe {
        http_get { path = "/health" }
        initial_delay_seconds = 1
        timeout_seconds       = 2
        period_seconds        = 3
        failure_threshold     = 10
      }
    }
  }
}

resource "google_cloud_run_v2_service_iam_member" "console_public" {
  project  = var.project_id
  location = google_cloud_run_v2_service.console.location
  name     = google_cloud_run_v2_service.console.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}

resource "google_cloud_run_v2_service_iam_member" "worker_from_broker" {
  project  = var.project_id
  location = google_cloud_run_v2_service.worker.location
  name     = google_cloud_run_v2_service.worker.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${var.broker_service_account}"
}

output "control_url" { value = google_cloud_run_v2_service.control.uri }
output "broker_url" { value = google_cloud_run_v2_service.broker.uri }
output "worker_url" { value = google_cloud_run_v2_service.worker.uri }
output "console_url" { value = google_cloud_run_v2_service.console.uri }

variable "project_id" { type = string }
variable "region" { type = string }
variable "repository_url" { type = string }
variable "image_tag" { type = string }
variable "min_instances" { type = number }
variable "control_service_account" { type = string }
variable "broker_service_account" { type = string }
variable "worker_service_account" { type = string }
variable "console_service_account" { type = string }
variable "authority_service_account" { type = string }
variable "audit_writer_service_account" { type = string }
variable "project_number" { type = string }
variable "kms_key_version" { type = string }
variable "approval_kms_key_version" { type = string }
variable "release_kms_key_version" { type = string }
variable "artifact_bucket" { type = string }
variable "audit_bucket" { type = string }
variable "cloud_execution_enabled" { type = bool }
variable "broker_mutations_enabled" { type = bool }
variable "enable_invocation_edges" { type = bool }
variable "iap_bootstrap_user" { type = string }

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
      env {
        name  = "STATE_SCHEMA"
        value = "runtime/v1"
      }
      env {
        name  = "GCP_REGION"
        value = var.region
      }
      env {
        name  = "BROKER_MUTATIONS_ENABLED"
        value = tostring(var.broker_mutations_enabled)
      }
      env {
        name  = "RELEASE_KMS_KEY_VERSION"
        value = var.release_kms_key_version
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
  project     = var.project_id
  name        = "rb-console"
  location    = var.region
  ingress     = "INGRESS_TRAFFIC_ALL"
  iap_enabled = true
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
      env {
        name  = "CONSOLE_DATA_MODE"
        value = "LIVE"
      }
      env {
        name  = "CONTROL_URL"
        value = google_cloud_run_v2_service.control.uri
      }
      env {
        name  = "AUTHORITY_URL"
        value = google_cloud_run_v2_service.authority.uri
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
        name  = "CLOUD_EXECUTION_ENABLED"
        value = tostring(var.cloud_execution_enabled)
      }
      env {
        name  = "ARTIFACT_BUCKET"
        value = var.artifact_bucket
      }
      env {
        name  = "APPROVAL_KMS_KEY_VERSION"
        value = var.approval_kms_key_version
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

resource "google_cloud_run_v2_service" "authority" {
  project  = var.project_id
  name     = "rb-authority"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"
  template {
    service_account = var.authority_service_account
    scaling {
      min_instance_count = var.min_instances
      max_instance_count = 5
    }
    containers {
      image = "${var.repository_url}/rb-authority:${var.image_tag}"
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
        name  = "GCP_REGION"
        value = var.region
      }
      env {
        name  = "APPROVAL_KMS_KEY_VERSION"
        value = var.approval_kms_key_version
      }
      env {
        name  = "IAP_AUDIENCE"
        value = "/projects/${var.project_number}/locations/${var.region}/services/rb-console"
      }
      env {
        name  = "CONSOLE_SERVICE_ACCOUNT"
        value = var.console_service_account
      }
      env {
        name  = "CONTROL_URL"
        value = google_cloud_run_v2_service.control.uri
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

resource "google_cloud_run_v2_service" "audit_writer" {
  project  = var.project_id
  name     = "rb-audit-writer"
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"
  template {
    service_account = var.audit_writer_service_account
    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }
    containers {
      image = "${var.repository_url}/rb-audit-writer:${var.image_tag}"
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
        name  = "AUDIT_BUCKET"
        value = var.audit_bucket
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

resource "google_cloud_run_v2_service_iam_member" "iap_service_invoker" {
  project  = var.project_id
  location = google_cloud_run_v2_service.console.location
  name     = google_cloud_run_v2_service.console.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:service-${var.project_number}@gcp-sa-iap.iam.gserviceaccount.com"
}

resource "google_project_iam_member" "console_iap_user" {
  project = var.project_id
  role    = "roles/iap.httpsResourceAccessor"
  member  = var.iap_bootstrap_user
}

resource "google_cloud_run_v2_service_iam_member" "authority_from_console" {
  count    = var.enable_invocation_edges ? 1 : 0
  project  = var.project_id
  location = google_cloud_run_v2_service.authority.location
  name     = google_cloud_run_v2_service.authority.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${var.console_service_account}"
}

resource "google_cloud_run_v2_service_iam_member" "control_from_authority" {
  count    = var.enable_invocation_edges ? 1 : 0
  project  = var.project_id
  location = google_cloud_run_v2_service.control.location
  name     = google_cloud_run_v2_service.control.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${var.authority_service_account}"
}

resource "google_cloud_run_v2_service_iam_member" "broker_from_control" {
  count    = var.enable_invocation_edges ? 1 : 0
  project  = var.project_id
  location = google_cloud_run_v2_service.broker.location
  name     = google_cloud_run_v2_service.broker.name
  role     = "roles/run.invoker"
  member   = "serviceAccount:${var.control_service_account}"
}

resource "google_cloud_run_v2_service_iam_member" "worker_from_broker" {
  count    = var.enable_invocation_edges ? 1 : 0
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
output "authority_url" { value = google_cloud_run_v2_service.authority.uri }
output "audit_writer_url" { value = google_cloud_run_v2_service.audit_writer.uri }

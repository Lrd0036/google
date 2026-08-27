variable "project_id" { type = string }
variable "region" { type = string }

# Control plane Cloud Run service (1 CPU, 512 MiB, concurrency 16)
resource "google_cloud_run_v2_service" "control_service" {
  name     = "rb-control"
  location = var.region

  template {
    containers {
      image = "gcr.io/${var.project_id}/rb-control:latest"
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }
    max_instance_request_concurrency = 16
  }
}

# Action Broker PEP Cloud Run service (1 CPU, 512 MiB, concurrency 32)
resource "google_cloud_run_v2_service" "broker_service" {
  name     = "rb-broker"
  location = var.region

  template {
    containers {
      image = "gcr.io/${var.project_id}/rb-broker:latest"
      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
      }
    }
    scaling {
      min_instance_count = 0
      max_instance_count = 10
    }
    max_instance_request_concurrency = 32
  }
}

output "control_url" {
  value = google_cloud_run_v2_service.control_service.uri
}

output "broker_url" {
  value = google_cloud_run_v2_service.broker_service.uri
}

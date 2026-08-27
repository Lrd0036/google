terraform {
  required_version = ">= 1.5.0"
  backend "gcs" {}
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 7.45.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

data "google_project" "current" {
  project_id = var.project_id
}

locals {
  required_services = toset([
    "artifactregistry.googleapis.com",
    "cloudbuild.googleapis.com",
    "cloudkms.googleapis.com",
    "cloudtasks.googleapis.com",
    "firestore.googleapis.com",
    "iam.googleapis.com",
    "iamcredentials.googleapis.com",
    "iap.googleapis.com",
    "monitoring.googleapis.com",
    "logging.googleapis.com",
    "pubsub.googleapis.com",
    "run.googleapis.com",
    "secretmanager.googleapis.com",
    "storage.googleapis.com",
  ])
}

resource "google_project_service" "required" {
  for_each           = local.required_services
  project            = var.project_id
  service            = each.value
  disable_on_destroy = false
}

module "artifact_registry" {
  source        = "./modules/artifact_registry"
  project_id    = var.project_id
  region        = var.region
  repository_id = "runbook-compiler"
  depends_on    = [google_project_service.required]
}

resource "google_artifact_registry_repository_iam_member" "cloud_build_writer" {
  project    = var.project_id
  location   = var.region
  repository = "runbook-compiler"
  role       = "roles/artifactregistry.writer"
  member     = "serviceAccount:${data.google_project.current.number}-compute@developer.gserviceaccount.com"
  depends_on = [module.artifact_registry]
}

resource "google_storage_bucket_iam_member" "cloud_build_source_reader" {
  bucket = "${var.project_id}_cloudbuild"
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${data.google_project.current.number}-compute@developer.gserviceaccount.com"
}

resource "google_project_iam_member" "cloud_build_log_writer" {
  project = var.project_id
  role    = "roles/logging.logWriter"
  member  = "serviceAccount:${data.google_project.current.number}-compute@developer.gserviceaccount.com"
}

resource "google_project_iam_audit_config" "safety_data_access" {
  for_each = toset([
    "cloudkms.googleapis.com",
    "secretmanager.googleapis.com",
  ])
  project = var.project_id
  service = each.value
  audit_log_config { log_type = "DATA_READ" }
  audit_log_config { log_type = "DATA_WRITE" }
}

module "iam" {
  source     = "./modules/iam"
  project_id = var.project_id
  depends_on = [google_project_service.required]
}

module "kms" {
  source     = "./modules/kms"
  project_id = var.project_id
  region     = var.region
  depends_on = [google_project_service.required]
}

module "storage" {
  source         = "./modules/storage"
  project_id     = var.project_id
  region         = var.region
  lock_retention = var.lock_audit_retention
  depends_on     = [google_project_service.required]
}

module "firestore" {
  source     = "./modules/firestore"
  project_id = var.project_id
  region     = var.region
  depends_on = [google_project_service.required]
}

resource "google_secret_manager_secret" "broker_credentials" {
  project   = var.project_id
  secret_id = "rb-broker-credentials"
  replication {
    auto {}
  }
  depends_on = [google_project_service.required]
}

module "cloud_run" {
  source                       = "./modules/cloud_run"
  project_id                   = var.project_id
  region                       = var.region
  repository_url               = module.artifact_registry.repository_url
  image_tag                    = var.image_tag
  min_instances                = var.min_instances
  control_service_account      = module.iam.control_service_account_email
  broker_service_account       = module.iam.broker_service_account_email
  worker_service_account       = module.iam.worker_service_account_email
  console_service_account      = module.iam.console_service_account_email
  authority_service_account    = module.iam.authority_service_account_email
  audit_writer_service_account = module.iam.audit_writer_service_account_email
  project_number               = data.google_project.current.number
  kms_key_version              = module.kms.action_grant_key_version_name
  approval_kms_key_version     = module.kms.approval_key_version_name
  release_kms_key_version      = module.kms.release_key_version_name
  artifact_bucket              = module.storage.artifact_bucket_name
  audit_bucket                 = module.storage.audit_bucket_name
  cloud_execution_enabled      = var.cloud_execution_enabled
  broker_mutations_enabled     = var.broker_mutations_enabled
  enable_invocation_edges      = var.enable_invocation_edges
  iap_bootstrap_user           = var.iap_bootstrap_user
  depends_on                   = [google_project_service.required, module.iam, module.kms, module.storage]
}

resource "google_kms_crypto_key_iam_member" "broker_public_key_viewer" {
  crypto_key_id = module.kms.action_grant_key_id
  role          = "roles/cloudkms.publicKeyViewer"
  member        = "serviceAccount:${module.iam.broker_service_account_email}"
}

resource "google_kms_crypto_key_iam_member" "broker_release_public_key_viewer" {
  crypto_key_id = module.kms.release_key_id
  role          = "roles/cloudkms.publicKeyViewer"
  member        = "serviceAccount:${module.iam.broker_service_account_email}"
}

resource "google_kms_crypto_key_iam_member" "authority_approval_signer" {
  crypto_key_id = module.kms.approval_key_id
  role          = "roles/cloudkms.signerVerifier"
  member        = "serviceAccount:${module.iam.authority_service_account_email}"
}

resource "google_kms_crypto_key_iam_member" "control_approval_public_key_viewer" {
  crypto_key_id = module.kms.approval_key_id
  role          = "roles/cloudkms.publicKeyViewer"
  member        = "serviceAccount:${module.iam.control_service_account_email}"
}

resource "google_kms_crypto_key_iam_member" "release_gate_signer" {
  crypto_key_id = module.kms.release_key_id
  role          = "roles/cloudkms.signerVerifier"
  member        = "serviceAccount:${module.iam.release_gate_service_account_email}"
}

resource "google_storage_bucket_iam_member" "broker_release_reader" {
  bucket = module.storage.release_bucket_name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${module.iam.broker_service_account_email}"
}

resource "google_storage_bucket_iam_member" "control_artifact_reader" {
  bucket = module.storage.artifact_bucket_name
  role   = "roles/storage.objectViewer"
  member = "serviceAccount:${module.iam.control_service_account_email}"
}

resource "google_storage_bucket_iam_member" "audit_writer_creator" {
  bucket = module.storage.audit_bucket_name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${module.iam.audit_writer_service_account_email}"
}

resource "google_storage_bucket_iam_member" "release_gate_creator" {
  bucket = module.storage.release_bucket_name
  role   = "roles/storage.objectCreator"
  member = "serviceAccount:${module.iam.release_gate_service_account_email}"
}

module "pubsub" {
  source                  = "./modules/pubsub"
  project_id              = var.project_id
  project_number          = data.google_project.current.number
  control_resume_endpoint = "${module.cloud_run.control_url}/events/resume"
  push_service_account    = module.iam.pubsub_service_account_email
  enable_control_push     = var.enable_invocation_edges
  depends_on              = [google_project_service.required, module.cloud_run]
}

module "tasks" {
  source     = "./modules/tasks"
  project_id = var.project_id
  region     = var.region
  depends_on = [google_project_service.required]
}

module "monitoring" {
  source         = "./modules/monitoring"
  project_id     = var.project_id
  project_number = data.google_project.current.number
  depends_on     = [google_project_service.required, module.cloud_run]
}

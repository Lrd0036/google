terraform {
  required_version = ">= 1.5.0"
  required_providers {
    google = {
      source  = "hashicorp/google"
      version = "~> 5.0"
    }
  }
}

provider "google" {
  project = var.project_id
  region  = var.region
}

module "iam" {
  source     = "./modules/iam"
  project_id = var.project_id
}

module "kms" {
  source     = "./modules/kms"
  project_id = var.project_id
  region     = var.region
}

module "storage" {
  source     = "./modules/storage"
  project_id = var.project_id
  region     = var.region
}

module "firestore" {
  source     = "./modules/firestore"
  project_id = var.project_id
  region     = var.region
}

module "pubsub" {
  source     = "./modules/pubsub"
  project_id = var.project_id
}

module "cloud_run" {
  source     = "./modules/cloud_run"
  project_id = var.project_id
  region     = var.region
}

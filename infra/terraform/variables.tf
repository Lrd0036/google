variable "project_id" {
  description = "The Google Cloud Project ID"
  type        = string
}

variable "region" {
  description = "The Google Cloud region for regional resources"
  type        = string
  default     = "us-central1"
}

variable "environment" {
  description = "Deployment environment (e.g. dev, staging, prod)"
  type        = string
  default     = "dev"
}

variable "image_tag" {
  description = "Immutable image tag deployed to all Runbook Compiler services"
  type        = string
  validation {
    condition     = var.image_tag != "latest" && can(regex("^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$", var.image_tag))
    error_message = "image_tag must be an explicit immutable tag and cannot be latest."
  }
}

variable "min_instances" {
  description = "Minimum Cloud Run instances per service during the demo"
  type        = number
  default     = 1
}

variable "lock_audit_retention" {
  description = "Permanently lock the audit bucket retention policy; irreversible when true"
  type        = bool
  default     = false
}

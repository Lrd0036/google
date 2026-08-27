output "control_service_url" {
  description = "The URL of the rb-control Cloud Run service"
  value       = module.cloud_run.control_url
}

output "broker_service_url" {
  description = "The URL of the rb-broker Cloud Run service"
  value       = module.cloud_run.broker_url
}

output "audit_bucket_name" {
  description = "Immutable audit log bucket name"
  value       = module.storage.audit_bucket_name
}

output "worker_service_url" {
  value = module.cloud_run.worker_url
}

output "console_service_url" {
  value = module.cloud_run.console_url
}

output "authority_service_url" { value = module.cloud_run.authority_url }
output "audit_writer_service_url" { value = module.cloud_run.audit_writer_url }

output "artifact_repository_url" {
  value = module.artifact_registry.repository_url
}

output "kms_key_version" {
  value = module.kms.action_grant_key_version_name
}

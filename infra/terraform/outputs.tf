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

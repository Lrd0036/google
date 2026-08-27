variable "project_id" { type = string }

# Zero-trust custom role for Control Plane
resource "google_project_iam_custom_role" "control_role" {
  role_id     = "runbookControlRole"
  title       = "Runbook Control Plane Role"
  description = "Allows Firestore lease management, KMS asymmetric signing, and Pub/Sub publishing"
  permissions = [
    "datastore.entities.get",
    "datastore.entities.create",
    "datastore.entities.update",
    "cloudkms.cryptoKeyVersions.useToSign",
    "pubsub.topics.publish",
  ]
}

# Zero-trust custom role for Action Broker
resource "google_project_iam_custom_role" "broker_role" {
  role_id     = "runbookBrokerRole"
  title       = "Runbook Action Broker PEP Role"
  description = "Allows secret resolution, KMS signature verification, and Cloud Storage audit log append"
  permissions = [
    "secretmanager.versions.access",
    "cloudkms.cryptoKeyVersions.viewPublicKey",
    "storage.objects.create",
  ]
}

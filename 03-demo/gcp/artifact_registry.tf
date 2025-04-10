resource "google_artifact_registry_repository" "microservice_repo" {
  provider     = google
  location     = var.region
  repository_id = var.microservice_name
  description   = "Container repository for ${var.microservice_name}"
  format        = "DOCKER"
}

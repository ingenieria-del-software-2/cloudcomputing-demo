# Service Account for CI/CD Pipeline
resource "google_service_account" "pipeline_user" {
  account_id   = "pipeline-user"
  display_name = "Pipeline User"
}

# Asignar rol Artifact Registry Writer a Service Account de Pipeline
resource "google_project_iam_member" "artifact_registry_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.pipeline_user.email}"
}

# Asignar rol Storage Admin para permisos en GCR
resource "google_project_iam_member" "storage_admin" {
  project = var.project_id
  role    = "roles/storage.admin"
  member  = "serviceAccount:${google_service_account.pipeline_user.email}"
}

# Generar key JSON para la Service Account
resource "google_service_account_key" "pipeline_user_key" {
  service_account_id = google_service_account.pipeline_user.name
}

# Output con el contenido del JSON (sensible, guarda esto en GitHub Secrets inmediatamente)
output "pipeline_service_account_key" {
  value       = google_service_account_key.pipeline_user_key.private_key
  sensitive   = true
  description = "JSON key para pipeline-user service account"
}


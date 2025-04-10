# Crear Service Account para pipeline CI/CD
resource "google_service_account" "pipeline_user" {
  account_id   = "pipeline-user"
  display_name = "Pipeline User"
}

# Asignar rol Artifact Registry Writer a Service Account
resource "google_project_iam_member" "artifact_registry_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.pipeline_user.email}"
}

# (Opcional) Generar key JSON para la Service Account
resource "google_service_account_key" "pipeline_user_key" {
  service_account_id = google_service_account.pipeline_user.name
}

# Output con el contenido del JSON (sensible, guarda esto en GitHub Secrets inmediatamente)
output "pipeline_service_account_key" {
  value       = google_service_account_key.pipeline_user_key.private_key
  sensitive   = true
  description = "JSON key para pipeline-user service account"
}

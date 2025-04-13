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

# Service Account for VM
resource "google_service_account" "pipeline_vm_sa" {
  account_id   = "pipeline-vm-sa"
  display_name = "Pipeline VM Service Account"
}

# Grant Artifact Registry Reader permission to VM Service Account
resource "google_project_iam_member" "artifact_registry_reader" {
  project = var.project_id
  role    = "roles/artifactregistry.reader"
  member  = "serviceAccount:${google_service_account.pipeline_vm_sa.email}"
}

# # (Opcional) Generar key JSON para la Service Account
# resource "google_service_account_key" "pipeline_user_key" {
#   service_account_id = google_service_account.pipeline_user.name
# }

# # Output con el contenido del JSON (sensible, guarda esto en GitHub Secrets inmediatamente)
# output "pipeline_service_account_key" {
#   value       = google_service_account_key.pipeline_user_key.private_key
#   sensitive   = true
#   description = "JSON key para pipeline-user service account"
# }

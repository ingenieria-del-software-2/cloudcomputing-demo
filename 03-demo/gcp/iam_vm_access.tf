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
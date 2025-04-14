# Output: VM instance ID
output "instance_id" {
  value = google_compute_instance.pipeline_vm.id
}

# Output: VM instance public IP - GCP_VM_HOST
output "GCP_VM_HOST" {
  value = google_compute_instance.pipeline_vm.network_interface[0].access_config[0].nat_ip
  description = "Dirección IP pública de la VM"
}

# Output: VM instance name
output "instance_name" {
  value = google_compute_instance.pipeline_vm.name
}

# Output: Artifact Registry repository URL
output "artifact_registry_url" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${var.microservice_name}"
}

# Output: Internal IP
output "internal_ip" {
  value = google_compute_instance.pipeline_vm.network_interface[0].network_ip
}

# Output: Username detectado - GCP_USERNAME
output "GCP_USERNAME" {
  value = local.username
  description = "Nombre de usuario automáticamente detectado del email de Google"
}

# Output: GCP Project ID - GCP_PROJECT_ID
output "GCP_PROJECT_ID" {
  value = var.project_id
  description = "ID del proyecto de GCP"
}

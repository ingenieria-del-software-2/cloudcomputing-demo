# Output: VM instance ID
output "instance_id" {
  value = google_compute_instance.pipeline_vm.id
}

# Output: VM instance public IP
output "public_ip" {
  value = google_compute_instance.pipeline_vm.network_interface[0].access_config[0].nat_ip
}

# Output: VM instance name
output "instance_name" {
  value = google_compute_instance.pipeline_vm.name
}

# Output: Artifact Registry repository URL
output "repository_url" {
  value = "${var.region}-docker.pkg.dev/${var.project_id}/${var.microservice_name}"
}

# Output: Internal IP
output "internal_ip" {
  value = google_compute_instance.pipeline_vm.network_interface[0].network_ip
} 
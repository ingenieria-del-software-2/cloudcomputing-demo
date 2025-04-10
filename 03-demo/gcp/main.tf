# Configuración del proveedor GCP
provider "google" {
  project = var.project_id
  region  = var.region
}

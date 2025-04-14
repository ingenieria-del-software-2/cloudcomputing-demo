variable "project_id" {
  description = "GCP Project ID"
  type        = string
}

variable "region" {
  description = "GCP Region"
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "GCP Zone"
  type        = string
  default     = "us-central1-a"
}

variable "vm_name" {
  description = "Nombre de la instancia VM"
  type        = string
  default     = "pipeline-vm"
}

variable "vm_machine_type" {
  description = "Tipo de máquina para la VM"
  type        = string
  default     = "e2-micro"
}

variable "disk_size_gb" {
  description = "Tamaño del disco en GB (máximo 30GB para free tier)"
  type        = number
  default     = 10
  # ⚠️ Remover validación de tamaño del disco si se se necesita más de 30GB, pero esto esta fuera de free tier
  validation {
    condition     = var.disk_size_gb <= 30
    error_message = "El tamaño del disco no puede exceder los 30GB en free tier."
  }
}

variable "ssh_private_key_path" {
  description = "Ruta local hacia tu clave privada SSH para conectar a la VM"
  type        = string
  default     = "~/.ssh/tu_clave_gcp"
}

variable "ssh_public_key_path" {
  description = "Ruta local hacia tu clave pública SSH que se agregará a la VM"
  type        = string
  default     = "~/.ssh/tu_clave_gcp.pub"
}

variable "microservice_name" {
  description = "Nombre del microservicio (y del repo en Artifact Registry)"
  type        = string
}

variable "allowed_ip_cidr" {
  description = "CIDR block allowed to access SSH, HTTP, Traefik, and Jaeger"
  type        = string
  default     = "0.0.0.0/0"
}

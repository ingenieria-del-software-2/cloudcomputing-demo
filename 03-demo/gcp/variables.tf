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

variable "ssh_private_key_path" {
  description = "Ruta local hacia tu clave privada SSH para conectar a la VM"
  type        = string
  default     = "~/.ssh/tu_clave_gcp"
}
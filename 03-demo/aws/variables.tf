# AWS IAM User profile
variable "aws_profile" {
  description = "AWS profile to use for authentication"
  type        = string
  default     = "iamadmin-general"
}

# AWS region
variable "region" {
  description = "AWS region to deploy resources"
  type        = string
  default     = "us-east-1"
}

# AMI path in SSM Parameter Store
variable "ami_ssm_path" {
  description = "SSM path to retrieve latest Amazon Linux AMI"
  type        = string
  default     = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

# Allowed CIDR block for SSH, HTTP, and dashboards
variable "allowed_ip_cidr" {
  description = "CIDR block allowed to access SSH, HTTP, Traefik, and Jaeger"
  type        = string
  default     = "0.0.0.0/0"
}

# Disk size in GB
variable "disk_size_gb" {
  description = "Tamaño del disco en GB (máximo 30GB para free tier)"
  type        = number
  default     = 8
  # ⚠️ Remover validación de tamaño del disco si se se necesita más de 30GB, pero esto esta fuera de free tier
  validation {
    condition     = var.disk_size_gb <= 30
    error_message = "El tamaño del disco no puede exceder los 30GB en free tier."
  }
}

# SSH key pair name for EC2 instance
variable "ssh_key_name" {
  description = "Existing AWS SSH key pair name"
  type        = string
}

# Path to local SSH private key for provisioners
variable "ssh_private_key_path" {
  description = "Local path to the SSH private key (.pem)"
  type        = string
  default     = "~/.ssh/your_key.pem"
}

variable "microservice_name" {
  description = "Nombre del microservicio (usado como nombre del repositorio ECR)"
  type        = string
}

variable "vm_instance_name" {
  description = "Name of the EC2 instance for Docker"
  type        = string
  default     = "DockerComposeInstance"
}
